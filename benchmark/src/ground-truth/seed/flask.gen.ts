/**
 * Flask ground-truth generator (Python web-framework dataset).
 *
 * `pallets/flask` 3.0.3 adds decorator-heavy Python web framework
 * coverage to the primitive bench. It complements requests by adding
 * Blueprint registration, class-based views, LocalProxy globals, and
 * dynamic route binding patterns that are common in Flask applications.
 *
 * Methodology mirrors requests.gen.ts:
 *
 *   P1 (definition lookup): 10 public symbols with hand-verified line
 *     numbers at Flask 3.0.3. Includes class definitions, helper
 *     functions, and the module-level LocalProxy assignment for
 *     `request`.
 *     Verification command:
 *       grep -nE "^def <name>\(|^class <name>\b" src/flask/<file>
 *     For `request`, verify the LocalProxy assignment with:
 *       grep -nE "^request\b" src/flask/globals.py
 *
 *   P2 (reference finding): the same 10 names, references resolved at
 *     run-time via grep against `src/flask/`.
 *
 *   P4 (file dependencies): 5 files spanning the top-level app object,
 *     Blueprint registration, request/response wrappers, Jinja2
 *     integration, and the Click CLI surface.
 *
 *   P5 (dead code): empty-expected pattern, same as requests.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Task, Location } from "../../types.ts";

// Hand-verified line numbers in src/flask/ for Flask 3.0.3.
// Verified 2026-05-11 against
// https://github.com/pallets/flask/tree/3.0.3. Re-run grep if the
// pinned ref changes.
const P1_DEFINITIONS: { name: string; file: string; line: number }[] = [
  { name: "Flask", file: "src/flask/app.py", line: 79 },
  { name: "Blueprint", file: "src/flask/blueprints.py", line: 18 },
  { name: "request", file: "src/flask/globals.py", line: 46 },
  { name: "jsonify", file: "src/flask/json/__init__.py", line: 138 },
  { name: "render_template", file: "src/flask/templating.py", line: 138 },
  { name: "redirect", file: "src/flask/helpers.py", line: 230 },
  { name: "url_for", file: "src/flask/helpers.py", line: 176 },
  { name: "abort", file: "src/flask/helpers.py", line: 254 },
  { name: "send_file", file: "src/flask/helpers.py", line: 388 },
  { name: "flash", file: "src/flask/helpers.py", line: 299 },
];

const P2_SYMBOLS: string[] = [
  "Flask",
  "Blueprint",
  "request",
  "jsonify",
  "render_template",
  "redirect",
  "url_for",
  "abort",
  "send_file",
  "flash",
];

// 5 files exercising different shapes of the Flask package.
const P4_FILES: string[] = [
  "src/flask/app.py",         // top-level application object and request dispatch
  "src/flask/blueprints.py",  // Blueprint facade and registration hooks
  "src/flask/wrappers.py",    // request/response classes
  "src/flask/templating.py",  // Jinja2 integration
  "src/flask/cli.py",         // Click CLI discovery and app loading
];

export function generateFlaskTasks(rootPath: string): Task[] {
  if (!existsSync(rootPath)) {
    throw new Error(`flask checkout missing: ${rootPath}`);
  }
  const tasks: Task[] = [];

  // P1
  for (let i = 0; i < P1_DEFINITIONS.length; i++) {
    const { name, file, line } = P1_DEFINITIONS[i];
    tasks.push({
      id: `fl-p1-${pad(i + 1)}`,
      category: "P1",
      dataset: "flask",
      query: name,
      expected: { kind: "locations", locations: [{ file, line }] },
    });
  }

  // P2
  for (let i = 0; i < P2_SYMBOLS.length; i++) {
    const name = P2_SYMBOLS[i];
    const refs = findReferencesInFlask(rootPath, name);
    tasks.push({
      id: `fl-p2-${pad(i + 1)}`,
      category: "P2",
      dataset: "flask",
      query: name,
      expected: { kind: "locations", locations: refs },
    });
  }

  // P4
  for (let i = 0; i < P4_FILES.length; i++) {
    const file = P4_FILES[i];
    const abs = join(rootPath, file);
    let imports: string[] = [];
    let importers: string[] = [];
    try {
      const content = readFileSync(abs, "utf-8");
      imports = extractPythonImports(content, file);
    } catch {}
    importers = findImportersInFlask(rootPath, file);
    tasks.push({
      id: `fl-p4-${pad(i + 1)}`,
      category: "P4",
      dataset: "flask",
      query: file,
      expected: { kind: "deps", imports, importers },
    });
  }

  // P5
  for (let i = 0; i < 5; i++) {
    tasks.push({
      id: `fl-p5-${pad(i + 1)}`,
      category: "P5",
      dataset: "flask",
      query: "",
      expected: { kind: "names", names: [] },
    });
  }

  return tasks;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function extractPythonImports(content: string, file: string): string[] {
  const out = new Set<string>();
  const fileDir = file.replace(/\/[^/]+$/, "");
  const re = /^from\s+(\.[\w.]*)\s+import/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    const dotted = m[1];
    if (dotted === ".") continue;
    const rel = dotted.slice(1).replace(/\./g, "/");
    if (!rel) continue;
    const resolved = `${fileDir}/${rel}.py`;
    out.add(resolved);
  }
  return [...out];
}

function findReferencesInFlask(root: string, name: string): Location[] {
  const out = grep(root, `\\b${escapeRe(name)}\\b`, ["src/flask"]);
  const defRe = new RegExp(
    `^\\s*(def|class)\\s+${escapeRe(name)}\\b|^\\s*${escapeRe(name)}\\s*:`,
  );
  return out
    .filter((h) => !defRe.test(h.snippet ?? ""))
    .map((h) => ({ file: h.file, line: h.line }));
}

function findImportersInFlask(root: string, file: string): string[] {
  const baseName = file.replace(/^.*\//, "").replace(/\.py$/, "");
  if (!baseName) return [];
  const out = new Set<string>();
  try {
    const cmd = `grep -rln --include='*.py' --exclude-dir=__pycache__ ${shellQuote(`from \\.\\.\\?${baseName} import\\|from \\.\\.\\?[a-zA-Z_]\\+\\.${baseName} import`)} src/flask/ 2>/dev/null || true`;
    const result = execSync(cmd, {
      cwd: root,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
      shell: "/bin/bash",
    });
    for (const line of result.split("\n")) {
      const p = line.trim();
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
        `grep -rnE --include='*.py' --exclude-dir=__pycache__ ${shellQuote(pattern)} ${shellQuote(p)} 2>/dev/null || true`,
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
