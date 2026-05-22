#!/usr/bin/env node
// Static-syntax check for browser assets shipped under src/server/assets/.
//
// Background — 2026-05-22: the Tier-2.3 commit (43e8174, 2026-05-14)
// extracted dashboard.js out of a template literal in dashboard-html.ts
// without unwinding the doubled single-quote escapes. Result: the file
// had a literal SyntaxError on every parse, the entire dashboard rendered
// blank for 8 days, and no one noticed because (a) TypeScript build
// passes (the file is .js, not .ts), (b) the 652 vitest tests don't
// load it in a browser, (c) no one ran `sverklo ui .` in CI.
//
// This script gates that exact regression by piping every shipped .js
// asset through node's parser. `node --check` exits non-zero on
// SyntaxError. Cheap (<1s) and runs in the existing test job.
//
// Not in scope: ESLint-style lint, runtime correctness, CSS validation.
// Those would need an actual browser or jsdom; this is a pre-flight.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ASSETS_DIR = "src/server/assets";

const jsFiles = readdirSync(ASSETS_DIR)
  .filter((name) => name.endsWith(".js"))
  // d3 is a vendored library — ESM parse errors are upstream's problem,
  // and it's already minified so `node --check` would complain about
  // strict-mode-only syntax that runs fine in browsers.
  .filter((name) => name !== "d3.min.js");

if (jsFiles.length === 0) {
  console.log("[lint-assets] no .js files to check");
  process.exit(0);
}

let failed = 0;
for (const name of jsFiles) {
  const path = join(ASSETS_DIR, name);
  const result = spawnSync(process.execPath, ["--check", path], {
    encoding: "utf-8",
  });
  if (result.status === 0) {
    console.log(`[lint-assets] ✓ ${relative(process.cwd(), path)}`);
  } else {
    console.error(`[lint-assets] ✗ ${relative(process.cwd(), path)}`);
    if (result.stderr) process.stderr.write(result.stderr);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n[lint-assets] ${failed} file(s) failed syntax check.`);
  process.exit(1);
}

console.log(`\n[lint-assets] all ${jsFiles.length} file(s) parsed cleanly.`);
