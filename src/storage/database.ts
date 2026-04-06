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

-- Dependency graph
CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY,
  source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  target_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  reference_count INTEGER DEFAULT 1,
  UNIQUE(source_file_id, target_file_id)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_name ON chunks(name);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(type);
CREATE INDEX IF NOT EXISTS idx_deps_source ON dependencies(source_file_id);
CREATE INDEX IF NOT EXISTS idx_deps_target ON dependencies(target_file_id);
`;

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB cache

  db.exec(SCHEMA);

  return db;
}
