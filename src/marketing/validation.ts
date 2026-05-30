import type {
  CampaignWorkspace,
  EvidenceCatalog,
  OperatorDecision,
  ProfileSnapshot,
  RecentPostsSnapshot,
  TrendSnapshot,
} from "./models.js";

export function normalizeAccountHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) throw new Error("account handle is required");
  const normalized = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  if (!/^@[A-Za-z0-9_]{1,15}$/.test(normalized)) {
    throw new Error(`invalid account handle: ${handle}`);
  }
  return normalized;
}

export function assertTrendSnapshot(snapshot: TrendSnapshot): void {
  if (!snapshot || !snapshot.captured_at || !snapshot.source_label) {
    throw new Error("trend snapshot requires captured_at and source_label");
  }
  if (!Array.isArray(snapshot.items)) throw new Error("trend snapshot items must be an array");
  for (const item of snapshot.items) {
    if (!item.id || !item.text || !item.source_context) {
      throw new Error("each trend item requires id, text, and source_context");
    }
  }
}

export function assertProfileSnapshot(snapshot: ProfileSnapshot): void {
  if (!snapshot || !snapshot.captured_at) throw new Error("profile snapshot requires captured_at");
  normalizeAccountHandle(snapshot.account_handle);
  if (!snapshot.display_name.trim()) throw new Error("profile snapshot requires display_name");
  if (!snapshot.bio.trim()) throw new Error("profile snapshot requires bio");
}

export function assertRecentPostsSnapshot(snapshot: RecentPostsSnapshot): void {
  if (!snapshot || !snapshot.captured_at) throw new Error("recent posts snapshot requires captured_at");
  if (!Array.isArray(snapshot.posts)) throw new Error("recent posts must be an array");
  for (const post of snapshot.posts) {
    if (!post.id || !post.text || !post.posted_at) {
      throw new Error("each recent post requires id, text, and posted_at");
    }
  }
}

export function assertEvidenceCatalog(catalog: EvidenceCatalog): void {
  if (!catalog || !Array.isArray(catalog.items)) throw new Error("evidence catalog requires items");
  for (const item of catalog.items) {
    if (!item.evidence_id || !item.claim || !item.source_type || !item.source_path_or_url || !item.verified_at) {
      throw new Error("each evidence item requires id, claim, source_type, source_path_or_url, and verified_at");
    }
  }
}

export function assertDecision(decision: OperatorDecision): void {
  if (!decision.target_type || !decision.target_id || !decision.decision || !decision.created_at) {
    throw new Error("decision requires target_type, target_id, decision, and created_at");
  }
}

export function textMatchesBlockedTopic(workspace: CampaignWorkspace, text: string): string | undefined {
  const lower = text.toLowerCase();
  return workspace.blocked_topics.find((topic) => topic.trim() && lower.includes(topic.toLowerCase()));
}

export function looksPrivateOrConfidential(text: string): boolean {
  return (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
    /\b(?:\+?\d[\d .-]{8,}\d)\b/.test(text) ||
    /\b(api[_-]?key|secret|password|private customer|confidential)\b/i.test(text)
  );
}
