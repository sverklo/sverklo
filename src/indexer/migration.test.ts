import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "./indexer.js";
import { getProjectConfig } from "../utils/config.js";
import {
  createDatabase,
  getDataVersion,
  setDataVersion,
  CURRENT_DATA_VERSION,
} from "../storage/database.js";

// Tests for the data-version migration runner (issue #13 rollout).
//
// Scenario: a user upgrades from v0.2.13 (where symbol_refs rows
// were lossy due to chunk-wide dedupe) to v0.2.14 (where the bug
// is fixed). Their existing index is still lossy until we re-extract
// references from the chunks we already have.
//
// The migration:
//   1. runs on Indexer construction if stored data_version < 2
//   2. drops all symbol_refs rows
//   3. re-runs extractReferences over every chunk.content already in the db
//   4. stamps data_version = 2 so subsequent constructions are a no-op

describe("data-version migration", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-migration-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    // A file with a symbol called twice in the same function.
    // Under v0.2.13, extractReferences would produce ONE symbol_ref
    // row for 'helper' from this function, not two.
    //
    // Note: we use `declare function` for helper rather than a real
    // definition because the current chunker only chunks the first
    // top-level function when a file has multiple — that's a
    // separate bug worth filing, but not blocking the migration
    // tests here.
    writeFileSync(
      join(tmpRoot, "src", "a.ts"),
      [
        "declare function helper(): number;",
        "export function run() {",
        "  const a = helper();",
        "  const b = helper();",
        "  return a + b;",
        "}",
      ].join("\n"),
      "utf-8"
    );
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  it("fresh database stamps data_version = CURRENT_DATA_VERSION on first index", async () => {
    const cfg = getProjectConfig(tmpRoot);
    const indexer = new Indexer(cfg);
    try {
      await indexer.index();
      const v = getDataVersion((indexer as unknown as { db: import("better-sqlite3").Database }).db);
      expect(v).toBe(CURRENT_DATA_VERSION);
    } finally {
      indexer.close();
    }
  });

  it("upgrading from v1 re-extracts symbol refs", async () => {
    // Step 1: build an index the "old" way. We create a database,
    // set data_version = 1, and insert a single lossy symbol_ref
    // row for 'helper' on the first call site only. This simulates
    // what v0.2.13 would have produced.
    const cfg = getProjectConfig(tmpRoot);
    {
      const indexer = new Indexer(cfg);
      await indexer.index();
      indexer.close();
    }

    // Simulate an old (v0.2.13) index by:
    //   - manually deleting all symbol_refs
    //   - inserting ONE lossy row for helper at the first call site
    //   - setting data_version = 1
    {
      const db = createDatabase(cfg.dbPath);
      db.exec("DELETE FROM symbol_refs");
      // Find the chunk id of the `run` function
      const runChunk = db
        .prepare("SELECT id FROM chunks WHERE name = 'run'")
        .get() as { id: number } | undefined;
      if (runChunk) {
        db.prepare(
          "INSERT INTO symbol_refs (source_chunk_id, target_name, line) VALUES (?, ?, ?)"
        ).run(runChunk.id, "helper", 2);
      }
      setDataVersion(db, 1);
      db.close();
    }

    // Step 2: open the index with a new Indexer. The migration
    // should run and re-extract all references.
    const indexer2 = new Indexer(cfg);
    try {
      const db = (indexer2 as unknown as { db: import("better-sqlite3").Database }).db;

      // data_version should now be CURRENT
      expect(getDataVersion(db)).toBe(CURRENT_DATA_VERSION);

      // symbol_refs should now include BOTH helper calls, not just one
      const helperRefs = db
        .prepare(
          "SELECT COUNT(*) as c FROM symbol_refs WHERE target_name = 'helper'"
        )
        .get() as { c: number };
      expect(helperRefs.c).toBeGreaterThanOrEqual(2);
    } finally {
      indexer2.close();
    }
  });

  it("a second Indexer construction on a current database is a no-op", async () => {
    const cfg = getProjectConfig(tmpRoot);

    {
      const indexer = new Indexer(cfg);
      await indexer.index();
      indexer.close();
    }

    // Capture the symbol_refs count after the initial index
    const db = createDatabase(cfg.dbPath);
    const initial = (
      db.prepare("SELECT COUNT(*) as c FROM symbol_refs").get() as { c: number }
    ).c;
    db.close();

    // Construct again — migration should skip
    const indexer2 = new Indexer(cfg);
    try {
      const db2 = (indexer2 as unknown as { db: import("better-sqlite3").Database }).db;
      const after = (
        db2.prepare("SELECT COUNT(*) as c FROM symbol_refs").get() as { c: number }
      ).c;
      // Same count — no rebuild happened
      expect(after).toBe(initial);
    } finally {
      indexer2.close();
    }
  });

  it("migration handles an empty database (no chunks) without erroring", () => {
    // Case: someone installs sverklo, opens a project, but no files
    // have been indexed yet. Database is empty. Migration should
    // still stamp the version and return cleanly.
    const cfg = getProjectConfig(tmpRoot);
    const emptyIndexer = new Indexer(cfg);
    try {
      const db = (emptyIndexer as unknown as { db: import("better-sqlite3").Database }).db;
      expect(getDataVersion(db)).toBe(CURRENT_DATA_VERSION);
    } finally {
      emptyIndexer.close();
    }
  });

  it("Sprint 9: v7→v8 migration backfills memories.kind and doc_mentions.edge_kind", async () => {
    // Sprint 9 added two new columns. SQLite's ALTER TABLE ADD COLUMN
    // sets the DEFAULT for *future* INSERTs but doesn't always backfill
    // existing rows depending on engine version, so the migration also
    // runs explicit UPDATE backfills. Test the upgrade path end-to-end.
    const cfg = getProjectConfig(tmpRoot);

    // Step 1: index fresh, then simulate a pre-v8 database by dropping
    // the kind/edge_kind columns and re-inserting rows without them.
    {
      const indexer = new Indexer(cfg);
      await indexer.index();
      // Insert a memory and a doc_mention BEFORE we strip the new
      // columns so we have rows that need backfilling.
      indexer.memoryStore.insert(
        "context",
        "pre-v8 memory under test",
        null,
        1.0,
        null,
        null,
        null,
        "archive"
      );
      indexer.close();
    }

    // Step 2: hand-craft pre-v8 state — null out the new columns and
    // stamp version 7. SQLite doesn't support DROP COLUMN on older
    // versions, so we just NULL the values to mimic the pre-default
    // state and confirm the backfill UPDATEs catch them.
    {
      const db = createDatabase(cfg.dbPath);
      db.exec("UPDATE memories SET kind = NULL");
      db.exec("UPDATE doc_mentions SET edge_kind = NULL");
      setDataVersion(db, 7);
      db.close();
    }

    // Step 3: re-open. createDatabase runs MIGRATIONS unconditionally,
    // so the backfill UPDATEs should fire and version should advance.
    const indexer2 = new Indexer(cfg);
    try {
      const db = (indexer2 as unknown as { db: import("better-sqlite3").Database }).db;
      expect(getDataVersion(db)).toBe(CURRENT_DATA_VERSION);

      const nullKinds = db
        .prepare("SELECT COUNT(*) as c FROM memories WHERE kind IS NULL")
        .get() as { c: number };
      expect(nullKinds.c).toBe(0);

      const nullEdgeKinds = db
        .prepare("SELECT COUNT(*) as c FROM doc_mentions WHERE edge_kind IS NULL")
        .get() as { c: number };
      expect(nullEdgeKinds.c).toBe(0);

      // The backfilled memory should be queryable by kind=episodic.
      const episodic = db
        .prepare("SELECT COUNT(*) as c FROM memories WHERE kind = 'episodic'")
        .get() as { c: number };
      expect(episodic.c).toBeGreaterThanOrEqual(1);
    } finally {
      indexer2.close();
    }
  });
});
