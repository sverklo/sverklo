import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  globalInstructionTargets,
  writeGlobalInstructionsTo,
  addSverkloToGitignore,
} from "./init-global.js";
import { SVERKLO_SNIPPET } from "./init.js";

// Issue #72 unit tests — exercise the pure-ish helpers extracted in
// init-global.ts. These do NOT spawn the CLI (that's the integration
// suite); they assert the per-step behavior directly.

describe("globalInstructionTargets", () => {
  it("returns ~/.claude/CLAUDE.md and ~/.codex/AGENTS.md relative to home", () => {
    const targets = globalInstructionTargets("/fake/home");
    const paths = targets.map((t) => t.path);
    expect(paths).toContain("/fake/home/.claude/CLAUDE.md");
    expect(paths).toContain("/fake/home/.codex/AGENTS.md");
    expect(targets).toHaveLength(2);
  });
});

describe("writeGlobalInstructionsTo — issue #72", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "sverklo-init-global-write-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });

  it("creates the target file (and parent dir) when it doesn't exist", () => {
    const target = { label: "~/.claude/CLAUDE.md", path: join(tmpHome, ".claude", "CLAUDE.md") };
    const result = writeGlobalInstructionsTo(target);
    expect(result.action).toBe("create");
    expect(existsSync(target.path)).toBe(true);
    const content = readFileSync(target.path, "utf-8");
    expect(content).toContain("Sverklo");
    expect(content).toContain("sverklo_search");
  });

  it("appends to an existing file that lacks the snippet", () => {
    const target = { label: "~/.claude/CLAUDE.md", path: join(tmpHome, ".claude", "CLAUDE.md") };
    mkdirSync(join(tmpHome, ".claude"));
    writeFileSync(target.path, "# my global rules\nno trailing newline");
    const result = writeGlobalInstructionsTo(target);
    expect(result.action).toBe("append");
    const content = readFileSync(target.path, "utf-8");
    expect(content).toContain("# my global rules");
    expect(content).toContain("sverklo_search");
  });

  it("is idempotent: a second call against the same file is a no-op skip (literal sentinel)", () => {
    const target = { label: "~/.codex/AGENTS.md", path: join(tmpHome, ".codex", "AGENTS.md") };
    const first = writeGlobalInstructionsTo(target);
    expect(first.action).toBe("create");
    const afterFirst = readFileSync(target.path, "utf-8");

    const second = writeGlobalInstructionsTo(target);
    expect(second.action).toBe("skip");
    if (second.action === "skip") {
      expect(second.reason).toBe("already-present");
    }
    expect(readFileSync(target.path, "utf-8")).toBe(afterFirst);
  });

  it("skips when the file already has a `## Sverklo` heading (user hand-edited the snippet)", () => {
    const target = { label: "~/.claude/CLAUDE.md", path: join(tmpHome, ".claude", "CLAUDE.md") };
    mkdirSync(join(tmpHome, ".claude"));
    // User kept the heading but stripped the literal "sverklo_search"
    // sentinel — the heading-sentinel regex should still catch it.
    writeFileSync(target.path, "# rules\n\n## Sverklo — my edits\nPrefer sverklo tools.\n");
    const result = writeGlobalInstructionsTo(target);
    expect(result.action).toBe("skip");
  });
});

describe("addSverkloToGitignore — extracted helper from initProject", () => {
  let tmpProject: string;

  beforeEach(() => {
    tmpProject = mkdtempSync(join(tmpdir(), "sverklo-init-global-gi-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpProject, { recursive: true, force: true });
    } catch {}
  });

  it("no-git: doesn't create a .gitignore in a non-git directory", () => {
    const result = addSverkloToGitignore(tmpProject);
    expect(result).toBe("no-git");
    expect(existsSync(join(tmpProject, ".gitignore"))).toBe(false);
  });

  it("created: creates .gitignore when .git/ exists but .gitignore doesn't", () => {
    mkdirSync(join(tmpProject, ".git"));
    const result = addSverkloToGitignore(tmpProject);
    expect(result).toBe("created");
    const content = readFileSync(join(tmpProject, ".gitignore"), "utf-8");
    expect(content).toContain(".sverklo/");
  });

  it("added: appends to an existing .gitignore that doesn't already cover .sverklo/", () => {
    writeFileSync(join(tmpProject, ".gitignore"), "node_modules/\ndist/\n");
    const result = addSverkloToGitignore(tmpProject);
    expect(result).toBe("added");
    const content = readFileSync(join(tmpProject, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".sverklo/");
  });

  it("already: idempotent when .sverklo/ is already in .gitignore", () => {
    writeFileSync(join(tmpProject, ".gitignore"), "node_modules/\n.sverklo/\n");
    const result = addSverkloToGitignore(tmpProject);
    expect(result).toBe("already");
    const content = readFileSync(join(tmpProject, ".gitignore"), "utf-8");
    // Should not have a second .sverklo/ line.
    const occurrences = content.match(/^\.sverklo\/?$/gm);
    expect(occurrences?.length).toBe(1);
  });
});

// Sanity: the snippet shared with initProject still contains the
// sentinel string our idempotency detector looks for. If someone
// rewrites SVERKLO_SNIPPET without "sverklo_search" in it, both
// initProject's and initGlobal's "already present" detection break.
describe("SVERKLO_SNIPPET sentinel invariant", () => {
  it("contains the literal sentinel `sverklo_search`", () => {
    expect(SVERKLO_SNIPPET).toContain("sverklo_search");
  });

  it("contains a `## Sverklo` heading for the secondary sentinel", () => {
    expect(SVERKLO_SNIPPET).toMatch(/^##\s+Sverklo\b/m);
  });
});
