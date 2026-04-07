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
    case "kotlin":
      return parseKotlin(content, lines);
    case "scala":
      return parseScala(content, lines);
    case "swift":
      return parseSwift(content, lines);
    case "dart":
      return parseDart(content, lines);
    case "elixir":
      return parseElixir(content, lines);
    case "lua":
      return parseLua(content, lines);
    case "zig":
      return parseZig(content, lines);
    case "haskell":
      return parseHaskell(content, lines);
    case "clojure":
      return parseClojure(content, lines);
    case "ocaml":
      return parseOCaml(content, lines);
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

// ── Kotlin ──────────────────────────────────────────────────────────

function parseKotlin(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^import\s+/.test(trimmed)) {
      const source = trimmed.match(/^import\s+([^\s;]+)/)?.[1] || "";
      imports.push({ source, names: [], isRelative: false });
      continue;
    }

    if (/^(?:public\s+|private\s+|internal\s+|protected\s+|inline\s+|suspend\s+|open\s+|override\s+)*fun\s+(?:<[^>]+>\s+)?(?:[\w.]+\.)?(\w+)/.test(trimmed)) {
      const name = trimmed.match(/fun\s+(?:<[^>]+>\s+)?(?:[\w.]+\.)?(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+|protected\s+|abstract\s+|open\s+|sealed\s+|data\s+|enum\s+)*class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+)*object\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/object\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+)*interface\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/interface\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("interface", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+)*typealias\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/typealias\s+(\w+)/)?.[1] || null;
      const endLine = findStatementEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Scala ───────────────────────────────────────────────────────────

function parseScala(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^import\s+/.test(trimmed)) {
      const source = trimmed.match(/^import\s+([^\s;]+)/)?.[1] || "";
      imports.push({ source, names: [], isRelative: false });
      continue;
    }

    if (/^(?:private\s+|protected\s+|override\s+|implicit\s+|final\s+)*def\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/def\s+(\w+)/)?.[1] || null;
      const endLine = trimmed.includes("{") ? findBraceEnd(lines, i) : findStatementEnd(lines, i);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:abstract\s+|final\s+|sealed\s+|case\s+)*class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:case\s+)?object\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/object\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:sealed\s+)?trait\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/trait\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("interface", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Swift ───────────────────────────────────────────────────────────

function parseSwift(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^import\s+/.test(trimmed)) {
      const source = trimmed.match(/^import\s+(\S+)/)?.[1] || "";
      imports.push({ source, names: [], isRelative: false });
      continue;
    }

    if (/^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|static\s+|override\s+|final\s+|@\w+\s+)*func\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/func\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|final\s+)*class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+|fileprivate\s+)*struct\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/struct\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+|fileprivate\s+|indirect\s+)*enum\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/enum\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:public\s+|private\s+|internal\s+|fileprivate\s+)*protocol\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/protocol\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("interface", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Dart ────────────────────────────────────────────────────────────

function parseDart(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^import\s+['"]([^'"]+)['"]/.test(trimmed)) {
      const source = trimmed.match(/import\s+['"]([^'"]+)['"]/)?.[1] || "";
      imports.push({ source, names: [], isRelative: source.startsWith(".") });
      continue;
    }

    if (/^(?:abstract\s+)?class\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^mixin\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/mixin\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("class", name, lines, i, endLine));
      i = endLine;
    } else if (/^enum\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/enum\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:static\s+|final\s+|@\w+\s+)*(?:void|[\w<>?,\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:async\s*)?\{/.test(trimmed)) {
      const name = trimmed.match(/(\w+)\s*\([^)]*\)\s*(?:async\s*)?\{/)?.[1] || null;
      if (name && !["if", "for", "while", "switch", "catch"].includes(name)) {
        const endLine = findBraceEnd(lines, i);
        chunks.push(extractChunk("function", name, lines, i, endLine));
        i = endLine;
      }
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Elixir ──────────────────────────────────────────────────────────

function parseElixir(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].length - trimmed.length;

    if (/^(?:import|alias|require|use)\s+([\w.]+)/.test(trimmed)) {
      const source = trimmed.match(/^(?:import|alias|require|use)\s+([\w.]+)/)?.[1] || "";
      imports.push({ source, names: [], isRelative: false });
      continue;
    }

    if (/^defmodule\s+([\w.]+)/.test(trimmed)) {
      const name = trimmed.match(/defmodule\s+([\w.]+)/)?.[1] || null;
      const endLine = findEndKeyword(lines, i, indent);
      chunks.push(extractChunk("module", name, lines, i, endLine));
      i = endLine;
    } else if (/^defp?\s+(\w+[!?]?)/.test(trimmed)) {
      const name = trimmed.match(/^defp?\s+(\w+[!?]?)/)?.[1] || null;
      const endLine = trimmed.includes(", do:") || /\sdo:\s/.test(trimmed)
        ? i
        : findEndKeyword(lines, i, indent);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^defstruct\b/.test(trimmed)) {
      const endLine = findStatementEnd(lines, i);
      chunks.push(extractChunk("type", null, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Lua ─────────────────────────────────────────────────────────────

function parseLua(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].length - trimmed.length;

    const reqMatch = trimmed.match(/require\s*\(?\s*['"]([^'"]+)['"]/);
    if (reqMatch) {
      imports.push({ source: reqMatch[1], names: [], isRelative: reqMatch[1].startsWith(".") });
    }

    if (/^(?:local\s+)?function\s+([\w.:]+)/.test(trimmed)) {
      const name = trimmed.match(/function\s+([\w.:]+)/)?.[1] || null;
      const endLine = findLuaEnd(lines, i, indent);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:local\s+)?(\w+)\s*=\s*function/.test(trimmed)) {
      const name = trimmed.match(/^(?:local\s+)?(\w+)\s*=\s*function/)?.[1] || null;
      const endLine = findLuaEnd(lines, i, indent);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Zig ─────────────────────────────────────────────────────────────

function parseZig(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    const importMatch = trimmed.match(/const\s+(\w+)\s*=\s*@import\(\s*"([^"]+)"\s*\)/);
    if (importMatch) {
      imports.push({
        source: importMatch[2],
        names: [importMatch[1]],
        isRelative: importMatch[2].startsWith(".") || importMatch[2].endsWith(".zig"),
      });
      continue;
    }

    if (/^(?:pub\s+)?(?:export\s+)?(?:inline\s+)?fn\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/fn\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+|extern\s+)?struct\b/.test(trimmed)) {
      const name = trimmed.match(/const\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:pub\s+)?const\s+(\w+)\s*=\s*(?:extern\s+)?enum\b/.test(trimmed)) {
      const name = trimmed.match(/const\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^(?:pub\s+)?const\s+(\w+)\s*=\s*union\b/.test(trimmed)) {
      const name = trimmed.match(/const\s+(\w+)/)?.[1] || null;
      const endLine = findBraceEnd(lines, i);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Haskell ─────────────────────────────────────────────────────────

function parseHaskell(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].length - trimmed.length;

    if (/^import\s+(?:qualified\s+)?([\w.]+)/.test(trimmed)) {
      const source = trimmed.match(/^import\s+(?:qualified\s+)?([\w.]+)/)?.[1] || "";
      imports.push({ source, names: [], isRelative: false });
      continue;
    }

    // Type signatures: foo :: Int -> Int
    if (/^([a-z_]\w*)\s*::/.test(trimmed)) {
      const name = trimmed.match(/^([a-z_]\w*)\s*::/)?.[1] || null;
      const endLine = findHaskellBlockEnd(lines, i, indent);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^data\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/data\s+(\w+)/)?.[1] || null;
      const endLine = findHaskellBlockEnd(lines, i, indent);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^newtype\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/newtype\s+(\w+)/)?.[1] || null;
      const endLine = findHaskellBlockEnd(lines, i, indent);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^type\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/type\s+(\w+)/)?.[1] || null;
      const endLine = findHaskellBlockEnd(lines, i, indent);
      chunks.push(extractChunk("type", name, lines, i, endLine));
      i = endLine;
    } else if (/^class\s+/.test(trimmed)) {
      const name = trimmed.match(/class\s+(?:\([^)]*\)\s*=>\s*)?(\w+)/)?.[1] || null;
      const endLine = findHaskellBlockEnd(lines, i, indent);
      chunks.push(extractChunk("interface", name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── Clojure ─────────────────────────────────────────────────────────

function parseClojure(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  // Match (require '...) and (:require [...]) and (:use ...)
  const requireRe = /\(:?require\s+(?:'?([\w.\-/]+)|\[([\w.\-/]+))/g;
  let m;
  while ((m = requireRe.exec(content)) !== null) {
    const source = m[1] || m[2] || "";
    if (source) imports.push({ source, names: [], isRelative: false });
  }
  const useRe = /\(:?use\s+(?:'?([\w.\-/]+)|\[([\w.\-/]+))/g;
  while ((m = useRe.exec(content)) !== null) {
    const source = m[1] || m[2] || "";
    if (source) imports.push({ source, names: [], isRelative: false });
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    const defMatch = trimmed.match(/^\((defn-?|def|defmacro|defprotocol|defmulti|defmethod|defrecord|deftype)\s+(\S+)/);
    if (defMatch) {
      const kind = defMatch[1];
      const name = defMatch[2];
      const endLine = findParenEnd(lines, i);
      const type: ChunkType =
        kind === "defprotocol" ? "interface" :
        kind === "defrecord" || kind === "deftype" ? "type" :
        kind === "def" ? "variable" : "function";
      chunks.push(extractChunk(type, name, lines, i, endLine));
      i = endLine;
    }
  }

  if (chunks.length === 0) chunks.push(...fallbackChunk(content, lines));
  return { chunks, imports };
}

// ── OCaml ───────────────────────────────────────────────────────────

function parseOCaml(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].length - trimmed.length;

    if (/^open\s+([\w.]+)/.test(trimmed)) {
      const source = trimmed.match(/^open\s+([\w.]+)/)?.[1] || "";
      imports.push({ source, names: [], isRelative: false });
      continue;
    }

    if (/^let\s+(?:rec\s+)?(\w+)/.test(trimmed)) {
      const name = trimmed.match(/^let\s+(?:rec\s+)?(\w+)/)?.[1] || null;
      const endLine = findOCamlBlockEnd(lines, i, indent);
      chunks.push(extractChunk("function", name, lines, i, endLine));
      i = endLine;
    } else if (/^module\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/^module\s+(\w+)/)?.[1] || null;
      const endLine = findOCamlBlockEnd(lines, i, indent);
      chunks.push(extractChunk("module", name, lines, i, endLine));
      i = endLine;
    } else if (/^type\s+(\w+)/.test(trimmed)) {
      const name = trimmed.match(/^type\s+(\w+)/)?.[1] || null;
      const endLine = findOCamlBlockEnd(lines, i, indent);
      chunks.push(extractChunk("type", name, lines, i, endLine));
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

function findLuaEnd(lines: string[], startIdx: number, baseIndent: number): number {
  // Lua uses `end` to close functions, but also for `if`/`for`/`while`.
  // Track depth via simple keyword counting.
  let depth = 0;
  const openRe = /\b(function|if|for|while|do)\b/g;
  const closeRe = /\bend\b/g;
  const elseRe = /\b(elseif|else)\b/g;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].replace(/--.*$/, "");
    let opens = 0;
    let closes = 0;
    let m;
    while ((m = openRe.exec(line)) !== null) opens++;
    openRe.lastIndex = 0;
    while ((m = closeRe.exec(line)) !== null) closes++;
    closeRe.lastIndex = 0;
    // elseif/else are not opens or closes
    while ((m = elseRe.exec(line)) !== null) {
      // no-op
    }
    elseRe.lastIndex = 0;
    depth += opens - closes;
    if (i > startIdx && depth <= 0) return i;
  }
  return Math.min(startIdx + 100, lines.length - 1);
}

function findHaskellBlockEnd(lines: string[], startIdx: number, baseIndent: number): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) return i - 1;
  }
  return lines.length - 1;
}

function findOCamlBlockEnd(lines: string[], startIdx: number, baseIndent: number): number {
  // OCaml top-level definitions end at the next top-level keyword at same or less indent
  const topRe = /^(let|module|type|open|exception|val|class|and|in)\b/;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent && topRe.test(line.trimStart()) && !/^and\b/.test(line.trimStart())) {
      return i - 1;
    }
  }
  return Math.min(startIdx + 100, lines.length - 1);
}

function findParenEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let foundOpen = false;
  let inString = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"' && line[j - 1] !== "\\") inString = !inString;
      if (inString) continue;
      if (ch === ";") break; // line comment
      if (ch === "(") {
        depth++;
        foundOpen = true;
      } else if (ch === ")") {
        depth--;
        if (foundOpen && depth === 0) return i;
      }
    }
  }
  return Math.min(startIdx + 50, lines.length - 1);
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
