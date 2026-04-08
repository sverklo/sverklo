/**
 * JSONL ground-truth schema.
 *
 * Each line in a *.jsonl seed file is a fully self-contained Task,
 * matching the Task interface in ../types.ts. We re-export here so
 * downstream loaders can validate without pulling in scoring code.
 */
export type { Task, ExpectedAnswer, Location, TaskCategory } from "../types.ts";

import type { Task } from "../types.ts";
import { readFileSync } from "node:fs";

export function loadJsonl(path: string): Task[] {
  const text = readFileSync(path, "utf-8");
  const out: Task[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    out.push(JSON.parse(line) as Task);
  }
  return out;
}
