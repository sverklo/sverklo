import { existsSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

const WORKSPACES_DIR = join(homedir(), ".sverklo", "workspaces");

export interface WorkspaceProject {
  path: string;
  role: "provider" | "consumer" | "both";
  interfaces?: Array<{
    type: "graphql" | "openapi" | "protobuf" | "npm" | "trpc";
    schema?: string; // glob for graphql
    spec?: string; // path for openapi
  }>;
}

export interface WorkspaceConfig {
  workspace: string;
  projects: WorkspaceProject[];
}

/**
 * Load a workspace config from ~/.sverklo/workspaces/<name>.yaml.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function loadWorkspaceConfig(name: string): WorkspaceConfig | null {
  const filePath = join(WORKSPACES_DIR, `${name}.yaml`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const workspace = String(parsed.workspace ?? name);
    const rawProjects = Array.isArray(parsed.projects) ? parsed.projects : [];

    const projects: WorkspaceProject[] = rawProjects
      .filter(
        (p: unknown): p is Record<string, unknown> =>
          typeof p === "object" && p !== null && typeof (p as Record<string, unknown>).path === "string",
      )
      .map((p: Record<string, unknown>) => {
        const role = (["provider", "consumer", "both"] as const).includes(
          p.role as "provider" | "consumer" | "both",
        )
          ? (p.role as "provider" | "consumer" | "both")
          : "both";

        const interfaces = Array.isArray(p.interfaces)
          ? (p.interfaces as Record<string, unknown>[])
              .filter(
                (i) =>
                  typeof i === "object" &&
                  i !== null &&
                  typeof i.type === "string",
              )
              .map((i) => ({
                type: i.type as "graphql" | "openapi" | "protobuf" | "npm" | "trpc",
                ...(typeof i.schema === "string" ? { schema: i.schema } : {}),
                ...(typeof i.spec === "string" ? { spec: i.spec } : {}),
              }))
          : undefined;

        return {
          path: p.path as string,
          role,
          ...(interfaces && interfaces.length > 0 ? { interfaces } : {}),
        };
      });

    return { workspace, projects };
  } catch (err) {
    if (process.env.SVERKLO_DEBUG) {
      process.stderr.write(`[sverklo] Failed to parse workspace '${name}': ${err}\n`);
    }
    return null;
  }
}

/**
 * Scan ~/.sverklo/workspaces/ for .yaml files and return their names.
 */
export function listWorkspaces(): string[] {
  if (!existsSync(WORKSPACES_DIR)) return [];
  try {
    return readdirSync(WORKSPACES_DIR)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => f.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}

/**
 * Find which workspace contains this project path (exact match on
 * any project's path). Returns the first match or null.
 */
export function findWorkspaceForProject(projectPath: string): WorkspaceConfig | null {
  const names = listWorkspaces();
  for (const name of names) {
    const config = loadWorkspaceConfig(name);
    if (config && config.projects.some((p) => p.path === projectPath)) {
      return config;
    }
  }
  return null;
}

/**
 * Get the path for the cross-repo SQLite database for a workspace.
 * Creates the parent directory if it doesn't exist.
 */
export function getWorkspaceDbPath(name: string): string {
  const dir = join(WORKSPACES_DIR, name);
  mkdirSync(dir, { recursive: true });
  return join(dir, "cross.db");
}
