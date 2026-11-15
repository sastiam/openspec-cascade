---
name: cascade
description: Launch OpenSpec Cascade autonomous task execution. Runs changes task-by-task with deterministic verification gates, multi-engine support, and OS keep-alive.
category: Execution
tags: [cascade, openspec, tasks, automation]
---

# /cascade — Autonomous Task Execution

Runs OpenSpec changes autonomously, one task per agent session, until every task in `tasks.md` is complete.

## Usage

```bash
# Preview the execution plan and current usage
bun run cascade.ts --changes <change-a,change-b> --dry-run

# Run task cascade (keeps system awake automatically)
bun run cascade.ts --changes <change-a,change-b>

# Full gate mode: every committing task runs test, lint, tsc, and build
bun run cascade.ts --changes <change-a> --full-gate

# Specify execution engine (claude, opencode, antigravity/gemini, jules)
bun run cascade.ts --changes <change-a> --engine claude

# v2 pipeline: Analyze -> SDD gate -> DAG -> FSM -> Gates 0-3 -> checkpoint commit
bun run cascade.ts --changes <change-a> --mode v2

# Run under Node.js 24 LTS instead of Bun
node --import ./scripts/node_ts_register.mjs cascade.ts --changes <change-a> --dry-run
```

## Flags

- `--changes <names>`: Comma-separated OpenSpec change names in cascade order.
- `--repo <path>`: Target repository directory (defaults to current directory).
- `--dry-run`: Inspect plan and pending tasks without modifying files.
- `--full-gate`: Run full verification suite on every committing task.
- `--engine`: Select engine (`claude`, `opencode`, `antigravity` with aliases `agy`/`gemini`, `jules`).
- `--mode <v1|v2>`: `v1` runs the sequential task loop; `v2` runs the FSM-driven gate pipeline (Gate 2 adversarial probes require `--full-gate` and Bun).
- `--no-keep-alive`: Disable system idle sleep inhibitor.
- `--allow-dirty`: Start with dirty working tree, committing existing diff first.
