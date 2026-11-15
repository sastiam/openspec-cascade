# Scope — E2E Testing Track Phase A Iteration 2 (`sub_orch_e2e_2`)

## In-Scope Deliverables (Write Ownership: `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**` ONLY)
1. `test/e2e/helpers/constants.ts` & `test/e2e/helpers/temp_repo.ts`:
   - Add `JSON_INDENT_SPACES: 2` to `E2E_CONSTANTS` and use it in `temp_repo.ts:145` instead of `E2E_CONSTANTS.EXIT_CODE_FATAL`.
2. `TEST_INFRA.md`:
   - Correct line 93 tier arithmetic breakdown to `(59 T1 + 67 T2 + 60 T3 + 46 T4)` matching lines 71–91.
3. `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts` & `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` (and any other `test/e2e/**` files with `Date.now()` temp paths):
   - Replace `${Date.now()}` temp dir construction with atomic `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))` and guarantee deterministic cleanup (`try/finally` or `afterEach`).
4. `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` (`syncResult.archify.length` at line 136):
   - Identify root cause of transient concurrency/state flake reported by `reviewer_e2e_2` and harden the test deterministically without modifying production code.
5. `TEST_READY.md`:
   - Update with freshly verified `bunx tsc --noEmit`, `bunx eslint .`, `bun test test/e2e`, and `bun test` results.

## Strictly Out of Scope (Do Not Touch)
- `src/**`, root `*.ts`, `package.json`, `eslint.config.js`, `tsconfig.json`, `openspec/**`, `PROJECT.md`
- `git commit`, `git push`, `git checkout` on main workspace repo
- `.agents/teamwork/reviewer_INTEG-RUN-001/` (may be dirtied by pre-existing `test/gates/gate1_feedback.test.ts`; do not commit or revert unless instructed)
