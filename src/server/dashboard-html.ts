// Dashboard HTML shell. CSS and JS were extracted to
// src/server/assets/dashboard.css and dashboard.js by Tier 2.3 of the
// 2026-05-13 architectural review — the 1515-line template literal
// here was an untestable, unlintable, CSP-blocking blob. Splitting
// out the assets lets us:
//   1. Tighten Content-Security-Policy to drop 'unsafe-inline' on
//      script-src (the inline allowance was load-bearing for the
//      embedded JS).
//   2. Serve the assets with long cache headers (immutable).
//   3. Actually lint and unit-test the dashboard JS in a follow-up.
//
// The font-face block stays inline because the rules are tiny (~10
// lines) and inlining keeps the first paint flash-free for users
// who don't have JetBrains Mono / Public Sans locally. The CSS
// `style-src 'unsafe-inline'` allowance is still warranted by these
// font-face declarations and a handful of inline style attributes
// in the HTML body.

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
<link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>

<div id="error-banner" class="error-banner" hidden></div>

<div class="app">
  <!-- ────────── HEADER ────────── -->
  <header class="chrome">
    <div class="brand mono">sverklo<span class="brand-tag">local-first · no network calls</span></div>
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

<script src="/assets/d3.min.js"></script>
<script src="/assets/dashboard.js"></script>
</body>
</html>`;
}
