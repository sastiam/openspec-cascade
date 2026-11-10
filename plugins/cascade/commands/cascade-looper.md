---
name: cascade-looper
description: Run the 24/7 continuous autonomous looper across multiple OpenSpec changes with automated self-healing, git rollback buffers, and livelock prevention.
category: Execution
tags: [cascade, looper, 24-7, autonomous]
---

# /cascade-looper — 24/7 Continuous Execution Looper

Executes continuous multi-change task loops with failure recovery, heartbeat watchdog monitoring, and git rollback protection.

## Usage

```bash
# Run the continuous looper
./run_looper.sh

# Or via registered script
bun run cascade:looper
```

## Features

- **Continuous 24/7 Execution:** Sequences multiple OpenSpec changes automatically.
- **Git Rollback Buffer:** Cleanly resets working tree (`git reset --hard` & `git clean -fd`) if max retries (3) are exhausted.
- **Heartbeat Watchdog:** Detects and recovers stalled agent sessions exceeding 5-minute SLAs.
- **Victory Livelock Prevention:** Detects repeating failure cycles and triggers escalation ladders.
