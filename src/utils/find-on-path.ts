import { statSync } from "node:fs";
import { join } from "node:path";

// Cross-platform replacement for `command -v <name>` (POSIX) and
// `where <name>` (Windows). Walks PATH ourselves to avoid any shell
// dependency — issue #43 was a Windows regression because `command -v`
// is not a cmd.exe builtin and printed a confusing error there.
//
// On Windows we also try PATHEXT-style extensions (.cmd is the common
// one for npm-installed bins). The first match wins.
export function findOnPath(name: string): string | null {
  const isWin = process.platform === "win32";
  const sep = isWin ? ";" : ":";
  const exts = isWin
    ? ["", ".cmd", ".exe", ".bat", ".ps1"]
    : [""];
  const dirs = (process.env.PATH ?? "").split(sep);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // not a file or permission denied — keep walking
      }
    }
  }
  return null;
}
