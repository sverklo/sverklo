import type { ParsedChunk, ParseResult, ImportRef, ChunkType } from "../types/index.js";

// Regex-based parser for MVP. Fast, no native dependencies.
// Handles the top languages well enough. Tree-sitter upgrade path for v2.

export function parseFile(
  content: string,
  language: string
): ParseResult {
  const lines = content.split("\n");
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  switch (language) {
    case "typescript":
    case "javascript":
      return parseTSJS(content, lines);
    case "python":
      return parsePython(content, lines);
    case "go":
      return parseGo(content, lines);
    case "rust":
      return parseRust(content, lines);
    case "java":
      return parseJava(content, lines);
    case "c":
    case "cpp":
      return parseCCpp(content, lines);
    case "ruby":
      return parseRuby(content, lines);
    case "php":
      return parsePHP(content, lines);
    default:
      return { chunks: fallbackChunk(content, lines), imports: [] };
  }
}

// ── TypeScript / JavaScript ─────────────────────────────────────────

function parseTSJS(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  // Extract imports
  const importRe =
    /^import\s+(?:{([^}]+)}\s+from\s+['"]([^'"]+)['"]|(\w+)\s+from\s+['"]([^'"]+)['"]|['"]([^'"]+)['"])/gm;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const names = m[1]
      ? m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0])
      : m[3]
        ? [m[3]]
        : [];
    const source = m[2] || m[4] || m[5] || "";
    imports.push({
      source,
      names: names.filter(Boolean),
      isRelative: source.startsWith("."),
    });
  }

  // require() imports
  const requireRe = /(?:const|let|var)\s+(?:{([^}]+)}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/gm;
  while ((m = requireRe.exec(content)) !== null) {
    const names = m[1]
      ? m[1].split(",").map((s) => s.trim())
      : m[2]
        ? [m[2]]
        : [];
    imports.push({
      source: m[3],
      names,
      isRelative: m[3].startsWith("."),
    });
  }

  // Parse structural elements using brace matching
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    let chunk: ParsedChunk | null = null;

    // Export/function declarations
    if (/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/function\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunk = extractChunk("function", name, lines, i, endLine);
    }
    // Arrow functions assigned to const/let/var
    else if (
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*[^=]+)?\s*=>/.test(
        trimmed
      )
    ) {
      const name = trimmed.match(/(?:const|let|var)\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i) || findStatementEnd(lines, i);
      chunk = extractChunk("function", name, lines, i, endLine);
    }
    // Class declarations
    else if (/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunk = extractChunk("class", name, lines, i, endLine);
    }
    // Interface declarations
    else if (/^(?:export\s+)?interface\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/interface\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunk = extractChunk("interface", name, lines, i, endLine);
    }
    // Type declarations
    else if (/^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/.test(trimmed)) {
      const name = trimmed.match(/type\s+(\w+)/)?.[1] || null;
      const endLine = findStatementEnd(lines, i);
      chunk = extractChunk("type", name, lines, i, endLine);
    }

    if (chunk && chunk.content.length > 10) {
      chunks.push(chunk);
      i = chunk.endLine; // skip past this chunk
    }
  }

  // If no chunks found, fall back to whole-file chunk
  if (chunks.length === 0) {
    chunks.push(...fallbackChunk(content, lines));
  }

  return { chunks, imports };
}

// ── Python ──────────────────────────────────────────────────────────

function parsePython(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Imports
    if (/^(?:from\s+(\S+)\s+)?import\s+(.+)$/.test(trimmed)) {
      const m = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)$/);
      if (m) {
        imports.push({
          source: m[1] || m[2].split(",")[0].trim(),
          names: m[2].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]),
          isRelative: (m[1] || "").startsWith("."),
        });
      }
      continue;
    }

    // Functions
    if (/^(?:async\s+)?def\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/def\s+(\w+)/)?.[1] || null;
      const endLine = findIndentEnd(lines, i, indent);
      const sig = trimmed.replace(/:$/, "");
      chunks.push({
        type: "function",
        name,
        signature: sig,
        startLine: i + 1,
        endLine: endLine + 1,
        content: lines.slice(i, endLine + 1).join("\n"),
      });
      i = endLine;
    }
    // Classes
    else if (/^class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findIndentEnd(lines, i, indent);
      chunks.push({
        type: "class",
        name,
        signature: trimmed.replace(/:$/, ""),
        startLine: i + 1,
        endLine: endLine + 1,
        content: lines.slice(i, endLine + 1).join("\n"),
      });
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Go ──────────────────────────────────────────────────────────────

function parseGo(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  // Extract imports
  const importBlockRe = /^import\s*\(\s*\n([\s\S]*?)\n\s*\)/gm;
  let m;
  while ((m = importBlockRe.exec(content)) !== null) {
    for (const line of m[1].split("\n")) {
      const pkgMatch = line.match(/["']([^"']+)["']/);
      if (pkgMatch) {
        imports.push({
          source: pkgMatch[1],
          names: [],
          isRelative: pkgMatch[1].startsWith("."),
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^func\s+/.test(trimmed)) {
      const name =
        trimmed.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^type\s+(\w+)\s+struct\b/.test(trimmed)) {
      const name = trimmed.match(/type\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^type\s+(\w+)\s+interface\b/.test(trimmed)) {
      const name = trimmed.match(/type\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("interface", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Rust ────────────────────────────────────────────────────────────

function parseRust(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^use\s+/.test(trimmed)) {
      const source = trimmed.match(/^use\s+([^;{]+)/)?.[1]?.trim() || "";
      imports.push({ source, names: [], isRelative: source.startsWith("crate") });
      continue;
    }

    if (/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/fn\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:pub\s+)?struct\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/struct\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:pub\s+)?enum\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/enum\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:pub\s+)?trait\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/trait\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("interface", name, lines, i, endLine));
      i = endLine;
    } else if (/^impl\s+/.test(trimmed)) {
      const name = trimmed.match(/impl\s+(?:<[^>]+>\s+)?(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Java ────────────────────────────────────────────────────────────

function parseJava(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^import\s+/.test(trimmed)) {
      const source = trimmed.match(/import\s+(?:static\s+)?([^;]+)/)?.[1] || "";
      imports.push({ source, names: [], isRelative: false });
      continue;
    }

    if (/(?:public|private|protected|static|\s)*class\s+(\w+)/.test(trimmed) && trimmed.includes("{")) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/(?:public|private|protected|static|\s)+\w+(?:<[^>]+>)?\s+(\w+)\s*\(/.test(trimmed)) {
      const name = trimmed.match(/(\w+)\s*\(/)?.[1] || null;
      if (name && !["if", "for", "while", "switch", "catch"].includes(name)) {
        const endLine = findBraceEnd(lines, i);
        chunks.push(extractChunk("method", name, lines, i, endLine));
        i = endLine;
      }
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── C/C++ ───────────────────────────────────────────────────────────

function parseCCpp(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^#include\s+[<"]([^>"]+)[>"]/.test(trimmed)) {
      const source = trimmed.match(/#include\s+[<"]([^>"]+)[>"]/)?.[1] || "";
      imports.push({ source, names: [], isRelative: trimmed.includes('"') });
      continue;
    }

    // Function definitions (simplified)
    if (/^\w[\w:*&<>\s]+\s+(\w+)\s*\([^)]*\)\s*\{/.test(trimmed)) {
      const name = trimmed.match(/(\w+)\s*\(/)?.[1] || null;
      if (name && !["if", "for", "while", "switch"].includes(name)) {
        const endLine = findBraceEnd(lines, i);
        chunks.push(extractChunk("function", name, lines, i, endLine));
        i = endLine;
      }
    } else if (/^(?:class|struct)\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/(?:class|struct)\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Ruby ────────────────────────────────────────────────────────────

function parseRuby(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].length - trimmed.length;

    if (/^require\s+['"]([^'"]+)['"]/.test(trimmed)) {
      const source = trimmed.match(/require\s+['"]([^'"]+)['"]/)?.[1] || "";
      imports.push({ source, names: [], isRelative: source.startsWith(".") });
      continue;
    }

    if (/^def\s+(\w+[!?=]?)/.test(trimmed)) {
      const name = trimmed.match(/def\s+(\w+[!?=]?)/)?.[1] || null;
      const endLine = findEndKeyword(lines, i, indent);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findEndKeyword(lines, i, indent);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^module\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/module\s+(\w+)/)?.[1] || null;
      const endLine = findEndKeyword(lines, i, indent);
      chunks.push(extractChunk("module", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── PHP ─────────────────────────────────────────────────────────────

function parsePHP(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^(?:use|require|include|require_once|include_once)\s+/.test(trimmed)) {
      const source = trimmed.match(/['"]([^'"]+)['"]/)?.[1] || trimmed.split(/\s+/)[1]?.replace(";", "") || "";
      imports.push({ source, names: [], isRelative: source.startsWith(".") });
      continue;
    }

    if (/(?:public|private|protected|static|\s)*function\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/function\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:abstract\s+)?class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractChunk(
  type: ChunkType,
  name: string | null,
  lines: string[],
  startLine: number,
  endLine: number
): ParsedChunk {
  const content = lines.slice(startLine, endLine + 1).join("\n");
  const signature = lines[startLine].trim();
  return {
    type,
    name,
    signature,
    startLine: startLine + 1, // 1-indexed
    endLine: endLine + 1,
    content,
  };
}

function findBraceEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        foundOpen = true;
      } else if (ch === "}") {
        depth--;
        if (foundOpen && depth === 0) return i;
      }
    }
  }
  return Math.min(startIdx + 50, lines.length - 1);
}

function findIndentEnd(
  lines: string[],
  startIdx: number,
  baseIndent: number
): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // skip blank lines
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) return i - 1;
  }
  return lines.length - 1;
}

function findEndKeyword(
  lines: string[],
  startIdx: number,
  baseIndent: number
): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].length - trimmed.length;
    if (trimmed === "end" && indent <= baseIndent) return i;
  }
  return Math.min(startIdx + 100, lines.length - 1);
}

function findStatementEnd(lines: string[], startIdx: number): number {
  // Find the end of a statement (semicolon or empty line)
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    if (depth <= 0 && (lines[i].trimEnd().endsWith(";") || lines[i].trim() === "")) {
      return i;
    }
  }
  return Math.min(startIdx + 20, lines.length - 1);
}

function fallbackChunk(content: string, lines: string[]): ParsedChunk[] {
  // For unsupported languages or files with no recognized structures,
  // chunk by blocks of ~50 lines
  const chunks: ParsedChunk[] = [];
  const chunkSize = 50;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const end = Math.min(i + chunkSize - 1, lines.length - 1);
    chunks.push({
      type: "block",
      name: null,
      signature: null,
      startLine: i + 1,
      endLine: end + 1,
      content: lines.slice(i, end + 1).join("\n"),
    });
  }
  return chunks;
}
