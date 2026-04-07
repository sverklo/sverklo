import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface WorkspaceConfig {
  name: string;
  repos: {
    path: string;
    alias?: string;
  }[];
}

const WORKSPACE_DIR = join(homedir(), ".sverklo", "workspaces");

function getWorkspacePath(name: string): string {
  return join(WORKSPACE_DIR, name + ".json");
}

export function listWorkspaces(): string[] {
  if (!existsSync(WORKSPACE_DIR)) return [];
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(WORKSPACE_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(/\.json$/, ""));
}

export function loadWorkspace(name: string): WorkspaceConfig | null {
  const path = getWorkspacePath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as WorkspaceConfig;
  } catch {
    return null;
  }
}

export function saveWorkspace(config: WorkspaceConfig): void {
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  writeFileSync(getWorkspacePath(config.name), JSON.stringify(config, null, 2) + "\n");
}

export function createWorkspace(name: string, repoPaths: string[]): WorkspaceConfig {
  const config: WorkspaceConfig = {
    name,
    repos: repoPaths.map((p) => ({ path: resolve(p) })),
  };
  saveWorkspace(config);
  return config;
}

export function addRepoToWorkspace(name: string, repoPath: string, alias?: string): WorkspaceConfig {
  let config = loadWorkspace(name);
  if (!config) {
    config = { name, repos: [] };
  }
  const absPath = resolve(repoPath);
  if (!config.repos.some((r) => r.path === absPath)) {
    config.repos.push({ path: absPath, alias });
    saveWorkspace(config);
  }
  return config;
}

export function removeRepoFromWorkspace(name: string, repoPath: string): WorkspaceConfig | null {
  const config = loadWorkspace(name);
  if (!config) return null;
  const absPath = resolve(repoPath);
  config.repos = config.repos.filter((r) => r.path !== absPath);
  saveWorkspace(config);
  return config;
}
