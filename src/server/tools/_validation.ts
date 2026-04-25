// Shared input validators for MCP tool handlers. The MCP wrapper itself
// declares schemas, but Claude/agents sometimes pass values outside the
// declared enum (e.g. `kind: "junk"`). Without server-side guards those
// fall through to silent type-cast paths and the tool returns wrong but
// successful-looking results. These helpers keep validation consistent
// across handlers.

/**
 * Validate that `raw` is one of `allowed`. Returns the value typed as
 * the union, the `fallback` when `raw` is undefined/empty, or an Error
 * carrying a usage message when `raw` is set but invalid. Callers
 * surface `error.message` to the caller and return early.
 */
export function validateEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  argName: string,
  fallback: T
): T | Error {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    return new Error(
      `\`${argName}\` must be one of: ${allowed.join(", ")} (got ${JSON.stringify(raw)})`
    );
  }
  return raw as T;
}

/** Require a non-empty string arg or return a usage-style error string. */
export function requireString(
  raw: unknown,
  argName: string,
  usage: string
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      message: `Error: \`${argName}\` is required and must be a non-empty string. Usage: ${usage}`,
    };
  }
  return { ok: true, value: raw };
}
