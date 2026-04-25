// Minimal Ollama HTTP client. Uses Node 20's built-in fetch — no new deps.
// Used by P1-7 (concept labeling) and, later, P1-12 (symbol purpose
// enrichment). The host process runs its own Ollama; sverklo is a client.

export interface OllamaChatOptions {
  baseUrl?: string;                   // default http://localhost:11434
  model?: string;                     // default qwen2.5-coder:7b
  timeoutMs?: number;                 // default 60_000
  system?: string;
  temperature?: number;               // default 0 for labeler determinism
  format?: "json";                    // request JSON-mode where supported
}

export interface OllamaChatResult {
  ok: true;
  content: string;
  model: string;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatFailure {
  ok: false;
  reason: "unreachable" | "timeout" | "bad_status" | "parse_error";
  status?: number;
  message: string;
}

/**
 * Small wrapper around Ollama's /api/chat endpoint. Returns a structured
 * result + failure union so callers can gracefully degrade instead of
 * throwing. The network call is the only async primitive; no streaming
 * — concept labeling generates short JSON replies so streaming adds
 * complexity without value.
 */
export async function ollamaChat(
  prompt: string,
  opts: OllamaChatOptions = {}
): Promise<OllamaChatResult | OllamaChatFailure> {
  const baseUrl = opts.baseUrl ?? "http://localhost:11434";
  const model = opts.model ?? "qwen2.5-coder:7b";
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    options: { temperature: opts.temperature ?? 0 },
  };
  if (opts.format === "json") body.format = "json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "bad_status",
        status: res.status,
        message: `Ollama returned HTTP ${res.status}: ${await safeBody(res)}`,
      };
    }
    const json = (await res.json()) as {
      message?: { content?: string };
      model?: string;
      eval_count?: number;
      eval_duration?: number;
    };
    const content = json.message?.content ?? "";
    return {
      ok: true,
      content,
      model: json.model ?? model,
      eval_count: json.eval_count,
      eval_duration: json.eval_duration,
    };
  } catch (err) {
    const e = err as { name?: string; code?: string; message?: string };
    if (e?.name === "AbortError") {
      return { ok: false, reason: "timeout", message: `Ollama timed out after ${timeoutMs}ms.` };
    }
    const msg = e?.message ?? String(err);
    return {
      ok: false,
      reason: "unreachable",
      message: `Could not reach Ollama at ${baseUrl}: ${msg}. Is it running? Try: curl ${baseUrl}/api/tags`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function safeBody(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 200);
  } catch {
    return "(no body)";
  }
}

/**
 * Attempt to parse the LLM response as JSON. Accepts both raw JSON and
 * JSON wrapped in a markdown code fence — we're strict enough to reject
 * garbage but generous about fencing since some models prepend "Here is...".
 */
export function parseJsonResponse<T>(raw: string): { ok: true; value: T } | { ok: false; message: string } {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenceMatch) candidates.unshift(fenceMatch[1].trim());
  for (const c of candidates) {
    try {
      const value = JSON.parse(c) as T;
      return { ok: true, value };
    } catch {
      // try next candidate
    }
  }
  return { ok: false, message: "response was not valid JSON" };
}
