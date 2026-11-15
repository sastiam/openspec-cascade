# Explorer M1-1 Handoff: Constants, Platform & Config Facade Exploration

- **Agent:** `explorer_m1_1`
- **Target Scope:** F01 (`src/config/constants.ts`), F04 (`src/config/loader.ts`, `config.ts`, `platform.ts`, `cascade.ts`), plus M1 compatibility/hygiene observations for F02/F03/F05.
- **Branch / Baseline:** `feat/cascade-looper-v2` at `70e2537` (`Merge pull request #43 from sastiam/feat/claude-cli-installer`).

---

## 1. Baseline Verification Observed

- `bun run typecheck` (`tsc --noEmit`): **exit 0** (0 errors).
- `bun run lint` (`eslint .`): **exit 0** (0 errors, 0 warnings). Note: `eslint.config.js` currently does **not** enforce `@typescript-eslint/no-explicit-any: "error"`.
- `bun test config.test.ts platform.test.ts lint.test.ts cascade.test.ts qa.test.ts engine.test.ts`: **124 pass, 0 fail** (490 `expect()` calls across 6 files).
- `bunx openspec --version`: `1.17.0`.
- `src/config/` directory: **does not exist yet** (`src/` contains `core/`, `engine/`, `gates/`, `integration/`, `pal/`, `sdd/`, `storage/`).
- `package.json`: `zod` is **not** currently in `dependencies` or `devDependencies` (lines 16-26).

---

## 2. Core File Analysis (`config.ts`, `platform.ts`, `package.json`, `tsconfig.json`, `cascade.ts`, `qa.ts`)

### 2.1 `config.ts` (657 lines)
- **Exports to preserve for 100% backward compatibility:**
  - Types: `EngineType` (`"claude" | "opencode" | "antigravity"`, line 13), `CascadeConfig` (lines 176-263), `ParsedCliOptions` (lines 265-289), `LoadConfigOptions` (lines 291-296), `LogDirInput` (lines 312-323).
  - Constants: `CONSTANTS` (lines 16-164), `FULL_VERIFY` (lines 166-172), `QA_VERIFY_COMMANDS` (line 174).
  - Functions: `resolveEngine` (lines 298-304), `isKeepAliveEnabled` (lines 306-310), `resolveLogDir` (lines 326-330), `formatHelp` (lines 367-369), `parseCliArgs` (lines 371-409), `loadConfig` (lines 425-652), `getDefaultConfig` (lines 654-656).
  - **Important gap:** `buildConfig` (mentioned in `DISPATCH.md`) does **not** exist in `config.ts` today; callers use `loadConfig` / `getDefaultConfig`. If M1 introduces `buildConfig` as part of the new `src/config/loader.ts` API, re-export it alongside `loadConfig` and `getDefaultConfig`.
- **Silent failure / fail-open defects in `config.ts`:**
  - `parseCliArgs` (lines 371-409) wraps `parseArgs` in `try { ... } catch { return { options: {}, positionals: [] }; }` (lines 406-408) — swallows malformed flags/missing flag values silently instead of failing closed with exit code `2` (`CONSTANTS.EXIT_CODE_FATAL`).
  - `parseCliArgs` uses `strict: false` (line 402), allowing unknown CLI flags to be silently ignored.
  - `parseCliArgs` (lines 378-401) does **not** yet define CLI options for `--budget` / `--max-budget`, `--total-budget`, `--usage-limit`, `--max-turns`, `--max-attempts`, `--mode`, `--config`, etc.
  - `parseNumber` (lines 411-415) silently falls back to `defaultValue` when `Number(value)` is `NaN`/non-finite, instead of throwing a validation error when an invalid non-empty value is supplied.
  - `loadConfig` (lines 425-652) has no file-based config layer (`.openspec-cascade.json`) and no Zod boundary validation.
  - Inline comments exist in `CONSTANTS` (lines 17, 23, 30, etc.) and inside `loadConfig` (`// 1. Repo` .. `// 9. Failure Resilience & Rollback Buffer`, lines 433-579).

### 2.2 `platform.ts` (373 lines)
- **Exports to preserve:**
  - Constants: `DEFAULT_SYSTEMD_INHIBIT_PATH` (line 12), `SYSTEMD_INHIBIT_WHAT` (line 13), `SYSTEMD_INHIBIT_WHO` (line 14), `SYSTEMD_INHIBIT_WHY` (line 15), `SYSTEMD_INHIBIT_HOLD_COMMAND` (line 16), `CAFFEINATE_BIN` (line 18), `CAFFEINATE_FLAG_IDLE` (line 19), `CAFFEINATE_FLAG_WAIT_PID` (line 20), `EXIT_CODE_SIGINT` (line 22), `EXIT_CODE_SIGTERM` (line 23).
  - Types: `KeepAliveMechanism` (line 25), `KeepAliveController` (lines 27-31), `ProcessSignalTarget` (lines 33-38), `KeepAliveChildProcess` (lines 40-42), `KeepAliveOptions` (lines 44-63), `PackageManager` (line 311), `PackageCommands` (lines 313-319).
  - Functions: `normalizePlatformPath` (lines 68-70), `isMacOS` (lines 75-77), `isLinux` (lines 82-84), `resolveBinaryInPath` (lines 89-105), `findSystemdInhibit` (lines 110-115), `canRunSystemdInhibit` (lines 120-139), `buildKeepAliveArgs` (lines 144-169), `startKeepAlive` (lines 223-309), `detectPackageManager` (lines 324-330), `resolvePackageCommands` (lines 335-371).
- **Explicit `any` leaks:**
  - `ProcessSignalTarget` (lines 34-36): `listener: (...args: any[]) => void`.
  - `removeEventListener` (line 174): `listener: (...args: any[]) => void`.
  - `platform.test.ts` (lines 84-86): `mockSuccess as any`, `mockFailure as any`, `mockThrow as any`.
- **Direct `Bun.*` runtime assumptions:**
  - `canRunSystemdInhibit` (line 122): defaults `spawnSyncFn` directly to `Bun.spawnSync` (throws `ReferenceError: Bun is not defined` under Node.js 24 if omitted).
  - `startKeepAlive` (lines 237-238): defaults `spawnFn = options.spawn ?? Bun.spawn` and `spawnSyncFn = options.spawnSync ?? Bun.spawnSync`.
- **Unused / unwired stack helpers:**
  - `detectPackageManager` (lines 324-330) and `resolvePackageCommands` (lines 335-371) are tested in `platform.test.ts` (lines 436-474) but have **zero production consumers** across `config.ts`, `cascade.ts`, `qa.ts`, or `src/`.
- **Inline comments inside function bodies:** Lines 101, 258, 296.

### 2.3 `cascade.ts` (626 lines)
- **Import-time side effects (blocking safe library import & testing):**
  - Line 102: `export const config: CascadeConfig = loadConfig();` executes at module load time! Importing `cascade.ts` parses `process.argv` immediately.
  - Lines 113-117: module-level bindings `repo = config.repo`, `engine = config.engine`, `changes = config.changes`, `logFile = join(config.logDir, ...)` lock in config at import time.
  - Line 621: CLI entrypoint `if (import.meta.main) main().catch(...)` exits with `CONSTANTS.EXIT_CODE_FATAL` (2) on `Fatal` or `CONSTANTS.EXIT_CODE_ERROR` (1) otherwise. Note: if `loadConfig()` throws `ConfigValidationError` on invalid CLI flags, `cascade.ts` must catch it (in CLI entrypoint, not at import time) and exit fail-closed with code `2` (`CONSTANTS.EXIT_CODE_FATAL`).
- **Re-exports to preserve (lines 69-94):**
  - `captureGitState`, `describeToolInput`, `discoverArchifyTargets`, `Fatal`, `formatVerificationFeedback`, `isKeepAliveEnabled`, `oneLine`, `resolveEngine`, `rollbackWorkingTree`, `RollbackStateBuffer`, `runVerificationPhase`, `syncDiagrams`, `TaskFailureError` (plus their exported types), plus `config` (if consumers read it, or lazy getter/compat wrapper), `getKeepAliveController`, `parseTasks`, `verifyCommands`, `blockedReason`, `commitTypeOf`, `commitsPerSection`, `isLastOfSection`, `taskPrompt`, `runChecks`.
- **Inline comments inside function bodies:** Lines 165, 204, 211, 234, 425, 447, 480.

### 2.4 `tsconfig.json` & `package.json`
- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `moduleResolution: "bundler"`, `types: ["bun"]`, `include: ["*.ts", "src/**/*.ts", "test/**/*.ts"]` (lines 1-13). Note that `projects/**/*.ts` is **not** in `tsconfig.json` `include`, though `eslint.config.js` matches `files: ["**/*.ts"]`.
- `package.json`: `"type": "module"`, `"dependencies": { "@anthropic-ai/claude-agent-sdk": "0.3.309" }` (no `zod` yet). Scripts: `start`, `install:claude`, `cascade:looper`, `typecheck`, `lint` (lines 9-15).

---

## 3. Consumer Map for `config.ts` and `platform.ts`

Every production and test import of `config.ts` and `platform.ts` in the repository:

### 3.1 Consumers of `config.ts`
| Consumer File | Imported Symbols | Key Property / API Dependencies |
|---|---|---|
| `cascade.ts` (lines 17-26) | `CONSTANTS`, `formatHelp`, `FULL_VERIFY`, `isKeepAliveEnabled`, `loadConfig`, `parseCliArgs`, `resolveEngine`, `type CascadeConfig` | Uses `CONSTANTS.{ARGV_START_INDEX, TSC_SERVER, TSC_APP, NO_NEW_MIGRATION, DEFAULT_VERIFY, CONVENTIONAL_TYPE_REGEX, EPOCH_MS_THRESHOLD, MS_PER_SECOND, MS_PER_MINUTE, DEFAULT_EFFORT, LOG_TEXT_MAX_LENGTH, DECIMAL_PLACES_USD, CHECK_FAILURE_OUTPUT_MAX_LENGTH, EXIT_CODE_SUCCESS, COMMIT_ERROR_OUTPUT_MAX_LENGTH, COMMIT_MESSAGE_MAX_LENGTH, CONVENTIONAL_HEADER_REGEX, DIAGRAM_SYNC_TIMEOUT_MS, HUMAN_TASK_REGEX, TASK_SUMMARY_MAX_LENGTH, GIT_STATUS_PREFIX_LENGTH, EXIT_CODE_FATAL, EXIT_CODE_ERROR}` and `CascadeConfig` fields. |
| `qa.ts` (line 8) | `CONSTANTS` | `CONSTANTS.{COMMAND_TIMEOUT_MS, EXIT_CODE_SUCCESS, EXIT_CODE_ERROR, CHECK_FAILURE_OUTPUT_MAX_LENGTH, QA_VERIFY_COMMANDS, CHECK_FAILURE_TAIL_LINES}` |
| `engine.ts` (line 8) | `CONSTANTS` (unused import!), `type CascadeConfig`, `type EngineType`, `resolveEngine` | `resolveEngine(engine)`, `CascadeConfig`, `EngineType`. Note: `CONSTANTS` at `engine.ts:8` is unused. |
| `claude.ts` (line 8) | `CONSTANTS` | `CONSTANTS.{EPOCH_MS_THRESHOLD, MS_PER_SECOND, DEFAULT_EFFORT, SETTING_SOURCES, ALLOWED_TOOLS, DENIED_BASH, MAX_TURNS_PER_SESSION, MAX_BUDGET_PER_SESSION_USD, RESET_MARGIN_MS, UNKNOWN_RESET_SLEEP_MS, USAGE_LIMIT_PERCENT, DEFAULT_CLAUDE_MODEL}` |
| `opencode.ts` (line 8) | `CONSTANTS` | `CONSTANTS.{DEFAULT_OPENCODE_MODEL, OPENCODE_SESSION_TIMEOUT_MS, RATE_LIMIT_SLEEP_MS, STDERR_TAIL_MAX_LENGTH, EXIT_CODE_SUCCESS, ERROR_DETAIL_MAX_LENGTH, DENIED_BASH}` |
| `antigravity.ts` (line 10) | `CONSTANTS` | `CONSTANTS.{DEFAULT_ANTIGRAVITY_MODEL, ANTIGRAVITY_SESSION_TIMEOUT_MS, RATE_LIMIT_SLEEP_MS, TOKEN_PRICE_BASE, GEMINI_FLASH_INPUT_COST, GEMINI_FLASH_OUTPUT_COST, GEMINI_PRO_INPUT_COST, GEMINI_PRO_OUTPUT_COST, ONE_LINE_MAX_LENGTH, TOOL_INPUT_MAX_LENGTH, STDERR_TAIL_MAX_LENGTH, EXIT_CODE_SUCCESS, ERROR_DETAIL_MAX_LENGTH}` |
| `diagrams.ts` (line 11) | `CONSTANTS` | `CONSTANTS.{ARCHIFY_DIR_NAME, ARCHIFY_CANDIDATE_JSON, ARCHIFY_CANDIDATE_MD, ARCHIFY_DEFAULT_TYPE, ARCHIFY_FALLBACK_EXT, ARCHIFY_DEFAULT_QUALITY, ARCHIFY_EXPLAINER_TYPE, ARCHIFY_ACTION, GRAPHIFY_COMMAND, DIAGRAM_SYNC_TIMEOUT_MS, EXIT_CODE_SUCCESS}` |
| `src/sdd/sdd_gate.ts` (line 10) | `CONSTANTS` | `CONSTANTS.{SDD_PRODUCTION_EXTENSIONS, SDD_EXEMPT_PATH_SEGMENTS, SDD_EXEMPT_NAME_PREFIXES, SDD_EXEMPT_NAME_SUFFIXES, SDD_GATED_TOOLS}` |
| `src/sdd/surface_verifier.ts` (line 8) | `CONSTANTS` | `CONSTANTS.{SDD_FRONTEND_EXTENSIONS, SDD_API_PATH_PATTERNS, DEFAULT_VERIFY}` |
| `src/sdd/review_verifier.ts` (line 8) | `CONSTANTS` | `CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS` |
| `src/sdd/analyze.ts` (line 13) | `CONSTANTS` | `CONSTANTS.{SDD_CONSTITUTION_PATH, SDD_MIN_KEYWORD_LENGTH}` |
| `src/engine/rollback_buffer.ts` (line 30) | `CONSTANTS` | Imported at line 30 (`import { CONSTANTS } from "../../config";`), though `ROLLBACK_CONSTANTS` defines its own values locally. |
| `config.test.ts` (lines 2-12) | `CONSTANTS`, `formatHelp`, `FULL_VERIFY`, `getDefaultConfig`, `isKeepAliveEnabled`, `loadConfig`, `parseCliArgs`, `resolveEngine`, `resolveLogDir` | Asserts exact keys/values on `CONSTANTS` (lines 99-128, 375-402), `loadConfig`, `getDefaultConfig`, `resolveLogDir`, `formatHelp`, `parseCliArgs`. |
| `qa.test.ts` (line 2) | `CONSTANTS`, `QA_VERIFY_COMMANDS` | Checks `QA_VERIFY_COMMANDS` default command list (line 160). |
| `engine.test.ts` (line 2) | `CONSTANTS`, `getDefaultConfig` | Checks `DEFAULT_CLAUDE_MODEL`, `MS_PER_SECOND`, `MAX_TURNS_PER_SESSION`, `MAX_BUDGET_PER_SESSION_USD`, `DEFAULT_OPENCODE_MODEL`, `DEFAULT_ANTIGRAVITY_MODEL`. |
| `diagrams.test.ts` (line 4) | `CONSTANTS` | Checks `CONSTANTS.GRAPHIFY_COMMAND`. |
| `resilience.test.ts` (line 2) | `CONSTANTS` | Checks `CONSTANTS.GIT_HEAD_REF`. |
| `test/sdd/surface_verifier.test.ts` (line 40) | Indirect via `surface_verifier.ts` | Expects `report.recommendedChecks` to contain `"bun test"` in current repo (which has `bun.lock`, so `detectPackageManager(cwd)` still resolves `"bun"`!). |

### 3.2 Consumers of `platform.ts`
| Consumer File | Imported Symbols |
|---|---|
| `config.ts` (line 11) | `normalizePlatformPath` |
| `cascade.ts` (line 34) | `startKeepAlive`, `type KeepAliveController` |
| `platform.test.ts` (lines 4-26) | All exported helpers, constants, and `ProcessSignalTarget` |

---

## 4. Inventory of `*_CONSTANTS` Objects & Drifting Constants (`src/` & root)

There are **33 centralized constant objects** across the codebase (`CONSTANTS` in `config.ts` + **32** `*_CONSTANTS` objects in `src/`):
- `src/storage/memory.ts:18` (`STORAGE_CONSTANTS`)
- `src/integration/schema_validator.ts:29` (`SCHEMA_VALIDATOR_CONSTANTS`)
- `src/integration/github_project.ts:18` (`GITHUB_PROJECT_CONSTANTS`)
- `src/integration/drift_detector.ts:37` (`DRIFT_CONSTANTS`)
- `src/integration/catalog_generator.ts:67` (`CATALOG_CONSTANTS`)
- `src/pal/react_parser.ts:14` (`REACT_PARSER_CONSTANTS`)
- `src/pal/mcp.ts:39` (`MCP_BRIDGE_CONSTANTS`)
- `src/pal/adapters/opencode.ts:90` (`OPENCODE_ADAPTER_CONSTANTS`)
- `src/pal/adapters/gemini.ts:53` (`GEMINI_ADAPTER_CONSTANTS`)
- `src/pal/adapters/jules.ts:41` (`JULES_ADAPTER_CONSTANTS`)
- `src/pal/adapters/claude.ts:52` (`CLAUDE_ADAPTER_CONSTANTS`)
- `src/engine/rollback_buffer.ts:35` (`ROLLBACK_CONSTANTS`)
- `src/gates/gate0_parser.ts:17` (`GATE0_PARSER_CONSTANTS`)
- `src/gates/gate0_policy.ts:21` (`GATE0_POLICY_CONSTANTS`)
- `src/gates/gate0_qa.ts:42` (`GATE0_CONSTANTS`)
- `src/gates/gate1_feedback.ts:52` (`GATE1_FEEDBACK_CONSTANTS`)
- `src/gates/gate1_review.ts:69` (`GATE1_CONSTANTS`)
- `src/gates/gate1_rubric.ts:34` (`GATE1_RUBRIC_CONSTANTS`)
- `src/gates/gate2_challenger.ts:101` (`GATE2_CONSTANTS`)
- `src/gates/gate2_injector.ts:46` (`GATE2_INJECTOR_CONSTANTS`)
- `src/gates/gate2_synthesis.ts:44` (`GATE2_SYNTHESIS_CONSTANTS`)
- `src/gates/gate3_audit.ts:93` (`GATE3_CONSTANTS`)
- `src/gates/gate3_scanner.ts:41` (`GATE3_SCANNER_CONSTANTS`)
- `src/core/snapshot.ts:38` (`SNAPSHOT_CONSTANTS`)
- `src/core/fsm_types.ts:15` (`FSM_CONSTANTS`)
- `src/core/fsm.ts:139` (`FSM_ENGINE_CONSTANTS`)
- `src/core/roles.ts:22` (`ROLES_CONSTANTS`)
- `src/core/escalation.ts:50, 128, 247` (`ESCALATION_CONSTANTS`, `SUCCESSION_CONSTANTS`, `FAILURE_CLASSIFIER_CONSTANTS`)
- `src/core/dag.ts:16` (`DAG_CONSTANTS`)
- `src/core/dispatcher.ts:138` (`DISPATCHER_CONSTANTS`)

### Confirmed Drifting / Duplicated Constants Across `config.ts` and `src/`
1. **Rate Limit Sleep (`RATE_LIMIT_SLEEP_MS` vs `RATE_LIMIT_RESET_FALLBACK_MS`):**
   - `config.ts:34`: `CONSTANTS.RATE_LIMIT_SLEEP_MS = 1_800_000` (30 min; used by `opencode.ts:18` and `antigravity.ts:20`).
   - `src/pal/adapters/opencode.ts:160`: `OPENCODE_ADAPTER_CONSTANTS.RATE_LIMIT_SLEEP_MS = 30_000` (30 sec — **60x shorter!**) & line `107`: `RATE_LIMIT_RESET_FALLBACK_MS = 60_000`.
   - `src/pal/adapters/gemini.ts:139`: `GEMINI_ADAPTER_CONSTANTS.RATE_LIMIT_SLEEP_MS = 30_000` (30 sec — **60x shorter!**) & line `75`: `RATE_LIMIT_RESET_FALLBACK_MS = 60_000`.
   - `src/pal/adapters/claude.ts:79`: `CLAUDE_ADAPTER_CONSTANTS.RATE_LIMIT_RESET_FALLBACK_MS = 60_000` (vs `config.ts:20`: `UNKNOWN_RESET_SLEEP_MS = 1_800_000`).
2. **Default Models:**
   - Gemini/Antigravity drift: `config.ts:39` `DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.8-flash-high"` vs `src/pal/adapters/gemini.ts:55-56` `DEFAULT_MODEL = "gemini-2.5-pro"`, `FALLBACK_MODEL = "gemini-2.0-flash"`.
   - Claude duplication (4 sites): `config.ts:41`, `src/pal/adapters/claude.ts:54`, `src/gates/gate1_review.ts:114`, `src/gates/gate2_challenger.ts:151` all hardcode `"claude-3-7-sonnet-20250219"`.
   - OpenCode duplication (2 sites): `config.ts:40` and `src/pal/adapters/opencode.ts:92` both hardcode `"opencode/deepseek-v4.1-flash"`.
   - Jules: `src/pal/adapters/jules.ts:43` `DEFAULT_MODEL = "jules"`.
3. **Truncation Bounds (`STDERR_TAIL_MAX_LENGTH` & `ERROR_DETAIL_MAX_LENGTH`):**
   - `config.ts:102-103`: `500` / `300`.
   - `src/pal/adapters/opencode.ts:158-159`: `400` / `200`.
   - `src/pal/adapters/gemini.ts:137-138`: `400` / `200`.
4. **Exit Codes (`0`, `1`, `2`, `124`, `130`, `143`):**
   - `config.ts:117-119`: `EXIT_CODE_SUCCESS: 0`, `EXIT_CODE_ERROR: 1`, `EXIT_CODE_FATAL: 2`.
   - `platform.ts:22-23`: `EXIT_CODE_SIGINT: 130`, `EXIT_CODE_SIGTERM: 143`.
   - `src/gates/gate0_qa.ts:44-47`, `gate2_challenger.ts:154-157`, `gate2_injector.ts:100-103`: `EXIT_CODE_SUCCESS: 0`, `EXIT_CODE_FAILURE: 1`, `EXIT_CODE_ERROR: 2` (inverted semantic naming vs `config.ts` where `1=ERROR`, `2=FATAL`!), `EXIT_CODE_TIMEOUT: 124`.
   - `src/gates/gate1_review.ts:164-166`: `0`, `1`, `2`.
   - `src/gates/gate3_audit.ts:255-257` and `src/engine/rollback_buffer.ts:73-75`: `EXIT_CODE_SUCCESS: 0`, `EXIT_CODE_ERROR: 1`, `EXIT_CODE_TIMEOUT: 124`.
   - `plugins/cascade/hooks/sdd_gate.mjs:52`: literal `return 2`.
5. **Retry Caps (`MAX_ATTEMPTS`):**
   - `3`: `config.ts:24`, `src/core/fsm_types.ts:20`, `src/gates/gate0_qa.ts:55`, `src/gates/gate0_policy.ts:40`, `src/gates/gate1_review.ts:88`, `src/gates/gate1_feedback.ts:119`, `src/gates/gate3_audit.ts:141`.
   - `2`: `src/gates/gate2_challenger.ts:121`, `src/gates/gate2_injector.ts:83`, `src/core/escalation.ts:64, 254`.
6. **Timeouts:**
   - Command / Gate timeout `1_800_000`: `config.ts:28`, `src/gates/gate0_qa.ts:50`, `src/engine/rollback_buffer.ts:72`.
   - CLI session timeout `2_700_000`: `config.ts:31-33`, `src/pal/adapters/opencode.ts:157`, `src/pal/adapters/gemini.ts:136`.
   - Gate / Diagram / Subagent timeout `300_000`: `config.ts:138`, `src/gates/gate0_qa.ts:51`, `src/gates/gate1_review.ts:89`, `src/gates/gate2_challenger.ts:122`, `src/gates/gate3_audit.ts:142`, `src/core/dispatcher.ts:150-151`, `src/storage/memory.ts:32`.
   - Git / Probe / API timeout `30_000` & `60_000`: `src/gates/gate1_review.ts:90`, `gate2_challenger.ts:123`, `gate2_injector.ts:81`, `gate3_audit.ts:144`, `gate0_qa.ts:52`, `src/pal/mcp.ts:41`, `src/integration/github_project.ts:25` (`30_000`); `src/pal/adapters/{claude,gemini,opencode}.ts`, `src/gates/gate3_audit.ts:143`, `src/engine/rollback_buffer.ts:71` (`60_000`).
7. **Protected Paths / Rollback Excludes (`NEVER_COMMIT` vs `DEFAULT_EXCLUDES`):**
   - `config.ts:45`: `NEVER_COMMIT = [".atl", ".claude/settings.local.json"]`.
   - `src/engine/rollback_buffer.ts:53-59` & `src/gates/gate3_audit.ts:220-226`: `DEFAULT_EXCLUDES` / `DEFAULT_ROLLBACK_EXCLUDES = [".agents/teamwork/", "projects/", "logs/", ".atl", ".claude/settings.local.json"]`.
8. **Succession / Concurrency / Budget / Magic Literals:**
   - `DEFAULT_MAX_SPAWNS = 16` & `TOKEN_WATERMARK = 80` duplicated in `src/core/fsm_types.ts:22-23`, `src/core/escalation.ts:121-122, 130, 135`, `src/core/snapshot.ts:57-58`, `src/core/dispatcher.ts:142`.
   - `DEFAULT_MAX_CONCURRENT = 4` duplicated in `src/core/dag.ts:30`, `src/core/dispatcher.ts:140`.
   - Uncentralized string/number literal in `cascade.ts:376`: `max 60 chars` in prompt string.

---

## 5. Hardcoded Bun / Nuxt / Drizzle Assumptions

| File & Lines | Hardcoded Assumption | Impact / Remediation for M1 |
|---|---|---|
| `config.ts:72-74` | `DENIED_BASH` hardcodes `"Bash(bun run db:push)"`, `"Bash(bun run db:push *)"`, `"Bash(bun run db:migrate *)"` | Keep defaults for backward compat or generalize via stack/package-manager commands (`npm`/`pnpm`/`yarn`/`bun`). |
| `config.ts:78-88`, `166-172` | `DEFAULT_VERIFY`, `QA_VERIFY_COMMANDS`, `TSC_SERVER` (`bunx tsc --noEmit -p .nuxt/tsconfig.server.json`), `TSC_APP` (`bunx tsc --noEmit -p .nuxt/tsconfig.app.json`), `NO_NEW_MIGRATION` (`bun run db:generate ... migrations/`), `FULL_VERIFY` (`bun run build`, `bun run test:e2e`) | Nuxt & Drizzle-specific! `config.ts` / `src/config/loader.ts` must resolve default verify commands dynamically from `detectPackageManager(repo)` + `resolvePackageCommands(pm)` (in `platform.ts`), only applying Nuxt `.nuxt/` or `db:generate` overrides when configured or detected. |
| `cascade.ts:143, 285` | `Bun.spawn`, `Bun.sleep` | Note: `Bun.spawn` / `Bun.sleep` full migration to `ISpawner` is M2 (F06), though `cascade.ts` config loading & verify command resolution belong in M1 (F04). |
| `cascade.ts:203, 205-225` | `verifyCommands()` ignores commands not matching `/^bunx? /`, expands `bunx tsc --noEmit` to Nuxt `TSC_SERVER` + `TSC_APP`, hardcodes `"bun run lint"`, `"bun run build"`, `"bun run test:e2e"`, and prepends `"bunx nuxi prepare"` whenever any command includes `"tsc"`! | Severe Nuxt/Bun lock-in! Prevents `npm`/`pnpm`/`yarn` or non-Nuxt TS repos from running `verifyCommands()`. Must use `detectPackageManager` / `resolvePackageCommands` and only inject `nuxi prepare` / `.nuxt/tsconfig.*.json` if `.nuxt` or `nuxt.config.*` exists (or explicitly configured). Note: `cascade.test.ts:75-120` currently tests the Nuxt behavior — inspect/update carefully if defaults change vs explicit config! |
| `cascade.ts:368` | `taskPrompt` hardcodes `- Never run \`bun run db:push\` or apply migrations.` | Should be stack-agnostic or derived from config. |
| `platform.ts:122, 237-238` | `canRunSystemdInhibit` and `startKeepAlive` default to `Bun.spawnSync` / `Bun.spawn` | Will throw on Node.js 24 if `spawn`/`spawnSync` options are not passed; fallback or runtime guard needed (or Node `child_process` fallback until M2 `ISpawner`). |
| `diagrams.ts:178` | `Bun.which("archify")` | M2 F06 (`ISpawner.which`), flagged for awareness. |
| `opencode.ts:98`, `antigravity.ts:278` | `Bun.spawn(...)` | M2 F06 (`ISpawner`), flagged for awareness. |
| `src/gates/gate0_qa.ts:97-102, 637-664` | `GATE0_CONSTANTS.DEFAULT_COMMANDS` and `buildCommandList` hardcode `bun test`, `bunx tsc --noEmit`, `bun run lint`, `bun run build` | Should accept/derive package-manager commands from config/platform. |
| `src/gates/gate3_audit.ts:229-233` | `DEFAULT_CLEAN_ROOM_QA_COMMANDS` hardcodes `bun test`, `bunx tsc --noEmit`, `bun run lint` | Should derive from config/package manager. |
| `src/sdd/surface_verifier.ts:51` | `recommendedChecks = [...CONSTANTS.DEFAULT_VERIFY]` | If `DEFAULT_VERIFY` becomes dynamic per `repo`, `classifySurfaces(filePaths, repoRoot?)` can resolve via `resolvePackageCommands(detectPackageManager(repoRoot))` (which still returns `"bun test"` for this repo, keeping `test/sdd/surface_verifier.test.ts:40` green). |
| `src/core/roles.ts:277, 286, 318, 336, 1204`, `src/core/snapshot.ts:876, 895, 916`, `src/gates/gate1_feedback.ts:495, 814` | Prompt/fallback strings hardcode `bun test`, `bunx tsc --noEmit`, `bun run db:push` | Flagged for M1/M4 cleanup. |

---

## 6. F05 Findings: `no-explicit-any`, `lint.test.ts`, and Clean Code Readiness

1. **`eslint.config.js` (lines 17-35):**
   - Currently enforces `@typescript-eslint/no-magic-numbers` and `@typescript-eslint/explicit-module-boundary-types`, but **does NOT include `@typescript-eslint/no-explicit-any: "error"`**.
   - Note: `eslint.config.js` `files: ["**/*.ts"]` includes test files and `projects/**/*.ts` (only `no-magic-numbers` is overridden for `**/*.test.ts` at lines 36-41).
2. **Existing `any` leaks that WILL fail `@typescript-eslint/no-explicit-any: "error"`:**
   - **Production / project files:**
     - `platform.ts:34, 35, 36, 174` (`(...args: any[]) => void`)
     - `opencode.ts:55` (`let event: Record<string, any>;`)
     - `antigravity.ts:98` (`raw: Record<string, any>`) and `antigravity.ts:198` (`let event: Record<string, any>;`)
     - `src/pal/adapters/gemini.ts:1890, 1914` (`proc.stderr as any`, `proc.stdout as any`)
     - `projects/agnostic_looper/verify_project_items.ts:168` (`(t: any) => ...`)
     - *(Note: `src/gates/gate2_synthesis.ts:376-400, 498-520, 629-637, 725-733` contains `as any` inside template literal strings generating runtime test probe scripts, NOT in executed TS AST).*
   - **Test files (if `no-explicit-any` is not scoped or fixed):**
     - `platform.test.ts:84, 85, 86` (`mockSuccess as any`, `mockFailure as any`, `mockThrow as any`)
     - `engine.test.ts:35` (`"unsupported" as any`)
     - `test/integration/github_project.test.ts:370` (`nodes[0] as any`)
     - *(Matches in `test/gates/gate1.test.ts`, `gate1_rubric.test.ts`, `gate2_synthesis.test.ts`, `gate3*.test.ts` are inside string literals).*
3. **`lint.test.ts:92`:**
   - `await eslint.lintFiles(["*.ts"])` only lints root `*.ts`, **missing `src/**/*.ts`** (SCOPE.md F05 requires expanding to `src/**/*.ts`).
4. **Clean Code Rule #1 (Zero inline comments inside function bodies):**
   - Inline comments exist inside function bodies in `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `diagrams.ts`, `skills.ts` (see Section 2 & `rg` results) and must be removed or refactored into self-documenting helpers / JSDoc WHY comments in touched M1 files.

---

## 7. Actionable Recommendations for M1 Architecture (`src/config/` & Facade)

1. **`src/config/constants.ts` (F01):**
   - Organize typed, `as const` immutable namespaces (e.g., `RUNTIME_CONSTANTS`, `ENGINE_CONSTANTS`, `BUDGET_CONSTANTS`, `TIMEOUT_CONSTANTS`, `GIT_CONSTANTS`, `SDD_CONSTANTS`, `DIAGRAM_CONSTANTS`, `EXIT_CODE_CONSTANTS`, `FORMAT_CONSTANTS`, `GREPTILE_CONSTANTS`, `TELEMETRY_CONSTANTS`), then compose `CONSTANTS` in `config.ts` from them so every existing `CONSTANTS.*` property remains identical for all 11+ root/src consumers and tests.
   - Reconcile drifting constants in `src/` (`src/pal/adapters/{claude,gemini,opencode,jules}.ts`, `src/gates/{gate0_qa,gate1_review,gate2_challenger,gate2_injector,gate3_audit}.ts`, `src/engine/rollback_buffer.ts`, `src/core/{fsm_types,escalation,snapshot,dispatcher,dag}.ts`) to reference centralized constants instead of diverging (especially `RATE_LIMIT_SLEEP_MS` `30_000` vs `1_800_000`, `DEFAULT_MODEL`, `STDERR_TAIL_MAX_LENGTH`, and `EXIT_CODE_*`).
2. **`src/config/schemas.ts` & `src/config/guardrails.ts` (F02 & F03):**
   - Add `zod` to `package.json` (`dependencies`) + run `bun install` to update `bun.lock`.
   - Define `RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `TelemetryConfigSchema`, `CascadeConfigSchema` with strict numeric coercion rejecting `NaN`, `Infinity`, negative budgets/timeouts, and out-of-range percentages.
   - `loadConfig()` must validate CLI args strictly (fail-closed with `ConfigValidationError`, CLI exits with code `2`).
   - `enforceSessionBudget(spentUsd, maxBudgetUsd)` throws `BudgetExceededError` on `Number.isNaN(spentUsd)` or `spentUsd >= maxBudgetUsd`.
   - `redactSensitiveData(value, maxDepth)` uses `WeakSet` for cycles (`"[Circular]"`), bounded recursion depth, and preserves `Array`, `Map`, `Set`, `Date`, `RegExp`, and plain objects.
3. **`src/config/loader.ts`, `config.ts`, `platform.ts`, `cascade.ts` (F04):**
   - Precedence: `overrides` > `CLI args` > `CASCADE_* env` > `.openspec-cascade.json` > `defaults`.
   - Wire `detectPackageManager(repo)` & `resolvePackageCommands(pm)` into dynamic default `defaultVerify` / `qaVerifyCommands` / `fullVerify` and `cascade.ts:verifyCommands()` without breaking `config.test.ts` or `cascade.test.ts` expectations (use repo-aware stack detection for Nuxt `.nuxt/` vs generic TS/JS projects).
   - Remove import-time `loadConfig()` side effect from `cascade.ts:102` (lazy-load inside `main()` / helper, while preserving any exported test helpers).
