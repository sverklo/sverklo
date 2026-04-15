import type { Indexer } from "../indexer/indexer.js";

// ─── Types ───

export interface HealthDimension {
  name: string;
  grade: string;
  score: number;
  detail: string;
}

export interface HealthScore {
  grade: string;
  numericScore: number;
  dimensions: HealthDimension[];
}

export interface SecurityIssue {
  file: string;
  line: number;
  pattern: string;
  severity: "critical" | "high" | "medium" | "low";
  snippet: string;
}

export interface AuditAnalysis {
  healthScore: HealthScore;
  securityIssues: SecurityIssue[];
  circularDeps: string[][];
}

// ─── Grade helpers ───

const GRADE_VALUES: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };

function numericToGrade(score: number): string {
  if (score >= 4.5) return "A";
  if (score >= 3.5) return "B";
  if (score >= 2.5) return "C";
  if (score >= 1.5) return "D";
  return "F";
}

function deadCodeGrade(pct: number): string {
  if (pct <= 5) return "A";
  if (pct <= 15) return "B";
  if (pct <= 25) return "C";
  if (pct <= 40) return "D";
  return "F";
}

function circularDepsGrade(count: number): string {
  if (count === 0) return "A";
  if (count <= 2) return "B";
  if (count <= 5) return "C";
  if (count <= 10) return "D";
  return "F";
}

function couplingGrade(maxFanIn: number): string {
  if (maxFanIn < 10) return "A";
  if (maxFanIn <= 20) return "B";
  if (maxFanIn <= 35) return "C";
  if (maxFanIn <= 50) return "D";
  return "F";
}

function securityGrade(issueCount: number): string {
  if (issueCount === 0) return "A";
  if (issueCount <= 2) return "B";
  if (issueCount <= 5) return "C";
  if (issueCount <= 10) return "D";
  return "F";
}

// ─── Security Scanner ───

interface SecurityPattern {
  name: string;
  regex: RegExp;
  severity: SecurityIssue["severity"];
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  // Hardcoded secrets
  {
    name: "Hardcoded secret",
    regex: /(password|secret|api_key|apikey|token|auth)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: "critical",
  },
  {
    name: "Private key",
    regex: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
    severity: "critical",
  },
  {
    name: "API token",
    regex: /(ghp_|gho_|github_pat_|sk-|pk_live_|pk_test_|sk_live_|sk_test_)[a-zA-Z0-9]{20,}/,
    severity: "critical",
  },
  // SQL injection
  {
    name: "SQL injection (template literal)",
    regex: /(query|exec|execute|raw)\s*\(\s*['"`].*\$\{/,
    severity: "high",
  },
  {
    name: "SQL injection (string concat)",
    regex: /\+\s*['"].*(?:SELECT|INSERT|UPDATE|DELETE|DROP|WHERE)/i,
    severity: "high",
  },
  // Dangerous eval
  {
    name: "eval() usage",
    regex: /\beval\s*\(/,
    severity: "high",
  },
  {
    name: "new Function() usage",
    regex: /new\s+Function\s*\(/,
    severity: "high",
  },
  {
    name: "setTimeout with string",
    regex: /setTimeout\s*\(\s*['"`]/,
    severity: "high",
  },
  {
    name: "setInterval with string",
    regex: /setInterval\s*\(\s*['"`]/,
    severity: "high",
  },
  // Debug statements — debugger is always flagged
  {
    name: "debugger statement",
    regex: /\bdebugger\s*;/,
    severity: "low",
  },
];

/** Files that should be excluded from debug-statement scanning. */
const NON_PRODUCTION_FILE =
  /(^|\/)(tests?|__tests__|spec|specs|examples?|benchmarks?|fixtures?|scripts?|docs?)(\/|$)/;
const ENV_EXAMPLE_FILE = /\.env\.example$/;

export function scanSecurity(indexer: Indexer): SecurityIssue[] {
  const allChunks = indexer.chunkStore.getAllWithFile();
  const issues: SecurityIssue[] = [];
  // Track deduplicated issues by file:line:pattern
  const seen = new Set<string>();

  // For console.log counting: accumulate per-file counts first, then
  // only emit issues for files with >10 occurrences.
  const consoleLogsByFile = new Map<
    string,
    Array<{ line: number; snippet: string }>
  >();

  for (const chunk of allChunks) {
    const filePath = chunk.filePath;

    // Skip .env.example files entirely
    if (ENV_EXAMPLE_FILE.test(filePath)) continue;

    const isTestFile = NON_PRODUCTION_FILE.test(filePath);
    const lines = chunk.content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const absoluteLine = chunk.start_line + i;

      // Check all security patterns
      for (const pattern of SECURITY_PATTERNS) {
        if (pattern.regex.test(line)) {
          const key = `${filePath}:${absoluteLine}:${pattern.name}`;
          if (seen.has(key)) continue;
          seen.add(key);

          issues.push({
            file: filePath,
            line: absoluteLine,
            pattern: pattern.name,
            severity: pattern.severity,
            snippet: line.trim().slice(0, 120),
          });
        }
      }

      // Track console.log separately (only for non-test files)
      if (!isTestFile && /console\.log\s*\(/.test(line)) {
        const key = `${filePath}:${absoluteLine}:console.log`;
        if (!seen.has(key)) {
          seen.add(key);
          if (!consoleLogsByFile.has(filePath)) {
            consoleLogsByFile.set(filePath, []);
          }
          consoleLogsByFile.get(filePath)!.push({
            line: absoluteLine,
            snippet: line.trim().slice(0, 120),
          });
        }
      }
    }
  }

  // Only flag console.log if a file has >10 occurrences
  for (const [filePath, entries] of consoleLogsByFile) {
    if (entries.length > 10) {
      for (const entry of entries) {
        issues.push({
          file: filePath,
          line: entry.line,
          pattern: "Excessive console.log",
          severity: "low",
          snippet: entry.snippet,
        });
      }
    }
  }

  return issues;
}

// ─── Circular Dependency Detection ───

export function detectCycles(
  files: Array<{ id: number; path: string }>,
  edges: Array<{ source_file_id: number; target_file_id: number }>
): string[][] {
  // Build adjacency list
  const adj = new Map<number, number[]>();
  const idToPath = new Map<number, string>();

  for (const f of files) {
    idToPath.set(f.id, f.path);
    adj.set(f.id, []);
  }

  for (const e of edges) {
    const neighbors = adj.get(e.source_file_id);
    if (neighbors) {
      neighbors.push(e.target_file_id);
    }
  }

  // DFS with white (0), gray (1), black (2) coloring
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<number, number>();
  const parent = new Map<number, number>(); // for cycle reconstruction
  const cycles: string[][] = [];
  // Deduplicate cycles by their normalized form
  const seenCycles = new Set<string>();

  for (const f of files) {
    color.set(f.id, WHITE);
  }

  function dfs(u: number): void {
    color.set(u, GRAY);
    const neighbors = adj.get(u) || [];

    for (const v of neighbors) {
      if (!idToPath.has(v)) continue; // target not in our file set

      const vc = color.get(v);
      if (vc === WHITE) {
        parent.set(v, u);
        dfs(v);
      } else if (vc === GRAY) {
        // Found a cycle — reconstruct it
        const cycle: string[] = [];
        let current = u;
        cycle.push(idToPath.get(v)!);

        while (current !== v) {
          cycle.push(idToPath.get(current)!);
          current = parent.get(current)!;
          // Safety: if we loop too many times, break (shouldn't happen)
          if (cycle.length > files.length) break;
        }

        cycle.reverse();

        // Normalize: rotate so the lexicographically smallest path is first
        const normalized = normalizeCycle(cycle);
        const key = normalized.join(" -> ");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(normalized);
        }
      }
      // BLACK nodes are already fully explored — skip
    }

    color.set(u, BLACK);
  }

  for (const f of files) {
    if (color.get(f.id) === WHITE) {
      dfs(f.id);
    }
  }

  return cycles;
}

/** Rotate a cycle so the lexicographically smallest path is first. */
function normalizeCycle(cycle: string[]): string[] {
  if (cycle.length === 0) return cycle;
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) {
      minIdx = i;
    }
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

// ─── Coupling: max fan-in ───

function computeMaxFanIn(
  files: Array<{ id: number; path: string }>,
  edges: Array<{ source_file_id: number; target_file_id: number }>
): { maxFanIn: number; file: string } {
  const idToPath = new Map<number, string>();
  for (const f of files) {
    idToPath.set(f.id, f.path);
  }

  const importerCount = new Map<number, number>();
  for (const e of edges) {
    importerCount.set(
      e.target_file_id,
      (importerCount.get(e.target_file_id) || 0) + 1
    );
  }

  let maxFanIn = 0;
  let maxFile = "";
  for (const [fileId, count] of importerCount) {
    if (count > maxFanIn) {
      maxFanIn = count;
      maxFile = idToPath.get(fileId) || `file#${fileId}`;
    }
  }

  return { maxFanIn, file: maxFile };
}

// ─── Dead code percentage ───

function computeDeadCodePct(indexer: Indexer): {
  pct: number;
  orphanCount: number;
  totalCount: number;
} {
  const allChunks = indexer.chunkStore.getAllWithFile();
  const allRefs = indexer.symbolRefStore.getAll();

  const refsByName = new Map<string, number>();
  for (const r of allRefs) {
    refsByName.set(r.target_name, (refsByName.get(r.target_name) || 0) + 1);
  }

  const NON_SHIPPING =
    /(^|\/)(tests?|__tests__|spec|specs|examples?|benchmarks?|fixtures?|scripts?|docs?)(\/|$)/;

  const namedChunks = allChunks.filter(
    (c) =>
      c.name &&
      (c.type === "function" || c.type === "class" || c.type === "method") &&
      !NON_SHIPPING.test(c.filePath)
  );

  let orphanCount = 0;
  for (const c of namedChunks) {
    if (
      ["main", "default", "index", "__init__", "constructor"].includes(c.name!)
    )
      continue;
    const fullName = c.name!;
    const dot = fullName.lastIndexOf(".");
    const bareName = dot >= 0 ? fullName.slice(dot + 1) : fullName;
    const refs =
      (refsByName.get(fullName) || 0) +
      (dot >= 0 ? refsByName.get(bareName) || 0 : 0);
    if (refs === 0) orphanCount++;
  }

  const totalCount = namedChunks.length;
  const pct = totalCount === 0 ? 0 : (orphanCount / totalCount) * 100;
  return { pct, orphanCount, totalCount };
}

// ─── Main analysis function ───

export function analyzeCodebase(indexer: Indexer): AuditAnalysis {
  const files = indexer.fileStore.getAll();
  const edges = indexer.graphStore.getAll();

  // 1. Security scan
  const securityIssues = scanSecurity(indexer);

  // 2. Circular dependency detection
  const circularDeps = detectCycles(files, edges);

  // 3. Dead code
  const { pct: deadCodePct, orphanCount, totalCount } =
    computeDeadCodePct(indexer);

  // 4. Coupling (max fan-in)
  const { maxFanIn, file: maxFanInFile } = computeMaxFanIn(files, edges);

  // 5. Compute health dimensions
  const dcGrade = deadCodeGrade(deadCodePct);
  const cdGrade = circularDepsGrade(circularDeps.length);
  const cpGrade = couplingGrade(maxFanIn);
  const scGrade = securityGrade(securityIssues.length);

  const dimensions: HealthDimension[] = [
    {
      name: "Dead code",
      grade: dcGrade,
      score: GRADE_VALUES[dcGrade],
      detail: `${Math.round(deadCodePct)}% orphan symbols (${orphanCount}/${totalCount})`,
    },
    {
      name: "Circular deps",
      grade: cdGrade,
      score: GRADE_VALUES[cdGrade],
      detail: `${circularDeps.length} cycle${circularDeps.length === 1 ? "" : "s"} detected`,
    },
    {
      name: "Coupling",
      grade: cpGrade,
      score: GRADE_VALUES[cpGrade],
      detail: maxFanIn > 0
        ? `max fan-in: ${maxFanIn} (${maxFanInFile})`
        : "no dependencies tracked",
    },
    {
      name: "Security",
      grade: scGrade,
      score: GRADE_VALUES[scGrade],
      detail: `${securityIssues.length} issue${securityIssues.length === 1 ? "" : "s"} found`,
    },
  ];

  // 6. Weighted average (equal 25% each)
  const numericScore =
    dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
  const overallGrade = numericToGrade(numericScore);

  return {
    healthScore: {
      grade: overallGrade,
      numericScore,
      dimensions,
    },
    securityIssues,
    circularDeps,
  };
}
