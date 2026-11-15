# Milestone M1 Scope (F01–F05)

## In-Scope Features
1. **OpenSpec SDD Change (`openspec/changes/cascade-m1-config-guardrails/`)**:
   - `proposal.md`, `design.md`, `specs/config-guardrails/spec.md` (`SHALL`/`MUST` on first line of requirement bodies), `tasks.md` (100% requirement-to-task coverage, all checked off after completion).
   - Must pass `openspec validate cascade-m1-config-guardrails --strict`.
2. **F01 (`src/config/constants.ts`)**:
   - Strongly-typed immutable constant namespaces eliminating magic numbers and unifying `config.ts` + drifting `src/` constants (e.g., `RATE_LIMIT_SLEEP_MS`, default models, timeouts).
3. **F02 (`src/config/schemas.ts`)**:
   - Add `zod` to `package.json` (`dependencies`) + update `bun.lock`.
   - Define strict Zod schemas: `RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `TelemetryConfigSchema`, `CascadeConfigSchema`.
   - Strict numeric coercion for CLI flags (`--budget`, `--usage-limit`, `--max-turns`, etc.) rejecting `NaN`/negative/out-of-bounds values and **fail-closed with exit code `2`** on invalid CLI flags or config.
4. **F03 (`src/config/guardrails.ts`)**:
   - `enforceSessionBudget(spentUsd, maxBudgetUsd)`: reject `NaN` (fail-closed) and enforce strict `>=` boundary (`spentUsd >= maxBudgetUsd`).
   - `redactSensitiveData(value, maxDepth)`: `WeakSet` circular-reference detection (`[Circular]`), bounded recursion depth, preserves container types (`Array`, `Map`, `Set`, `Date`, `RegExp`, plain objects), redacts API keys/tokens/secrets without throwing on cycles.
   - Protected-branch dry-run guard (`main`, `master`, `stable`).
5. **F04 (`src/config/loader.ts`, `src/config/index.ts`, refactored `config.ts`, `platform.ts`, `cascade.ts`)**:
   - Layered precedence (`CLI args` > `CASCADE_* env` > `.openspec-cascade.json` > `defaults`).
   - Wire `platform.ts`'s `detectPackageManager()` and `resolvePackageCommands()` into config/verification defaults (no hardcoded Bun/Nuxt/Drizzle for arbitrary repos).
   - Remove import-time `loadConfig()` side-effect in `cascade.ts` while keeping backward-compatible exported APIs (`CONSTANTS`, `CascadeConfig`, `buildConfig`, `resolveEngine`, `resolveLogDir`).
6. **F05 (Strict TypeScript, ESLint & Clean Code)**:
   - Enable `@typescript-eslint/no-explicit-any: "error"` in `eslint.config.js`.
   - Expand `lint.test.ts` to cover `src/**/*.ts`.
   - Fix ALL existing `any` leaks (`platform.ts`, `opencode.ts`, `antigravity.ts`, `src/pal/adapters/gemini.ts`, `projects/agnostic_looper/verify_project_items.ts`, etc.) and any ESLint errors across `src/`.
   - Clean Code Rule #1: ZERO inline comments inside function bodies (docstrings for WHY only).
   - Real unit/integration tests (`test/config/*.test.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`) with ZERO fake stubs/mocks.

## Out of Scope / Write Boundaries
- Do NOT touch `TEST_INFRA.md`, `TEST_READY.md`, or `test/e2e/**` (owned by `sub_orch_e2e_1`).
- Do NOT implement M2–M6 features (`src/runtime/`, `src/pal/factory.ts`, `src/decorators/`, `src/facade/`, `src/integration/greptile/`, `src/core/harness_injector.ts`, `src/core/self_improver.ts`).
- Do NOT touch `main` branch.
