import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  CampaignCycle,
  CampaignWorkspace,
  OperatorDecision,
} from "./models.js";
import { DEFAULT_POSITIONING_PHRASES as PHRASES } from "./models.js";

export interface MarketingPaths {
  root: string;
  workspace: string;
  inputs: string;
  cycles: string;
  reports: string;
  decisions: string;
}

export function resolveMarketingWorkspace(path?: string): string {
  return resolve(path ?? ".sverklo/marketing");
}

export function marketingPaths(root: string): MarketingPaths {
  return {
    root,
    workspace: join(root, "workspace.json"),
    inputs: join(root, "inputs"),
    cycles: join(root, "cycles"),
    reports: join(root, "reports"),
    decisions: join(root, "decisions.jsonl"),
  };
}

export function ensureMarketingDirs(root: string): MarketingPaths {
  const paths = marketingPaths(root);
  for (const dir of [paths.root, paths.inputs, paths.cycles, paths.reports]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}

export function jsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function maybeJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return jsonFile<T>(path);
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function initMarketingWorkspace(input: {
  workspacePath?: string;
  accountHandle: string;
  now?: string;
}): CampaignWorkspace {
  const root = resolveMarketingWorkspace(input.workspacePath);
  const paths = ensureMarketingDirs(root);
  const now = input.now ?? new Date().toISOString();
  const existing = maybeJsonFile<CampaignWorkspace>(paths.workspace);
  const workspace: CampaignWorkspace = {
    workspace_id: existing?.workspace_id ?? `workspace-${Date.now()}`,
    account_handle: input.accountHandle,
    active_cycle_id: existing?.active_cycle_id,
    positioning_phrases: existing?.positioning_phrases?.length
      ? existing.positioning_phrases
      : [...PHRASES],
    blocked_topics: existing?.blocked_topics ?? [],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  writeJsonFile(paths.workspace, workspace);
  return workspace;
}

export function loadMarketingWorkspace(workspacePath?: string): CampaignWorkspace {
  const root = resolveMarketingWorkspace(workspacePath);
  const path = marketingPaths(root).workspace;
  if (!existsSync(path)) {
    throw new Error(`marketing workspace not initialized: ${root}`);
  }
  return jsonFile<CampaignWorkspace>(path);
}

export function saveMarketingWorkspace(workspacePath: string | undefined, workspace: CampaignWorkspace): void {
  const root = resolveMarketingWorkspace(workspacePath);
  ensureMarketingDirs(root);
  writeJsonFile(marketingPaths(root).workspace, workspace);
}

export function cyclePath(root: string, cycleId: string): string {
  return join(marketingPaths(root).cycles, `${cycleId}.json`);
}

export function saveCampaignCycle(workspacePath: string | undefined, cycle: CampaignCycle): void {
  const root = resolveMarketingWorkspace(workspacePath);
  ensureMarketingDirs(root);
  writeJsonFile(cyclePath(root, cycle.cycle_id), cycle);
}

export function loadCampaignCycle(workspacePath: string | undefined, cycleId: string): CampaignCycle {
  const root = resolveMarketingWorkspace(workspacePath);
  return jsonFile<CampaignCycle>(cyclePath(root, cycleId));
}

export function loadActiveCampaignCycle(
  workspacePath: string | undefined,
  workspace: CampaignWorkspace,
): CampaignCycle | undefined {
  if (!workspace.active_cycle_id) return undefined;
  const root = resolveMarketingWorkspace(workspacePath);
  const path = cyclePath(root, workspace.active_cycle_id);
  return maybeJsonFile<CampaignCycle>(path);
}

export function appendOperatorDecision(
  workspacePath: string | undefined,
  decision: OperatorDecision,
): void {
  const root = resolveMarketingWorkspace(workspacePath);
  const paths = ensureMarketingDirs(root);
  appendFileSync(paths.decisions, JSON.stringify(decision) + "\n");
}

export function reportPath(workspacePath: string | undefined, cycleId: string, kind: string): string {
  const root = resolveMarketingWorkspace(workspacePath);
  return join(marketingPaths(root).reports, `${cycleId}-${kind}.md`);
}

export function writeReport(workspacePath: string | undefined, cycleId: string, kind: string, content: string): void {
  writeFileSync(reportPath(workspacePath, cycleId, kind), content.endsWith("\n") ? content : `${content}\n`);
}
