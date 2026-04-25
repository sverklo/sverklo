# MCP directory submissions — copy-paste cheat sheet

7 directories, all form-based. Each section below has the **exact text** to paste into each form field. Estimated total time with these pre-filled: **15–20 min**, vs. ~45 min if you write each one from scratch.

**Open these in 7 browser tabs, work top-to-bottom.** Form fields vary slightly between sites — when you hit a field that's not in the cheat sheet, fall back to the "universal answers" section at the bottom.

---

## Universal answers (use whenever a field doesn't match the script)

| Field | Value |
|---|---|
| **Name** | `Sverklo` |
| **Slug / ID** | `sverklo` |
| **One-liner (≤80 chars)** | `Local-first code intelligence MCP for Claude Code, Cursor, and Antigravity` |
| **One-liner (≤120 chars)** | `Hybrid semantic code search, symbol-level impact analysis, diff-aware MR review, and bi-temporal memory — all local` |
| **Short description (≤300 chars)** | `Sverklo is the open-source MCP server that gives AI coding agents hybrid semantic code search (BM25 + ONNX embeddings + PageRank), symbol-level impact analysis, diff-aware MR review with risk scoring, and bi-temporal memory tied to git state. Runs entirely on your laptop. No API keys, no cloud, MIT.` |
| **Category** | `Code Search` (preferred) → `Developer Tools` → `Code Intelligence` |
| **Subcategory** | `IDE Integration`, `Refactoring`, `MR Review` |
| **Tags / topics** | `mcp` `mcp-server` `code-search` `semantic-search` `code-intelligence` `claude-code` `cursor` `antigravity` `local-first` `embeddings` `pagerank` `bm25` `rag` `developer-tools` `ai-agents` `refactor` |
| **Author / Maintainer** | `Sverklo` |
| **Author email / contact** | `nikita@groshin.com` |
| **License** | `MIT` |
| **Pricing** | `Free` (or `Open source`) |
| **Repository URL** | `https://github.com/sverklo/sverklo` |
| **Homepage / Website** | `https://sverklo.com` |
| **npm package URL** | `https://www.npmjs.com/package/sverklo` |
| **Documentation URL** | `https://github.com/sverklo/sverklo#readme` |
| **Install command** | `npm install -g sverklo` |
| **Quick start** | `npm install -g sverklo && cd your-project && sverklo init` |
| **Transport** | `stdio` |
| **Authentication required** | `No` |
| **Languages supported** | `TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP` |
| **Compatible MCP clients** | `Claude Code, Cursor, Windsurf, VS Code, JetBrains, Google Antigravity` |
| **Requires API key** | `No` |
| **Requires cloud / external service** | `No` |
| **Hosted version available** | `No (local only)` |
| **Logo / icon URL** | `https://sverklo.com/og.png` (until you ship a dedicated icon) |
| **Screenshot URL** | `https://sverklo.com/og.png` |
| **Version (current)** | `0.2.11` |
| **First released** | `2026-04` |
| **GitHub stars** | `[NIKITA: paste current count]` |

---

## 1. mcp.so

URL: https://mcp.so/submit

Form fields (best guess based on similar directories — verify on the actual page):

- **Name:** `Sverklo`
- **GitHub URL:** `https://github.com/sverklo/sverklo`
- **Description:** _Use the 300-char description above._
- **Category:** `Developer Tools` (or `Search` if no Dev Tools option)
- **Tags:** `mcp,code-search,semantic-search,claude-code,cursor,local-first,refactor,impact-analysis`

If the form has a longer "About" field:

> Sverklo is a local-first MCP server that gives AI coding agents (Claude Code, Cursor, Antigravity) four things their built-in tools don't: hybrid semantic code search (BM25 + ONNX embeddings + PageRank fused via Reciprocal Rank Fusion), symbol-level impact analysis for refactor blast radius, diff-aware MR review with risk scoring, and bi-temporal memory tied to git state. 20 tools, 10 languages via tree-sitter, MIT licensed, ~640ms cold index on a 100-file repo. Zero API keys, zero telemetry by default, runs entirely on the user's laptop. The whole client is one file under 250 lines and the source is auditable in 60 seconds.

---

## 2. pulsemcp.com

URL: https://www.pulsemcp.com/submit

Pulse uses GitHub-pull metadata heavily — most fields auto-populate from the repo. For the editorial fields:

- **Title:** `Sverklo`
- **Tagline:** `Local-first code intelligence MCP for Claude Code, Cursor, and Antigravity`
- **Use case:** `Code search, refactor planning, MR review, persistent memory`
- **Why use this:** _Use the universal short description above._

If they ask for a "Highlight" field (a single best feature):

> `sverklo_impact <symbol>` walks the call graph and returns the real refactor blast radius — typically 14 callers instead of 312 noisy grep matches polluted by recharge, discharge, and unrelated test fixtures.

---

## 3. smithery.ai

URL: https://smithery.ai/submit (or via the dashboard once logged in)

Smithery normalizes everything to a `smithery.yaml` in your repo. **Optional one-time work:** add this file to sverklo at the repo root, then Smithery auto-imports on every release.

Skip this for the form unless you want to set it up — but if you do:

`smithery.yaml`:
```yaml
startCommand:
  type: stdio
  configSchema:
    type: object
    properties:
      projectPath:
        type: string
        description: Absolute path to the project to index
        default: "."
  commandFunction: |
    (config) => ({
      command: "sverklo",
      args: [config.projectPath || "."]
    })
```

For the submission form:

- **Name:** `sverklo`
- **Description:** _universal short_
- **Category:** `Developer Tools`
- **Pricing:** `Free`

---

## 4. glama.ai/mcp/servers

URL: https://glama.ai/mcp/servers (look for "Add" or "Submit a server" — usually top-right)

Glama scrapes GitHub for most metadata. Form fields:

- **Repository:** `https://github.com/sverklo/sverklo`
- **Description override (if asked):** _universal short_
- **Categories (multi-select):** `Code Search`, `Developer Tools`, `Refactoring`
- **Tags:** _full universal tag list_

---

## 5. mcpcat.io

URL: https://mcpcat.io/submit (or open an issue in their repo if no form)

- **Name:** `Sverklo`
- **GitHub:** `https://github.com/sverklo/sverklo`
- **One-line:** _universal 80-char_
- **Categories:** `Code Search`, `Developer Tools`

If they have a "Why is this in the list" field:

> The only local-first MCP server that combines hybrid code search, symbol-level impact analysis, diff-aware MR review, and git-aware memory in one tool. 20 tools, MIT, no telemetry by default, no API keys. Built for users who can't (or won't) ship their code to a vendor's cloud.

---

## 6. lobehub.com/mcp

URL: https://lobehub.com/mcp/marketplace (look for "Submit" or contribute via GitHub)

Lobe uses a GitHub-PR-based submission flow against [`lobehub/mcp-marketplace`](https://github.com/lobehub/mcp-marketplace) — you add a JSON entry under `data/`, open a PR.

`data/sverklo/index.json`:
```json
{
  "identifier": "sverklo",
  "version": "1",
  "publishedAt": "2026-04-08",
  "createdAt": "2026-04-08",
  "manifest": {
    "name": "sverklo",
    "type": "stdio",
    "command": "sverklo",
    "args": ["."],
    "env": {}
  },
  "homepage": "https://sverklo.com",
  "tags": ["code-search", "semantic-search", "code-intelligence", "claude-code", "cursor", "antigravity", "local-first", "refactor", "developer-tools"],
  "category": "developer-tools",
  "author": "sverklo",
  "github": "sverklo/sverklo",
  "license": "MIT",
  "description": "Local-first code intelligence MCP for Claude Code, Cursor, and Antigravity. Hybrid semantic search (BM25 + ONNX embeddings + PageRank), symbol-level impact analysis, diff-aware MR review with risk scoring, and bi-temporal memory tied to git state. Runs entirely on your laptop, no API keys, no cloud."
}
```

Then PR title: `Add sverklo to marketplace`. PR body: link to the npm package, the repo, and one screenshot.

---

## 7. cline.bot/mcp-marketplace

URL: https://cline.bot/mcp-marketplace (or [`cline/mcp-marketplace`](https://github.com/cline/mcp-marketplace) on GitHub)

Cline marketplace uses a JSON manifest similar to Lobe. Submit via PR to the marketplace repo.

```json
{
  "name": "sverklo",
  "displayName": "Sverklo",
  "description": "Local-first code intelligence MCP. Hybrid semantic search, symbol impact, diff-aware MR review, bi-temporal memory.",
  "category": "Developer Tools",
  "tags": ["code-search", "claude-code", "cursor", "local-first", "refactor"],
  "githubUrl": "https://github.com/sverklo/sverklo",
  "command": "sverklo",
  "args": ["."],
  "transport": "stdio",
  "license": "MIT",
  "homepage": "https://sverklo.com"
}
```

---

## Bonus — also worth submitting to (not in original list)

### 8. mcphub.ai

URL: https://mcphub.ai (look for submit button)

Smaller directory but compounds for SEO. Use the universal short description.

### 9. mcpservers.org

URL: https://mcpservers.org/submit

Often a simple GitHub URL paste form. Use the universal answers.

### 10. Anthropic's official MCP directory

URL: https://www.anthropic.com/mcp (check the bottom of the page for a contact / submit link)

This is the BIG one. Most likely a form behind an email contact or a Tally form. Long approval lead time but inclusion here drives more traffic than the other 9 combined.

Pitch in the email body if it's an email submission:

> Subject: Sverklo — submit for the official MCP server directory
>
> Hi MCP team,
>
> I'd like to submit Sverklo (https://github.com/sverklo/sverklo) for inclusion in the official MCP server directory at https://www.anthropic.com/mcp.
>
> Sverklo is a local-first MCP server (MIT, npm) that gives Claude Code, Cursor, Windsurf, VS Code, JetBrains, and Google Antigravity hybrid semantic code search, symbol-level impact analysis, diff-aware MR review with risk scoring, and bi-temporal memory tied to git state — all running on the user's laptop with no API keys and no cloud calls. 20 tools, 10 languages via tree-sitter.
>
> Public launch is scheduled for Tuesday 2026-04-21 (Show HN). Happy to provide whatever metadata, screenshots, or additional info you need for the directory entry. Sverklo currently has [NIKITA: paste star count] GitHub stars and [NIKITA: paste npm weekly downloads] weekly npm downloads.
>
> Specs:
> - Repo: https://github.com/sverklo/sverklo
> - npm: https://www.npmjs.com/package/sverklo
> - Site: https://sverklo.com
> - Install: npm install -g sverklo && cd your-project && sverklo init
> - Transport: stdio
> - License: MIT
> - Telemetry: opt-in only, full privacy design at https://github.com/sverklo/sverklo/blob/main/TELEMETRY.md
>
> Thanks for building MCP — sverklo only exists because of the protocol.
>
> Nikita Groshin
> nikita@groshin.com

---

## Workflow recommendation

**Time-box:** 20 minutes total. Set a timer.

1. Open all 10 directories in tabs (1 min)
2. Submit to mcp.so, pulsemcp.com, mcpcat.io, mcphub.ai, mcpservers.org first — those are pure forms, 2 min each (10 min)
3. glama.ai second — usually a single GitHub URL paste (2 min)
4. smithery.ai third — skip the smithery.yaml setup unless you want to invest 5 extra minutes (2 min)
5. lobehub + cline — these are PR-based, takes longer because you're forking and editing JSON. **Do these last** so the form-based ones land while you're working. (5 min)
6. Anthropic email — write and send. Long lead time, the sooner the better. (2 min)

**After submission:**
- Most directories take 1–14 days to approve
- Don't refresh and panic if they're not live in 24h
- Keep a list of submission dates so you can ping if something seems stuck after a week

**What to track:**
- [ ] mcp.so submitted
- [ ] pulsemcp.com submitted
- [ ] smithery.ai submitted
- [ ] glama.ai submitted
- [ ] mcpcat.io submitted
- [ ] lobehub.com PR opened
- [ ] cline.bot PR opened
- [ ] mcphub.ai submitted
- [ ] mcpservers.org submitted
- [ ] Anthropic MCP directory email sent
