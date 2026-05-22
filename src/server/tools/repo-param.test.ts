import { describe, it, expect } from "vitest";
import { searchTool } from "./search.js";
import { lookupTool } from "./lookup.js";
import { investigateTool } from "./investigate.js";
import { searchIterativeTool } from "./search-iterative.js";

// Regression test for v0.24.0 cross-project search (PR #62).
//
// Pre-v0.24.0, the MCP server dispatcher at mcp-server.ts:860 already
// extracted `args.repo` and passed it to IndexerPool.getIndexer(repoName),
// but the 4 search-family tool schemas did NOT expose a `repo` field —
// so MCP clients (Claude Code, Cursor, etc.) had no way to discover the
// capability. Result: when asked to look at a neighboring sverklo-init'd
// project, Claude fell back to grep instead of using sverklo.
//
// v0.24.0 added optional `repo: string` to all 4 inputSchemas. These
// tests assert that surface is present and well-formed. They would
// FAIL on v0.23.1.

describe("v0.24.0 — `repo` param on search-family tool schemas", () => {
  const tools = [
    { name: "sverklo_search", tool: searchTool },
    { name: "sverklo_lookup", tool: lookupTool },
    { name: "sverklo_investigate", tool: investigateTool },
    { name: "sverklo_search_iterative", tool: searchIterativeTool },
  ];

  for (const { name, tool } of tools) {
    it(`${name}: inputSchema exposes optional \`repo\` field`, () => {
      const props = tool.inputSchema.properties as Record<string, { type?: string }>;
      // The contract: a string field called `repo`.
      expect(props).toHaveProperty("repo");
      expect(props.repo.type).toBe("string");
      // It MUST be optional (multi-cwd / single-cwd are both valid). The
      // schema's required[] should NOT include `repo`.
      const required = (tool.inputSchema as { required?: string[] }).required ?? [];
      expect(required).not.toContain("repo");
    });
  }

  it("each tool's `repo` description references sverklo_list_repos for discovery", () => {
    // The whole point of exposing the param is that the agent can find
    // available repo names. If the description loses this guidance,
    // the param becomes harder to use correctly.
    for (const { tool } of tools) {
      const props = tool.inputSchema.properties as Record<string, { description?: string }>;
      const desc = props.repo.description ?? "";
      expect(desc.toLowerCase()).toContain("sverklo_list_repos");
    }
  });
});
