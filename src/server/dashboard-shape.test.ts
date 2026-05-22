import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Regression test for v0.24.0 dashboard init() error banner (PR #62) and
// v0.25.1 dashboard.js escape regression fix.
//
// These are structural tests over the shipped browser assets. We can't
// run them in vitest as JS (no DOM), but we CAN assert that the source
// shape that v0.24.0 + v0.25.1 introduced is still present. If anyone
// reverts one of the protections, the test fires.
//
// We also `node --check` the file as a parse-time gate. This is the same
// thing scripts/lint-assets.mjs does in CI; replicating it here means a
// 'npm test' run catches the regression even if the lint:assets step is
// somehow skipped or removed.

const here = dirname(fileURLToPath(import.meta.url));
const dashboardJsPath = join(here, "assets", "dashboard.js");
const dashboardHtmlPath = join(here, "dashboard-html.ts");

describe("dashboard browser assets — v0.24.0 + v0.25.1 shape", () => {
  it("dashboard.js parses cleanly with `node --check` (v0.25.1)", async () => {
    // Pre-v0.25.1, dashboard.js had over-escaped quotes from the
    // Tier-2.3 split (43e8174) on 2 distinct lines and threw
    // SyntaxError at parse time. Whole dashboard rendered blank.
    expect(existsSync(dashboardJsPath)).toBe(true);
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["--check", dashboardJsPath], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    if (result.status !== 0) {
      // surface the message so the failure is debuggable
      throw new Error(`node --check failed: ${result.stderr}`);
    }
  });

  it("dashboard.js wraps init() in .catch(showInitError) (v0.24.0)", () => {
    // Pre-v0.24.0: just `init();`. If /api/status or /api/stats failed,
    // the whole dashboard rendered as a silent blank page. This test
    // would FAIL on v0.23.1 because the catch wrapper didn't exist.
    const src = readFileSync(dashboardJsPath, "utf-8");
    expect(src).toContain("init().catch(showInitError)");
  });

  it("dashboard.js defines showInitError that targets #error-banner (v0.24.0)", () => {
    const src = readFileSync(dashboardJsPath, "utf-8");
    expect(src).toContain("function showInitError");
    expect(src).toContain("getElementById('error-banner')");
  });

  it("dashboard.js api() throws on non-2xx HTTP (v0.24.0)", () => {
    // Pre-v0.24.0, api() just did `return r.json()` — a 500 with text
    // body returned undefined or junk, downstream code crashed in
    // hard-to-diagnose ways. v0.24.0 throws an explicit error so the
    // init().catch banner shows the real cause.
    const src = readFileSync(dashboardJsPath, "utf-8");
    expect(src).toMatch(/if\s*\(\s*!r\.ok\s*\)/);
    expect(src).toContain("HTTP");
  });

  it("dashboard.js wires `branch` field from /api/status (v0.24.0)", () => {
    // Pre-v0.24.0, the breadcrumb hardcoded 'main'. Now it reads
    // state.status.branch which arrives from the server.
    const src = readFileSync(dashboardJsPath, "utf-8");
    expect(src).toContain("state.status.branch");
    // Belt-and-suspenders: confirm the literal 'main' hardcode is gone.
    expect(src).not.toMatch(/getElementById\('bc-branch'\)\.textContent\s*=\s*'main'/);
  });

  it("dashboard-html.ts includes the #error-banner div (v0.24.0)", () => {
    // The banner needs a DOM mount point. If someone removes the div
    // from the HTML template, showInitError has nothing to populate.
    const src = readFileSync(dashboardHtmlPath, "utf-8");
    expect(src).toContain('id="error-banner"');
  });
});
