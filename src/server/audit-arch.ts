/**
 * Generate a self-contained HTML file with a high-level architecture diagram.
 * Groups files by directory, detects layer patterns, renders boxes with
 * dependency arrows in a clean deterministic layout.
 */

import type { Indexer } from "../indexer/indexer.js";
import type { AuditAnalysis } from "./audit-analysis.js";

// ─── Layer detection ───

interface LayerGroup {
  name: string;
  dir: string;
  color: string;
  bgColor: string;
  files: Array<{ path: string; pagerank: number }>;
  fileCount: number;
  grade: string;
}

interface LayerEdge {
  from: string; // dir key
  to: string;
  count: number;
}

const LAYER_PATTERNS: Array<{
  label: string;
  match: RegExp;
  color: string;
}> = [
  { label: "Frontend",  match: /^(components|views|ui|pages|layouts|templates)\b/i, color: "#06b6d4" },
  { label: "API",       match: /^(api|routes|controllers|handlers|endpoints|server)\b/i, color: "#10b981" },
  { label: "Storage",   match: /^(models|storage|db|database|repositories|persistence)\b/i, color: "#8b5cf6" },
  { label: "Search",    match: /^(search|query|find)\b/i, color: "#3b82f6" },
  { label: "Indexer",   match: /^(indexer|parser|scanner|analyzer|compiler)\b/i, color: "#ec4899" },
  { label: "Auth",      match: /^(auth|security|acl|permissions)\b/i, color: "#f43f5e" },
  { label: "Config",    match: /^(config|settings|env)\b/i, color: "#f59e0b" },
  { label: "Utils",     match: /^(utils|lib|helpers|shared|common|core)\b/i, color: "#f97316" },
  { label: "Tests",     match: /^(tests?|__tests__|spec|specs|fixtures)\b/i, color: "#64748b" },
  { label: "Types",     match: /^(types|interfaces|typings|defs)\b/i, color: "#a78bfa" },
  { label: "Memory",    match: /^(memory|cache|state)\b/i, color: "#14b8a6" },
];

function detectLayerColor(dir: string): { label: string; color: string } {
  for (const p of LAYER_PATTERNS) {
    if (p.match.test(dir)) return { label: p.label, color: p.color };
  }
  // Default: use the dir name as label
  return { label: dir.charAt(0).toUpperCase() + dir.slice(1), color: "#94a3b8" };
}

function gradeFromScore(score: number): string {
  if (score >= 4.5) return "A";
  if (score >= 3.5) return "B";
  if (score >= 2.5) return "C";
  if (score >= 1.5) return "D";
  return "F";
}

const GRADE_COLORS: Record<string, string> = {
  A: "#4ade80", B: "#86efac", C: "#facc15", D: "#fb923c", F: "#ef4444",
};

function detectArchType(layers: LayerGroup[], edges: LayerEdge[]): string {
  const names = new Set(layers.map(l => l.name.toLowerCase()));
  const hasFrontend = ["frontend", "ui", "views", "components", "pages"].some(n => names.has(n));
  const hasApi = ["api", "server", "routes", "controllers"].some(n => names.has(n));
  const hasStorage = ["storage", "database", "db", "models"].some(n => names.has(n));

  if (hasFrontend && hasApi && hasStorage) return "Full-Stack Application";
  if (hasApi && hasStorage) return "Layered Architecture";
  if (layers.length >= 5 && edges.length >= 4) return "Modular Monolith";
  if (layers.length <= 2) return "Simple Module";
  return "Modular Architecture";
}

export function generateAuditArch(
  indexer: Indexer,
  analysis: AuditAnalysis,
  projectName: string,
): string {
  const files = indexer.fileStore.getAll();
  const edges = indexer.graphStore.getAll();

  // Build id->path map
  const idToPath = new Map<number, string>();
  for (const f of files) idToPath.set(f.id, f.path);

  // Group files by top-level directory (first segment after src/ if present)
  const groups = new Map<string, Array<{ path: string; pagerank: number }>>();

  for (const f of files) {
    const parts = f.path.split("/");
    // Skip root-level config files
    if (parts.length <= 1) continue;
    // If first dir is "src", use second level
    let dir: string;
    if (parts[0] === "src" && parts.length > 2) {
      dir = parts[1];
    } else {
      dir = parts[0];
    }
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push({ path: f.path, pagerank: f.pagerank });
  }

  // Build layer groups
  const layers: LayerGroup[] = [];
  for (const [dir, layerFiles] of groups) {
    if (layerFiles.length === 0) continue;
    const { label, color } = detectLayerColor(dir);
    // Sort by pagerank descending for "key files"
    layerFiles.sort((a, b) => b.pagerank - a.pagerank);
    layers.push({
      name: label,
      dir,
      color,
      bgColor: color + "1a", // 10% opacity hex
      files: layerFiles,
      fileCount: layerFiles.length,
      grade: "B", // computed below
    });
  }

  // Compute per-layer health: average pagerank as a proxy, plus fan-in/out balance
  const fileIdToDir = new Map<number, string>();
  for (const f of files) {
    const parts = f.path.split("/");
    if (parts.length <= 1) continue;
    if (parts[0] === "src" && parts.length > 2) {
      fileIdToDir.set(f.id, parts[1]);
    } else {
      fileIdToDir.set(f.id, parts[0]);
    }
  }

  // Count fan-in per layer
  const layerFanIn = new Map<string, number>();
  const layerFanOut = new Map<string, number>();
  for (const e of edges) {
    const srcDir = fileIdToDir.get(e.source_file_id);
    const tgtDir = fileIdToDir.get(e.target_file_id);
    if (srcDir && tgtDir && srcDir !== tgtDir) {
      layerFanOut.set(srcDir, (layerFanOut.get(srcDir) || 0) + 1);
      layerFanIn.set(tgtDir, (layerFanIn.get(tgtDir) || 0) + 1);
    }
  }

  // Assign grades: layers with high fan-in and low fan-out score well (stable dependencies)
  for (const layer of layers) {
    const fi = layerFanIn.get(layer.dir) || 0;
    const fo = layerFanOut.get(layer.dir) || 0;
    const ratio = fo === 0 ? 5 : Math.min(5, 5 - (fo / (fi + fo + 1)) * 4);
    layer.grade = gradeFromScore(ratio);
  }

  // Build inter-layer edges with counts
  const edgeCounts = new Map<string, number>();
  for (const e of edges) {
    const srcDir = fileIdToDir.get(e.source_file_id);
    const tgtDir = fileIdToDir.get(e.target_file_id);
    if (srcDir && tgtDir && srcDir !== tgtDir) {
      const key = `${srcDir}|${tgtDir}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + e.reference_count);
    }
  }

  const layerEdges: LayerEdge[] = [];
  for (const [key, count] of edgeCounts) {
    const [from, to] = key.split("|");
    layerEdges.push({ from, to, count });
  }

  // Topological sort of layers by dependency direction
  const dirSet = new Set(layers.map(l => l.dir));
  const inDeg = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  for (const d of dirSet) {
    inDeg.set(d, 0);
    adjList.set(d, []);
  }
  for (const e of layerEdges) {
    if (dirSet.has(e.from) && dirSet.has(e.to)) {
      adjList.get(e.from)!.push(e.to);
      inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
    }
  }

  // Kahn's algorithm
  const sorted: string[] = [];
  const queue: string[] = [];
  for (const [d, deg] of inDeg) {
    if (deg === 0) queue.push(d);
  }
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adjList.get(node) || []) {
      const newDeg = (inDeg.get(neighbor) || 1) - 1;
      inDeg.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }
  // Add any remaining (cycles) in original order
  for (const layer of layers) {
    if (!sorted.includes(layer.dir)) sorted.push(layer.dir);
  }

  // Reorder layers by topo sort
  const dirToLayer = new Map(layers.map(l => [l.dir, l]));
  const sortedLayers = sorted.filter(d => dirToLayer.has(d)).map(d => dirToLayer.get(d)!);

  // Layout: grid, max 3 columns
  const cols = Math.min(3, sortedLayers.length);
  const rows = Math.ceil(sortedLayers.length / cols);
  const boxW = 280;
  const boxH = 200;
  const gapX = 100;
  const gapY = 80;
  const marginLeft = 60;
  const marginTop = 80;

  interface BoxPos { x: number; y: number; layer: LayerGroup }
  const boxes: BoxPos[] = [];
  for (let i = 0; i < sortedLayers.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    boxes.push({
      x: marginLeft + col * (boxW + gapX),
      y: marginTop + row * (boxH + gapY),
      layer: sortedLayers[i],
    });
  }

  const svgW = marginLeft * 2 + cols * boxW + (cols - 1) * gapX;
  const svgH = marginTop + rows * (boxH + gapY) + 40;

  const dirToBox = new Map(boxes.map(b => [b.layer.dir, b]));

  // Health info
  const hs = analysis.healthScore;
  const overallGrade = hs.grade;
  const overallGradeColor = GRADE_COLORS[overallGrade] || "#94a3b8";
  const archType = detectArchType(sortedLayers, layerEdges);

  // Build SVG arrows
  const arrowsSvg: string[] = [];
  for (const edge of layerEdges) {
    const fromBox = dirToBox.get(edge.from);
    const toBox = dirToBox.get(edge.to);
    if (!fromBox || !toBox) continue;

    const x1 = fromBox.x + boxW / 2;
    const y1 = fromBox.y + boxH / 2;
    const x2 = toBox.x + boxW / 2;
    const y2 = toBox.y + boxH / 2;

    // Connect from edge of box to edge of box
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;

    // Start/end offsets: exit from the nearest box edge
    const nx = dx / dist;
    const ny = dy / dist;

    let sx: number, sy: number, ex: number, ey: number;

    // Source exit point
    if (Math.abs(nx) * boxH > Math.abs(ny) * boxW) {
      // Exit from left or right
      sx = fromBox.x + (nx > 0 ? boxW : 0);
      sy = fromBox.y + boxH / 2 + (ny / Math.abs(nx)) * (boxW / 2);
    } else {
      // Exit from top or bottom
      sx = fromBox.x + boxW / 2 + (nx / Math.abs(ny)) * (boxH / 2);
      sy = fromBox.y + (ny > 0 ? boxH : 0);
    }

    // Target entry point
    if (Math.abs(nx) * boxH > Math.abs(ny) * boxW) {
      ex = toBox.x + (nx > 0 ? 0 : boxW);
      ey = toBox.y + boxH / 2 - (ny / Math.abs(nx)) * (boxW / 2);
    } else {
      ex = toBox.x + boxW / 2 - (nx / Math.abs(ny)) * (boxH / 2);
      ey = toBox.y + (ny > 0 ? 0 : boxH);
    }

    const midX = (sx + ex) / 2;
    const midY = (sy + ey) / 2;
    const opacity = Math.min(0.8, 0.2 + edge.count * 0.02);

    arrowsSvg.push(
      `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" ` +
      `stroke="#475569" stroke-width="1.5" stroke-opacity="${opacity}" marker-end="url(#arrow)"/>`,
      `<text x="${midX}" y="${midY - 6}" text-anchor="middle" ` +
      `fill="#64748b" font-size="11" font-family="'JetBrains Mono', monospace">${edge.count}</text>`,
    );
  }

  // Build box SVG
  const boxesSvg: string[] = [];
  for (const box of boxes) {
    const l = box.layer;
    const topFiles = l.files.slice(0, 3).map(f => {
      const name = f.path.split("/").pop() || f.path;
      return esc(name.length > 28 ? name.slice(0, 25) + "..." : name);
    });

    const gc = GRADE_COLORS[l.grade] || "#94a3b8";

    boxesSvg.push(`
      <g>
        <rect x="${box.x}" y="${box.y}" width="${boxW}" height="${boxH}" rx="12"
              fill="${l.color}1a" stroke="${l.color}" stroke-width="1.5"/>
        <!-- Header bar -->
        <rect x="${box.x}" y="${box.y}" width="${boxW}" height="40" rx="12"
              fill="${l.color}26"/>
        <rect x="${box.x}" y="${box.y + 28}" width="${boxW}" height="12"
              fill="${l.color}26"/>
        <!-- Layer name -->
        <text x="${box.x + 14}" y="${box.y + 26}" fill="${l.color}"
              font-size="14" font-weight="700"
              font-family="'JetBrains Mono', monospace">${esc(l.name)}</text>
        <!-- File count -->
        <text x="${box.x + boxW - 14}" y="${box.y + 26}" fill="${l.color}"
              font-size="12" text-anchor="end" opacity="0.7"
              font-family="'JetBrains Mono', monospace">${l.fileCount} files</text>
        <!-- Grade badge -->
        <rect x="${box.x + boxW - 38}" y="${box.y + boxH - 34}" width="26" height="22" rx="4"
              fill="${gc}" opacity="0.9"/>
        <text x="${box.x + boxW - 25}" y="${box.y + boxH - 18}" fill="#0f172a"
              font-size="12" font-weight="700" text-anchor="middle"
              font-family="'JetBrains Mono', monospace">${l.grade}</text>
        <!-- Key files -->
        ${topFiles.map((name, i) => `
        <text x="${box.x + 14}" y="${box.y + 62 + i * 20}" fill="#94a3b8"
              font-size="11" font-family="'JetBrains Mono', monospace">${name}</text>
        `).join("")}
        <!-- Dir label -->
        <text x="${box.x + 14}" y="${box.y + boxH - 14}" fill="#475569"
              font-size="10" font-family="'JetBrains Mono', monospace">${esc(l.dir)}/</text>
      </g>
    `);
  }

  // Summary section
  const summaryCards = sortedLayers.map(l => {
    const topFile = l.files[0] ? l.files[0].path.split("/").pop() : "none";
    const fi = layerFanIn.get(l.dir) || 0;
    const fo = layerFanOut.get(l.dir) || 0;
    return `
      <div class="summary-card" style="border-color: ${l.color}">
        <div class="sc-header" style="color: ${l.color}">${esc(l.name)}</div>
        <ul>
          <li>${l.fileCount} files, grade ${l.grade}</li>
          <li>Key: ${esc(topFile || "none")}</li>
          <li>Deps in: ${fi}, out: ${fo}</li>
        </ul>
      </div>`;
  }).join("\n");

  const dimensionsHtml = hs.dimensions
    .map(d => `<span class="dim"><span class="dim-grade" style="color:${GRADE_COLORS[d.grade] || "#94a3b8"}">${d.grade}</span> ${esc(d.name)}</span>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sverklo Architecture — ${esc(projectName)}</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0f172a;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', monospace;
  min-height: 100vh;
}
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
  z-index: 0;
}
.container {
  position: relative;
  z-index: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 32px;
}
.header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}
.header h1 {
  font-size: 22px;
  font-weight: 700;
  color: #e2e8f0;
}
.header h1 span { color: #E85A2A; }
.grade-badge {
  display: inline-block;
  font-size: 16px;
  font-weight: 700;
  padding: 2px 12px;
  border-radius: 6px;
  color: #0f172a;
}
.arch-label {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 8px;
}
.dims-row {
  display: flex;
  gap: 16px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}
.dim {
  font-size: 12px;
  color: #94a3b8;
}
.dim-grade {
  font-weight: 700;
  margin-right: 4px;
}
.diagram {
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
  overflow-x: auto;
  margin-bottom: 40px;
}
.diagram svg {
  display: block;
}
.summary-section h2 {
  font-size: 16px;
  color: #e2e8f0;
  margin-bottom: 16px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 48px;
}
.summary-card {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid;
  border-radius: 8px;
  padding: 14px 16px;
}
.sc-header {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 8px;
}
.summary-card ul {
  list-style: none;
  font-size: 11px;
  color: #94a3b8;
}
.summary-card li {
  padding: 2px 0;
}
.summary-card li::before {
  content: '\\2022';
  margin-right: 6px;
  opacity: 0.5;
}
.footer {
  text-align: center;
  font-size: 11px;
  color: #475569;
  padding: 16px 0 32px;
}
.footer a { color: #64748b; text-decoration: none; }
.footer a:hover { color: #94a3b8; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1><span>sverklo</span> architecture</h1>
    <span class="grade-badge" style="background:${overallGradeColor}">${esc(overallGrade)}</span>
  </div>
  <div class="arch-label">${esc(projectName)} &mdash; ${esc(archType)}</div>
  <div class="dims-row">${dimensionsHtml}</div>

  <div class="diagram">
    <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/>
        </marker>
      </defs>
      ${arrowsSvg.join("\n      ")}
      ${boxesSvg.join("\n      ")}
    </svg>
  </div>

  <div class="summary-section">
    <h2>Layer Summary</h2>
    <div class="summary-grid">
      ${summaryCards}
    </div>
  </div>

  <div class="footer">
    Generated by Sverklo &middot; <a href="https://sverklo.com">sverklo.com</a>
  </div>
</div>
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
