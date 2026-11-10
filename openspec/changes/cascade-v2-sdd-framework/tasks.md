# Tasks

## 1. Cascade v2 SDD Framework Implementation

- [x] 1.1 Implement centralized SDD constants in `config.ts` adhering to zero magic numbers
- [x] 1.2 Implement `src/sdd/sdd_gate.ts` with production file classification, active change discovery, and unit tests
- [x] 1.3 Implement `src/sdd/analyze.ts` for cross-artifact consistency, coverage checking, orphan detection, and constitution compliance
- [x] 1.4 Implement `src/sdd/surface_verifier.ts` for surface-aware detection and targeted test suite execution
- [x] 1.5 Implement `src/sdd/review_verifier.ts` for diff-match review verification, merge-base calculation, and stale cache detection
- [x] 1.6 Implement integrated tests in `test/sdd/` verifying all SDD gates and run full verification suite (`bun test`, `bun run typecheck`, `bun run lint`)
