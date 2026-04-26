# Sverklo Code Review Action

AI-powered code review with risk scoring, impact analysis, and structural heuristics — posted directly on your pull requests.

## Usage

```yaml
# .github/workflows/sverklo-review.yml
name: Sverklo Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: sverklo/sverklo/action@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | `${{ github.token }}` | GitHub token for posting PR comments |
| `fail-on` | `none` | Fail if risk exceeds: `critical`, `high`, `medium`, `low`, `none` |
| `ref` | auto-detected | Git ref range (e.g., `main..HEAD`) |
| `max-files` | `25` | Maximum files to review |
| `inline-comments` | `true` | Post inline review comments at heuristic-flagged lines (alongside the sticky summary). Set `false` to keep only the single summary comment. |

## What you get on every PR

By default the action posts a **single PR review** containing:

- A sticky summary comment with risk-scored files, dangling references, and added/removed symbols
- Up to 30 **inline comments** anchored to the specific lines our heuristics flagged (unguarded stream calls, etc.) — each comment includes the rule name, severity, and a one-paragraph rationale

If `inline-comments: false`, you get only the sticky summary (the v0.15 behaviour).

## Quality gate

Block merges on high-risk changes:

```yaml
- uses: sverklo/sverklo/action@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on: high
```

## What it reviews

- Risk scoring per file (importance × coverage × churn)
- Dangling references from removed symbols
- Untested production changes
- Duplicate symbol detection
- Structural heuristics (unguarded streams, etc.)
