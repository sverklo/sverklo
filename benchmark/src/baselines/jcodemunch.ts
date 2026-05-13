import { spawn, type ChildProcess } from "node:child_process";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import type { Baseline, BaselineOutput } from "./base.ts";
import type { Task, ExpectedAnswer, Location } from "../types.ts";

/**
 * jcodemunch-mcp baseline. Issue #25 (HaleTom).
 *
 * jcodemunch (https://github.com/jgravelle/jcodemunch-mcp) is an MCP server
 * with tree-sitter symbol extraction. We run it as an out-of-process MCP
 * server (uvx jcodemunch-mcp serve), index the dataset's rootPath via the
 * `index_folder` tool, then map each bench task category to its tool:
 *
 *   P1 — symbol definition lookup → search_symbols
 *   P2 — reference finding         → find_references
 *   P4 — file dependencies          → find_importers + get_dependency_graph
 *   P5 — dead code                  → get_dead_code_v2
 *
 * The MCP client is stdio + JSON-RPC, request/response matched by id.
 * Indexing happens once per dataset in setupForDataset and amortizes
 * across all tasks in that dataset (cold-start is reported on the first
 * task per the BaselineOutput contract).
 *
 * Requires: `uvx` on PATH (https://github.com/astral-sh/uv). uvx resolves
 * jcodemunch-mcp from PyPI on first call; subsequent calls hit cache.
 */
export class JcodemunchBaseline implements Baseline {
  name = "jcodemunch";

  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, (msg: any) => void>();
  private root = "";
  private repoId = "";
  private indexCostMs = 0;
  private firstTaskInDataset = true;

  async setupForDataset(d: { name: string; rootPath: string }): Promise<void> {
    this.root = resolve(d.rootPath);
    this.firstTaskInDataset = true;

    // Spawn MCP server
    this.child = spawn("uvx", ["jcodemunch-mcp", "serve"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.child.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      let nl;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const resolveFn = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            resolveFn(msg);
          }
        } catch {
          /* skip non-JSON noise */
        }
      }
    });
    this.child.stderr!.on("data", () => {
      /* ignore — server logs to stderr */
    });

    // Initialize handshake
    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sverklo-bench", version: "1.0" },
    });
    this.notify("notifications/initialized", {});

    // Compute the canonical repo identifier jcodemunch uses for local
    // folders. Mirrors src/jcodemunch_mcp/tools/resolve_repo.py:
    //   local/<basename(resolved)>-<sha1(resolved)[:8]>
    // We need this id (not the path) for every subsequent query call.
    const sha = createHash("sha1").update(this.root).digest("hex").slice(0, 8);
    this.repoId = `local/${basename(this.root)}-${sha}`;

    // Index the dataset root. This is the cold-start cost. Note the input
    // schema uses `path` (not `folder`).
    const indexStart = Date.now();
    try {
      await this.callTool("index_folder", { path: this.root }, 600_000);
    } catch (err) {
      console.warn(`  jcodemunch index_folder failed: ${(err as Error).message}`);
    }
    this.indexCostMs = Date.now() - indexStart;
  }

  async teardownForDataset(): Promise<void> {
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
    this.pending.clear();
    this.buffer = "";
  }

  async run(task: Task): Promise<BaselineOutput> {
    const start = Date.now();
    let payload = "";
    let toolCalls = 0;
    let prediction: ExpectedAnswer;
    let notes: string | undefined;

    try {
      switch (task.category) {
        case "P1": {
          // search_symbols(query: <sym>) → [{file, line, ...}]
          // format: "json" disables jcodemunch's MUNCH compact format,
          // which our regex parser can't decode without a separate
          // MUNCH library. Cost: slightly higher token count.
          toolCalls++;
          const result = await this.callTool("search_symbols", {
            repo: this.repoId,
            query: task.query,
            limit: 20,
            format: "json",
          });
          payload = stringifyResult(result);
          if (process.env.BENCH_DEBUG === "1" && task.id === "ex-p1-01") {
            console.error(`[debug] P1 ${task.id} query="${task.query}" payload[:400]=`, payload.slice(0, 400));
          }
          prediction = { kind: "locations", locations: parseSearchSymbols(payload, task.query) };
          break;
        }
        case "P2": {
          // find_references(identifier: <sym>) — note: jcodemunch's
          // find_references tracks IMPORT sites, not call sites. Files that
          // call <sym> without importing it (e.g. monkey-patched globals,
          // re-exports, default-exported main module symbols) won't appear.
          // This is a known structural difference vs. sverklo's reference
          // tracking; it is honest to report jcodemunch's actual behavior
          // rather than work around it.
          toolCalls++;
          const result = await this.callTool("find_references", {
            repo: this.repoId,
            identifier: task.query,
            format: "json",
          });
          payload = stringifyResult(result);
          prediction = { kind: "locations", locations: parseFindReferences(payload) };
          break;
        }
        case "P4": {
          // file deps: find_importers gives one half (importers); the other half
          // (this file's imports) needs get_dependency_graph or get_file_outline.
          toolCalls++;
          const importersResult = await this.callTool("find_importers", {
            repo: this.repoId,
            file: task.query,
            format: "json",
          });
          const importersPayload = stringifyResult(importersResult);
          payload += importersPayload + "\n";

          toolCalls++;
          const graphResult = await this.callTool("get_dependency_graph", {
            repo: this.repoId,
            file: task.query,
            depth: 1,
            format: "json",
          });
          const graphPayload = stringifyResult(graphResult);
          payload += graphPayload;

          prediction = {
            kind: "deps",
            imports: parseDepsImports(graphPayload, task.query),
            importers: parseDepsImporters(importersPayload),
          };
          break;
        }
        case "P5": {
          // get_dead_code_v2 returns dead exports/functions.
          //
          // Integration playbook from @jgravelle (sverklo-bench#3):
          //   - max_results: 0 → unlimited (default 100 caps recall artificially
          //     when the expected dead-code set exceeds 100, which it does on
          //     larger datasets like lodash and requests).
          //   - _meta.mode === "call_graph_only" → standard 3-signal analyzer
          //     couldn't run (no inter-file imports). Confidence ceiling is 0.5;
          //     surface so the report can distinguish 3-signal vs single-signal.
          //   - _meta.truncated + _meta.total_matches → if truncated=true the
          //     recall ceiling is bounded by the cap, not the tool.
          toolCalls++;
          const result = await this.callTool("get_dead_code_v2", {
            repo: this.repoId,
            format: "json",
            max_results: 0,
          });
          payload = stringifyResult(result);
          prediction = { kind: "names", names: parseDeadCode(payload) };
          const meta = extractMeta(result, payload);
          if (meta) notes = mergeNotes(notes, meta);
          break;
        }
        default:
          prediction = { kind: "names", names: [] };
          notes = `unsupported task category: ${task.category}`;
      }
    } catch (err) {
      prediction =
        task.category === "P4"
          ? { kind: "deps", imports: [], importers: [] }
          : task.category === "P5"
            ? { kind: "names", names: [] }
            : { kind: "locations", locations: [] };
      notes = `error: ${(err as Error).message}`;
    }

    const wallTimeMs = Date.now() - start;
    const coldStartMs = this.firstTaskInDataset ? this.indexCostMs : 0;
    this.firstTaskInDataset = false;

    return {
      prediction,
      rawPayload: payload,
      toolCalls,
      wallTimeMs,
      coldStartMs,
      warmCallMs: wallTimeMs,
      notes,
    };
  }

  // ─── MCP client helpers ────────────────────────────────────────────────

  private call(method: string, params: any, timeoutMs = 30_000): Promise<any> {
    if (!this.child) throw new Error("jcodemunch server not started");
    const id = this.nextId++;
    return new Promise((resolveFn, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) {
          reject(new Error(msg.error.message ?? "MCP error"));
        } else {
          resolveFn(msg.result);
        }
      });
      this.child!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private notify(method: string, params: any): void {
    if (!this.child) return;
    this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private callTool(name: string, args: any, timeoutMs = 60_000): Promise<any> {
    return this.call("tools/call", { name, arguments: args }, timeoutMs);
  }

}

// ─── Response parsing helpers ────────────────────────────────────────────
// jcodemunch returns MCP CallToolResult: { content: [{ type: "text", text: "..." }] }
// Inner text is typically JSON or jcodemunch's MUNCH compact format. We
// flatten to a string and pull file/line locations out by regex; brittle
// but bounded — our scorer measures recall on locations.

function stringifyResult(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  const content = result.content ?? result;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : c.text ?? JSON.stringify(c)))
      .join("\n");
  }
  return JSON.stringify(result);
}

function parseSearchSymbols(text: string, _query: string): Location[] {
  // search_symbols returns matches with file paths and line numbers.
  // Shape varies; harvest "file":"...", "line":N pairs and (file, line) regex too.
  const locs: Location[] = [];
  const seen = new Set<string>();

  // JSON-shaped: "file":"x.ts","line":42  or  "path":"x.ts","line":42
  const reJson =
    /"(?:file|file_path|path)"\s*:\s*"([^"]+)"[^}]{0,200}?"(?:line|start_line|lineno)"\s*:\s*(\d+)/g;
  let m;
  while ((m = reJson.exec(text)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locs.push({ file: m[1], line: parseInt(m[2], 10) });
  }

  // file:line plain format (also matches MUNCH compact rows)
  const rePlain = /([^\s'"]+\.[a-zA-Z]+):(\d+)/g;
  while ((m = rePlain.exec(text)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locs.push({ file: m[1], line: parseInt(m[2], 10) });
  }

  return locs;
}

function parseFindReferences(text: string): Location[] {
  // find_references returns referencing files (and sometimes specific lines).
  // Use the same harvesting strategy as search_symbols.
  return parseSearchSymbols(text, "");
}

function parseDeadCode(text: string): string[] {
  // get_dead_code_v2 returns symbol names or {name, ...} objects.
  const names = new Set<string>();

  // "name":"foo"
  const reName = /"(?:name|symbol|symbol_name|identifier)"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = reName.exec(text)) !== null) names.add(m[1]);

  // bullet/markdown lists: "- foo" or "* foo" with reasonably bare identifiers
  for (const line of text.split("\n")) {
    const bm = /^\s*[-*]\s+([A-Za-z_$][A-Za-z0-9_$.]*)\s*(?:[:(]|$)/.exec(line);
    if (bm) names.add(bm[1]);
  }

  return Array.from(names);
}

function parseDepsImports(text: string, _file: string): string[] {
  // get_dependency_graph response includes imported files for `file`.
  const imports = new Set<string>();
  // Match arrays or fields named imports/dependencies/edges
  const reArr =
    /"(?:imports|dependencies|outgoing|imported_files)"\s*:\s*\[([^\]]+)\]/g;
  let block;
  while ((block = reArr.exec(text)) !== null) {
    const items = block[1].match(/"([^"]+)"/g) ?? [];
    for (const it of items) {
      const cleaned = it.slice(1, -1);
      if (cleaned && cleaned.includes(".")) imports.add(cleaned);
    }
  }
  return Array.from(imports);
}

function parseDepsImporters(text: string): string[] {
  // find_importers returns the list of files that import the queried file.
  const importers = new Set<string>();
  const reJson = /"(?:file|file_path|path|importer)"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = reJson.exec(text)) !== null) importers.add(m[1]);
  return Array.from(importers);
}

// Surface jcodemunch v1.80.9+ `_meta` diagnostics in per-task notes. The
// MCP response may carry _meta either on the top-level result object or
// embedded in the text payload (depending on jcodemunch version). Check
// both. Returns a short notes-line string, or null if no diagnostics.
function extractMeta(result: any, payload: string): string | null {
  const parts: string[] = [];

  // Top-level _meta on the MCP result
  const topMeta = result && typeof result === "object" ? result._meta : null;
  if (topMeta && typeof topMeta === "object") {
    if (topMeta.mode === "call_graph_only") parts.push("mode=fallback");
    if (topMeta.truncated === true) parts.push("truncated");
    if (typeof topMeta.total_matches === "number")
      parts.push(`total_matches=${topMeta.total_matches}`);
  }

  // Fallback: scan the stringified payload for the same fields when the
  // server embeds _meta inside the text content rather than the envelope.
  if (parts.length === 0 && payload) {
    if (/"mode"\s*:\s*"call_graph_only"/.test(payload)) parts.push("mode=fallback");
    if (/"truncated"\s*:\s*true/.test(payload)) parts.push("truncated");
    const totalM = /"total_matches"\s*:\s*(\d+)/.exec(payload);
    if (totalM) parts.push(`total_matches=${totalM[1]}`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

function mergeNotes(existing: string | undefined, addition: string): string {
  return existing ? `${existing}; ${addition}` : addition;
}
