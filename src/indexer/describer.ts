import type { ParsedChunk } from "../types/index.js";

// Generate natural language descriptions from AST metadata.
// Key insight from Greptile: embedding NL descriptions produces
// much better semantic search results than embedding raw code.

export function describeChunk(
  chunk: ParsedChunk,
  filePath: string,
  language: string
): string {
  const parts: string[] = [];

  const typeName = chunk.type === "block" ? "code block" : chunk.type;

  if (chunk.name) {
    parts.push(`${typeName} '${chunk.name}'`);
  } else {
    parts.push(`anonymous ${typeName}`);
  }

  parts.push(`in ${filePath}`);

  if (chunk.signature && chunk.signature !== chunk.name) {
    // Extract parameter info from signature
    const params = extractParams(chunk.signature, language);
    if (params) {
      parts.push(`with parameters: ${params}`);
    }

    const returnType = extractReturnType(chunk.signature, language);
    if (returnType) {
      parts.push(`returns ${returnType}`);
    }
  }

  // Extract first line of docstring/comment if present
  const docstring = extractDocstring(chunk.content, language);
  if (docstring) {
    parts.push(`— ${docstring}`);
  }

  return parts.join(" ");
}

function extractParams(
  signature: string,
  language: string
): string | null {
  const m = signature.match(/\(([^)]*)\)/);
  if (!m || !m[1].trim()) return null;

  // Clean up parameter list
  const params = m[1]
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p !== "self" && p !== "cls" && p !== "this")
    .map((p) => {
      // Simplify to just param names for description
      if (language === "python") return p.split(":")[0].split("=")[0].trim();
      if (language === "go") return p.split(/\s+/)[0];
      return p.split(":")[0].replace(/^(const|let|var|mut|&)\s+/, "").trim();
    })
    .filter(Boolean);

  return params.length > 0 ? params.join(", ") : null;
}

function extractReturnType(
  signature: string,
  language: string
): string | null {
  if (language === "typescript" || language === "javascript") {
    // function foo(): ReturnType
    const m = signature.match(/\)\s*:\s*([^{=]+)/);
    return m ? m[1].trim() : null;
  }
  if (language === "python") {
    const m = signature.match(/->\s*(.+?)(?:\s*:)?\s*$/);
    return m ? m[1].trim() : null;
  }
  if (language === "go") {
    // func foo() (ReturnType, error)
    const m = signature.match(/\)\s*(?:\(([^)]+)\)|(\w+(?:\.\w+)?))\s*\{?$/);
    return m ? (m[1] || m[2])?.trim() || null : null;
  }
  if (language === "rust") {
    const m = signature.match(/->\s*(.+?)\s*(?:\{|where)/);
    return m ? m[1].trim() : null;
  }
  return null;
}

function extractDocstring(content: string, language: string): string | null {
  const lines = content.split("\n");

  if (language === "python") {
    // Look for triple-quote docstring
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        const doc = trimmed.replace(/^["']{3}/, "").replace(/["']{3}$/, "").trim();
        if (doc) return doc;
        // Multi-line docstring
        if (i + 1 < lines.length) return lines[i + 1].trim();
      }
    }
  }

  // JSDoc or block comment before the definition
  if (lines[0].trim().startsWith("/**") || lines[0].trim().startsWith("///")) {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const clean = lines[i]
        .trim()
        .replace(/^\/\*\*\s*/, "")
        .replace(/^\*\s*/, "")
        .replace(/^\/\/\/\s*/, "")
        .replace(/\*\/$/, "")
        .trim();
      if (clean && !clean.startsWith("@")) return clean;
    }
  }

  // Single-line comment right after definition
  if (lines.length > 1) {
    const secondLine = lines[1].trim();
    if (secondLine.startsWith("//") || secondLine.startsWith("#")) {
      return secondLine.replace(/^\/\/\s*/, "").replace(/^#\s*/, "").trim() || null;
    }
  }

  return null;
}
