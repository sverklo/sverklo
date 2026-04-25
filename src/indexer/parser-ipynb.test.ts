import { describe, it, expect } from "vitest";
import { parseIpynb } from "./parser-ipynb.js";

function parse(json: object) {
  const text = JSON.stringify(json);
  return parseIpynb(text, text.split("\n"));
}

describe("parseIpynb", () => {
  it("emits one block chunk per code cell", () => {
    const { chunks } = parse({
      cells: [
        { cell_type: "code", source: "x = 1\nprint(x)" },
        { cell_type: "code", source: "y = 2" },
      ],
      metadata: { language_info: { name: "python" } },
    });
    const codeBlocks = chunks.filter((c) => c.type === "block");
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0].name).toBe("cell_0_code");
    expect(codeBlocks[0].content).toContain("x = 1");
    expect(codeBlocks[1].name).toBe("cell_1_code");
  });

  it("parses markdown cells as doc_section chunks with breadcrumbs", () => {
    const { chunks } = parse({
      cells: [
        { cell_type: "markdown", source: "# Setup\n\nIntro." },
        { cell_type: "markdown", source: "## Imports\n\nWe use pandas." },
      ],
    });
    const sections = chunks.filter((c) => c.type === "doc_section");
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.find((c) => c.name === "Setup")).toBeTruthy();
    const imports = sections.find((c) => c.name === "Imports");
    expect(imports?.signature).toContain("Imports");
  });

  it("handles array-typed cell.source", () => {
    const { chunks } = parse({
      cells: [{ cell_type: "code", source: ["x = 1\n", "print(x)"] }],
    });
    const block = chunks.find((c) => c.type === "block");
    expect(block).toBeTruthy();
    expect(block!.content).toContain("x = 1");
    expect(block!.content).toContain("print(x)");
  });

  it("falls back to a single block for malformed JSON", () => {
    const text = "not actually json";
    const { chunks } = parseIpynb(text, text.split("\n"));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("block");
    expect(chunks[0].name).toBe("ipynb");
  });

  it("emits a placeholder chunk for an empty notebook", () => {
    const { chunks } = parse({ cells: [] });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].name).toBe("ipynb-empty");
  });
});
