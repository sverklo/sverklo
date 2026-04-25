import type { Indexer } from "./indexer.js";
import type { ConceptStore } from "../storage/concept-store.js";
import { clusterContentHash } from "../storage/concept-store.js";
import type { FileCluster } from "../search/cluster.js";
import { ollamaChat, parseJsonResponse, type OllamaChatOptions } from "../utils/ollama.js";

// Offline pass: feed each cluster to Ollama, get back {label, summary, tags},
// embed label+summary, store the result. Skips clusters whose content_hash
// hasn't changed since the last run. Degrades gracefully when Ollama is
// unreachable — every cluster records its own failure reason so the CLI
// can give the user a targeted message.

export interface LabelingOptions extends OllamaChatOptions {
  force?: boolean;                    // re-label even if hash unchanged
  maxClusters?: number;               // cap (default: all clusters)
  onProgress?: (completed: number, total: number, clusterId: number) => void;
}

export interface LabelingResult {
  labeled: number;
  skipped: number;
  failed: number;
  failures: Array<{ cluster_id: number; reason: string }>;
  totalClusters: number;
}

export interface ConceptLabelJson {
  label: string;
  summary: string;
  tags: string[];
}

const SYSTEM_PROMPT =
  `You are labeling a code cluster — a set of related files + top symbols. ` +
  `Respond with STRICT JSON of this shape, no prose: ` +
  `{"label":"…","summary":"…","tags":["…","…"]}. ` +
  `The label is a short noun phrase (2–5 words) naming the subsystem. ` +
  `The summary is one sentence explaining what the cluster does. ` +
  `Tags are 2–5 lowercase keywords. ` +
  `If the cluster is too small or incoherent to label, use {"label":"unclear","summary":"","tags":[]}.`;

export async function labelClusters(
  indexer: Indexer,
  clusters: FileCluster[],
  conceptStore: ConceptStore,
  opts: LabelingOptions = {}
): Promise<LabelingResult> {
  const totalClusters = clusters.length;
  const cap = opts.maxClusters ?? totalClusters;
  const targets = clusters.slice(0, cap);

  const result: LabelingResult = {
    labeled: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    totalClusters,
  };

  for (let i = 0; i < targets.length; i++) {
    const cluster = targets[i];
    opts.onProgress?.(i, targets.length, cluster.id);

    // Fingerprint — skip if unchanged.
    const memberFileIds = cluster.files.map(extractIdFromPath);
    const chunkCount = cluster.files.length;
    const contentHash = clusterContentHash(memberFileIds, chunkCount);

    if (!opts.force) {
      const existing = conceptStore.get(cluster.id);
      if (existing && existing.content_hash === contentHash) {
        result.skipped++;
        continue;
      }
    }

    const prompt = buildClusterPrompt(cluster, indexer);
    const chat = await ollamaChat(prompt, { ...opts, system: SYSTEM_PROMPT, format: "json" });
    if (!chat.ok) {
      result.failed++;
      result.failures.push({ cluster_id: cluster.id, reason: chat.message });
      continue;
    }

    const parsed = parseJsonResponse<ConceptLabelJson>(chat.content);
    if (!parsed.ok) {
      result.failed++;
      result.failures.push({ cluster_id: cluster.id, reason: `parse_error: ${parsed.message}` });
      continue;
    }

    const { label, summary, tags } = parsed.value;
    if (!label || label === "unclear") {
      // Skip storage for unclear clusters — they're noise and re-running
      // doesn't cost anything because the hash will still miss.
      result.skipped++;
      continue;
    }

    conceptStore.upsert({
      cluster_id: cluster.id,
      label,
      summary: summary || null,
      tags: tags ?? [],
      hub_file: cluster.hubFile,
      member_count: cluster.size,
      content_hash: contentHash,
    });

    // Embed the label+summary so sverklo_concepts can cosine-match.
    const text = summary ? `${label}. ${summary}` : label;
    const [vec] = await indexer.embed([text]);
    if (vec) conceptStore.upsertEmbedding(cluster.id, vec);

    result.labeled++;
  }

  return result;
}

// FileCluster doesn't carry file ids (only paths), so we derive a stable
// numeric fingerprint from the path instead. Good enough for the "has this
// cluster changed" hash check.
function extractIdFromPath(file: { path: string }): number {
  let h = 0;
  for (let i = 0; i < file.path.length; i++) {
    h = (h * 31 + file.path.charCodeAt(i)) | 0;
  }
  return h;
}

function buildClusterPrompt(cluster: FileCluster, indexer: Indexer): string {
  const lines: string[] = [];
  lines.push(`Cluster "${cluster.name}"`);
  lines.push(`Hub file: ${cluster.hubFile}`);
  lines.push(`Size: ${cluster.size} files`);
  lines.push("");
  lines.push("Top files by PageRank:");
  for (const f of cluster.files.slice(0, 6)) {
    lines.push(`  - ${f.path}  (pagerank=${f.pagerank.toFixed(4)}, ${f.language})`);
  }
  lines.push("");

  // Top exported symbols from the hub file — gives the model a concrete
  // signal of what lives in the cluster.
  const hubFile = indexer.fileStore
    .getAll()
    .find((f) => f.path === cluster.hubFile);
  if (hubFile) {
    const chunks = indexer.chunkStore
      .getByFile(hubFile.id)
      .filter((c) => c.name && ["function", "class", "method", "type", "interface"].includes(c.type))
      .slice(0, 8);
    if (chunks.length > 0) {
      lines.push("Top symbols in hub file:");
      for (const c of chunks) {
        const sig = c.signature?.slice(0, 80) ?? c.name ?? "(anonymous)";
        lines.push(`  - ${c.type} ${c.name}: ${sig}`);
      }
      lines.push("");
    }
  }

  lines.push(
    `Return JSON with a short label (2-5 words), a one-sentence summary, ` +
      `and 2-5 lowercase tags.`
  );
  return lines.join("\n");
}
