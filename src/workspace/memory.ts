// Workspace-shared memory.
//
// Project memory lives at ~/.sverklo/<project-hash>/index.db. That's a
// great default — every memory is naturally scoped to one repo. But
// teams with N services have N disconnected memory stores: the same
// "we picked Postgres because…" decision has to be repeated on every
// repo, and a question like "what did we decide about auth across all
// services?" returns 1/N answers.
//
// Workspace memory closes that gap. A workspace is a named bucket
// (`sverklo workspace init team-platform path/a path/b path/c`) that
// gets its own SQLite at ~/.sverklo/workspaces/<name>/memories.db,
// using the same schema as a project DB. CLI: `sverklo workspace
// memory <name> {list|add|search|forget}`.
//
// MCP integration (sverklo_remember scope:workspace, sverklo_recall
// reading both project + workspace) is on the v0.18 roadmap. The CLI
// alone is enough for export to Notion / Linear / cron-driven
// "weekly digest of decisions across all repos" workflows today.

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createDatabase } from "../storage/database.js";
import { MemoryStore } from "../storage/memory-store.js";
import { MemoryEmbeddingStore } from "../storage/memory-embedding-store.js";
import { listWorkspaces, loadWorkspace } from "../workspace.js";
import type { Memory, MemoryCategory, MemoryKind } from "../types/index.js";

export interface WorkspaceMemoryHandle {
  name: string;
  dbPath: string;
  memoryStore: MemoryStore;
  memoryEmbeddingStore: MemoryEmbeddingStore;
  close: () => void;
}

export function workspaceMemoryDir(name: string): string {
  return join(homedir(), ".sverklo", "workspaces", name);
}

export function workspaceMemoryDb(name: string): string {
  return join(workspaceMemoryDir(name), "memories.db");
}

/**
 * Open (creating if necessary) a workspace memory DB. The first call
 * for a given workspace name creates the directory + applies the
 * schema. Subsequent calls reuse the file.
 */
export function openWorkspaceMemory(name: string): WorkspaceMemoryHandle {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`workspace name must match [A-Za-z0-9._-]+, got "${name}"`);
  }
  const dir = workspaceMemoryDir(name);
  mkdirSync(dir, { recursive: true });
  const dbPath = workspaceMemoryDb(name);
  const db = createDatabase(dbPath);
  const memoryStore = new MemoryStore(db);
  const memoryEmbeddingStore = new MemoryEmbeddingStore(db);
  return {
    name,
    dbPath,
    memoryStore,
    memoryEmbeddingStore,
    close: () => db.close(),
  };
}

export function workspaceMemoryExists(name: string): boolean {
  return existsSync(workspaceMemoryDb(name));
}

/**
 * Discover the workspace (if any) that contains the given project path.
 * Used by MCP tools so `sverklo_remember scope:workspace` knows where
 * to write without the user having to pass a workspace name.
 *
 * Match rule: the project path is exactly one of the workspace's
 * repos[].path, OR it lives under one of them. First match wins.
 * Returns null when no registered workspace contains this project.
 */
export function findWorkspaceForPath(projectPath: string): string | null {
  const target = resolve(projectPath);
  for (const name of listWorkspaces()) {
    const cfg = loadWorkspace(name);
    if (!cfg) continue;
    for (const r of cfg.repos) {
      const repo = resolve(r.path);
      if (repo === target) return name;
      const repoWithSep = repo.endsWith(sep) ? repo : repo + sep;
      if (target.startsWith(repoWithSep)) return name;
    }
  }
  return null;
}

export interface AddOptions {
  content: string;
  category?: MemoryCategory;
  kind?: MemoryKind;
  tags?: string[];
}

export function addWorkspaceMemory(
  ws: WorkspaceMemoryHandle,
  opts: AddOptions
): number {
  const id = ws.memoryStore.insert(
    opts.category ?? "context",
    opts.content,
    opts.tags ?? null,
    1.0,
    null,
    null,
    null,
    "archive",
    opts.kind
  );
  return id;
}

/**
 * FTS-only search over the workspace memory store. Vector search is
 * available too via memoryEmbeddingStore.findTopK once embeddings are
 * populated; this CLI keeps it simple by sticking to FTS so users
 * don't need the ONNX model warm just to grep the team's decisions.
 */
export function searchWorkspaceMemory(
  ws: WorkspaceMemoryHandle,
  query: string,
  limit = 20
): Memory[] {
  return ws.memoryStore.searchFts(query, limit);
}
