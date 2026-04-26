// Tree-sitter grammar auto-fetch.
//
// `sverklo grammars install` lands the WASM blobs the v0.17 opt-in
// parser needs into ~/.sverklo/grammars/. Sources are pinned to known-
// good versions of the official tree-sitter-* npm packages on jsdelivr
// (mirrors npm; supports CORS; file:hash addressable). Bundling the
// WASMs in the npm tarball would push it past 8MB, so we fetch on
// demand instead — once per machine, cached forever.

import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface GrammarSpec {
  /** Language id used by parser-tree-sitter.LANG_MAP. */
  lang: string;
  /** WASM filename to write into ~/.sverklo/grammars/. */
  wasm: string;
  /** Direct URL — pinned to a known-good version. */
  url: string;
}

// Update these pins together with parser-tree-sitter.ts. Keep the
// version stable across releases so existing user installs don't
// invalidate caches when sverklo updates. Tested URLs as of 2026-04.
export const GRAMMARS: GrammarSpec[] = [
  {
    lang: "typescript",
    wasm: "tree-sitter-typescript.wasm",
    url: "https://cdn.jsdelivr.net/npm/tree-sitter-typescript@0.23.2/tree-sitter-typescript.wasm",
  },
  {
    lang: "tsx",
    wasm: "tree-sitter-tsx.wasm",
    url: "https://cdn.jsdelivr.net/npm/tree-sitter-typescript@0.23.2/tree-sitter-tsx.wasm",
  },
  {
    lang: "javascript",
    wasm: "tree-sitter-javascript.wasm",
    url: "https://cdn.jsdelivr.net/npm/tree-sitter-javascript@0.23.1/tree-sitter-javascript.wasm",
  },
  {
    lang: "python",
    wasm: "tree-sitter-python.wasm",
    url: "https://cdn.jsdelivr.net/npm/tree-sitter-python@0.23.6/tree-sitter-python.wasm",
  },
  {
    lang: "go",
    wasm: "tree-sitter-go.wasm",
    url: "https://cdn.jsdelivr.net/npm/tree-sitter-go@0.23.4/tree-sitter-go.wasm",
  },
  {
    lang: "rust",
    wasm: "tree-sitter-rust.wasm",
    url: "https://cdn.jsdelivr.net/npm/tree-sitter-rust@0.23.2/tree-sitter-rust.wasm",
  },
];

export function grammarsDir(): string {
  return join(homedir(), ".sverklo", "grammars");
}

export interface InstallResult {
  lang: string;
  path: string;
  /** "fresh" = downloaded, "cached" = already present, "skipped" = filtered out. */
  status: "fresh" | "cached" | "skipped" | "error";
  bytes?: number;
  error?: string;
}

/**
 * Install (or re-verify) the requested grammar set. When `langs` is
 * empty, installs everything in GRAMMARS. Existing files are left
 * alone unless `force` is set.
 */
export async function installGrammars(opts: {
  langs?: string[];
  force?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<InstallResult[]> {
  const dir = grammarsDir();
  mkdirSync(dir, { recursive: true });

  const targets = opts.langs && opts.langs.length > 0
    ? GRAMMARS.filter((g) => opts.langs!.includes(g.lang))
    : GRAMMARS;

  if (targets.length === 0) {
    return GRAMMARS.map((g) => ({
      lang: g.lang,
      path: join(dir, g.wasm),
      status: "skipped" as const,
    }));
  }

  const results: InstallResult[] = [];
  for (const g of targets) {
    const out = join(dir, g.wasm);
    if (!opts.force && existsSync(out) && statSync(out).size > 1024) {
      results.push({ lang: g.lang, path: out, status: "cached", bytes: statSync(out).size });
      opts.onProgress?.(`  cached  ${g.lang}  (${out})`);
      continue;
    }
    try {
      opts.onProgress?.(`  fetch   ${g.lang}  ← ${g.url}`);
      const r = await fetch(g.url);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      const buf = Buffer.from(await r.arrayBuffer());
      // Validate the response is a real WASM blob — magic header is
      // 0x00 0x61 0x73 0x6d. CDN errors come back as HTML; without
      // this guard we'd happily write a 404 page as a "grammar."
      if (buf.length < 1024 || buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) {
        throw new Error(`response is not a valid WASM blob (${buf.length} bytes)`);
      }
      writeFileSync(out, buf);
      results.push({ lang: g.lang, path: out, status: "fresh", bytes: buf.length });
      opts.onProgress?.(`  ok      ${g.lang}  → ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      const e = err as { message?: string };
      results.push({
        lang: g.lang,
        path: out,
        status: "error",
        error: e.message ?? String(err),
      });
      opts.onProgress?.(`  ✗ ${g.lang}: ${e.message ?? String(err)}`);
    }
  }
  return results;
}
