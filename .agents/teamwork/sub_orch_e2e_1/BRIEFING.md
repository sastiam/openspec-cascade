# Briefing — `sub_orch_e2e_1` (E2E Testing Track Sub-Orchestrator)

- **Role:** E2E Testing Track Sub-Orchestrator (Dispatch-Only)
- **Parent:** `c2daf3a0e3806ea39f4fd8e1779b73da`
- **Working Directory:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1`
- **Repository Root:** `/home/antigravity/sastiam/openspec-cascade`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (`## 2026-11-15T01:46:44Z`)
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`

## Core Mission & Hard Constraints
1. **Opaque-Box, Requirement-Driven, ZERO Stubs/Mocks:**
   - NEVER create fake `reference_pal`, `reference_spawner`, or duplicated mock harnesses in `test/e2e/`.
   - Every test MUST exercise the real CLI (`bun run cascade.ts` / `node` CLI in isolated temp dirs/git repos) and/or real production module exports.
2. **TypeScript Build Safety (`tsconfig.json` includes `test/**/*.ts`):**
   - Implementation Track is building M1–M5 sequentially on `feat/cascade-looper-v2`.
   - Do NOT add static `import` statements to modules from M1–M5 that do not exist yet (`src/config/`, `src/runtime/`, `src/pal/factory.ts`, `src/decorators/`, `src/facade/`, `src/integration/greptile/`, `src/core/harness_injector.ts`, `src/core/self_improver.ts`) until `PROJECT.md` marks those milestones `DONE`.
   - **Phase A (current):** Design `TEST_INFRA.md` at repo root covering all 20 features (`F01–F20`) across Tiers 1–4 (~11×20 + 10 = ~230 tests plan), build real opaque-box CLI & subprocess E2E test harness (`test/e2e/helpers/cli_runner.ts`), and implement Tier 1–4 opaque-box tests targeting the real CLI and existing real modules so `tsc --noEmit`, `eslint .`, and `bun test` all pass cleanly right now.
3. **Write Ownership:** `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**` ONLY. Never edit `src/`, root `*.ts`, `package.json`, or `eslint.config.js`.
4. **No Concurrent Git Commits:** Do NOT run `git commit` or `git push` in E2E Track.
5. **Clean Code & Strict Typing:** Zero `any` / `as any`, zero magic numbers, zero inline function-body comments, `tsc --noEmit` and `eslint .` must exit `0`.
6. **Environment:** Always prepend `export PATH="$HOME/.bun/bin:$PATH"` before `bun` or `bunx`. Note `bun test` may touch 3 tracked files in `.agents/teamwork/reviewer_INTEG-RUN-001/` (do not commit them).
