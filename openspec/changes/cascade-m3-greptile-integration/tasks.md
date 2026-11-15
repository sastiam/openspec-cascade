# Tasks: Milestone M3 (F10–F13)

## 1. Shadow Commits & Cache (F11, F12)
- [x] 1.1 Implement `src/integration/greptile/shadow.ts` (`ShadowCommitManager.withShadowCommit`, `withShadowWorktree`, `branchDiff`).
- [x] 1.2 Implement `src/integration/greptile/cache.ts` (`GreptileCache`, `cacheKey`, `sha256`, policies, prune).
- [x] 1.3 Add `test/integration/greptile/shadow.test.ts` and `cache.test.ts` against real git repositories and the real filesystem.

## 2. Client (F10)
- [x] 2.1 Implement `src/integration/greptile/client.ts` (`GreptileCliClient`, `GreptileError`, `parseReviewOutput`, `rankFindings`).
- [x] 2.2 Add `test/integration/greptile/client.test.ts` executing real executables on `PATH` that emit documented CLI output.

## 3. Search & Bridge (F13)
- [x] 3.1 Implement `src/integration/greptile/search.ts` and `bridge.ts`, and add `reviewFilesFromFindings` to `src/sdd/review_verifier.ts`.
- [x] 3.2 Add `test/integration/greptile/bridge.test.ts` and E2E Tier 1 coverage for F10–F13.
- [x] 3.3 Update the `PROJECT.md` Greptile contract and run `bun test`, `bunx tsc --noEmit`, `bunx eslint .`, the forensic audit and `npm run test:node`.
