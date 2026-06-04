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

export type ProveFormat = "text" | "markdown";

export interface ProveReportOptions {
  format?: ProveFormat;
  guided?: boolean;
  noWrite?: boolean;
}

interface ProveSummary {
  projectName: string;
  fileCount: number;
  chunkCount: number;
  symbolRefCount: number;
  languages: string[];
  files: FileRecord[];
  candidate: ProofCandidate | null;
  fallback: (CodeChunk & { filePath: string; pagerank: number }) | null;
  guided: boolean;
  noWrite: boolean;
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
  "benchmark/",
  "benchmarks/",
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

function buildSummary(
  indexer: ProveIndex,
  projectPath: string,
  options: ProveReportOptions = {},
): ProveSummary {
  return {
    projectName: basename(projectPath) || "this repo",
    fileCount: indexer.fileStore.count(),
    chunkCount: indexer.chunkStore.count(),
    symbolRefCount: indexer.symbolRefStore.count(),
    languages: indexer.fileStore.getLanguages().filter(Boolean).slice(0, 6),
    files: topFiles(indexer),
    candidate: chooseCandidate(indexer),
    fallback: fallbackSymbol(indexer),
    guided: options.guided ?? false,
    noWrite: options.noWrite ?? false,
  };
}

function agentPrompt(summary: ProveSummary): string {
  if (summary.candidate) {
    return `Use sverklo impact on ${summary.candidate.name} and tell me what would break if I changed its signature.`;
  }
  if (summary.fallback) {
    return `Use sverklo lookup on ${summary.fallback.name}, then use sverklo overview to explain where it fits in this repo.`;
  }
  return "Use sverklo overview to map this repo and tell me the 5 most important files.";
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function proofSelectionText(summary: ProveSummary): string {
  if (summary.candidate) {
    return (
      `Selected ${summary.candidate.name} because it has a non-test definition ` +
      `and callers across ${formatNumber(summary.candidate.distinctSourceFiles)} files.`
    );
  }
  if (summary.fallback) {
    return `No strong caller graph yet; selected ${summary.fallback.name} as the best named non-test symbol.`;
  }
  return "No strong caller graph or named symbol was found; start with overview before trusting an edit.";
}

function renderTextReport(summary: ProveSummary): string {
  const { projectName, files, languages, candidate } = summary;

  const lines: string[] = [];
  lines.push("sverklo prove - repo memory check");
  lines.push("");
  lines.push(`Repo: ${projectName}`);
  lines.push(
    `Indexed: ${formatNumber(summary.fileCount)} files, ${formatNumber(summary.chunkCount)} chunks, ${formatNumber(summary.symbolRefCount)} symbol references`,
  );
  if (languages.length > 0) lines.push(`Languages: ${languages.join(", ")}`);
  lines.push("");

  if (summary.noWrite) {
    lines.push("Trial mode:");
    lines.push("  no project files, MCP configs, or agent instruction files were written");
    lines.push("  model/index cache may still be stored under ~/.sverklo");
    lines.push("");
  }

  if (summary.guided) {
    lines.push("Guided proof selection:");
    lines.push(`  ${proofSelectionText(summary)}`);
    lines.push("");
  }

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
    lines.push(`  ${agentPrompt(summary)}`);
  } else {
    lines.push("Proof from your repo:");
    if (summary.fallback) {
      lines.push(
        `  I found ${summary.fallback.name} at ${summary.fallback.filePath}:${summary.fallback.start_line}, but not a strong caller graph yet.`,
      );
      lines.push("");
      lines.push("Ask your agent this:");
      lines.push(`  ${agentPrompt(summary)}`);
    } else {
      lines.push("  I found an index, but not enough named symbols to build a caller proof.");
      lines.push("");
      lines.push("Ask your agent this:");
      lines.push(`  ${agentPrompt(summary)}`);
    }
  }

  lines.push("");
  lines.push("If this exposed useful repo context, star Sverklo so other agent-heavy teams find it:");
  lines.push("  https://github.com/sverklo/sverklo");
  if (summary.noWrite) {
    lines.push("");
    lines.push("To wire this repo into your agent after the proof looks useful:");
    lines.push("  sverklo init --dry-run");
    lines.push("  sverklo init");
  }
  lines.push("");
  return lines.join("\n");
}

function renderMarkdownReport(summary: ProveSummary): string {
  const lines: string[] = [];
  lines.push(`# Sverklo repo-memory proof: ${summary.projectName}`);
  lines.push("");
  lines.push("Generated with `sverklo prove --markdown`.");
  lines.push("");
  lines.push("## Index");
  lines.push("");
  lines.push(`- Files: ${formatNumber(summary.fileCount)}`);
  lines.push(`- Chunks: ${formatNumber(summary.chunkCount)}`);
  lines.push(`- Symbol references: ${formatNumber(summary.symbolRefCount)}`);
  if (summary.languages.length > 0) {
    lines.push(`- Languages: ${summary.languages.map((language) => `\`${language}\``).join(", ")}`);
  }
  if (summary.noWrite) {
    lines.push("- Trial mode: no project files, MCP configs, or agent instruction files were written");
    lines.push("- Cache note: model/index data may still be stored under `~/.sverklo`");
  }
  lines.push("");

  if (summary.guided) {
    lines.push("## Why this proof");
    lines.push("");
    lines.push(proofSelectionText(summary));
    lines.push("");
  }

  if (summary.files.length > 0) {
    lines.push("## Central files");
    lines.push("");
    lines.push("| File | PageRank |");
    lines.push("| --- | ---: |");
    for (const file of summary.files) {
      lines.push(`| \`${markdownCell(file.path)}\` | ${file.pagerank.toFixed(4)} |`);
    }
    lines.push("");
  }

  lines.push("## Proof from this repo");
  lines.push("");
  if (summary.candidate) {
    const def = summary.candidate.definition;
    lines.push(`\`${summary.candidate.name}\` is defined at \`${def.filePath}:${def.start_line}\`.`);
    lines.push("");
    lines.push(
      `Sverklo found ${formatNumber(summary.candidate.refCount)} references across ${formatNumber(summary.candidate.distinctSourceFiles)} files.`,
    );
    lines.push("");
    lines.push("Sample callers:");
    lines.push("");
    for (const ref of summary.candidate.refs.slice(0, 5)) {
      const line = ref.ref_line ?? ref.start_line;
      const label = ref.chunk_name ? `${ref.chunk_type} ${ref.chunk_name}` : ref.chunk_type;
      lines.push(`- \`${ref.file_path}:${line}\` (${label})`);
    }
  } else if (summary.fallback) {
    lines.push(
      `Sverklo found \`${summary.fallback.name}\` at \`${summary.fallback.filePath}:${summary.fallback.start_line}\`, but not a strong caller graph yet.`,
    );
  } else {
    lines.push("Sverklo found an index, but not enough named symbols to build a caller proof.");
  }
  lines.push("");
  lines.push("## Prompt to paste into your coding agent");
  lines.push("");
  lines.push("```text");
  lines.push(agentPrompt(summary));
  lines.push("```");
  lines.push("");
  lines.push("If this exposed useful repo context, star Sverklo so other agent-heavy teams find it:");
  lines.push("");
  lines.push("https://github.com/sverklo/sverklo");
  lines.push("");
  return lines.join("\n");
}

export function buildProveReport(
  indexer: ProveIndex,
  projectPath: string,
  options: ProveReportOptions = {},
): string {
  const summary = buildSummary(indexer, projectPath, options);
  return options.format === "markdown" ? renderMarkdownReport(summary) : renderTextReport(summary);
}

export async function runProve(
  projectPath: string,
  options: ProveReportOptions = {},
): Promise<string> {
  const previousQuiet = process.env.SVERKLO_QUIET;
  if (options.format === "markdown") process.env.SVERKLO_QUIET = "1";

  try {
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
      return buildProveReport(indexer, projectPath, options);
    } finally {
      indexer.close();
    }
  } finally {
    if (previousQuiet === undefined) delete process.env.SVERKLO_QUIET;
    else process.env.SVERKLO_QUIET = previousQuiet;
  }
}
