#!/usr/bin/env bash
# 24/7 looper over the v2 looper changes.
#   CASCADE_RUNTIME=bun|node   runtime (default: bun if installed, otherwise node >= 24)
#   CASCADE_LOOPER_MODE=v1|v2  pipeline mode (default: v1)
#   CASCADE_LOOPER_ENGINE=...  engine (default: antigravity)
#   CASCADE_LOOPER_CHANGES=... comma-separated change list override
# Extra arguments are forwarded to cascade.ts (e.g. --dry-run, --resilient, --full-gate).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_CHANGES="looper-storage-memory,looper-pal-canonical-schema,looper-core-fsm,looper-core-dag-scheduler,looper-pal-claude-adapter,looper-pal-gemini-adapter,looper-pal-opencode-adapter,looper-core-subagent-dispatcher,looper-core-router-escalation,looper-gate0-mechanical-qa,looper-gate1-semantic-review,looper-gate2-adversarial-challenger,looper-gate3-forensic-audit,looper-integration-github-project,looper-integration-catalog-sync,cascade-v2-sdd-framework"
CHANGES="${CASCADE_LOOPER_CHANGES:-$DEFAULT_CHANGES}"
MODE="${CASCADE_LOOPER_MODE:-v1}"
ENGINE="${CASCADE_LOOPER_ENGINE:-antigravity}"

if [[ -n "${CASCADE_RUNTIME:-}" ]]; then
  RUNTIME="$CASCADE_RUNTIME"
elif command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
else
  RUNTIME="node"
fi

case "$RUNTIME" in
  bun)
    exec bun run "$SCRIPT_DIR/cascade.ts" --engine "$ENGINE" --mode "$MODE" --changes "$CHANGES" "$@"
    ;;
  node)
    exec node --import "$SCRIPT_DIR/scripts/node_ts_register.mjs" "$SCRIPT_DIR/cascade.ts" --engine "$ENGINE" --mode "$MODE" --changes "$CHANGES" "$@"
    ;;
  *)
    echo "run_looper.sh: CASCADE_RUNTIME must be 'bun' or 'node' (got '$RUNTIME')" >&2
    exit 2
    ;;
esac
