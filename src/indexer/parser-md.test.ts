import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./parser-md.js";

function parse(md: string) {
  return parseMarkdown(md, md.split("\n"));
}

describe("parseMarkdown", () => {
  it("emits a single doc_section for a file with no headings", () => {
    const md = "Just some prose.\nNo headings here.\n";
    const { chunks } = parse(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("doc_section");
    expect(chunks[0].name).toBe("(root)");
  });

  it("splits at H1 / H2 / H3 boundaries and carries a breadcrumb", () => {
    const md = [
      "# Architecture",
      "Intro paragraph.",
      "## Retrieval",
      "Retrieval talk.",
      "### RRF",
      "RRF details.",
      "## Indexing",
      "Indexing talk.",
    ].join("\n");

    const sections = parse(md).chunks.filter((c) => c.type === "doc_section");
    const names = sections.map((c) => c.name);
    expect(names).toEqual(["Architecture", "Retrieval", "RRF", "Indexing"]);

    const rrf = sections.find((c) => c.name === "RRF")!;
    expect(rrf.signature).toBe("Architecture > Retrieval > RRF");

    const indexing = sections.find((c) => c.name === "Indexing")!;
    expect(indexing.signature).toBe("Architecture > Indexing");
  });

  it("emits fenced code blocks as doc_code sub-chunks with breadcrumb", () => {
    const md = [
      "# Architecture",
      "## Retrieval",
      "Use the RRF formula:",
      "```python",
      "def rrf(a, b, k=60):",
      "    return 1 / (k + rank)",
      "```",
      "",
    ].join("\n");

    const { chunks } = parse(md);
    const codes = chunks.filter((c) => c.type === "doc_code");
    expect(codes).toHaveLength(1);
    expect(codes[0].name).toBe("python");
    expect(codes[0].signature).toBe("Architecture > Retrieval");
    expect(codes[0].content).toContain("def rrf");
  });

  it("pops breadcrumb stack when a higher-level heading appears", () => {
    const md = [
      "# Top",
      "content",
      "## Mid",
      "content",
      "### Deep",
      "content",
      "## SecondMid",
      "content",
    ].join("\n");

    const sections = parse(md).chunks.filter((c) => c.type === "doc_section");
    const secondMid = sections.find((c) => c.name === "SecondMid")!;
    // Deep should NOT appear in SecondMid's breadcrumb
    expect(secondMid.signature).toBe("Top > SecondMid");
  });

  it("handles headings with trailing whitespace and ignores non-heading hash lines", () => {
    const md = [
      "#   Spacey Title   ",
      "prose",
      "not a # heading (inline)",
      "```text",
      "# this is inside a code block",
      "```",
    ].join("\n");

    const sections = parse(md).chunks.filter((c) => c.type === "doc_section");
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("Spacey Title");
  });
});
