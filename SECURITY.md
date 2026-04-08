# Security Policy

## Supported Versions

Sverklo is pre-1.0. Only the latest released version on npm receives security updates.

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Email **security@sverklo.com** with:

- A clear description of the issue
- Reproduction steps or a proof-of-concept
- The sverklo version affected (`sverklo --version`)
- Your assessment of impact and severity

We aim to acknowledge reports within **3 business days** and to ship a fix or mitigation within **14 days** for confirmed high-severity issues.

If you prefer encrypted communication, request our public PGP key in your first message and we will send it before you share details.

## Scope

In-scope for security reports:

- The sverklo MCP server binary (`src/`, `bin/`, `dist/`)
- The telemetry endpoint (`telemetry-endpoint/`) — deliberately designed to collect almost nothing; report if it collects more than documented
- The init / doctor / setup commands and the files they write to the user's machine
- Any path traversal, arbitrary file read/write, or RCE path reachable from a malicious codebase being indexed
- Any path that exfiltrates data to a third party when telemetry is off

Out of scope:

- Self-inflicted damage from running sverklo on a codebase you already don't trust (sverklo parses it — it is not a sandbox)
- Issues in upstream dependencies (`@modelcontextprotocol/sdk`, `better-sqlite3`, `onnxruntime-node`, `chokidar`) — please report those upstream; we will track and update
- Denial of service via deliberately pathological inputs to the indexer (huge files, adversarial AST, etc.) — file a regular GitHub issue
- Anything requiring physical access to the user's machine

## Our Security Posture

- **Local-first by design.** Sverklo indexes code on your machine, stores the index in `~/.sverklo/`, and does not send code, queries, file paths, or symbol names anywhere. The only network calls sverklo makes are: (1) downloading the ONNX embedding model on first run from a fixed URL, and (2) if you explicitly opt in to telemetry, sending the 9 fields documented in [`TELEMETRY.md`](./TELEMETRY.md) to `t.sverklo.com`.
- **Telemetry is off by default.** It must be explicitly enabled via `sverklo telemetry enable`. Every event sent is mirrored to `~/.sverklo/telemetry.log` first so users can audit exactly what was sent. The endpoint source is open at [`telemetry-endpoint/`](./telemetry-endpoint/).
- **No API keys, no cloud accounts.** Sverklo has no authentication layer because it has nothing remote to authenticate to. Embeddings run locally via `onnxruntime-node`.
- **MIT licensed.** All code is open source. Audit it.

## Disclosure Policy

We follow **coordinated disclosure**:

1. You report the issue privately.
2. We confirm, triage, and develop a fix.
3. We publish a patched release.
4. After users have had a reasonable window to upgrade (typically 7–14 days after the patched release), we publish a security advisory with credit to the reporter (unless you prefer to remain anonymous).

We will not pursue legal action against security researchers who:

- Report vulnerabilities in good faith
- Do not exploit beyond what is needed to demonstrate impact
- Do not access data belonging to other users
- Give us reasonable time to respond before public disclosure

Thank you for helping keep sverklo and its users safe.
