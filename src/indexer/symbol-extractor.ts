/**
 * Extract symbol references from a chunk's content.
 *
 * This is a cheap, language-agnostic heuristic: find identifier-shaped tokens
 * that look like function calls (`foo(`) or class instantiations (`new Foo`).
 * We skip language keywords and self-references.
 *
 * It's not a type resolver — matches are by name. Multiple functions with the
 * same name across files will all appear as "impacted" when queried. That's
 * good enough for PageRank boosting and impact analysis, and significantly
 * cheaper than running a real LSP.
 */

// Keywords to skip — superset across supported languages
const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "function", "const", "let", "var", "class", "interface",
  "type", "enum", "struct", "trait", "impl", "fn", "def", "defn", "func",
  "public", "private", "protected", "static", "async", "await", "yield",
  "new", "this", "self", "super", "null", "undefined", "true", "false", "nil",
  "import", "export", "from", "as", "in", "of", "is", "and", "or", "not",
  "try", "catch", "finally", "throw", "throws", "raise", "except", "with",
  "pub", "use", "mod", "crate", "mut", "ref", "extern", "unsafe",
  "let", "end", "begin", "module", "object", "case", "match", "when", "then",
  "print", "println", "echo", "log", "require", "include", "namespace",
  // Common built-ins (avoid false positives)
  "console", "process", "Array", "Object", "String", "Number", "Boolean",
  "Map", "Set", "Promise", "Error", "Date", "Math", "JSON", "RegExp",
  "length", "push", "pop", "map", "filter", "reduce", "forEach", "slice",
  "split", "join", "concat", "includes", "indexOf", "find", "some", "every",
]);

// Built-in function names that produce too much noise
const COMMON_BUILTINS = new Set([
  "log", "info", "warn", "error", "debug", "print", "println", "printf",
  "assert", "expect", "test", "it", "describe", "beforeEach", "afterEach",
  "push", "pop", "shift", "unshift", "slice", "splice", "concat",
  "parseInt", "parseFloat", "toString", "valueOf",
]);

// Match identifier followed by `(` — likely a function call
// Also match `new Identifier` and `@Identifier` (decorators)
const CALL_RE = /\b([A-Z][a-zA-Z0-9_]{2,}|[a-z_][a-zA-Z0-9_]{2,})\s*\(/g;
const NEW_RE = /\bnew\s+([A-Z][a-zA-Z0-9_]{2,})/g;

/**
 * Extract referenced symbol names from a chunk's body.
 * Returns a list of { name, line } where line is 0-indexed offset within the chunk.
 */
export function extractReferences(
  content: string,
  selfName: string | null = null
): { name: string; line: number }[] {
  const refs: { name: string; line: number }[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    // Dedupe scope is per LINE, not per chunk.
    //
    // Issue #13: the old implementation used a chunk-wide `seen` set,
    // which meant a symbol called twice in the same function got one
    // symbol_ref row at the first call site — the second call was
    // silently dropped. That made sverklo_impact a lossy tool and
    // caused it to under-report blast radius on any real refactor.
    //
    // Per-line dedupe still catches the case where two regexes (CALL_RE
    // and NEW_RE) both fire on `new Foo()`, while letting repeat calls
    // across lines each contribute their own row. The (chunk, name,
    // line) UNIQUE constraint on symbol_refs prevents exact duplicates.
    const seenOnLine = new Set<string>();
    const line = lines[i];
    // Strip string literals and comments to reduce false positives
    const stripped = stripStringsAndComments(line);

    // Function calls: foo(), bar()
    let m: RegExpExecArray | null;
    CALL_RE.lastIndex = 0;
    while ((m = CALL_RE.exec(stripped)) !== null) {
      const name = m[1];
      if (
        name === selfName ||
        KEYWORDS.has(name) ||
        COMMON_BUILTINS.has(name) ||
        seenOnLine.has(name)
      ) continue;
      seenOnLine.add(name);
      refs.push({ name, line: i });
    }

    // Constructor calls: new Foo
    NEW_RE.lastIndex = 0;
    while ((m = NEW_RE.exec(stripped)) !== null) {
      const name = m[1];
      if (name === selfName || KEYWORDS.has(name) || seenOnLine.has(name)) continue;
      seenOnLine.add(name);
      refs.push({ name, line: i });
    }
  }

  return refs;
}

/**
 * Strip string literals, comments, and block comments from a line.
 * Not perfect (handles simple cases) but reduces noise a lot.
 */
function stripStringsAndComments(line: string): string {
  // Remove line comments
  line = line.replace(/\/\/.*$/, "");
  line = line.replace(/#.*$/, "");
  line = line.replace(/--.*$/, "");
  // Remove string literals (double, single, template)
  line = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  line = line.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  line = line.replace(/`(?:[^`\\]|\\.)*`/g, "``");
  return line;
}
