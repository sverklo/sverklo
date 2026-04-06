// Fast token count approximation. ~1 token per 4 chars for code.
// Good enough for budget management. Exact counting is too slow per-chunk.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function truncateToTokenBudget(
  text: string,
  budget: number
): string {
  const charBudget = Math.floor(budget * 3.5);
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget) + "\n// ... truncated";
}
