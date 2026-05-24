import type { Baseline, BaselineOutput } from "../base.ts";
import type { Task, ExpectedAnswer, Location } from "../../types.ts";

export class BifrostBaseline implements Baseline {
  name = "bifrost";

  // Configurable so users (and CI) can point at a non-loopback gateway.
  // Default keeps the original loopback target.
  private baseUrl = process.env.SVERKLO_BIFROST_BASE_URL || "http://127.0.0.1:8080";

  private cachedModel: string | null = null;
  private firstTaskInDataset = true;
  private indexCostMs = 0;

  async setupForDataset(_: { name: string; rootPath: string }) {
    this.firstTaskInDataset = true;
    this.indexCostMs = 0;

    // Probe once. If the gateway is unreachable here, leave cachedModel
    // null and run() will short-circuit each task — much better than
    // burning a 30s timeout per task on a 100-task dataset.
    try {
      this.cachedModel = await this.getFirstAvailableModel();
    } catch {
      this.cachedModel = null;
    }
  }

  async teardownForDataset() {}

  async run(task: Task): Promise<BaselineOutput> {
    const start = Date.now();

    // Gateway unreachable at setup — return empty predictions immediately.
    // Bench numbers will reflect "no Bifrost run" rather than 30s timeouts.
    if (!this.cachedModel) {
      return {
        prediction: this.emptyPrediction(task.category),
        rawPayload: "bifrost gateway unreachable at setup",
        toolCalls: 0,
        wallTimeMs: 0,
        coldStartMs: 0,
        warmCallMs: 0,
      };
    }

    try {
      const res = await this.callLLM(this.buildPrompt(task), this.cachedModel);
      const prediction = this.parsePrediction(task.category, res);

      return {
        prediction,
        rawPayload: JSON.stringify(res),
        toolCalls: 0,
        wallTimeMs: Date.now() - start,
        coldStartMs: this.firstTaskInDataset ? this.indexCostMs : 0,
        warmCallMs: Date.now() - start,
      };
    } catch (err) {
      return {
        prediction: this.emptyPrediction(task.category),
        rawPayload: String(err),
        toolCalls: 0,
        wallTimeMs: Date.now() - start,
        coldStartMs: 0,
        warmCallMs: 0,
      };
    } finally {
      this.firstTaskInDataset = false;
    }
  }

  // -----------------------------
  // MODEL DISCOVERY
  // -----------------------------
  // Throws on network failure / empty model list. Caller decides whether
  // that's fatal (e.g., setupForDataset catches and switches to skip mode).
  private async getFirstAvailableModel(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/models`);
    if (!res.ok) {
      throw new Error(`Bifrost /v1/models returned ${res.status} ${res.statusText}`);
    }
    const json = await res.json();

    const models =
      json?.data?.map((m: any) => m.id) ??
      json?.models ??
      [];

    if (!models.length) {
      throw new Error("No models available in Bifrost");
    }

    return models[0];
  }

  // -----------------------------
  // CALL BIFROST
  // -----------------------------
  private async callLLM(prompt: string, model: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          stream: false,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // -----------------------------
  // PROMPT
  // -----------------------------
  private buildPrompt(task: Task): string {
    return `
You are a deterministic code analysis system.

Return ONLY valid JSON.

Task: ${task.category}
Query: ${task.query}

P1/P2:
{"locations":[{"file":"x","line":1}]}

P4:
{"imports":[],"importers":[]}

P5:
{"names":[]}
`.trim();
  }

  // -----------------------------
  // PARSER
  // -----------------------------
  private parsePrediction(category: string, res: any): ExpectedAnswer {
    const content = res?.choices?.[0]?.message?.content ?? "";
    const data = this.safeJsonParse(content);

    if (category === "P4") {
      return {
        kind: "deps",
        imports: data.imports ?? [],
        importers: data.importers ?? [],
      };
    }

    if (category === "P5") {
      return {
        kind: "names",
        names: data.names ?? [],
      };
    }

    return {
      kind: "locations",
      locations: this.extractLocations(data),
    };
  }

  private safeJsonParse(text: string): any {
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {}

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};

    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }

  private extractLocations(data: any): Location[] {
    const list = data.locations ?? [];
    const out: Location[] = [];
    const seen = new Set<string>();

    for (const l of list) {
      if (!l?.file || !l?.line) continue;

      const key = `${l.file}:${l.line}`;
      if (seen.has(key)) continue;

      seen.add(key);
      out.push({
        file: l.file,
        line: Number(l.line),
      });
    }

    return out;
  }

  private emptyPrediction(category: string): ExpectedAnswer {
    if (category === "P4") return { kind: "deps", imports: [], importers: [] };
    if (category === "P5") return { kind: "names", names: [] };
    return { kind: "locations", locations: [] };
  }
}