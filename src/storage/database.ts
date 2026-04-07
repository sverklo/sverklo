import Database from "better-sqlite3";

const SCHEMA = `
-- Indexed files
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  language TEXT,
  hash TEXT NOT NULL,
  last_modified INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  pagerank REAL DEFAULT 0.0,
  indexed_at INTEGER NOT NULL
);

-- Code chunks
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT,
  signature TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  description TEXT,
  token_count INTEGER NOT NULL
);

-- Vector embeddings
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  vector BLOB NOT NULL
);

-- File-level dependency graph
CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY,
  source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  target_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  reference_count INTEGER DEFAULT 1,
  UNIQUE(source_file_id, target_file_id)
);

-- Symbol-level reference graph (function/class call relationships)
-- Each row is "source_chunk references target_name" — resolution to a target
-- chunk is done lazily via name matching since we don't have a type-resolver.
CREATE TABLE IF NOT EXISTS symbol_refs (
  id INTEGER PRIMARY KEY,
  source_chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  target_name TEXT NOT NULL,
  line INTEGER,
  UNIQUE(source_chunk_id, target_name, line)
);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  name,
  content,
  description,
  content=chunks,
  content_rowid=id,
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, name, content, description)
  VALUES (new.id, new.name, new.content, new.description);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, name, content, description)
  VALUES ('delete', old.id, old.name, old.content, old.description);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, name, content, description)
  VALUES ('delete', old.id, old.name, old.content, old.description);
  INSERT INTO chunks_fts(rowid, name, content, description)
  VALUES (new.id, new.name, new.content, new.description);
END;

-- Session memories (bi-temporal: valid_from_sha -> valid_until_sha)
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  confidence REAL DEFAULT 1.0,
  git_sha TEXT,              -- alias for valid_from_sha (creation time)
  git_branch TEXT,
  related_files TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  is_stale INTEGER DEFAULT 0,
  -- Bi-temporal fields (added in v0.2)
  tier TEXT DEFAULT 'archive',        -- 'core' | 'archive'
  valid_from_sha TEXT,                -- git SHA when memory was created
  valid_until_sha TEXT,               -- git SHA when invalidated (NULL = still valid)
  invalidated_at INTEGER,             -- epoch ms when invalidated
  superseded_by INTEGER                -- id of memory that replaced this one
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  vector BLOB NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tags,
  content=memories,
  content_rowid=id,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags)
  VALUES (new.id, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.id, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.id, old.content, old.tags);
  INSERT INTO memories_fts(rowid, content, tags)
  VALUES (new.id, new.content, new.tags);
END;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_name ON chunks(name);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(type);
CREATE INDEX IF NOT EXISTS idx_deps_source ON dependencies(source_file_id);
CREATE INDEX IF NOT EXISTS idx_deps_target ON dependencies(target_file_id);
CREATE INDEX IF NOT EXISTS idx_symrefs_source ON symbol_refs(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_symrefs_target ON symbol_refs(target_name);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_stale ON memories(is_stale);
CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_valid_until ON memories(valid_until_sha);
`;

// Additive migrations — run after SCHEMA to upgrade existing databases
const MIGRATIONS = [
  "ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'archive'",
  "ALTER TABLE memories ADD COLUMN valid_from_sha TEXT",
  "ALTER TABLE memories ADD COLUMN valid_until_sha TEXT",
  "ALTER TABLE memories ADD COLUMN invalidated_at INTEGER",
  "ALTER TABLE memories ADD COLUMN superseded_by INTEGER",
];

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB cache

  db.exec(SCHEMA);

  // Run additive migrations for existing databases. Each is idempotent via
  // try/catch since ALTER TABLE ADD COLUMN throws if the column exists.
  for (const stmt of MIGRATIONS) {
    try {
      db.exec(stmt);
    } catch {
      // Column already exists — expected on already-migrated dbs
    }
  }

  return db;
}
