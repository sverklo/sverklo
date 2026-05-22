import { statSync } from "node:fs";
import { join } from "node:path";

// Cross-platform replacement for `command -v <name>` (POSIX) and
// `where <name>` (Windows). Walks PATH ourselves to avoid any shell
// dependency — issue #43 was a Windows regression because `command -v`
// is not a cmd.exe builtin and printed a confusing error there.
//
// On Windows we also try PATHEXT-style extensions (.cmd is the common
// one for npm-installed bins). The first match wins.
//
// Issue #53: on Windows, npm's cmd-shim emits THREE shims into the
// install prefix — `sverklo` (sh-style, no extension), `sverklo.cmd`,
// and `sverklo.ps1`. nvm-windows / nvm4w drops all three side-by-side
// in e.g. `C:\nvm4w\nodejs\`. The extension-less sh-shim is *not*
// executable by Windows (cmd.exe requires PATHEXT; shebangs are not
// honored), so probing must pick `.cmd` (or `.ps1`) instead. We
// therefore put the extension-less candidate LAST on Windows. POSIX
// order is unchanged (extension-less only).
export function findOnPath(name: string): string | null {
  const isWin = process.platform === "win32";
  const sep = isWin ? ";" : ":";
  const exts = isWin
    ? [".cmd", ".exe", ".bat", ".ps1", ""]
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
