# Review Handoff: `reviewer_e2e_1`

- **Author:** `reviewer_e2e_1` (`teamwork_preview_reviewer`)
- **Parent:** `sub_orch_e2e_1`
- **Target:** `test_writer_e2e_1` Phase A E2E Test Infrastructure & Suites
- **Verdict:** `REQUEST_CHANGES`
- **Timestamp:** `2026-11-15T02:20:00Z`

---

## 1. Independent Verification Results

Executed independently with `export PATH="$HOME/.bun/bin:$PATH"` from `/home/antigravity/sastiam/openspec-cascade`:

| Command | Exit Code | Verbatim Result |
|---|---|---|
| `bunx tsc --noEmit` | `0` | 0 TypeScript errors (`strict: true`, `noUncheckedIndexedAccess: true`) |
| `bunx eslint .` | `0` | 0 errors, 0 warnings across repository and `test/e2e/` |
| `bun test test/e2e` | `0` | `64 pass, 0 fail, 347 expect() calls, Ran 64 tests across 14 files. [46.59s]` |
| `bun test` | `0` | `1757 pass, 0 fail, 8599 expect() calls, Ran 1757 tests across 65 files. [39.28s]` |
| Temp & git hygiene check | `0` | Zero leftover `/tmp/cascade-e2e-*` directories after completion; `git status --short` shows no unintended workspace mutations from `test/e2e/` |

---

## 2. Detailed Audit Findings

### What Passed Cleanly
- **Zero Stubs / Zero Reference Harnesses:** Inspected all 14 E2E test files (`tier1_features/`, `tier2_boundaries/`, `tier3_combinations/`, `tier4_scenarios/`) and `helpers/`. Zero occurrences of `reference_pal`, `reference_spawner`, or mocked production facades. Every test invokes real CLI subprocesses (`cascade.ts`, `plugins/cascade/hooks/sdd_gate.mjs`, `bin/install.mjs`, `openspec`) or imports genuine production modules (`config.ts`, `platform.ts`, `qa.ts`, `engine.ts`, `cascade.ts`, `skills.ts`, `diagrams.ts`, `src/pal/*`, `src/sdd/*`, `src/gates/*`, `src/core/*`, `src/storage/*`, `src/engine/*`, `src/integration/*`). The only `any` / `mock` / `// stub` occurrences in `test/e2e/` are string-literal inputs passed to `scanDiffForCleanCode`, `Gate3AntiCheatScanner.scanContent`, and `Gate3Auditor.runAudit` to verify anti-cheat/rubric detection.
- **Strict Typing & Clean Code:** Zero `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, or inline function-body comments across `test/e2e/`.
- **Real Subprocess Isolation & Timeout Cleanup:** `test/e2e/helpers/cli_runner.ts` executes `cascade.ts` via `process.execPath`, strips inherited `CASCADE_*` / `ARCHIFY_BIN` variables, isolates `HOME` and `XDG_CACHE_HOME` under `os.tmpdir()`, enforces `SIGKILL` subprocess timeouts in `finally`, and cleans up temporary `homeDir` instances.
- **Phase A vs Phase B Separation:** `TEST_READY.md` accurately reports only verified counts (`64 pass`, `347 expect()`, `14` files; `1757 pass`, `8599 expect()`, `65` files) and clearly separates Phase A from M2–M6 Phase B expansion gates. `TEST_INFRA.md` maps all 20 features (`F01–F20`) across Tiers 1–4 plus the `test/e2e/tier5_adversarial/` slot.

### Blocking Findings Requiring Fixes (`REQUEST_CHANGES`)

1. **Semantic Misuse of Constant / Magic-Number Workaround (`test/e2e/helpers/temp_repo.ts:145`):**
   - **Location:** `/home/antigravity/sastiam/openspec-cascade/test/e2e/helpers/temp_repo.ts:145`
   - **Finding:** `createTempGitRepo` writes `package.json` using:
     ```ts
     `${JSON.stringify(options.packageJson, null, E2E_CONSTANTS.EXIT_CODE_FATAL)}\n`
     ```
     Passing `EXIT_CODE_FATAL` (which happens to be `2`) as the `space` indentation parameter to `JSON.stringify` violates `openspec/project.md` Principle #2 ("Zero Magic Numbers" with intention-revealing centralized constants) and Principle #4 ("Clean Code" self-documenting naming) by borrowing an unrelated process exit-code constant to satisfy `@typescript-eslint/no-magic-numbers`.
   - **Required Fix:** Define `JSON_INDENT_SPACES: 2` in `E2E_CONSTANTS` (`test/e2e/helpers/constants.ts`) and pass `E2E_CONSTANTS.JSON_INDENT_SPACES` at `test/e2e/helpers/temp_repo.ts:145`.

2. **Tier Breakdown Arithmetic Mismatch (`TEST_INFRA.md:93`):**
   - **Location:** `/home/antigravity/sastiam/openspec-cascade/TEST_INFRA.md:93`
   - **Finding:** Line 93 states `**Planned Total:** 232 tests across Phase A + Phase B (58 T1 + 64 T2 + 60 T3 + 50 T4)`, whereas summing the `T1/T2/T3/T4` columns in lines 71–91 actually yields `59 T1 + 67 T2 + 60 T3 + 46 T4 = 232`:
     - T1: `19 * 3 + 2 (F03) + 0 = 59`
     - T2: `15 * 3 + 5 * 4 (F02, F03, F06, F12, F16) + 2 (Cross-Cutting) = 67`
     - T3: `16 * 3 + 4 * 2 (F02, F06, F12, F16) + 4 (Cross-Cutting) = 60`
     - T4: `18 * 2 + 2 * 3 (F15, F20) + 4 (Cross-Cutting) = 46`
   - **Required Fix:** Update line 93 in `TEST_INFRA.md` to `(59 T1 + 67 T2 + 60 T3 + 46 T4)` so the breakdown matches the feature matrix columns verbatim.

### Non-Blocking Advisory Note
- In `f01_f05_config_cli_lint.test.ts` (`lines 109, 193, 208`) and `f17_f20_telemetry_hygiene_docs.test.ts` (`lines 62, 96, 141`), temp sandboxes are created with `join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}...-${Date.now()}`)` + `mkdirSync`. Prefer `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))` for collision-free uniqueness.

---

## 3. Verdict

**`REQUEST_CHANGES`** — Fix the two targeted issues (`E2E_CONSTANTS.JSON_INDENT_SPACES` in `constants.ts`/`temp_repo.ts:145` and the column-sum breakdown in `TEST_INFRA.md:93`), then re-run `bunx tsc --noEmit`, `bunx eslint .`, `bun test test/e2e`, and `bun test`.
