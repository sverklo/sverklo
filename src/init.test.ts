import { describe, it, expect } from "vitest";
import { resolveAgentsFileTarget, resolveCopilotInstructionsTarget } from "./init.js";

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

describe("resolveCopilotInstructionsTarget — issue #24", () => {
  const COPILOT_PATH = "/p/.github/copilot-instructions.md";

  it("skips silently when no signal is present (no .github/, no .vscode/, no extension)", () => {
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(COPILOT_PATH),
      githubDirExists: false,
      vscodeDirExists: false,
      copilotExtensionDetected: false,
      sentinel: SENTINEL,
    });
    expect(result).toEqual({ action: "skip-no-signal" });
  });

  it("creates the file when .github/ exists but the file does not", () => {
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(COPILOT_PATH),
      githubDirExists: true,
      vscodeDirExists: false,
      copilotExtensionDetected: false,
      sentinel: SENTINEL,
    });
    expect(result).toEqual({ action: "create", path: COPILOT_PATH });
  });

  it("creates the file when only .vscode/ exists (VS Code is THE Copilot host)", () => {
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(COPILOT_PATH),
      githubDirExists: false,
      vscodeDirExists: true,
      copilotExtensionDetected: false,
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("create");
  });

  it("creates the file when only the Copilot extension is detected", () => {
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(COPILOT_PATH),
      githubDirExists: false,
      vscodeDirExists: false,
      copilotExtensionDetected: true,
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("create");
  });

  it("appends when the file exists without the sverklo sentinel", () => {
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(COPILOT_PATH, "# project conventions\nUse 2-space indent.\n"),
      githubDirExists: true,
      vscodeDirExists: true,
      copilotExtensionDetected: true,
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("append");
    if (result.action !== "append") return;
    expect(result.existingContent).toContain("project conventions");
    expect(result.path).toBe(COPILOT_PATH);
  });

  it("skips when the file already contains the literal sentinel", () => {
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(
        COPILOT_PATH,
        "# project rules\nWhen searching, prefer sverklo_search over grep.\n"
      ),
      githubDirExists: true,
      vscodeDirExists: false,
      copilotExtensionDetected: false,
      sentinel: SENTINEL,
    });
    expect(result).toEqual({ action: "skip-already-present", path: COPILOT_PATH });
  });

  it("skips when the file has the heading sentinel even after the literal was hand-removed (Finding 7)", () => {
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(
        COPILOT_PATH,
        "# project rules\n\n## Sverklo — Code Intelligence\n\n(user removed the body)\n"
      ),
      githubDirExists: true,
      vscodeDirExists: false,
      copilotExtensionDetected: false,
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("skip-already-present");
  });

  it("treats existing-without-sentinel as append even when no other signal exists", () => {
    // If the user already created copilot-instructions.md, that itself
    // is a signal that they use Copilot — append regardless of dir checks.
    const result = resolveCopilotInstructionsTarget({
      projectPath: "/p",
      copilotFile: file(COPILOT_PATH, "# my rules\n"),
      githubDirExists: false,
      vscodeDirExists: false,
      copilotExtensionDetected: false,
      sentinel: SENTINEL,
    });
    expect(result.action).toBe("append");
  });
});
