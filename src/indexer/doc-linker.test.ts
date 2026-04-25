import { describe, it, expect } from "vitest";
import { extractMentions } from "./doc-linker.js";
import type { CodeChunk } from "../types/index.js";

function mkDoc(content: string, type: "doc_section" | "doc_code" = "doc_section"): CodeChunk {
  return {
    id: 1,
    file_id: 10,
    type,
    name: "Section",
    signature: "Docs > Section",
    start_line: 1,
    end_line: 20,
    content,
    description: null,
    token_count: 100,
  };
}

describe("extractMentions", () => {
  it("pulls backtick identifiers as high-confidence", () => {
    const doc = mkDoc(
      "The `parseFile` function reads `content` and returns a `ParseResult`."
    );
    const known = new Set<string>();
    const out = extractMentions(doc, known);
    const names = out.map((m) => m.symbol).sort();
    expect(names).toContain("parseFile");
    expect(names).toContain("ParseResult");
    // All backtick hits are confidence 1.0
    for (const m of out) {
      expect(m.confidence).toBe(1.0);
      expect(m.kind).toBe("backtick");
    }
  });

  it("extracts dotted paths and emits both head and full", () => {
    const doc = mkDoc("Use `Foo.bar()` for the result.");
    const out = extractMentions(doc, new Set());
    const names = out.map((m) => m.symbol).sort();
    expect(names).toContain("Foo");
    expect(names).toContain("bar");
    expect(names).toContain("Foo.bar");
  });

  it("only harvests fenced-code identifiers that are known top symbols", () => {
    const doc = mkDoc(
      [
        "# Example",
        "",
        "```ts",
        "const result = parseFile(content);",
        "const ignored = makeUpName(); // not a real symbol",
        "```",
      ].join("\n")
    );
    const known = new Set(["parseFile"]);
    const out = extractMentions(doc, known);
    const parseHit = out.find((m) => m.symbol === "parseFile");
    expect(parseHit).toBeTruthy();
    // Could be raised to backtick if the same name appears in backticks too,
    // but here it's only inside the fence.
    expect(parseHit!.kind).toBe("fenced_code");
    expect(parseHit!.confidence).toBe(0.8);
    expect(out.find((m) => m.symbol === "makeUpName")).toBeUndefined();
  });

  it("bare-match requires ≥2 known symbols in the same paragraph", () => {
    const single = mkDoc("We use Authenticator to validate tokens.");
    const paired = mkDoc("Authenticator collaborates with SessionStore to issue JWTs.");
    const known = new Set(["Authenticator", "SessionStore"]);

    expect(extractMentions(single, known).find((m) => m.symbol === "Authenticator")).toBeUndefined();
    const out = extractMentions(paired, known);
    expect(out.find((m) => m.symbol === "Authenticator")?.kind).toBe("bare");
    expect(out.find((m) => m.symbol === "SessionStore")?.kind).toBe("bare");
  });

  it("upgrades confidence when the same symbol appears under multiple kinds", () => {
    const doc = mkDoc(
      [
        "Use `parseFile` in your pipeline.",
        "",
        "```ts",
        "parseFile(src);",
        "```",
      ].join("\n")
    );
    const known = new Set(["parseFile"]);
    const out = extractMentions(doc, known);
    const hit = out.find((m) => m.symbol === "parseFile")!;
    // backtick (1.0) wins over fenced_code (0.8)
    expect(hit.confidence).toBe(1.0);
    expect(hit.kind).toBe("backtick");
  });

  it("doc_code chunks treat their entire body as fenced code", () => {
    const doc = mkDoc("parseFile(x);\nmakeUpName();", "doc_code");
    const known = new Set(["parseFile"]);
    const out = extractMentions(doc, known);
    const names = out.map((m) => m.symbol);
    expect(names).toContain("parseFile");
    expect(names).not.toContain("makeUpName");
  });
});
