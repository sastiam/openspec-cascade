# Dispatch: worker_m1_1 (Milestone M1 Implementation — F01–F05)

- **Agent Type:** `teamwork_preview_worker`
- **Role:** M1 Implementation Worker
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/worker_m1_1`
- **Handoff Path:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/worker_m1_1/handoff.md`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`
- **Scope:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/SCOPE.md`
- **Explorer Reports:**
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/explorer_m1_1/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/explorer_m1_2/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/explorer_m1_3/handoff.md`

## INTEGRITY WARNING (MANDATORY)
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A `teamwork_preview_auditor` will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership Boundaries
- **ALLOWED to create/edit:**
  - `openspec/changes/cascade-m1-config-guardrails/**`
  - `package.json`, `bun.lock` (via `bun add zod`)
  - `src/config/**` (`constants.ts`, `schemas.ts`, `guardrails.ts`, `loader.ts`, `index.ts`)
  - `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`
  - `src/pal/adapters/gemini.ts`, `src/pal/adapters/claude.ts`, `src/pal/adapters/opencode.ts`, `src/pal/adapters/jules.ts` (constant unification & `any` fix)
  - `src/integration/github_project.ts` (export `RawProjectV2ItemNode` for typing `test/integration/github_project.test.ts`), `src/engine/rollback_buffer.ts`, `src/gates/*` (only if unifying drifting constants/unused imports cleanly without breaking tests)
  - `projects/agnostic_looper/verify_project_items.ts`
  - `eslint.config.js`
  - `lint.test.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `engine.test.ts`, `test/integration/github_project.test.ts`, `test/config/*.test.ts`
- **FORBIDDEN to touch:**
  - `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md`, `.agents/**` (except your own `handoff.md`)
  - Do NOT run `git commit` or `git push` (commit/push happens only after Gate PASS).

## Implementation Requirements
1. **OpenSpec SDD Change FIRST (`openspec/changes/cascade-m1-config-guardrails/`):**
   - Run `export PATH="$HOME/.bun/bin:$PATH" && bunx openspec new change cascade-m1-config-guardrails --schema spec-driven`.
   - Author `proposal.md`, `design.md`, `specs/config-guardrails/spec.md` (`SHALL`/`MUST` on the first line of every requirement body + `#### Scenario:` blocks with `WHEN`/`THEN`), and `tasks.md` (with overlapping keywords for `analyzeChangeArtifacts`).
   - Run `bunx openspec validate cascade-m1-config-guardrails --strict` BEFORE writing production code.
2. **Install `zod`:**
   - Run `export PATH="$HOME/.bun/bin:$PATH" && bun add zod` and confirm `package.json` + `bun.lock` updated.
3. **F01 (`src/config/constants.ts`):**
   - Define strongly-typed `as const` immutable namespaces eliminating magic numbers (`RUNTIME_CONSTANTS`, `ENGINE_CONSTANTS`, `BUDGET_CONSTANTS`, `TIMEOUT_CONSTANTS`, `GIT_CONSTANTS`, `SDD_CONSTANTS`, `DIAGRAM_CONSTANTS`, `EXIT_CODE_CONSTANTS`, `FORMAT_CONSTANTS`, `GREPTILE_CONSTANTS`, `TELEMETRY_CONSTANTS`, `GUARDRAIL_CONSTANTS`, `VERIFY_CONSTANTS`).
   - Compose `CONSTANTS` in `config.ts` from these namespaces so every existing `CONSTANTS.*` property remains identical for all 18 consumers.
   - Reconcile drifting constants in `src/` (check existing `test/pal/` and `test/gates/` tests so behavior stays accurate and tested; note `RATE_LIMIT_SLEEP_MS` `1_800_000` vs `30_000`, `DEFAULT_MODEL`, `STDERR_TAIL_MAX_LENGTH`, `EXIT_CODE_*`).
4. **F02 (`src/config/schemas.ts`):**
   - Export `ConfigValidationError` (with `issues: readonly string[]`, `exitCode: 2`).
   - Implement strict finite-number & boolean preprocessors (NO raw `z.coerce.number()` trap on `""` or `true`). Reject `NaN`, `Infinity`, `-Infinity`, negative budgets/timeouts, and out-of-range percentages.
   - Export `EngineTypeSchema`, `EffortLevelSchema`, `ExecutionModeSchema`, `RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `TelemetryConfigSchema`, `DiagramsConfigSchema`, `CascadeFileConfigSchema` (`.strict()` partial), and `CascadeConfigSchema`.
   - Ensure zero TypeScript errors (`strict: true`, `noUncheckedIndexedAccess: true`).
5. **F03 (`src/config/guardrails.ts`):**
   - `enforceSessionBudget(spentUsd: number, maxBudgetUsd: number): void`: throw `BudgetExceededError` if `!Number.isFinite(spentUsd) || spentUsd < 0 || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0 || spentUsd >= maxBudgetUsd`.
   - `redactSensitiveData<T>(value: T, maxDepth?: number): T`: `WeakSet` circular-ref detection (`"[Circular]"`), bounded recursion depth (`"[MaxDepth]"`), preserves `Array`, `Map`, `Set`, `Date`, `RegExp`, `Error`, and plain objects, redacts sensitive keys and token/secret/PEM/URL-credential patterns.
   - `ProtectedBranchError` & `evaluateProtectedBranchGuard({ branch, protectedBranches, dryRun })`: hard-blocks non-dry-run on `main`, `master`, `stable`; allows `--dry-run` with warning.
6. **F04 (`src/config/loader.ts`, `src/config/index.ts`, `config.ts`, `platform.ts`, `cascade.ts`):**
   - Strict `parseCliArgs` (`strict: true`, throw `ConfigValidationError` on invalid/unknown flags, never swallow errors). Add `--budget`/`--max-budget`, `--total-budget`, `--usage-limit`, `--max-turns`, `--max-attempts`, `--mode`, `--config`. Update `formatHelp()`.
   - Synchronous `.openspec-cascade.json` loader (missing default file falls back to `{}`; explicit `--config`/`CASCADE_CONFIG` missing or malformed/invalid JSON throws `ConfigValidationError`).
   - Precedence: `overrides` > `CLI args` > `CASCADE_* env` > `.openspec-cascade.json` > `dynamic/repo defaults`.
   - Support both `loadConfig(options?: LoadConfigOptions)` and `loadConfig(argv?: string[], env?: Record<string, string | undefined>)`; export `buildConfig`, `getDefaultConfig`, `resolveEngine`, `resolveLogDir`, `isKeepAliveEnabled`.
   - Add `hasLockfile(cwd)` / `tryDetectPackageManager(cwd)` in `platform.ts` (preserving `detectPackageManager` contract). Wire into `loadConfig()` and `cascade.ts:verifyCommands()` so real repos with `npm`/`pnpm`/`yarn`/`bun` lockfiles resolve dynamic commands (Nuxt `.nuxt/` only when detected), while non-existent mock paths like `/mock/repo` preserve `CONSTANTS.DEFAULT_VERIFY` / `FULL_VERIFY` for `config.test.ts`.
   - Remove import-time `loadConfig()` side-effect in `cascade.ts:102`. Move config loading into `main()` / `runCli(argv, env)` catching `ConfigValidationError` & `Fatal` with exit code `2`. Wire `enforceSessionBudget`, `redactSensitiveData` in `log()`, and `evaluateProtectedBranchGuard` in `preflight()`.
7. **F05 (Strict TS, ESLint & Clean Code):**
   - `eslint.config.js`: add `".agents/**"` to `ignores`, enable `"@typescript-eslint/no-explicit-any": "error"`.
   - Fix all 15 AST `any` errors across all 8 files (`platform.ts`, `opencode.ts`, `antigravity.ts`, `src/pal/adapters/gemini.ts`, `projects/agnostic_looper/verify_project_items.ts`, `engine.test.ts`, `platform.test.ts`, `test/integration/github_project.test.ts`).
   - Expand `lint.test.ts` to cover `src/**/*.ts` (e.g. `["*.ts", "src/**/*.ts", "projects/**/*.ts", "test/**/*.ts"]`) and add `@typescript-eslint/no-explicit-any` test coverage.
   - Clean Code Rule #1: Zero inline `//` comments inside function bodies in ALL M1-created and M1-modified files (`src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `projects/agnostic_looper/verify_project_items.ts`, `src/pal/adapters/gemini.ts` where touched).
8. **Tests & OpenSpec Completion:**
   - Write comprehensive real tests in `test/config/` (`constants.test.ts`, `schemas.test.ts`, `guardrails.test.ts`, `loader.test.ts`) and update `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `lint.test.ts`. Zero fake stubs/mocks.
   - Check off all completed tasks (`- [x]`) in `openspec/changes/cascade-m1-config-guardrails/tasks.md`.
   - Run full verification:
     - `bun test`
     - `bun run typecheck`
     - `bun run lint`
     - `bunx openspec validate cascade-m1-config-guardrails --strict`
     - CLI fail-closed smoke checks (`--engine invalid`, `--unknown-flag`, `--budget -5`, `--budget abc` -> exit `2`; `--help` -> exit `0`).
   - Check `git status`: restore `.agents/teamwork/reviewer_INTEG-RUN-001/` with `git checkout -- .agents/teamwork/reviewer_INTEG-RUN-001/` if `bun test` dirtied it.
