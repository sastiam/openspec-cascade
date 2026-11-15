# Dispatch — `worker_m1_it2_1` (Milestone M1 Remediation Worker — Iteration 2)

- **Role:** `teamwork_preview_worker`
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/worker_m1_it2_1`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/worker_m1_it2_1/handoff.md`
- **Authoritative Request:** Read `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim.
- **Constitution:** Read `/home/antigravity/sastiam/openspec-cascade/openspec/project.md` (SDD Discipline, Zero Magic Numbers, Strict Typing, Clean Code Rule #1).
- **Explorer Blueprints to Read:**
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/explorer_m1_it2_1/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/explorer_m1_it2_3/handoff.md`

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write-Ownership Boundaries
- **Allowed:** `openspec/changes/cascade-m1-config-guardrails/**`, `src/config/**`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`, `src/pal/adapters/**`, `src/engine/rollback_buffer.ts`, `src/integration/github_project.ts`, `projects/agnostic_looper/verify_project_items.ts`, `eslint.config.js`, `lint.test.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `engine.test.ts`, `test/integration/github_project.test.ts`, `test/config/**`.
- **Forbidden:** `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md`, `.agents/teamwork/reviewer_INTEG-RUN-001/**`.
- **NEVER run `git commit` or `git push`.**

## Exact Tasks to Implement

### 1. OpenSpec Updates (`openspec/changes/cascade-m1-config-guardrails/`)
Update `proposal.md`, `design.md`, `specs/config-guardrails/spec.md`, and `tasks.md` per `explorer_m1_it2_3/handoff.md` Section 2 so Iteration 2 requirements (strict `logDir` precedence, non-blank `CASCADE_CHANGES` fallback, empty `--repo ""` / `CASCADE_REPO=""` / `overrides.repo: ""` / `--log-dir ""` fail-closed rejection before path normalization, integer `usageLimitPercent`, prototype-safe `"__proto__"` own-property redaction, domain-scoped minimum bound constants, and Clean Code Rule #1 compliance) are explicitly specified and all tasks in `tasks.md` are checked `[x]` with 100% requirement-to-task traceability.

### 2. Config Constants, Schemas, Guardrails & Loader Fixes
1. **`src/config/constants.ts`**:
   - Add `MIN_DURATION_MS: 0` to `TIMEOUT_CONSTANTS`.
   - Add `MIN_REVIEW_DURATION_SECONDS: 0` to `SDD_CONSTANTS` (keep existing `SDD_MIN_REVIEW_DURATION_SECONDS: 10` untouched).
2. **`src/config/schemas.ts`**:
   - Add `int: true` to `EngineConfigSchema.shape.usageLimitPercent` and `GateBudgetsSchema.shape.tokenWatermarkPercent`.
   - Replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on `commandTimeoutMs`, `engineSessionTimeoutMs`, `rateLimitSleepMs`, `resetMarginMs`, `unknownResetSleepMs`, `minPauseMs`, `greptile.timeoutMs`, `greptile.cacheTtlMs` with `TIMEOUT_CONSTANTS.MIN_DURATION_MS`.
   - Replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on `sdd.minReviewDurationSeconds` with `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`.
3. **`src/config/guardrails.ts`**:
   - Add a private helper `defineOwnEnumerableProperty(target: object, key: string, value: unknown): void` using `Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })`.
   - Use `defineOwnEnumerableProperty` in both `redactRecordValue` (preserving `Object.getPrototypeOf(record) === null ? Object.create(null) : {}`) and `redactErrorValue` (removing unused `clonedRecord`), eliminating bracket `cloned[key] = ...` prototype mutation on `"__proto__"`.
4. **`src/config/loader.ts`**:
   - Import `GUARDRAIL_CONSTANTS` from `./constants`.
   - Extend `LogDirInput` with optional `file?: string`; update `resolveLogDir` to check `[option, env, file]`; in `loadConfig`, pass `option: cliOpts["log-dir"]`, `env: nonBlankEnv(env.CASCADE_LOG_DIR)`, `file: fileConfig.logDir`.
   - Wrap `env.CASCADE_CHANGES` in `nonBlankEnv(env.CASCADE_CHANGES)` when calling `resolveChangesList`.
   - Validate `explicitRepo = overrides.repo ?? cliOpts.repo ?? env.CASCADE_REPO` for `trim().length === 0` AND validate `overrides.logDir` / `cliOpts["log-dir"]` via `assertNonEmptyExplicitString` BEFORE calling `normalizePlatformPath(...)` or `loadFileConfigLayer(...)` — throwing `ConfigValidationError` (`exitCode = 2`) with zero side effects. (Use `const rawRepo = explicitRepo ?? fileConfig.repo ?? cwd;` afterward so `CASCADE_REPO=""` when `--repo /valid` is passed still lets CLI win.)
   - Add `int: true` to `usageLimitPercent` `parseStrictNumberOption`.
   - Replace `BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT` on `maxAttemptsPerTask` and `maxTurnsPerSession` with `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`.
   - Replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on `resetMarginMs`, `unknownResetSleepMs`, `minPauseMs`, `commandTimeoutMs`, `engineSessionTimeoutMs`, `rateLimitSleepMs` with `TIMEOUT_CONSTANTS.MIN_DURATION_MS`.

### 3. Clean Code Rule #1 Compliance (ZERO Inline `//` Comments Inside Function Bodies)
Remove ALL inline `//` comments inside function bodies across ALL M1-created and M1-modified files:
- `src/engine/rollback_buffer.ts` (16 lines)
- `src/pal/adapters/claude.ts` (14 lines)
- `src/pal/adapters/gemini.ts` (27 lines — keep string literal `trimmed.startsWith("//")` intact!)
- `src/pal/adapters/opencode.ts` (6 lines)
- `src/pal/adapters/jules.ts` (9 lines — replace empty blocks cleanly with `void err;` / `void transition;` so ESLint `no-empty` and `no-unused-vars` pass)
- `src/integration/github_project.ts` (3 lines)
- Also clean the 15 inline `//` lines in `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, and `test/integration/github_project.test.ts`.
- Verify via AST/grep scan that ZERO inline `//` comments remain inside function bodies in any M1-created or M1-modified file.

### 4. Zero-Stub Regression Tests & Timeout Stabilization
- Add genuine regression tests (zero stubs/mocks) in `test/config/constants.test.ts`, `test/config/schemas.test.ts`, `test/config/guardrails.test.ts`, and `test/config/loader.test.ts` covering every single fixed bug above (including `runCli` exit code `2` with `existsSync(logDir) === false` for `--usage-limit 1.5`, `--repo ""`, and `CASCADE_REPO=""`).
- In `cascade.test.ts:175` and `cascade.test.ts:189`, add `{ timeout: 15_000 }` (or `15000`) to prevent spurious 5000ms timeouts under parallel full-suite load.

### 5. Mandatory Verification Before Handoff
Run with `export PATH="$HOME/.bun/bin:$PATH"`:
1. `bun run typecheck` (must exit 0)
2. `bun run lint` (must exit 0, 0 warnings)
3. `bunx openspec validate cascade-m1-config-guardrails --strict` (must exit 0)
4. `analyzeChangeArtifacts("cascade-m1-config-guardrails", process.cwd())` (must pass with 0 blocking findings)
5. `bun test` (full suite — must exit 0 with 0 failures; note `bun test` touches 3 tracked files under `.agents/teamwork/reviewer_INTEG-RUN-001/` — do not commit or manually alter them)

Write your complete `handoff.md` to `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/worker_m1_it2_1/handoff.md` and call `send_message` to me.
