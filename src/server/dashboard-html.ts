export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>sverklo</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%230E0D0B' rx='18' ry='18'/><rect x='27' y='28' width='10' height='44' fill='%23E85A2A'/><text x='42' y='71' font-family='JetBrains Mono,monospace' font-weight='700' font-size='56' letter-spacing='-2' fill='%23EDE7D9'>s</text></svg>">
<!--
  Sverklo is local-first. The dashboard never makes a network call:
  if you have JetBrains Mono / Public Sans installed (most JetBrains
  and Adobe-tooling users do), the @font-face below picks them up via
  local() and the page renders pixel-identical to a Google Fonts pull.
  Otherwise the browser falls back to the system stack (ui-monospace
  on macOS, Cascadia Code on Windows, Consolas on older Windows,
  DejaVu/Liberation on Linux) — still on-brand, still zero beacons.
-->
<style>
  @font-face { font-family: 'JetBrains Mono'; font-weight: 400; src: local('JetBrains Mono'), local('JetBrainsMono-Regular'); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 500; src: local('JetBrains Mono Medium'), local('JetBrainsMono-Medium'); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 600; src: local('JetBrains Mono SemiBold'), local('JetBrainsMono-SemiBold'); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 700; src: local('JetBrains Mono Bold'), local('JetBrainsMono-Bold'); }
  @font-face { font-family: 'Public Sans'; font-weight: 400; src: local('Public Sans Regular'), local('PublicSans-Regular'); }
  @font-face { font-family: 'Public Sans'; font-weight: 500; src: local('Public Sans Medium'), local('PublicSans-Medium'); }
  @font-face { font-family: 'Public Sans'; font-weight: 600; src: local('Public Sans SemiBold'), local('PublicSans-SemiBold'); }
  @font-face { font-family: 'Public Sans'; font-weight: 700; src: local('Public Sans Bold'), local('PublicSans-Bold'); }
</style>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0E0D0B;
  --bg-2: #16140F;
  --bg-3: #1C1A14;
  --bg-hover: #22201A;
  --rule: #2A2620;
  --rule-2: #403A30;
  --text: #EDE7D9;
  --text-2: #A39886;
  --text-3: #6B6354;
  --accent: #E85A2A;
  --accent-dim: #B8441C;
  --accent-glow: rgba(232, 90, 42, 0.14);
  --ok: #8FB339;
  --warn: #D4A535;
  --info: #5BA3F5;
  --err: #E5484D;

  /* Language colors — hand-picked, not rainbow */
  --lang-ts: #5BA3F5;
  --lang-js: #D4A535;
  --lang-py: #8FB339;
  --lang-go: #22D3EE;
  --lang-rs: #E5484D;
  --lang-java: #F97316;
  --lang-c: #A1A1AA;
  --lang-rb: #C084FC;
}

html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "ss01", "cv11";
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  height: 100vh;
}

.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

/* ────────── LAYOUT ────────── */
.app {
  display: grid;
  grid-template-rows: 44px 1fr 28px;
  grid-template-columns: 240px 1fr 360px;
  grid-template-areas:
    "head head head"
    "rail main inspector"
    "foot foot foot";
  height: 100vh;
}

/* ────────── HEADER ────────── */
header.chrome {
  grid-area: head;
  border-bottom: 1px solid var(--rule);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 20px;
  background: var(--bg);
}
.brand {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}
.brand::before { content: "▌ "; color: var(--accent); }
.breadcrumb {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--text-2);
  display: flex;
  gap: 6px;
  align-items: center;
}
.breadcrumb .sep { color: var(--text-3); }
.breadcrumb .git { color: var(--ok); }
.chrome-spacer { flex: 1; }
.cmdk-hint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 10px;
  border: 1px solid var(--rule);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cmdk-hint:hover { border-color: var(--rule-2); color: var(--text-2); }
.cmdk-hint kbd {
  font-family: inherit;
  font-size: 10px;
  padding: 1px 6px;
  background: var(--bg-3);
  border: 1px solid var(--rule);
  color: var(--text-2);
}

/* ────────── LEFT RAIL ────────── */
nav.rail {
  grid-area: rail;
  border-right: 1px solid var(--rule);
  padding: 16px 0;
  overflow-y: auto;
  background: var(--bg);
}
.rail-section {
  padding: 0 16px;
  margin-bottom: 24px;
}
.rail-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 8px;
  padding-left: 10px;
}
.rail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  cursor: pointer;
  border-left: 2px solid transparent;
  font-size: 13px;
  color: var(--text-2);
  transition: color 0.1s, background 0.1s;
}
.rail-item:hover {
  color: var(--text);
  background: var(--bg-2);
}
.rail-item.active {
  color: var(--text);
  border-left-color: var(--accent);
  background: var(--bg-2);
}
.rail-item .count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
}
.rail-item.active .count { color: var(--accent); }

/* ────────── MAIN ────────── */
main.stage {
  grid-area: main;
  overflow: hidden;
  position: relative;
  background: var(--bg);
}
.view { display: none; height: 100%; overflow: hidden; }
.view.active { display: block; }

/* ── Graph view ── */
#graph-view { position: relative; overflow: hidden; }
#graph-svg {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}
#graph-svg:active { cursor: grabbing; }
#graph-svg .node { cursor: pointer; }
#graph-svg .node circle { stroke: var(--bg); stroke-width: 1.5px; transition: stroke 0.15s; }
#graph-svg .node:hover circle { stroke: var(--accent); stroke-width: 2px; }
#graph-svg .node.selected circle { stroke: var(--accent); stroke-width: 2.5px; }
#graph-svg .link { stroke: var(--rule); fill: none; }
#graph-svg .link.highlighted { stroke: var(--accent); }
#graph-svg .node-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  fill: var(--text-2);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
}
#graph-svg .node:hover .node-label,
#graph-svg .node.selected .node-label,
#graph-svg .node.label-visible .node-label { opacity: 1; }

.graph-controls {
  position: absolute;
  bottom: 20px;
  left: 20px;
  display: flex;
  gap: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  align-items: center;
  flex-wrap: wrap;
  max-width: 500px;
}
.graph-chip {
  padding: 6px 12px;
  background: var(--bg-2);
  border: 1px solid var(--rule);
  color: var(--text-2);
  cursor: pointer;
}
.graph-chip:hover { border-color: var(--rule-2); color: var(--text); }
.graph-chip.on { border-color: var(--accent); color: var(--accent); }

.graph-search {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 0;
  max-width: 600px;
}
.graph-search input {
  flex: 1;
  padding: 10px 14px;
  background: rgba(22, 20, 15, 0.92);
  backdrop-filter: blur(8px);
  border: 1px solid var(--rule);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  outline: none;
}
.graph-search input:focus { border-color: var(--accent); }
.graph-search input::placeholder { color: var(--text-3); }

.graph-legend {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(22, 20, 15, 0.92);
  backdrop-filter: blur(8px);
  border: 1px solid var(--rule);
  padding: 12px 16px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--text-3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.graph-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.graph-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.graph-slider-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-2);
  border: 1px solid var(--rule);
  color: var(--text-2);
}
.graph-slider-group label { white-space: nowrap; }
.graph-slider-group input[type="range"] {
  width: 100px;
  accent-color: var(--accent);
}
.graph-slider-group .slider-val {
  min-width: 32px;
  text-align: right;
  color: var(--accent);
}

.graph-tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(22, 20, 15, 0.95);
  border: 1px solid var(--rule-2);
  padding: 8px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text);
  display: none;
  z-index: 100;
  white-space: nowrap;
}
.graph-tooltip .tt-path { color: var(--accent); margin-bottom: 2px; }
.graph-tooltip .tt-meta { color: var(--text-3); }

/* ── Search view ── */
#search-view {
  display: none;
  flex-direction: column;
  padding: 0;
}
#search-view.active { display: flex; }

.search-header {
  padding: 24px 32px 16px;
  border-bottom: 1px solid var(--rule);
}
.search-input {
  width: 100%;
  padding: 8px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 20px;
  outline: none;
  font-weight: 500;
}
.search-input:focus { border-bottom-color: var(--accent); }
.search-input::placeholder { color: var(--text-3); }
.search-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
  margin-top: 10px;
  display: flex;
  gap: 16px;
}
.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 16px 32px 32px;
}
.result {
  padding: 16px 0;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
}
.result:hover { background: var(--bg-2); margin: 0 -32px; padding: 16px 32px; }
.result-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}
.result-path { color: var(--accent); }
.result-meta { color: var(--text-3); display: flex; gap: 12px; }
.result-type { color: var(--warn); }
.result-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-wrap;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
}

/* ── Memories view ── */
#memories-view { padding: 0; overflow-y: auto; }
.view-header {
  padding: 24px 32px 16px;
  border-bottom: 1px solid var(--rule);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.view-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.view-title::before { content: "▌ "; color: var(--accent); }
.view-subtitle {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
}
.memories-list { padding: 16px 32px 32px; }
.memory {
  padding: 16px 0;
  border-bottom: 1px solid var(--rule);
  display: grid;
  grid-template-columns: 140px 1fr 120px;
  gap: 24px;
  align-items: baseline;
}
.memory-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
}
.memory-meta .cat {
  display: inline-block;
  padding: 2px 8px;
  color: var(--accent);
  border: 1px solid var(--accent);
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.06em;
  font-weight: 600;
  margin-bottom: 6px;
}
.memory-meta .git { color: var(--ok); margin-top: 4px; }
.memory-content { font-size: 14px; color: var(--text); line-height: 1.55; }
.memory-stats {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
  text-align: right;
}
.memory.stale { opacity: 0.55; border-left: 2px solid var(--warn); padding-left: 16px; margin-left: -18px; }
.memory.stale .cat { color: var(--warn); border-color: var(--warn); }

/* ── Files view ── */
#files-view { padding: 0; overflow-y: auto; }
.files-list { padding: 0; }
.file-row {
  display: grid;
  grid-template-columns: 1fr 80px 80px 60px;
  gap: 16px;
  align-items: center;
  padding: 10px 32px;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  font-size: 13px;
}
.file-row:hover { background: var(--bg-2); }
.file-row .path { font-family: 'JetBrains Mono', monospace; color: var(--text); }
.file-row .lang { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-3); }
.file-row .pr { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent); text-align: right; }
.file-row .chunks { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-3); text-align: right; }
.file-row .pr-bar {
  display: inline-block;
  height: 2px;
  background: var(--accent);
  vertical-align: middle;
  margin-right: 6px;
}

/* ── Stats view ── */
#stats-view { padding: 32px; overflow-y: auto; }
.hero-stat {
  padding: 32px 0 24px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 32px;
}
.hero-stat-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 72px;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: var(--accent);
  line-height: 1;
}
.hero-stat-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--text);
  margin-top: 12px;
}
.hero-stat-desc {
  font-size: 13px;
  color: var(--text-2);
  margin-top: 6px;
  max-width: 60ch;
}
.mini-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
}
.mini-stat {
  background: var(--bg);
  padding: 20px;
}
.mini-stat-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-3);
  margin-bottom: 12px;
}
.mini-stat-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}
.mini-stat-sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
  margin-top: 4px;
}
.lang-bars {
  margin-top: 16px;
  display: flex;
  gap: 2px;
  height: 8px;
  background: var(--bg-3);
}
.lang-bar { height: 100%; }

/* ────────── RIGHT INSPECTOR ────────── */
aside.inspector {
  grid-area: inspector;
  border-left: 1px solid var(--rule);
  overflow-y: auto;
  background: var(--bg);
  padding: 20px;
}
.inspector-empty {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
  padding: 16px 0;
}
.inspector-empty::before { content: "// "; color: var(--accent); }
.inspector-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-3);
  margin-bottom: 8px;
}
.inspector-title::before { content: "// "; color: var(--accent); }
.inspector-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  color: var(--text);
  word-break: break-all;
  margin-bottom: 20px;
}
.inspector-section { margin-bottom: 24px; }
.inspector-row {
  padding: 6px 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid var(--rule);
}
.inspector-row .k { color: var(--text-3); }
.inspector-row .v { color: var(--text); }
.inspector-pill {
  display: inline-block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 3px 8px;
  background: var(--bg-2);
  border: 1px solid var(--rule);
  color: var(--text-2);
  margin: 2px 4px 2px 0;
}
.inspector-chunk {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 4px 0;
  color: var(--text-2);
}
.inspector-chunk .type { color: var(--accent); }
.inspector-chunk .line { color: var(--text-3); float: right; }

/* ────────── FOOTER ────────── */
footer.status {
  grid-area: foot;
  border-top: 1px solid var(--rule);
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
  gap: 24px;
  background: var(--bg);
}
footer.status .item { display: flex; gap: 6px; }
footer.status .item .k { color: var(--text-3); }
footer.status .item .v { color: var(--text-2); }
footer.status .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--ok);
  margin-right: 4px;
  vertical-align: middle;
}
footer.status .spacer { flex: 1; }

/* ────────── CMDK PALETTE ────────── */
.cmdk-overlay {
  position: fixed;
  inset: 0;
  background: rgba(14, 13, 11, 0.85);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: none;
  padding-top: 15vh;
}
.cmdk-overlay.open { display: block; }
.cmdk-box {
  max-width: 560px;
  margin: 0 auto;
  background: var(--bg-2);
  border: 1px solid var(--rule-2);
}
.cmdk-input {
  width: 100%;
  padding: 16px 20px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px;
  outline: none;
}
.cmdk-input::placeholder { color: var(--text-3); }
.cmdk-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 8px 0;
}
.cmdk-item {
  padding: 10px 20px;
  cursor: pointer;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.cmdk-item.selected { background: var(--bg-3); color: var(--accent); }
.cmdk-item .kind { font-size: 11px; color: var(--text-3); }

/* scrollbars */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--rule); }
::-webkit-scrollbar-thumb:hover { background: var(--rule-2); }
</style>
</head>
<body>

<div class="app">
  <!-- ────────── HEADER ────────── -->
  <header class="chrome">
    <div class="brand mono">sverklo</div>
    <div class="breadcrumb">
      <span id="bc-project">loading…</span>
      <span class="sep">·</span>
      <span class="git" id="bc-branch">·</span>
      <span class="sep">·</span>
      <span id="bc-indexed">·</span>
    </div>
    <div class="chrome-spacer"></div>
    <div class="cmdk-hint" onclick="openCmdk()"><span>command</span> <kbd>⌘K</kbd></div>
  </header>

  <!-- ────────── LEFT RAIL ────────── -->
  <nav class="rail">
    <div class="rail-section">
      <div class="rail-label">Observatory</div>
      <div class="rail-item active" data-view="graph">
        <span>Graph</span>
        <span class="count" id="rail-files">–</span>
      </div>
      <div class="rail-item" data-view="search">
        <span>Search</span>
        <span class="count">⌘K</span>
      </div>
      <div class="rail-item" data-view="files">
        <span>Files</span>
        <span class="count" id="rail-files2">–</span>
      </div>
    </div>
    <div class="rail-section">
      <div class="rail-label">Knowledge</div>
      <div class="rail-item" data-view="memories">
        <span>Memories</span>
        <span class="count" id="rail-mem">–</span>
      </div>
      <div class="rail-item" data-view="stats">
        <span>Stats</span>
        <span class="count"></span>
      </div>
    </div>
  </nav>

  <!-- ────────── MAIN STAGE ────────── -->
  <main class="stage">
    <!-- Graph View -->
    <div class="view active" id="graph-view">
      <svg id="graph-svg"></svg>
      <div class="graph-search">
        <input type="text" id="graph-filter" placeholder="filter nodes…" />
      </div>
      <div class="graph-controls">
        <div class="graph-chip on" id="graph-top100" onclick="graphLoadTop()">top 100</div>
        <div class="graph-chip" id="graph-showall" onclick="graphLoadAll()">show all</div>
        <div class="graph-slider-group">
          <label>min PR</label>
          <input type="range" id="graph-pr-slider" min="0" max="100" value="0" />
          <span class="slider-val" id="graph-pr-val">0.00</span>
        </div>
      </div>
      <div class="graph-legend" id="graph-legend"></div>
      <div class="graph-tooltip" id="graph-tooltip">
        <div class="tt-path"></div>
        <div class="tt-meta"></div>
      </div>
    </div>

    <!-- Search View -->
    <div class="view" id="search-view">
      <div class="search-header">
        <input class="search-input mono" id="search-input" placeholder="how does auth middleware work?" autocomplete="off" />
        <div class="search-meta">
          <span id="search-count">type to search</span>
          <span id="search-time"></span>
        </div>
      </div>
      <div class="search-results" id="search-results"></div>
    </div>

    <!-- Memories View -->
    <div class="view" id="memories-view">
      <div class="view-header">
        <div>
          <div class="view-title">memories</div>
        </div>
        <div style="display:flex;gap:16px;align-items:center;">
          <div style="display:flex;gap:0;font-family:'JetBrains Mono',monospace;font-size:11px;" id="mem-kind-filter">
            <div class="graph-chip on" data-kind="any" onclick="setMemKind('any')">all</div>
            <div class="graph-chip" data-kind="episodic" onclick="setMemKind('episodic')">episodic</div>
            <div class="graph-chip" data-kind="semantic" onclick="setMemKind('semantic')">semantic</div>
            <div class="graph-chip" data-kind="procedural" onclick="setMemKind('procedural')">procedural</div>
          </div>
          <div style="display:flex;gap:0;font-family:'JetBrains Mono',monospace;font-size:11px;">
            <div class="graph-chip on" id="mem-view-list" onclick="switchMemView('list')">list</div>
            <div class="graph-chip" id="mem-view-timeline" onclick="switchMemView('timeline')">timeline</div>
          </div>
          <div class="view-subtitle" id="mem-stats"></div>
        </div>
      </div>
      <div class="memories-list" id="memories-list"></div>
    </div>

    <!-- Files View -->
    <div class="view" id="files-view">
      <div class="view-header">
        <div class="view-title">files</div>
        <div class="view-subtitle" id="files-stats"></div>
      </div>
      <div class="files-list" id="files-list"></div>
    </div>

    <!-- Stats View -->
    <div class="view" id="stats-view">
      <div class="hero-stat">
        <div class="hero-stat-num" id="hero-num">–</div>
        <div class="hero-stat-label mono" id="hero-label">files indexed</div>
        <div class="hero-stat-desc">Your codebase, parsed into structural chunks, ranked by dependency importance, and embedded locally with all-MiniLM-L6-v2.</div>
      </div>
      <div class="mini-stats" id="mini-stats"></div>
    </div>
  </main>

  <!-- ────────── RIGHT INSPECTOR ────────── -->
  <aside class="inspector" id="inspector">
    <div class="inspector-empty">click a node or file to inspect</div>
  </aside>

  <!-- ────────── FOOTER STATUS ────────── -->
  <footer class="status">
    <div class="item"><span class="dot"></span><span id="st-status">ready</span></div>
    <div class="item"><span class="k">files</span> <span class="v" id="st-files">–</span></div>
    <div class="item"><span class="k">chunks</span> <span class="v" id="st-chunks">–</span></div>
    <div class="item"><span class="k">memories</span> <span class="v" id="st-mem">–</span></div>
    <div class="spacer"></div>
    <div class="item"><span class="v">sverklo</span> <span class="k" id="st-version">–</span></div>
  </footer>
</div>

<!-- CMDK Palette -->
<div class="cmdk-overlay" id="cmdk">
  <div class="cmdk-box">
    <input class="cmdk-input" id="cmdk-input" placeholder="search files, memories, or run a command…" autocomplete="off" />
    <div class="cmdk-list" id="cmdk-list"></div>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
// ────────── STATE ──────────
let state = {
  status: null,
  stats: null,
  files: [],
  memories: [],
  graphData: null,
  currentView: 'graph',
};

// ────────── API ──────────
async function api(path) {
  const r = await fetch(path);
  return r.json();
}

// ────────── INIT ──────────
async function init() {
  state.status = await api('/api/status');
  state.stats = await api('/api/stats');

  document.getElementById('bc-project').textContent = state.status.projectName;
  document.getElementById('bc-branch').textContent = 'main'; // TODO: actual branch
  document.getElementById('bc-indexed').textContent = state.status.lastIndexedAt
    ? 'indexed ' + formatAge(state.status.lastIndexedAt)
    : 'not indexed';

  document.getElementById('rail-files').textContent = state.stats.fileCount;
  document.getElementById('rail-files2').textContent = state.stats.fileCount;
  document.getElementById('rail-mem').textContent = state.stats.staleCount
    ? state.stats.memoryCount + ' · ' + state.stats.staleCount + ' stale'
    : state.stats.memoryCount;

  document.getElementById('st-files').textContent = state.stats.fileCount;
  document.getElementById('st-chunks').textContent = state.stats.chunkCount;
  document.getElementById('st-mem').textContent = state.stats.memoryCount;
  // Version comes from the server (reads package.json at module load)
  // so the dashboard footer always matches the running binary.
  if (state.status.version) {
    document.getElementById('st-version').textContent = 'v' + state.status.version;
  }

  renderInspectorToday();
  renderStats();

  // Load graph (D3 force-directed)
  await graphLoadTop();

  // Rail navigation
  document.querySelectorAll('.rail-item').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });

  // Search
  document.getElementById('search-input').addEventListener('input', debounce(doSearch, 150));

  // Graph filter
  document.getElementById('graph-filter').addEventListener('input', (e) => {
    state.graphFilter = e.target.value.toLowerCase();
    graphApplyFilter();
  });

  // PageRank slider
  document.getElementById('graph-pr-slider').addEventListener('input', (e) => {
    graphApplyFilter();
  });

  // Cmdk
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCmdk();
    } else if (e.key === 'Escape') {
      closeCmdk();
    }
  });
  document.getElementById('cmdk-input').addEventListener('input', (e) => runCmdk(e.target.value));

  // Resize handled by D3 (SVG scales with container)
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.rail-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === view + '-view'));

  if (view === 'graph' && !state.graphData) graphLoadTop();
  if (view === 'files') renderFiles();
  if (view === 'memories') renderMemories();
  if (view === 'search') document.getElementById('search-input').focus();
  if (view === 'stats') renderStats();
}

// ────────── GRAPH (D3 force-directed) ──────────
let graphSim = null;
let graphSvgGroup = null;
let graphZoom = null;
let graphNodeSel = null;
let graphLinkSel = null;
let graphSelectedNode = null;
let graphIsShowAll = false;

async function graphLoadTop() {
  document.getElementById('graph-top100').classList.add('on');
  document.getElementById('graph-showall').classList.remove('on');
  graphIsShowAll = false;
  state.graphData = await api('/api/graph?limit=100');
  initD3Graph();
}

async function graphLoadAll() {
  document.getElementById('graph-showall').classList.add('on');
  document.getElementById('graph-top100').classList.remove('on');
  graphIsShowAll = true;
  state.graphData = await api('/api/graph?limit=0');
  initD3Graph();
}

function nodeRadius(d) {
  // Scale pagerank to 4-24px radius
  const pr = d.pagerank || 0;
  const maxPR = state.graphData ? Math.max(...state.graphData.nodes.map(n => n.pagerank || 0), 0.001) : 1;
  return 4 + (pr / maxPR) * 20;
}

function edgeOpacity(d) {
  if (!state.graphData) return 0.15;
  const maxW = Math.max(...state.graphData.edges.map(e => e.weight || 1), 1);
  return 0.08 + (d.weight / maxW) * 0.5;
}

function initD3Graph() {
  const container = document.getElementById('graph-view');
  const svg = d3.select('#graph-svg');
  svg.selectAll('*').remove();
  if (graphSim) { graphSim.stop(); graphSim = null; }

  const w = container.clientWidth;
  const h = container.clientHeight;
  svg.attr('width', w).attr('height', h).attr('viewBox', [0, 0, w, h]);

  if (!state.graphData || !state.graphData.nodes.length) return;

  // Build node map for edge resolution (edges use numeric IDs)
  const nodeById = new Map(state.graphData.nodes.map(n => [n.id, n]));
  const nodes = state.graphData.nodes.map(n => ({ ...n }));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const links = state.graphData.edges
    .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map(e => ({ source: e.source, target: e.target, weight: e.weight }));

  // Set up zoom
  graphZoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', (event) => {
      graphSvgGroup.attr('transform', event.transform);
    });
  svg.call(graphZoom);

  graphSvgGroup = svg.append('g');

  // Links
  graphLinkSel = graphSvgGroup.append('g').attr('class', 'links')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'link')
    .attr('stroke-opacity', d => edgeOpacity(d))
    .attr('stroke-width', d => Math.max(0.5, Math.min(3, d.weight * 0.5)));

  // Nodes
  graphNodeSel = graphSvgGroup.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(nodes, d => d.id)
    .join('g')
    .attr('class', d => {
      let cls = 'node';
      if ((d.pagerank || 0) > 0.3) cls += ' label-visible';
      return cls;
    })
    .call(d3.drag()
      .on('start', dragStart)
      .on('drag', dragging)
      .on('end', dragEnd));

  graphNodeSel.append('circle')
    .attr('r', d => nodeRadius(d))
    .attr('fill', d => getLangColor(d.language));

  graphNodeSel.append('text')
    .attr('class', 'node-label')
    .attr('dx', d => nodeRadius(d) + 4)
    .attr('dy', 3)
    .text(d => d.path.split('/').pop());

  // Hover
  const tooltip = document.getElementById('graph-tooltip');
  graphNodeSel
    .on('mouseover', function(event, d) {
      d3.select(this).raise();
      // Highlight connected edges
      graphLinkSel
        .classed('highlighted', l => l.source.id === d.id || l.target.id === d.id)
        .attr('stroke-opacity', l => (l.source.id === d.id || l.target.id === d.id) ? 0.9 : edgeOpacity(l));
      // Tooltip
      tooltip.style.display = 'block';
      tooltip.querySelector('.tt-path').textContent = d.path;
      tooltip.querySelector('.tt-meta').textContent =
        (d.language || 'unknown') + ' · PR ' + (d.pagerank || 0).toFixed(3) + ' · ' + formatBytes(d.size_bytes);
    })
    .on('mousemove', function(event) {
      tooltip.style.left = (event.offsetX + 16) + 'px';
      tooltip.style.top = (event.offsetY - 10) + 'px';
    })
    .on('mouseout', function() {
      graphLinkSel.classed('highlighted', false)
        .attr('stroke-opacity', d => edgeOpacity(d));
      tooltip.style.display = 'none';
    })
    .on('click', function(event, d) {
      event.stopPropagation();
      graphNodeSel.classed('selected', false);
      d3.select(this).classed('selected', true);
      graphSelectedNode = d;
      inspectFile(d.path);
    });

  // Click background to deselect
  svg.on('click', () => {
    graphNodeSel.classed('selected', false);
    graphSelectedNode = null;
  });

  // Force simulation
  graphSim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => 60 + 40 / Math.max(d.weight, 1)))
    .force('charge', d3.forceManyBody().strength(-100))
    .force('center', d3.forceCenter(w / 2, h / 2))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 2))
    .alphaDecay(0.03)
    .on('tick', () => {
      graphLinkSel
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
      graphNodeSel.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    });

  // Render legend
  renderGraphLegend();

  // Update slider max
  const maxPR = Math.max(...nodes.map(n => n.pagerank || 0), 0.01);
  const slider = document.getElementById('graph-pr-slider');
  slider.max = 100;
  slider.value = 0;
  document.getElementById('graph-pr-val').textContent = '0.00';
}

function dragStart(event, d) {
  if (!event.active) graphSim.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}
function dragging(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}
function dragEnd(event, d) {
  if (!event.active) graphSim.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

function graphApplyFilter() {
  if (!graphNodeSel || !graphLinkSel) return;
  const textFilter = (state.graphFilter || '').toLowerCase();
  const slider = document.getElementById('graph-pr-slider');
  const maxPR = state.graphData ? Math.max(...state.graphData.nodes.map(n => n.pagerank || 0), 0.01) : 1;
  const minPR = (parseInt(slider.value) / 100) * maxPR;
  document.getElementById('graph-pr-val').textContent = minPR.toFixed(2);

  graphNodeSel.each(function(d) {
    const textMatch = !textFilter || d.path.toLowerCase().includes(textFilter);
    const prMatch = (d.pagerank || 0) >= minPR;
    const visible = textMatch && prMatch;
    d._visible = visible;
    d3.select(this).style('opacity', visible ? 1 : 0.08);
  });

  graphLinkSel.style('opacity', function(d) {
    const srcVis = d.source._visible !== false;
    const tgtVis = d.target._visible !== false;
    return (srcVis && tgtVis) ? edgeOpacity(d) : 0.02;
  });
}

function renderGraphLegend() {
  if (!state.graphData) return;
  const langs = new Map();
  for (const n of state.graphData.nodes) {
    if (n.language && !langs.has(n.language)) {
      langs.set(n.language, getLangColor(n.language));
    }
  }
  const el = document.getElementById('graph-legend');
  el.innerHTML = Array.from(langs.entries()).map(([lang, color]) =>
    '<div class="graph-legend-item"><div class="graph-legend-dot" style="background:' + color + '"></div><span>' + lang + '</span></div>'
  ).join('') +
  '<div class="graph-legend-item" style="margin-top:4px;color:var(--text-3);font-size:9px;">' +
    (state.graphData.total || state.graphData.nodes.length) + ' total files' +
    (state.graphData.nodes.length < (state.graphData.total || 0) ? ' · showing top ' + state.graphData.nodes.length : '') +
  '</div>';
}

function getLangColor(lang) {
  const map = {
    typescript: '#5BA3F5',
    javascript: '#D4A535',
    python: '#8FB339',
    go: '#22D3EE',
    rust: '#E5484D',
    java: '#F97316',
    c: '#A1A1AA',
    cpp: '#A1A1AA',
    ruby: '#C084FC',
    php: '#C084FC',
  };
  return map[lang] || '#6B6354';
}

// ────────── FILES ──────────
async function renderFiles() {
  if (state.files.length === 0) {
    state.files = await api('/api/overview');
  }
  document.getElementById('files-stats').textContent = state.files.length + ' files';
  const html = state.files.map(f => {
    const barWidth = Math.max(1, Math.round((f.pagerank || 0) * 60));
    return '<div class="file-row" onclick="inspectFile(\\'' + f.path.replace(/'/g, "\\\\'") + '\\')"><div class="path">' + esc(f.path) + '</div><div class="lang">' + (f.language || '') + '</div><div class="pr"><span class="pr-bar" style="width:' + barWidth + 'px"></span>' + (f.pagerank || 0).toFixed(2) + '</div><div class="chunks">' + (f.chunks?.length || 0) + '</div></div>';
  }).join('');
  document.getElementById('files-list').innerHTML = html;
}

// ────────── MEMORIES ──────────
let memViewMode = 'list';
let memKindFilter = 'any';

function switchMemView(mode) {
  memViewMode = mode;
  document.getElementById('mem-view-list').classList.toggle('on', mode === 'list');
  document.getElementById('mem-view-timeline').classList.toggle('on', mode === 'timeline');
  state.memories = []; // force reload
  state.memTimeline = null;
  renderMemories();
}

function setMemKind(kind) {
  memKindFilter = kind;
  document.querySelectorAll('#mem-kind-filter .graph-chip').forEach(el => {
    el.classList.toggle('on', el.getAttribute('data-kind') === kind);
  });
  renderMemories();
}

async function renderMemories() {
  if (memViewMode === 'timeline') {
    return renderMemoryTimeline();
  }
  if (state.memories.length === 0) {
    state.memories = await api('/api/memories');
  }
  const all = state.memories;

  // Hide kind-filter chips that match zero rows — the alternative
  // (always show all 4 chips) is misleading when the user clicks
  // 'semantic' on a fresh install and sees an empty list.
  const kindCounts = { episodic: 0, semantic: 0, procedural: 0 };
  for (const m of all) {
    const k = m.kind || 'episodic';
    if (kindCounts[k] !== undefined) kindCounts[k]++;
  }
  document.querySelectorAll('#mem-kind-filter .graph-chip').forEach(el => {
    const k = el.getAttribute('data-kind');
    if (k && k !== 'any') {
      el.style.display = kindCounts[k] > 0 ? '' : 'none';
    }
  });

  const filtered = memKindFilter === 'any'
    ? all
    : all.filter(m => (m.kind || 'episodic') === memKindFilter);
  const total = filtered.length;
  const stale = filtered.filter(m => m.is_stale).length;
  const kindLabel = memKindFilter === 'any' ? '' : ' · ' + memKindFilter;
  document.getElementById('mem-stats').textContent = total + ' memories · ' + stale + ' stale' + kindLabel;

  if (total === 0) {
    document.getElementById('memories-list').innerHTML =
      '<div style="padding: 32px; font-family: \\'JetBrains Mono\\', monospace; font-size: 13px; color: var(--text-2); line-height: 1.8;">' +
      '<div class="inspector-title" style="margin-bottom: 16px;">no memories yet</div>' +
      '<div style="margin-bottom: 24px;">Ask your AI agent to remember something:</div>' +
      '<div style="padding: 16px; background: var(--bg-2); border: 1px solid var(--rule); color: var(--text);">' +
      '<span style="color: var(--accent);">&gt;</span> "remember we use Prisma for the ORM because of TypeScript types"' +
      '</div>' +
      '<div style="margin-top: 16px; color: var(--text-3);">' +
      'Claude will call sverklo_remember with the content, category, and current git state.<br>' +
      'Later, asking "what did we decide about the ORM?" triggers sverklo_recall.' +
      '</div>' +
      '<div class="inspector-title" style="margin-top: 32px; margin-bottom: 12px;">memory categories</div>' +
      '<div style="display: grid; grid-template-columns: 80px 1fr; gap: 8px 16px;">' +
      '<div style="color: var(--accent);">decision</div><div>architectural choices with trade-offs</div>' +
      '<div style="color: var(--accent);">preference</div><div>coding conventions, style choices</div>' +
      '<div style="color: var(--accent);">pattern</div><div>reusable approaches to common problems</div>' +
      '<div style="color: var(--accent);">context</div><div>background info about the project</div>' +
      '<div style="color: var(--accent);">todo</div><div>reminders for future work</div>' +
      '</div>' +
      '</div>';
    return;
  }

  const html = filtered.map(m => {
    const tags = (m.tags || []).map(t => '<span style="color:var(--text-3);margin-right:4px;">#' + esc(t) + '</span>').join('');
    const git = m.git_sha ? '<div class="git">' + esc(m.git_branch || '?') + '@' + m.git_sha.slice(0,7) + '</div>' : '';
    const kind = m.kind || 'episodic';
    const kindChip = '<span style="color:var(--text-3);font-size:10px;border:1px solid var(--rule);padding:1px 6px;margin-left:6px;">' + esc(kind) + '</span>';
    return '<div class="memory' + (m.is_stale ? ' stale' : '') + '"><div class="memory-meta"><div class="cat">' + m.category + kindChip + '</div><div>' + formatAge(m.created_at) + ' ago</div>' + git + '</div><div class="memory-content">' + esc(m.content) + '<div style="margin-top:6px;font-size:11px;">' + tags + '</div></div><div class="memory-stats">conf ' + m.confidence + '<br>used ' + m.access_count + 'x</div></div>';
  }).join('');
  document.getElementById('memories-list').innerHTML = html;
}

async function renderMemoryTimeline() {
  if (!state.memTimeline) {
    state.memTimeline = await api('/api/memories/timeline');
  }
  const all = state.memTimeline || [];
  const total = all.length;
  const active = all.filter(m => !m.invalidated).length;
  const invalidated = all.filter(m => m.invalidated).length;
  document.getElementById('mem-stats').textContent = active + ' active · ' + invalidated + ' superseded · ' + total + ' total';

  if (total === 0) {
    document.getElementById('memories-list').innerHTML = '<div style="padding:32px;font-family:\\'JetBrains Mono\\',monospace;font-size:13px;color:var(--text-2);">no memories yet</div>';
    return;
  }

  // Group by git SHA for the timeline gutter
  const bySha = new Map();
  for (const m of all) {
    const key = m.git_sha || 'no-sha';
    if (!bySha.has(key)) bySha.set(key, []);
    bySha.get(key).push(m);
  }

  const shaOrder = Array.from(bySha.keys()).sort((a, b) => {
    const aTime = Math.max(...bySha.get(a).map(m => m.created_at));
    const bTime = Math.max(...bySha.get(b).map(m => m.created_at));
    return bTime - aTime;
  });

  const html = shaOrder.map(sha => {
    const mems = bySha.get(sha);
    const first = mems[0];
    const shaLabel = sha === 'no-sha' ? '(no git)' : (first.git_branch || '?') + '@' + sha.slice(0, 7);
    const whenLabel = formatAge(first.created_at);

    const memsHtml = mems.map(m => {
      const tags = (m.tags || []).map(t => '<span style="color:var(--text-3);margin-right:4px;">#' + esc(t) + '</span>').join('');
      const invalidClass = m.invalidated ? ' style="opacity:0.45;text-decoration:line-through;"' : '';
      const superseded = m.superseded_by ? '<div style="font-size:10px;color:var(--warn);margin-top:2px;">→ superseded by #' + m.superseded_by + '</div>' : '';
      const tierBadge = m.tier === 'core' ? '<span style="font-size:10px;padding:1px 6px;background:var(--accent);color:var(--bg);margin-left:6px;">CORE</span>' : '';
      return '<div' + invalidClass + ' style="margin:8px 0 8px 120px;padding:12px 16px;background:var(--bg-2);border-left:2px solid var(--accent);"><div style="font-family:\\'JetBrains Mono\\',monospace;font-size:11px;color:var(--accent);margin-bottom:4px;">[' + m.category + '] #' + m.id + tierBadge + '</div><div style="font-size:13px;color:var(--text);">' + esc(m.content) + '</div>' + superseded + '<div style="font-size:11px;color:var(--text-3);margin-top:6px;">' + tags + ' · conf ' + m.confidence + ' · used ' + m.access_count + 'x</div></div>';
    }).join('');

    return '<div style="position:relative;border-bottom:1px solid var(--rule);padding:20px 32px;"><div style="position:absolute;left:32px;top:20px;width:80px;font-family:\\'JetBrains Mono\\',monospace;font-size:11px;color:var(--ok);">' + esc(shaLabel) + '<div style="color:var(--text-3);margin-top:2px;">' + whenLabel + ' ago</div></div>' + memsHtml + '</div>';
  }).join('');

  document.getElementById('memories-list').innerHTML = html;
}

// ────────── STATS ──────────
function renderStats() {
  if (!state.stats) return;
  document.getElementById('hero-num').textContent = state.stats.chunkCount.toLocaleString();
  document.getElementById('hero-label').textContent = 'code chunks indexed';

  const langTotal = Object.values(state.stats.languages).reduce((a, b) => a + b, 0) || 1;
  const langList = Object.entries(state.stats.languages).sort((a, b) => b[1] - a[1]);

  const langHtml = '<div class="lang-bars">' + langList.map(([lang, count]) => {
    return '<div class="lang-bar" style="width:' + (count/langTotal*100) + '%; background:' + getLangColor(lang) + '"></div>';
  }).join('') + '</div>';

  const langLegend = langList.slice(0, 6).map(([lang, count]) =>
    '<span style="margin-right:12px;color:var(--text-3);"><span style="display:inline-block;width:6px;height:6px;background:' + getLangColor(lang) + ';margin-right:4px;"></span>' + lang + ' ' + count + '</span>'
  ).join('');

  document.getElementById('mini-stats').innerHTML = [
    '<div class="mini-stat"><div class="mini-stat-label">files</div><div class="mini-stat-value">' + state.stats.fileCount + '</div><div class="mini-stat-sub">' + Object.keys(state.stats.languages).length + ' languages</div></div>',
    '<div class="mini-stat"><div class="mini-stat-label">memories</div><div class="mini-stat-value">' + state.stats.memoryCount + '</div><div class="mini-stat-sub">' + state.stats.staleCount + ' stale</div></div>',
    '<div class="mini-stat"><div class="mini-stat-label">avg chunks/file</div><div class="mini-stat-value">' + (state.stats.fileCount ? (state.stats.chunkCount/state.stats.fileCount).toFixed(1) : '0') + '</div><div class="mini-stat-sub">parsing density</div></div>',
    '<div class="mini-stat" style="grid-column:1/-1"><div class="mini-stat-label">language breakdown</div>' + langHtml + '<div style="margin-top:12px;font-family:JetBrains Mono,monospace;font-size:11px;">' + langLegend + '</div></div>',
  ].join('');
}

// ────────── SEARCH ──────────
async function doSearch(ev) {
  const q = (ev?.target?.value || document.getElementById('search-input').value).trim();
  if (!q) {
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-count').textContent = 'type to search';
    document.getElementById('search-time').textContent = '';
    return;
  }
  const start = Date.now();
  const results = await api('/api/search?q=' + encodeURIComponent(q));
  const elapsed = Date.now() - start;
  document.getElementById('search-count').textContent = results.length + ' results';
  document.getElementById('search-time').textContent = elapsed + 'ms';

  document.getElementById('search-results').innerHTML = results.map(r => {
    return '<div class="result"><div class="result-head"><span class="result-path">' + esc(r.file) + ':' + r.startLine + '</span><span class="result-meta"><span class="result-type">' + esc(r.type) + (r.name ? ' ' + esc(r.name) : '') + '</span><span>' + r.score.toFixed(3) + '</span></span></div><pre class="result-code">' + esc(r.content) + '</pre></div>';
  }).join('') || '<div class="inspector-empty" style="padding:32px 0;">no results</div>';
}

// ────────── INSPECT ──────────
async function inspectFile(path) {
  const data = await api('/api/file?path=' + encodeURIComponent(path));
  if (data.error) return;

  const chunks = data.chunks.map(c => {
    return '<div class="inspector-chunk"><span class="type">' + esc(c.type) + '</span> ' + esc(c.name || '') + '<span class="line">' + c.start_line + '</span></div>';
  }).join('');

  const imports = data.imports.filter(i => i.path).map(i => '<span class="inspector-pill">' + esc(i.path.split('/').pop()) + '</span>').join('');
  const importers = data.importers.filter(i => i.path).map(i => '<span class="inspector-pill">' + esc(i.path.split('/').pop()) + '</span>').join('');

  document.getElementById('inspector').innerHTML =
    '<div class="inspector-title">file</div>' +
    '<div class="inspector-value">' + esc(data.path) + '</div>' +
    '<div class="inspector-section">' +
      '<div class="inspector-row"><span class="k">language</span><span class="v">' + esc(data.language || '-') + '</span></div>' +
      '<div class="inspector-row"><span class="k">pagerank</span><span class="v">' + (data.pagerank || 0).toFixed(3) + '</span></div>' +
      '<div class="inspector-row"><span class="k">size</span><span class="v">' + formatBytes(data.size_bytes) + '</span></div>' +
      '<div class="inspector-row"><span class="k">chunks</span><span class="v">' + data.chunks.length + '</span></div>' +
    '</div>' +
    (chunks ? '<div class="inspector-section"><div class="inspector-title">symbols</div>' + chunks + '</div>' : '') +
    (imports ? '<div class="inspector-section"><div class="inspector-title">imports</div>' + imports + '</div>' : '') +
    (importers ? '<div class="inspector-section"><div class="inspector-title">importers</div>' + importers + '</div>' : '');
}

function renderInspectorToday() {
  document.getElementById('inspector').innerHTML =
    '<div class="inspector-title">today</div>' +
    '<div class="inspector-value mono" style="font-size:12px;color:var(--text-2);">' + state.status.projectName + '</div>' +
    '<div class="inspector-section">' +
      '<div class="inspector-row"><span class="k">files</span><span class="v">' + state.stats.fileCount + '</span></div>' +
      '<div class="inspector-row"><span class="k">chunks</span><span class="v">' + state.stats.chunkCount + '</span></div>' +
      '<div class="inspector-row"><span class="k">memories</span><span class="v">' + state.stats.memoryCount + '</span></div>' +
      '<div class="inspector-row"><span class="k">languages</span><span class="v">' + Object.keys(state.stats.languages).length + '</span></div>' +
    '</div>' +
    '<div class="inspector-title">hint</div>' +
    '<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:var(--text-3);line-height:1.6;">click a node in the graph to inspect<br>press <span style="color:var(--accent)">⌘K</span> to search anything<br>type in search box for semantic results</div>';
}

// ────────── CMDK ──────────
let cmdkItems = [];
let cmdkSelected = 0;

function openCmdk() {
  document.getElementById('cmdk').classList.add('open');
  document.getElementById('cmdk-input').value = '';
  document.getElementById('cmdk-input').focus();
  runCmdk('');
}
function closeCmdk() {
  document.getElementById('cmdk').classList.remove('open');
}

async function runCmdk(q) {
  q = q.toLowerCase();
  cmdkItems = [];

  // Commands
  const cmds = [
    { label: 'open graph', action: () => { switchView('graph'); closeCmdk(); }, kind: 'view' },
    { label: 'open search', action: () => { switchView('search'); closeCmdk(); }, kind: 'view' },
    { label: 'open files', action: () => { switchView('files'); closeCmdk(); }, kind: 'view' },
    { label: 'open memories', action: () => { switchView('memories'); closeCmdk(); }, kind: 'view' },
    { label: 'open stats', action: () => { switchView('stats'); closeCmdk(); }, kind: 'view' },
  ];
  for (const c of cmds) {
    if (!q || c.label.includes(q)) cmdkItems.push(c);
  }

  // Files
  if (q && state.files.length === 0) {
    state.files = await api('/api/overview');
  }
  for (const f of state.files.slice(0, 200)) {
    if (q && f.path.toLowerCase().includes(q)) {
      cmdkItems.push({
        label: f.path,
        action: () => { inspectFile(f.path); closeCmdk(); },
        kind: 'file',
      });
      if (cmdkItems.length > 20) break;
    }
  }

  cmdkSelected = 0;
  renderCmdk();
}

function renderCmdk() {
  document.getElementById('cmdk-list').innerHTML = cmdkItems.slice(0, 20).map((item, i) => {
    return '<div class="cmdk-item ' + (i === cmdkSelected ? 'selected' : '') + '" onclick="cmdkItems[' + i + '].action()"><span>' + esc(item.label) + '</span><span class="kind">' + item.kind + '</span></div>';
  }).join('');
}

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('cmdk').classList.contains('open')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSelected = Math.min(cmdkSelected+1, cmdkItems.length-1); renderCmdk(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSelected = Math.max(cmdkSelected-1, 0); renderCmdk(); }
  if (e.key === 'Enter' && cmdkItems[cmdkSelected]) { cmdkItems[cmdkSelected].action(); }
});

// ────────── HELPERS ──────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function formatAge(ts) {
  if (!ts) return 'unknown';
  const ms = Date.now() - ts;
  const m = Math.floor(ms/60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m/60);
  if (h < 24) return h + 'h';
  return Math.floor(h/24) + 'd';
}
function formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

init();
</script>
</body>
</html>`;
}
