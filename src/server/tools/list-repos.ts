import { getRegistry } from "../../registry/registry.js";

export const listReposTool = {
  name: "sverklo_list_repos",
  description:
    "List all indexed repositories in the global registry. " +
    "Use this to discover available repos when running in global (multi-repo) mode. " +
    "The repo names returned here can be passed as the `repo` parameter to any other sverklo tool.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export function handleListRepos(): string {
  const repos = getRegistry();
  const entries = Object.entries(repos);

  if (entries.length === 0) {
    return (
      "No repositories registered.\n\n" +
      "Register a repo with:\n" +
      "  sverklo register /path/to/project\n" +
      "  sverklo init  (from within a project directory)"
    );
  }

  const rows: string[] = [];
  const now = Date.now();

  for (const [name, entry] of entries) {
    const lastIndexed = new Date(entry.lastIndexed);
    const ageMs = now - lastIndexed.getTime();
    const ageStr = formatAge(ageMs);
    const status = ageMs < 10 * 60 * 1000 ? "fresh" : "stale";
    rows.push(`| ${name} | ${entry.path} | ${ageStr} | ${status} |`);
  }

  return (
    `## Indexed repositories (${entries.length})\n\n` +
    `| Name | Path | Last indexed | Status |\n` +
    `|---|---|---|---|\n` +
    rows.join("\n")
  );
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}
