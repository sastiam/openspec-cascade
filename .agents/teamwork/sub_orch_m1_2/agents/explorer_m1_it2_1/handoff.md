# Explorer M1 Iteration 2 Handoff Blueprint (`explorer_m1_it2_1`)

- **Explorer:** `explorer_m1_it2_1` (`teamwork_preview_explorer`)
- **Working Directory:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2`
- **Target:** Milestone M1 Remediation (`cascade-m1-config-guardrails`, Features F01–F05)

---

## 1. Baseline Verification Snapshot (Observed Commands)

All baseline verification commands ran cleanly against the current working tree before remediation edits:

| Check | Command | Observed Result |
|---|---|---|
| ESLint | `bun run lint` (`eslint .`) | Exit `0` (0 errors, 0 warnings) |
| TypeScript | `bun run typecheck` (`tsc --noEmit`) | Exit `0` |
| Lint & F01–F05 E2E | `bun test lint.test.ts test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts` | Exit `0` (`14 pass, 0 fail, 75 expect() calls`) |
| M1 Unit & Adapter Tests | `bun test test/config config.test.ts platform.test.ts cascade.test.ts engine.test.ts test/engine/rollback.test.ts test/pal/ test/integration/` | Exit `0` (`725 pass, 0 fail, 3407 expect() calls` across 17 files) |
| OpenSpec Strict | `bunx openspec validate cascade-m1-config-guardrails --strict` | Exit `0` (`Change 'cascade-m1-config-guardrails' is valid`) |
| Analyze Gate | `analyzeChangeArtifacts("cascade-m1-config-guardrails", process.cwd())` | `passed: true`, `confirmedBlocking: 0`, `findings: []` |

Note on ESLint coverage: `eslint.config.js:18-43` enforces `@typescript-eslint/no-explicit-any: "error"`, `@typescript-eslint/no-magic-numbers: "error"` (off in `**/*.test.ts`), and `@typescript-eslint/explicit-module-boundary-types: "error"`. ESLint does **not** catch inline `//` comments inside function bodies; those must be verified by AST/source inspection.

---

## 2. Exact Line-Numbered Remediation Blueprint (Items 1–8)

### Item 1: `logDir` Precedence Inversion (`src/config/loader.ts`)
- **Current Bug:** `src/config/loader.ts:566-574` passes `option: cliOpts["log-dir"] ?? fileConfig.logDir` and `env: env.CASCADE_LOG_DIR` into `resolveLogDir` (`src/config/loader.ts:181-185`). Because `resolveLogDir` picks the first non-blank entry from `[option, env]`, `.openspec-cascade.json`'s `logDir` overrides `CASCADE_LOG_DIR` whenever `--log-dir` is omitted.
- **Blueprint Fix:**
  1. Extend `LogDirInput` (`src/config/loader.ts:98-104`) with optional `file?: string` (preserving backward compatibility for existing 5-field callers such as `config.test.ts:280-314` and `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts:150-181`):
     ```ts
     export interface LogDirInput {
       option?: string;
       env?: string;
       file?: string;
       repo: string;
       home: string;
       cwd: string;
     }
     ```
  2. Update `resolveLogDir` (`src/config/loader.ts:181-185`) to evaluate `[option, env, file]`:
     ```ts
     export function resolveLogDir({ option, env, file, repo, home, cwd }: LogDirInput): string {
       const explicit = [option, env, file].find((value) => value !== undefined && value.trim() !== "");
       if (explicit !== undefined) return resolve(cwd, explicit.trim());
       return join(home, ...RUNTIME_CONSTANTS.DEFAULT_LOG_CACHE_SUBDIRS, basename(repo));
     }
     ```
  3. Update `loadConfig` (`src/config/loader.ts:566-574`) to pass `option: cliOpts["log-dir"]`, `env: env.CASCADE_LOG_DIR`, and `file: fileConfig.logDir`:
     ```ts
     const logDir =
       overrides.logDir ??
       resolveLogDir({
         option: cliOpts["log-dir"],
         env: env.CASCADE_LOG_DIR,
         file: fileConfig.logDir,
         repo,
         home: homedir(),
         cwd,
       });
     ```
  - **Precedence Achieved:** `overrides.logDir > --log-dir > CASCADE_LOG_DIR (non-blank) > fileConfig.logDir (non-blank) > default`.

---

### Item 2: Blank `CASCADE_CHANGES=""` Clobbering `fileConfig.changes` (`src/config/loader.ts`)
- **Current Bug:** `src/config/loader.ts:530` passes raw `env.CASCADE_CHANGES` to `resolveChangesList(overrides.changes, cliOpts.changes, env.CASCADE_CHANGES, fileConfig.changes)`. Inside `resolveChangesList` (`src/config/loader.ts:359-361`), `envChanges !== undefined` matches `""` and returns `[]`, clobbering `fileConfig.changes`.
- **Blueprint Fix:** Wrap `env.CASCADE_CHANGES` in `nonBlankEnv(...)` at `src/config/loader.ts:530`:
  ```ts
  const changes = resolveChangesList(
    overrides.changes,
    cliOpts.changes,
    nonBlankEnv(env.CASCADE_CHANGES),
    fileConfig.changes,
  );
  ```
  *(Note: `cliOpts.changes` remains raw if explicitly passed on CLI, or check if `--changes ""` should still yield `[]` which `preflight()` rejects; `test/e2e/tier2_boundaries/cli_config_boundaries.test.ts:40-44` expects `--changes " , "` to exit `2`, which `preflight()` handles.)*

---

### Item 3: Empty `--repo ""` / `CASCADE_REPO=""` / `overrides.repo: ""` Bypass (`src/config/loader.ts`)
- **Current Bug:** `src/config/loader.ts:523-528`:
  ```ts
  const preliminaryRepo = normalizePlatformPath(overrides.repo ?? cliOpts.repo ?? nonBlankEnv(env.CASCADE_REPO) ?? cwd);
  const explicitConfigPath = cliOpts.config ?? nonBlankEnv(env.CASCADE_CONFIG);
  const fileConfig = loadFileConfigLayer(explicitConfigPath, preliminaryRepo, cwd);

  const rawRepo = overrides.repo ?? cliOpts.repo ?? nonBlankEnv(env.CASCADE_REPO) ?? fileConfig.repo ?? cwd;
  const repo = normalizePlatformPath(rawRepo);
  ```
  When `--repo ""` or `overrides.repo = ""` is supplied, `normalizePlatformPath("")` runs `normalize(resolve(""))` and silently resolves to `process.cwd()`, bypassing `nonEmptyStringSchema("repo")`. When `CASCADE_REPO=""` is supplied, `nonBlankEnv` silently ignores it instead of rejecting an explicitly defined blank repo value.
- **Blueprint Fix:** Validate explicit repo input BEFORE calling `normalizePlatformPath(...)`:
  ```ts
  const explicitRepo = overrides.repo ?? cliOpts.repo ?? env.CASCADE_REPO;
  if (explicitRepo !== undefined && explicitRepo.trim().length === 0) {
    throw new ConfigValidationError("Invalid repo: repo must be a non-empty string", [
      "repo: repo must be a non-empty string",
    ]);
  }
  const preliminaryRepo = normalizePlatformPath(explicitRepo ?? cwd);
  const explicitConfigPath = cliOpts.config ?? nonBlankEnv(env.CASCADE_CONFIG);
  const fileConfig = loadFileConfigLayer(explicitConfigPath, preliminaryRepo, cwd);

  const rawRepo = explicitRepo ?? fileConfig.repo ?? cwd;
  const repo = normalizePlatformPath(rawRepo);
  ```
  - **Verification of All Cases:**
    - `overrides.repo = ""` or `"   "` -> throws `ConfigValidationError` (`exitCode = 2`), zero side effects.
    - `cliOpts.repo = ""` (`--repo ""`) or `"   "` -> throws `ConfigValidationError` (`exitCode = 2`), zero side effects.
    - `env.CASCADE_REPO = ""` (with no `overrides.repo` or `--repo`) -> throws `ConfigValidationError` (`exitCode = 2`), zero side effects.
    - `env.CASCADE_REPO = ""` when `--repo /valid/repo` IS passed -> `explicitRepo` is `"/valid/repo"`, so CLI precedence over env is preserved.
    - `fileConfig.repo = ""` -> rejected by `CascadeFileConfigSchema` (`src/config/schemas.ts:468`).
    - When none are set -> `explicitRepo` is `undefined`, falling back to `fileConfig.repo ?? cwd`.
  - Check `test/e2e/tier2_boundaries/cli_config_boundaries.test.ts:177-185` — it does not set `CASCADE_REPO`, so no E2E test is broken.

---

### Item 4: Float `--usage-limit 1.5` Accepted (`src/config/schemas.ts`, `src/config/loader.ts`)
- **Current Bug:**
  - `src/config/schemas.ts:210-214` (`EngineConfigSchema.shape.usageLimitPercent`) omits `int: true`.
  - `src/config/loader.ts:576-587` (`loadConfig` `usageLimitPercent`) omits `int: true`.
- **Blueprint Fix:** Add `int: true` in both places:
  1. `src/config/schemas.ts:210-214`:
     ```ts
     usageLimitPercent: strictFiniteNumberSchema({
       int: true,
       min: BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT,
       max: BUDGET_CONSTANTS.MAX_USAGE_LIMIT_PERCENT,
       label: "usageLimitPercent",
     }),
     ```
  2. `src/config/loader.ts:582-586`:
     ```ts
     {
       int: true,
       min: BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT,
       max: BUDGET_CONSTANTS.MAX_USAGE_LIMIT_PERCENT,
       label: "usageLimitPercent",
     },
     ```
  - Because `loadConfig` runs in `cascade.ts:742` (`runCli`) BEFORE `executeCascade` (`cascade.ts:744`), `--usage-limit 1.5` (even without `--changes`) now fails closed inside `loadConfig` with `ConfigValidationError` (`exit code 2`) and zero `keepAlive` / `logDir` side effects.

---

### Item 5: `redactSensitiveData` `"__proto__"` Prototype Mutation (`src/config/guardrails.ts`)
- **Current Bug:**
  - `src/config/guardrails.ts:256-263` (`redactRecordValue`) uses `cloned[key] = ...`, which triggers the `Object.prototype.__proto__` setter when `key === "__proto__"` (e.g. from `JSON.parse('{"__proto__": ...}')`), mutating `Object.getPrototypeOf(cloned)` and dropping the own `"__proto__"` property.
  - `src/config/guardrails.ts:178-186` (`redactErrorValue`) uses `clonedRecord[key] = ...`, exhibiting the same risk if an `Error` has an own `"__proto__"` enumerable property.
- **Blueprint Fix:** Use `Object.defineProperty` in both functions:
  1. In `redactRecordValue` (`src/config/guardrails.ts:256-264`):
     ```ts
     const cloned: Record<string, unknown> = {};
     for (const [key, val] of Object.entries(record)) {
       const nextVal =
         isSensitiveKey(key) && val !== undefined && val !== null
           ? GUARDRAIL_CONSTANTS.REDACTED_VALUE
           : redactNode(val, depth + 1, maxDepth, seen);
       Object.defineProperty(cloned, key, {
         value: nextVal,
         enumerable: true,
         writable: true,
         configurable: true,
       });
     }
     return cloned;
     ```
  2. In `redactErrorValue` (`src/config/guardrails.ts:178-187`):
     ```ts
     const extraEntries = Object.entries(err);
     for (const [key, propVal] of extraEntries) {
       const nextVal =
         isSensitiveKey(key) && propVal !== undefined && propVal !== null
           ? GUARDRAIL_CONSTANTS.REDACTED_VALUE
           : redactNode(propVal, depth + 1, maxDepth, seen);
       Object.defineProperty(cloned, key, {
         value: nextVal,
         enumerable: true,
         writable: true,
         configurable: true,
       });
     }
     ```
     (Remove unused `clonedRecord` variable once replaced.)

---

### Item 6: Semantic Bound Constant Misuse (`src/config/constants.ts`, `src/config/schemas.ts`, `src/config/loader.ts`)
- **Current Bug:**
  1. `src/config/loader.ts:615` (`maxAttemptsPerTask`) and `src/config/loader.ts:624` (`maxTurnsPerSession`) use `min: BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT` (`1`) instead of `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT` (`1`).
  2. `src/config/schemas.ts` (`186, 202, 207, 217, 222, 227, 283, 295, 300`) and `src/config/loader.ts` (`592, 600, 606, 649, 657, 663`) use `BUDGET_CONSTANTS.MIN_BUDGET_USD` (`0`) as lower bounds for millisecond durations and seconds (`sdd.minReviewDurationSeconds`).
- **Blueprint Fix:**
  1. In `src/config/constants.ts`:
     - Add `MIN_DURATION_MS: 0` to `TIMEOUT_CONSTANTS` (lines 104–118).
     - Add `SDD_MIN_REVIEW_DURATION_BOUND_SECONDS: 0` (or `MIN_DURATION_SECONDS: 0`) to `SDD_CONSTANTS` (lines 141–156) — **important:** do NOT use existing `SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS` (`10`) as the schema lower bound, because `10` would reject valid values `0..9`!
  2. In `src/config/schemas.ts`:
     - Line 186 (`commandTimeoutMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 202 (`engineSessionTimeoutMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 207 (`rateLimitSleepMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 217 (`resetMarginMs`): `min: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 222 (`unknownResetSleepMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 227 (`minPauseMs`): `min: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 283 (`sdd.minReviewDurationSeconds`): `min: SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_BOUND_SECONDS`
     - Line 295 (`greptile.timeoutMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 300 (`greptile.cacheTtlMs`): `min: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Keep `BUDGET_CONSTANTS.MIN_BUDGET_USD` on USD budgets (`maxBudgetPerSessionUsd` line 244, `maxTotalBudgetUsd` line 248).
  3. In `src/config/loader.ts`:
     - Import `GUARDRAIL_CONSTANTS` from `./constants` (lines 19–27).
     - Line 592 (`resetMarginMs`): `min: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 600 (`unknownResetSleepMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 606 (`minPauseMs`): `min: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 615 (`maxAttemptsPerTask`): `min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`
     - Line 624 (`maxTurnsPerSession`): `min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`
     - Line 649 (`commandTimeoutMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 657 (`engineSessionTimeoutMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Line 663 (`rateLimitSleepMs`): `minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS`
     - Keep `BUDGET_CONSTANTS.MIN_BUDGET_USD` on USD budgets (`maxBudgetPerSessionUsd` line 634, `maxTotalBudgetUsd` line 643).

---

### Item 7: Clean Code Rule #1 — Zero Inline `//` Comments Inside Function Bodies
AST + line-level scan across ALL M1-created and M1-modified files (`src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`, `projects/agnostic_looper/verify_project_items.ts`, `eslint.config.js`, `test/config/*.test.ts`, `engine.test.ts`, `lint.test.ts`) confirmed **0** inline function-body comments, EXCEPT the **6 M1-modified `src/` files** below (total **75** lines) and **4 M1-modified test files** (total **15** pre-existing lines):

1. **`src/engine/rollback_buffer.ts`** (16 lines inside function bodies):
   - `249` (`// ignore kill failure` inside `defaultCommandRunner` empty `catch` -> replace with `catch (err) { void err; }`)
   - `376`, `407`, `419` (`catch (err) { void err; }`), `424`, `442`, `464` (inside `rollbackWorkingTree`)
   - `542` (inside `RollbackStateBuffer.constructor`)
   - `630` (inside `RollbackStateBuffer.registerAuditLog`)
   - `661`, `669`, `676` (`catch (err) { void err; }`) (inside `RollbackStateBuffer.rollback`)
   - `738`, `758`, `776`, `780` (inside `RollbackStateBuffer.commit`)

2. **`src/pal/adapters/claude.ts`** (14 lines inside function bodies):
   - `201`, `210`, `223` (inside `countCacheBreakpoints`)
   - `324`, `342` (inside `calculateClaudeTokenUsage`)
   - `720`, `755`, `760`, `796`, `802`, `819` (inside `ClaudeAdapter.buildTurnPayload`)
   - `861` (inside `ClaudeAdapter.executeTurn`)
   - `1222` (inside `ClaudeStreamChunkParser.feed`)
   - `1518` (inside `ClaudeStreamChunkParser.handleMessageStop`)

3. **`src/pal/adapters/gemini.ts`** (27 lines inside function bodies):
   - `633`, `643`, `671`, `680` (inside `convertProtobufStructToJson`)
   - `764`, `783`, `789` (inside `describeToolInput`)
   - `972`, `1008`, `1025`, `1033`, `1041`, `1052`, `1067`, `1075`, `1104`, `1128`, `1186`, `1235`, `1248`, `1288`, `1314` (inside `reduceGeminiNdjsonEvent`)
   - `2325`, `2350`, `2374` (inside `GeminiAdapter.buildTurnPayload`)
   - `2783`, `2804` (inside `GeminiStreamChunkParser.processParsedJson`)

4. **`src/pal/adapters/opencode.ts`** (6 lines inside function bodies):
   - `783`, `802`, `881` (inside `OpenCodeStreamChunkParser.feedLine`)
   - `957`, `968` (inside `OpenCodeStreamChunkParser.finalizeStream`)
   - `1535` (inside `OpenCodeAdapter.buildTurnPayload`)

5. **`src/pal/adapters/jules.ts`** (9 lines inside function bodies):
   - `865` (`catch (err) { void err; }` inside `JulesAdapter.runRemoteCommand`)
   - `918` (inside `JulesAdapter.createSessions`)
   - `1021` (inside `JulesAdapter.pollSessions`)
   - `1213-1214`, `1218` (replace empty loop body `{ // Progress lives in ctx... }` with `for await (const transition of this.pollSessions(ctx)) { void transition; }`), `1229` (inside `JulesAdapter.runBatchWave`)
   - `1305` (inside `JulesAdapter.getCapabilities`)
   - `1313` (inside `JulesAdapter.getRateLimitState`)

6. **`src/integration/github_project.ts`** (3 lines inside function bodies):
   - `2051`, `2081`, `2104` (inside `GitHubProjectService.updateItemSize`)

7. **M1-Modified Test Files (Recommended Cleanup for 100% Spec Literal Compliance):**
   - `config.test.ts:102` (1 line)
   - `platform.test.ts:56, 69, 172, 173` (4 lines)
   - `cascade.test.ts:106, 124, 307` (3 lines)
   - `test/integration/github_project.test.ts:313, 316, 320, 1238, 1242, 1883, 1910` (7 lines)

*(Note: Keep JSDoc `/** ... */` docstrings above declarations and module-level constant group comments outside function bodies untouched unless they violate Clean Code; `src/gates/` was not modified in M1.)*

---

### Item 8: Regression Tests & OpenSpec Alignment
Add real unit/integration regression tests (zero mocks/stubs) in `test/config/`:
1. **`test/config/loader.test.ts`**:
   - `logDir` full precedence chain: `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`, plus blank `CASCADE_LOG_DIR=""` falling back to `fileConfig.logDir`.
   - `CASCADE_CHANGES=""` (and `"   "`) does NOT clobber `fileConfig.changes` from `.openspec-cascade.json`.
   - Empty/whitespace `--repo ""`, `--repo "   "`, `CASCADE_REPO=""`, and `overrides.repo = ""` throw `ConfigValidationError` (and `runCli(["--repo", "", "--changes", "x", "--log-dir", dir])` returns `2` without creating `dir`), while `CASCADE_REPO=""` with `--repo <valid>` still allows `--repo` to win.
   - Float `--usage-limit 1.5` and `CASCADE_USAGE_LIMIT_PERCENT="1.5"` throw `ConfigValidationError`, and `runCli(["--usage-limit", "1.5", "--log-dir", dir])` exits `2` without creating `dir`.
2. **`test/config/schemas.test.ts`**:
   - `EngineConfigSchema` rejects float `usageLimitPercent: 1.5` and accepts integer `1..100`.
   - `SddConfigSchema` accepts `minReviewDurationSeconds: 0` (preserving `0` floor) and rejects `-1`.
3. **`test/config/guardrails.test.ts`**:
   - `redactSensitiveData(JSON.parse('{"__proto__": {"toString": null, "valueOf": null, "secret": "sk-ant-1234567890"}}'))` preserves `Object.getPrototypeOf(redacted) === Object.prototype`, `String(redacted)` does not throw, `Object.prototype.hasOwnProperty.call(redacted, "__proto__")` is `true`, and nested `secret` is `"[REDACTED]"`.
   - Same own-`"__proto__"` protection on `Error` instances with enumerable `"__proto__"` extra property.
4. **`test/config/constants.test.ts`**:
   - Assert `TIMEOUT_CONSTANTS.MIN_DURATION_MS === 0` and `SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_BOUND_SECONDS === 0` (matching chosen constant name).

---

## 3. Post-Edit Verification Checklist for Worker & Gates
1. `export PATH="$HOME/.bun/bin:$PATH"`
2. `bun test` (full suite — expect 0 failures)
3. `bun run typecheck` (`tsc --noEmit` — exit 0)
4. `bun run lint` (`eslint .` — exit 0, 0 warnings)
5. `bunx openspec validate cascade-m1-config-guardrails --strict` (exit 0)
6. `analyzeChangeArtifacts("cascade-m1-config-guardrails", process.cwd())` (`passed: true, confirmedBlocking: 0`)
7. AST/grep scan confirming **0** inline `//` comments inside function bodies across all M1-created and M1-modified files.
8. Confirm `git status` shows zero unintended writes to `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md`, or `.agents/teamwork/reviewer_INTEG-RUN-001/**`.
