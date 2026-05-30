import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendOperatorDecision,
  initMarketingWorkspace,
  loadMarketingWorkspace,
  saveCampaignCycle,
  loadCampaignCycle,
} from "./storage.js";
import type { CampaignCycle } from "./models.js";

describe("marketing storage", () => {
  it("initializes workspace directories and persists workspace.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "sverklo-marketing-storage-"));
    try {
      const workspace = initMarketingWorkspace({
        workspacePath: dir,
        accountHandle: "@sverklo",
        now: "2026-05-30T15:00:00Z",
      });
      expect(workspace.account_handle).toBe("@sverklo");
      expect(loadMarketingWorkspace(dir).positioning_phrases.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists cycles and decision JSONL locally", () => {
    const dir = mkdtempSync(join(tmpdir(), "sverklo-marketing-cycle-"));
    try {
      const cycle: CampaignCycle = {
        cycle_id: "cycle-test",
        status: "operator_review",
        period_start: "2026-05-30T15:00:00Z",
        period_end: "2026-05-30T15:00:00Z",
        opportunity_ids: [],
        content_item_ids: [],
        opportunities: [],
        briefs: [],
        decisions: [],
        created_at: "2026-05-30T15:00:00Z",
        updated_at: "2026-05-30T15:00:00Z",
      };
      saveCampaignCycle(dir, cycle);
      appendOperatorDecision(dir, {
        decision_id: "decision-1",
        target_type: "campaign_cycle",
        target_id: "cycle-test",
        decision: "archive",
        created_at: "2026-05-30T15:01:00Z",
        applies_to_future_cycles: false,
      });
      expect(loadCampaignCycle(dir, "cycle-test").cycle_id).toBe("cycle-test");
      expect(readFileSync(join(dir, "decisions.jsonl"), "utf-8")).toContain("decision-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
