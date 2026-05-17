import { mkdirSync, cpSync, chmodSync } from "node:fs";

mkdirSync("dist/src/server/assets", { recursive: true });
cpSync("src/server/assets", "dist/src/server/assets", { recursive: true });

if (process.platform !== "win32") {
  chmodSync("dist/bin/sverklo.js", 0o755);
}
