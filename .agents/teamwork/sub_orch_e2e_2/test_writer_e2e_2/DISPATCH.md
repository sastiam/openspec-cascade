# Dispatch — `test_writer_e2e_2`

- **Role:** `teamwork_preview_test_writer` (Phase A E2E Remediation & Hardening Engineer)
- **Parent:** `sub_orch_e2e_2` (`901bf5689a93e28c0e0373e54199834f`)
- **Repository Root:** `/home/antigravity/sastiam/openspec-cascade`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (read `## 2026-11-15T01:46:44Z`)
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`
- **Scope File:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2/SCOPE.md`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2/test_writer_e2e_2/handoff.md`

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Explorer Findings to Read First
1. `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2/explorer_e2e_it2_1/handoff.md`
2. `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2/explorer_e2e_it2_2/handoff.md`
3. `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2/explorer_e2e_it2_3/handoff.md`

## Strict Write Ownership
- **ALLOWED ONLY:** `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, and your `handoff.md`.
- **FORBIDDEN:** `src/**`, root `*.ts`, `package.json`, `eslint.config.js`, `tsconfig.json`, `openspec/**`, `PROJECT.md`, `.agents/teamwork/reviewer_INTEG-RUN-001/`.
- **NEVER run `git commit` or `git push`.**

## Required Implementation Tasks
1. **Semantic Constant (`test/e2e/helpers/constants.ts` & `test/e2e/helpers/temp_repo.ts`):**
   - In `test/e2e/helpers/constants.ts` inside `E2E_CONSTANTS`, add `JSON_INDENT_SPACES: 2,` (after `STALE_REVIEW_ELAPSED_SECONDS: 2,`).
   - In `test/e2e/helpers/temp_repo.ts:145`, replace `E2E_CONSTANTS.EXIT_CODE_FATAL` with `E2E_CONSTANTS.JSON_INDENT_SPACES`.
2. **Fix Arithmetic Breakdown (`TEST_INFRA.md:93`):**
   - Update `TEST_INFRA.md:93` from `(58 T1 + 64 T2 + 60 T3 + 50 T4)` to `(59 T1 + 67 T2 + 60 T3 + 46 T4)` so it matches the column sums in lines 71–91 (`59 + 67 + 60 + 46 = 232`).
   - Update `TEST_INFRA.md:3` iteration/sub-orchestrator reference cleanly if appropriate (`sub_orch_e2e_2` / Iteration 2).
3. **Atomic `mkdtempSync` Replacement (`test/e2e/tier1_features/`):**
   - In `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts`:
     - Update line 2 imports to `{ existsSync, mkdtempSync, writeFileSync }`.
     - Replace `${Date.now()}` + `mkdirSync` at lines 109–111 (`tempDir`), lines 193–206 (`dir` in loop, using `cleanupTempDir(dir)` in `finally`), and lines 208–210 (`emptyDir`) with `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))` and deterministic cleanup.
   - In `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts`:
     - Update line 2 imports to `{ existsSync, mkdirSync, mkdtempSync, writeFileSync }`.
     - Replace `${Date.now()}` + `mkdirSync` at lines 62–64 (`outDir`), lines 96–99 (`sandbox`, registering `cleanups.push(() => cleanupTempDir(sandbox))` immediately after `mkdtempSync` and before `mkdirSync(archDir, { recursive: true })`), and lines 141–142 (`baseDir`) with `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))`.
4. **Harden `f17_f20_telemetry_hygiene_docs.test.ts` (`syncResult.archify.length`):**
   - Wrap the `sandbox` test body in `try/finally` (with `cleanupTempDir(sandbox)`) or ensure immediate cleanup registration + `mkdtempSync` eliminates the cross-process `Date.now()` race across `diagrams.ts:225`'s `await runner(...)`.
   - Strengthen assertions around `syncResult.graphify?.success` (`true`), `syncResult.archify.length` (`1`), and `syncResult.archify[0]?.target` (`"system-arch"`).
   - Maintain strict Clean Code & TypeScript compliance: zero `any`/`as any`, zero inline function-body comments, zero magic numbers.
5. **Fresh Verification & `TEST_READY.md` Update:**
   - With `export PATH="$HOME/.bun/bin:$PATH"`, run:
     1. `bunx tsc --noEmit`
     2. `bunx eslint .`
     3. `bun test test/e2e`
     4. `bun test`
   - Update `TEST_READY.md` with the freshly verified exit codes, test counts, assertion counts, file counts, and timings, and clarify at the M1 checklist line that M1 `src/config/*` modules are active on the working tree while `PROJECT.md` formally tracks `M1` as `IN_PROGRESS` (and update header metadata to `sub_orch_e2e_2` Iteration 2).
   - Note: `bun test` may touch 3 tracked files under `.agents/teamwork/reviewer_INTEG-RUN-001/` via pre-existing `test/gates/gate1_feedback.test.ts`; do NOT modify or commit `.agents/teamwork/`.
   - Confirm zero `/tmp/cascade-e2e-*` temp dir leaks after completion.
6. Write full verification outputs and modified file list to `handoff.md` and call `send_message` to `901bf5689a93e28c0e0373e54199834f`.
