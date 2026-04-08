import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Baseline, BaselineOutput } from "./base.ts";
import type { Task, ExpectedAnswer, Location } from "../types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// benchmark/src/baselines → sverklo root → dist/bin/sverklo.js
const SVERKLO_BIN = resolve(__dirname, "..", "..", "..", "dist", "bin", "sverklo.js");

/**
 * sverklo baseline: spawns `sverklo <root>` as an MCP stdio server,
 * initializes once per dataset, then calls the relevant tool per task.
 *
 * Tool mapping:
 *   P1 → sverklo_lookup
 *   P2 → sverklo_refs
 *   P4 → sverklo_deps
 *   P5 → sverklo_audit (orphans section)
 */
export class SverkloBaseline implements Baseline {
  name = "sverklo";
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 100;
  private stdoutBuffer = "";
  private pending = new Map<number, (msg: any) => void>();
  private datasetColdStart = 0;
  private firstTaskForDataset = true;

  async setupForDataset(d: { name: string; rootPath: string }): Promise<void> {
    await this.teardownForDataset();
    const start = Date.now();

    this.child = spawn("node", [SVERKLO_BIN, d.rootPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SVERKLO_DEBUG: "" },
    });

    this.child.stdout.on("data", (buf) => this.onStdout(buf));
    this.child.stderr.on("data", () => { /* swallow */ });
    this.child.on("error", () => {});

    // MCP handshake
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sverklo-bench-v2", version: "1.0" },
    }, 60000);

    await this.rpc("tools/list", {}, 60000);

    // Wait until indexing is done by polling sverklo_status.
    // Indexing happens in the background — tool calls before it
    // finishes return empty results (which would falsely tank recall).
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      let txt = "";
      try {
        txt = await this.callTool("sverklo_status", {}, 30000);
      } catch {
        break;
      }
      // sverklo_status text contains "Status: ready" or "Status: indexing (x/y)"
      if (/Status:\s*ready/.test(txt)) break;
      await sleep(500);
    }

    this.datasetColdStart = Date.now() - start;
    this.firstTaskForDataset = true;
  }

  async teardownForDataset(): Promise<void> {
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
    this.stdoutBuffer = "";
    this.pending.clear();
  }

  async run(task: Task): Promise<BaselineOutput> {
    const start = Date.now();
    const coldStart = this.firstTaskForDataset ? this.datasetColdStart : 0;
    this.firstTaskForDataset = false;

    let payload = "";
    let toolCalls = 0;
    let prediction: ExpectedAnswer;

    try {
      switch (task.category) {
        case "P1": {
          toolCalls++;
          const res = await this.callTool("sverklo_lookup", {
            symbol: task.query,
            token_budget: 800,
          });
          payload = res;
          prediction = parseLookupOutput(res);
          break;
        }
        case "P2": {
          toolCalls++;
          const res = await this.callTool("sverklo_refs", {
            symbol: task.query,
            token_budget: 1500,
          });
          payload = res;
          prediction = parseRefsOutput(res);
          break;
        }
        case "P4": {
          toolCalls++;
          const res = await this.callTool("sverklo_deps", {
            path: task.query,
            direction: "both",
            token_budget: 1200,
          });
          payload = res;
          prediction = parseDepsOutput(res);
          break;
        }
        case "P5": {
          toolCalls++;
          const res = await this.callTool("sverklo_audit", { token_budget: 2500 });
          payload = res;
          prediction = parseAuditOrphans(res);
          break;
        }
      }
    } catch (e: any) {
      prediction = empty(task);
      payload = `ERROR: ${e?.message || String(e)}`;
    }

    const wall = Date.now() - start;
    return {
      prediction: prediction!,
      rawPayload: payload,
      toolCalls,
      wallTimeMs: wall,
      coldStartMs: coldStart,
      warmCallMs: wall,
    };
  }

  // ——————————— MCP plumbing ———————————

  private async rpc(method: string, params: any, timeoutMs = 30000): Promise<any> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, (resp: any) => {
        clearTimeout(timer);
        if (resp.error) reject(new Error(resp.error.message || "rpc error"));
        else resolvePromise(resp.result);
      });
      try {
        this.child!.stdin.write(msg);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  private async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60000): Promise<string> {
    const result = await this.rpc("tools/call", { name, arguments: args }, timeoutMs);
    return result?.content?.[0]?.text ?? "";
  }

  private onStdout(buf: Buffer) {
    this.stdoutBuffer += buf.toString();
    let nl;
    while ((nl = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, nl);
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && this.pending.has(msg.id)) {
          const cb = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          cb(msg);
        }
      } catch {
        // non-JSON chatter — ignore
      }
    }
  }
}

// ——————————— output parsers ———————————

/**
 * sverklo_lookup output format (from formatLookup in src/search/token-budget.ts):
 *   ## name (type)
 *   file.ts:startLine-endLine
 *   ```lang
 *   ...
 *   ```
 *
 * We want the first (file, line) pair.
 */
export function parseLookupOutput(text: string): ExpectedAnswer {
  const locs: Location[] = [];
  // Primary header format: "## <path>:<startLine>-<endLine> (<type>: <name>)"
  const re = /^##\s+(\S+?):(\d+)-\d+\s+\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    locs.push({ file: m[1], line: parseInt(m[2], 10) });
    if (locs.length >= 5) break;
  }
  // Fallback format used when chunks exceed token_budget:
  //   "- **<path>:<startLine>-<endLine>** (<type>: <name>, ~N tokens)"
  if (locs.length === 0) {
    const fb = /^-\s+\*\*(\S+?):(\d+)-\d+\*\*\s+\(/gm;
    while ((m = fb.exec(text))) {
      locs.push({ file: m[1], line: parseInt(m[2], 10) });
      if (locs.length >= 5) break;
    }
  }
  return { kind: "locations", locations: locs.slice(0, 1) };
}

/**
 * sverklo_refs output format (from find-references.ts):
 *   ## References to 'X' (N total)
 *   ### file.ts
 *     L42: some content
 *     L58: other
 */
export function parseRefsOutput(text: string): ExpectedAnswer {
  const locs: Location[] = [];
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) { current = h[1]; continue; }
    const m = line.match(/^\s*L(\d+):/);
    if (m && current) locs.push({ file: current, line: parseInt(m[1], 10) });
  }
  return { kind: "locations", locations: locs };
}

/**
 * sverklo_deps output format (from dependencies.ts):
 *   ### This file imports:
 *     → path/x.ts (n refs)
 *   ### Files that import this:
 *     ← path/y.ts (n refs)
 */
export function parseDepsOutput(text: string): ExpectedAnswer {
  const imports: string[] = [];
  const importers: string[] = [];
  let mode: "imports" | "importers" | null = null;
  for (const line of text.split("\n")) {
    if (/This file imports:/.test(line)) { mode = "imports"; continue; }
    if (/Files that import this:/.test(line)) { mode = "importers"; continue; }
    const imp = line.match(/^\s*→\s*(\S+)/);
    const rev = line.match(/^\s*←\s*(\S+)/);
    if (imp && mode === "imports") imports.push(imp[1]);
    if (rev && mode === "importers") importers.push(rev[1]);
  }
  return { kind: "deps", imports, importers };
}

/**
 * sverklo_audit output has an "## Orphans (potential dead code)" section:
 *   - **name** — `file:line`
 */
export function parseAuditOrphans(text: string): ExpectedAnswer {
  const names: string[] = [];
  const inSection = text.split(/^## /m).find((s) => s.startsWith("Orphans"));
  if (inSection) {
    const re = /\*\*([A-Za-z_][A-Za-z0-9_]*)\*\*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inSection))) names.push(m[1]);
  }
  return { kind: "names", names };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function empty(task: Task): ExpectedAnswer {
  switch (task.category) {
    case "P1":
    case "P2":
      return { kind: "locations", locations: [] };
    case "P4":
      return { kind: "deps", imports: [], importers: [] };
    case "P5":
      return { kind: "names", names: [] };
  }
}
