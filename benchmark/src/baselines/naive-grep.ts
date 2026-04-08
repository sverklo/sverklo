import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, relative, isAbsolute, dirname, resolve } from "node:path";
import type { Baseline, BaselineOutput } from "./base.ts";
import type { Task, ExpectedAnswer, Location } from "../types.ts";

/**
 * naive-grep: what a stateless LLM does when it has only `grep` and `cat`.
 * Strategy:
 *   - P1/P2: grep -rn '<symbol>' .  | head -50, then cat the top files
 *   - P4:    cat the file, regex its imports; for importers grep -rln 'fromfile'
 *   - P5:    grep all 'export ' lines, then for each name grep references
 *
 * This baseline is intentionally dumb; it represents the floor.
 */
export class NaiveGrepBaseline implements Baseline {
  name = "naive-grep";
  private root = "";

  async setupForDataset(d: { name: string; rootPath: string }): Promise<void> {
    this.root = d.rootPath;
  }

  async run(task: Task): Promise<BaselineOutput> {
    const start = Date.now();
    let payload = "";
    let toolCalls = 0;
    let prediction: ExpectedAnswer;

    try {
      switch (task.category) {
        case "P1":
        case "P2": {
          const sym = task.query;
          // grep -rn  (no exclusions, no filters — naive)
          toolCalls++;
          let grepOut = "";
          try {
            grepOut = execSync(
              `grep -rn --binary-files=without-match ${shellQuote(sym)} . 2>/dev/null | head -50`,
              { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 10 * 1024 * 1024, shell: "/bin/bash" }
            );
          } catch {
            grepOut = "";
          }
          payload += grepOut;

          const grepLocs = parseGrepOutput(grepOut);

          // Read top 10 unique files (naive: no awareness of which line is the def)
          const seen = new Set<string>();
          const topFiles: string[] = [];
          for (const l of grepLocs) {
            if (seen.has(l.file)) continue;
            seen.add(l.file);
            topFiles.push(l.file);
            if (topFiles.length >= 10) break;
          }
          for (const f of topFiles) {
            toolCalls++;
            try {
              const abs = join(this.root, f);
              const sz = statSync(abs).size;
              if (sz > 200_000) continue;
              const content = readFileSync(abs, "utf-8");
              payload += `\n=== ${f} ===\n${content}\n`;
            } catch {}
          }

          if (task.category === "P1") {
            // Predict: the first grep line that "looks like a definition"
            // (function/class/const/interface/type/def)
            const defRe = new RegExp(`(function|class|interface|type|const|let|var|def)\\s+${escapeRe(sym)}\\b`);
            const def = grepLocs.find((l) => defRe.test(l.snippet));
            prediction = { kind: "locations", locations: def ? [{ file: def.file, line: def.line }] : grepLocs.slice(0, 1).map(stripSnippet) };
          } else {
            // P2: every grep hit is a "reference candidate". Naive grep
            // can't tell defs from refs, so we keep them all (this hurts
            // its precision, by design).
            prediction = { kind: "locations", locations: grepLocs.map(stripSnippet) };
          }
          break;
        }

        case "P4": {
          // query = file path
          const file = task.query;
          toolCalls++;
          let imports: string[] = [];
          try {
            const abs = join(this.root, file);
            const content = readFileSync(abs, "utf-8");
            payload += `\n=== ${file} ===\n${content}\n`;
            imports = extractImports(content, file);
          } catch {}

          // Importers: grep for the basename
          toolCalls++;
          const baseNoExt = basenameNoExt(file);
          let grepOut = "";
          try {
            grepOut = execSync(
              `grep -rln --binary-files=without-match ${shellQuote(baseNoExt)} . 2>/dev/null | head -30`,
              { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
            );
          } catch {}
          payload += grepOut;
          const importers = grepOut.split("\n").map((s) => s.replace(/^\.\//, "").trim()).filter(Boolean).filter((p) => p !== file);

          prediction = { kind: "deps", imports, importers };
          break;
        }

        case "P5": {
          // Find named exports across the codebase, check refs by grepping
          toolCalls++;
          let exportsOut = "";
          try {
            exportsOut = execSync(
              `grep -rnE --binary-files=without-match 'export (function|class|const|interface|type) [A-Za-z_]' --include='*.ts' --include='*.js' . 2>/dev/null | head -100`,
              { cwd: this.root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
            );
          } catch {}
          payload += exportsOut;

          const candidates: string[] = [];
          for (const line of exportsOut.split("\n")) {
            const m = line.match(/export (?:function|class|const|interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)/);
            if (m) candidates.push(m[1]);
          }
          const dead: string[] = [];
          for (const name of [...new Set(candidates)].slice(0, 25)) {
            toolCalls++;
            let refOut = "";
            try {
              refOut = execSync(
                `grep -rln --binary-files=without-match ${shellQuote(name)} . 2>/dev/null | head -3`,
                { cwd: this.root, encoding: "utf-8", timeout: 10000, maxBuffer: 1024 * 1024, shell: "/bin/bash" }
              );
            } catch {}
            payload += refOut;
            const files = refOut.split("\n").filter(Boolean);
            // 1 file = only the def's own file → dead candidate
            if (files.length <= 1) dead.push(name);
          }
          prediction = { kind: "names", names: dead };
          break;
        }
      }
    } catch (e) {
      prediction = emptyPrediction(task);
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

function emptyPrediction(task: Task): ExpectedAnswer {
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

interface GrepHit {
  file: string;
  line: number;
  snippet: string;
}

export function parseGrepOutput(out: string): GrepHit[] {
  const hits: GrepHit[] = [];
  for (const raw of out.split("\n")) {
    if (!raw) continue;
    // format: ./path/to/file.ts:42:matching content
    const m = raw.match(/^\.?\/?(.+?):(\d+):(.*)$/);
    if (!m) continue;
    hits.push({ file: m[1], line: parseInt(m[2], 10), snippet: m[3] });
  }
  return hits;
}

function stripSnippet(h: GrepHit): Location {
  return { file: h.file, line: h.line };
}

export function extractImports(content: string, fromFile: string): string[] {
  const imports: string[] = [];
  const reEs = /(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g;
  const reReq = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const seen = new Set<string>();
  for (const re of [reEs, reReq]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // skip externals
      const resolved = resolveRelative(fromFile, spec);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        imports.push(resolved);
      }
    }
  }
  return imports;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  // Best-effort: drop trailing .js, try .ts, .tsx, .js
  const base = join(dirname(fromFile), spec);
  return base
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\.js$/, "")
    .replace(/\.ts$/, "");
}

function basenameNoExt(p: string): string {
  const b = p.split("/").pop() || p;
  return b.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
