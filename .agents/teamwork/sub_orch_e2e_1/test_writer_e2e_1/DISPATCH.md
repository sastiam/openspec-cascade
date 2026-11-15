# Dispatch — `test_writer_e2e_1`

- **Role:** `teamwork_preview_test_writer`
- **Parent:** `sub_orch_e2e_1`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (read `## 2026-11-15T01:46:44Z`)
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`
- **Scope:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/SCOPE.md`
- **Explorer Findings (MUST READ ALL 3):**
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/explorer_e2e_1/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/explorer_e2e_2/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/explorer_e2e_3/handoff.md`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/test_writer_e2e_1/handoff.md`

## Mandatory Integrity Warning (VERBATIM)
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Strict Write-Ownership Boundaries
You may ONLY create/edit:
- `/home/antigravity/sastiam/openspec-cascade/TEST_INFRA.md`
- `/home/antigravity/sastiam/openspec-cascade/TEST_READY.md`
- `/home/antigravity/sastiam/openspec-cascade/test/e2e/**`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/test_writer_e2e_1/handoff.md`

NEVER edit `src/**`, root `*.ts`, `package.json`, `eslint.config.js`, `tsconfig.json`, `openspec/**`, or any other `.agents/` files.
NEVER run `git commit` or `git push`.

## Deliverables & Technical Requirements

### 1. `TEST_INFRA.md` (Repo Root)
Design the comprehensive E2E test architecture covering ALL 20 features (`F01–F20` in `PROJECT.md`) across Tiers 1–4 (~11 tests × 20 features + ~10 cross-cutting = ~230 tests total plan) plus Tier 5 Adversarial Hardening slot:
- **Tier 1 (`test/e2e/tier1_features/`)**: Single-feature E2E & CLI behavior
- **Tier 2 (`test/e2e/tier2_boundaries/`)**: Boundary, invalid input, timeout, and failure modes
- **Tier 3 (`test/e2e/tier3_combinations/`)**: Multi-feature combinations & matrix interactions
- **Tier 4 (`test/e2e/tier4_scenarios/`)**: Full end-to-end user & failure/rollback journeys
- **Tier 5 (`test/e2e/tier5_adversarial/`)**: Reserved Phase 2 / M6 adversarial hardening slot
- Explicitly tabulate **Phase A (Active Now)** vs **Phase B (Gated on M1–M5 `DONE` in `PROJECT.md`)** for each of `F01–F20`, listing exact real modules/CLI commands exercised and confirming ZERO fake stubs/mocks.

### 2. Real Opaque-Box Helpers (`test/e2e/helpers/`)
- `test/e2e/helpers/constants.ts`: Centralized `E2E_CONSTANTS` (exit codes `0`/`1`/`2`, subprocess/test timeouts, temp prefixes, default git user config, branch names, file names).
- `test/e2e/helpers/cli_runner.ts`:
  - `runCascadeCli(options)`: Executes real `cascade.ts` via `process.execPath` (Bun) with isolated `env`, `HOME`, `XDG_CACHE_HOME`, explicit timeout & kill cleanup, returning `{ exitCode, stdout, stderr, durationMs, timedOut }`. (Include `dirname(process.execPath)` + `/usr/bin:/bin` in default/merged `PATH` so `git` works even when testing custom `env`.)
  - `runNodeScript(scriptPath, args, options)`: Executes real Node scripts (`plugins/cascade/hooks/sdd_gate.mjs`, `bin/install.mjs`) via `node` with optional `stdin` input and isolated `env`/`cwd`.
  - `runOpenSpecCli(repoRoot, args)`: Executes `<repoRoot>/node_modules/.bin/openspec` (or repo's `node_modules/.bin/openspec`) against temp repos.
- `test/e2e/helpers/temp_repo.ts`:
  - `createTempGitRepo(options)`: Creates isolated `os.tmpdir()` git repo with initial commit, local git user config, configurable branch (default `feat/e2e-test`), optional dirty files, optional lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`), optional skills/directives (`.agents/skills/*/SKILL.md`, `AGENTS.md`, `CLAUDE.md`).
  - `addOpenSpecChange(repoDir, changeId, options)`: Scaffolds `openspec/config.yaml`, `openspec/project.md` (optional), `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, and `specs/<cap>/spec.md` compliant with `--strict` OpenSpec rules and `analyzeChangeArtifacts` keyword coverage.
  - `cleanupTempDir(dirPath)`: Safe `rmSync` cleanup in `try/finally` / `afterEach`.

### 3. Phase A Opaque-Box Tier 1–4 E2E Tests (`test/e2e/tier{1,2,3,4}_*/`)
Implement genuine, non-trivial opaque-box tests across all 4 tiers (14 test files as mapped in `explorer_e2e_3/handoff.md` §2.3, ~80–120+ real test cases):
- **CRITICAL BUILD SAFETY:** Do NOT import ANY unlanded M1–M5 module (`src/config/*`, `src/runtime/*`, `src/pal/factory.ts`, `src/decorators/*`, `src/facade/*`, `src/integration/greptile/*`, `src/core/harness_injector.ts`, `src/core/self_improver.ts`).
- **CRITICAL ZERO-STUB RULE:** NEVER create `reference_pal`, `reference_spawner`, or mocked/duplicated implementations. Every test MUST call the real CLI (`cascade.ts`, `sdd_gate.mjs`, `bin/install.mjs`, `openspec`) or real existing production modules (`config.ts`, `platform.ts`, `qa.ts`, `skills.ts`, `diagrams.ts`, `resilience.ts`, `src/sdd/*`, `src/engine/rollback_buffer.ts`, `src/core/*`, `src/gates/*`, `src/storage/memory.ts`, `src/pal/{normalizer,mcp,react_parser,types}`, `src/integration/{catalog_generator,drift_detector,schema_validator}`).
- **CRITICAL ISOLATION:** Always pass isolated temp dirs for `--repo`, `--log-dir`, `HOME`, `workspaceRoot`, `repoRoot`, `baseDir`, `cwd`. Never mutate the real workspace!
- **CRITICAL REALITY ALIGNMENT:** Test actual current behavior accurately (e.g., `cascade.ts` `--dry-run` on protected branch currently exits `2`; invalid `--engine` currently exits `1`; `parseCliArgs` currently uses `strict: false`; `detectPackageManager` priority order in `platform.ts`). Document planned M1–M5 behavioral shifts in `TEST_INFRA.md` Phase B.

### 4. `TEST_READY.md` (Repo Root)
Write a clear, accurate Phase A readiness report documenting the implemented `test/e2e/` files, exact verified counts from `bun test test/e2e`, `tsc --noEmit`, `eslint .`, and the Phase B expansion gate checklist tied to `PROJECT.md` M1–M5.

## Clean Code & TypeScript / ESLint Enforcement
- Zero `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`.
- Zero inline comments inside function bodies (JSDoc/TSDoc at declaration level only if needed for WHY).
- Every exported function in `helpers/*.ts` AND `*.test.ts` MUST have explicit parameter & return types (`@typescript-eslint/explicit-module-boundary-types: "error"`).
- Every number other than `-1, 0, 1` in `helpers/*.ts` MUST be a named `const` (`@typescript-eslint/no-magic-numbers: "error"` with `enforceConst: true`).
- Respect `noUncheckedIndexedAccess: true`.

## Mandatory Verification Before Reporting
Run with `export PATH="$HOME/.bun/bin:$PATH"`:
1. `bunx tsc --noEmit` (must exit `0`)
2. `bunx eslint .` (must exit `0`)
3. `bun test test/e2e` (must pass `0` failures, and verify `git status --short` on `test/e2e` / repo has zero unintended tracked mutations from E2E tests)
4. `bun test` (confirm full suite passes; note `test/gates/gate1_feedback.test.ts` is known to touch 3 tracked files in `.agents/teamwork/reviewer_INTEG-RUN-001/` — do not commit them).
Record exact commands and verbatim output counts in `handoff.md`, then call `send_message` to parent.
