// Intent-aware hint engine.
//
// Inspired by code-review-graph's hints.py: track the recent tool-call
// trajectory and append a short "next steps" suggestion to each response so
// the model is nudged toward better composition without needing prompt
// changes on the client side.
//
// The hint engine is intentionally cheap and stateless across processes —
// it lives in a per-server ring buffer of the last N tool calls. It does
// not look at tool *output*, only the call sequence and current call
// arguments, so it never blocks the response on extra DB work.

export type IntentLabel =
  | "exploring"
  | "reviewing-diff"
  | "tracing-impact"
  | "debugging"
  | "onboarding"
  | "memory-curating"
  | "unknown";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  ts: number;
}

const HISTORY_LIMIT = 10;

export class HintEngine {
  private history: ToolCall[] = [];

  record(name: string, args: Record<string, unknown>): void {
    this.history.push({ name, args, ts: Date.now() });
    if (this.history.length > HISTORY_LIMIT) {
      this.history.shift();
    }
  }

  /**
   * Best-effort intent classification from the recent call sequence.
   * Order of checks matters: more specific patterns win over generic ones.
   */
  classifyIntent(): IntentLabel {
    if (this.history.length === 0) return "unknown";
    const names = this.history.map((c) => c.name);
    const last = names[names.length - 1];

    const hasAny = (...patterns: string[]) =>
      names.some((n) => patterns.includes(n));

    // Diff workflow: any of the diff-aware tools were used recently
    if (
      hasAny("sverklo_review_diff", "sverklo_test_map", "sverklo_diff_search")
    ) {
      return "reviewing-diff";
    }

    // Impact tracing: chained refs/impact lookups
    if (
      last === "sverklo_impact" ||
      last === "sverklo_refs" ||
      (names.filter((n) => n === "sverklo_refs" || n === "sverklo_impact").length >= 2)
    ) {
      return "tracing-impact";
    }

    // Memory curation: remember/recall/forget activity
    if (
      hasAny("sverklo_remember", "sverklo_forget", "sverklo_promote", "sverklo_demote")
    ) {
      return "memory-curating";
    }

    // Onboarding: overview followed by lookups/searches without a target
    if (
      names.includes("sverklo_overview") &&
      names.length <= 4
    ) {
      return "onboarding";
    }

    // Debugging: search-heavy with error-shaped queries
    const recentSearches = this.history.filter(
      (c) => c.name === "sverklo_search"
    );
    if (recentSearches.length >= 2) {
      const queries = recentSearches
        .map((c) => String(c.args?.query ?? "").toLowerCase())
        .join(" ");
      if (
        /error|exception|fail|crash|bug|null|undefined|throw/.test(queries)
      ) {
        return "debugging";
      }
      return "exploring";
    }

    if (last === "sverklo_search" || last === "sverklo_lookup") {
      return "exploring";
    }

    return "unknown";
  }

  /**
   * Build a hint block for the tool that just ran. Returns null when there
   * is nothing useful to say — we'd rather be silent than add noise.
   */
  buildHint(currentTool: string, currentArgs: Record<string, unknown>): string | null {
    const intent = this.classifyIntent();
    const suggestions = this.suggestNext(currentTool, currentArgs, intent);
    if (suggestions.length === 0) return null;

    const lines: string[] = [];
    lines.push("");
    lines.push("---");
    lines.push(`_Hints (intent: ${intent})_`);
    for (const s of suggestions) lines.push(`- ${s}`);
    return lines.join("\n");
  }

  private suggestNext(
    tool: string,
    args: Record<string, unknown>,
    intent: IntentLabel
  ): string[] {
    const out: string[] = [];

    switch (tool) {
      case "sverklo_review_diff": {
        const ref = (args.ref as string) || "main..HEAD";
        out.push(`Run \`sverklo_test_map ref:"${ref}"\` to see which changes lack tests.`);
        out.push(`For any removed symbol with dangling refs, call \`sverklo_impact symbol:"<name>"\`.`);
        break;
      }
      case "sverklo_test_map": {
        const ref = (args.ref as string) || "main..HEAD";
        if (!this.history.some((c) => c.name === "sverklo_review_diff")) {
          out.push(`Pair this with \`sverklo_review_diff ref:"${ref}"\` for blast radius and risk scores.`);
        }
        out.push(`Untested high-risk files are the ones to push back on in review.`);
        break;
      }
      case "sverklo_impact":
      case "sverklo_refs": {
        const sym = (args.symbol as string) || (args.name as string) || "<name>";
        out.push(`Call \`sverklo_lookup name:"${sym}"\` to see the definition you're tracing.`);
        if (intent === "reviewing-diff") {
          out.push(`Each caller listed needs to be updated in the same diff if you removed the symbol.`);
        }
        break;
      }
      case "sverklo_search": {
        if (intent === "debugging") {
          out.push(`Narrow with \`sverklo_lookup\` if the search surfaced a likely target symbol.`);
          out.push(`Call \`sverklo_recall query:"<error>"\` — there may be a saved memory about this issue.`);
        } else if (intent === "exploring") {
          out.push(`If a symbol stands out, \`sverklo_refs symbol:"<name>"\` shows everything that uses it.`);
        }
        break;
      }
      case "sverklo_lookup": {
        const name = (args.name as string) || "<name>";
        out.push(`\`sverklo_refs symbol:"${name}"\` enumerates everything that calls this.`);
        out.push(`\`sverklo_deps file:"<file>"\` shows what the containing file imports.`);
        break;
      }
      case "sverklo_overview": {
        out.push(`Try \`sverklo_recall query:"architecture"\` for any saved design decisions.`);
        out.push(`Call \`sverklo_deps file:"<top-pagerank file>"\` on a high-PR file to see its centrality.`);
        break;
      }
      case "sverklo_deps": {
        out.push(`If a dependency looks suspicious, \`sverklo_search query:"<concept>"\` finds related code.`);
        break;
      }
      case "sverklo_recall": {
        if (intent === "memory-curating") {
          out.push(`Use \`sverklo_promote\` to mark a memory as core (always-loaded) context.`);
        } else {
          out.push(`If you act on a memory, \`sverklo_remember\` the outcome so the next session starts smarter.`);
        }
        break;
      }
      case "sverklo_remember": {
        out.push(`\`sverklo_promote id:<id>\` to make this a core memory loaded on every session.`);
        break;
      }
      case "sverklo_context": {
        const task = (args.task as string) || "";
        const detail = (args.detail_level as string) || "normal";
        if (detail !== "full") {
          out.push(`If the bundle isn't enough, re-run with \`detail_level:"full"\` for dependency neighbours.`);
        }
        out.push(`Drill into a specific symbol with \`sverklo_lookup\` or \`sverklo_refs\` from the relevant-code list.`);
        if (/bug|error|fail|broken/i.test(task)) {
          out.push(`Looks like a debug task — \`sverklo_recall query:"${task.slice(0, 60)}"\` may surface a known issue.`);
        }
        break;
      }
      case "sverklo_diff_search": {
        const ref = (args.ref as string) || "main..HEAD";
        if (!this.history.some((c) => c.name === "sverklo_review_diff")) {
          out.push(`Run \`sverklo_review_diff ref:"${ref}"\` first for the structural picture.`);
        }
        break;
      }
    }

    // Generic loop-protection hint: model is hammering one tool
    const sameToolCount = this.history.filter((c) => c.name === tool).length;
    if (sameToolCount >= 4) {
      out.push(`You've called \`${tool}\` ${sameToolCount} times — consider switching tools or summarising what you've found so far.`);
    }

    return out;
  }
}
