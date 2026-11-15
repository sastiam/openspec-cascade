# Explorer Handoff: `explorer_m1_it2_3` (OpenSpec, Regression Tests & Baseline Verification)

## 1. Baseline Verification Results (Observed)

All commands were executed with `export PATH="$HOME/.bun/bin:$PATH"` from `/home/antigravity/sastiam/openspec-cascade`:

| Check | Command | Exit Code | Observed Result |
|---|---|---|---|
| TypeScript | `bun run typecheck` (`tsc --noEmit`) | `0` | 0 errors |
| ESLint | `bun run lint` (`eslint .`) | `0` | 0 errors, 0 warnings |
| OpenSpec Strict | `bunx openspec validate cascade-m1-config-guardrails --strict` | `0` | `Change 'cascade-m1-config-guardrails' is valid` |
| Analyze Gate | `analyzeChangeArtifacts("cascade-m1-config-guardrails")` | `0` | `passed: true`, `confirmedBlocking: 0`, `findings: []` |
| Targeted Test | `bun test cascade.test.ts` | `0` | `36 pass, 0 fail, 108 expect() calls [3.93s]` (`activates keep-alive by default` took `1597.61ms`) |
| Full Suite | `bun test` | `1` | `1756 pass, 1 fail, 1 error, 8597 expect() calls across 65 files [97.37s]` |

### Full-Suite Failure Detail
- Failing test: `cascade.test.ts:175` — `cascade CLI keep-alive integration > activates keep-alive by default`
- Observed error: `this test timed out after 5000ms.` (`5007.55ms`, killed child process -> `Expected: 0, Received: 143` at `cascade.test.ts:184`).
- Cause: Under parallel full-suite load, `Bun.spawn(["bun", "run", "cascade.ts", "--dry-run", "--changes", "cross-platform-keep-alive"])` (which also invokes `readUsage(ctx)` during `--dry-run` at `cascade.ts:702`) exceeded Bun's default `5000ms` test timeout (`1597.61ms` standalone vs `5007.55ms` under contention; sibling test at `cascade.test.ts:189` took `3876.63ms`). Adding an explicit timeout (e.g. `15_000` ms) on lines `175` and `189` of `cascade.test.ts` eliminates this flakiness.

### Side Effect Observation: `.agents/teamwork/reviewer_INTEG-RUN-001/`
- Running `bun test` executes `test/gates/gate1_feedback.test.ts:582-586` (`new Gate1Reviewer({ taskId: "INTEG-RUN-001", diff: cleanDiff, autoCleanup: true })`).
- Confirmed via `git diff -- .agents/teamwork/reviewer_INTEG-RUN-001/`: that test modifies three tracked files in `.agents/teamwork/reviewer_INTEG-RUN-001/`:
  - `.agents/teamwork/reviewer_INTEG-RUN-001/DISPATCH.md` (updated `Injected Skills` list)
  - `.agents/teamwork/reviewer_INTEG-RUN-001/progress.md` (updated `Last visited` timestamp to `2026-11-15T04:50:04.800Z`)
  - `.agents/teamwork/reviewer_INTEG-RUN-001/review_feedback.xml` (updated `timestamp` attribute)
- **Boundary reminder:** `.agents/teamwork/reviewer_INTEG-RUN-001/**` is in `SCOPE.md`'s **Forbidden** write-ownership list; workers must not touch or reset it unless explicitly instructed by the parent orchestrator.

### Current `git status --short`
- **Modified (`M`)**: `antigravity.ts`, `bun.lock`, `cascade.ts`, `config.ts`, `engine.test.ts`, `eslint.config.js`, `lint.test.ts`, `opencode.ts`, `package.json`, `platform.test.ts`, `platform.ts`, `projects/agnostic_looper/verify_project_items.ts`, `src/engine/rollback_buffer.ts`, `src/integration/github_project.ts`, `src/pal/adapters/claude.ts`, `src/pal/adapters/gemini.ts`, `src/pal/adapters/jules.ts`, `src/pal/adapters/opencode.ts`, `test/integration/github_project.test.ts`, plus `.agents/teamwork/**` files.
- **Untracked (`??`)**: `openspec/changes/cascade-m1-config-guardrails/`, `src/config/`, `test/config/`, `test/e2e/`, `PROJECT.md`, `TEST_INFRA.md`, `TEST_READY.md`, plus `.agents/teamwork/*/` sandboxes.
- Note: `openspec/specs/` currently contains only `.gitkeep` (no main specs yet).

---

## 2. OpenSpec Alignment Audit (`openspec/changes/cascade-m1-config-guardrails/*`)

All 4 files (`proposal.md`, `design.md`, `specs/config-guardrails/spec.md`, `tasks.md`) currently pass `openspec validate --strict` and `analyzeChangeArtifacts`. However, to keep specs, design, and tasks 100% aligned with Iteration 2 hardening in `SCOPE.md`, apply the following targeted updates inside `openspec/changes/cascade-m1-config-guardrails/`:

1. **`proposal.md` (`lines 11-14`)**:
   - Under item 2 (`F02`), clarify that `usageLimitPercent` enforces integer validation (`1–100`) and domain bounds use domain-specific minimum constants (`TIMEOUT_CONSTANTS.MIN_DURATION_MS`, `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`, `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`).
   - Under item 3 (`F03`), note prototype-safe `"__proto__"` own-property handling in `redactSensitiveData`.
   - Under item 4 (`F04`), note explicit empty `--repo ""` / `CASCADE_REPO=""` / `overrides.repo: ""` rejection before path normalization, non-blank `CASCADE_CHANGES` fallback, and `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default` precedence.
2. **`design.md` (`lines 18-27`)**:
   - Decision 3 (`lines 18-19`): note `usageLimitPercent` enforces `int: true` (`1–100`) and bound constants are domain-scoped (`TIMEOUT_CONSTANTS.MIN_DURATION_MS`, `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`, `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`) rather than reusing `BUDGET_CONSTANTS.*`.
   - Decision 4 (`lines 22-23`): note `Object.defineProperty` is used in `redactRecordValue` and `redactErrorValue` so `"__proto__"` creates an own enumerable property without mutating `Object.getPrototypeOf`.
   - Decision 5 (`lines 26-27`): note `loadConfig` validates explicit `overrides.repo`, `cliOpts.repo`, and `env.CASCADE_REPO` as non-empty trimmed strings before `normalizePlatformPath`, treats blank `CASCADE_CHANGES` as unset via `nonBlankEnv`, and resolves `logDir` in strict precedence `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`.
3. **`specs/config-guardrails/spec.md` (`lines 19-47`)**:
   - Line 20 scenario (`Strict finite number and boolean coercion rejects invalid CLI or env values`): include `--usage-limit 1.5`, `--repo ""`, and `CASCADE_REPO=""` failing closed with `ConfigValidationError` (`exitCode === 2`) and zero log file/directory side effects.
   - Line 35 scenario (`Sensitive data redaction handles cycles, depth limits, containers, and secrets`): explicitly cover `"__proto__"` keys preserved as own properties without mutating object prototypes.
   - Line 46 scenario (`Layered precedence and .openspec-cascade.json validation`): explicitly cover `logDir` precedence (`overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`) and blank `CASCADE_CHANGES=""` falling back to `.openspec-cascade.json` `changes`.
4. **`tasks.md` (`lines 32-34`)**:
   - Ensure section `7` (or a new `7.3` / updated `7.1`–`7.2`) captures the Iteration 2 hardening items (all checked `[x]` once implemented and verified) and includes keywords matching every requirement in `spec.md` so `analyzeChangeArtifacts` continues reporting `100% coverage and zero blocking gaps`.

---

## 3. Code Findings & Clean Code Comment Inventory

### Defect Verification in Current Source
1. `src/config/loader.ts:566-574`: `option: cliOpts["log-dir"] ?? fileConfig.logDir` causes `fileConfig.logDir` to shadow `env.CASCADE_LOG_DIR`.
2. `src/config/loader.ts:530`: passes raw `env.CASCADE_CHANGES` instead of `nonBlankEnv(env.CASCADE_CHANGES)` into `resolveChangesList`, so `CASCADE_CHANGES=""` clobbers `fileConfig.changes`.
3. `src/config/loader.ts:523-528`: `overrides.repo ?? cliOpts.repo ?? nonBlankEnv(env.CASCADE_REPO) ?? cwd` ignores empty `CASCADE_REPO=""` (via `nonBlankEnv`) and passes `""` from `--repo ""` / `overrides.repo: ""` to `normalizePlatformPath("")`, which resolves to `process.cwd()`. Confirmed by `grep` across repo: no existing test expects `CASCADE_REPO: ""` to fall back.
4. `src/config/schemas.ts:210-214` & `src/config/loader.ts:576-587`: `usageLimitPercent` lacks `int: true`, allowing `--usage-limit 1.5`. Note `cascade.ts:742-744` calls `loadConfig` before `createRuntimeContext`/`executeCascade` (`logEvent` -> `mkdirSync`), so throwing `ConfigValidationError` in `loadConfig` naturally prevents any log dir/file creation.
5. `src/config/guardrails.ts:179-186` & `256-263`: `clonedRecord[key] = ...` and `cloned[key] = ...` mutate `Object.getPrototypeOf(cloned)` when `key === "__proto__"`. Replace with `Object.defineProperty(..., key, { value, enumerable: true, writable: true, configurable: true })`.
6. `src/config/constants.ts`, `schemas.ts`, `loader.ts`:
   - `TIMEOUT_CONSTANTS` needs `MIN_DURATION_MS: 0` (`constants.ts:104-118`).
   - `SDD_CONSTANTS` already has `SDD_MIN_REVIEW_DURATION_SECONDS: 10` (`constants.ts:148`); add `MIN_REVIEW_DURATION_SECONDS: 0` (`constants.ts:148`) so there is no naming collision.
   - `schemas.ts`: replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on `commandTimeoutMs` (L186), `engineSessionTimeoutMs` (L202), `rateLimitSleepMs` (L207), `resetMarginMs` (L217), `unknownResetSleepMs` (L222), `minPauseMs` (L227), `greptile.timeoutMs` (L295), `greptile.cacheTtlMs` (L300) with `TIMEOUT_CONSTANTS.MIN_DURATION_MS`; replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on `sdd.minReviewDurationSeconds` (L283) with `SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS`.
   - `loader.ts`: replace `BUDGET_CONSTANTS.MIN_BUDGET_USD` on `resetMarginMs` (L592), `unknownResetSleepMs` (L600), `minPauseMs` (L606), `commandTimeoutMs` (L649), `engineSessionTimeoutMs` (L657), `rateLimitSleepMs` (L663) with `TIMEOUT_CONSTANTS.MIN_DURATION_MS`; replace `BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT` on `maxAttemptsPerTask` (L615) and `maxTurnsPerSession` (L624) with `GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT`.

### Clean Code Rule #1 Comment Audit (M1-Created & M1-Modified Files)
- **Already clean (0 `//` comments):** `src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `projects/agnostic_looper/verify_project_items.ts`, and `engine.ts` (untouched in git status).
- **M1-modified files still containing `//` comments:**
  - `src/engine/rollback_buffer.ts`: 16 `//` comments at lines `249, 376, 407, 419, 424, 442, 464, 542, 630, 661, 669, 676, 738, 758, 776, 780`.
  - `src/integration/github_project.ts`: 3 `//` comments at lines `2051, 2081, 2104`.
  - `src/pal/adapters/claude.ts`: 13 `//` comments at lines `210, 223, 324, 342, 720, 755, 760, 796, 802, 819, 861, 1222, 1518`.
  - `src/pal/adapters/gemini.ts`: 36 `//` comments (lines `61, 65, 74, 84, 88, 95, 109, 117, 121, 134, 149` in constants; line `832`; lines `633, 643, 671, 680, 764, 783, 789, 972, 1008, 1025, 1033, 1041, 1052, 1067, 1075, 1104, 1128, 1186, 1235, 1248, 1288, 1314, 2325, 2350, 2374, 2783, 2804` inside functions; note line `976` is string literal `trimmed.startsWith("//")`).
  - `src/pal/adapters/jules.ts`: 27 `//` comment lines (`43, 47, 61, 66, 71, 75, 77, 79, 82, 85, 87, 90, 96-97, 102, 106, 111, 120, 125` in constants; `865, 918, 1021, 1213-1214, 1218, 1229, 1305, 1313` inside functions).
  - `src/pal/adapters/opencode.ts`: 14 `//` comments (`97, 101, 108, 115, 120, 127, 141, 153` in constants; `783, 802, 881, 957, 968, 1535` inside functions).
- Note: `src/gates/*` was NOT modified in M1 (timestamps untouched from `main`), though `SCOPE.md` mentions checking `src/gates/*` — workers should focus on M1-modified files above unless instructed to clean untouched `src/gates/*` (which contains 501 `//` lines across 12 files).

---

## 4. Concrete Zero-Stub / Zero-Mock Regression Test Plan

All regression tests import directly from `../../config`, `../../cascade`, and `../../src/config/constants` using real temp directories (`mkdtempSync`), real `loadConfig`, real `runCli`, real `EngineConfigSchema`, and real `redactSensitiveData`:

### A. `test/config/constants.test.ts`
Add assertions in `Centralized Immutable Constants Registry (F01)`:
1. `expect(TIMEOUT_CONSTANTS.MIN_DURATION_MS).toBe(0);`
2. `expect(SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS).toBe(0);`
3. `expect(SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS).toBe(10);`
4. `expect(GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT).toBe(1);`

### B. `test/config/schemas.test.ts`
Add a test in `Strict Zod Boundary Schemas (F02)`:
1. **Integer `usageLimitPercent` & domain bounds:**
   - Using `const cfg = getDefaultConfig("/tmp/demo-repo");`:
     - `expect(EngineConfigSchema.safeParse({ ...cfg, usageLimitPercent: 1.5 }).success).toBe(false);`
     - `expect(EngineConfigSchema.safeParse({ ...cfg, usageLimitPercent: 80 }).success).toBe(true);`
     - `expect(EngineConfigSchema.safeParse({ ...cfg, maxTurnsPerSession: 0 }).success).toBe(false);`
     - `expect(EngineConfigSchema.safeParse({ ...cfg, maxTurnsPerSession: 1 }).success).toBe(true);`
     - `expect(SddConfigSchema.safeParse({ ...DEFAULT_SDD_CONFIG, minReviewDurationSeconds: 0 }).success).toBe(true);`
     - `expect(SddConfigSchema.safeParse({ ...DEFAULT_SDD_CONFIG, minReviewDurationSeconds: -1 }).success).toBe(false);`

### C. `test/config/guardrails.test.ts`
Add tests under `redactSensitiveData`:
1. **`__proto__` own-property redaction without prototype mutation (plain object):**
   - `const payload = JSON.parse('{"__proto__":{"apiKey":"sk-ant-1234567890abcdef","safe":"ok"},"normal":"val"}') as Record<string, unknown>;`
   - `const redacted = redactSensitiveData(payload);`
   - `expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);`
   - `expect(Object.prototype.hasOwnProperty.call(redacted, "__proto__")).toBe(true);`
   - `const protoProp = Object.getOwnPropertyDescriptor(redacted, "__proto__")?.value as Record<string, unknown>;`
   - `expect(protoProp.apiKey).toBe("[REDACTED]");`
   - `expect(protoProp.safe).toBe("ok");`
   - `expect(({} as Record<string, unknown>).apiKey).toBeUndefined();`
2. **`__proto__` own-property redaction on `Error` instances:**
   - `const err = new Error("boom");`
   - `Object.defineProperty(err, "__proto__", { value: { token: "secret-abc" }, enumerable: true, writable: true, configurable: true });`
   - `const redactedErr = redactSensitiveData(err);`
   - `expect(Object.getPrototypeOf(redactedErr)).toBe(Error.prototype);`
   - `expect(Object.prototype.hasOwnProperty.call(redactedErr, "__proto__")).toBe(true);`
   - `const errProto = Object.getOwnPropertyDescriptor(redactedErr, "__proto__")?.value as Record<string, unknown>;`
   - `expect(errProto.token).toBe("[REDACTED]");`

### D. `test/config/loader.test.ts`
Import `existsSync` from `"node:fs"` and add tests under `Layered Dynamic Stack Config Loader & Lazy CLI (F04)`:
1. **`logDir` precedence (`overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`):**
   - Create `repoDir = makeTempDir(...)` with `.openspec-cascade.json` containing `{ "logDir": "/file/logs" }`.
   - Assert `loadConfig({ argv: [], env: {}, cwd: repoDir }).logDir === "/file/logs"`.
   - Assert `loadConfig({ argv: [], env: { CASCADE_LOG_DIR: "/env/logs" }, cwd: repoDir }).logDir === "/env/logs"`.
   - Assert `loadConfig({ argv: [], env: { CASCADE_LOG_DIR: "   " }, cwd: repoDir }).logDir === "/file/logs"`.
   - Assert `loadConfig({ argv: ["--log-dir", "/cli/logs"], env: { CASCADE_LOG_DIR: "/env/logs" }, cwd: repoDir }).logDir === "/cli/logs"`.
   - Assert `loadConfig({ argv: ["--log-dir", "/cli/logs"], env: { CASCADE_LOG_DIR: "/env/logs" }, cwd: repoDir, overrides: { logDir: "/override/logs" } }).logDir === "/override/logs"`.
2. **Non-blank `CASCADE_CHANGES` (`CASCADE_CHANGES=""` does not clobber `.openspec-cascade.json`):**
   - Create `repoDir = makeTempDir(...)` with `.openspec-cascade.json` containing `{ "changes": ["file-change-1", "file-change-2"] }`.
   - Assert `loadConfig({ argv: [], env: { CASCADE_CHANGES: "" }, cwd: repoDir }).changes` equals `["file-change-1", "file-change-2"]`.
   - Assert `loadConfig({ argv: [], env: { CASCADE_CHANGES: "   \t " }, cwd: repoDir }).changes` equals `["file-change-1", "file-change-2"]`.
   - Assert `loadConfig({ argv: [], env: { CASCADE_CHANGES: "env-a, env-b" }, cwd: repoDir }).changes` equals `["env-a", "env-b"]`.
3. **Empty `--repo ""`, `CASCADE_REPO=""`, and `overrides.repo: ""` rejection (zero bypass):**
   - `expect(() => loadConfig({ argv: ["--repo", ""], env: {}, cwd: dir })).toThrow(ConfigValidationError);`
   - `expect(() => loadConfig({ argv: ["--repo", "   "], env: {}, cwd: dir })).toThrow(ConfigValidationError);`
   - `expect(() => loadConfig({ argv: [], env: { CASCADE_REPO: "" }, cwd: dir })).toThrow(ConfigValidationError);`
   - `expect(() => loadConfig({ argv: [], env: { CASCADE_REPO: "  " }, cwd: dir })).toThrow(ConfigValidationError);`
   - `expect(() => loadConfig({ argv: [], env: {}, cwd: dir, overrides: { repo: "" } })).toThrow(ConfigValidationError);`
   - `expect(() => loadConfig({ argv: [], env: {}, cwd: dir, overrides: { repo: "   " } })).toThrow(ConfigValidationError);`
4. **Float `--usage-limit 1.5` and `CASCADE_USAGE_LIMIT_PERCENT="92.5"` rejection:**
   - `expect(() => loadConfig({ argv: ["--usage-limit", "1.5"], env: {}, cwd: dir })).toThrow(ConfigValidationError);`
   - `expect(() => loadConfig({ argv: [], env: { CASCADE_USAGE_LIMIT_PERCENT: "92.5" }, cwd: dir })).toThrow(ConfigValidationError);`
5. **CLI fail-closed exit code `2` with zero log-file/directory side effects:**
   - `const repoDir = makeTempDir("cascade-cli-nosideeffects-");`
   - `const logDir1 = join(repoDir, "logs-usage-float");`
   - `expect(await runCli(["--repo", repoDir, "--changes", "demo", "--usage-limit", "1.5", "--log-dir", logDir1], {})).toBe(2);`
   - `expect(existsSync(logDir1)).toBe(false);`
   - `const logDir2 = join(repoDir, "logs-empty-repo");`
   - `expect(await runCli(["--repo", "", "--changes", "demo", "--log-dir", logDir2], {})).toBe(2);`
   - `expect(existsSync(logDir2)).toBe(false);`
   - `const logDir3 = join(repoDir, "logs-empty-env-repo");`
   - `expect(await runCli(["--changes", "demo", "--log-dir", logDir3], { CASCADE_REPO: "" })).toBe(2);`
   - `expect(existsSync(logDir3)).toBe(false);`

### E. `cascade.test.ts` (Timeout Stability)
- Add `{ timeout: 15_000 }` (or `15000` — magic numbers are off in `*.test.ts`) to `cascade.test.ts:175` and `cascade.test.ts:189` so `bun test` does not spuriously fail on `activates keep-alive by default` at `5000ms` under parallel full-suite CPU contention.
