import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

export interface RegistryEntry {
  path: string;
  name: string;
  lastIndexed: string;
}

export interface Registry {
  repos: Record<string, RegistryEntry>;
}

const REGISTRY_DIR = join(homedir(), ".sverklo");
const REGISTRY_FILE = join(REGISTRY_DIR, "registry.json");

export function getRegistryPath(): string {
  return REGISTRY_FILE;
}

export function getRegistry(): Record<string, RegistryEntry> {
  if (!existsSync(REGISTRY_FILE)) return {};
  try {
    const data = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8")) as Registry;
    return data.repos ?? {};
  } catch {
    return {};
  }
}

function saveRegistry(repos: Record<string, RegistryEntry>): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  const data: Registry = { repos };
  writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2) + "\n");
}

export function registerRepo(name: string, path: string): void {
  const repos = getRegistry();
  repos[name] = {
    path,
    name,
    lastIndexed: new Date().toISOString(),
  };
  saveRegistry(repos);
}

export function unregisterRepo(name: string): void {
  const repos = getRegistry();
  delete repos[name];
  saveRegistry(repos);
}

export function updateLastIndexed(name: string): void {
  const repos = getRegistry();
  if (repos[name]) {
    repos[name].lastIndexed = new Date().toISOString();
    saveRegistry(repos);
  }
}

/**
 * Derive a repo name from an absolute path. Uses the directory basename,
 * but deduplicates against existing registry entries by appending a suffix.
 */
export function deriveRepoName(repoPath: string): string {
  const base = basename(repoPath);
  const repos = getRegistry();
  if (!repos[base] || repos[base].path === repoPath) return base;
  // Collision: another repo already has this name with a different path.
  // Append parent directory name for disambiguation.
  // Issue #20: dirname/basename round-trip is platform-aware on Windows.
  const parentDir = basename(dirname(repoPath));
  if (parentDir) {
    const candidate = `${parentDir}-${base}`;
    if (!repos[candidate] || repos[candidate].path === repoPath) return candidate;
  }
  // Last resort: append a numeric suffix
  let i = 2;
  while (repos[`${base}-${i}`] && repos[`${base}-${i}`].path !== repoPath) i++;
  return `${base}-${i}`;
}
