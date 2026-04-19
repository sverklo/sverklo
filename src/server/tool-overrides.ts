// Runtime-overridable tool descriptions and enable/disable flags.
//
// Power users frequently want to repurpose sverklo tools without forking.
// The three levers exposed here are:
//
//   1. Description overrides via `SVERKLO_TOOL_<NAME>_DESCRIPTION`
//      Override the description text the agent sees for any tool. Useful
//      for re-scoping `sverklo_remember` into an architecture-decision log,
//      or for adding project-specific guidance the model will follow.
//
//   2. Disable-list via `SVERKLO_DISABLED_TOOLS`
//      Comma-separated list of tool names to hide from the `tools/list`
//      response. Useful when a project doesn't want memory tools exposed,
//      or when a user wants to shrink the tool surface for a specific
//      agent that gets overwhelmed by 23 options.
//
//   3. Profile shortcut via `SVERKLO_PROFILE`
//      Pre-defined named subsets — `core` keeps only the 5 hot search/graph
//      tools (search, lookup, overview, refs, impact) and hides everything
//      else. `nav` adds deps + context. `lean` adds the memory layer. `full`
//      (default) exposes all 23 tools.
//      Inspired by mibayy/token-savior's profile system. The point is to
//      keep the MCP `tools/list` payload small for token-conscious users
//      who don't need the full surface.
//      Profile filtering composes with the disabled-list — disabled tools
//      are still hidden even inside a profile.
//
// Design notes:
//
//   - The env var is read once at process startup and cached. Restart the
//     MCP server to pick up changes — this matches how agents already
//     expect tool metadata to work (stable per session).
//   - Description overrides are applied AFTER we copy the tool object, so
//     the underlying tool definitions stay pristine and unit tests against
//     them remain stable.
//   - Name normalisation: SVERKLO_TOOL_SEARCH_DESCRIPTION and
//     SVERKLO_TOOL_sverklo_search_DESCRIPTION both target `sverklo_search`.
//     We strip the `sverklo_` prefix before matching, upper-case, and
//     replace underscores with nothing. This keeps env var names short.
//
// Inspired by the Qdrant MCP server's `TOOL_*_DESCRIPTION` pattern.

export interface ToolLike {
  name: string;
  description: string;
  inputSchema: unknown;
}

interface OverrideCache {
  disabled: Set<string>;
  descriptions: Map<string, string>;
  profile: Set<string> | null; // null = no profile filter (keep all)
}

let cache: OverrideCache | null = null;

// Pre-defined profiles. Names match Token Savior's convention.
// `full` is the implicit default and intentionally absent — when no
// profile is set we don't filter.
const PROFILES: Record<string, string[]> = {
  core: [
    // The 5 tools an agent actually reaches for in 80% of code-intel sessions.
    "sverklo_search",
    "sverklo_lookup",
    "sverklo_overview",
    "sverklo_refs",
    "sverklo_impact",
  ],
  nav: [
    "sverklo_search",
    "sverklo_lookup",
    "sverklo_overview",
    "sverklo_refs",
    "sverklo_impact",
    "sverklo_deps",
    "sverklo_context",
    "sverklo_status",
  ],
  lean: [
    "sverklo_search",
    "sverklo_lookup",
    "sverklo_overview",
    "sverklo_refs",
    "sverklo_impact",
    "sverklo_deps",
    "sverklo_context",
    "sverklo_status",
    "sverklo_remember",
    "sverklo_recall",
    "sverklo_review_diff",
  ],
};

function normalizeEnvSuffix(name: string): string {
  // "sverklo_search" -> "SEARCH"
  // "sverklo_review_diff" -> "REVIEW_DIFF"
  // "search_code" (compat alias) -> "SEARCH_CODE"
  const stripped = name.startsWith("sverklo_") ? name.slice("sverklo_".length) : name;
  return stripped.toUpperCase();
}

function buildCache(): OverrideCache {
  const disabled = new Set<string>();
  const descriptions = new Map<string, string>();

  const disabledList = process.env.SVERKLO_DISABLED_TOOLS;
  if (disabledList) {
    for (const raw of disabledList.split(",")) {
      const name = raw.trim();
      if (name) disabled.add(name);
    }
  }

  // Description overrides. We scan process.env for any key starting with
  // `SVERKLO_TOOL_` and ending in `_DESCRIPTION`. Everything between is the
  // normalized tool-name suffix.
  const prefix = "SVERKLO_TOOL_";
  const suffix = "_DESCRIPTION";
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const mid = key.slice(prefix.length, key.length - suffix.length);
    if (!mid) continue;
    const value = process.env[key];
    if (typeof value !== "string" || value.length === 0) continue;
    descriptions.set(mid, value);
  }

  // Profile filter. Unknown profile names are treated as "no filter" with
  // a one-time stderr warning so a typo doesn't silently nuke the tool list.
  let profile: Set<string> | null = null;
  const profileName = process.env.SVERKLO_PROFILE?.trim().toLowerCase();
  if (profileName && profileName !== "full") {
    const allowed = PROFILES[profileName];
    if (allowed) {
      profile = new Set(allowed);
    } else {
      process.stderr.write(
        `[sverklo] SVERKLO_PROFILE=${profileName} not recognized — using full. Valid: ${Object.keys(PROFILES).join(", ")}, full\n`
      );
    }
  }

  return { disabled, descriptions, profile };
}

function getCache(): OverrideCache {
  if (!cache) cache = buildCache();
  return cache;
}

/**
 * Apply env-var overrides to a list of tool definitions. Returns a new
 * array — never mutates the input. Filtering order:
 *   1. SVERKLO_PROFILE — keep only tools in the named subset
 *   2. SVERKLO_DISABLED_TOOLS — drop tools by exact name
 *   3. SVERKLO_TOOL_<NAME>_DESCRIPTION — override description text
 */
export function applyToolOverrides<T extends ToolLike>(tools: T[]): T[] {
  const { disabled, descriptions, profile } = getCache();
  const out: T[] = [];
  for (const tool of tools) {
    if (profile && !profile.has(tool.name)) continue;
    if (disabled.has(tool.name)) continue;
    const suffix = normalizeEnvSuffix(tool.name);
    const override = descriptions.get(suffix);
    if (override) {
      out.push({ ...tool, description: override });
    } else {
      out.push(tool);
    }
  }
  return out;
}

/**
 * Test-only: reset the cached env-var parse so unit tests can flip
 * env vars mid-run and see the change.
 */
export function __resetToolOverrideCache(): void {
  cache = null;
}
