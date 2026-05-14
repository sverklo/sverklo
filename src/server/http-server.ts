import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Indexer } from "../indexer/indexer.js";
import { log } from "../utils/logger.js";
import { getDashboardHTML } from "./dashboard-html.js";
import { getClustersJSON } from "./tools/clusters.js";

// Read the package version once at module load so the dashboard footer
// and any other surface can show what version is actually running.
// Was hardcoded as "v0.1.7" in the dashboard HTML until a dogfood
// session caught it right before launch — the screenshot we were
// planning to promote would have shown a 4-month-old version.
function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["..", "../..", "../../.."]) {
      try {
        const pkg = JSON.parse(readFileSync(join(here, rel, "package.json"), "utf-8"));
        if (pkg.name === "sverklo" && pkg.version) return pkg.version;
      } catch {}
    }
  } catch {}
  return "unknown";
}
const PACKAGE_VERSION = readPackageVersion();

export function startHttpServer(indexer: Indexer, port: number = 3847): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // CORS: restrict to same-origin / localhost only. The dashboard is
    // served from the same origin so no cross-origin header is needed for
    // normal use. For local development tools that hit the API from a
    // different port, allow localhost origins explicitly.
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ─── API routes ───
      if (url.pathname === "/api/status") {
        const status = indexer.getStatus();
        // Include the running package version so the dashboard footer
        // can show what's actually running instead of a hardcoded string.
        json(res, { ...status, version: PACKAGE_VERSION });
      } else if (url.pathname === "/api/stats") {
        // Aggregated stats for the dashboard overview
        const files = indexer.fileStore.getAll();
        const chunks = indexer.chunkStore.count();
        const memories = indexer.memoryStore.getAll(1000);
        const staleCount = memories.filter(m => m.is_stale).length;
        const languages: Record<string, number> = {};
        for (const f of files) {
          if (f.language) languages[f.language] = (languages[f.language] || 0) + 1;
        }
        json(res, {
          fileCount: files.length,
          chunkCount: chunks,
          memoryCount: memories.length,
          staleCount,
          languages,
          topFiles: files.slice(0, 10).map(f => ({ path: f.path, pagerank: f.pagerank, language: f.language })),
          totalChunks: chunks,
        });
      } else if (url.pathname === "/api/files") {
        const files = indexer.fileStore.getAll();
        json(res, files);
      } else if (url.pathname === "/api/file") {
        const path = url.searchParams.get("path");
        if (!path) { json(res, { error: "path required" }); return; }
        // Lenient lookup: accept "./prefixed" or "project/src/..." paths
        // in addition to the canonical repo-relative form. Same fix as
        // sverklo_deps (Dogfood T5).
        const file = indexer.fileStore.findByPath(path);
        if (!file) { json(res, { error: "not found" }); return; }
        const chunks = indexer.chunkStore.getByFile(file.id);
        const imports = indexer.graphStore.getImports(file.id);
        const importers = indexer.graphStore.getImporters(file.id);
        const fileCache = new Map(indexer.fileStore.getAll().map(f => [f.id, f.path]));
        json(res, {
          ...file,
          chunks: chunks.map(c => ({
            id: c.id,
            type: c.type,
            name: c.name,
            signature: c.signature,
            start_line: c.start_line,
            end_line: c.end_line,
            content: c.content,
          })),
          imports: imports.map(i => ({ path: fileCache.get(i.target_file_id), refs: i.reference_count })),
          importers: importers.map(i => ({ path: fileCache.get(i.source_file_id), refs: i.reference_count })),
        });
      } else if (url.pathname === "/api/memories") {
        const memories = indexer.memoryStore.getAll(200);
        json(res, memories.map(m => ({
          ...m,
          tags: m.tags ? JSON.parse(m.tags) : [],
          related_files: m.related_files ? JSON.parse(m.related_files) : [],
        })));
      } else if (url.pathname === "/api/memories/timeline") {
        // Include invalidated memories for bi-temporal view
        const allMem = indexer.memoryStore.getTimeline(500);
        json(res, allMem.map(m => ({
          ...m,
          tags: m.tags ? JSON.parse(m.tags) : [],
          related_files: m.related_files ? JSON.parse(m.related_files) : [],
          invalidated: m.valid_until_sha !== null,
        })));
      } else if (url.pathname === "/api/overview") {
        const files = indexer.fileStore.getAll();
        const overview = files.map(f => ({
          ...f,
          chunks: indexer.chunkStore.getByFile(f.id).map(c => ({
            name: c.name,
            type: c.type,
            start_line: c.start_line,
            end_line: c.end_line,
          })),
        }));
        json(res, overview);
      } else if (url.pathname === "/api/graph") {
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : 100;
        const allFiles = indexer.fileStore.getAll(); // already sorted by pagerank DESC
        const allEdges = indexer.graphStore.getAll();
        const files = limit > 0 ? allFiles.slice(0, limit) : allFiles;
        const fileIdSet = new Set(files.map(f => f.id));
        const edges = allEdges.filter(
          e => fileIdSet.has(e.source_file_id) && fileIdSet.has(e.target_file_id)
        );
        json(res, {
          nodes: files.map(f => ({
            id: f.id,
            path: f.path,
            language: f.language,
            pagerank: f.pagerank,
            size_bytes: f.size_bytes,
          })),
          edges: edges.map(e => ({
            source: e.source_file_id,
            target: e.target_file_id,
            weight: e.reference_count,
          })),
          total: allFiles.length,
        });
      } else if (url.pathname === "/api/deps") {
        const files = indexer.fileStore.getAll();
        const fileMap = new Map(files.map(f => [f.id, f.path]));
        const edges: { source: string; target: string; count: number }[] = [];
        for (const f of files) {
          const deps = indexer.graphStore.getImports(f.id);
          for (const d of deps) {
            const targetPath = fileMap.get(d.target_file_id);
            if (targetPath) {
              edges.push({
                source: f.path,
                target: targetPath,
                count: d.reference_count,
              });
            }
          }
        }
        json(res, {
          nodes: files.map(f => ({
            path: f.path,
            pagerank: f.pagerank,
            language: f.language,
            id: f.id,
          })),
          edges,
        });
      } else if (url.pathname === "/api/clusters") {
        const clusters = getClustersJSON(indexer);
        json(res, clusters);
      } else if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q");
        if (!q) { json(res, []); return; }
        const { hybridSearch } = await import("../search/hybrid-search.js");
        const results = await hybridSearch(indexer, {
          query: q,
          tokenBudget: 8000,
        });
        json(res, results.map(r => ({
          file: r.file.path,
          name: r.chunk.name,
          type: r.chunk.type,
          startLine: r.chunk.start_line,
          endLine: r.chunk.end_line,
          content: r.chunk.content,
          score: r.score,
          pagerank: r.file.pagerank,
          language: r.file.language,
        })));
      } else if (url.pathname === "/assets/d3.min.js") {
        // Vendored d3 (was loaded from cdnjs.cloudflare.com — Security
        // Engineer review 2026-05-13 flagged that as a 4th network
        // egress contradicting the "code never leaves the machine"
        // posture, and CDN compromise → JS execution in the dashboard
        // origin → /api/file?path=* exfiltration). Now self-hosted.
        try {
          const here = dirname(fileURLToPath(import.meta.url));
          // dev: src/server/assets/  prod: dist/src/server/assets/
          const assetPath = join(here, "assets", "d3.min.js");
          const body = readFileSync(assetPath);
          res.writeHead(200, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          res.end(body);
        } catch (err) {
          res.writeHead(500);
          res.end(`Asset not found: ${(err as Error).message}`);
        }
      } else if (
        url.pathname === "/" ||
        // SPA deep-link fallback: any non-/api path serves the dashboard
        // shell. The client-side rail navigation owns paths like /audit,
        // /symbols, /files, /graph, /memories — they used to 404 here,
        // breaking bookmarks and shared links. /api/* is excluded above
        // and so still 404s correctly when an unknown API endpoint is
        // hit. UX audit P1.
        !url.pathname.startsWith("/api/")
      ) {
        // Strict CSP: same-origin scripts only, allow inline because
        // the dashboard's interactive code is currently embedded in the
        // HTML template (decompose-template work tracked in Tier 2.3).
        // Once that lands, drop 'unsafe-inline' from script-src.
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "font-src 'self' data:; " +
            "object-src 'none'; " +
            "base-uri 'self'; " +
            "frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(getDashboardHTML());
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }));
    }
  });

  // Bind explicitly to loopback. Without a host arg `server.listen(port)`
  // binds 0.0.0.0, which exposes /api/files (and anything else served
  // here) to anyone on the same network. The dashboard is a local-tool;
  // there is no use case for cross-host access.
  server.listen(port, "127.0.0.1", () => {
    log(`Dashboard running at http://localhost:${port}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${port} in use, trying ${port + 1}`);
      startHttpServer(indexer, port + 1);
    }
  });
}

function json(res: import("node:http").ServerResponse, data: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
