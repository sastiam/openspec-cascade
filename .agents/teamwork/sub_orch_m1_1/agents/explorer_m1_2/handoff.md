# Explorer M1-2 Handoff: Zod Config Schemas (F02), Security Guardrails (F03), and Layered Dynamic Stack Loader (F04)

**Scope:** Architecture, exact file/line inventory, gap analysis, and concrete implementation design for Milestone M1 features **F02** (`src/config/schemas.ts`), **F03** (`src/config/guardrails.ts`), and **F04** (`src/config/loader.ts`, `src/config/index.ts`, refactored `config.ts`, `platform.ts`, `cascade.ts`).

---

## 1. Observation

### 1.1 Toolchain & Baseline Verification (Observed)
- `bun --version` -> `1.4.4`
- `bun run typecheck` (`tsc --noEmit`) -> exit `0`
- `bun run lint` (`eslint .`) -> exit `0`
- `bun test --bail` -> `1670 pass / 0 fail` across `47` test files (`8074 expect()` calls)
- `bunx openspec --version` -> `1.17.0`; `bunx openspec validate well-architecture-config --strict` & `bunx openspec validate cascade-v2-sdd-framework --strict` both pass.
- `package.json:16-18`: `"dependencies"` contains only `"@anthropic-ai/claude-agent-sdk": "0.3.309"`. **`zod` is NOT installed** in `package.json` or `bun.lock`.
- `src/config/` does **not** exist yet.

### 1.2 Exact Consumers of `config.ts` (18 files verified via `grep`)
Root and `src/` files importing `./config` or `../../config`:
1. `cascade.ts:19-26` (`CONSTANTS`, `FULL_VERIFY`, `loadConfig`, `parseCliArgs`, `resolveEngine`, `type CascadeConfig`)
2. `engine.ts:8` (`CONSTANTS`, `type CascadeConfig`, `type EngineType`, `resolveEngine`)
3. `claude.ts:8` (`CONSTANTS`)
4. `opencode.ts:8` (`CONSTANTS`)
5. `antigravity.ts:10` (`CONSTANTS`)
6. `qa.ts:8` (`CONSTANTS`)
7. `diagrams.ts:11` (`CONSTANTS`)
8. `src/engine/rollback_buffer.ts:30` (`CONSTANTS` — imported but unused; uses local `ROLLBACK_CONSTANTS`)
9. `src/sdd/sdd_gate.ts:10` (`CONSTANTS.SDD_PRODUCTION_EXTENSIONS`, `SDD_EXEMPT_*`, `SDD_GATED_TOOLS`)
10. `src/sdd/analyze.ts:13` (`CONSTANTS.SDD_CONSTITUTION_PATH`, `SDD_MIN_KEYWORD_LENGTH`)
11. `src/sdd/review_verifier.ts:8` (`CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS`)
12. `src/sdd/surface_verifier.ts:8` (`CONSTANTS.SDD_FRONTEND_EXTENSIONS`, `SDD_API_PATH_PATTERNS`, `DEFAULT_VERIFY`)
13. Test files: `config.test.ts:2-12`, `cascade.test.ts`, `engine.test.ts:2`, `qa.test.ts:2`, `diagrams.test.ts:4`, `resilience.test.ts:2`.

### 1.3 F02 Findings — CLI Parsing, Validation & Exit-Code Gaps
- **`config.ts:371-409` (`parseCliArgs`):**
  - Uses `parseArgs({ args: argv, allowPositionals: true, strict: false, options: { ... } })` (`config.ts:375-404`).
  - `catch` block (`config.ts:406-408`) swallows all `parseArgs` errors and returns `{ options: {}, positionals: [] }`.
  - **Observed behavior (`bun run cascade.ts --unknown-flag`):** unknown flag is silently ignored by `strict: false`; execution proceeds until `preflight()` fails on empty `--changes` (`UNKNOWN_EXIT:2`). Passing `--changes foo --unknown-flag` would NOT fail!
  - Missing CLI flags for numeric/runtime budgets & mode: `--budget` / `--max-budget`, `--total-budget`, `--usage-limit`, `--max-turns`, `--max-attempts`, `--mode`, `--config`.
- **`config.ts:411-415` (`parseNumber`):**
  - `const parsed = Number(value); return Number.isFinite(parsed) ? parsed : defaultValue;`
  - Silently ignores invalid/non-numeric strings (e.g. `"abc"`, `"NaN"`, `"Infinity"`) by reverting to defaults, and performs zero bounds checking (negative budgets, `usageLimitPercent > 100`, `0` or fractional `maxTurnsPerSession`).
- **`config.ts:298-304` (`resolveEngine`) + `cascade.ts:102`:**
  - `cascade.ts:102` executes `export const config: CascadeConfig = loadConfig();` at module import time.
  - `resolveEngine` throws an unhandled `Error` before `main().catch(...)` (`cascade.ts:622-625`) is reached.
  - **Observed behavior (`bun run cascade.ts --engine invalid`):** crashes at `config.ts:303` / `cascade.ts:102` with **exit code `1`** (`EXIT:1`), violating the fail-closed exit code `2` (`CONSTANTS.EXIT_CODE_FATAL`) requirement.

### 1.4 F03 Findings — Budget, Redaction & Protected-Branch Gaps
- **Budget Enforcement (`cascade.ts:439`, `claude.ts:45`):**
  - `cascade.ts:439` checks only `if (totalCostUsd >= config.maxTotalBudgetUsd) throw new Fatal(...)`.
  - Per-session budget (`config.maxBudgetPerSessionUsd`) is only passed to `@anthropic-ai/claude-agent-sdk` via `claudeAgentOptions` (`claude.ts:45`), never enforced by the harness for `opencode` (`opencode.ts`) or `antigravity` (`antigravity.ts`), nor checked on `outcome.costUsd` after a session returns.
  - **NaN bypass bug:** In JS, `NaN >= 150` evaluates to `false`. If `spentUsd` or `totalCostUsd` is `NaN`, the check silently passes instead of failing closed.
  - No `enforceSessionBudget` or `BudgetExceededError` exists.
- **Secret Redaction (`cascade.ts:122-129,325-332`, `antigravity.ts:306-312`, `opencode.ts:120`):**
  - `cascade.ts:122-129` (`log(event, data)`) writes `JSON.stringify({ t: ..., event, ...data })` directly to `<timestamp>.jsonl` with zero redaction.
  - `cascade.ts:325-332` forwards `describeToolInput(input)` and `text.slice(0, 500)` directly to `log()`, and `antigravity.ts:306-312` / `opencode.ts:120` log raw `stderr` tails.
  - No `redactSensitiveData` helper exists anywhere in the codebase.
- **Protected-Branch Dry-Run Guard (`cascade.ts:561-575,603-609`):**
  - `cascade.ts:564`: `if (config.protectedBranches.includes(branch)) throw new Fatal(\`Refusing to run on protected branch "${branch}"\`);`
  - Notice `cascade.ts:570` for dirty working trees explicitly exempts dry-run: `if (!config.allowDirty && !config.dryRun) throw new Fatal(...)`, printing a warning in `--dry-run`.
  - Line `564` lacks the dry-run exemption: running `--dry-run` (a read-only plan preview that writes no logs per `cascade.ts:123` and `README.md:107`) on `main`, `master`, or `stable` throws `Fatal` instead of allowing preview with a warning while hard-blocking all non-dry-run mutations on protected branches.

### 1.5 F04 Findings — Hardcoded Stack Coupling, Missing `.openspec-cascade.json`, and Import-Time Side Effects
- **Stack coupling in `config.ts` and `cascade.ts`:**
  - `config.ts:62-91,166-174` hardcodes `DEFAULT_VERIFY` (`["bun test", "bun run lint"]`), `FULL_VERIFY` (`.nuxt/tsconfig.server.json`, `.nuxt/tsconfig.app.json`, `bun run build`, `bun run test:e2e`), `QA_VERIFY_COMMANDS`, `TSC_SERVER`, `TSC_APP`, `NO_NEW_MIGRATION` (`bun run db:generate`), and `DENIED_BASH` (`Bash(bun run db:push*)`, `Bash(bun run db:migrate*)`).
  - `cascade.ts:196-226` (`verifyCommands(task, fullGate)`) hardcodes `/^bunx? /`, `/^bun audit\b/`, `CONSTANTS.TSC_SERVER`, `CONSTANTS.TSC_APP`, `"bun run db:generate"`, `"bun run lint"`, `"bun run build"`, `"bun run test:e2e"`, `"bunx nuxi prepare"`, and `FULL_VERIFY` / `CONSTANTS.DEFAULT_VERIFY`, ignoring target repo lockfiles/package managers.
  - `platform.ts:311-371` already provides `detectPackageManager(cwd)` (`pnpm | npm | yarn | bun`) and `resolvePackageCommands(pm)` (`{ test, lint, build, typecheck, run }`), **but neither `config.ts` nor `cascade.ts` imports or calls them**.
- **Missing `.openspec-cascade.json` loader:**
  - Zero code loads `.openspec-cascade.json` from target repo or `cwd`. Current `loadConfig()` (`config.ts:425-652`) only merges `overrides` > `cliOpts` > `env` > `CONSTANTS`.
- **Import-time side effects in `cascade.ts`:**
  - `cascade.ts:102` runs `export const config: CascadeConfig = loadConfig();` at module evaluation time.
  - `cascade.ts:113-117` immediately computes `repo`, `engine`, `changes`, `logFile` from `config`.
  - `cascade.ts:356` uses module-level `repo` as default parameter for `taskPrompt(..., repoRoot: string = repo)`.
  - `cascade.ts` helpers (`log`, `say`, `sh`, `runSession`, `runChecks`, `commit`, `runTask`, `runChange`, `preflight`, `printPlan`) close over module-level `config`, `repo`, `engine`, `changes`, `logFile`.
  - **Impact on `strict: true` CLI parsing:** When `cascade.test.ts` imports helpers from `./cascade` (`cascade.test.ts:5-27`) during `bun test --bail`, top-level `loadConfig()` reads `process.argv`; if `strict: true` is enabled on `parseCliArgs()` and `loadConfig()` runs at import time, importing `./cascade` in test runners can throw on test-runner flags or invalid `CASCADE_*` env vars.

---

## 2. Logic Chain & Concrete Design Specifications

### 2.1 F02 — `src/config/schemas.ts` (Zod Validation & Fail-Closed CLI)
1. **Install `zod`** into `package.json` (`dependencies`) and update `bun.lock` (`bun add zod`).
2. **Typed Error:** Export `ConfigValidationError extends Error` with `readonly issues: readonly string[]` and `readonly exitCode = CONSTANTS.EXIT_CODE_FATAL` (`2`).
3. **Strict Coercion Helpers (No `z.coerce.number()` trap):**
   - `z.coerce.number("") === 0` and `z.coerce.number(true) === 1` are unsafe for CLI flags and env vars.
   - Implement a `strictFiniteNumberSchema({ min?, max?, int?, positive? })` helper using `z.preprocess(...)` that:
     - Rejects empty/whitespace strings, `NaN`, `Infinity`, `-Infinity`, booleans, arrays, and objects.
     - Accepts finite numbers or trimmed numeric strings (`Number(val)` where `/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/` or `Number.isFinite`).
     - Enforces `.finite()`, `.int()` (for turns/attempts/ms/ports), `.positive()` or `.min()`/`.max()` (e.g., `usageLimitPercent`: `1..100`, `maxBudgetPerSessionUsd`: `> 0`, `maxTotalBudgetUsd`: `> 0`).
   - Implement `strictBooleanSchema` for env/JSON booleans (`true`/`false`/`"true"`/`"false"`/`"1"`/`"0"`).
4. **Domain Sub-Schemas & Root Schema:**
   - `EngineTypeSchema`: `z.enum(["claude", "opencode", "antigravity"])` (with alias preprocessing `"agy" -> "antigravity"`, case-insensitive).
   - `EffortLevelSchema`: `z.enum(["low", "medium", "high", "max", "none"])`.
   - `ExecutionModeSchema`: `z.enum(["v1", "v2"])`.
   - `RuntimeConfigSchema`: `repo`, `changes`, `logDir`, `allowDirty`, `dryRun`, `fullGate`, `keepAlive`, `rollbackOnFailure`, `resilient`, `mode`, `protectedBranches`, `neverCommit`, `commandTimeoutMs`.
   - `EngineConfigSchema`: `engine`, `model`, `effort`, `maxTurnsPerSession`, `engineSessionTimeoutMs`, `rateLimitSleepMs`, `usageLimitPercent`, `resetMarginMs`, `unknownResetSleepMs`, `minPauseMs`, `allowedTools`, `deniedBash`, `settingSources`, `defaultAntigravityModel`, `defaultOpenCodeModel`.
   - `GateBudgetsSchema`: `maxAttemptsPerTask`, `maxBudgetPerSessionUsd`, `maxTotalBudgetUsd`, `maxChallengeAttempts`, `maxVictoryFailures`, `spawnLimit`, `tokenWatermarkPercent`.
   - `SddConfigSchema`: `enabled`, `constitutionPath`, `minKeywordLength`, `minReviewDurationSeconds`, `productionExtensions`, `exemptPathSegments`, `gatedTools`.
   - `GreptileConfigSchema`: `enabled`, `timeoutMs`, `cacheTtlMs`, `cacheDir`, `tokenBudget`.
   - `TelemetryConfigSchema`: `enabled`, `telemetryDir`, `redactSecrets`, `maxRedactionDepth`.
   - `DiagramsConfigSchema`: `autoDiagrams`, `graphifyCommand`, `archifyAction`, `archifyQuality`, `archifyBin`.
   - `CascadeConfigSchema`: validates the full resolved config object cleanly; keep `z.output<typeof CascadeConfigSchema>` aligned with `CascadeConfig` (avoid `TS2345` by typing schemas explicitly without conflicting `.default()` input/output signatures when passing parsed objects).
   - `CascadeFileConfigSchema`: `.strict()` partial schema for `.openspec-cascade.json` so unknown keys in `.openspec-cascade.json` fail closed with `ConfigValidationError`.
5. **Strict CLI Parsing (`parseCliArgs`):**
   - Switch `parseArgs` to `strict: true` and do **NOT** swallow parse errors in `catch`. Wrap `parseArgs` errors into `ConfigValidationError`.
   - Declare all supported CLI options explicitly in `parseArgs.options`: existing flags (`repo`, `changes`, `allow-dirty`, `dry-run`, `full-gate`, `engine`, `no-keep-alive`, `keep-alive`, `model`, `effort`, `log-dir`, `no-diagrams`, `diagrams`, `graphify-command`, `archify-action`, `archify-quality`, `archify-bin`, `no-rollback`, `rollback`, `resilient`, `continue-on-failure`, `help`/`h`) PLUS new budget/limit/mode flags (`budget` / `max-budget`, `total-budget`, `usage-limit`, `max-turns`, `max-attempts`, `mode`, `config`).
   - Update `formatHelp()` (`config.ts:335-369`) to document all new flags and `.openspec-cascade.json` precedence.

### 2.2 F03 — `src/config/guardrails.ts` (Budget, Secret Redaction, Protected-Branch Guard)
1. **Budget Enforcement:**
   - Export `BudgetExceededError extends Error` (`spentUsd`, `maxBudgetUsd`, `scope: "session" | "total"`).
   - `enforceSessionBudget(spentUsd: number, maxBudgetUsd: number): void`:
     - Fail-closed: if `!Number.isFinite(spentUsd) || spentUsd < 0 || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0`, throw `BudgetExceededError` (or `ConfigValidationError` / `BudgetExceededError` with explicit NaN/invalid message — note `PROJECT.md:74` specifies throwing `BudgetExceededError` when `Number.isNaN(spentUsd)` or `spentUsd >= maxBudgetUsd`).
     - Strict boundary: `if (spentUsd >= maxBudgetUsd)` throw `BudgetExceededError`.
   - Wire into `cascade.ts` post-session outcome check (`enforceSessionBudget(outcome.costUsd, cfg.maxBudgetPerSessionUsd)`) AND total budget check (`enforceSessionBudget(totalCostUsd, cfg.maxTotalBudgetUsd)` or `enforceTotalBudget`) so `NaN` or `opencode`/`antigravity` overruns cannot slip through.
2. **Secret Redaction (`redactSensitiveData<T>(value: T, maxDepth?: number): T`):**
   - Use `seen = new WeakSet<object>()` passed down recursion to detect cycles and return `"[Circular]"` (cast cleanly without `any`, using `unknown` narrowing!).
   - Enforce `maxDepth` (default from `src/config/constants.ts`, e.g., `10`; reject negative/NaN `maxDepth` or clamp safely): when `depth >= maxDepth` on non-primitive values, return `"[MaxDepth]"`.
   - Preserve container types without collapsing to `{}`:
     - `Date` -> `new Date(value.getTime())`
     - `RegExp` -> `new RegExp(value.source, value.flags)`
     - `Array` -> `value.map((item) => redactNode(item, depth + 1, seen))`
     - `Set` -> `new Set(Array.from(value, (item) => redactNode(item, depth + 1, seen)))`
     - `Map` -> `new Map(Array.from(value.entries(), ([k, v]) => [isSensitiveKey(k) ? k : redactNode(k, depth + 1, seen), isSensitiveKey(k) ? REDACTED : redactNode(v, depth + 1, seen)]))`
     - `Error` -> preserve `name`, redact `message` and `stack` string patterns, redact own enumerable properties.
     - Plain objects -> create new object, redacting values whose keys match sensitive key regex (`/(?:api[_-]?key|token|secret|password|passwd|auth(?:orization)?|bearer|credential|private[_-]?key|cookie|session[_-]?id)/i`), and recursing on non-sensitive keys.
   - Redact sensitive inline string patterns (`redactString(str)`): Anthropic keys (`sk-ant-...`), OpenAI-style (`sk-...`), GitHub PATs (`ghp_...`, `gho_...`, `ghs_...`, `github_pat_...`), Google API keys (`AIza...`), AWS access keys (`AKIA...`), `Bearer <token>`, PEM private keys (`-----BEGIN ... PRIVATE KEY-----...-----END ... PRIVATE KEY-----`), and URL credentials (`https://user:pass@host`).
   - Wire `redactSensitiveData` into `cascade.ts`'s JSONL `log(event, data)` writer (and stderr/error logging) so secrets never land on disk.
3. **Protected-Branch Dry-Run Guard:**
   - Export `ProtectedBranchError extends Error` (or integrate with `Fatal` / exit code `2`) and `evaluateProtectedBranchGuard({ branch, protectedBranches, dryRun }): { allowed: boolean; isProtected: boolean; warning?: string }`:
     - If `protectedBranches.includes(branch)`:
       - When `dryRun === false`: `allowed: false` -> throw `Fatal` / `ProtectedBranchError` (hard block).
       - When `dryRun === true`: `allowed: true`, `warning: "Running --dry-run on protected branch ..."` -> permit read-only dry-run preview without writing logs or mutating git!
   - Wire into `cascade.ts` `preflight()`.

### 2.3 F04 — `src/config/loader.ts`, `src/config/index.ts`, `config.ts`, `platform.ts`, `cascade.ts`
1. **Layered Precedence in `src/config/loader.ts`:**
   - Precedence order: `overrides` (programmatic/test) > `CLI args` > `CASCADE_* env` > `.openspec-cascade.json` > `dynamic/repo defaults` (`CONSTANTS`).
   - `.openspec-cascade.json` discovery:
     - Look for `--config <path>` / `CASCADE_CONFIG` if specified (must exist or throw `ConfigValidationError`), otherwise check `resolve(repoRoot, ".openspec-cascade.json")` (falling back to `resolve(cwd, ".openspec-cascade.json")` if different).
     - Note: in unit tests like `config.test.ts` where `cwd: "/mock/repo"` does not exist on disk, missing default `.openspec-cascade.json` must silently fall back to `{}`; **existing** malformed JSON or schema-invalid `.openspec-cascade.json` must throw `ConfigValidationError` (fail-closed!).
   - Keep `loadConfig(options?: LoadConfigOptions | string[], env?: ...): CascadeConfig` compatible with BOTH:
     - Existing signature `loadConfig({ argv, env, cwd, overrides })` (`config.test.ts:90,160,212,227,318`)
     - Contract signature in `PROJECT.md:73`: `loadConfig(argv?: string[], env?: Record<string, string | undefined>)` (overload / type guard on first parameter).
   - Export `resolveEngine`, `resolveLogDir`, `parseCliArgs`, `isKeepAliveEnabled`, `formatHelp`, `getDefaultConfig`, `buildConfig` (alias/helper) cleanly from `src/config/index.ts` and re-export from root `config.ts` facade so all 18 existing consumers remain 100% backward-compatible.
2. **Dynamic Stack / Package Manager Detection (`platform.ts` + `src/config/loader.ts` + `cascade.ts`):**
   - `platform.ts:324-371` already has `detectPackageManager(cwd)` and `resolvePackageCommands(pm)`.
   - Enhance `platform.ts` (or helper `resolveDefaultVerifyCommands(repoRoot)`):
     - Given `repoRoot`, detect `pm = detectPackageManager(repoRoot)` and `cmds = resolvePackageCommands(pm)`.
     - `defaultVerify` defaults to `[cmds.test, cmds.lint]`; `fullVerify` defaults to `[cmds.typecheck, cmds.lint, cmds.test, cmds.build]` (preserving Nuxt-specific `TSC_SERVER`/`TSC_APP`/`test:e2e` ONLY when `.nuxt` or `nuxt.config.*` is detected, OR keeping `FULL_VERIFY` / `CONSTANTS.DEFAULT_VERIFY` exports in `config.ts` for `config.test.ts:120-121` and `qa.test.ts:160`!).
     - **Critical `config.test.ts` & `cascade.test.ts` compatibility constraint:**
       - `config.test.ts:120-121`: `loadConfig({ argv: [], env: {}, cwd: "/mock/repo" })` asserts `config.defaultVerify` equals `CONSTANTS.DEFAULT_VERIFY` (`["bun test", "bun run lint"]`) and `config.fullVerify` equals `FULL_VERIFY`! Why? Because `/mock/repo` has no lockfile; if `detectPackageManager("/mock/repo")` returns `"npm"`, changing `defaultVerify` to `["npm test", "npm run lint"]` for non-existent `/mock/repo` would **break `config.test.ts:120-121`**!
       - Therefore: when a lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`/`bun.lockb`) IS present in `repoRoot`, resolve `defaultVerify` / `fullVerify` dynamically via `resolvePackageCommands(pm)` (unless overridden by `.openspec-cascade.json` / `overrides`); when NO lockfile exists (e.g., `/mock/repo` in unit tests), fall back to `CONSTANTS.DEFAULT_VERIFY` / `FULL_VERIFY` (or inspect `detectPackageManager` carefully: `platform.ts:329` returns `"npm"` when no lockfile exists, so add `hasLockfile(cwd)` or `detectPackageManagerStrict(cwd): PackageManager | null` in `platform.ts` without breaking `detectPackageManager` tests in `platform.test.ts`!).
     - Similarly in `cascade.ts:196-226` (`verifyCommands(task, fullGate, options?)`):
       - Preserve 2-arg signature `verifyCommands(task, fullGate)` so `cascade.test.ts:75-120` passes unchanged, while accepting optional `{ repoRoot, config }` to adapt commands dynamically for non-Bun/non-Nuxt repositories (and replace `sh -c` / `bunx` assumptions cleanly via `resolvePackageCommands`).
3. **Remove Import-Time `loadConfig()` Side Effect in `cascade.ts`:**
   - Remove `export const config: CascadeConfig = loadConfig();` (`cascade.ts:102`) and module-level `const repo = config.repo; const engine = config.engine; const changes = config.changes; const logFile = ...` (`cascade.ts:113-117`).
   - Move `parseCliArgs` `--help` check and `loadConfig()` inside `main()` (or an exported `runCli(argv, env)` helper), wrapped in `try { ... } catch (err) { ... }` that handles `ConfigValidationError` and `Fatal` with **exit code `2`** (`CONSTANTS.EXIT_CODE_FATAL`) and prints clean error diagnostics to stderr.
   - Pass `CascadeConfig` (and derived `logFile`) explicitly to `log`, `sh`, `runSession`, `runChecks`, `commit`, `runTask`, `runChange`, `preflight`, `printPlan`, and default `taskPrompt(..., repoRoot = process.cwd())` (`cascade.ts:356`).
   - Verify `cascade.test.ts:5-27`: none of the tests import `config` from `./cascade`, so removing `export const config` from `cascade.ts` does not break `cascade.test.ts` (and `cascade.test.ts` tests `loadConfig` via `./config` in `config.test.ts`).

---

## 3. Caveats & Constraints

1. **Backward compatibility with existing tests (`1670` passing):**
   - `config.test.ts:90-129,271-277,316-333,373-404` asserts exact `CONSTANTS.*` values and `loadConfig({ argv: [], env: {}, cwd: "/mock/repo" })` defaults (`defaultVerify === CONSTANTS.DEFAULT_VERIFY`, `fullVerify === FULL_VERIFY`). Any dynamic package-manager detection in `loadConfig()` MUST NOT alter defaults for non-existent directories like `"/mock/repo"`.
   - `cascade.test.ts:75-120` tests `verifyCommands(task, fullGate)` with 2 arguments expecting Nuxt/Bun outputs on the test fixtures.
   - `platform.test.ts` tests `detectPackageManager` returning `"npm"` when no lockfile exists (`platform.ts:329`) — do NOT break `detectPackageManager`'s return value; add a separate `hasLockfile` / `tryDetectPackageManager` helper if needed.
2. **Synchronous vs. Asynchronous `loadConfig()`:**
   - `config.test.ts` calls `loadConfig(...)` synchronously (`const config = loadConfig(...)`). Reading `.openspec-cascade.json` in `loadConfig()` MUST remain synchronous (`existsSync` + `readFileSync`) to preserve the synchronous contract.
3. **Zero `any`, Zero Magic Numbers, Zero Inline Body Comments:**
   - All new files (`src/config/schemas.ts`, `src/config/guardrails.ts`, `src/config/loader.ts`, `src/config/index.ts`) and modified files (`config.ts`, `platform.ts`, `cascade.ts`) must pass `tsc --noEmit` (`strict: true`, `noUncheckedIndexedAccess: true`), `eslint .` (with `@typescript-eslint/no-explicit-any: "error"` and `@typescript-eslint/no-magic-numbers`), and Clean Code Rule #1 (no inline `//` comments inside function bodies).
4. **Workspace cleanliness:**
   - `bun test` may dirty 3 tracked files under `.agents/teamwork/reviewer_INTEG-RUN-001/`; do not stage/commit `.agents/teamwork/` or `PROJECT.md`.

---

## 4. Concrete Action Plan for Worker

1. **Dependencies:** Run `export PATH="$HOME/.bun/bin:$PATH" && bun add zod` and verify `package.json` + `bun.lock`.
2. **Implement `src/config/schemas.ts` (F02):**
   - Define `ConfigValidationError`, strict finite-number/boolean coercers, modular Zod schemas (`RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `TelemetryConfigSchema`, `DiagramsConfigSchema`, `CascadeFileConfigSchema`, `CascadeConfigSchema`).
3. **Implement `src/config/guardrails.ts` (F03):**
   - Implement `BudgetExceededError` + `enforceSessionBudget` (`NaN`/non-finite fail-closed + strict `>=`), `redactSensitiveData` (`WeakSet` cycle detection, bounded `maxDepth`, container preservation for `Array`/`Map`/`Set`/`Date`/`RegExp`/`Error`, key + token pattern redaction), and `evaluateProtectedBranchGuard` / `assertBranchSafety` (block non-dry-run on `main`/`master`/`stable`, allow `--dry-run` with warning).
4. **Implement `src/config/loader.ts` & `src/config/index.ts` (F04):**
   - Implement strict `parseCliArgs` (`strict: true`, no error swallowing, new flags `--budget`/`--max-budget`, `--total-budget`, `--usage-limit`, `--max-turns`, `--max-attempts`, `--mode`, `--config`), `.openspec-cascade.json` loading with Zod validation, precedence (`overrides > CLI > env > file > defaults`), and `hasLockfile`/`tryDetectPackageManager` integration from `platform.ts`.
5. **Refactor `config.ts`, `platform.ts`, `cascade.ts`:**
   - Turn `config.ts` into a clean facade over `src/config/` preserving all existing exports (`CONSTANTS`, `FULL_VERIFY`, `QA_VERIFY_COMMANDS`, `CascadeConfig`, `loadConfig`, `getDefaultConfig`, `parseCliArgs`, `resolveEngine`, `resolveLogDir`, `isKeepAliveEnabled`, `formatHelp`).
   - Add lockfile-aware helper in `platform.ts` without breaking `detectPackageManager`.
   - Remove import-time `loadConfig()` from `cascade.ts`; pass `CascadeConfig` explicitly; catch `ConfigValidationError` and `Fatal` in `main()` and exit with `EXIT_CODE_FATAL` (`2`); wire `enforceSessionBudget`, `redactSensitiveData` in `log()`, and protected-branch dry-run guard in `preflight()`.
6. **Tests & Verification:**
   - Add unit tests in `test/config/schemas.test.ts`, `test/config/guardrails.test.ts`, `test/config/loader.test.ts` plus updates to `config.test.ts` and `cascade.test.ts` (using real production modules, zero fake stubs).
   - Verify CLI exit codes directly:
     - `bun run cascade.ts --engine invalid` -> exit `2`
     - `bun run cascade.ts --unknown-flag` -> exit `2`
     - `bun run cascade.ts --budget -5` -> exit `2`
     - `bun run cascade.ts --budget abc` -> exit `2`
     - `bun run cascade.ts --help` -> exit `0`
   - Run `bun test && bun run typecheck && bun run lint`.

---

## 5. Verification Commands

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test
bun run typecheck
bun run lint
bunx openspec validate --strict
```
