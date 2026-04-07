import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { MemoryCategory } from "../types/index.js";
import { log } from "../utils/logger.js";

interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  tags: string[];
  related_files: string[];
  confidence: number;
}

// Phrases that signal a decision/preference being expressed by the user
const USER_DECISION_PATTERNS: RegExp[] = [
  /\blet'?s use\b/i,
  /\bwe('| a)?re? (going to|gonna) use\b/i,
  /\bwe decided\b/i,
  /\bthe plan is\b/i,
  /\buse .{1,40} instead of\b/i,
  /\bi prefer\b/i,
  /\bi want to use\b/i,
  /\bgo with\b/i,
  /\bswitch to\b/i,
  /\bstick with\b/i,
  /\bdon'?t use\b/i,
  /\bnever use\b/i,
  /\balways use\b/i,
  /\bi'?ll use\b/i,
  /\bmake sure\b/i,
];

// Phrases that signal an assistant announcing an architectural choice
const ASSISTANT_DECISION_PATTERNS: RegExp[] = [
  /\bi'?ll use .{1,60} because\b/i,
  /\bi'?m using .{1,60} because\b/i,
  /\blet'?s go with\b/i,
  /\bthe approach (is|will be)\b/i,
  /\bi'?ll choose\b/i,
  /\bi recommend\b/i,
  /\bwe should use\b/i,
  /\bbest approach\b/i,
];

// Patterns for content we want to skip outright
const SKIP_PATTERNS: RegExp[] = [
  /^\s*\[?(tool|tool_use|tool_result)/i,
  /^\s*<system-reminder>/i,
  /^\s*<command-/i,
  /^\s*\{[\s\S]*\}\s*$/, // looks like JSON blob
];

const MAX_MESSAGES_PER_FILE = 100;
const MAX_MEMORIES_PER_PASS = 50;
const MIN_MESSAGE_LEN = 30;
const MAX_MEMORY_LEN = 500;

export interface MinedChatsResult {
  memories: ExtractedMemory[];
  filesScanned: number;
  matchedDir: string | null;
}

/**
 * Mine Claude Code conversation transcripts under ~/.claude/projects for
 * decision-worthy statements made about the given project.
 */
export function mineClaudeCodeChats(projectPath: string): MinedChatsResult {
  const absProject = resolve(projectPath);
  const projectsRoot = join(homedir(), ".claude", "projects");

  if (!existsSync(projectsRoot)) {
    return { memories: [], filesScanned: 0, matchedDir: null };
  }

  const matchedDir = findTranscriptDir(projectsRoot, absProject);
  if (!matchedDir) {
    return { memories: [], filesScanned: 0, matchedDir: null };
  }

  // Collect JSONL files (recursive: project root + subagents subfolders).
  // Sort by mtime descending — recent conversations matter more.
  const jsonlFiles = collectJsonlFiles(matchedDir).sort(
    (a, b) => b.mtime - a.mtime
  );

  const candidates: ExtractedMemory[] = [];
  let filesScanned = 0;

  for (const file of jsonlFiles) {
    if (candidates.length >= MAX_MEMORIES_PER_PASS * 3) break;
    try {
      const fileMemories = mineFile(file.path, absProject);
      candidates.push(...fileMemories);
      filesScanned++;
    } catch (err) {
      log(`Failed to mine chat file ${file.path}`);
    }
  }

  // Rank: confidence desc, then length (prefer concise)
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.content.length - b.content.length;
  });

  // Dedup within this pass by normalized content
  const seen = new Set<string>();
  const memories: ExtractedMemory[] = [];
  for (const m of candidates) {
    const key = m.content.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    memories.push(m);
    if (memories.length >= MAX_MEMORIES_PER_PASS) break;
  }

  return { memories, filesScanned, matchedDir };
}

/**
 * Claude Code encodes project paths by replacing path separators (and dots)
 * with dashes, e.g. /Users/nikita/projects/foo -> -Users-nikita-projects-foo.
 * The exact rules vary slightly by version, so we generate the expected
 * encoding and also fall back to scanning every directory and matching by
 * the `cwd` field on the first user message.
 */
function findTranscriptDir(
  projectsRoot: string,
  absProject: string
): string | null {
  const encoded = encodeProjectPath(absProject);
  const direct = join(projectsRoot, encoded);
  if (existsSync(direct) && statSync(direct).isDirectory()) {
    return direct;
  }

  // Fallback: scan dirs and match by cwd field on a sample message
  let entries: string[];
  try {
    entries = readdirSync(projectsRoot);
  } catch {
    return null;
  }

  // First pass: prefix match — projects whose encoded form matches a prefix
  // of the project (handles repos that aren't yet recorded as a discrete dir)
  // OR projects whose encoded form contains the project encoding (subdir sessions)
  const prefixCandidates = entries.filter(
    (e) => encoded === e || encoded.startsWith(e + "-") || e.startsWith(encoded + "-")
  );
  // Prefer the longest (most specific) prefix match
  prefixCandidates.sort((a, b) => b.length - a.length);

  for (const entry of prefixCandidates) {
    const full = join(projectsRoot, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (sampleDirHasCwd(full, absProject)) return full;
  }

  // Second pass: scan all dirs for a cwd match (expensive but reliable)
  for (const entry of entries) {
    if (prefixCandidates.includes(entry)) continue;
    const full = join(projectsRoot, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (sampleDirHasCwd(full, absProject)) return full;
  }

  return null;
}

function encodeProjectPath(absPath: string): string {
  // Replace / and . with -. Drop trailing dash.
  return absPath.replace(/[/.]/g, "-").replace(/-+$/g, "");
}

function sampleDirHasCwd(dir: string, absProject: string): boolean {
  const files = collectJsonlFiles(dir).slice(0, 3);
  for (const f of files) {
    try {
      const content = readFileSync(f.path, "utf-8");
      const lines = content.split("\n").slice(0, 20);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj.cwd === "string") {
            const cwd = resolve(obj.cwd);
            // Three match directions:
            // 1. cwd is exactly our project
            // 2. cwd is inside our project (subdir session)
            // 3. cwd is a parent of our project (started from above)
            if (
              cwd === absProject ||
              cwd.startsWith(absProject + "/") ||
              absProject.startsWith(cwd + "/")
            ) {
              return true;
            }
          }
        } catch {}
      }
    } catch {}
  }
  return false;
}

function collectJsonlFiles(
  dir: string,
  out: { path: string; mtime: number }[] = []
): { path: string; mtime: number }[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectJsonlFiles(full, out);
    } else if (name.endsWith(".jsonl")) {
      out.push({ path: full, mtime: st.mtimeMs });
    }
  }
  return out;
}

function mineFile(filePath: string, absProject: string): ExtractedMemory[] {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");

  // Parse all lines, but only keep user/assistant message lines, then take
  // the most recent MAX_MESSAGES_PER_FILE.
  const messages: {
    role: "user" | "assistant";
    text: string;
    cwd?: string;
  }[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Filter by cwd to make sure this message belongs to our project.
    // Accept if cwd is our project, inside it, or a parent of it.
    if (typeof obj.cwd === "string") {
      const cwd = resolve(obj.cwd);
      const isOurs =
        cwd === absProject ||
        cwd.startsWith(absProject + "/") ||
        absProject.startsWith(cwd + "/");
      if (!isOurs) {
        // Wrong project — skip
        continue;
      }
    }

    if (obj.type !== "user" && obj.type !== "assistant") continue;

    const text = extractText(obj);
    if (!text) continue;

    messages.push({
      role: obj.type === "user" ? "user" : "assistant",
      text,
      cwd: obj.cwd,
    });
  }

  // Take the most recent N
  const recent = messages.slice(-MAX_MESSAGES_PER_FILE);

  const memories: ExtractedMemory[] = [];
  for (const msg of recent) {
    const text = msg.text.trim();
    if (text.length < MIN_MESSAGE_LEN) continue;
    if (SKIP_PATTERNS.some((p) => p.test(text))) continue;
    // Skip messages that look like file dumps (lots of newlines or very long)
    if (text.length > 4000) continue;
    if ((text.match(/\n/g) || []).length > 30) continue;

    const patterns =
      msg.role === "user" ? USER_DECISION_PATTERNS : ASSISTANT_DECISION_PATTERNS;
    if (!patterns.some((p) => p.test(text))) continue;

    // Extract a focused snippet around the matched phrase
    const snippet = focusSnippet(text);
    if (snippet.length < MIN_MESSAGE_LEN) continue;

    const category = inferCategory(snippet);
    const confidence = msg.role === "user" ? 0.7 : 0.6;

    memories.push({
      content: snippet.slice(0, MAX_MEMORY_LEN),
      category,
      tags: buildTags(snippet, msg.role),
      related_files: [],
      confidence,
    });
  }

  return memories;
}

/**
 * Extract plain text from a Claude Code message record. Content can be a
 * string (older format) or an array of content blocks (newer format).
 */
function extractText(obj: any): string {
  const message = obj.message;
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
    // Skip tool_use, tool_result, thinking, image blocks
  }
  return parts.join("\n");
}

/**
 * Reduce a long message to one or two sentences containing the trigger.
 */
function focusSnippet(text: string): string {
  // Split into sentences/paragraphs
  const paras = text.split(/\n\n+/);
  const allPatterns = [...USER_DECISION_PATTERNS, ...ASSISTANT_DECISION_PATTERNS];

  for (const para of paras) {
    if (allPatterns.some((p) => p.test(para))) {
      // Within this paragraph pull just the matching sentence(s)
      const sentences = para.split(/(?<=[.!?])\s+/);
      const matchIdx = sentences.findIndex((s) =>
        allPatterns.some((p) => p.test(s))
      );
      if (matchIdx >= 0) {
        const start = Math.max(0, matchIdx);
        const end = Math.min(sentences.length, matchIdx + 2);
        return sentences.slice(start, end).join(" ").trim();
      }
      return para.trim();
    }
  }
  return text.trim();
}

function inferCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();
  if (/\bdecide|decision|chose|selected|we use|we picked|instead of\b/.test(lower))
    return "decision";
  if (/\bprefer|convention|style|naming|always|never\b/.test(lower))
    return "preference";
  if (/\bpattern|approach|how to|we usually\b/.test(lower)) return "pattern";
  if (/\btodo|fixme|future|planned\b/.test(lower)) return "todo";
  return "decision";
}

function buildTags(text: string, role: "user" | "assistant"): string[] {
  const tags = new Set<string>(["claude-code", "mined", role]);
  const lower = text.toLowerCase();
  const keywords = [
    "database",
    "auth",
    "api",
    "testing",
    "deployment",
    "frontend",
    "backend",
    "typescript",
    "security",
    "performance",
    "logging",
    "monitoring",
    "build",
    "ci",
    "docker",
    "sqlite",
    "embedding",
    "search",
    "indexer",
    "mcp",
  ];
  for (const kw of keywords) {
    if (lower.includes(kw)) tags.add(kw);
    if (tags.size >= 7) break;
  }
  return Array.from(tags).slice(0, 7);
}
