import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { handleAuditDiff } from "../../src/audit-diff/index.js";

// Integration tests use the real Indexer + SQLite stack. They exercise
// the full pipeline (US1 cycles, US2 fan-in, US3 hook/CI ergonomics)
// against synthetic git repos so behavior is reproducible across OSes.

function shell(cwd: string, ...args: string[]): { stdout: string; status: number } {
  const r = spawnSync(args[0]!, args.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return { stdout: r.stdout, status: r.status ?? -1 };
}

function initGitRepo(dir: string) {
  shell(dir, "git", "init", "-q");
  shell(dir, "git", "config", "user.email", "t@t");
  shell(dir, "git", "config", "user.name", "t");
  shell(dir, "git", "config", "commit.gpgsign", "false");
}

function commitAll(dir: string, msg: string) {
  shell(dir, "git", "add", ".");
  shell(dir, "git", "commit", "-q", "-m", msg);
}

interface CaptureIO {
  out: string[];
  err: string[];
}

function captureIO(): { io: { stdout: (s: string) => void; stderr: (s: string) => void }; captured: CaptureIO } {
  const captured: CaptureIO = { out: [], err: [] };
  return {
    io: {
      stdout: (s) => captured.out.push(s),
      stderr: (s) => captured.err.push(s),
    },
    captured,
  };
}

async function indexProject(projectPath: string) {
  const { getProjectConfig } = await import("../../src/utils/config.js");
  const { Indexer } = await import("../../src/indexer/indexer.js");
  // Tests run without the embedding model downloaded — we don't need
  // semantic search for audit-diff. Stub the embedder path with a
  // null-provider so indexing only writes file + dependency rows.
  process.env.SVERKLO_EMBEDDING_PROVIDER = "null";
  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();
  if (typeof (indexer as { close?: () => void }).close === "function") {
    (indexer as unknown as { close: () => void }).close();
  }
}

describe("audit-diff integration", () => {
  it("US1-AS2: clean diff exits 0 with no output", { timeout: 30000 }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-integ-"));
    try {
      initGitRepo(tmp);
      mkdirSync(join(tmp, "src"));
      writeFileSync(join(tmp, "src/a.ts"), 'export const a = 1;\n');
      writeFileSync(join(tmp, "src/b.ts"), 'export const b = 2;\n');
      commitAll(tmp, "init");
      await indexProject(tmp);

      // Make a benign change.
      writeFileSync(join(tmp, "src/a.ts"), 'export const a = 1;\nexport const a2 = 2;\n');

      const { io, captured } = captureIO();
      const exit = await handleAuditDiff([tmp], io);
      expect(exit).toBe(0);
      expect(captured.out.join("")).toBe("");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("US1-AS1: diff introducing a cycle exits 1 with both file paths", { timeout: 30000 }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-integ-"));
    try {
      initGitRepo(tmp);
      mkdirSync(join(tmp, "src"));
      writeFileSync(join(tmp, "src/a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
      writeFileSync(join(tmp, "src/b.ts"), 'export const b = 1;\n');
      commitAll(tmp, "init");
      await indexProject(tmp);

      // Working-tree edit: b.ts now imports a.ts → cycle.
      writeFileSync(join(tmp, "src/b.ts"), 'import { a } from "./a.js";\nexport const b = a;\n');

      const { io, captured } = captureIO();
      const exit = await handleAuditDiff([tmp], io);
      expect(exit).toBe(1);
      const out = captured.out.join("");
      expect(out).toContain("cycle");
      expect(out).toContain("a.ts");
      expect(out).toContain("b.ts");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("US3: --format json emits schema_version 1 and matches contract", { timeout: 30000 }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-integ-"));
    try {
      initGitRepo(tmp);
      mkdirSync(join(tmp, "src"));
      writeFileSync(join(tmp, "src/a.ts"), 'export const a = 1;\n');
      commitAll(tmp, "init");
      await indexProject(tmp);

      writeFileSync(join(tmp, "src/a.ts"), 'export const a = 2;\n');

      const { io, captured } = captureIO();
      const exit = await handleAuditDiff([tmp, "--format", "json"], io);
      expect(exit).toBe(0);
      const parsed = JSON.parse(captured.out.join(""));
      expect(parsed.schema_version).toBe("1");
      expect(parsed.pass).toBe(true);
      expect(Array.isArray(parsed.violations)).toBe(true);
      expect(typeof parsed.stats.elapsed_ms).toBe("number");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("config error: missing index exits 2 with a helpful message", { timeout: 10000 }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-integ-"));
    try {
      initGitRepo(tmp);
      writeFileSync(join(tmp, "README.md"), "init");
      commitAll(tmp, "init");
      // No indexProject call — DB doesn't exist.

      const { io, captured } = captureIO();
      const exit = await handleAuditDiff([tmp], io);
      expect(exit).toBe(2);
      expect(captured.out.join("")).toMatch(/no graph index found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Skip this whole suite when SVERKLO_SKIP_AUDIT_DIFF_INTEG is set —
// gives a quick escape hatch on systems where index building is slow.
if (process.env.SVERKLO_SKIP_AUDIT_DIFF_INTEG) {
  describe.skip("audit-diff integration (skipped via env)", () => {
    it("noop", () => {
      expect(true).toBe(true);
    });
  });
}

// Sanity check the empty test if the tmpfile helper itself is broken.
describe("integration helpers", () => {
  it("creates and cleans a temp dir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-helper-"));
    expect(existsSync(tmp)).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
    expect(existsSync(tmp)).toBe(false);
  });
});
