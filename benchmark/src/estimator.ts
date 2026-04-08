/**
 * Token estimation. We use the same heuristic as sverklo's internal
 * estimator (chars/3.5) so numbers are comparable to what the MCP server
 * itself reports. If gpt-tokenizer becomes available we can swap it in,
 * but per the build constraints we avoid new deps.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}
