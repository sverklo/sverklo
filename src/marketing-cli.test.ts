import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SVERKLO_BIN = join(process.cwd(), "dist", "bin", "sverklo.js");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("sverklo marketing CLI", () => {
  let tmpHome: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    const sourceMtime = statSync(join(process.cwd(), "bin", "sverklo.ts")).mtimeMs;
    const distMtime = existsSync(SVERKLO_BIN) ? statSync(SVERKLO_BIN).mtimeMs : 0;
    if (distMtime < sourceMtime) {
      execFileSync("npm", ["run", "build"], { cwd: process.cwd(), stdio: "pipe" });
    }
  }, 30000);

  beforeEach(() => {
    tmpHome = join(tmpdir(), `sverklo-marketing-home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    workspace = join(tmpdir(), `sverklo-marketing-workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(workspace, "inputs"), { recursive: true });
    env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it("initializes a local workspace", () => {
    const out = execFileSync("node", [SVERKLO_BIN, "marketing", "init", "--workspace", workspace, "--account", "@sverklo"], {
      env,
      stdio: "pipe",
    }).toString();
    expect(out).toContain("Initialized marketing workspace");
    expect(existsSync(join(workspace, "workspace.json"))).toBe(true);
  });

  it("runs an opportunity cycle from local trend input", () => {
    execFileSync("node", [SVERKLO_BIN, "marketing", "init", "--workspace", workspace, "--account", "@sverklo"], {
      env,
      stdio: "pipe",
    });
    writeJson(join(workspace, "inputs", "trend-snapshot.json"), {
      captured_at: "2026-05-30T15:00:00Z",
      source_label: "fixture",
      items: [
        {
          id: "trend-001",
          text: "Developers discussing local-first coding agents and repo memory",
          source_context: "Public developer-tool notes",
          observed_at: "2026-05-30T14:00:00Z",
        },
      ],
    });
    const out = execFileSync("node", [SVERKLO_BIN, "marketing", "run-cycle", "--workspace", workspace, "--format", "json"], {
      env,
      stdio: "pipe",
    }).toString();
    const parsed = JSON.parse(out);
    expect(parsed.counts.opportunities).toBe(1);
    expect(existsSync(join(workspace, "reports", "cycle-2026-05-30-opportunities.md"))).toBe(true);
  });

  it("records decisions and creates content reports without live account actions", () => {
    execFileSync("node", [SVERKLO_BIN, "marketing", "init", "--workspace", workspace, "--account", "@sverklo"], {
      env,
      stdio: "pipe",
    });
    writeJson(join(workspace, "inputs", "trend-snapshot.json"), {
      captured_at: "2026-05-30T15:00:00Z",
      source_label: "fixture",
      items: [
        {
          id: "trend-001",
          text: "MCP workflows need better local-first code intelligence",
          source_context: "Public developer-tool notes",
          observed_at: "2026-05-30T14:00:00Z",
        },
      ],
    });
    writeJson(join(workspace, "inputs", "evidence.json"), {
      items: [
        {
          evidence_id: "bench-readme-001",
          claim: "Sverklo benchmark methodology is public",
          source_type: "benchmark",
          source_path_or_url: "sverklo/benchmark/README.md",
          verified_at: "2026-05-30T15:00:00Z",
        },
      ],
    });
    execFileSync("node", [SVERKLO_BIN, "marketing", "run-cycle", "--workspace", workspace], { env, stdio: "pipe" });
    execFileSync("node", [
      SVERKLO_BIN,
      "marketing",
      "decide",
      "--workspace",
      workspace,
      "--target-type",
      "opportunity",
      "--target-id",
      "opp-001",
      "--decision",
      "approve",
      "--reason",
      "High-fit MCP workflow",
    ], { env, stdio: "pipe" });
    execFileSync("node", [SVERKLO_BIN, "marketing", "run-cycle", "--workspace", workspace], { env, stdio: "pipe" });
    const contentReport = readFileSync(join(workspace, "reports", "cycle-2026-05-30-content.md"), "utf-8");
    expect(contentReport).toContain("content-001");
    expect(readFileSync(join(workspace, "decisions.jsonl"), "utf-8")).toContain("High-fit MCP workflow");
  });

  it("runs profile health and status together", () => {
    execFileSync("node", [SVERKLO_BIN, "marketing", "init", "--workspace", workspace, "--account", "@sverklo"], {
      env,
      stdio: "pipe",
    });
    writeJson(join(workspace, "inputs", "profile-snapshot.json"), {
      captured_at: "2026-05-30T15:00:00Z",
      account_handle: "@sverklo",
      display_name: "Sverklo",
      bio: "Local-first code intelligence and repo memory for coding agents.",
      pinned_post: "Sverklo gives agents symbols and git-pinned decisions before they edit.",
      profile_link: "https://sverklo.com",
    });
    writeJson(join(workspace, "inputs", "recent-posts.json"), {
      captured_at: "2026-05-30T15:00:00Z",
      posts: [
        { id: "post-1", text: "Local-first code intelligence.", posted_at: "2026-05-29T15:00:00Z", theme: "local-first code intel" },
        { id: "post-2", text: "Repo memory for agents.", posted_at: "2026-05-28T15:00:00Z", theme: "memory" },
        { id: "post-3", text: "MCP workflow context.", posted_at: "2026-05-27T15:00:00Z", theme: "MCP workflow" },
      ],
    });
    execFileSync("node", [SVERKLO_BIN, "marketing", "run-cycle", "--workspace", workspace], { env, stdio: "pipe" });
    const out = execFileSync("node", [SVERKLO_BIN, "marketing", "status", "--workspace", workspace, "--format", "json"], {
      env,
      stdio: "pipe",
    }).toString();
    const parsed = JSON.parse(out);
    expect(parsed.profile_score).toBeGreaterThanOrEqual(85);
    expect(existsSync(join(workspace, "reports", "cycle-2026-05-30-profile-health.md"))).toBe(true);
  });

  it("keeps marketing implementation free of network and account-mutation primitives", () => {
    const marketingDir = join(process.cwd(), "src", "marketing");
    const files = readdirSync(marketingDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => join(marketingDir, name));
    const combined = files.map((file) => readFileSync(file, "utf-8")).join("\n");
    for (const forbidden of [
      "fetch(",
      "http.request",
      "https.request",
      "playwright",
      "puppeteer",
      "statuses/update",
      "createTweet",
      "sendDirectMessage",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
  });
});
