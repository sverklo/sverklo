import { describe, it, expect } from "vitest";
import { createDatabase } from "./database.js";
import { HandleStore, buildHandleUri, parseHandleUri } from "./handle-store.js";

function mkDb() {
  return createDatabase(":memory:");
}

describe("HandleStore", () => {
  it("round-trips a handle", () => {
    const db = mkDb();
    const store = new HandleStore(db);
    const h = store.create("sverklo_search", "BODY".repeat(50), "sha-1");
    expect(h.id).toMatch(/^ctx_[a-f0-9]+$/);
    const fetched = store.get(h.id);
    expect(fetched?.tool).toBe("sverklo_search");
    expect(fetched?.body.startsWith("BODY")).toBe(true);
  });

  it("getFresh rejects expired handles", () => {
    const db = mkDb();
    const store = new HandleStore(db);
    const h = store.create("sverklo_search", "x", "sha-1", -1); // already expired
    expect(store.getFresh(h.id, "sha-1")).toBeNull();
  });

  it("getFresh rejects stale-SHA handles when current SHA differs", () => {
    const db = mkDb();
    const store = new HandleStore(db);
    const h = store.create("sverklo_search", "x", "sha-1");
    expect(store.getFresh(h.id, "sha-2")).toBeNull();
    expect(store.getFresh(h.id, "sha-1")).not.toBeNull();
  });

  it("getFresh returns the handle when SHAs match and not expired", () => {
    const db = mkDb();
    const store = new HandleStore(db);
    const h = store.create("sverklo_refs", "data", "sha-x");
    const fresh = store.getFresh(h.id, "sha-x");
    expect(fresh).not.toBeNull();
    expect(fresh!.body).toBe("data");
  });

  it("purgeExpired drops only expired rows", () => {
    const db = mkDb();
    const store = new HandleStore(db);
    store.create("a", "x", null, -100);
    store.create("b", "x", null);
    expect(store.count()).toBe(2);
    const dropped = store.purgeExpired();
    expect(dropped).toBe(1);
    expect(store.count()).toBe(1);
  });

  it("preview is bounded", () => {
    const db = mkDb();
    const store = new HandleStore(db);
    const big = "abcdefgh".repeat(2000); // 16k chars
    const h = store.create("t", big);
    expect(h.preview.length).toBeLessThan(big.length);
    expect(h.preview.endsWith("…")).toBe(true);
  });
});

describe("URI helpers", () => {
  it("buildHandleUri strips sverklo_ prefix", () => {
    expect(buildHandleUri("sverklo_search", "ctx_abc123")).toBe("ctx://search/ctx_abc123");
  });

  it("parseHandleUri parses well-formed URIs", () => {
    expect(parseHandleUri("ctx://search/ctx_abc123")).toEqual({
      tool: "search",
      id: "ctx_abc123",
    });
  });

  it("parseHandleUri rejects invalid input", () => {
    expect(parseHandleUri("not a uri")).toBeNull();
    expect(parseHandleUri("ctx://search/")).toBeNull();
  });
});
