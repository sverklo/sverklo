import { describe, it, expect, vi, afterEach } from "vitest";
import { ollamaChat, parseJsonResponse } from "./ollama.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("parseJsonResponse", () => {
  it("parses plain JSON", () => {
    const r = parseJsonResponse<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.a).toBe(1);
  });

  it("parses JSON wrapped in a markdown code fence", () => {
    const r = parseJsonResponse<{ label: string }>(
      "Here is the result:\n```json\n{\"label\":\"auth\"}\n```\nenjoy"
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.label).toBe("auth");
  });

  it("reports failure for garbage", () => {
    const r = parseJsonResponse("not json at all");
    expect(r.ok).toBe(false);
  });
});

describe("ollamaChat", () => {
  it("returns ok=true on a well-formed response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "hello" }, model: "qwen2.5-coder:7b" }),
    } as unknown as Response);

    const r = await ollamaChat("prompt", { timeoutMs: 500 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("hello");
  });

  it("returns ok=false with reason=bad_status on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    } as unknown as Response);

    const r = await ollamaChat("prompt", { timeoutMs: 500 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("bad_status");
      expect(r.status).toBe(500);
    }
  });

  it("returns ok=false with reason=unreachable when fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const r = await ollamaChat("prompt", { timeoutMs: 500 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unreachable");
  });
});
