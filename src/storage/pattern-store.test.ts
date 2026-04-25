import { describe, it, expect } from "vitest";
import { createDatabase } from "./database.js";
import { PatternStore, PATTERN_TAXONOMY } from "./pattern-store.js";

function mkDb() {
  const db = createDatabase(":memory:");
  // Create a chunk row so foreign-key references resolve.
  db.exec(`
    INSERT INTO files (id, path, hash, last_modified, size_bytes, indexed_at)
      VALUES (1, 'src/x.ts', 'h', 0, 100, 0);
    INSERT INTO chunks (id, file_id, type, name, signature, start_line, end_line, content, description, token_count)
      VALUES (1, 1, 'class', 'Observer', null, 1, 10, 'class Observer{}', null, 50);
    INSERT INTO chunks (id, file_id, type, name, signature, start_line, end_line, content, description, token_count)
      VALUES (2, 1, 'class', 'UserRepository', null, 11, 20, 'class UserRepository{}', null, 50);
  `);
  return db;
}

describe("PatternStore", () => {
  it("rejects rows with a pattern not in the closed taxonomy", () => {
    const db = mkDb();
    const store = new PatternStore(db);
    store.upsert({
      chunk_id: 1,
      pattern: "made_up_pattern",
      role: null,
      confidence: 0.9,
      content_hash: "h",
    });
    expect(store.count()).toBe(0);
  });

  it("upserts and reads back valid taxonomy rows", () => {
    const db = mkDb();
    const store = new PatternStore(db);
    store.upsert({
      chunk_id: 1, pattern: "observer", role: "subject", confidence: 0.85, content_hash: "h",
    });
    store.upsert({
      chunk_id: 2, pattern: "repository", role: null, confidence: 0.9, content_hash: "h",
    });
    expect(store.count()).toBe(2);

    const obs = store.getByPattern("observer");
    expect(obs).toHaveLength(1);
    expect(obs[0].role).toBe("subject");
    expect(obs[0].symbol_name).toBe("Observer");

    const repo = store.getByPattern("repository");
    expect(repo[0].symbol_name).toBe("UserRepository");
  });

  it("upsertMany commits multiple rows atomically", () => {
    const db = mkDb();
    const store = new PatternStore(db);
    store.upsertMany([
      { chunk_id: 1, pattern: "observer", role: null, confidence: 0.7, content_hash: "h" },
      { chunk_id: 2, pattern: "repository", role: null, confidence: 0.8, content_hash: "h" },
    ]);
    expect(store.count()).toBe(2);
  });

  it("getByPattern with unknown pattern returns []", () => {
    const db = mkDb();
    const store = new PatternStore(db);
    expect(store.getByPattern("nope")).toHaveLength(0);
  });

  it("PATTERN_TAXONOMY contains expected core patterns", () => {
    expect(PATTERN_TAXONOMY).toContain("observer");
    expect(PATTERN_TAXONOMY).toContain("repository");
    expect(PATTERN_TAXONOMY).toContain("validator");
    // Closed list — no surprises
    expect(PATTERN_TAXONOMY.length).toBeGreaterThan(20);
    expect(PATTERN_TAXONOMY.length).toBeLessThan(50);
  });
});
