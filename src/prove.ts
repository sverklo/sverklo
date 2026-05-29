import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { FileRecord, CodeChunk } from "./types/index.js";
import type { ImpactResult } from "./storage/symbol-ref-store.js";

type NamedChunk = CodeChunk & {
  filePath: string;
  pagerank: number;
  fileLanguage: string;
};

export interface ProveIndex {
  fileStore: {
    getAll(): FileRecord[];
    count(): number;
    getLanguages(): string[];
  };
  chunkStore: {
    count(): number;
    getByNameWithFile(namePattern: string, limit?: number): NamedChunk[];
    getAllWithFile(): (CodeChunk & { filePath: string; pagerank: number })[];
  };
  symbolRefStore: {
    count(): number;
    getGodNodeStats(excludeFileIds?: Set<number>): {
      target_name: string;
      ref_count: number;
      distinct_source_files: number;
    }[];
    getImpact(targetName: string, limit?: number): ImpactResult[];
  };
}

interface ProofCandidate {
  name: string;
  definition: NamedChunk;
  refs: ImpactResult[];
  refCount: number;
  distinctSourceFiles: number;
}

const NOISE_SEGMENTS = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".cache/",
  "__fixtures__/",
  "fixtures/",
  "vendor/",
  "benchmark/.cache/",
];

const TEST_RE = /(^|\/)(test|tests|__tests__|spec|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i;

const SYMBOL_DENY = new Set([
  "add",
  "all",
  "any",
  "app",
  "call",
  "close",
  "data",
  "done",
  "each",
  "emit",
  "end",
  "err",
  "get",
  "has",
  "id",
  "init",
  "key",
  "log",
  "main",
  "map",
  "new",
  "next",
  "off",
  "on",
  "open",
  "parse",
  "push",
  "read",
  "run",
  "set",
  "start",
  "test",
  "type",
  "use",
  "write",
]);

function isNoisePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (TEST_RE.test(normalized)) return true;
  return NOISE_SEGMENTS.some((segment) => normalized.includes(segment));
}

function isGoodSymbol(name: string | null): name is string {
  if (!name) return false;
  if (name.length < 4 || name.length > 80) return false;
  if (SYMBOL_DENY.has(name.toLowerCase())) return false;
  return /^[A-Za-z_$][A-Za-z0-9_$.:#-]*$/.test(name);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function topFiles(indexer: ProveIndex, limit = 5): FileRecord[] {
  return indexer.fileStore
    .getAll()
    .filter((file) => !isNoisePath(file.path))
    .sort((a, b) => b.pagerank - a.pagerank || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function chooseCandidate(indexer: ProveIndex): ProofCandidate | null {
  const excluded = new Set(
    indexer.fileStore
      .getAll()
      .filter((file) => isNoisePath(file.path))
      .map((file) => file.id),
  );

  const stats = indexer.symbolRefStore
    .getGodNodeStats(excluded)
    .filter((row) => isGoodSymbol(row.target_name))
    .sort(
      (a, b) =>
        b.distinct_source_files - a.distinct_source_files ||
        b.ref_count - a.ref_count ||
        a.target_name.localeCompare(b.target_name),
    );

  for (const row of stats.slice(0, 80)) {
    const definitions = indexer.chunkStore
      .getByNameWithFile(row.target_name, 20)
      .filter(
        (chunk) =>
          chunk.name === row.target_name &&
          !isNoisePath(chunk.filePath) &&
          ["function", "class", "method", "interface", "type"].includes(chunk.type),
      );
    if (definitions.length === 0) continue;

    const refs = indexer.symbolRefStore
      .getImpact(row.target_name, 30)
      .filter((ref) => !isNoisePath(ref.file_path));
    const distinctFiles = new Set(refs.map((ref) => ref.file_path));
    if (refs.length < 2 || distinctFiles.size < 2) continue;

    return {
      name: row.target_name,
      definition: definitions[0],
      refs,
      refCount: row.ref_count,
      distinctSourceFiles: row.distinct_source_files,
    };
  }

  return null;
}

function fallbackSymbol(indexer: ProveIndex): (CodeChunk & { filePath: string; pagerank: number }) | null {
  return (
    indexer.chunkStore
      .getAllWithFile()
      .find(
        (chunk) =>
          isGoodSymbol(chunk.name) &&
          !isNoisePath(chunk.filePath) &&
          ["function", "class", "method", "interface", "type"].includes(chunk.type),
      ) ?? null
  );
}

export function buildProveReport(indexer: ProveIndex, projectPath: string): string {
  const projectName = basename(projectPath) || "this repo";
  const files = topFiles(indexer);
  const languages = indexer.fileStore.getLanguages().filter(Boolean).slice(0, 6);
  const candidate = chooseCandidate(indexer);

  const lines: string[] = [];
  lines.push("sverklo prove - repo memory check");
  lines.push("");
  lines.push(`Repo: ${projectName}`);
  lines.push(`Indexed: ${formatNumber(indexer.fileStore.count())} files, ${formatNumber(indexer.chunkStore.count())} chunks, ${formatNumber(indexer.symbolRefStore.count())} symbol references`);
  if (languages.length > 0) lines.push(`Languages: ${languages.join(", ")}`);
  lines.push("");

  if (files.length > 0) {
    lines.push("Most central files by dependency PageRank:");
    for (const file of files) {
      const score = file.pagerank.toFixed(4);
      lines.push(`  - ${file.path} (${score})`);
    }
    lines.push("");
  }

  if (candidate) {
    const def = candidate.definition;
    const refs = candidate.refs.slice(0, 5);
    lines.push("Proof from your repo:");
    lines.push(`  ${candidate.name}`);
    lines.push(`  defined at ${def.filePath}:${def.start_line}`);
    lines.push(
      `  referenced ${formatNumber(candidate.refCount)} times across ${formatNumber(candidate.distinctSourceFiles)} files`,
    );
    lines.push("");
    lines.push("Sample callers:");
    for (const ref of refs) {
      const line = ref.ref_line ?? ref.start_line;
      const label = ref.chunk_name ? `${ref.chunk_type} ${ref.chunk_name}` : ref.chunk_type;
      lines.push(`  - ${ref.file_path}:${line} (${label})`);
    }
    lines.push("");
    lines.push("Ask your agent this:");
    lines.push(`  Use sverklo impact on ${candidate.name} and tell me what would break if I changed its signature.`);
  } else {
    const fallback = fallbackSymbol(indexer);
    lines.push("Proof from your repo:");
    if (fallback) {
      lines.push(`  I found ${fallback.name} at ${fallback.filePath}:${fallback.start_line}, but not a strong caller graph yet.`);
      lines.push("");
      lines.push("Ask your agent this:");
      lines.push(`  Use sverklo lookup on ${fallback.name}, then use sverklo overview to explain where it fits in this repo.`);
    } else {
      lines.push("  I found an index, but not enough named symbols to build a caller proof.");
      lines.push("");
      lines.push("Ask your agent this:");
      lines.push("  Use sverklo overview to map this repo and tell me the 5 most important files.");
    }
  }

  lines.push("");
  lines.push("If this exposed useful repo context, star Sverklo so other agent-heavy teams find it:");
  lines.push("  https://github.com/sverklo/sverklo");
  lines.push("");
  return lines.join("\n");
}

export async function runProve(projectPath: string): Promise<string> {
  const modelDir = join(homedir(), ".sverklo", "models");
  if (!existsSync(join(modelDir, "model.onnx")) || !existsSync(join(modelDir, "tokenizer.json"))) {
    const { setupModels } = await import("./indexer/setup.js");
    await setupModels();
  }

  const { getProjectConfig } = await import("./utils/config.js");
  const { Indexer } = await import("./indexer/indexer.js");
  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  try {
    await indexer.index();
    return buildProveReport(indexer, projectPath);
  } finally {
    indexer.close();
  }
}
