/**
 * Generate a self-contained HTML audit report from markdown output.
 * Dark theme matching sverklo.com branding. Google Fonts for typography.
 */

export function generateAuditHtml(
  markdownContent: string,
  projectName: string,
  projectPath: string
): string {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  // Clean up project name (prefer basename of projectPath with known temp
  // prefixes like "report-", "regen-", "rpt-", "final-", "v12-", "bench-"
  // stripped). This prevents leaking benchmark scratch directory names into
  // published reports.
  const displayName = cleanProjectName(projectName, projectPath);
  const sourceLink = deriveSourceLink(projectName, projectPath);

  // Parse structured data from the markdown
  const parsed = parseAuditMarkdown(markdownContent);

  // Build dimension cards
  const dimensionCardsHtml = parsed.dimensions
    .map(
      (d) => `
      <div class="dim-card">
        <div class="dim-grade" style="color:${gradeColor(d.grade)};border-color:${gradeColor(d.grade)}">${esc(d.grade)}</div>
        <div class="dim-name">${esc(d.name)}</div>
        <div class="dim-detail">${esc(d.detail)}</div>
      </div>`
    )
    .join("\n");

  // Build section cards
  const sectionCardsHtml = parsed.sections
    .map(
      (s) => `
    <div class="card">
      <h2>${inline(s.title)}</h2>
      <div class="card-body">${sectionBodyToHtml(s.body)}</div>
    </div>`
    )
    .join("\n");

  // Badge markdown (extracted from last section if present)
  const badgeSection = parsed.badgeMarkdown;

  const canonicalPath = displayName.toLowerCase();
  const canonicalUrl = `https://sverklo.com/report/${canonicalPath}/`;
  const seoTitle = `Sverklo Audit — ${displayName} — Grade ${parsed.overallGrade}`;
  const seoDescription = `Sverklo code-intelligence audit of ${displayName}. Overall grade ${parsed.overallGrade}. Dead code, circular dependencies, coupling, and security analysis with reproducer.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sverklo Audit — ${esc(displayName)}</title>
<meta name="description" content="${esc(seoDescription)}">
<link rel="canonical" href="${esc(canonicalUrl)}">
<meta property="og:title" content="${esc(seoTitle)}">
<meta property="og:description" content="${esc(seoDescription)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(canonicalUrl)}">
<meta property="og:site_name" content="Sverklo">
<meta property="og:image" content="https://sverklo.com/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(seoTitle)}">
<meta name="twitter:description" content="${esc(seoDescription)}">
<meta name="twitter:image" content="https://sverklo.com/og.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0E0D0B;
    --surface: #16140F;
    --border: #2A2620;
    --text: #EDE7D9;
    --muted: #A39886;
    --accent: #E85A2A;
    --grade-a: #4c1;
    --grade-b: #97ca00;
    --grade-c: #dfb317;
    --grade-d: #fe7d37;
    --grade-f: #e05d44;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 15px;
    line-height: 1.65;
    min-height: 100vh;
  }

  /* Subtle grid background */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(rgba(237,231,217,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(237,231,217,0.02) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
    z-index: 0;
  }

  .wrapper {
    position: relative;
    z-index: 1;
    max-width: 960px;
    margin: 0 auto;
    padding: 48px 24px 64px;
  }

  /* ── Top bar (site-standard header) ── */
  header.top {
    border-bottom: 1px solid var(--border);
    padding: 16px 0;
    position: sticky;
    top: 0;
    background: rgba(14, 13, 11, 0.92);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 100;
  }
  header.top .wrap {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    font-family: 'JetBrains Mono', monospace;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text);
    text-decoration: none;
    border: none;
  }
  .brand::before {
    content: "\\25CC ";
    color: var(--accent);
  }
  .top-nav {
    display: flex;
    gap: 24px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
  }
  .top-nav a {
    color: var(--muted);
    text-decoration: none;
    border: none;
  }
  .top-nav a:hover { color: var(--text); }

  /* ── Header ── */
  .header {
    text-align: center;
    margin-bottom: 48px;
  }
  .header .logo {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 24px;
  }
  .header .meta {
    color: var(--muted);
    font-size: 13px;
    margin-top: 16px;
    line-height: 1.6;
  }
  .header .meta .project-name {
    color: var(--text);
    font-weight: 600;
    font-size: inherit;
    margin: 0;
    display: inline;
  }
  /* a11y: focus ring for keyboard nav */
  a:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* ── Overall grade circle ── */
  .grade-ring {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 12px;
    position: relative;
  }
  .grade-ring::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid;
    border-color: inherit;
    opacity: 0.3;
  }
  .grade-ring::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid;
    border-color: inherit;
    clip-path: polygon(0 0, 100% 0, 100% 50%, 0 50%);
  }
  .grade-letter {
    font-family: 'JetBrains Mono', monospace;
    font-size: 72px;
    font-weight: 600;
    line-height: 1;
  }
  .grade-label {
    font-size: 13px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ── Dimension cards ── */
  .dimensions {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin: 40px 0 48px;
  }
  .dim-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 16px;
    text-align: center;
  }
  .dim-grade {
    font-family: 'JetBrains Mono', monospace;
    font-size: 32px;
    font-weight: 600;
    width: 52px;
    height: 52px;
    line-height: 48px;
    border: 2px solid;
    border-radius: 50%;
    margin: 0 auto 10px;
  }
  .dim-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 4px;
    text-transform: capitalize;
  }
  .dim-detail {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.4;
  }

  /* ── Section cards ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px 28px 24px;
    margin-bottom: 20px;
  }
  .card h2 {
    font-family: 'Public Sans', sans-serif;
    font-size: 17px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .card-body p {
    margin: 6px 0;
    color: var(--text);
  }
  .card-body ul {
    list-style: none;
    margin: 8px 0;
    padding: 0;
  }
  .card-body ul li {
    padding: 6px 0;
    border-bottom: 1px solid rgba(42,38,32,0.5);
    font-size: 14px;
  }
  .card-body ul li:last-child {
    border-bottom: none;
  }
  .card-body ul li::before {
    content: "\\203A";
    color: var(--accent);
    margin-right: 8px;
    font-weight: 600;
  }
  .card-body ol {
    margin: 8px 0 8px 20px;
    color: var(--text);
  }
  .card-body ol li {
    padding: 4px 0;
    font-size: 14px;
  }
  .card-body h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    margin: 16px 0 8px;
  }

  /* Inline formatting */
  strong { color: var(--text); font-weight: 600; }
  em { color: var(--muted); font-style: italic; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: 'JetBrains Mono', monospace;
    background: rgba(232,90,42,0.08);
    color: var(--accent);
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 13px;
  }
  pre {
    font-family: 'JetBrains Mono', monospace;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    font-size: 13px;
    line-height: 1.5;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }
  th {
    text-align: left;
    padding: 10px 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(42,38,32,0.4);
    color: var(--text);
  }
  tr:hover td { background: rgba(42,38,32,0.3); }

  /* ── Badge section ── */
  .badge-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 28px;
    margin-bottom: 20px;
    text-align: center;
  }
  .badge-section p {
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 12px;
  }
  .badge-section code {
    display: block;
    text-align: left;
    padding: 12px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 12px;
    word-break: break-all;
    color: var(--text);
    margin-top: 8px;
  }

  /* ── Footer ── */
  .footer {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }
  .footer a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }
  .footer a:hover { text-decoration: underline; }
  .footer .install {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--muted);
    margin-top: 8px;
  }

  /* ── Responsive ── */
  @media (max-width: 700px) {
    .wrapper { padding: 32px 16px 48px; }
    .dimensions { grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .grade-ring { width: 110px; height: 110px; }
    .grade-letter { font-size: 56px; }
    .card { padding: 20px 18px 18px; }
    .card h2 { font-size: 15px; }
  }
  @media (max-width: 400px) {
    .dimensions { grid-template-columns: 1fr 1fr; gap: 10px; }
    .dim-card { padding: 14px 10px; }
    .dim-grade { font-size: 24px; width: 42px; height: 42px; line-height: 38px; }
  }
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="https://sverklo.com/">sverklo</a>
    <nav class="top-nav">
      <a href="/report/">reports</a>
      <a href="/vs/">compare</a>
      <a href="/benchmarks/">benchmarks</a>
      <a href="/playground/">playground</a>
      <a href="/blog/">blog</a>
      <a href="https://github.com/sverklo/sverklo" target="_blank" rel="noopener">github</a>
    </nav>
  </div>
</header>
<main>
<div class="wrapper">

  <div class="header">
    <div class="logo">sverklo audit</div>
    <div class="grade-ring" style="color:${gradeColor(parsed.overallGrade)};border-color:${gradeColor(parsed.overallGrade)}">
      <span class="grade-letter" style="color:${gradeColor(parsed.overallGrade)}">${esc(parsed.overallGrade)}</span>
    </div>
    <div class="grade-label">Overall Health</div>
    <div class="meta">
      <h1 class="project-name">${esc(displayName)}</h1><br>
      ${sourceLink ? `<a href="${esc(sourceLink)}">${esc(sourceLink)}</a><br>` : ""}
      ${now}
    </div>
  </div>

  <div class="dimensions">
    ${dimensionCardsHtml}
  </div>

  ${sectionCardsHtml}

  ${badgeSection ? `<div class="badge-section"><p>Add this badge to your README:</p><code>${esc(badgeSection)}</code></div>` : ""}

  <div class="footer">
    Powered by <a href="https://sverklo.com">Sverklo</a> — local-first code intelligence<br>
    <div class="install">npm install -g sverklo</div>
  </div>

</div>
</main>
</body>
</html>`;
}

// ─── Helpers ───

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function gradeColor(grade: string): string {
  const map: Record<string, string> = {
    A: "#4c1",
    B: "#97ca00",
    C: "#dfb317",
    D: "#fe7d37",
    F: "#e05d44",
  };
  return map[grade] || "#A39886";
}

function inline(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// Known temp/scratch directory prefixes produced by benchmark scripts. These
// must not leak into published audit reports.
const TEMP_PREFIXES = [
  "report-",
  "regen-",
  "rpt-",
  "final-",
  "bench-",
  // versioned variants: v12-, v9-, v0.12-, etc.
];

export function cleanProjectName(projectName: string, projectPath: string): string {
  // Prefer basename of the absolute path; fall back to the provided name.
  const base = basename(projectPath) || projectName || "project";
  const stripped = stripTempPrefix(base);
  // Convert "expressjs_express" style separators used by benchmark scripts
  // into "expressjs/express".
  return stripped.replace(/_/g, "/");
}

export function deriveSourceLink(projectName: string, projectPath: string): string {
  const base = basename(projectPath) || projectName || "";
  const stripped = stripTempPrefix(base);
  // Must look like "owner_repo" to derive a GitHub URL.
  const parts = stripped.split("_");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `https://github.com/${parts[0]}/${parts[1]}`;
  }
  return "";
}

function stripTempPrefix(name: string): string {
  for (const prefix of TEMP_PREFIXES) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  // Strip "vN-" / "vN.N-" style version prefixes.
  const versioned = name.match(/^v\d+(?:\.\d+)?-(.+)$/);
  if (versioned) return versioned[1];
  return name;
}

function basename(p: string): string {
  if (!p) return "";
  // Strip trailing slashes, then return everything after the last "/".
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

// ─── Markdown parser ───

interface ParsedDimension {
  name: string;
  grade: string;
  detail: string;
}

interface ParsedSection {
  title: string;
  body: string;
}

interface ParsedAudit {
  overallGrade: string;
  dimensions: ParsedDimension[];
  sections: ParsedSection[];
  badgeMarkdown: string;
}

function parseAuditMarkdown(md: string): ParsedAudit {
  const lines = md.split("\n");
  let overallGrade = "?";
  const dimensions: ParsedDimension[] = [];
  const sections: ParsedSection[] = [];
  let badgeMarkdown = "";

  let i = 0;

  // Parse header: "# Sverklo Project Audit — Grade: X"
  while (i < lines.length) {
    const line = lines[i];
    const gradeMatch = line.match(/Grade:\s*([A-F])/);
    if (gradeMatch) {
      overallGrade = gradeMatch[1];
      i++;
      break;
    }
    i++;
  }

  // Parse dimension table. Skip blank lines between the grade heading and the
  // table; only stop once we've seen at least one table row and then hit a
  // non-table line (or a "## " section heading, which starts the next block).
  let sawTableRow = false;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      // A blank line after the table ends it; before the table, keep scanning.
      if (sawTableRow) break;
      i++;
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("# ")) break;
    // Skip table header/separator rows
    if (line.startsWith("| Dimension") || /^\|\s*-/.test(line)) {
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const cells = line.split("|").filter(Boolean).map((c) => c.trim());
      if (cells.length >= 3 && /^[A-F]$/.test(cells[1])) {
        dimensions.push({
          name: cells[0],
          grade: cells[1],
          detail: cells[2],
        });
        sawTableRow = true;
      }
      i++;
      continue;
    }
    // Non-table, non-blank, non-heading line — if we've seen rows, stop.
    if (sawTableRow) break;
    i++;
  }

  // Parse remaining sections (## headings)
  let currentTitle = "";
  let currentBody: string[] = [];

  function flushSection(): void {
    if (!currentTitle) return;
    const body = currentBody.join("\n").trim();
    // Check if this is the badge hint section
    if (body.includes("img.shields.io/badge/sverklo")) {
      const badgeMatch = body.match(/`(\[!\[Sverklo[^\]]*\]\([^)]+\)\]\([^)]+\))`/);
      if (badgeMatch) {
        badgeMarkdown = badgeMatch[1];
      }
      return; // Don't add as a regular section
    }
    if (body) {
      sections.push({ title: currentTitle, body });
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      flushSection();
      currentTitle = line.slice(3).trim();
      currentBody = [];
      i++;
      continue;
    }
    // Treat "---" as a section break, flush current
    if (line.trim() === "---") {
      flushSection();
      currentTitle = "";
      currentBody = [];
      i++;
      continue;
    }
    currentBody.push(line);
    i++;
  }
  flushSection();

  return { overallGrade, dimensions, sections, badgeMarkdown };
}

function sectionBodyToHtml(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let inList = false;
  let listType: "ul" | "ol" = "ul";
  let inTable = false;

  for (const line of lines) {
    // Sub-headings
    if (line.startsWith("### ")) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      if (inTable) { out.push("</table>"); inTable = false; }
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
      continue;
    }

    // Table rows
    if (line.startsWith("|")) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      if (line.replace(/[|\-\s]/g, "").length === 0) continue;
      const cells = line.split("|").filter(Boolean).map((c) => c.trim());
      if (!inTable) {
        out.push("<table><tr>");
        cells.forEach((c) => out.push(`<th>${inline(c)}</th>`));
        out.push("</tr>");
        inTable = true;
      } else {
        out.push("<tr>");
        cells.forEach((c) => out.push(`<td>${inline(c)}</td>`));
        out.push("</tr>");
      }
      continue;
    }
    if (inTable && !line.startsWith("|")) {
      out.push("</table>");
      inTable = false;
    }

    // Ordered list items (1. 2. etc)
    const olMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
    if (olMatch) {
      if (inList && listType !== "ol") { out.push(`</${listType}>`); inList = false; }
      if (!inList) { out.push("<ol>"); inList = true; listType = "ol"; }
      out.push(`<li>${inline(olMatch[2])}</li>`);
      continue;
    }

    // Unordered list items
    if (/^\s*[-·•]\s/.test(line)) {
      if (inList && listType !== "ul") { out.push(`</${listType}>`); inList = false; }
      if (!inList) { out.push("<ul>"); inList = true; listType = "ul"; }
      out.push(`<li>${inline(line.replace(/^\s*[-·•]\s/, ""))}</li>`);
      continue;
    }

    // Indented continuation line (code snippet after a list item)
    if (inList && /^\s{2,}/.test(line) && line.trim()) {
      // Append as sub-content in the last li
      out.push(`<li style="border-bottom:none;padding:0 0 0 16px;color:var(--muted);font-size:13px">${inline(line.trim())}</li>`);
      continue;
    }

    if (inList && line.trim() === "") {
      out.push(`</${listType}>`);
      inList = false;
      continue;
    }

    // Empty line
    if (line.trim() === "") continue;

    // Paragraph
    if (inList) { out.push(`</${listType}>`); inList = false; }
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inList) out.push(`</${listType}>`);
  if (inTable) out.push("</table>");

  return out.join("\n");
}
