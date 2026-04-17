# Sverklo Claude Skill

A downloadable Claude Skill (.zip) that teaches Claude how to use Sverklo's code intelligence tools.

## What this is

Claude Skills are procedural knowledge files that teach Claude how to use specific tools. Upload this skill to Claude.ai and it will know when and how to reach for Sverklo's semantic search, blast-radius analysis, PR review, and codebase auditing.

## How to install

1. Build the zip:
   ```bash
   cd skill && zip -r ../sverklo-skill.zip sverklo-skill/
   ```

2. Go to [claude.ai/settings](https://claude.ai/settings) > Skills

3. Upload `sverklo-skill.zip`

4. Start a new conversation — Claude now knows about Sverklo tools

## What the skill teaches Claude

- When to use Sverklo vs Grep vs Read (decision framework)
- How to install and initialize Sverklo (`npm install -g sverklo && sverklo init`)
- The 5 most important tools with usage examples:
  - `sverklo_search` — semantic code search
  - `sverklo_impact` — blast-radius analysis
  - `sverklo_review_diff` — risk-scored PR review
  - `sverklo_audit` — codebase health scoring
  - `sverklo_remember` / `sverklo_recall` — persistent memory
- Complete workflows: onboarding, PR review, safe refactoring
- Example prompts that trigger each tool

## Prerequisites

Sverklo must be installed and initialized in the project for the MCP tools to be available:

```bash
npm install -g sverklo
cd your-project
sverklo init
```
