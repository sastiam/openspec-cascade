# Tasks: Jerarquía de Memoria Persistente en FS y Watchdog de Heartbeats

## 1. Implementation & Verification

- [ ] 1.1 Implement `src/storage/memory.ts` with atomic filesystem state writes and folder scaffolding
- [ ] 1.2 Implement protected section guard for BRIEFING.md preventing accidental overwrite
- [ ] 1.3 Implement heartbeat watchdog timer detecting stalled subagents exceeding 5 minutes
- [ ] 1.4 Create unit test suite `test/storage/memory.test.ts`; verify with `bun test test/storage/memory.test.ts`
