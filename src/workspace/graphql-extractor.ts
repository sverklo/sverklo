import { createHash } from "node:crypto";
import type { InterfaceContract } from "./cross-db.js";

export interface GraphQLExtractionResult {
  contracts: Omit<InterfaceContract, "id" | "projectId">[];
}

// Root types whose fields are exposed as "endpoint" kind
const ROOT_TYPES = new Set(["Query", "Mutation", "Subscription"]);

/**
 * Extract type/field contracts from GraphQL schema SDL files.
 *
 * Produces a flat list of contracts:
 *  - One per type/input/interface/enum (symbolKind = "type")
 *  - One per field within a type (symbolKind = "field" or "endpoint" for root types)
 *  - One per scalar declaration (symbolKind = "type")
 */
export function extractGraphQLContracts(
  filePath: string,
  content: string,
): GraphQLExtractionResult {
  const contracts: GraphQLExtractionResult["contracts"] = [];
  const lines = content.split("\n");

  // Pre-process: strip comments and block descriptions to simplify parsing.
  // We keep the original lines for line-number tracking and hashing,
  // but work on a cleaned version for regex matching.
  const cleaned = stripCommentsAndDescriptions(lines);

  // Extract scalar declarations:  scalar DateTime
  for (let i = 0; i < cleaned.length; i++) {
    const scalarMatch = cleaned[i].match(/^\s*scalar\s+([A-Za-z_]\w*)/);
    if (scalarMatch) {
      contracts.push({
        symbolName: scalarMatch[1],
        symbolKind: "type",
        sourceFile: filePath,
        fileLine: i + 1,
        interfaceType: "graphql",
        signature: `scalar ${scalarMatch[1]}`,
        contentHash: sha256(lines[i]),
      });
    }
  }

  // Extract type / input / interface / enum blocks
  // Handles:  type Foo {  |  type Foo implements Bar {  |  extend type Foo {
  //           input Foo {  |  interface Foo {  |  enum Foo {
  const blockStartRe =
    /^\s*(extend\s+)?(type|input|interface|enum)\s+([A-Za-z_]\w*)(?:\s+implements\s+[A-Za-z_][\w\s&,]*)?\s*\{/;

  let i = 0;
  while (i < cleaned.length) {
    const m = cleaned[i].match(blockStartRe);
    if (!m) {
      i++;
      continue;
    }

    const isExtend = !!m[1];
    const blockKind = m[2]; // type | input | interface | enum
    const typeName = m[3];
    const blockStartLine = i;

    // Emit a contract for the type itself (skip for extend blocks — the base
    // type was already declared elsewhere)
    if (!isExtend) {
      contracts.push({
        symbolName: typeName,
        symbolKind: "type",
        sourceFile: filePath,
        fileLine: blockStartLine + 1,
        interfaceType: "graphql",
        signature: cleaned[i].trim(),
        contentHash: sha256(lines[i]),
      });
    }

    // Find the matching closing brace, accounting for nesting (rare in SDL
    // but possible with nested input types etc.)
    let depth = 1;
    i++;
    while (i < cleaned.length && depth > 0) {
      for (const ch of cleaned[i]) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth > 0) {
        // This line is inside the block — try to extract a field
        const field = parseField(cleaned[i], typeName, blockKind);
        if (field) {
          const symbolKind = ROOT_TYPES.has(typeName) ? "endpoint" : "field";
          contracts.push({
            symbolName: `${typeName}.${field.name}`,
            symbolKind,
            sourceFile: filePath,
            fileLine: i + 1,
            interfaceType: "graphql",
            signature: field.signature,
            contentHash: sha256(lines[i]),
          });
        }
      }
      i++;
    }
  }

  return { contracts };
}

/**
 * Parse a single field line inside a type block.
 * Handles:
 *   fieldName: Type
 *   fieldName(arg: Type, arg2: Type): Type
 *   ENUM_VALUE            (inside enum blocks)
 */
function parseField(
  line: string,
  _typeName: string,
  blockKind: string,
): { name: string; signature: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "{" || trimmed === "}") return null;

  if (blockKind === "enum") {
    // Enum values are simple identifiers, possibly followed by @directives
    const enumMatch = trimmed.match(/^([A-Za-z_]\w*)/);
    if (enumMatch) {
      return { name: enumMatch[1], signature: trimmed };
    }
    return null;
  }

  // Field: name(args): ReturnType or name: ReturnType
  const fieldMatch = trimmed.match(/^([A-Za-z_]\w*)\s*(\([^)]*\))?\s*:\s*(.+)/);
  if (fieldMatch) {
    return { name: fieldMatch[1], signature: trimmed };
  }

  return null;
}

/**
 * Strip # line comments and """ block descriptions from SDL lines.
 * Returns a new array of the same length, with comment/description lines blanked out.
 */
function stripCommentsAndDescriptions(lines: string[]): string[] {
  const result = new Array<string>(lines.length);
  let inBlockDesc = false;

  for (let i = 0; i < lines.length; i++) {
    if (inBlockDesc) {
      // Look for the closing """
      const closeIdx = lines[i].indexOf('"""');
      if (closeIdx !== -1) {
        inBlockDesc = false;
        // Blank out up to and including the closing """
        result[i] = lines[i].substring(closeIdx + 3);
      } else {
        result[i] = "";
      }
      continue;
    }

    let line = lines[i];

    // Handle opening """ — could be single-line """ ... """ or start a block
    const openIdx = line.indexOf('"""');
    if (openIdx !== -1) {
      const afterOpen = line.substring(openIdx + 3);
      const closeIdx = afterOpen.indexOf('"""');
      if (closeIdx !== -1) {
        // Single-line block description: """some text"""
        line = line.substring(0, openIdx) + afterOpen.substring(closeIdx + 3);
      } else {
        // Multi-line block description starts
        inBlockDesc = true;
        line = line.substring(0, openIdx);
      }
    }

    // Strip # comments (but not inside strings — SDL doesn't have inline strings
    // outside of descriptions, so this is safe)
    const hashIdx = line.indexOf("#");
    if (hashIdx !== -1) {
      line = line.substring(0, hashIdx);
    }

    // Strip single-line "description" strings that precede fields
    line = line.replace(/^\s*"[^"]*"\s*$/, "");

    result[i] = line;
  }

  return result;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
