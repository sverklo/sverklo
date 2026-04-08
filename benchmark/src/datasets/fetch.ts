import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dataset } from "../types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVERKLO_ROOT = resolve(__dirname, "..", "..", "..");

interface ManifestEntry {
  name: string;
  kind: "local" | "git";
  rootPath?: string;
  repo?: string;
  ref?: string;
  checkoutDir?: string;
}

export function loadManifest(): Dataset[] {
  const path = join(__dirname, "manifest.json");
  const json = JSON.parse(readFileSync(path, "utf-8"));
  const out: Dataset[] = [];
  for (const e of json.datasets as ManifestEntry[]) {
    if (e.kind === "local") {
      out.push({ name: e.name, rootPath: resolve(SVERKLO_ROOT, e.rootPath || ".") });
    } else if (e.kind === "git") {
      const dest = resolve(SVERKLO_ROOT, e.checkoutDir!);
      ensureCloned(e.repo!, e.ref!, dest);
      out.push({ name: e.name, rootPath: dest, sha: e.ref });
    }
  }
  return out;
}

function ensureCloned(repo: string, ref: string, dest: string): void {
  if (existsSync(join(dest, ".git"))) {
    // already cloned — assume correct ref
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  console.error(`[fetch] cloning ${repo}@${ref} into ${dest}`);
  // shallow clone of the tag
  try {
    execSync(`git clone --depth 1 --branch ${ref} ${repo} ${dest}`, {
      stdio: "inherit",
    });
  } catch {
    // fall back to full clone + checkout
    execSync(`git clone ${repo} ${dest}`, { stdio: "inherit" });
    execSync(`git checkout ${ref}`, { cwd: dest, stdio: "inherit" });
  }
}
