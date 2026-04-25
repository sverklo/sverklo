export interface ProjectConfig {
  rootPath: string;
  name: string;
  dataDir: string;
  dbPath: string;
}

export interface FileRecord {
  id: number;
  path: string;
  language: string | null;
  hash: string;
  last_modified: number;
  size_bytes: number;
  pagerank: number;
  indexed_at: number;
}

export type ChunkType =
  | "function"
  | "class"
  | "method"
  | "type"
  | "interface"
  | "module"
  | "block"
  | "variable"
  | "import"
  | "doc_section"
  | "doc_code";

// ── Evidence envelope (v0.13, P0-3) ──────────────────────────────────
//
// Every search-family tool response carries provenance: the concrete spans
// that were retrieved, pinned to a commit SHA + content hash. sverklo_verify
// reads these back and reports whether they still match.
export type RetrievalMethod =
  | "fts"
  | "vector"
  | "symbol"
  | "refs"
  | "pagerank"
  | "graph-expand"
  | "doc-edge"
  | "lookup"
  | "audit"
  | "investigate"
  | "ast-grep";

export interface Evidence {
  id: string;                 // "ev_" + 12 hex chars
  file: string;
  lines: [number, number];
  sha: string | null;         // repo HEAD sha at creation, null if no git
  chunk_id?: number;
  symbol?: string;
  method: RetrievalMethod;
  score: number;
}

export type VerifyStatus =
  | "unchanged"
  | "moved"
  | "modified"
  | "deleted"
  | "file_missing";

export interface VerifyResult {
  id: string;
  status: VerifyStatus;
  file?: string;
  current_lines?: [number, number];
  similarity?: number;        // 0..1 for modified / moved
  note?: string;
}

export interface CodeChunk {
  id: number;
  file_id: number;
  type: ChunkType;
  name: string | null;
  signature: string | null;
  start_line: number;
  end_line: number;
  content: string;
  description: string | null;
  token_count: number;
  /** v0.15 P1-12: optional LLM-generated one-liner. Stored prefixed with
   * a content-hash marker so re-runs can detect staleness cheaply. */
  purpose?: string | null;
}

export interface SearchResult {
  chunk: CodeChunk;
  file: FileRecord;
  score: number;
}

export interface DependencyEdge {
  source_file_id: number;
  target_file_id: number;
  reference_count: number;
}

export type MemoryCategory = "decision" | "preference" | "pattern" | "context" | "todo" | "procedural";
export type MemoryTier = "core" | "archive";
// Cognitive-science framing borrowed from Sprint 9 research (Akshay thread).
// Orthogonal to `tier` (which is a salience axis):
//   episodic   — a specific event/decision tied to a moment ("we picked X on Y")
//   semantic   — a general fact/rule that doesn't decay with time ("X is faster than Y")
//   procedural — a how-to or recipe ("steps to deploy")
export type MemoryKind = "episodic" | "semantic" | "procedural";

export interface Memory {
  id: number;
  category: MemoryCategory;
  content: string;
  tags: string | null;
  confidence: number;
  git_sha: string | null;
  git_branch: string | null;
  related_files: string | null;
  created_at: number;
  updated_at: number;
  last_accessed: number;
  access_count: number;
  is_stale: number;
  // Bi-temporal fields
  tier: MemoryTier;
  valid_from_sha: string | null;
  valid_until_sha: string | null;
  invalidated_at: number | null;
  superseded_by: number | null;
  pins: string | null;
  kind: MemoryKind;
}

export interface IndexStatus {
  projectName: string;
  rootPath: string;
  fileCount: number;
  chunkCount: number;
  languages: string[];
  lastIndexedAt: number | null;
  indexing: boolean;
  progress?: { done: number; total: number };
}

export interface ParsedChunk {
  type: ChunkType;
  name: string | null;
  signature: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ParseResult {
  chunks: ParsedChunk[];
  imports: ImportRef[];
}

export interface ImportRef {
  source: string; // the import path/module
  names: string[]; // imported symbols
  isRelative: boolean;
}

export const SUPPORTED_LANGUAGES: Record<string, string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py", ".pyi"],
  go: [".go"],
  rust: [".rs"],
  java: [".java"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
  ruby: [".rb"],
  php: [".php"],
  kotlin: [".kt", ".kts"],
  scala: [".scala", ".sc"],
  swift: [".swift"],
  dart: [".dart"],
  elixir: [".ex", ".exs"],
  lua: [".lua"],
  zig: [".zig"],
  haskell: [".hs", ".lhs"],
  clojure: [".clj", ".cljs", ".cljc", ".edn"],
  ocaml: [".ml", ".mli"],
  markdown: [".md", ".markdown", ".mdx"],
  notebook: [".ipynb"],
};

export function detectLanguage(filePath: string): string | null {
  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  for (const [lang, exts] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (exts.includes(ext)) return lang;
  }
  return null;
}
