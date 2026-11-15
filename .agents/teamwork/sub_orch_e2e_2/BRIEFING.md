# Briefing — `sub_orch_e2e_2` (E2E Testing Track Phase A — Iteration 2)

- **Role:** E2E Testing Track Sub-Orchestrator (Dispatch-Only, Iteration 2)
- **Parent:** `7130706a3851799c500958d404249b61`
- **Working Directory:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2`
- **Repository Root:** `/home/antigravity/sastiam/openspec-cascade`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (`## 2026-11-15T01:46:44Z`)
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`

## Core Mission & Hard Constraints
1. **Opaque-Box, Requirement-Driven, ZERO Stubs/Mocks:**
   - NEVER create fake `reference_pal`, `reference_spawner`, or duplicated mock harnesses in `test/e2e/`.
   - Every test MUST exercise the real CLI (`cascade.ts` / `node` CLI in isolated temp dirs/git repos) and/or real production module exports.
2. **TypeScript Build Safety (`tsconfig.json` includes `test/**/*.ts`):**
   - Do NOT add static `import` statements to unlanded M2–M5 modules until `PROJECT.md` marks those milestones `DONE`.
3. **Iteration 2 Remediation Scope:**
   - Define `JSON_INDENT_SPACES: 2` in `E2E_CONSTANTS` (`test/e2e/helpers/constants.ts`) and replace `E2E_CONSTANTS.EXIT_CODE_FATAL` at `test/e2e/helpers/temp_repo.ts:145`.
   - Fix `TEST_INFRA.md:93` Tier sum arithmetic breakdown to `(59 T1 + 67 T2 + 60 T3 + 46 T4)` matching lines 71–91.
   - Replace `${Date.now()}` temp directory construction in `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts` (lines 109, 193, 208) and `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` (lines 62, 96, 141) — and any other `Date.now()` temp paths found — with `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))` and deterministic cleanup.
   - Investigate and harden `f17_f20_telemetry_hygiene_docs.test.ts:136` (`syncResult.archify.length`) against any transient concurrency/state flake observed by `reviewer_e2e_2`.
   - Update `TEST_READY.md` with freshly verified test/typecheck/lint counts.
4. **Write Ownership:** `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**` ONLY. Never edit `src/`, root `*.ts`, `package.json`, `eslint.config.js`, `openspec/**`, `PROJECT.md`.
5. **No Concurrent Git Commits:** Do NOT run `git commit` or `git push`.
6. **Clean Code & Strict Typing:** Zero `any` / `as any`, zero magic numbers, zero inline function-body comments, `tsc --noEmit` and `eslint .` must exit `0`.
7. **Environment:** Always prepend `export PATH="$HOME/.bun/bin:$PATH"` before `bun` or `bunx`. Note `bun test` may touch 3 tracked files under `.agents/teamwork/reviewer_INTEG-RUN-001/` (never commit `.agents/teamwork/`).
