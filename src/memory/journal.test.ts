import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryJournal } from "./journal.js";

describe("MemoryJournal", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "sverklo-journal-"));
  });

  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {}
  });

  it("creates the .sverklo directory and writes an append-only file", () => {
    const j = new MemoryJournal(projectRoot);
    j.remember({
      id: 1,
      content: "All timestamps are UTC.",
      category: "procedural",
      tags: ["timezone"],
      confidence: 1.0,
      git_sha: "abc123",
      git_branch: "main",
      related_files: ["src/time.ts"],
      tier: "core",
    });

    const path = join(projectRoot, ".sverklo", "memories.jsonl");
    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, "utf-8");
    expect(content.split("\n").filter(Boolean).length).toBe(1);

    const entry = JSON.parse(content.trim());
    expect(entry.op).toBe("remember");
    expect(entry.id).toBe(1);
    expect(entry.content).toBe("All timestamps are UTC.");
    expect(entry.tier).toBe("core");
    expect(entry.git_sha).toBe("abc123");
    expect(typeof entry.ts).toBe("string");
  });

  it("appends multiple operations in order", () => {
    const j = new MemoryJournal(projectRoot);
    j.remember({
      id: 1,
      content: "First",
      category: "decision",
      confidence: 1.0,
      tier: "archive",
    });
    j.promote(1, "core");
    j.forget(1);

    const path = join(projectRoot, ".sverklo", "memories.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);

    const ops = lines.map((l) => JSON.parse(l).op);
    expect(ops).toEqual(["remember", "promote", "forget"]);
  });

  it("records tombstones for forget so the journal stays replayable", () => {
    const j = new MemoryJournal(projectRoot);
    j.remember({ id: 5, content: "x", category: "context", confidence: 1.0, tier: "archive" });
    j.forget(5);

    const path = join(projectRoot, ".sverklo", "memories.jsonl");
    const content = readFileSync(path, "utf-8");
    // Second line is the tombstone — forget must not rewrite/truncate.
    expect(content).toContain('"op":"remember"');
    expect(content).toContain('"op":"forget"');
  });

  it("records invalidate with atSha and replacedById", () => {
    const j = new MemoryJournal(projectRoot);
    j.invalidate(3, "def456", 7);

    const path = join(projectRoot, ".sverklo", "memories.jsonl");
    const entry = JSON.parse(readFileSync(path, "utf-8").trim());
    expect(entry.op).toBe("invalidate");
    expect(entry.id).toBe(3);
    expect(entry.invalidated_at_sha).toBe("def456");
    expect(entry.replaced_by_id).toBe(7);
  });

  it("is robust to optional fields being undefined", () => {
    const j = new MemoryJournal(projectRoot);
    j.remember({
      id: 2,
      content: "minimal",
      category: "context",
      confidence: 1.0,
      tier: "archive",
    });
    const entry = JSON.parse(
      readFileSync(join(projectRoot, ".sverklo", "memories.jsonl"), "utf-8").trim()
    );
    expect(entry.tags).toBeNull();
    expect(entry.git_sha).toBeNull();
    expect(entry.related_files).toBeNull();
  });

  it("exposes the file path via filePath getter", () => {
    const j = new MemoryJournal(projectRoot);
    expect(j.filePath).toBe(join(projectRoot, ".sverklo", "memories.jsonl"));
  });
});
