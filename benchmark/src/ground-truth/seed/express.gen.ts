/**
 * Express ground-truth generator.
 *
 * Why a generator instead of a static .jsonl?
 *   Hand-authoring (file, line) tuples for a 3rd-party tag is brittle and
 *   the maintainer can't visually verify them. Instead we declare *what*
 *   we want (symbol names + heuristics) and let this script resolve them
 *   from the actual checked-out source via grep + a tiny import parser.
 *
 *   Critically, this happens BEFORE any baseline runs, and the resolved
 *   tasks are passed to all baselines identically. The grep used for
 *   ground-truth resolution is **not the same as the smart-grep baseline**:
 *   it can read files freely and uses regex patterns the baselines never
 *   see. This is honest because:
 *     - resolution happens once, deterministically
 *     - baselines compete on the *resolved* tasks
 *     - sverklo doesn't get to peek at this resolver either
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Task, Location } from "../../types.ts";
import { extractImports } from "../../baselines/naive-grep.ts";

const P1_SYMBOLS: { name: string; defKind: string }[] = [
  { name: "createApplication", defKind: "function" },
  { name: "Route", defKind: "function" },
  { name: "Layer", defKind: "function" },
  { name: "View", defKind: "function" },
  { name: "query", defKind: "function" },
  { name: "init", defKind: "function" },
  { name: "acceptParams", defKind: "function" },
  { name: "stringify", defKind: "function" },
  { name: "compileETag", defKind: "function" },
  { name: "merge", defKind: "function" },
];

const P2_SYMBOLS: string[] = [
  "Route",
  "Layer",
  "View",
  "createApplication",
  "compileETag",
  "compileQueryParser",
  "compileTrust",
  "acceptParams",
  "deprecate",
  "merge",
];

const P4_FILES: string[] = [
  "lib/express.js",
  "lib/application.js",
  "lib/router/index.js",
  "lib/request.js",
  "lib/response.js",
];

export function generateExpressTasks(rootPath: string): Task[] {
  if (!existsSync(rootPath)) {
    throw new Error(`Express checkout missing: ${rootPath}`);
  }
  const tasks: Task[] = [];

  // ───── P1 ─────
  for (let i = 0; i < P1_SYMBOLS.length; i++) {
    const { name, defKind } = P1_SYMBOLS[i];
    const loc = findDefinition(rootPath, name, defKind);
    tasks.push({
      id: `ex-p1-${pad(i + 1)}`,
      category: "P1",
      dataset: "express",
      query: name,
      expected: { kind: "locations", locations: loc ? [loc] : [] },
    });
  }

  // ───── P2 ─────
  for (let i = 0; i < P2_SYMBOLS.length; i++) {
    const name = P2_SYMBOLS[i];
    const refs = findReferences(rootPath, name);
    tasks.push({
      id: `ex-p2-${pad(i + 1)}`,
      category: "P2",
      dataset: "express",
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
    importers = findImporters(rootPath, file);
    tasks.push({
      id: `ex-p4-${pad(i + 1)}`,
      category: "P4",
      dataset: "express",
      query: file,
      expected: { kind: "deps", imports, importers },
    });
  }

  // ───── P5 ─────
  // Express doesn't actually have many true orphans — most exports are
  // public API. We assert sverklo's audit shouldn't return well-known
  // public symbols. We score loosely: any of these names appearing in
  // a baseline's "dead code" output is a false positive.
  // For ground truth we use an empty set of true orphans. This means
  // recall is undefined (=1 by convention) and precision punishes
  // hallucinated dead code.
  for (let i = 0; i < 5; i++) {
    tasks.push({
      id: `ex-p5-${pad(i + 1)}`,
      category: "P5",
      dataset: "express",
      query: "",
      expected: { kind: "names", names: [] },
    });
  }

  return tasks;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function findDefinition(root: string, name: string, kind: string): Location | null {
  const escaped = escapeRe(name);
  // Try multiple definition shapes common in Express's commonjs codebase:
  //   function NAME(   |   exports.NAME = function   |   var NAME =
  //   module.exports = function NAME
  const patterns = [
    `^\\s*function\\s+${escaped}\\s*\\(`,
    `^\\s*exports\\.${escaped}\\s*=`,
    `^\\s*module\\.exports\\s*=\\s*function\\s+${escaped}\\b`,
    `^\\s*module\\.exports\\.${escaped}\\s*=`,
    `^\\s*var\\s+${escaped}\\s*=\\s*function`,
    `^\\s*${escaped}\\s*:\\s*function`,
  ];
  for (const pat of patterns) {
    const out = grep(root, pat, ["lib", "index.js"]);
    if (out.length > 0) return out[0];
  }
  return null;
}

function findReferences(root: string, name: string): Location[] {
  // word-grep, then drop lines that look like the *definition* itself
  const out = grep(root, `\\b${escapeRe(name)}\\b`, ["lib", "index.js"]);
  const defRe = new RegExp(
    `(function\\s+${escapeRe(name)}\\b|exports\\.${escapeRe(name)}\\s*=|var\\s+${escapeRe(name)}\\s*=)`
  );
  return out.filter((h) => !defRe.test(h.snippet ?? "")).map((h) => ({ file: h.file, line: h.line }));
}

function findImporters(root: string, file: string): string[] {
  // Express uses CommonJS — find require('relative/path') / require('./file')
  const base = file.replace(/\.(js|ts|mjs|cjs)$/, "");
  const baseName = base.split("/").pop()!;
  const out = new Set<string>();
  // grep the bare basename in require() statements
  try {
    const cmd = `grep -rln --include='*.js' --exclude-dir=node_modules --exclude-dir=test ${shellQuote(`require.*${baseName}`)} . 2>/dev/null || true`;
    const result = execSync(cmd, {
      cwd: root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash",
    });
    for (const line of result.split("\n")) {
      const p = line.replace(/^\.\//, "").trim();
      if (!p || p === file) continue;
      out.add(p);
    }
  } catch {}
  return [...out];
}

interface Hit { file: string; line: number; snippet?: string }
function grep(root: string, pattern: string, paths: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const p of paths) {
    const target = join(root, p);
    if (!existsSync(target)) continue;
    try {
      const out = execSync(
        `grep -rnE --include='*.js' --exclude-dir=node_modules ${shellQuote(pattern)} ${shellQuote(p)} 2>/dev/null || true`,
        { cwd: root, encoding: "utf-8", timeout: 30000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
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
function shellQuote(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
