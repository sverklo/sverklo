import type { ParsedChunk, ParseResult, ImportRef } from "../../types/index.js";
import { extractChunk, fallbackChunk, findBraceEnd } from "./_shared.js";

export function parseJava(content: string, lines: string[]): ParseResult {
  const chunks: ParsedChunk[] = [];
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (/^import\s+/.test(trimmed)) {
      const match = trimmed.match(/^import\s+(static\s+)?([^;]+);?/);
      if (match) {
        const isStatic = Boolean(match[1]);
        const rawSource = match[2].trim();
        const parts = rawSource.split(".");
        const importedName = parts[parts.length - 1] || "";
        const classIndex = isStatic ? parts.length - 2 : parts.length - 1;
        const className = parts[classIndex] || "";
        const source = isStatic ? parts.slice(0, classIndex + 1).join(".") : rawSource;
        const name = importedName === "*" ? null : isStatic ? importedName : className;
        imports.push({ source, names: name ? [name] : [], isRelative: false });
      }
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
