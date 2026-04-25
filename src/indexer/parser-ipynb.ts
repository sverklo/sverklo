import type { ParsedChunk, ParseResult } from "../types/index.js";
import { parseMarkdown } from "./parser-md.js";

// Parse a Jupyter notebook (.ipynb) as structured chunks.
//
// .ipynb is JSON; we treat each cell as its own chunk:
//   - markdown cells → reuse parseMarkdown so headings still produce
//     doc_section breadcrumbs.
//   - code cells → emit as `block` chunks (the language is whatever the
//     notebook's metadata says, defaulting to python).
//
// We deliberately don't parse code cells with the language-specific
// tree-sitter-style helpers — symbol-level chunking inside a notebook
// rarely matches what a user wants searched, and the cell-level grain is
// the right one for retrieval. No vision / no image extraction.

interface IpynbCell {
  cell_type?: string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
}

interface IpynbDocument {
  cells?: IpynbCell[];
  metadata?: {
    kernelspec?: { language?: string };
    language_info?: { name?: string };
  };
}

export function parseIpynb(content: string, _lines: string[]): ParseResult {
  let doc: IpynbDocument;
  try {
    doc = JSON.parse(content) as IpynbDocument;
  } catch {
    // Malformed notebook — emit a single fallback chunk so the file is
    // still searchable by raw content.
    return {
      chunks: [
        {
          type: "block",
          name: "ipynb",
          signature: null,
          startLine: 1,
          endLine: content.split("\n").length,
          content,
        },
      ],
      imports: [],
    };
  }

  const cells = Array.isArray(doc.cells) ? doc.cells : [];
  const lang =
    doc.metadata?.language_info?.name ??
    doc.metadata?.kernelspec?.language ??
    "python";

  const chunks: ParsedChunk[] = [];
  let runningLine = 1;
  let cellIndex = 0;

  for (const cell of cells) {
    const source = cellSource(cell);
    if (!source) {
      cellIndex++;
      continue;
    }
    const cellLines = source.split("\n");
    const startLine = runningLine;
    const endLine = runningLine + cellLines.length - 1;

    if (cell.cell_type === "markdown") {
      // Reuse the markdown parser — it produces doc_section / doc_code
      // chunks with breadcrumbs. Re-base its line numbers to this cell's
      // position in the synthetic line stream.
      const md = parseMarkdown(source, cellLines);
      for (const c of md.chunks) {
        chunks.push({
          ...c,
          startLine: c.startLine + startLine - 1,
          endLine: c.endLine + startLine - 1,
        });
      }
    } else {
      // Treat raw + code cells uniformly as `block` chunks named after
      // their position. The cell type appears in the description so the
      // describer can produce useful embeddings.
      const isCode = cell.cell_type === "code";
      chunks.push({
        type: "block",
        name: `cell_${cellIndex}_${cell.cell_type ?? "raw"}`,
        signature: null,
        startLine,
        endLine,
        content: isCode ? source : `# ${cell.cell_type}\n${source}`,
      });
    }

    runningLine = endLine + 2; // +1 for the cell, +1 for a synthetic blank
    cellIndex++;
  }

  if (chunks.length === 0) {
    // Empty notebook — single placeholder chunk so it still indexes.
    chunks.push({
      type: "block",
      name: "ipynb-empty",
      signature: null,
      startLine: 1,
      endLine: 1,
      content: "",
    });
  }

  // language is captured at the file level; we don't reproject it on chunks.
  void lang;
  return { chunks, imports: [] };
}

function cellSource(cell: IpynbCell): string {
  if (typeof cell.source === "string") return cell.source;
  if (Array.isArray(cell.source)) return cell.source.join("");
  return "";
}
