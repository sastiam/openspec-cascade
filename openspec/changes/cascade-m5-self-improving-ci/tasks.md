# Tasks: Milestone M5 (F17–F19)

## 1. Self-Improver (F17)
- [x] 1.1 Implement `src/core/self_improver.ts` and wire it into `CascadeFacade` and `HarnessInjector`.
- [x] 1.2 Add `test/core/self_improver.test.ts`.

## 2. Pre-PR Loop & CLI (F18)
- [x] 2.1 Implement `src/core/pre_pr_loop.ts` and `src/cli/commands.ts` (`doctor`, `catalog`, `drift`, `review`) dispatched from `cascade.ts`.
- [x] 2.2 Add `test/core/pre_pr_loop.test.ts` and `test/cli/commands.test.ts` plus E2E coverage.

## 3. CI & Hygiene (F19)
- [x] 3.1 Add `.github/workflows/ci.yml`, update `.gitignore`, untrack `.agents/teamwork/`, and add `test/ci/workflow.test.ts`.
- [x] 3.2 Run the full verification suite on Bun and Node 24.
