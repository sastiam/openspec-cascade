# Tasks: Milestone M1 (F01–F05)

## 1. Dependencies & OpenSpec Foundation
- [x] 1.1 Create and validate OpenSpec change `cascade-m1-config-guardrails` (`bunx openspec validate cascade-m1-config-guardrails --strict`).
- [x] 1.2 Install `zod` in `package.json` (`bun add zod`) and update `bun.lock`.

## 2. Centralized Immutable Constants Registry (F01)
- [x] 2.1 Implement strongly-typed `as const` namespaces in `src/config/constants.ts` (`RUNTIME_CONSTANTS`, `ENGINE_CONSTANTS`, `BUDGET_CONSTANTS`, `TIMEOUT_CONSTANTS`, `GIT_CONSTANTS`, `SDD_CONSTANTS`, `DIAGRAM_CONSTANTS`, `EXIT_CODE_CONSTANTS`, `FORMAT_CONSTANTS`, `GREPTILE_CONSTANTS`, `TELEMETRY_CONSTANTS`, `GUARDRAIL_CONSTANTS`, `VERIFY_CONSTANTS`) eliminating magic numbers.
- [x] 2.2 Reconcile drifting constants (`RATE_LIMIT_SLEEP_MS`, default models, truncation bounds, exit codes) in `src/pal/adapters/{claude,gemini,opencode,jules}.ts` and `src/engine/rollback_buffer.ts` cleanly without breaking existing PAL/gate tests.
- [x] 2.3 Compose `CONSTANTS` in `config.ts` from `src/config/constants.ts` namespaces preserving all existing properties.

## 3. Strict Zod Boundary Validation & CLI Schemas (F02)
- [x] 3.1 Implement `ConfigValidationError` (`issues`, `exitCode = 2`), strict finite-number and boolean preprocessors (rejecting `NaN`, `Infinity`, empty strings, negative budgets/timeouts, out-of-range percentages) in `src/config/schemas.ts`.
- [x] 3.2 Implement `EngineTypeSchema`, `EffortLevelSchema`, `ExecutionModeSchema`, `RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `TelemetryConfigSchema`, `DiagramsConfigSchema`, `CascadeFileConfigSchema`, and `CascadeConfigSchema` in `src/config/schemas.ts`.

## 4. Security & Well-Architected Guardrails (F03)
- [x] 4.1 Implement `BudgetExceededError` and `enforceSessionBudget` (fail-closed on `NaN`/non-finite/non-positive and strict `>=` boundary) in `src/config/guardrails.ts`.
- [x] 4.2 Implement `redactSensitiveData` with `WeakSet` circular-ref detection (`"[Circular]"`), bounded `maxDepth` (`"[MaxDepth]"`), container preservation (`Array`, `Map`, `Set`, `Date`, `RegExp`, `Error`), and key/token/PEM/URL-credential redaction in `src/config/guardrails.ts`.
- [x] 4.3 Implement `ProtectedBranchError` and `evaluateProtectedBranchGuard` blocking non-dry-run mutations on `main`/`master`/`stable` while allowing `--dry-run` preview with warning in `src/config/guardrails.ts`.

## 5. Layered Dynamic Stack Loader & Lazy CLI Entrypoint (F04)
- [x] 5.1 Implement `hasLockfile` and `tryDetectPackageManager` in `platform.ts` while preserving `detectPackageManager` contract and removing `any` leaks and inline comments.
- [x] 5.2 Implement `src/config/loader.ts` and `src/config/index.ts` with strict `parseCliArgs` (`strict: true`, `--budget`/`--max-budget`, `--total-budget`, `--usage-limit`, `--max-turns`, `--max-attempts`, `--mode`, `--config`), synchronous `.openspec-cascade.json` loader, layered precedence (`overrides > CLI > env > file > defaults`), dynamic stack verification resolution, `buildConfig`, `getDefaultConfig`, `resolveEngine`, `resolveLogDir`, `isKeepAliveEnabled`, and updated `formatHelp()`.
- [x] 5.3 Refactor `config.ts` into a backward-compatible facade re-exporting from `src/config/`.
- [x] 5.4 Refactor `cascade.ts` to remove import-time `loadConfig()` side effects, load config lazily in `main()`/`runCli()`, exit fail-closed (`2`) on `ConfigValidationError`/`Fatal`, wire `enforceSessionBudget`, `redactSensitiveData` in `log()`, `evaluateProtectedBranchGuard` in `preflight()`, and dynamic stack commands in `verifyCommands()`.

## 6. Strict TypeScript, ESLint No-Explicit-Any & Clean Code Compliance (F05)
- [x] 6.1 Update `eslint.config.js` to ignore `".agents/**"` and enable `"@typescript-eslint/no-explicit-any": "error"`.
- [x] 6.2 Eliminate all 15 AST `any` leaks across `platform.ts`, `opencode.ts`, `antigravity.ts`, `src/pal/adapters/gemini.ts`, `projects/agnostic_looper/verify_project_items.ts`, `engine.test.ts`, `platform.test.ts`, and `test/integration/github_project.test.ts` (exporting `RawProjectV2ItemNode` from `src/integration/github_project.ts`), plus remove inline function-body comments across all M1-created and M1-modified files.
- [x] 6.3 Expand `lint.test.ts` to cover `src/**/*.ts` and add `@typescript-eslint/no-explicit-any` test assertions.

## 7. Unit/Integration Tests & Full Verification
- [x] 7.1 Write real unit/integration tests in `test/config/constants.test.ts`, `test/config/schemas.test.ts`, `test/config/guardrails.test.ts`, `test/config/loader.test.ts` and update `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `lint.test.ts`.
- [x] 7.2 Run `bun test`, `bun run typecheck`, `bun run lint`, `bunx openspec validate cascade-m1-config-guardrails --strict`, and CLI fail-closed exit-code checks (`2` on invalid input, `0` on `--help`).
- [x] 7.3 Harden Iteration 2 config & guardrails invariants: enforce `int: true` on `usageLimitPercent` and `tokenWatermarkPercent`, add domain-scoped minimum constants (`TIMEOUT_CONSTANTS.MIN_DURATION_MS`, `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`, `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`), enforce strict `logDir` precedence (`overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`), wrap `CASCADE_CHANGES` and `CASCADE_LOG_DIR` with `nonBlankEnv`, fail closed (`ConfigValidationError`, exit code `2`) on empty `--repo ""` / `CASCADE_REPO=""` / `overrides.repo: ""` / `--log-dir ""` / `overrides.logDir: ""` via `assertNonEmptyExplicitString` before path normalization or file-config loading, and use `Object.defineProperty` (`defineOwnEnumerableProperty`) in `redactSensitiveData` (`redactRecordValue`, `redactErrorValue`) for prototype-safe `"__proto__"` and `null`-prototype preservation.
- [x] 7.4 Remove all remaining inline `//` comments inside function bodies across M1-modified `src/` and test files (`src/engine/rollback_buffer.ts`, `src/pal/adapters/claude.ts`, `src/pal/adapters/gemini.ts`, `src/pal/adapters/opencode.ts`, `src/pal/adapters/jules.ts`, `src/integration/github_project.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `test/integration/github_project.test.ts`) for Clean Code Rule #1 compliance.
- [x] 7.5 Add zero-stub regression tests in `test/config/{constants,schemas,guardrails,loader}.test.ts` (including `runCli` exit code `2` with zero `logDir` side effects) and stabilize `cascade.test.ts` keep-alive CLI timeouts (`15_000` ms).
