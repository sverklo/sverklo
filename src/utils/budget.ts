/**
 * Shared token-budget resolver.
 *
 * Priority chain:
 *   1. Explicit `token_budget` arg from the caller
 *   2. Per-tool budget from .sverklo.yaml  (config.search.budgets.<tool>)
 *   3. Global default from .sverklo.yaml   (config.search.defaultTokenBudget)
 *   4. Hard-coded default baked into each tool handler
 */

import type { SverkloConfig } from "./config-file.js";

export function resolveBudget(
  args: Record<string, unknown>,
  toolName: string,
  sverkloConfig: SverkloConfig | null,
  hardDefault: number
): number {
  // 1. Explicit arg
  if (typeof args.token_budget === "number" && args.token_budget > 0) {
    return args.token_budget;
  }
  // 2. Per-tool budget from config
  const perTool = sverkloConfig?.search?.budgets?.[toolName];
  if (typeof perTool === "number" && perTool > 0) return perTool;
  // 3. Global default from config
  const global = sverkloConfig?.search?.defaultTokenBudget;
  if (typeof global === "number" && global > 0) return global;
  // 4. Hard-coded default
  return hardDefault;
}
