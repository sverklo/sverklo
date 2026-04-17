import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to set env vars BEFORE importing the module, but vitest hoists
// vi.mock calls. Use dynamic import inside tests instead.

describe("trace", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sverklo-trace-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("traceStart returns a handle with a trace ID", async () => {
    vi.stubEnv("SVERKLO_TRACE", "1");

    // Mock homedir so trace.log goes to our temp dir
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => tempDir };
    });

    const { traceStart } = await import("./trace.js");

    const handle = traceStart("sverklo_search", { query: "test" });
    expect(handle.traceId).toMatch(/^t-[0-9a-f]{6}$/);

    handle.end(1234);

    // Read the trace log
    const logPath = join(tempDir, ".sverklo", "trace.log");
    const content = readFileSync(logPath, "utf-8").trim();
    const lines = content.split("\n");
    expect(lines).toHaveLength(2);

    const req = JSON.parse(lines[0]);
    expect(req.phase).toBe("request");
    expect(req.tool).toBe("sverklo_search");
    expect(req.args).toEqual({ query: "test" });
    expect(req.trace).toBe(handle.traceId);

    const res = JSON.parse(lines[1]);
    expect(res.phase).toBe("response");
    expect(res.result_chars).toBe(1234);
    expect(res.duration_ms).toBeGreaterThanOrEqual(0);
    expect(res.trace).toBe(handle.traceId);
  });

  it("traceStart logs error phase on .error()", async () => {
    vi.stubEnv("SVERKLO_TRACE", "1");

    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => tempDir };
    });

    const { traceStart } = await import("./trace.js");

    const handle = traceStart("sverklo_lookup", { symbol: "Foo" });
    handle.error(new Error("not found"));

    const logPath = join(tempDir, ".sverklo", "trace.log");
    const content = readFileSync(logPath, "utf-8").trim();
    const lines = content.split("\n");
    expect(lines).toHaveLength(2);

    const errLine = JSON.parse(lines[1]);
    expect(errLine.phase).toBe("error");
    expect(errLine.error).toBe("not found");
  });

  it("sanitizes args — omits unknown keys, truncates long values", async () => {
    vi.stubEnv("SVERKLO_TRACE", "1");

    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => tempDir };
    });

    const { traceStart } = await import("./trace.js");

    const handle = traceStart("sverklo_remember", {
      content: "x".repeat(500), // should be omitted (not in safe keys)
      category: "architecture",
      secret_token: "abc123", // should be omitted
    });
    handle.end(100);

    const logPath = join(tempDir, ".sverklo", "trace.log");
    const req = JSON.parse(readFileSync(logPath, "utf-8").trim().split("\n")[0]);
    expect(req.args).toEqual({ category: "architecture" });
    expect(req.args.content).toBeUndefined();
    expect(req.args.secret_token).toBeUndefined();
  });

  it("no-ops when trace env vars are not set", async () => {
    vi.stubEnv("SVERKLO_TRACE", "");
    vi.stubEnv("SVERKLO_DEBUG", "");

    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => tempDir };
    });

    const { traceStart } = await import("./trace.js");

    const handle = traceStart("sverklo_search", { query: "test" });
    handle.end(100);

    const { existsSync } = await import("node:fs");
    const logPath = join(tempDir, ".sverklo", "trace.log");
    expect(existsSync(logPath)).toBe(false);
  });
});
