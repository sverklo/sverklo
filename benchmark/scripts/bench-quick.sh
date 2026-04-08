#!/usr/bin/env bash
set -euo pipefail
# CI-friendly: Tier A only, ~3 min on the seed set.
# Run from sverklo project root.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
exec node --experimental-strip-types --no-warnings benchmark/src/index.ts "$@"
