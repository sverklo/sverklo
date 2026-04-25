import type { ParsedChunk, ParseResult } from "../types/index.js";

// Parse a markdown file into doc_section chunks (one per heading) + doc_code
// chunks (one per fenced code block, tagged with its enclosing breadcrumb).
//
// Design notes:
//   - Heading-scoped sectioning: everything between an H1/H2/H3/... line and
//     the next same-or-higher-level heading becomes one chunk.
//   - Fenced code blocks are extracted as their own sub-chunks so an agent
//     searching for `parseFile` finds the snippet, not just the paragraph.
//   - We emit an ancestor breadcrumb ("Architecture > Retrieval > RRF") so
//     the downstream chunk.description (see describer.ts) can include path
//     context for embeddings.
//   - Files without any headings produce a single doc_section covering the
//     whole file so README-less docs still get indexed.
export function parseMarkdown(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const stack: string[] = []; // active heading path, one entry per level
  let sectionStart = 0;
  let sectionTitle = "";
  let sectionBreadcrumb = "";

  const headingRe = /^(#{1,6})\s+(.+?)\s*$/;

  // Find fenced code blocks up front so we can emit them as sub-chunks once
  // we know which section they live in.
  const codeBlocks = findFencedCodeBlocks(lines);

  function flushSection(endIdxExclusive: number) {
    if (!sectionTitle && sectionStart === 0 && endIdxExclusive === lines.length) {
      // Whole-file, no headings — emit once as a doc_section.
    } else if (endIdxExclusive - sectionStart === 0) {
      return;
    }
    const body = lines.slice(sectionStart, endIdxExclusive).join("\n");
    if (body.trim() === "" && !sectionTitle) return;
    chunks.push({
      type: "doc_section",
      name: sectionTitle || "(root)",
      signature: sectionBreadcrumb || null,
      startLine: sectionStart + 1,
      endLine: endIdxExclusive,
      content: body,
    });
  }

  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = headingRe.exec(lines[i]);
    if (!m) continue;

    // Flush the section that ends here.
    if (i > sectionStart) flushSection(i);

    const level = m[1].length;
    const title = m[2].trim();

    stack.splice(level - 1); // drop everything at this level and deeper
    stack.push(title);

    sectionStart = i;
    sectionTitle = title;
    sectionBreadcrumb = stack.join(" > ");
  }

  // Final flush
  flushSection(lines.length);

  // Emit fenced code blocks tagged with the breadcrumb that contained them.
  for (const block of codeBlocks) {
    const breadcrumb = resolveBreadcrumbAt(block.startLine, chunks);
    chunks.push({
      type: "doc_code",
      name: block.lang || null,
      signature: breadcrumb,
      startLine: block.startLine,
      endLine: block.endLine,
      content: block.content,
    });
  }

  return { chunks, imports: [] };
}

interface FencedBlock {
  startLine: number; // 1-based
  endLine: number;
  lang: string;
  content: string;
}

function findFencedCodeBlocks(lines: string[]): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const fenceRe = /^```([\w+-]*)\s*$/;
  let open: { startLine: number; lang: string; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      if (/^```\s*$/.test(line)) {
        blocks.push({
          startLine: open.startLine,
          endLine: i + 1,
          lang: open.lang,
          content: open.body.join("\n"),
        });
        open = null;
      } else {
        open.body.push(line);
      }
      continue;
    }
    const m = fenceRe.exec(line);
    if (m) {
      open = { startLine: i + 1, lang: m[1] || "", body: [] };
    }
  }

  return blocks;
}

function resolveBreadcrumbAt(
  lineNo: number,
  priorChunks: ParsedChunk[]
): string | null {
  // Walk the doc_section chunks in order; return the most specific one that
  // encloses this line.
  let best: ParsedChunk | null = null;
  for (const c of priorChunks) {
    if (c.type !== "doc_section") continue;
    if (c.startLine <= lineNo && c.endLine >= lineNo) {
      if (!best || c.startLine >= best.startLine) best = c;
    }
  }
  return best?.signature ?? null;
}
