# Tasks

## 1. Antigravity Engine Module

- [x] 1.1 Implement `antigravity.ts` providing `runAntigravitySession`, `reduceAntigravityEvent`, `antigravityModelArg`, and `classifyFailure`
- [x] 1.2 Implement `antigravity.test.ts` covering event reduction, stream parsing, and error classification; verify with `bun test antigravity.test.ts`
- [x] 1.3 Enrich tool output parameter formatting (`path`, `cmd`, `args`) in `antigravity.ts` and `describeToolInput`

## 2. Cascade Integration & Documentation

- [x] 2.1 Update `cascade.ts` CLI flags to accept `--engine antigravity` and `--engine agy`, dispatching to `runAntigravity`
- [x] 2.2 Update `README.md` documenting Antigravity CLI engine requirements and flags; verify with full test suite `bun test`
