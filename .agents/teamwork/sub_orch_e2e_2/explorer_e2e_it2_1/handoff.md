# Handoff Report: `explorer_e2e_it2_1`

- **Author:** `explorer_e2e_it2_1` (`teamwork_preview_explorer`)
- **Parent:** `sub_orch_e2e_2` (`901bf5689a93e28c0e0373e54199834f`)
- **Task:** Iteration 2 Read-Only Investigation of E2E Constants, Helpers, `TEST_INFRA.md` Arithmetic, `TEST_READY.md`, `PROJECT.md` Milestones, and Repo Baseline
- **Verdict:** `COMPLETED`

---

## 1. Findings: `test/e2e/helpers/` & Constant/Magic-Number Audit

### 1.1 `JSON_INDENT_SPACES: 2` Insertion Point & `temp_repo.ts:145` Fix
- **`/home/antigravity/sastiam/openspec-cascade/test/e2e/helpers/constants.ts:36-38`**:
  - Lines 36–38 currently end `E2E_CONSTANTS` with:
    ```ts
      DEFAULT_REVIEW_ELAPSED_SECONDS: 15,
      STALE_REVIEW_ELAPSED_SECONDS: 2,
    } as const;
    ```
  - **Recommended insertion point:** Add `JSON_INDENT_SPACES: 2,` inside `E2E_CONSTANTS` immediately after line 37 (`STALE_REVIEW_ELAPSED_SECONDS: 2,`) before `} as const;` at line 38 (preserving `as const` and `@typescript-eslint/no-magic-numbers` compliance).
- **`/home/antigravity/sastiam/openspec-cascade/test/e2e/helpers/temp_repo.ts:141-147`**:
  - Line 145 currently reads:
    ```ts
        `${JSON.stringify(options.packageJson, null, E2E_CONSTANTS.EXIT_CODE_FATAL)}\n`,
    ```
  - **Required replacement:** Replace `E2E_CONSTANTS.EXIT_CODE_FATAL` with `E2E_CONSTANTS.JSON_INDENT_SPACES` at `test/e2e/helpers/temp_repo.ts:145`.

### 1.2 Full Scan of `test/e2e/` (`helpers/*.ts` + 14 `*.test.ts` files)
- **`test/e2e/helpers/constants.ts` (39 lines):** Clean; all numeric literals are properties inside `E2E_CONSTANTS = { ... } as const`. Note `POLL_INTERVAL_MS: 25` (line 18) is defined but currently unused across `test/e2e/`.
- **`test/e2e/helpers/cli_runner.ts` (240 lines):** Clean; uses `E2E_CONSTANTS` for `REPO_ROOT`, `DEFAULT_SYSTEM_PATH`, `TIMEOUT_SIGNAL`, `TEMP_PREFIX_HOME`, `DEFAULT_SUBPROCESS_TIMEOUT_MS`, `CASCADE_ENTRYPOINT`, and `OPENSPEC_BIN`. Only raw numeric literal is `0` at line 80 (`segment.length > 0`), which is permitted by `eslint.config.js:24` (`ignore: [-1, 0, 1]`). Zero semantic misuse.
- **`test/e2e/helpers/temp_repo.ts` (298 lines):** Aside from line 145 (`EXIT_CODE_FATAL` misuse), all other `E2E_CONSTANTS` references (`EXIT_CODE_SUCCESS` at line 100, `TEMP_PREFIX_*` at lines 122–124, `DEFAULT_BRANCH` at line 125, `DEFAULT_GIT_USER_*` at lines 136–137, `INITIAL_COMMIT_MESSAGE` at line 177) are semantically accurate with zero uncentralized magic numbers.
- **14 `*.test.ts` files across `tier1_features/`, `tier2_boundaries/`, `tier3_combinations/`, `tier4_scenarios/`:**
  - `eslint.config.js:39-43` disables `@typescript-eslint/no-magic-numbers` for `**/*.test.ts`.
  - **Non-atomic `Date.now()` temp paths found (6 sites):**
    - `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts:109, 193, 208`
    - `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts:62, 96, 141`
    All 6 should be converted to `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))` with deterministic cleanup.
  - **Note on `f17_f20_telemetry_hygiene_docs.test.ts:136` (`syncResult.archify.length`):**
    - In `diagrams.ts:207-290`, `syncDiagrams()` executes `await runner(graphifyCommand, cwd, timeoutMs)` (`diagrams.ts:225`) **before** calling `discoverArchifyTargets(cwd)` (`diagrams.ts:246`). Under overlapping `bun test` runs, `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}diagrams-${Date.now()}` can collide on millisecond boundaries so another process's `afterEach` cleanup deletes `sandbox` during the async `await` gap between line 113 and line 246. Switching to `mkdtempSync` eliminates inter-process path collisions.
  - **No other semantic constant misuse:** Remaining numeric literals in `*.test.ts` are test-local fixtures/assertions (e.g., `cli_config_boundaries.test.ts:228,232` sleeper `60000` / `timeoutMs: 250`, `rollback_and_gate_boundaries.test.ts:152` `maxProbes: 8`, `resilience_and_catalog_combinations.test.ts:104,111` `1_200_000` / `300_000`, `f06_f09_runtime_pal_facade.test.ts:48,55` pids `1234` / `5678`). String paths like `"/tmp/e2e-home"` (`f01_f05:151-153`), `"/tmp/workspace/demo-repo"` (`cli_config_boundaries:213-215`), and `"/tmp/gate1-boundary-check"` (`rollback_and_gate_boundaries:108`) are used purely for in-memory path resolution / boundary checks with zero disk I/O.
  - Zero `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, inline function-body comments, or stubs/mocks anywhere in `test/e2e/`.

---

## 2. Findings: `TEST_INFRA.md` Arithmetic & `TEST_READY.md` Audit

### 2.1 `TEST_INFRA.md` Lines 71–93 Arithmetic Verification
Programmatically verified every row of the coverage matrix in `/home/antigravity/sastiam/openspec-cascade/TEST_INFRA.md:71-91`:
- **T1 column sum:** `19 * 3` (`F01, F02, F04–F20`) `+ 2` (`F03`) `+ 0` (`Cross-Cutting`) `= 59` (Line 93 currently states `58 T1` — **off by -1**).
- **T2 column sum:** `15 * 3` `+ 5 * 4` (`F02, F03, F06, F12, F16`) `+ 2` (`Cross-Cutting`) `= 67` (Line 93 currently states `64 T2` — **off by -3**).
- **T3 column sum:** `16 * 3` `+ 4 * 2` (`F02, F06, F12, F16`) `+ 4` (`Cross-Cutting`) `= 60` (Matches `60 T3` on line 93).
- **T4 column sum:** `18 * 2` `+ 2 * 3` (`F15, F20`) `+ 4` (`Cross-Cutting`) `= 46` (Line 93 currently states `50 T4` — **off by +4**).
- **Grand Total:** `59 + 67 + 60 + 46 = 232` (matches `232` and the sum of row totals `18 * 11 + 2 * 12 + 10 = 232`).
- **Required fix at `TEST_INFRA.md:93`:** Update `(58 T1 + 64 T2 + 60 T3 + 50 T4)` to `(59 T1 + 67 T2 + 60 T3 + 46 T4)`.
- **Minor metadata note:** `TEST_INFRA.md:3` still displays `sub_orch_e2e_1` (optional update to `sub_orch_e2e_2` or keep track note).

### 2.2 `TEST_READY.md` Audit vs `PROJECT.md` & Current Repo State
- **Per-file test inventory (`TEST_READY.md:32-45`):** Matches actual `test(` counts across all 14 E2E test files (`7+7+3+5+3` T1 = 25; `7+7+6` T2 = 20; `4+4+4` T3 = 12; `3+2+2` T4 = 7; total `64` tests across `14` files).
- **Verification counts & timings (`TEST_READY.md:9,15,16`):**
  - Currently lists `[19.38s]` (`bun test test/e2e`) and `[38.58s]` (`bun test`) from Iteration 1. Must be refreshed with post-remediation Iteration 2 runs (`test_writer` should re-run all 4 verification commands and update lines 9, 15, 16 verbatim).
- **Metadata / Milestone status alignment (`TEST_READY.md:3,64` vs `PROJECT.md:58-65`):**
  - `TEST_READY.md:3` references `sub_orch_e2e_1` (Iteration 2 is `sub_orch_e2e_2`).
  - `TEST_READY.md:64` marks `- [x] **M1 (`F01–F05`):** ... (active and verified in Phase A)` whereas `PROJECT.md:60` still shows `M1` as `IN_PROGRESS` (though `src/config/{constants,schemas,guardrails,loader,index}.ts`, `test/config/*.test.ts`, and `openspec/changes/cascade-m1-config-guardrails/tasks.md` with all `[x]` tasks exist on disk and are active in `cascade.ts`/`config.ts`). Clarifying in `TEST_READY.md:64` that M1 modules are active on the working tree while `PROJECT.md` formally tracks M1 as `IN_PROGRESS` avoids any status discrepancy.

---

## 3. Baseline Verification & Git Status

### 3.1 `PROJECT.md` Milestone Statuses (`PROJECT.md:58-65`)
- `M0` (Env Provisioning & Git Sync): `DONE`
- `E2E` (E2E Testing Track): `IN_PROGRESS`
- `M1` (Zero Magic Numbers, Zod Config & Guardrails): `IN_PROGRESS`
- `M2`–`M6`: `PLANNED`

### 3.2 Read-Only Verification Baseline (Pre-Iteration 2 Edits)
Executed with `export PATH="$HOME/.bun/bin:$PATH"` from `/home/antigravity/sastiam/openspec-cascade`:
- `bunx tsc --noEmit`: **exit `0`** (0 errors)
- `bunx eslint .`: **exit `0`** (0 errors, 0 warnings)
- `bun test test/e2e`: **exit `0`** — `64 pass, 0 fail, 347 expect() calls, Ran 64 tests across 14 files. [32.24s]`
- `bun test`: **exit `0`** — `1757 pass, 0 fail, 8599 expect() calls, Ran 1757 tests across 65 files. [44.91s]`
- `/tmp/cascade-e2e-*` after completion: `NO_LEAKED_TMP` (0 leftover temp dirs).

### 3.3 Git Branch & `git status --short`
- **Current branch:** `feat/cascade-looper-v2` (at commit `70e253795eeace77666c3dc69aa39f95464d7cd6`).
- **Tracked modified (`M`, 24 files):** M1 source/test changes (`antigravity.ts`, `bun.lock`, `cascade.ts`, `config.ts`, `engine.test.ts`, `eslint.config.js`, `lint.test.ts`, `opencode.ts`, `package.json`, `platform.test.ts`, `platform.ts`, `projects/agnostic_looper/verify_project_items.ts`, `src/engine/rollback_buffer.ts`, `src/integration/github_project.ts`, `src/pal/adapters/{claude,gemini,jules,opencode}.ts`, `test/integration/github_project.test.ts`) plus `.agents/teamwork/ORIGINAL_REQUEST.md`, `.agents/teamwork/worker_m1_1/handoff.md`, and `.agents/teamwork/reviewer_INTEG-RUN-001/{DISPATCH.md,progress.md,review_feedback.xml}`.
- **Untracked (`??`):** `PROJECT.md`, `TEST_INFRA.md`, `TEST_READY.md`, `openspec/changes/cascade-m1-config-guardrails/`, `src/config/`, `test/config/`, `test/e2e/`, and `.agents/teamwork/*`.
