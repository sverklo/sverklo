// Sverklo telemetry — opt-in, privacy-preserving.
//
// Design doc: TELEMETRY_DESIGN.md (locked 2026-04-08).
// User-facing summary: TELEMETRY.md.
//
// This file is the entire telemetry surface. Anything that touches the
// network or filesystem on behalf of telemetry must go through track().
//
// Hard rules (mirror the README "## Telemetry" section):
//   1. Off by default. Only enabled if ~/.sverklo/telemetry.enabled exists.
//   2. ~/.sverklo/telemetry.disabled overrides everything — disabled file always wins.
//   3. Every event is mirrored to ~/.sverklo/telemetry.log BEFORE the network call.
//   4. Network call is fire-and-forget with an 800ms hard timeout. Failures are silent.
//   5. No retries, no offline buffering, no queue, no telemetry-on-telemetry.
//   6. Schema is fixed in src/telemetry/types.ts. Never inline a new field here.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Event, EventType, Outcome, Os } from "./types.js";

const TELEMETRY_DIR = join(homedir(), ".sverklo");
const ENABLED_FILE = join(TELEMETRY_DIR, "telemetry.enabled");
const DISABLED_FILE = join(TELEMETRY_DIR, "telemetry.disabled");
const ID_FILE = join(TELEMETRY_DIR, "install-id");
const LOG_FILE = join(TELEMETRY_DIR, "telemetry.log");
const NUDGED_FILE = join(TELEMETRY_DIR, "init-nudged");

// Telemetry endpoint. Defaults to the production custom-domain URL on
// sverklo.com (a Cloudflare Worker behind a Cloudflare-managed zone).
// Override at runtime with SVERKLO_TELEMETRY_ENDPOINT — useful for local
// development against a wrangler dev server, or for users behind corporate
// proxies who need to point at a self-hosted relay.
const ENDPOINT =
  process.env.SVERKLO_TELEMETRY_ENDPOINT || "https://t.sverklo.com/v1/event";
const POST_TIMEOUT_MS = 800;

// Resolved lazily so the cost is paid once and only when telemetry is on.
let cachedVersion: string | null = null;

function readVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Walk up looking for our package.json. Works in src/ and dist/.
    for (const rel of ["..", "../..", "../../..", "../../../.."]) {
      try {
        const pkg = JSON.parse(
          readFileSync(join(here, rel, "package.json"), "utf-8")
        );
        if (pkg.name === "sverklo" && pkg.version) {
          cachedVersion = pkg.version as string;
          return cachedVersion;
        }
      } catch {}
    }
  } catch {}
  cachedVersion = "0.0.0";
  return cachedVersion;
}

function detectOs(): Os {
  const p = platform();
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "other";
}

function nodeMajor(): number {
  const m = process.versions.node.split(".")[0];
  const n = parseInt(m, 10);
  return Number.isFinite(n) ? n : 0;
}

function ensureDir(): void {
  try {
    mkdirSync(TELEMETRY_DIR, { recursive: true });
  } catch {}
}

/**
 * Is telemetry enabled on this machine?
 *
 * Disabled file always wins — even if both files exist (race condition or
 * leftover from a corrupted disable command), we treat the user as opted out.
 * No network call, no other side effect.
 */
export function isEnabled(): boolean {
  if (existsSync(DISABLED_FILE)) return false;
  return existsSync(ENABLED_FILE);
}

/**
 * Has the first-init nudge been shown? Used by sverklo init to print a
 * one-line "telemetry is OFF — enable with..." message exactly once per machine.
 */
export function hasBeenNudged(): boolean {
  return existsSync(NUDGED_FILE);
}

export function markNudged(): void {
  ensureDir();
  try {
    writeFileSync(NUDGED_FILE, new Date().toISOString() + "\n");
  } catch {}
}

/**
 * Read the install-id from disk. Returns null if not opted in.
 * The install-id is the only stable identifier the binary ever generates.
 */
export function getInstallId(): string | null {
  if (!isEnabled()) return null;
  try {
    return readFileSync(ID_FILE, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Enable telemetry: write enabled sentinel + install-id, send opt_in event.
 * Idempotent — calling twice on an already-enabled machine returns the existing id.
 */
export async function enable(): Promise<string> {
  ensureDir();
  // If user previously disabled, clear that sentinel.
  if (existsSync(DISABLED_FILE)) {
    try {
      unlinkSync(DISABLED_FILE);
    } catch {}
  }
  if (existsSync(ENABLED_FILE) && existsSync(ID_FILE)) {
    return readFileSync(ID_FILE, "utf-8").trim();
  }
  const id = randomUUID();
  writeFileSync(ID_FILE, id + "\n");
  writeFileSync(ENABLED_FILE, new Date().toISOString() + "\n");
  await track("opt_in");
  return id;
}

/**
 * Disable telemetry: send opt_out event (best-effort), remove enabled sentinel
 * and install-id, write disabled sentinel. Disabled state is persistent —
 * the user has to explicitly call enable() again to re-opt-in.
 */
export async function disable(): Promise<void> {
  // Send opt_out BEFORE removing the install-id, so the event still has it.
  if (isEnabled()) {
    await track("opt_out");
  }
  ensureDir();
  try {
    if (existsSync(ENABLED_FILE)) unlinkSync(ENABLED_FILE);
  } catch {}
  try {
    if (existsSync(ID_FILE)) unlinkSync(ID_FILE);
  } catch {}
  writeFileSync(DISABLED_FILE, new Date().toISOString() + "\n");
}

interface TrackOptions {
  tool?: string | null;
  outcome?: Outcome;
  duration_ms?: number;
  /** Bucketed response size: xs/s/m/l/xl. Lets us compare the impact
   * of compact-format defaults without recording any content. */
  size_bucket?: "xs" | "s" | "m" | "l" | "xl";
}

/**
 * Record an event. Hard short-circuits if telemetry is disabled — no fs read,
 * no network call, no log write. Safe to call from hot paths.
 *
 * Events are mirrored to ~/.sverklo/telemetry.log BEFORE the network call.
 * Network call has a hard 800ms timeout and never throws upstream.
 */
export async function track(event: EventType, opts: TrackOptions = {}): Promise<void> {
  if (!isEnabled()) return;
  const id = getInstallId();
  if (!id) return; // belt + suspenders

  const payload: Event = {
    install_id: id,
    version: readVersion(),
    os: detectOs(),
    node_major: nodeMajor(),
    event,
    tool: opts.tool ?? null,
    outcome: opts.outcome ?? "ok",
    duration_ms: opts.duration_ms ?? 0,
  };

  // Mirror to local log BEFORE the network call so the user always has a
  // record of what we tried to send, even if the network is down.
  try {
    appendFileSync(LOG_FILE, JSON.stringify(payload) + "\n");
  } catch {}

  // Fire-and-forget POST. Hard 800ms timeout. Silent on failure.
  // We deliberately do not retry, queue, or buffer — telemetry must never
  // hold up sverklo's actual work and must never grow unbounded.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `sverklo/${payload.version}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch {
    // silent
  }
}

/**
 * Status snapshot for `sverklo telemetry status`. Reads the local state only;
 * never touches the network.
 */
export function status(): {
  enabled: boolean;
  installId: string | null;
  endpoint: string;
  logPath: string;
  enabledPath: string;
  disabledPath: string;
} {
  return {
    enabled: isEnabled(),
    installId: getInstallId(),
    endpoint: ENDPOINT,
    logPath: LOG_FILE,
    enabledPath: ENABLED_FILE,
    disabledPath: DISABLED_FILE,
  };
}

/**
 * Local log path — exposed so the CLI `telemetry log` subcommand can tail it.
 */
export const logPath = LOG_FILE;
