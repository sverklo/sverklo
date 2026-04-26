# Sverklo VS Code Extension

Inline blast-radius decorations from sverklo's symbol graph. The extension reads the function and class headers in your active editor and renders one line per symbol showing **how many other places call it** — so you see the cost of changing a function before you start typing.

```ts
export function validateToken(req) {  ⟵ 47 callers
  ...
}
```

This is the editor-margin demo from sverklo's v0.17 roadmap: same engine the agent already uses (`sverklo_impact`), exposed to the human in the editor instead of waiting for the agent to ask.

## Status

**Scaffold — v0.1.0.** Activates on TS / JS / Python / Go / Rust / Java; calls the local `sverklo` CLI for caller counts. Test-coverage decoration is stubbed (the renderer omits "X tested" until a fast `sverklo test_map --json` lands). Path: extensions/vscode/ in the sverklo monorepo.

## Requirements

- The `sverklo` CLI on PATH (or set `sverklo.binary` in settings).
- A sverklo-indexed project (`sverklo init` once; the watcher keeps it fresh).

## Settings

| Key | Default | Description |
|---|---|---|
| `sverklo.binary` | `sverklo` | Path to the CLI. |
| `sverklo.decorations.enabled` | `true` | Show inline decorations. |
| `sverklo.decorations.minCallers` | `2` | Suppress noise — only decorate symbols above this caller count. |

## Commands

- **Sverklo: Refresh Decorations** — force-rebuild decorations for the active editor.
- **Sverklo: Toggle Inline Decorations** — flip the global on/off without changing settings.

## Build + package

```bash
cd extensions/vscode
npm install
npm run compile
npm run package          # produces sverklo-vscode-0.1.0.vsix
```

## License

MIT — same as sverklo.
