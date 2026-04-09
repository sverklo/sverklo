import { describe, it, expect } from "vitest";
import { extractReferences } from "./symbol-extractor.js";

// Regression test for github.com/sverklo/sverklo/issues/13.
//
// The old implementation used a chunk-wide `seen` set to dedupe
// references. That made sverklo_impact lossy: a symbol called N
// times in the same function returned only one row, pointing at
// the first call site. For refactor safety — the whole point of
// the impact tool — this was the worst possible failure mode:
// the user trusted the output, made the refactor, missed N-1 real
// call sites, shipped the bug.
//
// The fix: per-line dedupe (still prevents double-counting when
// two regexes both fire on the same line, e.g. `new Foo()` or
// `Foo(Foo())`) while letting repeat calls across lines each
// contribute their own symbol_ref row.

describe("extractReferences — issue #13 regression", () => {
  it("records multiple call sites of the same symbol across lines", () => {
    const content = [
      "function index() {",
      "  const vectors = await embed(texts);",
      "  // ...",
      "  const [vector] = await embed([text]);",
      "  return vectors;",
      "}",
    ].join("\n");

    const refs = extractReferences(content, "index");
    const embedRefs = refs.filter((r) => r.name === "embed");

    expect(embedRefs.length).toBe(2);
    expect(embedRefs[0].line).toBe(1);
    expect(embedRefs[1].line).toBe(3);
  });

  it("still dedupes the same symbol on the same line (regex collision guard)", () => {
    // A line with two occurrences of the same identifier should
    // still produce only one ref entry — per-line dedupe survives.
    const content = ["function outer() {", "  return foo(foo(x));", "}"].join("\n");

    const refs = extractReferences(content, "outer");
    const fooRefs = refs.filter((r) => r.name === "foo");
    // Exactly one foo ref on line 1 — not two from the nested call.
    expect(fooRefs.length).toBe(1);
  });

  it("records calls in distinct branches as distinct refs", () => {
    const content = [
      "function handle(x) {",
      "  if (x > 0) {",
      "    publish(x);",
      "  } else {",
      "    publish(null);",
      "  }",
      "}",
    ].join("\n");

    const refs = extractReferences(content, "handle");
    const publishRefs = refs.filter((r) => r.name === "publish");
    expect(publishRefs.length).toBe(2);
  });

  it("does not record a self-reference when selfName matches", () => {
    const content = ["function fact(n) {", "  return n * fact(n - 1);", "}"].join("\n");

    const refs = extractReferences(content, "fact");
    expect(refs.filter((r) => r.name === "fact").length).toBe(0);
  });

  it("strips string literals before matching", () => {
    // `foo` in a string is not a real call — must not be recorded.
    const content = [
      "function log() {",
      "  const msg = 'foo was called here';",
      '  const other = "foo";',
      "  foo();",
      "}",
    ].join("\n");

    const refs = extractReferences(content, "log");
    const fooRefs = refs.filter((r) => r.name === "foo");
    // Only the real call on the last line.
    expect(fooRefs.length).toBe(1);
    expect(fooRefs[0].line).toBe(3);
  });

  it("strips line comments before matching", () => {
    const content = [
      "function test() {",
      "  // foo() is not actually called here",
      "  bar();",
      "}",
    ].join("\n");

    const refs = extractReferences(content, "test");
    expect(refs.some((r) => r.name === "foo")).toBe(false);
    expect(refs.some((r) => r.name === "bar")).toBe(true);
  });
});
