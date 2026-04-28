import { describe, it, expect } from "vitest";
import { resolveAgentsFileTarget } from "./init.js";

const SENTINEL = "sverklo_search";

function file(path: string, content?: string) {
  return content === undefined
    ? { exists: false, content: "", path }
    : { exists: true, content, path };
}

describe("resolveAgentsFileTarget — issue #19", () => {
  it("creates CLAUDE.md when neither file exists", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md"),
      agentsMd: file("/p/AGENTS.md"),
      sentinel: SENTINEL,
    });
    expect(result).toEqual({
      action: "create-claude-md",
      fileName: "CLAUDE.md",
      path: "/p/CLAUDE.md",
    });
  });

  it("appends to CLAUDE.md when only CLAUDE.md exists (legacy behavior preserved)", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md", "# my project rules\n"),
      agentsMd: file("/p/AGENTS.md"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("append");
    if (result.action !== "append") return;
    expect(result.fileName).toBe("CLAUDE.md");
    expect(result.existingContent).toBe("# my project rules\n");
  });

  it("appends to AGENTS.md when only AGENTS.md exists", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md"),
      agentsMd: file("/p/AGENTS.md", "# universal agent rules\n"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("append");
    if (result.action !== "append") return;
    expect(result.fileName).toBe("AGENTS.md");
    expect(result.existingContent).toBe("# universal agent rules\n");
  });

  it("prefers AGENTS.md when both files exist (universal convention wins)", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md", "# claude rules\n"),
      agentsMd: file("/p/AGENTS.md", "# agents rules\n"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("append");
    if (result.action !== "append") return;
    expect(result.fileName).toBe("AGENTS.md");
  });

  it("annotates the message when CLAUDE.md is a delegation stub (Ruslan's exact case)", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md", "READ THE AGENTS.md FOR THE COMPREHENSIVE INSTRUCTIONS TO FOLLOW"),
      agentsMd: file("/p/AGENTS.md", "# real instructions live here\n"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("append");
    if (result.action !== "append") return;
    expect(result.fileName).toBe("AGENTS.md");
    expect(result.note).toMatch(/delegates to AGENTS\.md/);
  });

  it("notes that CLAUDE.md is left alone even when CLAUDE.md doesn't reference AGENTS.md", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md", "# claude-specific only — no AGENTS reference\n"),
      agentsMd: file("/p/AGENTS.md", "# canonical\n"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("append");
    if (result.action !== "append") return;
    expect(result.fileName).toBe("AGENTS.md");
    expect(result.note).toMatch(/canonical/);
  });

  it("skips when AGENTS.md already has the sentinel (idempotent)", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md", "# unrelated\n"),
      agentsMd: file("/p/AGENTS.md", "## Sverklo\n- sverklo_search ...\n"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("skip");
    if (result.action !== "skip") return;
    expect(result.fileName).toBe("AGENTS.md");
  });

  it("skips when CLAUDE.md already has the sentinel and AGENTS.md doesn't exist (legacy idempotent)", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md", "## Sverklo\n- sverklo_search ...\n"),
      agentsMd: file("/p/AGENTS.md"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("skip");
    if (result.action !== "skip") return;
    expect(result.fileName).toBe("CLAUDE.md");
  });

  it("when both files exist and only AGENTS.md has the sentinel, skips (don't double-write)", () => {
    const result = resolveAgentsFileTarget({
      projectPath: "/p",
      claudeMd: file("/p/CLAUDE.md", "# claude rules\n"),
      agentsMd: file("/p/AGENTS.md", "## Sverklo\n- sverklo_search ...\n"),
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("skip");
    if (result.action !== "skip") return;
    expect(result.fileName).toBe("AGENTS.md");
  });

  it("AGENTS.md detection is case-insensitive on the delegation reference", () => {
    // Real-world CLAUDE.md files refer to "AGENTS.md", "agents.md",
    // "Agents.md" etc. interchangeably.
    const variants = ["AGENTS.md", "agents.md", "Agents.md", "see the AgEnTs.md file"];
    for (const variant of variants) {
      const result = resolveAgentsFileTarget({
        projectPath: "/p",
        claudeMd: file("/p/CLAUDE.md", `please read ${variant} for instructions`),
        agentsMd: file("/p/AGENTS.md", "# canonical\n"),
        sentinel: SENTINEL,
      });
      expect(result.action).toBe("append");
      if (result.action !== "append") continue;
      expect(result.note, `variant=${variant}`).toMatch(/delegates to AGENTS\.md/);
    }
  });
});
