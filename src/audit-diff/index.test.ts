import { describe, it, expect } from "vitest";
import { parseFlags, runAuditDiff } from "./index.js";
import type { GraphReader, FilePathResolver } from "./boundary.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

describe("parseFlags", () => {
  it("returns defaults when no args", () => {
    const r = parseFlags([], "/tmp/x");
    expect(r.error).toBeNull();
    expect(r.options).toMatchObject({
      baseRef: "HEAD",
      fanInThreshold: 50,
      format: "human",
      showExisting: false,
      verbose: false,
      projectPath: "/tmp/x",
    });
  });

  it("parses --against", () => {
    const r = parseFlags(["--against", "main"], "/tmp/x");
    expect(r.options?.baseRef).toBe("main");
  });

  it("parses --fan-in-threshold", () => {
    const r = parseFlags(["--fan-in-threshold", "30"], "/tmp/x");
    expect(r.options?.fanInThreshold).toBe(30);
  });

  it("rejects invalid --fan-in-threshold", () => {
    const r = parseFlags(["--fan-in-threshold", "abc"], "/tmp/x");
    expect(r.error).toMatch(/invalid --fan-in-threshold/);
  });

  it("parses --format json", () => {
    const r = parseFlags(["--format", "json"], "/tmp/x");
    expect(r.options?.format).toBe("json");
  });

  it("rejects unknown --format", () => {
    const r = parseFlags(["--format", "xml"], "/tmp/x");
    expect(r.error).toMatch(/invalid --format/);
  });

  it("parses --show-existing and --verbose", () => {
    const r = parseFlags(["--show-existing", "--verbose"], "/tmp/x");
    expect(r.options?.showExisting).toBe(true);
    expect(r.options?.verbose).toBe(true);
  });

  it("rejects unknown flags", () => {
    const r = parseFlags(["--bogus"], "/tmp/x");
    expect(r.error).toMatch(/unknown flag/);
  });
});

function initRepo(dir: string) {
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
}

function commitAll(dir: string, msg: string) {
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", msg], { cwd: dir });
}

describe("runAuditDiff (pure pipeline)", () => {
  it("returns pass + EXIT_PASS on an empty diff", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-pipe-"));
    try {
      initRepo(tmp);
      writeFileSync(join(tmp, "README.md"), "init");
      commitAll(tmp, "init");

      const graph: GraphReader = {
        getImports: () => [],
        getImporters: () => [],
      };
      const resolver: FilePathResolver = {
        pathToId: () => null,
        idToPath: () => null,
      };
      const { report, exitCode } = runAuditDiff(
        {
          baseRef: "HEAD",
          fanInThreshold: 50,
          format: "human",
          showExisting: false,
          verbose: false,
          projectPath: tmp,
        },
        { graph, resolver, dbPath: join(tmp, "nonexistent.db") },
      );
      expect(exitCode).toBe(0);
      expect(report.pass).toBe(true);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("flags a new cycle as a gate failure", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-pipe-"));
    try {
      initRepo(tmp);
      mkdirSync(join(tmp, "src"));
      // Pre-state: a.ts → b.ts (no cycle)
      writeFileSync(join(tmp, "src/a.ts"), 'import x from "./b.js";\n');
      writeFileSync(join(tmp, "src/b.ts"), "");
      commitAll(tmp, "init");

      // Working-tree edit: b.ts now imports a.ts → cycle.
      writeFileSync(join(tmp, "src/b.ts"), 'import y from "./a.js";\n');

      // Fake graph reflects the PRE state (a → b only).
      const graph: GraphReader = {
        getImports: (id) => (id === 1 ? [{ source_file_id: 1, target_file_id: 2, reference_count: 1 }] : []),
        getImporters: (id) => (id === 2 ? [{ source_file_id: 1, target_file_id: 2, reference_count: 1 }] : []),
      };
      const paths: Record<number, string> = { 1: "src/a.ts", 2: "src/b.ts" };
      const resolver: FilePathResolver = {
        pathToId: (p) => {
          for (const [id, path] of Object.entries(paths)) {
            if (path === p) return Number(id);
          }
          return null;
        },
        idToPath: (id) => paths[id] ?? null,
      };

      const { report, exitCode } = runAuditDiff(
        {
          baseRef: "HEAD",
          fanInThreshold: 50,
          format: "human",
          showExisting: false,
          verbose: false,
          projectPath: tmp,
        },
        { graph, resolver, dbPath: join(tmp, "nonexistent.db") },
      );
      expect(exitCode).toBe(1);
      expect(report.pass).toBe(false);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.kind).toBe("cycle");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
