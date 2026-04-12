import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { InterfaceContract } from "./cross-db.js";

export interface ConsumerMatch {
  file: string;
  symbol: string; // the consuming component/function name
  line: number;
  referencedFields: string[]; // ["User.email", "User.posts"]
  edgeType: "query" | "mutation" | "subscription";
}

/**
 * Scan a TypeScript/JavaScript file for GraphQL operations (gql tagged templates,
 * graphql() calls, .graphql imports) and resolve field references against known contracts.
 */
export function detectGraphQLConsumers(
  filePath: string,
  content: string,
  knownContracts: InterfaceContract[],
): ConsumerMatch[] {
  const matches: ConsumerMatch[] = [];

  // Build lookup maps from known contracts
  const endpointContracts = new Map<string, InterfaceContract>();
  const fieldContracts = new Set<string>();
  const typeReturnMap = new Map<string, string>(); // "Query.user" -> "User"

  for (const c of knownContracts) {
    if (c.symbolKind === "endpoint") {
      endpointContracts.set(c.symbolName, c);
      // Extract return type from signature, e.g. "user(id: ID!): User" -> "User"
      const returnType = extractReturnType(c.signature ?? "");
      if (returnType) {
        typeReturnMap.set(c.symbolName, returnType);
      }
    }
    if (c.symbolKind === "field" || c.symbolKind === "endpoint") {
      fieldContracts.add(c.symbolName);
    }
  }

  // Collect all GraphQL operation strings with their source locations
  const operations = extractOperations(filePath, content);

  for (const op of operations) {
    const parsed = parseGraphQLOperation(op.graphql);
    if (!parsed) continue;

    const referencedFields: string[] = [];

    // Resolve root fields against endpoints
    for (const rootField of parsed.rootFields) {
      const endpointName = `${capitalize(parsed.operationType)}.${rootField.name}`;
      const returnType = typeReturnMap.get(endpointName);

      if (endpointContracts.has(endpointName)) {
        referencedFields.push(endpointName);
      }

      // Resolve nested selections
      if (rootField.selections.length > 0) {
        const parentType = returnType ?? capitalize(rootField.name);
        resolveSelections(
          rootField.selections,
          parentType,
          fieldContracts,
          typeReturnMap,
          referencedFields,
          returnType != null, // exact if we know the return type
        );
      }
    }

    if (referencedFields.length > 0) {
      matches.push({
        file: filePath,
        symbol: op.enclosingSymbol,
        line: op.line,
        referencedFields: [...new Set(referencedFields)],
        edgeType: parsed.operationType as "query" | "mutation" | "subscription",
      });
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Operation extraction: find gql`...`, graphql(`...`), and .graphql imports
// ---------------------------------------------------------------------------

interface ExtractedOperation {
  graphql: string;
  line: number;
  enclosingSymbol: string;
}

function extractOperations(
  filePath: string,
  content: string,
): ExtractedOperation[] {
  const ops: ExtractedOperation[] = [];

  // Pattern 1: gql`...` or graphql`...` tagged template literals
  const taggedTemplateRe = /\b(?:gql|graphql)\s*`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = taggedTemplateRe.exec(content)) !== null) {
    const line = lineAt(content, m.index);
    ops.push({
      graphql: m[1],
      line,
      enclosingSymbol: findEnclosingSymbol(content, m.index),
    });
  }

  // Pattern 2: graphql("...") or graphql('...') function call with a string literal
  const graphqlCallRe = /\bgraphql\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  while ((m = graphqlCallRe.exec(content)) !== null) {
    const line = lineAt(content, m.index);
    ops.push({
      graphql: m[2],
      line,
      enclosingSymbol: findEnclosingSymbol(content, m.index),
    });
  }

  // Pattern 3: import from .graphql file
  const graphqlImportRe =
    /import\s+.*?\s+from\s+['"]([^'"]+\.graphql)['"]/g;
  while ((m = graphqlImportRe.exec(content)) !== null) {
    const importPath = m[1];
    const resolved = resolve(dirname(filePath), importPath);
    try {
      const graphqlContent = readFileSync(resolved, "utf-8");
      const line = lineAt(content, m.index);
      ops.push({
        graphql: graphqlContent,
        line,
        enclosingSymbol: findEnclosingSymbol(content, m.index),
      });
    } catch {
      // File not found — skip silently
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Lightweight GraphQL operation parser
// ---------------------------------------------------------------------------

interface ParsedOperation {
  operationType: string; // "query" | "mutation" | "subscription"
  operationName: string | null;
  rootFields: FieldSelection[];
}

interface FieldSelection {
  name: string;
  selections: FieldSelection[];
}

function parseGraphQLOperation(graphql: string): ParsedOperation | null {
  // Strip comments
  const cleaned = graphql.replace(/#[^\n]*/g, "");

  // Find operation keyword
  const opMatch = cleaned.match(
    /\b(query|mutation|subscription)\b\s*([A-Za-z_]\w*)?\s*(?:\([^)]*\))?\s*\{/,
  );

  // If no explicit operation keyword, assume it's a query if we see { at top level
  let operationType = "query";
  let operationName: string | null = null;
  let bodyStart: number;

  if (opMatch) {
    operationType = opMatch[1];
    operationName = opMatch[2] ?? null;
    bodyStart = opMatch.index! + opMatch[0].length - 1; // position of {
  } else {
    const braceIdx = cleaned.indexOf("{");
    if (braceIdx === -1) return null;
    bodyStart = braceIdx;
  }

  const rootFields = parseSelectionSet(cleaned, bodyStart);
  if (rootFields.length === 0) return null;

  return { operationType, operationName, rootFields };
}

/**
 * Parse a selection set starting at the opening brace.
 * Returns the field selections inside.
 */
function parseSelectionSet(src: string, bracePos: number): FieldSelection[] {
  const fields: FieldSelection[] = [];

  // Find the matching closing brace
  let depth = 0;
  let i = bracePos;
  if (src[i] !== "{") return fields;
  depth = 1;
  i++;

  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
      i++;
    } else if (ch === "}") {
      depth--;
      i++;
    } else if (depth === 1) {
      // At the top-level of this selection set — look for a field name
      const fieldMatch = src.slice(i).match(/^(\s*(?:\.\.\.\s+on\s+\w+\s*\{[\s\S]*?\}|\.\.\.\w+)\s*)/);
      if (fieldMatch) {
        // Fragment spread or inline fragment — skip for now
        i += fieldMatch[1].length;
        continue;
      }

      const nameMatch = src.slice(i).match(/^\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*/);
      if (nameMatch) {
        const fieldName = nameMatch[1];
        // Skip GraphQL keywords that aren't field names
        if (fieldName === "on" || fieldName === "fragment") {
          i += nameMatch[0].length;
          continue;
        }

        // Check for alias: `alias: fieldName`
        const afterName = i + nameMatch[0].length;
        let actualName = fieldName;

        // Handle alias pattern: aliasName: actualFieldName
        const aliasCheck = src.slice(afterName).match(/^:\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*/);
        if (aliasCheck) {
          actualName = aliasCheck[1];
          const subStart = afterName + aliasCheck[0].length;
          if (src[subStart] === "{") {
            const subFields = parseSelectionSet(src, subStart);
            fields.push({ name: actualName, selections: subFields });
            // Advance past the sub-selection
            i = skipSelectionSet(src, subStart);
          } else {
            fields.push({ name: actualName, selections: [] });
            i = subStart;
          }
        } else if (src[afterName] === "{") {
          const subFields = parseSelectionSet(src, afterName);
          fields.push({ name: actualName, selections: subFields });
          i = skipSelectionSet(src, afterName);
        } else {
          fields.push({ name: actualName, selections: [] });
          i = afterName;
        }
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return fields;
}

/** Skip past a balanced { ... } block, returning the position after the closing brace. */
function skipSelectionSet(src: string, bracePos: number): number {
  let depth = 0;
  let i = bracePos;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Field resolution against known contracts
// ---------------------------------------------------------------------------

function resolveSelections(
  selections: FieldSelection[],
  parentType: string,
  fieldContracts: Set<string>,
  typeReturnMap: Map<string, string>,
  referencedFields: string[],
  exact: boolean,
): void {
  for (const sel of selections) {
    const qualifiedName = `${parentType}.${sel.name}`;

    if (fieldContracts.has(qualifiedName)) {
      referencedFields.push(qualifiedName);
    } else if (!exact) {
      // Inferred match — still include it but it will get 0.8 confidence
      // at the edge level (handled by the caller/cross-indexer)
      referencedFields.push(qualifiedName);
    }

    // Recurse into nested selections
    if (sel.selections.length > 0) {
      // Try to find the return type for this field from endpoint map
      const returnType = typeReturnMap.get(qualifiedName);
      const childType = returnType ?? capitalize(sel.name);
      const childExact = returnType != null;
      resolveSelections(
        sel.selections,
        childType,
        fieldContracts,
        typeReturnMap,
        referencedFields,
        childExact,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the return type from a GraphQL field signature like "user(id: ID!): User!" */
function extractReturnType(signature: string): string | null {
  const m = signature.match(/:\s*\[?\s*([A-Za-z_]\w*)/);
  return m ? m[1] : null;
}

/** Capitalize the first letter of a string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compute 1-based line number at a character offset within content. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * Find the name of the enclosing function/component at a given offset.
 * Looks backwards for: function X, const X =, export function X, etc.
 */
function findEnclosingSymbol(content: string, offset: number): string {
  // Get the content before the offset
  const before = content.slice(0, offset);

  // Try to find the nearest function/const/class declaration
  // Search backwards through the lines
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 30; i--) {
    const line = lines[i];

    // function declaration
    const funcMatch = line.match(
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/,
    );
    if (funcMatch) return funcMatch[1];

    // arrow function / const assignment
    const constMatch = line.match(
      /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/,
    );
    if (constMatch) return constMatch[1];

    // class method
    const methodMatch = line.match(
      /^\s*(?:async\s+)?([A-Za-z_]\w*)\s*\(/,
    );
    if (methodMatch && methodMatch[1] !== "if" && methodMatch[1] !== "for" && methodMatch[1] !== "while") {
      return methodMatch[1];
    }
  }

  return "<module>";
}
