# Tasks: Jerarquía de Memoria Persistente en FS y Watchdog de Heartbeats

## 1. Implementation & Verification

- [x] 1.1 Implement `src/storage/memory.ts` with atomic filesystem state writes and folder scaffolding
- [x] 1.2 Implement protected section guard for BRIEFING.md preventing accidental overwrite
- [x] 1.3 Implement heartbeat watchdog timer detecting stalled subagents exceeding 5 minutes
- [x] 1.4 Create unit test suite `test/storage/memory.test.ts`; verify with `bun test test/storage/memory.test.ts`
