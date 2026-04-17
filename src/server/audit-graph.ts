/**
 * Generate a self-contained HTML file with an interactive force-directed
 * dependency graph visualization.  No external JS/CSS — only a Google
 * Fonts link for JetBrains Mono.
 */

import type { Indexer } from "../indexer/indexer.js";
import type { AuditAnalysis } from "./audit-analysis.js";

export function generateAuditGraph(
  indexer: Indexer,
  analysis: AuditAnalysis,
  projectName: string,
): string {
  const files = indexer.fileStore.getAll();
  const edges = indexer.graphStore.getAll();

  // Build id->index map for the JS side
  const idToIdx = new Map<number, number>();
  const nodes: Array<{
    id: number;
    path: string;
    language: string;
    pagerank: number;
  }> = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    idToIdx.set(f.id, i);
    nodes.push({
      id: f.id,
      path: f.path,
      language: f.language || "",
      pagerank: f.pagerank,
    });
  }

  // Build edges (only include edges where both endpoints exist)
  const graphEdges: Array<{ source: number; target: number }> = [];
  for (const e of edges) {
    const si = idToIdx.get(e.source_file_id);
    const ti = idToIdx.get(e.target_file_id);
    if (si !== undefined && ti !== undefined) {
      graphEdges.push({ source: si, target: ti });
    }
  }

  // Build set of edges involved in cycles for highlighting
  const cycleEdgeSet = new Set<string>();
  for (const cycle of analysis.circularDeps) {
    // cycle is an array of file paths; build edges a->b->c->a
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      cycleEdgeSet.add(`${from}|${to}`);
    }
  }

  // Compute fan-in / fan-out per node index
  const fanIn = new Array(nodes.length).fill(0);
  const fanOut = new Array(nodes.length).fill(0);
  for (const e of graphEdges) {
    fanOut[e.source]++;
    fanIn[e.target]++;
  }

  // Mark cycle edges by index
  const cycleEdges: boolean[] = [];
  for (const e of graphEdges) {
    const sp = nodes[e.source].path;
    const tp = nodes[e.target].path;
    cycleEdges.push(cycleEdgeSet.has(`${sp}|${tp}`));
  }

  // Summary stats
  const totalFiles = files.length;
  const totalSymbols = indexer.chunkStore.count();
  const totalCycles = analysis.circularDeps.length;
  const maxFanIn = Math.max(0, ...fanIn);

  const hs = analysis.healthScore;
  const grade = hs.grade;
  const gradeColorMap: Record<string, string> = {
    A: "#4ade80", B: "#86efac", C: "#facc15", D: "#fb923c", F: "#ef4444",
  };
  const gradeColor = gradeColorMap[grade] || "#8B8B8B";

  // Serialize data for inline JS
  const nodesJSON = JSON.stringify(nodes.map((n, i) => ({
    path: n.path,
    lang: n.language,
    pr: n.pagerank,
    fi: fanIn[i],
    fo: fanOut[i],
  })));
  const edgesJSON = JSON.stringify(graphEdges);
  const cycleEdgesJSON = JSON.stringify(cycleEdges);

  const dimensionsHTML = hs.dimensions
    .map(d => `<tr><td>${esc(d.name)}</td><td style="color:${gradeColorMap[d.grade] || "#8B8B8B"}">${d.grade}</td><td>${esc(d.detail)}</td></tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sverklo Graph — ${esc(projectName)}</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0E0D0B;
  color: #EDE7D9;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}
canvas:active { cursor: grabbing; }

/* Grid pattern via CSS */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
  z-index: 0;
}

#overlay {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 10;
  pointer-events: none;
}
#overlay > * { pointer-events: auto; }

.panel {
  background: rgba(14,13,11,0.92);
  border: 1px solid #2A2620;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  backdrop-filter: blur(8px);
}

.header-panel h1 {
  font-size: 20px;
  margin-bottom: 4px;
}
.header-panel h1 span { color: #E85A2A; }

.grade-badge {
  display: inline-block;
  font-size: 16px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
  margin-left: 8px;
}

.stats {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: #A39886;
}
.stats b { color: #EDE7D9; }

.dims-table {
  width: 100%;
  font-size: 11px;
  margin-top: 8px;
  border-collapse: collapse;
}
.dims-table td {
  padding: 2px 8px 2px 0;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #A39886;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

#tooltip {
  position: fixed;
  display: none;
  background: rgba(14,13,11,0.95);
  border: 1px solid #2A2620;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 12px;
  color: #EDE7D9;
  pointer-events: none;
  z-index: 20;
  max-width: 400px;
  white-space: nowrap;
}
#tooltip .tp-path { color: #E85A2A; margin-bottom: 4px; }
#tooltip .tp-stat { color: #A39886; }
</style>
</head>
<body>
<canvas id="c"></canvas>

<div id="overlay">
  <div class="panel header-panel">
    <h1><span>sverklo</span> graph
      <span class="grade-badge" style="background:${gradeColor};color:#0E0D0B;">${esc(grade)}</span>
    </h1>
    <div class="stats">
      <span><b>${totalFiles}</b> files</span>
      <span><b>${totalSymbols}</b> symbols</span>
      <span><b>${totalCycles}</b> cycles</span>
      <span>max fan-in <b>${maxFanIn}</b></span>
    </div>
    <table class="dims-table">${dimensionsHTML}</table>
  </div>

  <div class="panel legend">
    <span class="legend-item"><span class="legend-dot" style="background:#3B82F6"></span>TS</span>
    <span class="legend-item"><span class="legend-dot" style="background:#F59E0B"></span>JS</span>
    <span class="legend-item"><span class="legend-dot" style="background:#10B981"></span>Py</span>
    <span class="legend-item"><span class="legend-dot" style="background:#00ADD8"></span>Go</span>
    <span class="legend-item"><span class="legend-dot" style="background:#FF6B35"></span>Rust</span>
    <span class="legend-item"><span class="legend-dot" style="background:#8B8B8B"></span>Other</span>
    <span class="legend-item" style="margin-left:8px"><span class="legend-dot" style="background:#E05D44"></span>Cycle</span>
  </div>
</div>

<div id="tooltip">
  <div class="tp-path"></div>
  <div class="tp-stat"></div>
</div>

<script>
(function() {
  var nodes = ${nodesJSON};
  var edges = ${edgesJSON};
  var cycleEdges = ${cycleEdgesJSON};
  var N = nodes.length;
  var E = edges.length;

  // Language colors
  var langColor = {
    typescript: '#3B82F6', javascript: '#F59E0B', python: '#10B981',
    go: '#00ADD8', rust: '#FF6B35',
    tsx: '#3B82F6', jsx: '#F59E0B',
  };
  function nodeColor(lang) {
    return langColor[lang] || '#8B8B8B';
  }

  // Node radius: proportional to PageRank, clamped
  var maxPR = 0;
  for (var i = 0; i < N; i++) if (nodes[i].pr > maxPR) maxPR = nodes[i].pr;
  function nodeRadius(pr) {
    if (maxPR === 0) return 4;
    return 3 + 12 * Math.sqrt(pr / maxPR);
  }

  // --- Force layout ---
  // Initialize positions in a circle
  var px = new Float64Array(N);
  var py = new Float64Array(N);
  var vx = new Float64Array(N);
  var vy = new Float64Array(N);

  for (var i = 0; i < N; i++) {
    var angle = (2 * Math.PI * i) / N;
    var r = Math.sqrt(N) * 15;
    px[i] = r * Math.cos(angle) + (Math.random() - 0.5) * 10;
    py[i] = r * Math.sin(angle) + (Math.random() - 0.5) * 10;
  }

  // Build adjacency for connected-component attraction
  var adj = new Array(N);
  for (var i = 0; i < N; i++) adj[i] = [];
  for (var i = 0; i < E; i++) {
    adj[edges[i].source].push(edges[i].target);
    adj[edges[i].target].push(edges[i].source);
  }

  // Run force simulation
  var ITERS = 200;
  var repulsion = 800;
  var attraction = 0.005;
  var damping = 0.9;
  var maxSpeed = 10;

  for (var iter = 0; iter < ITERS; iter++) {
    var alpha = 1 - iter / ITERS;

    // Repulsion (Barnes-Hut would be better but N is typically < 2000)
    // For large graphs, skip distant pairs
    if (N <= 500) {
      for (var i = 0; i < N; i++) {
        for (var j = i + 1; j < N; j++) {
          var dx = px[i] - px[j];
          var dy = py[i] - py[j];
          var d2 = dx * dx + dy * dy + 1;
          var f = repulsion * alpha / d2;
          var fx = dx * f / Math.sqrt(d2);
          var fy = dy * f / Math.sqrt(d2);
          vx[i] += fx; vy[i] += fy;
          vx[j] -= fx; vy[j] -= fy;
        }
      }
    } else {
      // Approximate: grid-based. Only repel nearby nodes.
      var cellSize = 80;
      var grid = {};
      for (var i = 0; i < N; i++) {
        var cx = Math.floor(px[i] / cellSize);
        var cy = Math.floor(py[i] / cellSize);
        var key = cx + ',' + cy;
        if (!grid[key]) grid[key] = [];
        grid[key].push(i);
      }
      for (var i = 0; i < N; i++) {
        var cx = Math.floor(px[i] / cellSize);
        var cy = Math.floor(py[i] / cellSize);
        for (var dcx = -1; dcx <= 1; dcx++) {
          for (var dcy = -1; dcy <= 1; dcy++) {
            var key = (cx+dcx) + ',' + (cy+dcy);
            var cell = grid[key];
            if (!cell) continue;
            for (var k = 0; k < cell.length; k++) {
              var j = cell[k];
              if (j <= i) continue;
              var dx = px[i] - px[j];
              var dy = py[i] - py[j];
              var d2 = dx * dx + dy * dy + 1;
              var f = repulsion * alpha / d2;
              var fx = dx * f / Math.sqrt(d2);
              var fy = dy * f / Math.sqrt(d2);
              vx[i] += fx; vy[i] += fy;
              vx[j] -= fx; vy[j] -= fy;
            }
          }
        }
      }
    }

    // Attraction along edges
    for (var i = 0; i < E; i++) {
      var s = edges[i].source, t = edges[i].target;
      var dx = px[t] - px[s];
      var dy = py[t] - py[s];
      var f = attraction * alpha;
      vx[s] += dx * f; vy[s] += dy * f;
      vx[t] -= dx * f; vy[t] -= dy * f;
    }

    // Center gravity
    for (var i = 0; i < N; i++) {
      vx[i] -= px[i] * 0.001 * alpha;
      vy[i] -= py[i] * 0.001 * alpha;
    }

    // Apply velocities
    for (var i = 0; i < N; i++) {
      vx[i] *= damping;
      vy[i] *= damping;
      var speed = Math.sqrt(vx[i]*vx[i] + vy[i]*vy[i]);
      if (speed > maxSpeed) {
        vx[i] *= maxSpeed / speed;
        vy[i] *= maxSpeed / speed;
      }
      px[i] += vx[i];
      py[i] += vy[i];
    }
  }

  // --- Canvas rendering ---
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var W, H;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', function() { resize(); draw(); });

  // Camera
  var camX = 0, camY = 0, camZoom = 1;

  // Center camera on graph
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var i = 0; i < N; i++) {
    if (px[i] < minX) minX = px[i];
    if (px[i] > maxX) maxX = px[i];
    if (py[i] < minY) minY = py[i];
    if (py[i] > maxY) maxY = py[i];
  }
  if (N > 0) {
    camX = (minX + maxX) / 2;
    camY = (minY + maxY) / 2;
    var spanX = maxX - minX + 100;
    var spanY = maxY - minY + 100;
    camZoom = Math.min(W / spanX, H / spanY, 2);
    camZoom = Math.max(camZoom, 0.1);
  }

  // Interaction state
  var dragging = false;
  var dragStartX, dragStartY, camStartX, camStartY;
  var selectedNode = -1;
  var hoverNode = -1;

  function worldToScreen(wx, wy) {
    return [(wx - camX) * camZoom + W / 2, (wy - camY) * camZoom + H / 2];
  }
  function screenToWorld(sx, sy) {
    return [(sx - W / 2) / camZoom + camX, (sy - H / 2) / camZoom + camY];
  }

  function findNodeAt(sx, sy) {
    var w = screenToWorld(sx, sy);
    var best = -1, bestD = Infinity;
    for (var i = 0; i < N; i++) {
      var dx = px[i] - w[0], dy = py[i] - w[1];
      var r = nodeRadius(nodes[i].pr) / camZoom + 4 / camZoom;
      var d = dx*dx + dy*dy;
      if (d < r*r && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  canvas.addEventListener('mousedown', function(e) {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    camStartX = camX;
    camStartY = camY;
  });
  canvas.addEventListener('mousemove', function(e) {
    if (dragging) {
      camX = camStartX - (e.clientX - dragStartX) / camZoom;
      camY = camStartY - (e.clientY - dragStartY) / camZoom;
      draw();
    } else {
      var prev = hoverNode;
      hoverNode = findNodeAt(e.clientX, e.clientY);
      if (hoverNode !== prev) draw();
      // Tooltip
      var tip = document.getElementById('tooltip');
      if (hoverNode >= 0) {
        var n = nodes[hoverNode];
        tip.querySelector('.tp-path').textContent = n.path;
        tip.querySelector('.tp-stat').textContent =
          'PageRank: ' + n.pr.toFixed(3) +
          '  fan-in: ' + n.fi + '  fan-out: ' + n.fo;
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
      } else {
        tip.style.display = 'none';
      }
    }
  });
  canvas.addEventListener('mouseup', function(e) {
    if (dragging) {
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        // Click — select/deselect
        var hit = findNodeAt(e.clientX, e.clientY);
        selectedNode = (hit === selectedNode) ? -1 : hit;
        draw();
      }
    }
    dragging = false;
  });
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var factor = e.deltaY > 0 ? 0.9 : 1.1;
    var w = screenToWorld(e.clientX, e.clientY);
    camZoom *= factor;
    camZoom = Math.max(0.05, Math.min(camZoom, 10));
    // Keep point under mouse stable
    camX = w[0] - (e.clientX - W/2) / camZoom;
    camY = w[1] - (e.clientY - H/2) / camZoom;
    draw();
  }, { passive: false });

  // Build connected set for selected node
  function connectedEdges(ni) {
    var set = new Set();
    for (var i = 0; i < E; i++) {
      if (edges[i].source === ni || edges[i].target === ni) set.add(i);
    }
    return set;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    var selEdges = selectedNode >= 0 ? connectedEdges(selectedNode) : null;

    // Draw edges
    for (var i = 0; i < E; i++) {
      var s = edges[i].source, t = edges[i].target;
      var p1 = worldToScreen(px[s], py[s]);
      var p2 = worldToScreen(px[t], py[t]);

      var isCycle = cycleEdges[i];
      var isConnected = selEdges && selEdges.has(i);
      var dimmed = selEdges && !isConnected;

      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);

      if (isCycle) {
        ctx.strokeStyle = dimmed ? 'rgba(224,93,68,0.15)' : '#E05D44';
        ctx.lineWidth = dimmed ? 0.5 : 1.5;
      } else if (isConnected) {
        ctx.strokeStyle = '#E85A2A';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = dimmed ? 'rgba(42,38,32,0.3)' : '#2A2620';
        ctx.lineWidth = 0.5;
      }
      ctx.stroke();
    }

    // Draw nodes
    for (var i = 0; i < N; i++) {
      var p = worldToScreen(px[i], py[i]);
      var r = nodeRadius(nodes[i].pr) * camZoom;
      if (r < 0.5) r = 0.5;

      // Cull off-screen
      if (p[0] + r < 0 || p[0] - r > W || p[1] + r < 0 || p[1] - r > H) continue;

      var col = nodeColor(nodes[i].lang);
      var dimmed = selEdges && selectedNode !== i &&
        !selEdges.has(-1); // check if connected
      if (selEdges && selectedNode !== i) {
        var connected = false;
        selEdges.forEach(function(ei) {
          if (edges[ei].source === i || edges[ei].target === i) connected = true;
        });
        dimmed = !connected;
      }

      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);

      if (i === selectedNode) {
        ctx.fillStyle = '#EDE7D9';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (i === hoverNode) {
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = '#EDE7D9';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.globalAlpha = dimmed ? 0.2 : 1;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Label for large or hovered/selected nodes
      if ((r > 6 && camZoom > 0.5) || i === hoverNode || i === selectedNode) {
        var label = nodes[i].path.split('/').pop();
        ctx.font = Math.max(9, Math.min(12, r * 1.1)) + 'px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = dimmed ? 'rgba(163,152,134,0.3)' : '#A39886';
        ctx.fillText(label, p[0], p[1] + r + 3);
      }
    }
  }

  draw();
})();
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
