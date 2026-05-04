/**
 * Lodash ground-truth generator (issue #26).
 *
 * Lodash 4.17.21 ships as a single 17K-line UMD/IIFE in `lodash.js`,
 * plus a small set of helper directories (`fp/`, `lib/`, `vendor/`).
 * This dataset shape is meaningfully different from express's modular
 * CommonJS structure and exercises:
 *
 *   - jcodemunch v1.80.9's force-index-via-package.json-main path
 *     (lodash.js is 548 KB, above the default 500 KB per-file cap)
 *   - jcodemunch v1.80.9's call-graph-only fallback for files with
 *     no import-graph edges (lodash.js is self-contained)
 *
 * Methodology:
 *
 *   P1 (definition lookup): 10 well-known public methods with hand-
 *     verified line numbers in lodash.js. Stable across patch releases
 *     of 4.17.x; if upstream renames or moves these we'll need to
 *     re-verify.
 *
 *   P2 (reference finding): 10 of the same names, references resolved
 *     at run-time via grep against lodash.js. Each method is called
 *     internally many times within the IIFE.
 *
 *   P4 (file dependencies): 5 entries targeting `fp/` files which DO
 *     have inter-file imports. lodash.js itself has no static imports
 *     so it's not a useful P4 candidate.
 *
 *   P5 (dead code): empty-expected pattern, same as express. Score
 *     punishes false positives. v1.80.9's monolithic-IIFE fixes
 *     should reduce the false-positive count on lodash specifically;
 *     pre-fix versions flagged published methods (`map`, `filter`,
 *     `reduce`) as dead due to the import-graph-only requirement.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Task, Location } from "../../types.ts";
import { extractImports } from "../../baselines/naive-grep.ts";

// Hand-verified line numbers in lodash.js for 4.17.21. If upstream
// shifts these, re-run the verification command in the README and
// update.
const P1_DEFINITIONS: { name: string; file: string; line: number }[] = [
  { name: "map", file: "lodash.js", line: 9620 },
  { name: "filter", file: "lodash.js", line: 9239 },
  { name: "reduce", file: "lodash.js", line: 9745 },
  { name: "debounce", file: "lodash.js", line: 10372 },
  { name: "throttle", file: "lodash.js", line: 10965 },
  { name: "merge", file: "lodash.js", line: 16689 },
  { name: "cloneDeep", file: "lodash.js", line: 11155 },
  { name: "get", file: "lodash.js", line: 13194 },
  { name: "set", file: "lodash.js", line: 13741 },
  { name: "chunk", file: "lodash.js", line: 6903 },
];

const P2_SYMBOLS: string[] = [
  "map",
  "filter",
  "reduce",
  "debounce",
  "throttle",
  "merge",
  "cloneDeep",
  "get",
  "set",
  "chunk",
];

// fp/ has small files with real inter-file imports — useful P4 targets.
const P4_FILES: string[] = [
  "fp/_baseConvert.js",
  "fp/_convertBrowser.js",
  "fp/_mapping.js",
  "fp/placeholder.js",
  "lodash.js",
];

export function generateLodashTasks(rootPath: string): Task[] {
  if (!existsSync(rootPath)) {
    throw new Error(`Lodash checkout missing: ${rootPath}`);
  }
  const tasks: Task[] = [];

  // ───── P1 ─────
  for (let i = 0; i < P1_DEFINITIONS.length; i++) {
    const { name, file, line } = P1_DEFINITIONS[i];
    tasks.push({
      id: `ld-p1-${pad(i + 1)}`,
      category: "P1",
      dataset: "lodash",
      query: name,
      expected: { kind: "locations", locations: [{ file, line }] },
    });
  }

  // ───── P2 ─────
  for (let i = 0; i < P2_SYMBOLS.length; i++) {
    const name = P2_SYMBOLS[i];
    const refs = findReferencesInLodash(rootPath, name);
    tasks.push({
      id: `ld-p2-${pad(i + 1)}`,
      category: "P2",
      dataset: "lodash",
      query: name,
      expected: { kind: "locations", locations: refs },
    });
  }

  // ───── P4 ─────
  for (let i = 0; i < P4_FILES.length; i++) {
    const file = P4_FILES[i];
    const abs = join(rootPath, file);
    let imports: string[] = [];
    let importers: string[] = [];
    try {
      const content = readFileSync(abs, "utf-8");
      imports = extractImports(content, file);
    } catch {}
    importers = findImportersInLodash(rootPath, file);
    tasks.push({
      id: `ld-p4-${pad(i + 1)}`,
      category: "P4",
      dataset: "lodash",
      query: file,
      expected: { kind: "deps", imports, importers },
    });
  }

  // ───── P5 ─────
  // Empty-expected — score punishes false positives. v1.80.9's fixes
  // should reduce false-positive count vs older versions that flagged
  // published methods as dead.
  for (let i = 0; i < 5; i++) {
    tasks.push({
      id: `ld-p5-${pad(i + 1)}`,
      category: "P5",
      dataset: "lodash",
      query: "",
      expected: { kind: "names", names: [] },
    });
  }

  return tasks;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function findReferencesInLodash(root: string, name: string): Location[] {
  // word-grep within lodash.js + fp/ + lib/, drop the definition line
  const out = grep(root, `\\b${escapeRe(name)}\\b`, ["lodash.js", "fp", "lib"]);
  // Drop the function definition line itself (function NAME or var NAME =)
  const defRe = new RegExp(
    `(function\\s+${escapeRe(name)}\\b|var\\s+${escapeRe(name)}\\s*=|^${escapeRe(name)}:)`,
  );
  return out
    .filter((h) => !defRe.test(h.snippet ?? ""))
    .map((h) => ({ file: h.file, line: h.line }));
}

function findImportersInLodash(root: string, file: string): string[] {
  // CommonJS-only — find require('./relative/path')
  const base = file.replace(/\.(js|ts|mjs|cjs)$/, "");
  const baseName = base.split("/").pop()!;
  const out = new Set<string>();
  try {
    const cmd = `grep -rln --include='*.js' --exclude-dir=node_modules --exclude-dir=test --exclude-dir=dist ${shellQuote(`require.*${baseName}`)} . 2>/dev/null || true`;
    const result = execSync(cmd, {
      cwd: root,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
      shell: "/bin/bash",
    });
    for (const line of result.split("\n")) {
      const p = line.replace(/^\.\//, "").trim();
      if (!p || p === file) continue;
      out.add(p);
    }
  } catch {}
  return [...out];
}

interface Hit {
  file: string;
  line: number;
  snippet?: string;
}

function grep(root: string, pattern: string, paths: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const p of paths) {
    const target = join(root, p);
    if (!existsSync(target)) continue;
    try {
      const out = execSync(
        `grep -rnE --include='*.js' --exclude-dir=node_modules --exclude-dir=test --exclude-dir=dist ${shellQuote(pattern)} ${shellQuote(p)} 2>/dev/null || true`,
        {
          cwd: root,
          encoding: "utf-8",
          timeout: 60000,
          maxBuffer: 20 * 1024 * 1024,
          shell: "/bin/bash",
        },
      );
      for (const line of out.split("\n")) {
        if (!line) continue;
        const m = line.match(/^(.+?):(\d+):(.*)$/);
        if (m) hits.push({ file: m[1], line: parseInt(m[2], 10), snippet: m[3] });
      }
    } catch {}
  }
  return hits;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
