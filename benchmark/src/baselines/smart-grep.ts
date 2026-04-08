import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Baseline, BaselineOutput } from "./base.ts";
import type { Task, ExpectedAnswer, Location } from "../types.ts";
import { parseGrepOutput, extractImports } from "./naive-grep.ts";

/**
 * smart-grep: a competent dev's grep workflow.
 *   - filters by language extension
 *   - excludes node_modules / dist / .git
 *   - reads only the matching ±10 lines instead of full files
 *   - for P1, prefers definition-shaped lines via regex
 *
 * This is the realistic floor — the bar sverklo has to clear.
 */
export class SmartGrepBaseline implements Baseline {
  name = "smart-grep";
  private root = "";

  async setupForDataset(d: { name: string; rootPath: string }): Promise<void> {
    this.root = d.rootPath;
  }

  async run(task: Task): Promise<BaselineOutput> {
    const start = Date.now();
    let payload = "";
    let toolCalls = 0;
    let prediction: ExpectedAnswer;

    const includes = `--include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs'`;
    const excludes = `--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=build`;

    try {
      switch (task.category) {
        case "P1": {
          const sym = task.query;
          // Definition-shaped grep
          toolCalls++;
          let defOut = "";
          try {
            defOut = execSync(
              `grep -rnE ${includes} ${excludes} ${shellQuote(`(function|class|interface|type|const|let|var|def|export default function|export default class)\\s+${escapeRe(sym)}\\b`)} . 2>/dev/null | head -10`,
              { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
            );
          } catch {}
          payload += defOut;

          let hits = parseGrepOutput(defOut);

          // Fallback: plain grep
          if (hits.length === 0) {
            toolCalls++;
            let fallback = "";
            try {
              fallback = execSync(
                `grep -rn ${includes} ${excludes} ${shellQuote(sym)} . 2>/dev/null | head -10`,
                { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
              );
            } catch {}
            payload += fallback;
            hits = parseGrepOutput(fallback);
          }

          // Read ±10 lines around top hit
          if (hits[0]) {
            toolCalls++;
            payload += readContext(this.root, hits[0].file, hits[0].line, 10);
          }

          prediction = {
            kind: "locations",
            locations: hits.slice(0, 1).map((h) => ({ file: h.file, line: h.line })),
          };
          break;
        }
        case "P2": {
          const sym = task.query;
          toolCalls++;
          let out = "";
          try {
            out = execSync(
              `grep -rnw ${includes} ${excludes} ${shellQuote(sym)} . 2>/dev/null | head -100`,
              { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
            );
          } catch {}
          payload += out;
          const hits = parseGrepOutput(out);
          // Filter out the def line(s) — heuristic: lines that contain
          // a definition keyword followed by the symbol.
          const defRe = new RegExp(`(function|class|interface|type|const|let|var|def)\\s+${escapeRe(sym)}\\b`);
          const refs: Location[] = hits
            .filter((h) => !defRe.test(h.snippet))
            .map((h) => ({ file: h.file, line: h.line }));
          prediction = { kind: "locations", locations: refs };
          break;
        }
        case "P4": {
          const file = task.query;
          toolCalls++;
          let imports: string[] = [];
          try {
            const content = readFileSync(join(this.root, file), "utf-8");
            payload += `=== ${file} (head) ===\n${content.slice(0, 4000)}\n`;
            imports = extractImports(content, file);
          } catch {}
          // Importers: word-grep on basename, restricted to source files
          const base = (file.split("/").pop() || file).replace(/\.(ts|tsx|js|mjs)$/, "");
          toolCalls++;
          let out = "";
          try {
            out = execSync(
              `grep -rln ${includes} ${excludes} ${shellQuote(base)} . 2>/dev/null | head -30`,
              { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
            );
          } catch {}
          payload += out;
          const importers = out
            .split("\n")
            .map((s) => s.replace(/^\.\//, "").trim())
            .filter(Boolean)
            .filter((p) => p !== file);
          prediction = { kind: "deps", imports, importers };
          break;
        }
        case "P5": {
          toolCalls++;
          let exportsOut = "";
          try {
            exportsOut = execSync(
              `grep -rnE ${includes} ${excludes} 'export (function|class|const|interface|type) [A-Za-z_]' . 2>/dev/null | head -200`,
              { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
            );
          } catch {}
          payload += exportsOut;
          const candidates: { name: string; file: string }[] = [];
          for (const line of exportsOut.split("\n")) {
            const m = line.match(/^\.?\/?(.+?):\d+:.*export (?:function|class|const|interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)/);
            if (m) candidates.push({ file: m[1], name: m[2] });
          }
          // Smart filter: skip common API names
          const skip = new Set(["default", "main", "index"]);
          const dead: string[] = [];
          const seen = new Set<string>();
          for (const { name, file } of candidates) {
            if (seen.has(name) || skip.has(name)) continue;
            seen.add(name);
            if (dead.length >= 30) break;
            toolCalls++;
            let refOut = "";
            try {
              refOut = execSync(
                `grep -rln ${includes} ${excludes} ${shellQuote(name)} . 2>/dev/null | head -3`,
                { cwd: this.root, encoding: "utf-8", timeout: 10000, maxBuffer: 1024 * 1024, shell: "/bin/bash" }
              );
            } catch {}
            payload += refOut;
            const files = refOut.split("\n").filter(Boolean).map((s) => s.replace(/^\.\//, ""));
            // dead = only the file containing the export itself appears
            if (files.length === 0 || (files.length === 1 && files[0] === file)) {
              dead.push(name);
            }
          }
          prediction = { kind: "names", names: dead };
          break;
        }
      }
    } catch {
      prediction = empty(task);
    }

    const wall = Date.now() - start;
    return {
      prediction: prediction!,
      rawPayload: payload,
      toolCalls,
      wallTimeMs: wall,
      coldStartMs: 0,
      warmCallMs: wall,
    };
  }
}

function readContext(root: string, file: string, line: number, around: number): string {
  try {
    const abs = join(root, file);
    if (statSync(abs).size > 500_000) return "";
    const lines = readFileSync(abs, "utf-8").split("\n");
    const from = Math.max(0, line - 1 - around);
    const to = Math.min(lines.length, line - 1 + around + 1);
    return `\n=== ${file}:${from + 1}-${to} ===\n` + lines.slice(from, to).join("\n") + "\n";
  } catch {
    return "";
  }
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

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
