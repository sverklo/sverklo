import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BifrostBaseline } from "./bifrost.ts";
import type { Task } from "../../types.ts";

// Smoke tests for the Bifrost baseline (PR #67).
//
// The gateway-unreachable path is the load-bearing case: this baseline
// is opt-in via BASELINES=bifrost, but when it does run we don't want
// 100 tasks × 30s timeouts wasted on a misconfigured gateway. Probe
// once in setup, then short-circuit each task if the gateway didn't
// answer. The other side (real /v1/chat/completions integration) is
// covered by manual + integration runs against a live Bifrost.

describe("BifrostBaseline", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("skip-mode: when the gateway is unreachable at setup, run() returns empty predictions without calling /v1/chat/completions", async () => {
    // /v1/models fetch fails (network error or non-200). setupForDataset
    // catches and sets cachedModel = null. Then run() must NOT issue any
    // additional fetch calls — it should short-circuit immediately.
    let chatCompletionsCalled = false;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/v1/chat/completions")) chatCompletionsCalled = true;
      throw new Error("simulated network failure");
    }) as unknown as typeof fetch;

    const baseline = new BifrostBaseline();
    await baseline.setupForDataset({ name: "test", rootPath: "/tmp" });

    const task: Task = {
      id: "t1",
      category: "P1",
      query: "find authentication",
      datasetName: "test",
    } as Task;

    const out = await baseline.run(task);

    expect(chatCompletionsCalled).toBe(false);
    expect(out.prediction.kind).toBe("locations");
    expect(out.rawPayload).toContain("unreachable");
    // Skip-mode returns 0 wall time — important so the bench doesn't
    // attribute a 30s timeout to "Bifrost is slow."
    expect(out.wallTimeMs).toBe(0);
  });

  it("uses SVERKLO_BIFROST_BASE_URL env var when set", async () => {
    // Inspect the URL that /v1/models is fetched from. The baseline
    // should respect the env var instead of hardcoded 127.0.0.1:8080.
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      seenUrls.push(u);
      throw new Error("ok — we just want the URL");
    }) as unknown as typeof fetch;

    const prev = process.env.SVERKLO_BIFROST_BASE_URL;
    process.env.SVERKLO_BIFROST_BASE_URL = "http://gateway.internal:9000";
    try {
      const baseline = new BifrostBaseline();
      await baseline.setupForDataset({ name: "test", rootPath: "/tmp" });
    } finally {
      if (prev === undefined) delete process.env.SVERKLO_BIFROST_BASE_URL;
      else process.env.SVERKLO_BIFROST_BASE_URL = prev;
    }

    expect(seenUrls.some((u) => u.startsWith("http://gateway.internal:9000"))).toBe(true);
  });

  it("returns the correct empty-prediction shape per task category", async () => {
    // Mock so the gateway 'fails' — we just need run() to take the
    // skip path so we can inspect the empty-prediction shapes.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("forced");
    }) as unknown as typeof fetch;

    const baseline = new BifrostBaseline();
    await baseline.setupForDataset({ name: "test", rootPath: "/tmp" });

    const p1 = await baseline.run({ id: "t", category: "P1", query: "q", datasetName: "d" } as Task);
    expect(p1.prediction.kind).toBe("locations");

    const p4 = await baseline.run({ id: "t", category: "P4", query: "q", datasetName: "d" } as Task);
    expect(p4.prediction.kind).toBe("deps");

    const p5 = await baseline.run({ id: "t", category: "P5", query: "q", datasetName: "d" } as Task);
    expect(p5.prediction.kind).toBe("names");
  });
});
