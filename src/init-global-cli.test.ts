import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// CLI integration tests for issue #72 (`sverklo init --global`) and the
// follow-up `sverklo memory import` subcommand.
//
// Both new behaviors live at the CLI surface (bin/sverklo.ts), so we
// spawn the actual compiled binary and inspect file-system side-effects.
// HOME is overridden to a tmpdir so global writes happen in isolation;
// the project is also a tmpdir so registry + .gitignore side-effects
// stay local. Same pattern as src/registry/registry-cli.test.ts.

const SVERKLO_BIN = join(process.cwd(), "dist", "bin", "sverklo.js");

// Helpers --------------------------------------------------------------

function initGit(dir: string): void {
  const result = spawnSync("git", ["init", "-q"], { cwd: dir });
  if (result.status !== 0) {
    throw new Error("git init failed (test setup); is git installed?");
  }
}

describe("CLI: sverklo init --global (#72)", () => {
  let tmpHome: string;
  let projectDir: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "sverklo-init-global-home-"));
    projectDir = mkdtempSync(join(tmpdir(), "sverklo-init-global-proj-"));
    initGit(projectDir);
    // Drop a CLAUDE.md so the memory-import step has something to ingest
    // (when the model is on disk). Even without the model, presence of
    // this file shouldn't crash the run.
    writeFileSync(
      join(projectDir, "CLAUDE.md"),
      "# project rules\n\n## Architecture\n\nWe use SQLite for everything. Avoid Postgres unless absolutely required.\n",
      "utf-8"
    );
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });

  it("writes SVERKLO_SNIPPET to ~/.claude/CLAUDE.md and ~/.codex/AGENTS.md", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    execFileSync("node", [SVERKLO_BIN, "init", "--global", projectDir], { env, stdio: "pipe" });

    const claudeGlobal = join(tmpHome, ".claude", "CLAUDE.md");
    const codexGlobal = join(tmpHome, ".codex", "AGENTS.md");
    expect(existsSync(claudeGlobal)).toBe(true);
    expect(existsSync(codexGlobal)).toBe(true);
    expect(readFileSync(claudeGlobal, "utf-8")).toContain("sverklo_search");
    expect(readFileSync(codexGlobal, "utf-8")).toContain("sverklo_search");
  });

  it("registers the project in the global registry", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    execFileSync("node", [SVERKLO_BIN, "init", "--global", projectDir], { env, stdio: "pipe" });

    const registryPath = join(tmpHome, ".sverklo", "registry.json");
    expect(existsSync(registryPath)).toBe(true);
    const registry = JSON.parse(readFileSync(registryPath, "utf-8")).repos;
    const entries = Object.values(registry) as { path: string }[];
    expect(entries.some((e) => e.path === projectDir)).toBe(true);
  });

  it("adds .sverklo/ to the project's .gitignore", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    execFileSync("node", [SVERKLO_BIN, "init", "--global", projectDir], { env, stdio: "pipe" });

    const gi = join(projectDir, ".gitignore");
    expect(existsSync(gi)).toBe(true);
    expect(readFileSync(gi, "utf-8")).toContain(".sverklo/");
  });

  it("does NOT write per-project boilerplate (.mcp.json, project AGENTS.md, .claude/settings.local.json, skills, copilot)", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    execFileSync("node", [SVERKLO_BIN, "init", "--global", projectDir], { env, stdio: "pipe" });

    // These are the kitchen-sink artifacts `initProject` writes — none
    // of them should be touched by --global.
    expect(existsSync(join(projectDir, ".mcp.json"))).toBe(false);
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude", "settings.local.json"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(projectDir, ".github", "copilot-instructions.md"))).toBe(false);

    // Global Codex/Copilot/Antigravity configs should also be untouched
    // — these are what `initProject` writes, not what `--global` writes.
    expect(existsSync(join(tmpHome, ".codex", "config.toml"))).toBe(false);
    expect(existsSync(join(tmpHome, ".copilot", "mcp-config.json"))).toBe(false);
    expect(existsSync(join(tmpHome, ".gemini", "antigravity", "mcp_config.json"))).toBe(false);
  });

  it("does NOT overwrite a user's existing project CLAUDE.md", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    const projectClaudeMd = join(projectDir, "CLAUDE.md");
    const before = readFileSync(projectClaudeMd, "utf-8");
    execFileSync("node", [SVERKLO_BIN, "init", "--global", projectDir], { env, stdio: "pipe" });
    const after = readFileSync(projectClaudeMd, "utf-8");
    // Per spec: project AGENTS.md / CLAUDE.md must not be touched by --global.
    expect(after).toBe(before);
  });

  it("second --global call against a different project is idempotent on globals + still runs per-project bits", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    // First call against projectDir.
    execFileSync("node", [SVERKLO_BIN, "init", "--global", projectDir], { env, stdio: "pipe" });
    const claudeGlobal = join(tmpHome, ".claude", "CLAUDE.md");
    const firstGlobalContent = readFileSync(claudeGlobal, "utf-8");

    // Second call against a fresh project.
    const otherProject = mkdtempSync(join(tmpdir(), "sverklo-init-global-other-"));
    try {
      initGit(otherProject);
      execFileSync("node", [SVERKLO_BIN, "init", "--global", otherProject], { env, stdio: "pipe" });

      // Globals: byte-identical (no second snippet appended).
      const secondGlobalContent = readFileSync(claudeGlobal, "utf-8");
      expect(secondGlobalContent).toBe(firstGlobalContent);

      // Per-project bits ran for the second project too.
      expect(existsSync(join(otherProject, ".gitignore"))).toBe(true);
      expect(readFileSync(join(otherProject, ".gitignore"), "utf-8")).toContain(".sverklo/");

      const registry = JSON.parse(
        readFileSync(join(tmpHome, ".sverklo", "registry.json"), "utf-8")
      ).repos;
      const paths = (Object.values(registry) as { path: string }[]).map((e) => e.path);
      expect(paths).toContain(projectDir);
      expect(paths).toContain(otherProject);
    } finally {
      try { rmSync(otherProject, { recursive: true, force: true }); } catch {}
    }
  });
});

describe("CLI: sverklo memory import (#72 follow-up)", () => {
  let tmpHome: string;
  let projectDir: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "sverklo-memory-import-home-"));
    projectDir = mkdtempSync(join(tmpdir(), "sverklo-memory-import-proj-"));
    initGit(projectDir);
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });

  it("subcommand exists and exits zero with a path argument", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    writeFileSync(
      join(projectDir, "CLAUDE.md"),
      "# rules\n\n## Style\n\nPrefer functional code.\n",
      "utf-8"
    );
    // Pre-PR, `memory import` was an unknown subcommand and printed the
    // help blurb without doing anything. We assert it RUNS to completion
    // and exits zero — that's only true once the dispatcher branch is
    // wired up.
    const out = execFileSync("node", [SVERKLO_BIN, "memory", "import", projectDir], {
      env,
      stdio: "pipe",
    }).toString();
    // Output should be either "Imported N memories" or the "nothing
    // imported" path — never the generic memory-help blurb (which would
    // contain the bullet "show     print all memories…"). Asserting
    // negative match is the cleanest pre-/post-PR discriminator.
    expect(out).not.toMatch(/Subcommands:\s+show\s+print all/);
  });

  it("prints --help text describing the subcommand", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    const out = execFileSync("node", [SVERKLO_BIN, "memory", "import", "--help"], {
      env,
      stdio: "pipe",
    }).toString();
    expect(out).toMatch(/sverklo memory import/);
    expect(out).toMatch(/scan/i);
  });

  it("`memory` help blurb lists the import subcommand", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    // Pre-PR, `sverklo memory` (no subcommand) listed only show/edit/export.
    // Post-PR, it includes `import`.
    const out = execFileSync("node", [SVERKLO_BIN, "memory"], { env, stdio: "pipe" }).toString();
    expect(out).toMatch(/\bimport\b/);
  });
});
