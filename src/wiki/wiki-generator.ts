import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import type { Indexer } from "../indexer/indexer.js";
import type { FileRecord, CodeChunk } from "../types/index.js";

export interface WikiOptions {
  outputDir: string;
  format: "markdown" | "html";
  includeGraph?: boolean;
}

interface FileWithChunks {
  file: FileRecord;
  chunks: CodeChunk[];
}

interface ModuleInfo {
  dir: string;
  files: FileRecord[];
  hubFile: FileRecord | null;
}

/**
 * Generate a markdown wiki from the indexed codebase.
 * Entirely deterministic — no LLM calls. All data comes from
 * the Indexer's stores (files, chunks, graph, symbol refs, PageRank).
 */
export async function generateWiki(
  indexer: Indexer,
  options: WikiOptions
): Promise<void> {
  const { outputDir } = options;

  // Ensure output directories exist
  await mkdir(join(outputDir, "modules"), { recursive: true });
  await mkdir(join(outputDir, "files"), { recursive: true });

  // Load all data upfront
  const allFiles = indexer.fileStore.getAll(); // sorted by pagerank DESC
  const allEdges = indexer.graphStore.getAll();
  const allChunksWithFile = indexer.chunkStore.getAllWithFile();

  // Build lookup maps
  const fileById = new Map<number, FileRecord>();
  const fileByPath = new Map<string, FileRecord>();
  for (const f of allFiles) {
    fileById.set(f.id, f);
    fileByPath.set(f.path, f);
  }

  const chunksByFileId = new Map<number, CodeChunk[]>();
  for (const c of allChunksWithFile) {
    const list = chunksByFileId.get(c.file_id) || [];
    list.push(c);
    chunksByFileId.set(c.file_id, list);
  }

  // Build import/importer maps (file_id -> file_id[])
  const importsOf = new Map<number, Set<number>>();
  const importersOf = new Map<number, Set<number>>();
  for (const edge of allEdges) {
    if (!importsOf.has(edge.source_file_id))
      importsOf.set(edge.source_file_id, new Set());
    importsOf.get(edge.source_file_id)!.add(edge.target_file_id);

    if (!importersOf.has(edge.target_file_id))
      importersOf.set(edge.target_file_id, new Set());
    importersOf.get(edge.target_file_id)!.add(edge.source_file_id);
  }

  // Group files by top-level directory
  const modules = groupByModule(allFiles);

  // 1. Generate index.md
  const indexMd = generateIndexPage(
    indexer,
    allFiles,
    allEdges,
    modules,
    options
  );
  await writeFile(join(outputDir, "index.md"), indexMd, "utf-8");

  // 2. Generate per-module pages
  for (const mod of modules) {
    const moduleMd = generateModulePage(
      mod,
      chunksByFileId,
      importsOf,
      importersOf,
      fileById,
      modules
    );
    const safeName = mod.dir.replace(/\//g, "-") || "root";
    await writeFile(
      join(outputDir, "modules", `${safeName}.md`),
      moduleMd,
      "utf-8"
    );
  }

  // 3. Generate per-file pages for top 50 files by PageRank
  const top50 = allFiles.slice(0, 50);
  for (const file of top50) {
    const chunks = chunksByFileId.get(file.id) || [];
    const fileMd = generateFilePage(
      file,
      chunks,
      importsOf,
      importersOf,
      fileById,
      indexer
    );
    const safeName = file.path.replace(/\//g, "-").replace(/\./g, "_");
    await writeFile(
      join(outputDir, "files", `${safeName}.md`),
      fileMd,
      "utf-8"
    );
  }

  // Summary to stdout
  const totalPages = 1 + modules.length + top50.length;
  console.log(
    `Wiki generated: ${totalPages} pages in ${outputDir}/`
  );
  console.log(
    `  1 index + ${modules.length} modules + ${top50.length} file pages`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByModule(files: FileRecord[]): ModuleInfo[] {
  const groups = new Map<string, FileRecord[]>();
  for (const f of files) {
    const parts = f.path.split("/");
    const dir = parts.length > 1 ? parts[0] : "(root)";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(f);
  }

  const modules: ModuleInfo[] = [];
  for (const [dir, dirFiles] of groups) {
    // Files are already sorted by pagerank DESC from the store
    const hubFile = dirFiles.length > 0 ? dirFiles[0] : null;
    modules.push({ dir, files: dirFiles, hubFile });
  }

  // Sort modules by total PageRank descending
  modules.sort(
    (a, b) =>
      b.files.reduce((s, f) => s + f.pagerank, 0) -
      a.files.reduce((s, f) => s + f.pagerank, 0)
  );

  return modules;
}

function generateIndexPage(
  indexer: Indexer,
  allFiles: FileRecord[],
  allEdges: { source_file_id: number; target_file_id: number; reference_count: number }[],
  modules: ModuleInfo[],
  options: WikiOptions
): string {
  const status = indexer.getStatus();
  const lines: string[] = [];

  lines.push(`# ${status.projectName}`);
  lines.push("");
  lines.push(
    `> Auto-generated wiki from [sverklo](https://github.com/sverklo/sverklo) code index. ${allFiles.length} files indexed.`
  );
  lines.push("");

  // Language distribution
  lines.push("## Language Distribution");
  lines.push("");
  const langCounts = new Map<string, number>();
  for (const f of allFiles) {
    const lang = f.language || "unknown";
    langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
  }
  const sortedLangs = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [lang, count] of sortedLangs) {
    const pct = ((count / allFiles.length) * 100).toFixed(1);
    lines.push(`- **${lang}**: ${count} files (${pct}%)`);
  }
  lines.push("");

  // Top 10 most important files
  lines.push("## Key Files (by PageRank)");
  lines.push("");
  lines.push("| Rank | File | PageRank | Language |");
  lines.push("|------|------|----------|----------|");
  const top10 = allFiles.slice(0, 10);
  for (let i = 0; i < top10.length; i++) {
    const f = top10[i];
    const safeName = f.path.replace(/\//g, "-").replace(/\./g, "_");
    const link = `[${f.path}](files/${safeName}.md)`;
    lines.push(
      `| ${i + 1} | ${link} | ${f.pagerank.toFixed(4)} | ${f.language || "—"} |`
    );
  }
  lines.push("");

  // Dependency graph overview
  lines.push("## Dependency Graph");
  lines.push("");
  const totalEdges = allEdges.length;
  const filesWithImports = new Set(allEdges.map((e) => e.source_file_id)).size;
  const filesWithImporters = new Set(allEdges.map((e) => e.target_file_id)).size;
  const avgFanOut =
    filesWithImports > 0
      ? (totalEdges / filesWithImports).toFixed(1)
      : "0";
  const avgFanIn =
    filesWithImporters > 0
      ? (totalEdges / filesWithImporters).toFixed(1)
      : "0";

  lines.push(`- **Total edges**: ${totalEdges}`);
  lines.push(`- **Files with imports**: ${filesWithImports}`);
  lines.push(`- **Files with importers**: ${filesWithImporters}`);
  lines.push(`- **Average fan-out**: ${avgFanOut}`);
  lines.push(`- **Average fan-in**: ${avgFanIn}`);
  lines.push("");

  // Module listing
  lines.push("## Modules");
  lines.push("");
  for (const mod of modules) {
    const safeName = mod.dir.replace(/\//g, "-") || "root";
    const totalPR = mod.files.reduce((s, f) => s + f.pagerank, 0).toFixed(4);
    lines.push(
      `- [${mod.dir}](modules/${safeName}.md) — ${mod.files.length} files, total PageRank ${totalPR}`
    );
  }
  lines.push("");

  return lines.join("\n");
}

function generateModulePage(
  mod: ModuleInfo,
  chunksByFileId: Map<number, CodeChunk[]>,
  importsOf: Map<number, Set<number>>,
  importersOf: Map<number, Set<number>>,
  fileById: Map<number, FileRecord>,
  allModules: ModuleInfo[]
): string {
  const lines: string[] = [];

  lines.push(`# Module: ${mod.dir}`);
  lines.push("");
  lines.push(`${mod.files.length} files in this module.`);
  if (mod.hubFile) {
    lines.push(
      `Hub file (highest PageRank): **${mod.hubFile.path}** (${mod.hubFile.pagerank.toFixed(4)})`
    );
  }
  lines.push("");

  // File list with PageRank
  lines.push("## Files");
  lines.push("");
  lines.push("| File | PageRank | Language |");
  lines.push("|------|----------|----------|");
  for (const f of mod.files) {
    const safeName = f.path.replace(/\//g, "-").replace(/\./g, "_");
    const link = `[${basename(f.path)}](../files/${safeName}.md)`;
    lines.push(
      `| ${link} | ${f.pagerank.toFixed(4)} | ${f.language || "—"} |`
    );
  }
  lines.push("");

  // Key exports
  lines.push("## Key Exports");
  lines.push("");
  const exportTypes = new Set(["function", "class", "type", "interface", "variable"]);
  const exports: { name: string; type: string; file: string; signature: string | null }[] = [];
  for (const f of mod.files) {
    const chunks = chunksByFileId.get(f.id) || [];
    for (const c of chunks) {
      if (exportTypes.has(c.type) && c.name) {
        exports.push({
          name: c.name,
          type: c.type,
          file: f.path,
          signature: c.signature,
        });
      }
    }
  }

  if (exports.length > 0) {
    // Show up to 30 exports, sorted by type then name
    exports.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    const shown = exports.slice(0, 30);
    for (const ex of shown) {
      const sig = ex.signature ? `: \`${ex.signature}\`` : "";
      lines.push(`- **${ex.type}** \`${ex.name}\` in ${ex.file}${sig}`);
    }
    if (exports.length > 30) {
      lines.push(`- _...and ${exports.length - 30} more_`);
    }
  } else {
    lines.push("_No named exports found._");
  }
  lines.push("");

  // Internal dependencies
  const modFileIds = new Set(mod.files.map((f) => f.id));
  const internalEdges: { from: string; to: string }[] = [];
  for (const f of mod.files) {
    const targets = importsOf.get(f.id);
    if (!targets) continue;
    for (const tid of targets) {
      if (modFileIds.has(tid)) {
        const target = fileById.get(tid);
        if (target) {
          internalEdges.push({ from: f.path, to: target.path });
        }
      }
    }
  }

  lines.push("## Internal Dependencies");
  lines.push("");
  if (internalEdges.length > 0) {
    for (const edge of internalEdges.slice(0, 20)) {
      lines.push(`- ${edge.from} → ${edge.to}`);
    }
    if (internalEdges.length > 20) {
      lines.push(`- _...and ${internalEdges.length - 20} more_`);
    }
  } else {
    lines.push("_No internal dependencies._");
  }
  lines.push("");

  // External dependencies
  const externalImports = new Map<string, number>(); // module dir -> count
  const externalImporters = new Map<string, number>();

  for (const f of mod.files) {
    const targets = importsOf.get(f.id);
    if (targets) {
      for (const tid of targets) {
        if (!modFileIds.has(tid)) {
          const target = fileById.get(tid);
          if (target) {
            const tDir = target.path.split("/").length > 1 ? target.path.split("/")[0] : "(root)";
            externalImports.set(tDir, (externalImports.get(tDir) || 0) + 1);
          }
        }
      }
    }
    const sources = importersOf.get(f.id);
    if (sources) {
      for (const sid of sources) {
        if (!modFileIds.has(sid)) {
          const source = fileById.get(sid);
          if (source) {
            const sDir = source.path.split("/").length > 1 ? source.path.split("/")[0] : "(root)";
            externalImporters.set(sDir, (externalImporters.get(sDir) || 0) + 1);
          }
        }
      }
    }
  }

  lines.push("## External Dependencies");
  lines.push("");
  if (externalImports.size > 0 || externalImporters.size > 0) {
    if (externalImports.size > 0) {
      lines.push("**Imports from:**");
      for (const [dir, count] of [...externalImports.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`- ${dir} (${count} edges)`);
      }
      lines.push("");
    }
    if (externalImporters.size > 0) {
      lines.push("**Imported by:**");
      for (const [dir, count] of [...externalImporters.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`- ${dir} (${count} edges)`);
      }
      lines.push("");
    }
  } else {
    lines.push("_No external dependencies._");
    lines.push("");
  }

  return lines.join("\n");
}

function generateFilePage(
  file: FileRecord,
  chunks: CodeChunk[],
  importsOf: Map<number, Set<number>>,
  importersOf: Map<number, Set<number>>,
  fileById: Map<number, FileRecord>,
  indexer: Indexer
): string {
  const lines: string[] = [];

  lines.push(`# ${file.path}`);
  lines.push("");
  lines.push("| Property | Value |");
  lines.push("|----------|-------|");
  lines.push(`| **Language** | ${file.language || "unknown"} |`);
  lines.push(`| **PageRank** | ${file.pagerank.toFixed(4)} |`);
  lines.push(`| **Size** | ${formatBytes(file.size_bytes)} |`);
  lines.push("");

  // Exported symbols with signatures
  const exportTypes = new Set(["function", "class", "type", "interface", "method", "variable"]);
  const namedChunks = chunks.filter((c) => exportTypes.has(c.type) && c.name);

  if (namedChunks.length > 0) {
    lines.push("## Symbols");
    lines.push("");
    lines.push("| Symbol | Type | Lines | References |");
    lines.push("|--------|------|-------|------------|");
    for (const c of namedChunks) {
      const refCount = indexer.symbolRefStore.getCallerCount(c.name!);
      const lineRange = `${c.start_line}–${c.end_line}`;
      const sig = c.signature ? ` \`${c.signature}\`` : "";
      lines.push(
        `| **${c.name}**${sig} | ${c.type} | ${lineRange} | ${refCount} |`
      );
    }
    lines.push("");
  }

  // Imports (what this file depends on)
  const importTargets = importsOf.get(file.id);
  lines.push("## Imports");
  lines.push("");
  if (importTargets && importTargets.size > 0) {
    for (const tid of importTargets) {
      const target = fileById.get(tid);
      if (target) {
        const safeName = target.path.replace(/\//g, "-").replace(/\./g, "_");
        lines.push(`- [${target.path}](${safeName}.md)`);
      }
    }
  } else {
    lines.push("_No indexed imports._");
  }
  lines.push("");

  // Importers (who depends on this file)
  const importSources = importersOf.get(file.id);
  lines.push("## Imported By");
  lines.push("");
  if (importSources && importSources.size > 0) {
    for (const sid of importSources) {
      const source = fileById.get(sid);
      if (source) {
        const safeName = source.path.replace(/\//g, "-").replace(/\./g, "_");
        lines.push(`- [${source.path}](${safeName}.md)`);
      }
    }
  } else {
    lines.push("_No indexed importers._");
  }
  lines.push("");

  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
