#!/usr/bin/env node
// Tree-sitter vs regex parser parity check.
//
// Walks every TS/TSX/JS/PY/GO/RS file in the target repo (default: sverklo
// itself), parses each one with both code paths, and reports per-file diffs.
// The number you want to watch is `chunks_only_in_treesitter` minus
// `chunks_only_in_regex`: positive means tree-sitter is finding more
// real symbols than regex; negative means regex is winning. The goal of
// the v0.18 default-flip is to drive both numbers toward zero on every
// language we ship a grammar for.
//
// Usage:
//   node scripts/parity-check.mjs                       # sverklo repo, all langs
//   node scripts/parity-check.mjs --repo /path/to/repo
//   node scripts/parity-check.mjs --lang typescript     # one language only
//   node scripts/parity-check.mjs --max 100             # quick smoke
//   node scripts/parity-check.mjs --json > parity.json  # machine-readable

import { readFileSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
};

const repo = resolve(flag("--repo") ?? resolve(fileURLToPath(import.meta.url), "..", ".."));
const onlyLang = flag("--lang");
const max = flag("--max") ? Number(flag("--max")) : Infinity;
const json = args.includes("--json");

// Map file extension → language id used by parseFile().
const EXT_LANG = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

// Treat these dirs as noise.
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "out", ".sverklo", "benchmark"]);

function* walk(dir) {
  const { readdirSync } = require("node:fs");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);

const { parseFile, parseFileAsync } = await import("../dist/src/indexer/parser.js");

// Make sure SVERKLO_PARSER=tree-sitter is honoured by parseFileAsync.
process.env.SVERKLO_PARSER = "tree-sitter";

const files = [];
for (const f of walk(repo)) {
  const ext = extname(f);
  const lang = EXT_LANG[ext];
  if (!lang) continue;
  if (onlyLang && lang !== onlyLang && !(onlyLang === "typescript" && lang === "tsx")) continue;
  files.push({ path: f, lang });
  if (files.length >= max) break;
}

const perFile = [];
const totals = { regex: 0, tree: 0, both: 0, onlyTree: 0, onlyRegex: 0 };
let tsParsed = 0;
let tsSkipped = 0;

for (const { path, lang } of files) {
  let content;
  try { content = readFileSync(path, "utf-8"); }
  catch { continue; }
  if (content.length > 200_000) continue; // skip huge generated files

  const r1 = parseFile(content, lang);
  const r2 = await parseFileAsync(content, lang);
  const tsAvailable = r2 !== r1; // best-effort signal: parseFileAsync should have used tree-sitter
  if (tsAvailable) tsParsed++; else tsSkipped++;

  const regexNames = new Set(r1.chunks.filter((c) => c.name).map((c) => `${c.type}:${c.name}`));
  const treeNames = new Set(r2.chunks.filter((c) => c.name).map((c) => `${c.type}:${c.name}`));

  let both = 0, onlyTree = 0, onlyRegex = 0;
  for (const n of regexNames) {
    if (treeNames.has(n)) both++; else onlyRegex++;
  }
  for (const n of treeNames) {
    if (!regexNames.has(n)) onlyTree++;
  }

  totals.regex += regexNames.size;
  totals.tree += treeNames.size;
  totals.both += both;
  totals.onlyTree += onlyTree;
  totals.onlyRegex += onlyRegex;

  if (onlyTree > 0 || onlyRegex > 0) {
    perFile.push({
      file: path.slice(repo.length + 1),
      lang,
      regex_chunks: regexNames.size,
      tree_chunks: treeNames.size,
      only_in_regex: [...regexNames].filter((n) => !treeNames.has(n)).slice(0, 5),
      only_in_tree: [...treeNames].filter((n) => !regexNames.has(n)).slice(0, 5),
    });
  }
}

const summary = {
  repo,
  files_scanned: files.length,
  parser_active: { tree_sitter_used: tsParsed, regex_fallback: tsSkipped },
  chunks: { ...totals, jaccard: totals.both / Math.max(1, totals.regex + totals.onlyTree) },
};

if (json) {
  console.log(JSON.stringify({ summary, divergences: perFile.slice(0, 50) }, null, 2));
  process.exit(0);
}

console.log(`\n# Parser parity report — ${repo}`);
console.log(``);
console.log(`Files scanned: ${summary.files_scanned}`);
console.log(`  tree-sitter active: ${summary.parser_active.tree_sitter_used}`);
console.log(`  regex fallback:     ${summary.parser_active.regex_fallback}`);
console.log(``);
console.log(`Symbols (named chunks) discovered:`);
console.log(`  regex parser:        ${summary.chunks.regex}`);
console.log(`  tree-sitter parser:  ${summary.chunks.tree}`);
console.log(`  intersection:        ${summary.chunks.both}`);
console.log(`  only in regex:       ${summary.chunks.onlyRegex}  (tree-sitter would miss these)`);
console.log(`  only in tree-sitter: ${summary.chunks.onlyTree}  (regex misses these)`);
console.log(`  jaccard agreement:   ${(summary.chunks.jaccard * 100).toFixed(1)}%`);
console.log(``);

if (perFile.length === 0) {
  console.log(`No divergences. Parsers agree on every scanned file.`);
} else {
  console.log(`## Top divergences (first 10)`);
  for (const f of perFile.slice(0, 10)) {
    console.log(`\n### ${f.file}  (${f.lang}, regex=${f.regex_chunks} tree=${f.tree_chunks})`);
    if (f.only_in_regex.length > 0) {
      console.log(`  only in regex:        ${f.only_in_regex.join(", ")}`);
    }
    if (f.only_in_tree.length > 0) {
      console.log(`  only in tree-sitter:  ${f.only_in_tree.join(", ")}`);
    }
  }
}
