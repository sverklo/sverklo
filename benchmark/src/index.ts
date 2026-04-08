import { runAll } from "./runner/run-primitive.ts";

runAll().catch((err) => {
  console.error("[bench] fatal:", err);
  process.exit(1);
});
