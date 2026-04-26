// Tree-sitter parser path — v0.17 opt-in, gated by SVERKLO_PARSER=tree-sitter.
//
// Why this exists: the regex parser in parser.ts is fast and dep-free
// but misses edge cases (CommonJS prototype methods, decorated classes,
// nested generators) that tree-sitter handles natively. We don't want
// to force every user onto a native / WASM dep, so this path is opt-in
// and falls back silently to regex when the runtime can't load
// `web-tree-sitter` or the requested grammar.
//
// Lifecycle:
//
//   1. parser.ts checks process.env.SVERKLO_PARSER
//   2. If "tree-sitter", calls `tryParseTreeSitter(content, language)`
//   3. We lazy-initialise the WASM runtime once per process (heavy)
//   4. We lazy-load the grammar WASM for the requested language (heavy
//      first time, cached afterwards)
//   5. If anything fails, return null and let the caller fall back
//
// Grammars live at ~/.sverklo/grammars/<language>.wasm — installed via
// `sverklo grammars install` (CLI scaffold pending). Without grammars
// the parser is a no-op and the regex path keeps working unchanged.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ParseResult, ParsedChunk, ImportRef, ChunkType } from "../types/index.js";

// Languages this path supports. Each entry maps to a WASM grammar file
// at ~/.sverklo/grammars/<wasm>. Adding a language is a 3-step change:
// (a) add an entry here, (b) add a query in QUERIES, (c) ship the WASM
// in the grammars install bundle.
const LANG_MAP: Record<string, { wasm: string; queryKey: string }> = {
  typescript: { wasm: "tree-sitter-typescript.wasm", queryKey: "typescript" },
  tsx:        { wasm: "tree-sitter-tsx.wasm",        queryKey: "typescript" },
  javascript: { wasm: "tree-sitter-javascript.wasm", queryKey: "javascript" },
  python:     { wasm: "tree-sitter-python.wasm",     queryKey: "python" },
  go:         { wasm: "tree-sitter-go.wasm",         queryKey: "go" },
  rust:       { wasm: "tree-sitter-rust.wasm",       queryKey: "rust" },
};

// Symbol-extraction queries per language family. The capture names map
// directly to ChunkType — `@function.name` produces a chunk of type
// `function` named after the matched identifier.
const QUERIES: Record<string, string> = {
  typescript: `
    (function_declaration name: (identifier) @function.name) @function.body
    (method_definition name: (property_identifier) @method.name) @method.body
    (class_declaration name: (type_identifier) @class.name) @class.body
    (interface_declaration name: (type_identifier) @interface.name) @interface.body
    (type_alias_declaration name: (type_identifier) @type.name) @type.body
  `,
  javascript: `
    (function_declaration name: (identifier) @function.name) @function.body
    (method_definition name: (property_identifier) @method.name) @method.body
    (class_declaration name: (identifier) @class.name) @class.body
  `,
  python: `
    (function_definition name: (identifier) @function.name) @function.body
    (class_definition name: (identifier) @class.name) @class.body
  `,
  go: `
    (function_declaration name: (identifier) @function.name) @function.body
    (method_declaration name: (field_identifier) @method.name) @method.body
    (type_declaration (type_spec name: (type_identifier) @type.name)) @type.body
  `,
  rust: `
    (function_item name: (identifier) @function.name) @function.body
    (impl_item type: (type_identifier) @impl.name) @impl.body
    (struct_item name: (type_identifier) @class.name) @class.body
    (trait_item name: (type_identifier) @interface.name) @interface.body
  `,
};

interface RuntimeHandle {
  Parser: new () => Parser;
  Language: { load(path: string): Promise<unknown> };
}

interface Parser {
  setLanguage(lang: unknown): void;
  parse(source: string): { rootNode: Node };
}

interface Node {
  startPosition: { row: number };
  endPosition: { row: number };
  text: string;
  type: string;
  children: Node[];
  childForFieldName(name: string): Node | null;
}

let runtime: RuntimeHandle | null = null;
let runtimeInitFailed = false;
const langCache = new Map<string, unknown>();

async function loadRuntime(): Promise<RuntimeHandle | null> {
  if (runtime) return runtime;
  if (runtimeInitFailed) return null;
  try {
    // Optional dep — npm install may not have pulled it. Use a string
    // identifier dynamic import via the resolver, then cast — keeps tsc
    // happy without @types/web-tree-sitter.
    const modName = "web-tree-sitter";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(modName).catch(() => null);
    if (!mod) {
      runtimeInitFailed = true;
      return null;
    }
    const TreeSitter = (mod.default ?? mod) as RuntimeHandle;
    // web-tree-sitter requires explicit init() before first use. Newer
    // versions auto-init; we cover both shapes.
    const initFn = (TreeSitter as unknown as { init?: () => Promise<void> }).init;
    if (typeof initFn === "function") {
      await initFn.call(TreeSitter);
    }
    runtime = TreeSitter;
    return runtime;
  } catch {
    runtimeInitFailed = true;
    return null;
  }
}

async function loadLanguage(language: string): Promise<unknown | null> {
  const entry = LANG_MAP[language];
  if (!entry) return null;
  if (langCache.has(language)) return langCache.get(language) ?? null;

  const grammarPath = join(homedir(), ".sverklo", "grammars", entry.wasm);
  if (!existsSync(grammarPath)) {
    return null;
  }
  const rt = await loadRuntime();
  if (!rt) return null;
  try {
    const lang = await rt.Language.load(grammarPath);
    langCache.set(language, lang);
    return lang;
  } catch {
    return null;
  }
}

/**
 * Parse via tree-sitter when the runtime + grammar are available.
 * Returns null when anything is missing — callers must fall back to
 * the regex parser. Async because grammar loading is async; cached so
 * subsequent calls for the same language are sync after the first hit.
 */
export async function tryParseTreeSitter(
  content: string,
  language: string
): Promise<ParseResult | null> {
  const rt = await loadRuntime();
  if (!rt) return null;

  const lang = await loadLanguage(language);
  if (!lang) return null;

  const entry = LANG_MAP[language];
  const querySrc = QUERIES[entry?.queryKey ?? ""];
  if (!querySrc) return null;

  try {
    const parser = new rt.Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    const chunks = walkSymbols(tree.rootNode, content);
    const imports = extractImports(tree.rootNode, language);
    return { chunks, imports };
  } catch {
    return null;
  }
}

// ── Symbol extraction (no Query API yet — manual walk) ────────────────────
// web-tree-sitter's Query API is the canonical way to do this; we keep
// the walk manual for now to avoid pulling in the .scm query files
// at runtime. Promote to Query API when the dep is mandatory.

const NODE_TO_CHUNK: Record<string, ChunkType> = {
  function_declaration: "function",
  method_definition: "method",
  method_declaration: "method",
  class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  function_definition: "function",
  class_definition: "class",
  function_item: "function",
  struct_item: "class",
  trait_item: "interface",
  impl_item: "class",
  type_declaration: "type",
};

function walkSymbols(root: Node, source: string): ParsedChunk[] {
  const out: ParsedChunk[] = [];
  const stack: Node[] = [root];
  const lines = source.split("\n");
  while (stack.length > 0) {
    const node = stack.pop()!;
    const chunkType = NODE_TO_CHUNK[node.type];
    if (chunkType) {
      const nameNode = node.childForFieldName("name");
      const name = nameNode?.text ?? null;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      out.push({
        type: chunkType,
        name,
        signature: lines[startLine - 1]?.trim().slice(0, 200) ?? null,
        startLine,
        endLine,
        content: node.text,
      });
    }
    for (const child of node.children) stack.push(child);
  }
  return out;
}

function extractImports(root: Node, _language: string): ImportRef[] {
  const out: ImportRef[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.type === "import_statement" ||
      node.type === "import_from_statement" ||
      node.type === "use_declaration"
    ) {
      const text = node.text;
      const m = /['"]([^'"]+)['"]/.exec(text) || /from\s+(\S+)/.exec(text);
      if (m) {
        out.push({
          source: m[1],
          names: [],
          isRelative: m[1].startsWith(".") || m[1].startsWith("/"),
        });
      }
    }
    for (const child of node.children) stack.push(child);
  }
  return out;
}
