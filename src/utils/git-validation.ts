/**
 * Input validation helpers for git parameters that originate from
 * user-controlled MCP tool arguments. Every git ref, file path, or
 * numeric parameter that flows into a child process MUST be validated
 * here before use.
 *
 * Defence rationale: MCP tool arguments are attacker-controlled strings.
 * Interpolating them into shell commands via execSync creates command
 * injection (CWE-78). Even with spawnSync (no shell), validating early
 * provides defence-in-depth and produces better error messages.
 */

/**
 * Validate that a string looks like a safe git refspec.
 * Allows: branch names, tags, SHAs, ranges (A..B, A...B), HEAD~N,
 * HEAD^N, and typical ref syntax characters.
 *
 * Rejects: spaces, semicolons, backticks, pipes, dollar signs,
 * parentheses, and other shell metacharacters.
 */
export function validateGitRef(ref: string): boolean {
  return /^[a-zA-Z0-9_.\/@{}\-~^:]+(\.\.[a-zA-Z0-9_.\/@{}\-~^:]+)?$/.test(ref);
}

/**
 * Validate and parse a positive integer limit parameter.
 * Returns the parsed integer or the provided default if the input
 * is not a valid positive integer.
 */
export function validatePositiveInt(value: unknown, defaultValue: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return defaultValue;
}
