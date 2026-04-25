# Sverklo Brand Spec — v1.0

This is the source of truth for sverklo's visual and verbal identity. It is what we hand to a designer or contributor when something visual is being made (logo asset, social card, slide, conference talk, GitHub social preview, dashboard re-skin). Every claim here is informed by two independent brand audits run in 2026-04 (one due-diligence, one adversarial-competitor) — both converged on the same set of fixes.

The bar: **a senior engineer in Claude Code recognises a sverklo screenshot at thumbnail size and 50ms.**

---

## 1. The keystone change — kill the iOS app-icon

The current `docs/logo.png` is a glossy rounded-square tile with a beveled "S" gradient and a sparkle. It reads as "consumer iOS productivity app." Every other surface (CLI, README, dashboard, voice) reads as "craft-OSS terminal tool." **The two registers fight, and the icon loses.**

**Replace the icon with a typographic monospace wordmark.**

```
▌sverklo
```

- **Caret prefix:** `▌` (U+258C left-half block) — the same glyph that prefixes `.brand` in the dashboard CSS today. It is sverklo's standalone symbol; using it in the logo unifies favicon, dashboard chrome, social card, GitHub avatar, and CLI register into one mark.
- **Wordmark:** lowercase `sverklo`, set in **JetBrains Mono Bold (700)**, letter-spacing -0.02em, baseline aligned with the top of the caret block.
- **Colour:** caret `#E85A2A` (accent), wordmark `#EDE7D9` (warm bone) on `#0E0D0B` (warm near-black). The same palette already used everywhere else.
- **Sizes:** at 16×16 favicon, the caret alone (no wordmark). At 32–64px, caret + lowercase `s`. At 128px and above, caret + full wordmark.
- **Off-brand variants:** drop-shadow, gradient fills, beveled edges, sparkle accents, drill icons, app-icon rounded squares, mascots. No.

The wordmark replaces:
- `docs/logo.png` (rounded-square tile)
- The npm/og social card (`og.png`, `og.svg` in `sverklo-site/`)
- The GitHub social preview
- `apple-touch-icon.png` (the only place the app-icon shape may persist, because Apple insists)

---

## 2. Palette

A warm dark stack — deliberately *not* the cool-grey #0F172A every shadcn dashboard uses.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0E0D0B` | Page background, hero plates |
| `--bg-2` | `#16140F` | Secondary surfaces, cards |
| `--bg-3` | `#1C1A14` | Tertiary, code blocks |
| `--rule` | `#2A2620` | Borders, separators |
| `--rule-2` | `#403A30` | Stronger borders, hover states |
| `--text` | `#EDE7D9` | Primary text — warm bone, NOT pure white |
| `--text-2` | `#A39886` | Secondary text |
| `--text-3` | `#8A8270` | Tertiary text, footnotes |
| `--accent` | `#E85A2A` | Single accent — rust orange |
| `--ok` | `#5DA677` | Sparing — success states only |
| `--warn` | `#D9A14A` | Sparing — warning states only |

**Rule: one accent, used sparingly.** Two accents make sverklo look like a generic SaaS. The `--accent` carries the brand; everything else is text on dark.

---

## 3. Type

| Surface | Family | Weight |
|---|---|---|
| Logos, headings, tags, numerics | **JetBrains Mono** | 700 (Bold), 600 (SemiBold), 500 (Medium), 400 (Regular) |
| Body prose | **Public Sans** | 400, 500, 600, 700 |
| Code blocks | JetBrains Mono | 400 |

**Do not** use Inter, Söhne, system-ui, or any sans-serif in chrome. The mono-first register is the brand. Public Sans is reserved for *prose* (lede, FAQ answers, body text where reading speed matters more than tribe-signal).

Fallback stacks (in `font-family` declarations, in this order):
- Mono: `'JetBrains Mono', ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace`
- Sans: `'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`

**Privacy posture for fonts:** sverklo never beacons a third party for type assets. The dashboard `@font-face` declarations use `local()` to prefer installed copies; if they're missing, the system fallback stack is fine. We will *not* re-introduce `fonts.googleapis.com`. (Self-hosting WOFF2 in `dist/` is a future option if local detection proves too sparse on Linux.)

---

## 4. Voice

A senior engineer who has lost a Friday to a 312-match grep. Closer to `Aider` / `Cline` / Linear's changelog than to corporate AI marketing.

**Voice rules:**
1. **Specificity over adjectives.** "Down ~30% on cold start" beats "lightning-fast." "47 callers, 8 in production" beats "comprehensive."
2. **Anti-hype.** When a competitor would say "AI-powered," say what we actually do ("hybrid BM25 + vector + PageRank fused with RRF"). When a competitor would say "revolutionary," concede limits ("if a launch post tells you a tool is great for everything, close the tab").
3. **One sentence, one idea.** Short, declarative, refusal-driven where possible. *"Local. MIT. Zero cloud. Ships in 90 seconds."*
4. **Engineer-to-engineer.** Address the buyer in their own register. *"Your AI agent edits `UserService.validate()`. It doesn't know 47 other functions call it."*
5. **No emoji** in any product surface (CLI, dashboard, README, website). Emoji are a different brand.

**Voice anti-patterns** — flag and fix wherever they appear:
- Exclamation marks in CLI output (`Published!` is from a different product).
- Roadmap caveats above the fold ("Bundling the model into the npm tarball is on the v0.13 roadmap" belongs in a release note, not the README hero).
- Marketing puffery ("revolutionary," "the future of," "next-gen").
- Self-congratulation ("imported 17 memories" when you just imported the boilerplate template).

**Voice on-brand examples to imitate:**
- `Semantic search, impact analysis, persistent memory — pick 3.`
- `All 37 tools, no limits, no telemetry, no "free tier" — that's not where the line is.`
- `If a launch post tells you a tool is great for everything, close the tab.`

---

## 5. Hero copy

The single most-leveraged surface. Every reviewer in the 2026-04 brand audit independently proposed near-identical rewrites of sverklo's homepage h1.

**Current (deprecated):** *"sverklo — code intelligence for AI agents"* — names the category, not the buyer outcome. 4/10 on the 6-second test.

**v1.0 hero (use this):**

> # Stop your AI from making things up about your codebase.
>
> sverklo is the local-first MCP server that gives Claude Code, Cursor, and Windsurf a real symbol graph — so when the agent renames a function, it knows the 47 other places that call it. No cloud, no API keys, MIT licensed. `npx sverklo init` — 30 seconds.

**Why this works:**
- Outcome before mechanism (stop hallucinating ⟶ symbol graph).
- Concrete number (47 callers) over abstract claim ("comprehensive context").
- Trust signals stacked at the end (no cloud / no API keys / MIT) without leading with them.
- Activation promise (`npx sverklo init`, 30 seconds) closes the gap from "interesting" to "I'll try it."

---

## 6. Naming

**Sverklo** = Russian *сверкло* / *свёрло*, "drill." The etymology is decorative and was previously buried in a parenthetical footnote. **Make the metaphor load-bearing:**
- "Sverklo drills into your repo." — body copy.
- `sverklo drill <symbol>` — alias for `sverklo_impact` to make the metaphor live in the product, not just the wordmark.
- The `▌` caret is a drill bit — when the wordmark animates (hero, conference slide, social motion), the caret strikes once like a drill press contacting a workpiece.

**Not** drills as iconography in the visual mark. The wordmark stays typographic. The metaphor lives in copy and motion.

**Pronounciation guide for the README footer / blog bio:** "SVER-klo." Three syllables would be wrong; non-Russian speakers default to two and that's fine.

---

## 7. Surfaces — what changes when

| Surface | v0.x state | v1.0 target |
|---|---|---|
| `docs/logo.png` | Rounded-square iOS-app-icon | `▌sverklo` mono wordmark, dark plate |
| Favicon (`favicon.ico`, dashboard inline SVG) | Lowercase `s` on dark plate | `▌` caret, accent-coloured |
| `sverklo.com` hero | "code intelligence for AI agents" | "Stop your AI from making things up about your codebase." |
| `sverklo.com` social card (`og.png`/`og.svg`) | Logo + tagline | Wordmark + the v1.0 hero h1, single line |
| GitHub social preview | Default repo card | Wordmark + hero + screenshot of `sverklo audit` output |
| Dashboard `.brand` | Already on-brand (`▌sverklo`) | Unchanged — this is the reference |
| README hero | Tool-noun + feature triplet | Buyer-outcome + grep-vs-sverklo table moved above the fold |
| CLI `console.log` cheer | One stray `Published!` | Replaced with neutral `Published.` |
| Dashboard fonts | `fonts.googleapis.com` | `local()` + system stack — zero beacons |

---

## 8. The 6-second test

Print sverklo.com on paper, hand it to a senior engineer using Claude Code, take it away after 6 seconds. Ask: "what does this tool do, who is it for, why over alternatives?" If they can answer all three, the brand is doing its job. If not, the homepage is the problem — start with §5 (hero copy).

---

*Last updated: 2026-04-25 (v1.0 brand spec, derived from the 8-agent codebase + product + marketing + branding review).*
