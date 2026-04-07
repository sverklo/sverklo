import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Indexer } from "../indexer/indexer.js";
import type { MemoryCategory } from "../types/index.js";
import { embed } from "../indexer/embedder.js";
import { log } from "../utils/logger.js";

interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  tags: string[];
  related_files: string[];
  confidence: number;
}

// Source files we scan for memories, in priority order
const SOURCES: { path: string; category: MemoryCategory; confidence: number }[] = [
  { path: "CLAUDE.md", category: "context", confidence: 0.9 },
  { path: ".claude/CLAUDE.md", category: "context", confidence: 0.9 },
  { path: "AGENTS.md", category: "context", confidence: 0.9 },
  { path: ".cursorrules", category: "preference", confidence: 0.85 },
  { path: ".cursor/rules.md", category: "preference", confidence: 0.85 },
  { path: ".windsurfrules", category: "preference", confidence: 0.85 },
  { path: "docs/ARCHITECTURE.md", category: "decision", confidence: 0.95 },
  { path: "docs/architecture.md", category: "decision", confidence: 0.95 },
  { path: "ARCHITECTURE.md", category: "decision", confidence: 0.95 },
  { path: "CONTRIBUTING.md", category: "preference", confidence: 0.8 },
  { path: "docs/CONTRIBUTING.md", category: "preference", confidence: 0.8 },
];

// ADR directories — every file becomes a memory
const ADR_DIRS = [
  "docs/adr",
  "docs/adrs",
  "docs/decisions",
  "adr",
  "decisions",
];

export async function importExistingMemories(
  indexer: Indexer,
  projectPath: string
): Promise<{ imported: number; skipped: number; sources: string[] }> {
  const allMemories: { source: string; memories: ExtractedMemory[] }[] = [];

  // Scan known sources
  for (const src of SOURCES) {
    const fullPath = join(projectPath, src.path);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const memories = extractMemoriesFromMarkdown(
          content,
          src.category,
          src.confidence,
          src.path
        );
        if (memories.length > 0) {
          allMemories.push({ source: src.path, memories });
        }
      } catch (err) {
        log(`Failed to read ${src.path}`);
      }
    }
  }

  // Scan ADR directories
  for (const dir of ADR_DIRS) {
    const adrDir = join(projectPath, dir);
    if (existsSync(adrDir)) {
      try {
        const { readdirSync } = await import("node:fs");
        const files = readdirSync(adrDir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
          const content = readFileSync(join(adrDir, file), "utf-8");
          const memories = extractAdrMemory(content, join(dir, file));
          if (memories.length > 0) {
            allMemories.push({ source: join(dir, file), memories });
          }
        }
      } catch {}
    }
  }

  // Import git log commits as memories — only if no git-sourced memories exist yet
  const existingForGitCheck = indexer.memoryStore.getAll(1000);
  const hasGitMemories = existingForGitCheck.some((m) => {
    const rawTags = (m as { tags?: unknown }).tags;
    if (!rawTags) return false;
    try {
      const parsed =
        typeof rawTags === "string" ? JSON.parse(rawTags) : rawTags;
      return Array.isArray(parsed) && parsed.includes("git");
    } catch {
      return false;
    }
  });

  if (!hasGitMemories) {
    const gitLogMemories = importGitLog(projectPath, 50);
    if (gitLogMemories.length > 0) {
      allMemories.push({ source: "git log", memories: gitLogMemories });
    }
  }

  if (allMemories.length === 0) {
    return { imported: 0, skipped: 0, sources: [] };
  }

  // Get git state once
  const gitState = getGitState(projectPath);

  // Deduplicate against existing memories
  const existing = indexer.memoryStore.getAll(1000);
  const existingContent = new Set(existing.map((m) => m.content.trim().toLowerCase()));

  let imported = 0;
  let skipped = 0;
  const sources: string[] = [];

  for (const { source, memories } of allMemories) {
    let addedFromSource = 0;
    for (const mem of memories) {
      const key = mem.content.trim().toLowerCase();
      if (existingContent.has(key)) {
        skipped++;
        continue;
      }
      existingContent.add(key);

      // Insert memory
      const id = indexer.memoryStore.insert(
        mem.category,
        mem.content,
        mem.tags,
        mem.confidence,
        gitState.sha,
        gitState.branch,
        mem.related_files
      );

      // Generate embedding
      try {
        const [vector] = await embed([mem.content]);
        indexer.memoryEmbeddingStore.insert(id, vector);
      } catch (err) {
        log(`Failed to embed memory ${id}`);
      }

      imported++;
      addedFromSource++;
    }
    if (addedFromSource > 0) {
      sources.push(`${source} (${addedFromSource})`);
    }
  }

  return { imported, skipped, sources };
}

function extractMemoriesFromMarkdown(
  content: string,
  category: MemoryCategory,
  confidence: number,
  sourceFile: string
): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];

  // Strip frontmatter
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");

  // Split by H2 headers (## Something)
  const sections = body.split(/^##\s+/m);

  // First section (before any H2) is intro/overview — grab it as context
  const intro = sections[0].replace(/^#\s+.*$/m, "").trim();
  if (intro && intro.length > 40 && intro.length < 600) {
    memories.push({
      content: cleanMarkdown(intro).slice(0, 500),
      category: "context",
      tags: extractTags(sourceFile, intro),
      related_files: [sourceFile],
      confidence: confidence * 0.8,
    });
  }

  // Each H2 section becomes a memory
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const firstLineEnd = section.indexOf("\n");
    if (firstLineEnd === -1) continue;
    const heading = section.slice(0, firstLineEnd).trim();
    const body = section.slice(firstLineEnd).trim();

    if (!heading || body.length < 20) continue;

    // Skip generic sections
    if (/^(table of contents|contents|toc|license)/i.test(heading)) continue;

    // Split bullet lists into individual memories for finer granularity
    const bullets = body.match(/^[-*]\s+(.+?)(?=\n[-*]|\n\n|$)/gms);
    if (bullets && bullets.length >= 3) {
      // It's a list — each bullet is a memory
      for (const bullet of bullets) {
        const text = cleanMarkdown(bullet.replace(/^[-*]\s+/, "")).trim();
        if (text.length < 15 || text.length > 400) continue;
        memories.push({
          content: `${heading}: ${text}`,
          category: inferCategory(heading, text, category),
          tags: extractTags(sourceFile, heading + " " + text),
          related_files: [sourceFile],
          confidence,
        });
      }
    } else {
      // Prose section — use heading + first paragraph
      const firstPara = body.split(/\n\n/)[0];
      if (firstPara.length < 20 || firstPara.length > 500) continue;
      memories.push({
        content: `${heading}: ${cleanMarkdown(firstPara)}`,
        category: inferCategory(heading, firstPara, category),
        tags: extractTags(sourceFile, heading + " " + firstPara),
        related_files: [sourceFile],
        confidence,
      });
    }
  }

  return memories;
}

function extractAdrMemory(content: string, sourceFile: string): ExtractedMemory[] {
  // ADRs have specific structure: Title, Status, Context, Decision, Consequences
  const lines = content.split("\n");
  const title = lines.find((l) => l.startsWith("# "))?.replace(/^#\s+/, "").trim();
  if (!title) return [];

  // Extract the "Decision" section
  const decisionMatch = content.match(/##\s+Decision\s*\n+([\s\S]+?)(?=\n##|$)/i);
  const decision = decisionMatch ? cleanMarkdown(decisionMatch[1]).trim() : "";

  // Extract the "Context" section
  const contextMatch = content.match(/##\s+Context\s*\n+([\s\S]+?)(?=\n##|$)/i);
  const context = contextMatch ? cleanMarkdown(contextMatch[1]).trim() : "";

  if (!decision) return [];

  const combined = `${title}: ${decision}`.slice(0, 600);

  return [{
    content: combined,
    category: "decision",
    tags: ["adr", ...extractTags(sourceFile, title + " " + decision)],
    related_files: [sourceFile],
    confidence: 0.95,
  }];
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "[code]") // remove code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1") // bold/italic
    .replace(/^>\s+/gm, "") // blockquotes
    .replace(/\n{3,}/g, "\n\n") // multiple newlines
    .trim();
}

function inferCategory(
  heading: string,
  body: string,
  fallback: MemoryCategory
): MemoryCategory {
  const text = (heading + " " + body).toLowerCase();

  if (/\bdecide|decision|chose|selected|we use|we picked\b/.test(text)) return "decision";
  if (/\bprefer|convention|style|naming|always|never\b/.test(text)) return "preference";
  if (/\bpattern|approach|how to|we usually\b/.test(text)) return "pattern";
  if (/\btodo|fixme|future|planned\b/.test(text)) return "todo";

  return fallback;
}

function extractTags(sourceFile: string, text: string): string[] {
  const tags = new Set<string>();

  // File-based tags
  if (/CLAUDE\.md/i.test(sourceFile)) tags.add("claude");
  if (/cursor/i.test(sourceFile)) tags.add("cursor");
  if (/architecture/i.test(sourceFile)) tags.add("architecture");
  if (/contributing/i.test(sourceFile)) tags.add("contributing");
  if (/adr/i.test(sourceFile)) tags.add("adr");

  // Content-based keyword tags
  const lower = text.toLowerCase();
  const keywords = [
    "database", "auth", "api", "testing", "deployment",
    "frontend", "backend", "typescript", "security", "performance",
    "logging", "monitoring", "build", "ci", "docker",
  ];
  for (const kw of keywords) {
    if (lower.includes(kw)) tags.add(kw);
    if (tags.size >= 5) break;
  }

  return Array.from(tags).slice(0, 5);
}

// Conventional commit prefixes we care about
const CONVENTIONAL_PREFIXES = ["feat", "fix", "refactor", "perf", "chore"];
const DECISION_PREFIXES = new Set(["feat", "fix", "refactor"]);

export function importGitLog(
  projectPath: string,
  limit: number = 50
): ExtractedMemory[] {
  let raw: string;
  try {
    raw = execSync(
      `git log --format=%H%n%s%n%b%n==END==%n -n ${limit}`,
      { cwd: projectPath, encoding: "utf-8", timeout: 5000, maxBuffer: 5 * 1024 * 1024 }
    );
  } catch {
    return [];
  }

  const memories: ExtractedMemory[] = [];
  const entries = raw.split(/^==END==$/m);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    if (lines.length < 2) continue;

    const sha = lines[0].trim();
    const subject = (lines[1] || "").trim();
    const body = lines.slice(2).join("\n").trim();

    if (!sha || !subject) continue;

    // Match conventional commit prefix (allow optional scope and !)
    const prefixMatch = subject.match(/^([a-z]+)(?:\([^)]+\))?!?:\s*(.+)$/);
    if (!prefixMatch) continue;
    const prefix = prefixMatch[1].toLowerCase();
    if (!CONVENTIONAL_PREFIXES.includes(prefix)) continue;

    // Build content: subject + first sentence of body if present
    let content = subject;
    if (body) {
      const firstSentence = body.split(/(?<=[.!?])\s+|\n\n/)[0].trim();
      if (firstSentence) {
        content = `${subject} — ${firstSentence}`;
      }
    }

    // Skip too-short or too-long commits
    if (content.length < 20 || content.length > 500) continue;

    const category: MemoryCategory = DECISION_PREFIXES.has(prefix)
      ? "decision"
      : "context";

    const tags = ["git", prefix, ...extractTags("git log", subject + " " + body)]
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 6);

    memories.push({
      content,
      category,
      tags,
      related_files: [],
      confidence: 0.7,
    });
  }

  return memories;
}

function getGitState(rootPath: string): { sha: string | null; branch: string | null } {
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: rootPath, encoding: "utf-8", timeout: 3000 }).trim();
    const branch = execSync("git branch --show-current", { cwd: rootPath, encoding: "utf-8", timeout: 3000 }).trim();
    return { sha: sha || null, branch: branch || null };
  } catch {
    return { sha: null, branch: null };
  }
}
