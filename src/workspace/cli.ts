import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { stringify as stringifyYaml } from "yaml";
import {
  loadWorkspaceConfig,
  listWorkspaces as listWorkspaceNames,
  getWorkspaceDbPath,
  type WorkspaceProject,
  type WorkspaceConfig,
} from "./workspace-config.js";
import { CrossRepoDb } from "./cross-db.js";

const WORKSPACES_DIR = join(homedir(), ".sverklo", "workspaces");

/**
 * Detect interface files at a project path to auto-populate the interfaces
 * field in the workspace config.
 */
function detectInterfaces(projectPath: string): WorkspaceProject["interfaces"] {
  const interfaces: NonNullable<WorkspaceProject["interfaces"]> = [];

  try {
    // Check for GraphQL schemas
    const hasGraphql = findFilesWithExt(projectPath, [".graphql", ".gql"], 3);
    if (hasGraphql) {
      interfaces.push({ type: "graphql", schema: "**/*.graphql" });
    }

    // Check for OpenAPI specs
    for (const name of ["openapi.yaml", "openapi.yml", "openapi.json", "swagger.yaml", "swagger.yml", "swagger.json"]) {
      if (existsSync(join(projectPath, name))) {
        interfaces.push({ type: "openapi", spec: name });
        break;
      }
    }

    // Check for protobuf
    const hasProto = findFilesWithExt(projectPath, [".proto"], 3);
    if (hasProto) {
      interfaces.push({ type: "protobuf", schema: "**/*.proto" });
    }
  } catch {
    // Non-fatal: skip interface detection on errors
  }

  return interfaces.length > 0 ? interfaces : undefined;
}

/**
 * Shallow search for files with given extensions (up to maxDepth levels).
 */
function findFilesWithExt(dir: string, extensions: string[], maxDepth: number): boolean {
  if (maxDepth <= 0 || !existsSync(dir)) return false;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        return true;
      }
      if (entry.isDirectory() && findFilesWithExt(join(dir, entry.name), extensions, maxDepth - 1)) {
        return true;
      }
    }
  } catch {
    // Permission errors, etc.
  }
  return false;
}

/**
 * Get the current git HEAD SHA for a project path.
 * Returns "unknown" if the path is not a git repo or git is unavailable.
 */
function getGitSha(projectPath: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Generate a deterministic project ID from a path, matching the pattern
 * used in src/utils/config.ts (sha256, first 12 hex chars).
 */
function projectId(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

/**
 * Create a new workspace config with the given project paths.
 * Auto-detects interfaces by scanning each project directory.
 */
export async function workspaceInit(name: string, projectPaths: string[]): Promise<void> {
  mkdirSync(WORKSPACES_DIR, { recursive: true });

  const projects: WorkspaceProject[] = projectPaths.map((p) => {
    const absPath = resolve(p);
    const interfaces = detectInterfaces(absPath);
    return {
      path: absPath,
      role: "both" as const,
      ...(interfaces ? { interfaces } : {}),
    };
  });

  const config: WorkspaceConfig = {
    workspace: name,
    projects,
  };

  const yamlContent = stringifyYaml(config, { lineWidth: 120 });
  const filePath = join(WORKSPACES_DIR, `${name}.yaml`);
  writeFileSync(filePath, yamlContent, "utf-8");

  console.log(`Workspace '${name}' created at ${filePath}`);
  console.log(`Projects (${projects.length}):`);
  for (const p of projects) {
    const ifaceStr = p.interfaces
      ? ` [${p.interfaces.map((i) => i.type).join(", ")}]`
      : "";
    console.log(`  - ${p.path} (${p.role})${ifaceStr}`);
  }
}

/**
 * Show workspace health: projects, staleness, contract/edge counts.
 * If name is omitted, shows all workspaces.
 */
export async function workspaceStatus(name?: string): Promise<string> {
  const names = name ? [name] : listWorkspaceNames();
  if (names.length === 0) {
    return "No workspaces found. Create one with: sverklo workspace init <name> <path1> <path2> ...";
  }

  const lines: string[] = [];

  for (const wsName of names) {
    const config = loadWorkspaceConfig(wsName);
    if (!config) {
      lines.push(`Workspace '${wsName}': config not found or invalid`);
      continue;
    }

    lines.push(`Workspace: ${config.workspace}`);
    lines.push(`Projects: ${config.projects.length}`);

    const dbPath = getWorkspaceDbPath(wsName);
    let db: CrossRepoDb | null = null;
    try {
      db = new CrossRepoDb(dbPath);
      const dbProjects = db.listProjects();

      for (const project of config.projects) {
        const pid = projectId(project.path);
        const dbProject = dbProjects.find((p) => p.id === pid);
        const currentSha = getGitSha(project.path);
        const stale = dbProject ? dbProject.gitSha !== currentSha : true;
        const contracts = dbProject ? db.getContractsForProject(pid).length : 0;
        const edges = dbProject ? db.getCrossEdgesForProject(pid).length : 0;
        const indexedAt = dbProject
          ? new Date(dbProject.lastIndexedAt).toISOString()
          : "never";

        lines.push(`  - ${basename(project.path)} (${project.role})`);
        lines.push(`    path: ${project.path}`);
        lines.push(`    indexed: ${indexedAt}${stale ? " [STALE]" : ""}`);
        lines.push(`    contracts: ${contracts}, edges: ${edges}`);
      }
    } catch (err) {
      lines.push(`  (cross-db not yet initialized)`);
    } finally {
      db?.close();
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Trigger cross-repo indexing for all projects in the workspace.
 * This registers each project in the cross-db with current git SHA.
 * Actual contract extraction and edge linking will be done by
 * specialized extractors (GraphQL, OpenAPI, etc.) in future phases.
 */
export async function workspaceIndex(name: string): Promise<void> {
  const config = loadWorkspaceConfig(name);
  if (!config) {
    console.error(`Workspace '${name}' not found.`);
    return;
  }

  const dbPath = getWorkspaceDbPath(name);
  const db = new CrossRepoDb(dbPath);

  try {
    for (const project of config.projects) {
      const absPath = resolve(project.path);
      const pid = projectId(absPath);
      const projectName = basename(absPath);
      const sha = getGitSha(absPath);

      if (!db.isProjectStale(pid, sha)) {
        console.log(`  [skip] ${projectName} — up to date (${sha.slice(0, 7)})`);
        continue;
      }

      console.log(`  [index] ${projectName} — ${sha.slice(0, 7)}`);
      db.upsertProject(pid, absPath, projectName, project.role, sha);

      // Clear stale contracts/edges before re-extraction
      db.deleteContractsForProject(pid);
      db.deleteCrossEdgesForProject(pid);

      // TODO: Phase 2 — run interface extractors (GraphQL, OpenAPI, etc.)
      // For now, the project is registered and marked with the current SHA.
    }

    console.log(`Workspace '${name}' indexed. Cross-db: ${dbPath}`);
  } finally {
    db.close();
  }
}
