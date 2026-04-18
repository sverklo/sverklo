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
  | "import";

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
};

export function detectLanguage(filePath: string): string | null {
  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  for (const [lang, exts] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (exts.includes(ext)) return lang;
  }
  return null;
}
