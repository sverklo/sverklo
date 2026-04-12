import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";
import ignore from "ignore";
import picomatch from "picomatch";
import type { CrossRepoDb, InterfaceContract } from "./cross-db.js";
import type { WorkspaceConfig, WorkspaceProject } from "./workspace-config.js";
import { extractGraphQLContracts } from "./graphql-extractor.js";
import { detectGraphQLConsumers } from "./graphql-consumer.js";

export interface CrossIndexResult {
  contractsFound: number;
  edgesFound: number;
  staleProjects: string[];
  errors: string[];
}

const MAX_FILE_SIZE = 1_000_000; // 1 MB
const CONSUMER_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Index all cross-repo relationships in a workspace.
 *
 * 1. For each provider project, extract interface contracts (GraphQL schemas)
 * 2. For each consumer project, detect references to those contracts
 * 3. Populate cross_edges in the workspace DB
 */
export async function crossIndex(
  config: WorkspaceConfig,
  db: CrossRepoDb,
): Promise<CrossIndexResult> {
  const result: CrossIndexResult = {
    contractsFound: 0,
    edgesFound: 0,
    staleProjects: [],
    errors: [],
  };

  // Phase 1: Index providers — extract contracts from GraphQL schema files
  for (const project of config.projects) {
    if (project.role !== "provider" && project.role !== "both") continue;

    const projectId = projectKey(project);

    try {
      const currentSha = getGitSha(project.path);

      // Upsert the project record so foreign keys are satisfied
      db.upsertProject(
        projectId,
        project.path,
        projectId,
        project.role,
        currentSha ?? "",
      );

      // Check staleness
      if (currentSha && !db.isProjectStale(projectId, currentSha)) {
        // Not stale — count existing contracts
        result.contractsFound += db.getContractsForProject(projectId).length;
        continue;
      }

      if (currentSha) {
        result.staleProjects.push(projectId);
      }

      // Collect GraphQL schema globs from the interfaces config
      const schemaGlobs = getGraphQLGlobs(project);

      // Find GraphQL schema files matching the interface globs
      const schemaFiles = findSchemaFiles(project.path, schemaGlobs);

      // Delete old contracts for this project, then insert new ones
      db.deleteContractsForProject(projectId);

      for (const absPath of schemaFiles) {
        try {
          const content = readFileSync(absPath, "utf-8");
          const relPath = relative(project.path, absPath);
          const { contracts } = extractGraphQLContracts(relPath, content);

          for (const contract of contracts) {
            db.upsertContract({
              projectId: projectId,
              ...contract,
            });
            result.contractsFound++;
          }
        } catch (err) {
          result.errors.push(
            `Failed to extract contracts from ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Update stored SHA
      if (currentSha) {
        db.upsertProject(
          projectId,
          project.path,
          projectId,
          project.role,
          currentSha,
        );
      }
    } catch (err) {
      result.errors.push(
        `Failed to index provider ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Phase 2: Index consumers — detect references to known contracts
  // Gather all contracts across all provider projects
  const allContracts: InterfaceContract[] = [];
  for (const project of config.projects) {
    if (project.role !== "provider" && project.role !== "both") continue;
    const pid = projectKey(project);
    allContracts.push(...db.getContractsForProject(pid));
  }

  if (allContracts.length === 0) return result;

  for (const project of config.projects) {
    if (project.role !== "consumer" && project.role !== "both") continue;

    const projectId = projectKey(project);

    try {
      const currentSha = getGitSha(project.path);

      // Upsert the project record
      db.upsertProject(
        projectId,
        project.path,
        projectId,
        project.role,
        currentSha ?? "",
      );

      // Check staleness
      if (currentSha && !db.isProjectStale(projectId, currentSha)) {
        result.edgesFound += db.getCrossEdgesForProject(projectId).length;
        continue;
      }

      // Delete old edges for this consumer
      db.deleteCrossEdgesForProject(projectId);

      // Build ignore filter for the project
      const ig = buildIgnoreFilter(project.path);

      // Walk project files for consumer code
      const consumerFiles = discoverConsumerFiles(project.path, ig);

      for (const absPath of consumerFiles) {
        try {
          const content = readFileSync(absPath, "utf-8");
          const matches = detectGraphQLConsumers(absPath, content, allContracts);

          for (const match of matches) {
            // For each referenced field, find the matching contract and create an edge
            for (const fieldRef of match.referencedFields) {
              const matchingContracts = db.getContractBySymbol(fieldRef, "graphql");
              if (matchingContracts.length === 0) continue;

              const contract = matchingContracts[0];
              const confidence = computeFieldConfidence(fieldRef, allContracts);

              db.upsertCrossEdge({
                consumerProjectId: projectId,
                consumerFile: relative(project.path, match.file),
                consumerSymbol: match.symbol,
                consumerLine: match.line,
                contractId: contract.id!,
                edgeType: match.edgeType,
                confidence,
              });
              result.edgesFound++;
            }
          }
        } catch (err) {
          result.errors.push(
            `Failed to scan consumer file ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Update stored SHA
      if (currentSha) {
        db.upsertProject(
          projectId,
          project.path,
          projectId,
          project.role,
          currentSha,
        );
      }
    } catch (err) {
      result.errors.push(
        `Failed to index consumer ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Project identity
// ---------------------------------------------------------------------------

/** Derive a stable project ID from its path (last path segment). */
function projectKey(project: WorkspaceProject): string {
  return project.path.split("/").filter(Boolean).pop() ?? project.path;
}

// ---------------------------------------------------------------------------
// GraphQL glob extraction from workspace config
// ---------------------------------------------------------------------------

function getGraphQLGlobs(project: WorkspaceProject): string[] {
  if (!project.interfaces || project.interfaces.length === 0) {
    // Default: look for .graphql files anywhere in the project
    return ["**/*.graphql"];
  }

  const globs: string[] = [];
  for (const iface of project.interfaces) {
    if (iface.type === "graphql") {
      globs.push(iface.schema ?? "**/*.graphql");
    }
  }

  return globs.length > 0 ? globs : ["**/*.graphql"];
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function getGitSha(rootPath: string): string | null {
  try {
    execSync("git rev-parse --verify HEAD", {
      cwd: rootPath,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5000,
    });
  } catch {
    return null;
  }

  try {
    return execSync("git rev-parse HEAD", {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schema file discovery
// ---------------------------------------------------------------------------

function findSchemaFiles(rootPath: string, globs: string[]): string[] {
  const matchers = globs.map((g) => picomatch(g));
  const files: string[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      const relPath = relative(rootPath, absPath);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(absPath);
      } else if (entry.isFile()) {
        if (matchers.some((m) => m(relPath))) {
          files.push(absPath);
        }
      }
    }
  }

  walk(rootPath);
  return files;
}

// ---------------------------------------------------------------------------
// Consumer file discovery
// ---------------------------------------------------------------------------

function buildIgnoreFilter(rootPath: string): ReturnType<typeof ignore> {
  const ig = ignore();
  ig.add(["node_modules", ".git", "dist", "build", "out", "__pycache__"]);

  const gitignorePath = join(rootPath, ".gitignore");
  try {
    ig.add(readFileSync(gitignorePath, "utf-8"));
  } catch {
    // No .gitignore — fine
  }

  return ig;
}

function discoverConsumerFiles(
  rootPath: string,
  ig: ReturnType<typeof ignore>,
): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      const relPath = relative(rootPath, absPath);

      if (ig.ignores(relPath)) continue;

      if (entry.isDirectory()) {
        if (!ig.ignores(relPath + "/")) {
          walk(absPath);
        }
      } else if (entry.isFile()) {
        const ext = "." + entry.name.split(".").pop()?.toLowerCase();
        if (!CONSUMER_EXTENSIONS.has(ext)) continue;

        try {
          const stat = statSync(absPath);
          if (stat.size > MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }

        files.push(absPath);
      }
    }
  }

  walk(rootPath);
  return files;
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

function computeFieldConfidence(
  fieldRef: string,
  allContracts: InterfaceContract[],
): number {
  // Exact match against a known contract symbol -> 1.0
  // Inferred (guessed parent type) -> 0.8
  const isExact = allContracts.some((c) => c.symbolName === fieldRef);
  return isExact ? 1.0 : 0.8;
}
