import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Indexer } from "../indexer/indexer.js";
import { log } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startHttpServer(indexer: Indexer, port: number = 3847): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.pathname === "/api/status") {
      const status = indexer.getStatus();
      json(res, status);
    } else if (url.pathname === "/api/files") {
      const files = indexer.fileStore.getAll();
      json(res, files);
    } else if (url.pathname === "/api/memories") {
      const memories = indexer.memoryStore.getAll(100);
      json(res, memories.map(m => ({
        ...m,
        tags: m.tags ? JSON.parse(m.tags) : [],
        related_files: m.related_files ? JSON.parse(m.related_files) : [],
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
      json(res, { nodes: files.map(f => ({ path: f.path, pagerank: f.pagerank, language: f.language })), edges });
    } else if (url.pathname === "/api/search" && url.searchParams.get("q")) {
      const { hybridSearch, formatResults } = await import("../search/hybrid-search.js");
      const results = await hybridSearch(indexer, {
        query: url.searchParams.get("q")!,
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
      })));
    } else if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getDashboardHTML());
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, () => {
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

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sverklo Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root { --bg: #0a0a0a; --card: #141414; --border: #222; --text: #eee; --dim: #888; --accent: #7c6aef; --green: #34d399; --red: #f87171; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; line-height: 1.5; }
.container { max-width: 1200px; margin: 0 auto; padding: 20px; }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
h1 { font-size: 20px; font-weight: 700; }
h1 span { color: var(--accent); }
.status { font-size: 13px; color: var(--dim); }
.status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--green); margin-right: 6px; }

.tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.tab { padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--dim); border: 1px solid transparent; transition: all .15s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); background: var(--card); border-color: var(--border); }

.panel { display: none; }
.panel.active { display: block; }

.card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--dim); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.stat-value { font-size: 28px; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 13px; color: var(--dim); margin-top: 2px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--dim); font-weight: 500; padding: 8px 12px; border-bottom: 1px solid var(--border); }
td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
tr:hover { background: rgba(255,255,255,.02); }
.pr { color: var(--accent); font-weight: 600; font-size: 12px; }

.search-box { width: 100%; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 15px; outline: none; margin-bottom: 16px; }
.search-box:focus { border-color: var(--accent); }
.search-box::placeholder { color: var(--dim); }

.result { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
.result-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
.result-path { font-size: 13px; color: var(--accent); font-weight: 500; }
.result-score { font-size: 12px; color: var(--dim); }
.result pre { font-size: 12px; color: var(--dim); overflow-x: auto; white-space: pre-wrap; max-height: 200px; }

.memory { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
.memory-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.memory-cat { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: var(--accent); color: white; font-weight: 600; text-transform: uppercase; }
.memory-meta { font-size: 12px; color: var(--dim); margin-top: 6px; }
.memory-content { font-size: 14px; }
.stale { opacity: 0.5; border-color: var(--red); }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: rgba(124,106,239,.15); color: var(--accent); margin-right: 4px; }

.empty { text-align: center; padding: 40px; color: var(--dim); }

.graph-container { width: 100%; height: 500px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; position: relative; overflow: hidden; }
canvas { width: 100%; height: 100%; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1><span>&#x26A1;</span> Sverklo</h1>
    <div class="status" id="status"><span class="dot"></span>Loading...</div>
  </header>

  <div class="stat-grid" id="stats"></div>

  <div class="tabs">
    <div class="tab active" data-panel="files">Files</div>
    <div class="tab" data-panel="memories">Memories</div>
    <div class="tab" data-panel="search">Search</div>
    <div class="tab" data-panel="graph">Dependencies</div>
  </div>

  <div class="panel active" id="files">
    <table>
      <thead><tr><th>File</th><th>Language</th><th>PageRank</th><th>Symbols</th></tr></thead>
      <tbody id="files-body"></tbody>
    </table>
  </div>

  <div class="panel" id="memories">
    <div id="memories-list"></div>
  </div>

  <div class="panel" id="search">
    <input class="search-box" id="search-input" placeholder="Search your codebase semantically..." />
    <div id="search-results"></div>
  </div>

  <div class="panel" id="graph">
    <div class="graph-container">
      <canvas id="graph-canvas"></canvas>
    </div>
  </div>
</div>

<script>
const API = '';

// Tabs
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.panel).classList.add('active');
    if (t.dataset.panel === 'graph') drawGraph();
  });
});

// Load status
async function loadStatus() {
  const s = await (await fetch(API + '/api/status')).json();
  document.getElementById('status').innerHTML = '<span class="dot"></span>' + s.projectName + ' — ' + s.fileCount + ' files, ' + s.chunkCount + ' chunks';
  document.getElementById('stats').innerHTML = [
    stat(s.fileCount, 'Files'),
    stat(s.chunkCount, 'Code Chunks'),
    stat(s.languages.length, 'Languages'),
    stat(s.languages.join(', ') || '-', 'Detected'),
  ].join('');
}
function stat(v, l) { return '<div class="stat"><div class="stat-value">' + v + '</div><div class="stat-label">' + l + '</div></div>'; }

// Load files
async function loadFiles() {
  const data = await (await fetch(API + '/api/overview')).json();
  const tbody = document.getElementById('files-body');
  tbody.innerHTML = data.map(f => {
    const symbols = f.chunks.filter(c => c.name).map(c => c.name).slice(0, 5).join(', ');
    return '<tr><td>' + f.path + '</td><td>' + (f.language || '-') + '</td><td><span class="pr">' + f.pagerank.toFixed(2) + '</span></td><td style="color:var(--dim);font-size:12px">' + (symbols || '-') + '</td></tr>';
  }).join('');
}

// Load memories
async function loadMemories() {
  const data = await (await fetch(API + '/api/memories')).json();
  const el = document.getElementById('memories-list');
  if (data.length === 0) { el.innerHTML = '<div class="empty">No memories yet. Use sverklo_remember to save decisions.</div>'; return; }
  el.innerHTML = data.map(m => {
    const tags = (m.tags || []).map(t => '<span class="tag">' + t + '</span>').join('');
    const age = formatAge(m.created_at);
    return '<div class="memory' + (m.is_stale ? ' stale' : '') + '"><div class="memory-header"><span class="memory-cat">' + m.category + '</span><span style="font-size:12px;color:var(--dim)">#' + m.id + '</span></div><div class="memory-content">' + m.content + '</div><div class="memory-meta">' + age + ' ago · conf: ' + m.confidence + ' · used: ' + m.access_count + 'x' + (m.git_sha ? ' · ' + (m.git_branch||'?') + '@' + m.git_sha.slice(0,7) : '') + ' ' + tags + '</div></div>';
  }).join('');
}
function formatAge(ts) { const m = Math.floor((Date.now()-ts)/60000); if(m<60) return m+'m'; const h=Math.floor(m/60); if(h<24) return h+'h'; return Math.floor(h/24)+'d'; }

// Search
let searchTimeout;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => doSearch(e.target.value), 300);
});
async function doSearch(q) {
  if (!q || q.length < 2) { document.getElementById('search-results').innerHTML = ''; return; }
  const data = await (await fetch(API + '/api/search?q=' + encodeURIComponent(q))).json();
  document.getElementById('search-results').innerHTML = data.map(r =>
    '<div class="result"><div class="result-header"><span class="result-path">' + r.file + ':' + r.startLine + '</span><span class="result-score">' + (r.name ? r.type + ': ' + r.name : r.type) + ' · score: ' + r.score.toFixed(4) + '</span></div><pre>' + escHtml(r.content.slice(0, 500)) + '</pre></div>'
  ).join('') || '<div class="empty">No results</div>';
}
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Graph
let graphData;
async function drawGraph() {
  if (!graphData) graphData = await (await fetch(API + '/api/deps')).json();
  const canvas = document.getElementById('graph-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;

  const nodes = graphData.nodes.map((n, i) => {
    const angle = (i / graphData.nodes.length) * Math.PI * 2;
    const r = Math.min(canvas.width, canvas.height) * 0.35;
    return { ...n, x: canvas.width/2 + Math.cos(angle) * r, y: canvas.height/2 + Math.sin(angle) * r, label: n.path.split('/').pop() };
  });
  const nodeMap = {};
  nodes.forEach(n => nodeMap[n.path] = n);

  // Simple force simulation (5 iterations)
  for (let iter = 0; iter < 50; iter++) {
    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d = Math.max(Math.sqrt(dx*dx + dy*dy), 1);
        const f = 5000 / (d * d);
        nodes[i].x -= dx/d * f;
        nodes[i].y -= dy/d * f;
        nodes[j].x += dx/d * f;
        nodes[j].y += dy/d * f;
      }
    }
    // Attraction (edges)
    for (const e of graphData.edges) {
      const a = nodeMap[e.source], b = nodeMap[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx*dx + dy*dy), 1);
      const f = (d - 120) * 0.01;
      a.x += dx/d * f; a.y += dy/d * f;
      b.x -= dx/d * f; b.y -= dy/d * f;
    }
    // Center gravity
    nodes.forEach(n => {
      n.x += (canvas.width/2 - n.x) * 0.01;
      n.y += (canvas.height/2 - n.y) * 0.01;
    });
  }

  // Draw
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Edges
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (const e of graphData.edges) {
    const a = nodeMap[e.source], b = nodeMap[e.target];
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // Nodes
  for (const n of nodes) {
    const size = 4 + n.pagerank * 12;
    ctx.beginPath(); ctx.arc(n.x, n.y, size, 0, Math.PI*2);
    ctx.fillStyle = n.pagerank > 0.5 ? '#7c6aef' : '#444';
    ctx.fill();
    ctx.fillStyle = '#aaa';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(n.label, n.x + size + 4, n.y + 4);
  }
}

// Init
loadStatus();
loadFiles();
loadMemories();
</script>
</body>
</html>`;
}
