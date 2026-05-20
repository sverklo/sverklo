import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Baseline, BaselineOutput } from "../base.ts";
import type { Task, ExpectedAnswer } from "../../types.ts";

/**
 * Bifrost Mock Fixture (benchmark runner integration only)
 *
 * Scope:
 * - NOT a real Bifrost gateway integration
 * - Used only for benchmark infrastructure testing
 */

export class BifrostMockBaseline implements Baseline {
  name = "bifrost-mock";

  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private pending = new Map<number, (msg: any) => void>();
  private nextId = 1;

  private firstTask = true;
  private setupTimeMs = 0;

  // private errorCount = 0;

  // -----------------------------
  // Dataset setup
  // -----------------------------
  async setupForDataset(d: { name: string; rootPath: string }) {
    const start = Date.now();

    this.child = spawn(
      "node",
      [
        "-e",
        `
  process.stdin.on("data", (buf) => {
    try {
      const msg = JSON.parse(buf.toString());

      const response = {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          manifest: {
            files: ["src/index.ts"],
            summary: "mock bifrost response"
          },
          toolCalls: ["grep"]
        }
      };

      console.log(JSON.stringify(response));
    } catch (err) {
      console.error(err);
    }
  });
  `,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      }
    );

    // Prevent unhandled spawn crashes
    this.child.on("error", (err) => {
      console.error("[bifrost spawn error]", err.message);
    });

    // stdout JSON-RPC handler
    this.child.stdout.on("data", (data: Buffer) => {
      this.buffer += data.toString();

      let idx;

      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);

        if (!line) continue;

        try {
          const msg = JSON.parse(line);

          const id = msg.id ?? msg.response?.id;

          if (id !== undefined && this.pending.has(id)) {
            const resolver = this.pending.get(id)!;
            this.pending.delete(id);
            resolver(msg.result ?? msg);
          }
        } catch {
          // ignore non-json logs
        }
      }
    });

  this.child.stderr.on("data", (d) => {
    if (process.env.BENCH_DEBUG === "1") {
      console.error("[bifrost]", d.toString());
    }
  });

    // Optional index warmup
  try {
    await this.call("index", {
      path: d.rootPath,
    });
  } catch (err) {
    if (process.env.BENCH_DEBUG === "1") {
      console.error("[bifrost warmup failed]", err);
    }
  }

  this.setupTimeMs = Date.now() - start;
}

  // -----------------------------
  // Core execution
  // -----------------------------
  async run(task: Task): Promise<BaselineOutput> {
    const start = Date.now();

    let payload = "";
    let toolCalls = 0;
    let prediction: ExpectedAnswer;

    try {
      const res = await this.call("run", {
        taskId: task.id,
        category: task.category,
        query: task.query,
        mode: "codemode",
      });

      toolCalls = res?.toolCalls?.length ?? 1;

      const manifest =
        res?.manifest ??
        res?.result?.manifest ??
        res?.result ??
        res;

      payload = JSON.stringify(manifest);

      prediction = this.toPrediction(res);
    } catch (err: any) {
      this.errorCount++;

      payload = "";
      prediction = this.emptyPrediction(task);

      if (process.env.BENCH_DEBUG === "1") {
        console.error("[bifrost error]", err?.message || err);
      }
    }

    const wallTimeMs = Date.now() - start;
    const coldStartMs = this.firstTask ? this.setupTimeMs : 0;
    this.firstTask = false;

    return {
      prediction,
      rawPayload: payload,
      toolCalls,
      wallTimeMs,
      coldStartMs,
      warmCallMs: wallTimeMs - coldStartMs,
    };
  }

  // -----------------------------
  // Dataset cleanup
  // -----------------------------
  async teardownForDataset() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.pending.clear();
  }

  // -----------------------------
  // JSON-RPC helper
  // -----------------------------
  private call(method: string, params: any): Promise<any> {
    if (!this.child) throw new Error("Bifrost not started");

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bifrost timeout: ${method}`));
      }, 60_000);

      this.pending.set(id, (msg) => {
        clearTimeout(timeout);

        if (msg.error) {
          reject(new Error(msg.error.message || "Bifrost error"));
        } else {
          resolve(msg);
        }
      });

      this.child!.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }) + "\n"
      );
    });
  }

  // -----------------------------
  // Adapters (benchmark compatibility)
  // -----------------------------
  private toPrediction(_res: any): ExpectedAnswer {
    return { kind: "names", names: [] };
  }

  private emptyPrediction(task: Task): ExpectedAnswer {
    if (task.category === "P4") {
      return { kind: "deps", imports: [], importers: [] };
    }
    if (task.category === "P5") {
      return { kind: "names", names: [] };
    }
    return { kind: "locations", locations: [] };
  }
}