// Sprint 9 follow-up: memory exporter. Closes the "memory is a private
// journal, not a knowledge graph" gap from Bravo-2's product teardown
// by giving every team a clean migration path to wherever their
// decision-log lives — Notion, Linear, Confluence, or just markdown.
//
// Three formats:
//
//   markdown  — one .md file per category, suitable for committing
//               alongside the code or pasting into Confluence.
//   notion    — line-delimited JSON of Notion API page-create payloads.
//               The user provides --notion-database and --notion-token,
//               then either pipes the JSON into their own integration
//               or runs the bundled `tools/notion-import.mjs`. We do
//               NOT call the Notion API directly — that requires a
//               long-lived token sverklo has no business managing.
//   json      — raw row dump for any other downstream pipeline.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Indexer } from "../indexer/indexer.js";
import type { Memory, MemoryCategory } from "../types/index.js";

export interface ExportOptions {
  format: "markdown" | "notion" | "json";
  /** Output path. For markdown: directory. For json/notion: file. */
  to: string;
  /** Limit by kind (episodic/semantic/procedural). Optional. */
  kind?: "episodic" | "semantic" | "procedural";
  /** Include invalidated rows (the bi-temporal timeline). Default false. */
  includeInvalidated?: boolean;
  /** Notion-only: target database id. Required for format=notion. */
  notionDatabase?: string;
}

export interface ExportReport {
  format: ExportOptions["format"];
  written: string[];
  rowsExported: number;
  byCategory: Record<string, number>;
}

const CATEGORY_HEADINGS: Record<MemoryCategory, string> = {
  decision: "Decisions",
  preference: "Preferences",
  pattern: "Patterns",
  context: "Context",
  todo: "Open todos",
  procedural: "Procedures",
};

export function runMemoryExport(
  indexer: Indexer,
  opts: ExportOptions
): ExportReport {
  const rows = opts.includeInvalidated
    ? indexer.memoryStore.getTimeline(10_000)
    : indexer.memoryStore.getAll(10_000);

  const filtered = opts.kind
    ? rows.filter((m) => m.kind === opts.kind)
    : rows;

  const byCategory: Record<string, number> = {};
  for (const m of filtered) {
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  }

  const report: ExportReport = {
    format: opts.format,
    written: [],
    rowsExported: filtered.length,
    byCategory,
  };

  if (opts.format === "markdown") {
    report.written = writeMarkdown(filtered, opts.to);
  } else if (opts.format === "json") {
    report.written = [writeJson(filtered, opts.to)];
  } else if (opts.format === "notion") {
    if (!opts.notionDatabase) {
      throw new Error("--notion-database is required for format=notion");
    }
    report.written = [writeNotion(filtered, opts.to, opts.notionDatabase)];
  }

  return report;
}

function writeMarkdown(rows: Memory[], outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const grouped = new Map<MemoryCategory, Memory[]>();
  for (const m of rows) {
    const list = grouped.get(m.category) ?? [];
    list.push(m);
    grouped.set(m.category, list);
  }
  const written: string[] = [];
  for (const [category, list] of grouped) {
    const heading = CATEGORY_HEADINGS[category] ?? category;
    const fileName = `${category}.md`;
    const filePath = join(outDir, fileName);
    const parts: string[] = [
      `# ${heading}`,
      "",
      `_${list.length} memor${list.length === 1 ? "y" : "ies"} from sverklo. Exported ${new Date().toISOString().slice(0, 10)}._`,
      "",
    ];
    for (const m of list) {
      parts.push(`## #${m.id} · ${m.kind}${m.tier === "core" ? " · core" : ""}`);
      parts.push("");
      parts.push(m.content);
      parts.push("");
      const meta: string[] = [];
      if (m.tags) {
        try {
          const tags = JSON.parse(m.tags) as string[];
          if (tags.length > 0) meta.push(`**tags:** ${tags.join(", ")}`);
        } catch { /* malformed tags column — skip */ }
      }
      if (m.git_branch && m.git_sha) {
        meta.push(`**git:** \`${m.git_branch}@${m.git_sha.slice(0, 7)}\``);
      }
      meta.push(`**confidence:** ${m.confidence}`);
      meta.push(`**created:** ${new Date(m.created_at).toISOString().slice(0, 10)}`);
      if (m.valid_until_sha) {
        meta.push(`**superseded at:** \`${m.valid_until_sha.slice(0, 7)}\` by \`#${m.superseded_by ?? "?"}\``);
      }
      parts.push(meta.join(" · "));
      parts.push("");
      parts.push("---");
      parts.push("");
    }
    writeFileSync(filePath, parts.join("\n"), "utf-8");
    written.push(filePath);
  }
  return written;
}

function writeJson(rows: Memory[], outFile: string): string {
  mkdirSync(dirname(outFile), { recursive: true });
  // Parse json-string columns into real arrays so consumers don't have
  // to double-parse.
  const hydrated = rows.map((m) => ({
    ...m,
    tags: m.tags ? safeParseJsonArray(m.tags) : null,
    related_files: m.related_files ? safeParseJsonArray(m.related_files) : null,
  }));
  writeFileSync(outFile, JSON.stringify(hydrated, null, 2) + "\n", "utf-8");
  return outFile;
}

function safeParseJsonArray(raw: string): string[] | null {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function writeNotion(rows: Memory[], outFile: string, databaseId: string): string {
  // Emit ND-JSON of Notion API page-create payloads. The user can either
  // pipe this into their own integration or run a bundled importer like:
  //   while read line; do
  //     curl -X POST https://api.notion.com/v1/pages \
  //       -H "Authorization: Bearer $NOTION_TOKEN" \
  //       -H "Notion-Version: 2022-06-28" \
  //       -H "Content-Type: application/json" \
  //       --data-raw "$line" >/dev/null
  //   done < memories.notion.ndjson
  mkdirSync(dirname(outFile), { recursive: true });
  const lines = rows.map((m) => {
    const payload = {
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: `#${m.id} · ${m.category}` } }] },
        Category: { select: { name: m.category } },
        Kind: { select: { name: m.kind } },
        Tier: { select: { name: m.tier } },
        Confidence: { number: m.confidence },
        Created: { date: { start: new Date(m.created_at).toISOString() } },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: m.content } }],
          },
        },
      ],
    };
    return JSON.stringify(payload);
  });
  writeFileSync(outFile, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf-8");
  return outFile;
}
