# Review Report: Milestone M1 Remediation — Iteration 2 (`reviewer_m1_it2_1`)

- **Verdict:** `APPROVE`
- **Reviewer:** `reviewer_m1_it2_1` (Independent Reviewer 1: Config, Guardrails, Regression Tests & SDD)
- **Target Change:** `openspec/changes/cascade-m1-config-guardrails/` (Features F01–F05)
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/reviewer_m1_it2_1`

---

## 1. Independent Verification Commands

All checks were executed independently from `/home/antigravity/sastiam/openspec-cascade` with `export PATH="$HOME/.bun/bin:$PATH"`:

| Check | Command | Exit Code | Observed Result |
|---|---|---|---|
| TypeScript | `bun run typecheck` (`tsc --noEmit`) | `0` | 0 errors |
| ESLint | `bun run lint` (`eslint .`) | `0` | 0 errors, 0 warnings (`@typescript-eslint/no-explicit-any: "error"` active) |
| OpenSpec Strict | `bunx openspec validate cascade-m1-config-guardrails --strict` | `0` | `Change 'cascade-m1-config-guardrails' is valid` |
| Analyze Gate | `analyzeChangeArtifacts("cascade-m1-config-guardrails", process.cwd())` | `0` | `passed: true`, `confirmedBlocking: 0`, `findings: []` |
| AST Comment Scan | TypeScript AST scanner across all 27 M1-created/modified files | `0` | `Total inline comments inside function bodies: 0` |
| Full Test Suite | `bun test` | `0` | `1764 pass`, `0 fail`, `8651 expect() calls` across `65` files (`110.95s`) |
| CLI Smoke Checks | `bun run cascade.ts --help`, `--unknown-flag`, `--engine invalid`, `--budget -5`, `--budget abc`, `--usage-limit 1.5 --changes demo --dry-run`, `--repo "" --changes demo`, `--log-dir "" --changes demo` | `0` / `2` | `--help` exited `0`; all 7 invalid/fail-closed invocations exited `2` |

---

## 2. Verification of All 6 Iteration 1 Config & Guardrail Fixes

1. **`logDir` precedence (`overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`)** — **PASS**
   - `src/config/loader.ts:99-106` extends `LogDirInput` with `file?: string`.
   - `src/config/loader.ts:183-187` (`resolveLogDir`) resolves `[option, env, file].find((value) => value !== undefined && value.trim() !== "")` before falling back to the home cache directory.
   - `src/config/loader.ts:585-594` passes `option: cliOpts["log-dir"]`, `env: nonBlankEnv(env.CASCADE_LOG_DIR)`, and `file: fileConfig.logDir`, preserving `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`.

2. **Blank `CASCADE_CHANGES=""` does not clobber `.openspec-cascade.json` `changes`** — **PASS**
   - `src/config/loader.ts:544-549` wraps `env.CASCADE_CHANGES` with `nonBlankEnv(env.CASCADE_CHANGES)` when calling `resolveChangesList(...)`, matching all other `CASCADE_*` environment variables.

3. **Empty `--repo ""`, `CASCADE_REPO=""`, `overrides.repo: ""`, `--log-dir ""`, `overrides.logDir: ""` fail closed before normalization/file loading with zero log side effects** — **PASS**
   - `src/config/loader.ts:300-306` defines `assertNonEmptyExplicitString`.
   - `src/config/loader.ts:533-535` validates `explicitRepo = overrides.repo ?? cliOpts.repo ?? env.CASCADE_REPO` and `overrides.logDir ?? cliOpts["log-dir"]` BEFORE `normalizePlatformPath` (`loader.ts:537`) and `loadFileConfigLayer` (`loader.ts:539`).
   - `src/config/loader.ts:541` uses `const rawRepo = explicitRepo ?? fileConfig.repo ?? cwd;` so valid `--repo <dir>` overrides blank `CASCADE_REPO=""` while empty explicit values fail closed with `ConfigValidationError` (`exitCode = 2`).
   - `cascade.ts:742-744` calls `loadConfig(argv, env)` before `createRuntimeContext` / `executeCascade` (`startKeepAlive` / `logEvent`), ensuring zero log directories or files are created on fail-closed exit `2`.

4. **Fractional `--usage-limit 1.5` (and `tokenWatermarkPercent`) fail closed (`int: true`)** — **PASS**
   - `src/config/schemas.ts:210-215` enforces `int: true` on `EngineConfigSchema.shape.usageLimitPercent`.
   - `src/config/schemas.ts:267-272` enforces `int: true` on `GateBudgetsSchema.shape.tokenWatermarkPercent`.
   - `src/config/loader.ts:596-608` enforces `int: true` on `usageLimitPercent` in `loadConfig`.

5. **`redactSensitiveData` `"__proto__"` own-property protection without prototype mutation** — **PASS**
   - `src/config/guardrails.ts:165-172` defines `defineOwnEnumerableProperty` using `Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })`.
   - `src/config/guardrails.ts:193` (`redactErrorValue`) and `src/config/guardrails.ts:264-273` (`redactRecordValue`, preserving `Object.getPrototypeOf(record) === null ? Object.create(null) : {}`) both assign via `defineOwnEnumerableProperty`, preventing `Object.prototype.__proto__` setter invocation and prototype mutation.

6. **Semantic bound constants in `src/config/{constants,schemas,loader}.ts`** — **PASS**
   - `src/config/constants.ts:118` adds `TIMEOUT_CONSTANTS.MIN_DURATION_MS = 0`; `constants.ts:149` adds `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS = 0`; `constants.ts:210` exposes `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT = 1`.
   - `src/config/schemas.ts:184-230,295-304` and `src/config/loader.ts:610-685` use `TIMEOUT_CONSTANTS.MIN_DURATION_MS` for millisecond durations/timeouts; `schemas.ts:283-287` uses `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`; `schemas.ts:197,241` and `loader.ts:636,645` use `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT` for task/turn counts. `BUDGET_CONSTANTS` is now used exclusively for budget and percentage fields.

---

## 3. SDD Compliance, Clean Code & Zero-Stub Regression Tests

- **SDD Compliance (`openspec/changes/cascade-m1-config-guardrails/`):**
  - `proposal.md`, `design.md`, `specs/config-guardrails/spec.md`, and `tasks.md` (including checked tasks `7.3`–`7.5`) are coherent, contain normative `MUST` requirements with testable scenarios, pass `bunx openspec validate cascade-m1-config-guardrails --strict`, and pass `analyzeChangeArtifacts` with 100% coverage and 0 blocking findings.
- **Clean Code & Strict Typing:**
  - Zero explicit `any` across the repository (`eslint.config.js` enforces `@typescript-eslint/no-explicit-any: "error"` and `lint.test.ts` tests `*.ts`, `src/**/*.ts`, `projects/**/*.ts`, `test/**/*.ts`).
  - Zero magic numbers (`@typescript-eslint/no-magic-numbers` passes with 0 errors/warnings).
  - Zero inline `//` comments inside function bodies across all 27 M1-created/modified files verified via TypeScript AST scan.
- **Zero-Stub Regression Tests:**
  - `test/config/constants.test.ts`, `test/config/schemas.test.ts`, `test/config/guardrails.test.ts`, and `test/config/loader.test.ts` import directly from production modules (`../../config`, `../../cascade`, `../../platform`, `../../src/engine/rollback_buffer`, `../../src/pal/adapters/*`) with zero stubs or mocks, covering all 6 Iteration 1 findings plus `runCli` zero-`logDir`-side-effect assertions.
  - `cascade.test.ts:186,199` stabilizes keep-alive CLI subprocess integration tests with `15_000` ms timeouts.
