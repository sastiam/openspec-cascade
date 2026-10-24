#!/usr/bin/env bash
set -euo pipefail

CHANGES="looper-storage-memory,looper-pal-canonical-schema,looper-core-fsm,looper-core-dag-scheduler,looper-pal-claude-adapter,looper-pal-gemini-adapter,looper-pal-opencode-adapter,looper-core-subagent-dispatcher,looper-core-router-escalation,looper-gate0-mechanical-qa,looper-gate1-semantic-review,looper-gate2-adversarial-challenger,looper-gate3-forensic-audit,looper-integration-github-project,looper-integration-catalog-sync"

exec bun run cascade.ts --engine antigravity --changes "$CHANGES" "$@"
