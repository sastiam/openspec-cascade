# Review Report: Milestone M1 (`reviewer_m1_1`)

- **Verdict:** `REQUEST_CHANGES`
- **Target Change:** `openspec/changes/cascade-m1-config-guardrails/`
- **Branch:** `feat/cascade-looper-v2`
- **Reviewer:** `reviewer_m1_1` (`teamwork_preview_reviewer`)

---

## Independent Verification Results

Executed after reading all M1 OpenSpec artifacts, `src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `antigravity.ts`, `opencode.ts`, `eslint.config.js`, `lint.test.ts`, and `test/config/*.test.ts`:

| Check | Command | Exit Code | Outcome |
| :--- | :--- | :---: | :--- |
| TypeScript | `bun run typecheck` (`tsc --noEmit`) | `0` | 0 errors |
| Linter | `bun run lint` (`eslint .`) | `0` | 0 errors, 0 warnings |
| OpenSpec Strict | `bunx openspec validate cascade-m1-config-guardrails --strict` | `0` | Valid |
| Analyze Gate | `analyzeChangeArtifacts("cascade-m1-config-guardrails", process.cwd())` | `0` | `passed: true`, `confirmedBlocking: 0` |
| Full Test Suite | `bun test` | `0` | `1757 pass`, `0 fail`, `8599 expect() calls` across `65 files` |
| CLI `--help` | `bun run cascade.ts --help` | `0` | Help text printed |
| CLI `--unknown-flag` | `bun run cascade.ts --unknown-flag` | `2` | Fail-closed `ConfigValidationError` |
| CLI `--engine invalid` | `bun run cascade.ts --engine invalid` | `2` | Fail-closed `ConfigValidationError` |
| CLI `--budget -5` / `--budget=-5` | `bun run cascade.ts --budget -5` / `--budget=-5` | `2` | Fail-closed `ConfigValidationError` |
| CLI `--budget abc` | `bun run cascade.ts --budget abc` | `2` | Fail-closed `ConfigValidationError` |

---

## Findings Requiring Changes

### 1. [BLOCKING] Layered Precedence Inversion for `logDir` (`CASCADE_LOG_DIR` vs `.openspec-cascade.json`)
- **File:** `/home/antigravity/sastiam/openspec-cascade/src/config/loader.ts:566-574`
- **Spec Reference:** `openspec/changes/cascade-m1-config-guardrails/specs/config-guardrails/spec.md:43` (`overrides > CLI args > CASCADE_* env > .openspec-cascade.json > dynamic/repo defaults`), `PROJECT.md:8`, `SCOPE.md:18`.
- **Evidence:**
  ```ts
  const logDir =
    overrides.logDir ??
    resolveLogDir({
      option: cliOpts["log-dir"] ?? fileConfig.logDir,
      env: env.CASCADE_LOG_DIR,
      repo,
      home: homedir(),
      cwd,
    });
  ```
  Because `resolveLogDir` prefers `option` over `env`, falling back `option` to `fileConfig.logDir` causes `.openspec-cascade.json` (`logDir`) to override `env.CASCADE_LOG_DIR` whenever `--log-dir` is omitted.
- **Reproduced Output:** With `{ "logDir": "/tmp/from-file" }` in `.openspec-cascade.json` and `CASCADE_LOG_DIR="/tmp/from-env"`, `loadConfig` returned `logDir: "/tmp/from-file"` instead of `"/tmp/from-env"`.
- **Required Fix:**
  Pass `option: cliOpts["log-dir"]` and `env: nonBlankEnv(env.CASCADE_LOG_DIR) ?? fileConfig.logDir` to `resolveLogDir(...)`, and add a regression test in `test/config/loader.test.ts` verifying `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`.

### 2. [BLOCKING] Blank `CASCADE_CHANGES=""` Overrides `.openspec-cascade.json` `changes`
- **File:** `/home/antigravity/sastiam/openspec-cascade/src/config/loader.ts:530` (`resolveChangesList` at `src/config/loader.ts:347-366`)
- **Evidence:**
  ```ts
  const changes = resolveChangesList(overrides.changes, cliOpts.changes, env.CASCADE_CHANGES, fileConfig.changes);
  ```
  Every other `CASCADE_*` environment variable in `loadConfig` passes through `nonBlankEnv(...)`, whereas `env.CASCADE_CHANGES` is passed raw. When `CASCADE_CHANGES=""` is set in the environment and `.openspec-cascade.json` defines `changes: ["from-file"]`, `resolveChangesList` sees `envChanges !== undefined` and returns `[]`, clobbering `fileConfig.changes`.
- **Reproduced Output:** With `{ "changes": ["from-file"] }` in `.openspec-cascade.json` and `CASCADE_CHANGES=""`, `loadConfig` returned `changes: []` instead of `["from-file"]`.
- **Required Fix:**
  Pass `nonBlankEnv(env.CASCADE_CHANGES)` into `resolveChangesList(...)` and add a regression test in `test/config/loader.test.ts`.

### 3. [MAJOR] Semantic Misuse of Validation Bound Constants
- **Files:**
  - `/home/antigravity/sastiam/openspec-cascade/src/config/loader.ts:615,624`
  - `/home/antigravity/sastiam/openspec-cascade/src/config/loader.ts:592,600,606,649,657,663`
  - `/home/antigravity/sastiam/openspec-cascade/src/config/schemas.ts:186,202,207,217,222,227,283,295,300`
- **Evidence:**
  - `src/config/loader.ts:615` (`maxAttemptsPerTask`) and `src/config/loader.ts:624` (`maxTurnsPerSession`) use `min: BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT` (`1`) instead of `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT` (`1`, which `src/config/schemas.ts:197,240` already uses). If `MIN_USAGE_LIMIT_PERCENT` is ever adjusted, task/turn minimums would silently change.
  - `src/config/schemas.ts` and `src/config/loader.ts` use `BUDGET_CONSTANTS.MIN_BUDGET_USD` (`0`) as the lower bound for millisecond timeouts (`commandTimeoutMs`, `engineSessionTimeoutMs`, `rateLimitSleepMs`, `resetMarginMs`, `unknownResetSleepMs`, `minPauseMs`, `greptile.timeoutMs`, `greptile.cacheTtlMs`) and seconds (`sdd.minReviewDurationSeconds`).
- **Required Fix:**
  Use `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT` for `maxAttemptsPerTask` and `maxTurnsPerSession` in `src/config/loader.ts`, and introduce/use domain-appropriate non-USD zero-bound constants (e.g., `TIMEOUT_CONSTANTS.MIN_DURATION_MS` / `GUARDRAIL_CONSTANTS.MIN_NON_NEGATIVE_INT` or `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`) for duration/timeout bounds.

---

## Verified Strengths (Passing Audit Items)

- **SDD Compliance:** `openspec/changes/cascade-m1-config-guardrails/` passes both `openspec validate --strict` and `analyzeChangeArtifacts` with 100% requirement-to-task traceability and all tasks checked off.
- **F01 (`src/config/constants.ts`):** 13 immutable `as const` namespaces, zero magic numbers, backward-compatible `CONSTANTS` composition in `config.ts`, and reconciled adapter/rollback constants (`RATE_LIMIT_SLEEP_MS = 1_800_000`, `STDERR_TAIL_MAX_LENGTH = 500`).
- **F02 (`src/config/schemas.ts`):** `zod@^4.6.7` in `package.json` and `bun.lock`, strict finite-number and boolean preprocessors rejecting `""`, `NaN`, `Infinity`, and boolean-to-number coercion, plus fail-closed `ConfigValidationError` (`exitCode = 2`).
- **F03 (`src/config/guardrails.ts`):** `enforceSessionBudget` fails closed on `NaN`/non-finite/non-positive and `spentUsd >= maxBudgetUsd`; `redactSensitiveData` handles `WeakSet` active-path cycles (`[Circular]`), preserves shared siblings and `Array`/`Map`/`Set`/`Date`/`RegExp`/`Error` containers, caps depth (`[MaxDepth]`), and redacts sensitive keys/tokens/PEM/URL credentials; `evaluateProtectedBranchGuard` blocks non-dry-run mutations on `main`/`master`/`stable` while allowing `--dry-run` with a warning.
- **F04 (`platform.ts`, `cascade.ts`):** `cascade.ts` has zero import-time `loadConfig()` side effects, exits `2` fail-closed on `ConfigValidationError`/`BudgetExceededError`/`ProtectedBranchError`/`Fatal`, wires `enforceSessionBudget`, `redactSensitiveData`, `evaluateProtectedBranchGuard`, and lockfile/Nuxt-aware dynamic `verifyCommands`.
- **F05 (ESLint, Types, Clean Code & Tests):** `@typescript-eslint/no-explicit-any: "error"` enabled in `eslint.config.js`, `lint.test.ts` expanded to `src/**/*.ts`, all 15 explicit `any` leaks eliminated, zero inline function-body comments in all M1-created/modified files, and real module tests in `test/config/*.test.ts`.
