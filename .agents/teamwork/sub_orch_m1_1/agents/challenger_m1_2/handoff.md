# Challenger Report: `challenger_m1_2` (Milestone M1 Adversarial Verification)

## Verdict: `REJECTED`

Empirical adversarial probing against the real production modules (`src/config/loader.ts`, `src/config/schemas.ts`, `src/config/guardrails.ts`, `config.ts`, `platform.ts`, `cascade.ts`) passed 35/38 primary checks and additional extra probes, **but uncovered 3 concrete fail-closed / precedence bugs** that violate `DISPATCH.md` and the M1 spec (`overrides > CLI > CASCADE_* env > .openspec-cascade.json > defaults`, fail-closed exit code `2` on invalid CLI flags).

---

## Failing Findings (Must Fix)

### 1. `--usage-limit 1.5` Accepted Instead of Failing Closed with Exit Code `2`
- **Locations:**
  - `src/config/schemas.ts:210-214` (`EngineConfigSchema.shape.usageLimitPercent`)
  - `src/config/loader.ts:576-587` (`loadConfig` `usageLimitPercent` call to `parseStrictNumberOption`)
- **Defect:** Neither `EngineConfigSchema.usageLimitPercent` nor `loadConfig` passes `int: true` to `strictFiniteNumberSchema(...)`.
- **Empirical Reproduction:**
  - `loadConfig({ argv: ["--usage-limit", "1.5"], env: {}, cwd: sandboxRoot }).usageLimitPercent` -> returns `1.5` instead of throwing `ConfigValidationError`.
  - `bun run cascade.ts --repo <tmp> --usage-limit 1.5 --changes demo --dry-run --no-keep-alive --log-dir <logDir>` -> exits with code `0` (`exitCode=0`) instead of `2`.
  - When `--changes` was omitted (`bun run cascade.ts --usage-limit 1.5 --log-dir <logDir>`), it bypassed `loadConfig()` validation, started `keepAlive` (logging `systemd-inhibit` fallback), created `<logDir>` (`logDirCreated=true`), and only later exited `2` in `preflight()` for missing `--changes`.
- **Remediation:** Add `int: true` to `usageLimitPercent` in both `src/config/schemas.ts` (`EngineConfigSchema`) and `src/config/loader.ts`.

### 2. Layered Precedence Inversion: `.openspec-cascade.json` `logDir` Overrides `CASCADE_LOG_DIR`
- **Location:** `src/config/loader.ts:566-574` (`resolveLogDir` invocation in `loadConfig`)
- **Defect:** `loadConfig()` passes `option: cliOpts["log-dir"] ?? fileConfig.logDir` and `env: env.CASCADE_LOG_DIR` into `resolveLogDir()`. Inside `resolveLogDir()` (`src/config/loader.ts:181-185`), `[option, env].find(...)` checks `option` before `env`, causing `fileConfig.logDir` from `.openspec-cascade.json` to beat `CASCADE_LOG_DIR`.
- **Empirical Reproduction:**
  - With `.openspec-cascade.json` containing `{ "logDir": "<sandbox>/bug2_file_logs" }` and `env = { CASCADE_LOG_DIR: "<sandbox>/bug2_env_logs" }`:
  - `loadConfig({ argv: ["--repo", repoDir], env: { CASCADE_LOG_DIR: "<sandbox>/bug2_env_logs" }, cwd: sandboxRoot }).logDir`
  - **Actual:** `<sandbox>/bug2_file_logs`
  - **Expected:** `<sandbox>/bug2_env_logs` (`CLI > CASCADE_* env > .openspec-cascade.json > defaults`)
- **Remediation:** Pass `option: cliOpts["log-dir"]` and `env: nonBlankEnv(env.CASCADE_LOG_DIR) ?? fileConfig.logDir` (or add an explicit `file` parameter to `resolveLogDir`).

### 3. Empty `CASCADE_CHANGES=""` Clobbers `.openspec-cascade.json` `changes`
- **Location:** `src/config/loader.ts:530` (`resolveChangesList` invocation in `loadConfig`)
- **Defect:** `loadConfig()` passes raw `env.CASCADE_CHANGES` to `resolveChangesList(...)` without wrapping it in `nonBlankEnv(...)` (unlike `CASCADE_REPO`, `CASCADE_ENGINE`, `CASCADE_MODEL`, `CASCADE_LOG_DIR`, etc.). In `resolveChangesList()` (`src/config/loader.ts:359-361`), `if (envChanges !== undefined)` matches `""` and returns `[]`, discarding `fileConfig.changes`.
- **Empirical Reproduction:**
  - With `.openspec-cascade.json` containing `{ "changes": ["feat-a", "feat-b"] }` and `env = { CASCADE_CHANGES: "" }`:
  - `loadConfig({ argv: ["--repo", repoDir], env: { CASCADE_CHANGES: "" }, cwd: sandboxRoot }).changes`
  - **Actual:** `[]`
  - **Expected:** `["feat-a", "feat-b"]`
- **Remediation:** Change line 530 to `resolveChangesList(overrides.changes, cliOpts.changes, nonBlankEnv(env.CASCADE_CHANGES), fileConfig.changes)`.

---

## Secondary Observation (Non-Blocking)
- **Live Protected-Branch Pre-Preflight Log Dir Creation (`cascade.ts:696-700`):** In `executeCascade()`, `startKeepAlive()` and `logEvent(ctx, "keep_alive", ...)` execute before `await preflight(ctx)`. On a live (non-`--dry-run`) invocation on protected branch `main`, `preflight()` correctly throws `ProtectedBranchError` and exits with code `2` (`STOPPED: Refusing to run on protected branch "main"`), but `logDir` is already created on disk by the `keep_alive` log event. For `--dry-run` and all invalid CLI/config inputs (`loadConfig`), `logDir` is NOT created.

---

## Passing Verification Matrix

| Category | Cases Tested | Result | Notes |
|---|---|---|---|
| **CLI Fail-Closed Exit Code `2` & Zero Side Effects** | `--unknown-flag`, `--engine invalid`, `--budget abc`, `--budget -1`, `--budget=-1`, `--budget 0`, `--budget NaN`, `--budget Infinity`, `--budget=-Infinity`, `--budget ""`, `--max-budget 0`, `--total-budget 0`, `--total-budget=-5`, `--usage-limit 0`, `--usage-limit 101`, `--max-turns 0`, `--max-turns 2.5`, `--max-attempts 0`, `--mode v3`, `--config /nonexistent/file.json`, `--repo` (missing value), `--help --unknown-flag` | **PASS** (22/22) | All exited strictly with `2` and `logDirCreated=false`. (`--usage-limit 1.5` failed — see Finding #1). |
| **Import-Time Side-Effect Isolation** | Child `bun run` importing `cascade.ts` with `process.argv = [..., "--unknown-flag", "--budget", "NaN", "--engine", "invalid"]` and `CASCADE_ENGINE=invalid`, `CASCADE_MAX_BUDGET_USD=NaN`, `CASCADE_CONFIG=/nonexistent/import_probe.json` | **PASS** | Exited `0`, printed `IMPORT_OK`, empty `stderr`, zero errors or `loadConfig()` execution. |
| **Layered Precedence** | `File > Defaults` (28 fields), `CLI > Env` (19 fields), `Overrides > CLI`, `Overrides` nested (`sdd`/`greptile`/`telemetry`), `--config > CASCADE_CONFIG`, boolean env strings (`"yes"`, `"0"`, `"invalid"`), empty env vars (`CASCADE_LOG_DIR`, `CASCADE_ENGINE`, `CASCADE_MODEL`, `CASCADE_EFFORT`, `CASCADE_MODE`, `CASCADE_ALLOW_DIRTY`, `CASCADE_KEEP_ALIVE`, `CASCADE_MAX_BUDGET_USD`) | **PASS** | `CASCADE_LOG_DIR > fileConfig.logDir` failed (Finding #2) and `CASCADE_CHANGES=""` failed (Finding #3). |
| **Malformed / Strict Config Files** | Malformed JSON (`{ invalid json`) and unknown key (`{ "mysteryFlag": true }`) in `.openspec-cascade.json` | **PASS** | Both threw `ConfigValidationError` with `exitCode === 2`. |
| **Dynamic Stack Detection** | `package-lock.json` (`npm`), `pnpm-lock.yaml` (`pnpm`), `yarn.lock` (`yarn`), `bun.lock` (`bun`), `pnpm-lock.yaml` + `nuxt.config.ts` (`nuxt+pnpm`) via `loadConfig` + `verifyCommands` | **PASS** (5/5) | Non-Nuxt repos emitted `<pm> test`, `<pm> run lint`, `<pm> run typecheck`, `<pm> run test:e2e`; Nuxt repo emitted `bunx nuxi prepare` + `.nuxt/tsconfig.*.json`. |
| **Protected-Branch Dry-Run Guard** | `evaluateProtectedBranchGuard` & `assertBranchSafety` on `main`, `master`, `stable`; real CLI `bun run cascade.ts` on temp git repo on `main` (`--dry-run` vs live) | **PASS** | `--dry-run` exited `0` with warning and `logDirCreated=false`; live run exited `2` with `STOPPED: Refusing to run on protected branch "main"`. |
| **Guardrails Sanity** | `enforceSessionBudget` (`NaN`, `===`, `<`), `redactSensitiveData` (circular ref + `apiKey` + `Date`) | **PASS** | `NaN` and `10 === 10` threw `BudgetExceededError`; `9.999 < 10` passed; cyclic object yielded `"[Circular]"`, `"[REDACTED]"`, and preserved `Date`. |

---

## Cleanup Verification
- All `/tmp` sandbox directories (`challenger_m1_2_*`) and temporary probe scripts (`/tmp/challenge_m1_2.ts`, `/tmp/challenge_m1_2_extra.ts`) were deleted and verified absent (`CLEAN_TMP`).
- No repository source, test, or config files were modified.
