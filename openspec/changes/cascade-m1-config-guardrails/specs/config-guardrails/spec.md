# Spec: Milestone M1 Configuration, Guardrails, Stack Detection & Strict Hygiene

## ADDED Requirements

### Requirement: Centralized Immutable Constants Registry
The system MUST centralize all operational literals into strongly-typed `as const` namespaces in `src/config/constants.ts`, unify drifting constants across `src/`, and compose `CONSTANTS` in `config.ts` without breaking existing consumers.

#### Scenario: Centralized namespaces eliminate magic numbers and preserve CONSTANTS API
- **WHEN** consumers import `CONSTANTS` from `config.ts` or namespaces (`RUNTIME_CONSTANTS`, `ENGINE_CONSTANTS`, `BUDGET_CONSTANTS`, `TIMEOUT_CONSTANTS`, `GIT_CONSTANTS`, `SDD_CONSTANTS`, `DIAGRAM_CONSTANTS`, `EXIT_CODE_CONSTANTS`, `FORMAT_CONSTANTS`, `GREPTILE_CONSTANTS`, `TELEMETRY_CONSTANTS`, `GUARDRAIL_CONSTANTS`, `VERIFY_CONSTANTS`) from `src/config/constants.ts`
- **THEN** all properties remain immutable `as const` values and match all existing `CONSTANTS.*` keys and values

#### Scenario: Drifting rate-limit sleep and truncation constants are unified
- **WHEN** `src/pal/adapters/opencode.ts`, `src/pal/adapters/gemini.ts`, `src/pal/adapters/claude.ts`, `src/pal/adapters/jules.ts`, and `src/engine/rollback_buffer.ts` reference shared constants
- **THEN** rate-limit sleep, error truncation lengths, and exit codes derive from `src/config/constants.ts` without silent 60x drift

### Requirement: Strict Zod Boundary Validation and Fail-Closed CLI Parsing
The system MUST validate all configuration inputs (CLI flags, environment variables, `.openspec-cascade.json`, and programmatic overrides) through strict Zod schemas in `src/config/schemas.ts`, rejecting `NaN`, `Infinity`, empty strings, negative budgets/timeouts, out-of-range percentages, and unknown CLI flags or unknown config file keys with `ConfigValidationError` (`exitCode = 2`).

#### Scenario: Strict finite number and boolean coercion rejects invalid CLI or env values
- **WHEN** a user supplies `--budget -5`, `--budget abc`, `--budget ""`, `--usage-limit 150`, `--usage-limit 1.5`, `--max-turns 0`, `--repo ""`, `CASCADE_REPO=""`, `--log-dir ""`, or `--unknown-flag`
- **THEN** `parseCliArgs` and `loadConfig` throw `ConfigValidationError` with `exitCode === 2` before path normalization or file-config loading, and the CLI exits with status code `2` with zero log file or directory side effects

#### Scenario: Domain sub-schemas validate all configuration sections
- **WHEN** `RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `TelemetryConfigSchema`, `DiagramsConfigSchema`, `CascadeFileConfigSchema`, or `CascadeConfigSchema` parses configuration objects
- **THEN** valid objects pass with strict TypeScript types (`strict: true`, `noUncheckedIndexedAccess: true`), integer percentage checks (`usageLimitPercent`, `tokenWatermarkPercent`), and domain-scoped minimum constants (`TIMEOUT_CONSTANTS.MIN_DURATION_MS`, `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`, `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`), and invalid fields fail closed

### Requirement: Security and Well-Architected Guardrails
The system MUST enforce strict session/total budget boundaries, cycle-safe secret redaction, and protected-branch dry-run safety via `src/config/guardrails.ts`.

#### Scenario: Session and total budget enforcement fails closed on NaN and strict >= boundary
- **WHEN** `enforceSessionBudget(spentUsd, maxBudgetUsd)` is called with `NaN`, `Infinity`, negative `spentUsd`, non-positive `maxBudgetUsd`, or `spentUsd >= maxBudgetUsd`
- **THEN** it throws `BudgetExceededError` immediately

#### Scenario: Sensitive data redaction handles cycles, depth limits, containers, and secrets
- **WHEN** `redactSensitiveData(value, maxDepth)` processes objects containing circular references, nested `Array`/`Map`/`Set`/`Date`/`RegExp`/`Error` containers, `null`-prototype objects, `"__proto__"` keys, sensitive key names, API tokens, PEM private keys, or URL credentials
- **THEN** it replaces circular references with `"[Circular]"`, caps recursion at `maxDepth` with `"[MaxDepth]"`, preserves container types and prototypes without mutating `Object.getPrototypeOf`, preserves `"__proto__"` as a redacted own enumerable property via `Object.defineProperty`, and redacts sensitive secrets without throwing

#### Scenario: Protected branch guard blocks mutations while permitting dry-run preview
- **WHEN** `evaluateProtectedBranchGuard({ branch, protectedBranches, dryRun })` evaluates a protected branch (`main`, `master`, `stable`)
- **THEN** non-dry-run execution throws `ProtectedBranchError` (`allowed: false`) while `dryRun: true` returns `allowed: true` with a warning message

### Requirement: Layered Dynamic Stack Configuration Loader and Lazy CLI Entrypoint
The system MUST load configuration synchronously in `src/config/loader.ts` with precedence `overrides > CLI args > CASCADE_* env > .openspec-cascade.json > dynamic/repo defaults`, wire lockfile-based package manager detection from `platform.ts`, and defer config loading in `cascade.ts` from import time to `main()` / `runCli()`.

#### Scenario: Layered precedence and .openspec-cascade.json validation
- **WHEN** `loadConfig` resolves configuration with `--config` or `.openspec-cascade.json`, `CASCADE_*` env vars, CLI flags, and `overrides`
- **THEN** higher-precedence layers override lower ones (`logDir` resolves as `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`), blank `CASCADE_CHANGES=""` or `CASCADE_LOG_DIR=""` falls back to `.openspec-cascade.json` values instead of clobbering them, missing default `.openspec-cascade.json` falls back to `{}`, and missing explicit `--config` or malformed/schema-invalid JSON throws `ConfigValidationError`

#### Scenario: Lockfile-aware dynamic stack commands avoid hardcoded Bun/Nuxt lock-in
- **WHEN** `loadConfig` or `cascade.ts:verifyCommands` inspects a repository with a `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, or `bun.lock` lockfile
- **THEN** verification commands use `tryDetectPackageManager` / `resolvePackageCommands`, applying Nuxt `.nuxt/` expansion only when Nuxt is detected while preserving defaults for non-existent mock paths

#### Scenario: Lazy CLI loading in cascade.ts eliminates import-time side effects
- **WHEN** `cascade.ts` is imported as a module or executed via `runCli(argv, env)`
- **THEN** importing `cascade.ts` executes no `loadConfig()` side effects, and `main()`/`runCli()` catches `ConfigValidationError` and `Fatal` with exit code `2`

### Requirement: Strict TypeScript, ESLint No-Explicit-Any and Clean Code Compliance
The system MUST enforce `@typescript-eslint/no-explicit-any: "error"` in `eslint.config.js`, eliminate all explicit `any` leaks across the codebase, expand `lint.test.ts` to `src/**/*.ts`, and enforce zero inline function-body comments in all M1-created and M1-modified files.

#### Scenario: ESLint enforces no-explicit-any and lint.test.ts covers src/**/*.ts
- **WHEN** `bun run lint`, `bun run typecheck`, and `bun test lint.test.ts` execute
- **THEN** zero explicit `any` errors, zero TypeScript errors, zero magic-number errors, and zero inline function-body comments exist across M1 targets
