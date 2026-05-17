// Shared types for the audit-diff feature. Mirrors data-model.md from
// the spec; only public-facing shapes (especially JSON output) live here.

export type DiffStatus = "added" | "modified" | "renamed" | "deleted";

export interface DiffEntry {
  path: string;
  status: DiffStatus;
  oldPath?: string;
}

export interface DiffSet {
  entries: DiffEntry[];
  baseRef: string;
  parsedAt: number;
}

export interface BoundarySubgraph {
  nodes: Set<number>;
  edges: Map<number, Set<number>>;
  fanIn: Map<number, number>;
  seedNodes: Set<number>;
  snapshot: "pre" | "post";
}

// id↔path resolution. Storage stores file_id integers; audit-diff
// reports use file paths. Keep a lookup table alongside subgraphs.
export interface NodeLookup {
  idToPath: Map<number, string>;
  pathToId: Map<string, number>;
}

export type ArchitecturalViolation =
  | {
      kind: "cycle";
      nodes: string[];
      newInThisDiff: boolean;
    }
  | {
      kind: "fan_in_spike";
      file: string;
      preFanIn: number;
      postFanIn: number;
      threshold: number;
      newInThisDiff: boolean;
    };

export interface AuditReport {
  schema_version: "1";
  pass: boolean;
  diff: {
    base_ref: string;
    modified_paths: string[];
    analyzable_paths: string[];
  };
  violations: ArchitecturalViolation[];
  pre_existing: ArchitecturalViolation[];
  stats: {
    boundary_node_count: number;
    boundary_edge_count: number;
    elapsed_ms: number;
  };
  warnings: string[];
}

export interface AuditDiffOptions {
  baseRef: string;
  fanInThreshold: number;
  format: "human" | "json";
  showExisting: boolean;
  verbose: boolean;
  projectPath: string;
}

export const DEFAULT_FAN_IN_THRESHOLD = 50;
export const EXIT_PASS = 0;
export const EXIT_GATE_FAIL = 1;
export const EXIT_CONFIG_ERROR = 2;
