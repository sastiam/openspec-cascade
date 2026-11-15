# Milestone M1 Remediation Scope (Iteration 2)

## Iteration 1 Findings to Remediate
1. **`logDir` Precedence Inversion (`src/config/loader.ts:566-574`):**
   - Ensure `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`.
2. **Blank `CASCADE_CHANGES=""` Clobbering `fileConfig.changes` (`src/config/loader.ts:530`):**
   - Wrap `env.CASCADE_CHANGES` in `nonBlankEnv(env.CASCADE_CHANGES)` before calling `resolveChangesList`.
3. **Empty `--repo ""` / `CASCADE_REPO=""` / `overrides.repo: ""` Bypass (`src/config/loader.ts:523-528`):**
   - Validate explicit `overrides.repo`, `cliOpts.repo`, and `env.CASCADE_REPO` (when defined) as non-empty trimmed strings BEFORE calling `normalizePlatformPath(...)`, throwing `ConfigValidationError` (exit code `2`) with zero side effects.
4. **Float `--usage-limit 1.5` Accepted (`src/config/schemas.ts:210-214`, `src/config/loader.ts:576-587`):**
   - Enforce `int: true` on `usageLimitPercent` in both `EngineConfigSchema` and `loadConfig` so `--usage-limit 1.5` fails closed with exit code `2` and zero log files created.
5. **`redactSensitiveData` `"__proto__"` Prototype Mutation (`src/config/guardrails.ts:256-263`):**
   - Use `Object.defineProperty(cloned, key, { value: nextVal, enumerable: true, writable: true, configurable: true })` in `redactRecordValue` (and `redactErrorValue` where copying arbitrary keys) so `"__proto__"` creates an own property rather than mutating `Object.getPrototypeOf(cloned)`.
6. **Semantic Bound Constant Misuse (`src/config/loader.ts`, `src/config/schemas.ts`, `src/config/constants.ts`):**
   - Replace `BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT` on `maxAttemptsPerTask` / `maxTurnsPerSession` with `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`.
   - Replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on millisecond timeouts and seconds with domain-appropriate constants (`TIMEOUT_CONSTANTS.MIN_DURATION_MS` / `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`).
7. **Clean Code Rule #1 (`reviewer_m1_2` finding):**
   - Audit ALL M1-created and M1-modified files — specifically including `src/engine/rollback_buffer.ts`, `src/pal/adapters/{claude,gemini,opencode,jules}.ts`, `src/integration/github_project.ts`, `src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`, `src/gates/*`, `projects/agnostic_looper/verify_project_items.ts` — and remove ALL inline `//` comments inside function bodies.
8. **Regression Tests & OpenSpec Alignment:**
   - Add genuine unit/integration regression tests in `test/config/*.test.ts` (and `cascade.test.ts` if needed) for every fixed defect (zero stubs/mocks).
   - Verify `openspec validate cascade-m1-config-guardrails --strict` and `analyzeChangeArtifacts`.

## Write-Ownership Boundaries
- **Allowed:** `openspec/changes/cascade-m1-config-guardrails/**`, `package.json`, `bun.lock`, `src/config/**`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`, `src/pal/adapters/**`, `src/engine/rollback_buffer.ts`, `src/integration/github_project.ts`, `src/gates/**`, `projects/agnostic_looper/verify_project_items.ts`, `eslint.config.js`, `lint.test.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `engine.test.ts`, `test/integration/github_project.test.ts`, `test/config/**`.
- **Forbidden:** `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md`, `.agents/teamwork/reviewer_INTEG-RUN-001/**`, `git commit`, `git push`, `main` branch.
