# Dispatch — `sub_orch_m1_2` (Milestone M1 Remediation — Iteration 2)

- **Parent Orchestrator:** `teamwork_preview_orchestrator_cascade_2` (`7130706a3851799c500958d404249b61`)
- **Working Directory:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2`
- **Repository Root:** `/home/antigravity/sastiam/openspec-cascade`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (`## 2026-11-15T01:46:44Z`)
- **Master Plan:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`

## Prior Iteration 1 Context & Findings to Remediate
Read:
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/SCOPE.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/GATE_STATUS.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/reviewer_m1_1/handoff.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/challenger_m1_1/handoff.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/challenger_m1_2/handoff.md`

Required Remediation Items for Iteration 2:
1. **`logDir` precedence inversion (`src/config/loader.ts:566-574`):** Ensure `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`.
2. **Blank `CASCADE_CHANGES=""` clobbering `fileConfig.changes` (`src/config/loader.ts:530`):** Wrap `env.CASCADE_CHANGES` in `nonBlankEnv(env.CASCADE_CHANGES)`.
3. **Empty `--repo ""` / `CASCADE_REPO=""` / `overrides.repo: ""` bypass (`src/config/loader.ts:523-528`):** Validate explicit `overrides.repo`, `cliOpts.repo`, and `env.CASCADE_REPO` (when defined) as non-empty trimmed strings BEFORE calling `normalizePlatformPath(...)`, throwing `ConfigValidationError` (exit code `2`) with zero side effects.
4. **Float `--usage-limit 1.5` accepted (`src/config/schemas.ts:210-214`, `src/config/loader.ts:576-587`):** Enforce `int: true` on `usageLimitPercent` in both `EngineConfigSchema` and `loadConfig` so `--usage-limit 1.5` fails closed with exit code `2` and zero log files created.
5. **`redactSensitiveData` `"__proto__"` prototype mutation (`src/config/guardrails.ts:256-263`):** Use `Object.defineProperty(cloned, key, { value: nextVal, enumerable: true, writable: true, configurable: true })` in `redactRecordValue` (and `redactErrorValue` where copying arbitrary keys) so `"__proto__"` creates an own property rather than mutating `Object.getPrototypeOf(cloned)`.
6. **Semantic bound constant misuse (`src/config/loader.ts`, `src/config/schemas.ts`, `src/config/constants.ts`):** Replace `BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT` on `maxAttemptsPerTask`/`maxTurnsPerSession` with `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`, and replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on millisecond timeouts and seconds with domain-appropriate constants (`TIMEOUT_CONSTANTS.MIN_DURATION_MS` / `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`).
7. **Clean Code Rule #1 (`reviewer_m1_2` finding):** Audit ALL M1-created and M1-modified files — specifically including `src/engine/rollback_buffer.ts`, `src/pal/adapters/{claude,gemini,opencode,jules}.ts`, `src/integration/github_project.ts`, `src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`, `projects/agnostic_looper/verify_project_items.ts` — and remove ALL inline `//` comments inside function bodies.
8. **Regression Tests & OpenSpec:** Add real unit/integration regression tests in `test/config/*.test.ts` (and `cascade.test.ts` if needed) for every fixed defect (zero stubs/mocks); ensure `openspec/changes/cascade-m1-config-guardrails/` passes `openspec validate cascade-m1-config-guardrails --strict` and `analyzeChangeArtifacts`.

## Mandatory 2B Execution & Constraints
1. Execute full 2B loop: 3 parallel `teamwork_preview_explorer` -> 1 `teamwork_preview_worker` -> 2 independent `teamwork_preview_reviewer` -> 2 independent `teamwork_preview_challenger` -> 1 `teamwork_preview_auditor` (NON-SKIPPABLE, BINARY VETO) -> `GATE_STATUS.md`.
2. Write Ownership: M1 files only (`openspec/changes/cascade-m1-config-guardrails/**`, `package.json`, `bun.lock`, `src/config/**`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`, `src/pal/adapters/**`, `src/engine/rollback_buffer.ts`, `src/integration/github_project.ts`, `src/gates/**`, `projects/agnostic_looper/verify_project_items.ts`, `eslint.config.js`, `lint.test.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `engine.test.ts`, `test/integration/github_project.test.ts`, `test/config/**`). Do NOT touch `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md`.
3. Do NOT run `git commit` or `git push` (Project Orchestrator will coordinate clean commits & push right after Gate PASS).
4. Always use `export PATH="$HOME/.bun/bin:$PATH"` for `bun`/`bunx` commands.
5. Upon Gate PASS, write `handoff.md` in your working directory listing all verified checks and all M1 files modified/created, and call `send_message` to `7130706a3851799c500958d404249b61`.
