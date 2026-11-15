# Codebase Exploration Handoff — `explorer_e2e_1`

- **Explorer:** `explorer_e2e_1`
- **Parent:** `sub_orch_e2e_1`
- **Authoritative Request:** `.agents/teamwork/ORIGINAL_REQUEST.md` (`## 2026-11-15T01:46:44Z`)
- **Scope:** `.agents/teamwork/sub_orch_e2e_1/SCOPE.md`
- **Baseline Verification:**
  - Bun: `1.4.4`, Node: `v24.22.2`
  - Branch: `feat/cascade-looper-v2` (HEAD `70e2537`)
  - `bun run typecheck` (`tsc --noEmit`): PASS (exit `0`)
  - `bun run lint` (`eslint .`): PASS (exit `0`)
  - `bun test`: PASS (`1670 pass`, `0 fail`, `8074 expect() calls` across `47` files)

---

## 1. Root Files Inventory & Runtime Architecture

| File | Lines | Role & Key Observations |
|---|---|---|
| `cascade.ts` | 626 | Main CLI entrypoint (`#!/usr/bin/env bun`), task parser (`parseTasks`), prompt builder (`taskPrompt`), verification extraction (`verifyCommands`), commit logic, usage guard, preflight, dry-run plan printer, and cascade loop. **Important:** line 102 runs `export const config: CascadeConfig = loadConfig();` at module import time (after `--help` check on lines 97–100). Direct `Bun.spawn` (`sh` lines 141–150) and `Bun.sleep` (`sleepUntil` line 285). |
| `config.ts` | 657 | Centralized `CONSTANTS` (lines 16–164), `FULL_VERIFY` (lines 166–172), `QA_VERIFY_COMMANDS` (line 174), `CascadeConfig` interface (lines 176–263), `parseCliArgs` (lines 371–409), `loadConfig` (lines 425–652), `resolveEngine` (lines 298–304), `isKeepAliveEnabled` (lines 306–310), `resolveLogDir` (lines 326–330), `formatHelp` (lines 367–369), `getDefaultConfig` (lines 654–656). **No `.openspec-cascade.json` loader or `zod` schema exists yet.** |
| `platform.ts` | 373 | Cross-platform keep-alive (`startKeepAlive`, `buildKeepAliveArgs`, `findSystemdInhibit`, `canRunSystemdInhibit`), `normalizePlatformPath`, `resolveBinaryInPath`, `isMacOS`, `isLinux`, and package manager detection (`detectPackageManager`, `resolvePackageCommands`, lines 311–371). Defaults `spawn`/`spawnSync` to `Bun.spawn`/`Bun.spawnSync` (lines 122, 237–238), injectable via `KeepAliveOptions`. Note: `detectPackageManager` and `resolvePackageCommands` are **not yet wired** into `config.ts`, `qa.ts`, or `cascade.ts` (`CONSTANTS.DEFAULT_VERIFY`, `FULL_VERIFY`, and `verifyCommands` still assume `bun` / `nuxi`). |
| `qa.ts` | 250 | `defaultCommandRunner` (lines 68–141), `formatVerificationFeedback` (lines 143–184), `runVerificationPhase` (lines 186–249). `defaultCommandRunner` uses `sh -c <cmd>` with `Bun.spawn` if `typeof Bun !== "undefined" && typeof Bun.spawn === "function"`, falling back to `node:child_process` `spawn` under Node.js. |
| `engine.ts` | 82 | `EngineAdapter` interface (lines 48–54), `EngineOutcome` union (`"done" \| "paused" \| "error" \| "fatal"`), `EngineSessionOptions`, `engineAdapters` registry (lines 65–69), `getEngineAdapter` (lines 74–81). Supports `"claude"`, `"opencode"`, `"antigravity"` (via `resolveEngine`). Note: `"jules"` and `"gemini"` are only in `src/pal/adapters/` (`src/pal/` is not wired to `engine.ts` or `cascade.ts` yet). |
| `resilience.ts` | 71 | Thin facade re-exporting `RollbackStateBuffer`, `captureGitState`, `rollbackWorkingTree`, `ROLLBACK_CONSTANTS`, etc. from `./src/engine/rollback_buffer`, plus defining `Fatal` (line 54) and `TaskFailureError extends Fatal` (lines 59–70). |
| `skills.ts` | 262 | `parseSkill`, `discoverSkills` (`.agents/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md`), `formatSkillsPrompt` (`<skills>` XML block), `discoverDirectives` (`AGENTS.md`, `CLAUDE.md`), `formatDirectivesPrompt` (`<project-directives>` XML block). Uses `node:fs` and `node:path` only (runtime-agnostic). |
| `diagrams.ts` | 291 | `discoverArchifyTargets` (`.archify/<name>/candidate.json`, `candidate.archify.md`, `.archify/candidate.json`), `resolveArchifyBin` (uses `ARCHIFY_BIN`, `CASCADE_ARCHIFY_BIN`, `Bun.which("archify")`, `~/.hermes/...`, `~/.local/bin/archify`), `buildArchifyCommand`, `syncDiagrams`. |
| `claude.ts` | 169 | `ClaudeAdapter` using `@anthropic-ai/claude-agent-sdk` `query()`, `supportsPlanMeters() => true`, `readClaudeUsage`. |
| `antigravity.ts` | 356 | `AntigravityAdapter` spawning `agy -p ... --output-format stream-json --dangerously-skip-permissions --model ...` via `Bun.spawn`. Exports `oneLine`, `describeToolInput`, `formatToolInput`, `reduceAntigravityEvent`, `classifyFailure`. |
| `opencode.ts` | 169 | `OpenCodeAdapter` spawning `opencode run --format json --auto --model ... --title openspec-cascade` via `Bun.spawn` with `OPENCODE_CONFIG_CONTENT` env override. |
| `package.json` | 28 | Scripts, `bin`, dependencies (`@anthropic-ai/claude-agent-sdk`), devDependencies (`typescript: 5.9.3`, `eslint: ^10.13.0`, `typescript-eslint: ^8.72.0`, `@types/bun: 1.3.0`, `@fission-ai/openspec: ^1.17.0`). |
| `tsconfig.json` | 14 | TypeScript compiler configuration covering `*.ts`, `src/**/*.ts`, `test/**/*.ts`. |
| `eslint.config.js` | 43 | ESLint 10 flat config enforcing `no-magic-numbers` and `explicit-module-boundary-types`. |

---

## 2. Current CLI, Config, Env Vars, Exit Codes & Behavior

### 2.1 CLI Flags (`config.ts`: `parseCliArgs` lines 371–409, `HELP_TEXT` lines 332–365)

`parseCliArgs` uses `node:util` `parseArgs` with `strict: false`, `allowPositionals: true`, inside a `try/catch` that silently returns `{ options: {}, positionals: [] }` on parse errors (note: **current behavior does NOT exit with code 2 on unknown/malformed flags**; `strict: false` accepts unknown flags).

| Flag | Type | Default | Precedence / Notes |
|---|---|---|---|
| `--repo <path>` | `string` | `cwd` | `overrides.repo ?? cliOpts.repo ?? env.CASCADE_REPO ?? cwd`, normalized via `normalizePlatformPath` (`config.ts:434-435`) |
| `--changes <a,b,c>` | `string` | `[]` | Split on `,`, strips all whitespace (`c.replace(/\s+/g, "")`), filters empty (`config.ts:441-445`) |
| `--allow-dirty` | `boolean` | `false` | Allows running on dirty git working tree (`config.ts:381,450-452`) |
| `--dry-run` | `boolean` | `false` | Prints plan and usage meters; skips execution and log file writes (`config.ts:382,454-456`) |
| `--full-gate` | `boolean` | `false` | Adds `FULL_VERIFY` to any task with `commitTypeOf(task) !== undefined` (`cascade.ts:198,214`) |
| `--engine <name>` | `string` | `"claude"` | `claude \| opencode \| antigravity \| agy` (case-insensitive). Invalid value throws `Error("--engine must be ...")` in `resolveEngine()` (`config.ts:298-304`) |
| `--no-keep-alive` | `boolean` | `false` | Disables keep-alive (`config.ts:385,470-471`) |
| `--keep-alive` | `boolean` | (unset) | Parsed by `parseCliArgs` (`config.ts:386`) and `isKeepAliveEnabled` (`config.ts:306-310`), not listed in `HELP_TEXT` |
| `--model <name>` | `string` | `undefined` | Model override (`config.ts:387,481`) |
| `--effort <level>` | `string` | `"high"` | Reasoning effort override (`config.ts:388,482`) |
| `--log-dir <path>` | `string` | `~/.cache/openspec-cascade/logs/<basename(repo)>` | Resolved against `cwd` (`config.ts:326-330,485-493`) |
| `-h`, `--help` | `boolean` | `false` | Handled in `cascade.ts:97-100` before `loadConfig()`; prints `formatHelp()` and exits `0` |
| `--no-diagrams` | `boolean` | `false` | Sets `autoDiagrams = false` (`config.ts:391,544-545`) |
| `--diagrams` | `boolean` | (unset) | Parsed in `config.ts:392,546-547`, not in `HELP_TEXT` |
| `--graphify-command <cmd>` | `string` | `"graphify update ."` | Sets `graphifyCommand` (`config.ts:393,554-558`) |
| `--archify-action <action>` | `string` | `"deliver"` | Sets `archifyAction` (`config.ts:394,560-564`) |
| `--archify-quality <name>` | `string` | `"showcase"` | Sets `archifyQuality` (`config.ts:395,566-570`) |
| `--archify-bin <path>` | `string` | `undefined` | Sets `archifyBin` (`config.ts:396,572-577`) |
| `--no-rollback` | `boolean` | `false` | Sets `rollbackOnFailure = false` (`config.ts:397,583-584`) |
| `--rollback` | `boolean` | (unset) | Parsed in `config.ts:398,585-586`, not in `HELP_TEXT` |
| `--resilient` | `boolean` | `false` | Sets `resilient = true` (`config.ts:399,598-599`) |
| `--continue-on-failure` | `boolean` | (unset) | Alias for `--resilient` (`config.ts:400,600-601`) |

**Note on CLI precedence quirk in `config.ts`:** For booleans defined with `default: false` (`--allow-dirty`, `--dry-run`, `--full-gate`, `--no-keep-alive`, `--no-diagrams`, `--no-rollback`, `--resilient`), `config.ts` checks `if (cliOpts["..."])` (truthy check) before falling back to `env.CASCADE_*`. Thus passing `--dry-run` overrides `CASCADE_DRY_RUN=false`, while omitting it lets `env.CASCADE_DRY_RUN=true` take effect.

### 2.2 Environment Variables

#### `CASCADE_*` and config overrides in `config.ts` (lines 434–608):
- `CASCADE_REPO` (`string`, default `cwd`)
- `CASCADE_CHANGES` (`string` CSV)
- `CASCADE_ALLOW_DIRTY` (`boolean`: `"true"|"1"|"yes"` vs `"false"|"0"|"no"`, default `false`)
- `CASCADE_DRY_RUN` (`boolean`, default `false`)
- `CASCADE_FULL_GATE` (`boolean`, default `false`)
- `CASCADE_ENGINE` (`string`, default `"claude"`)
- `CASCADE_KEEP_ALIVE` (`boolean`, default `true`)
- `CASCADE_MODEL` (`string`, default `undefined`)
- `CASCADE_EFFORT` (`string`, default `"high"`)
- `CASCADE_LOG_DIR` (`string`, default `~/.cache/openspec-cascade/logs/<basename(repo)>`)
- `CASCADE_USAGE_LIMIT_PERCENT` (`number`, default `95`)
- `CASCADE_RESET_MARGIN_MS` (`number`, default `120_000`)
- `CASCADE_UNKNOWN_RESET_SLEEP_MS` (`number`, default `1_800_000`)
- `CASCADE_MIN_PAUSE_MS` (`number`, default `60_000`)
- `CASCADE_MAX_ATTEMPTS` (`number`, default `3`)
- `CASCADE_MAX_TURNS` (`number`, default `60`)
- `CASCADE_MAX_BUDGET_USD` (`number`, default `10`)
- `CASCADE_TOTAL_BUDGET_USD` (`number`, default `150`)
- `CASCADE_COMMAND_TIMEOUT_MS` (`number`, default `1_800_000`)
- `CASCADE_ENGINE_TIMEOUT_MS` (`number`, default `2_700_000`)
- `CASCADE_RATE_LIMIT_SLEEP_MS` (`number`, default `1_800_000`)
- `CASCADE_AUTO_DIAGRAMS` (`boolean`, default `true`)
- `CASCADE_GRAPHIFY_COMMAND` (`string`, default `"graphify update ."`)
- `CASCADE_ARCHIFY_ACTION` (`string`, default `"deliver"`)
- `CASCADE_ARCHIFY_QUALITY` (`string`, default `"showcase"`)
- `ARCHIFY_BIN` then `CASCADE_ARCHIFY_BIN` (`string`, default `undefined` — `ARCHIFY_BIN` wins over `CASCADE_ARCHIFY_BIN` at `config.ts:575-576` and `diagrams.ts:171-176`)
- `CASCADE_ROLLBACK_ON_FAILURE` then `CASCADE_GIT_ROLLBACK` (`boolean`, default `true`)
- `CASCADE_RESILIENT` then `CASCADE_CONTINUE_ON_FAILURE` (`boolean`, default `false`)

#### Other env vars in the repo:
- `CASCADE_SDD_GATE_DISABLED`: checked in `src/sdd/sdd_gate.ts:122` and `plugins/cascade/hooks/sdd_gate.mjs:35` (`=== "1"` bypasses SDD gate).
- `OPENCODE_CONFIG_CONTENT`: injected by `opencode.ts:104` into `opencode` subprocess.
- Engine SDK/CLI ambient env vars in `src/pal/adapters/`: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_BASE_URL`, `GOOGLE_BASE_URL`, `GEMINI_API_VERSION`, `OPENCODE_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_BASE_URL`, `OPENAI_BASE_URL`, `OLLAMA_BASE_URL`.

### 2.3 Config Files
- **`.openspec-cascade.json` (or any project config file):** **Not currently implemented** in `config.ts` or anywhere in `cascade.ts` / `src/`. `loadConfig` currently only merges `overrides > cliOpts > env > CONSTANTS` defaults. (Planned for M1 in `PROJECT.md` line 8.)
- Notice `loadConfig()` in `config.ts` validates only `engine` (`resolveEngine`); invalid numeric env vars (e.g. `NaN`, negative numbers, `>100` usage) silently fall back to defaults via `parseNumber` (`Number.isFinite(parsed) ? parsed : defaultValue`, `config.ts:411-415`) or accept negative/out-of-range finite numbers without throwing.

### 2.4 Exit Codes
- `CONSTANTS.EXIT_CODE_SUCCESS` = `0` (`config.ts:117`): `--help`/`-h`, successful completion, or `--dry-run` completion.
- `CONSTANTS.EXIT_CODE_ERROR` = `1` (`config.ts:118`): uncaught non-`Fatal` errors in `main()` (`cascade.ts:624`). Note: an invalid `--engine` throws a plain `Error` during top-level `export const config = loadConfig()` (`cascade.ts:102`) BEFORE `main()`, causing Bun to terminate with exit code `1` and stack trace.
- `CONSTANTS.EXIT_CODE_FATAL` = `2` (`config.ts:119`): `Fatal` (and subclass `TaskFailureError`) caught in `main().catch(...)` (`cascade.ts:624`) — triggers on missing `--changes`, protected branch, dirty tree (without `--allow-dirty`/`--dry-run`), missing `tasks.md`, total budget exceeded, `BLOCKED:` reason, fatal engine outcome, `git commit` failure, or exhausted task retries.
- `platform.ts`: `EXIT_CODE_SIGINT = 130`, `EXIT_CODE_SIGTERM = 143` (`platform.ts:22-23`), emitted when `startKeepAlive` handles `SIGINT` / `SIGTERM` with `exitOnSignal: true`.
- `plugins/cascade/hooks/sdd_gate.mjs:52`: returns exit code `2` when blocking an edit without an active OpenSpec change.

### 2.5 Preflight: Protected-Branch Check, Dirty-Tree Check, Dry-Run Behavior (`cascade.ts:561-619`)

1. **`--help` short-circuit (`cascade.ts:97-100`):** Runs when `import.meta.main && parseCliArgs().options.help`. Prints `formatHelp()` and calls `process.exit(0)` before `loadConfig()`.
2. **Module-level `loadConfig()` (`cascade.ts:102`):** Runs on import as well as CLI execution. `logDir` is NOT created on import or during `--dry-run` (`log()` returns early at line 123 if `config.dryRun`).
3. **`main()` (`cascade.ts:599-619`):**
   - Calls `startKeepAlive({ enabled: config.keepAlive })` (lines 600–601). Note: under `--dry-run`, `keepAlive` still starts unless `--no-keep-alive` is passed, and is stopped in `finally` (line 617).
   - Calls `await preflight()` (line 603).
4. **`preflight()` (`cascade.ts:561-575`):**
   - **Empty changes check (line 562):** `if (!changes.length) throw new Fatal("Pass --changes a,b,c in cascade order");` -> exit `2` (even under `--dry-run`).
   - **Protected branch check (lines 563–564):** Runs `git branch --show-current` in `repo`. If `config.protectedBranches.includes(branch)` (`["stable", "main", "master"]`), throws `Fatal(\`Refusing to run on protected branch "${branch}"\`)` -> exit `2` (**even under `--dry-run`** in current implementation; M1 F03 plans to allow dry-run on protected branches).
   - **Dirty tree check (lines 565–572):** Runs `git status --porcelain` in `repo`, filters out lines whose path (`l.slice(3)`) starts with any entry in `config.neverCommit` (`[".atl", ".claude/settings.local.json"]`). If remaining lines exist:
     - If `!config.allowDirty && !config.dryRun`, throws `Fatal(...)` -> exit `2`.
     - If `config.allowDirty` or `config.dryRun`, prints warning via `say(warning)` and continues.
   - **Banner line (line 574):** Prints `engine=... [keepAlive=... ]repo=... branch=... changes=... log=<disabled (dry-run) | path>`.
5. **Dry-run branch (`cascade.ts:604-609`):**
   - Calls `printPlan()` (lines 577–597): for each `change` in `changes`, checks `openspec/changes/<change>/tasks.md`. If missing, prints `\n${change}: MISSING (create it with /opsx:propose)`. Otherwise prints pending count, commit mode (`one commit per section` if `!commitsPerSection`), and each pending task's `id`, `HUMAN-SKIP`, `commit=...`, and `verify=[...]`.
   - Calls `await readUsage()` and prints `\nusage: ...`.
   - Returns without modifying files, creating logs, or running sessions.

### 2.6 Package Manager Detection & Verification Behavior (`platform.ts`, `cascade.ts`, `qa.ts`)

- **`platform.ts` (`detectPackageManager`, lines 324–330):**
  - Checks lockfiles in exact priority order in `cwd`:
    1. `pnpm-lock.yaml` -> `"pnpm"`
    2. `package-lock.json` -> `"npm"`
    3. `yarn.lock` -> `"yarn"`
    4. `bun.lock` or `bun.lockb` -> `"bun"`
    5. Fallback -> `"npm"`
- **`platform.ts` (`resolvePackageCommands`, lines 335–371):**
  - Returns `{ test, lint, build, typecheck, run(script) }` for `"pnpm" | "npm" | "yarn" | "bun"`.
  - Note: `yarn` uses `"yarn lint"`, `"yarn build"`, `"yarn typecheck"`, `` `yarn ${s}` `` (no `run`), whereas `pnpm`/`npm`/`bun` use `<pm> run <script>`.
- **Current disconnection (`cascade.ts` & `config.ts`):**
  - `cascade.ts` `verifyCommands` (lines 196–226) and `config.ts` `CONSTANTS.DEFAULT_VERIFY` / `FULL_VERIFY` / `QA_VERIFY_COMMANDS` **hardcode `bun`** (`/^bunx? /`, `"bun run lint"`, `"bun run build"`, `"bun run test:e2e"`, `"bunx nuxi prepare"`, `.nuxt/tsconfig.{server,app}.json`) and do **not** call `detectPackageManager` or `resolvePackageCommands`.
- **`qa.ts` (`runVerificationPhase`, lines 186–249):**
  - Defaults `commands` to `CONSTANTS.QA_VERIFY_COMMANDS` (`["bun test", "bunx tsc --noEmit", "bun run lint", "bun run build"]`).
  - Supports custom `runner` injection, `stopOnFirstFailure` (default `true`), `cwd`, `timeoutMs`, and structured `<verification-feedback>` prompt generation via `formatVerificationFeedback`.

---

## 3. ESLint, Clean-Code & TypeScript Rules Affecting `test/e2e/**/*.ts`

### 3.1 `eslint.config.js` (43 lines)
- **Ignored globs (lines 5–13):** `node_modules/**`, `logs/**`, `graphify-out/**`, `.archify/**`, `docs/**`, `openspec/**`, `**/*.json`. (`test/e2e/**` is **NOT** ignored.)
- **Base config:** `tseslint.configs.base` (line 15).
- **Rules for all `**/*.ts` (lines 16–35):**
  1. `@typescript-eslint/no-magic-numbers`: `"error"` with:
     ```js
     {
       ignore: [-1, 0, 1],
       ignoreArrayIndexes: true,
       ignoreDefaultValues: true,
       ignoreClassFieldInitialValues: true,
       enforceConst: true,
       ignoreNumericLiteralTypes: true,
       ignoreEnums: true,
       ignoreReadonlyClassProperties: true,
       ignoreTypeIndexes: true,
     }
     ```
     - **Impact on `test/e2e/helpers/*.ts`:** Helper files (`cli_runner.ts`, fixture builders, etc.) do **not** match `**/*.test.ts`, so every numeric literal other than `-1, 0, 1` (e.g., timeouts, exit code `2`, buffer lengths) MUST be declared as a `const` (or default parameter/class field) to satisfy `enforceConst: true`.
  2. `@typescript-eslint/explicit-module-boundary-types`: `"error"`
     - **Impact on ALL `test/e2e/**/*.ts` (including `*.test.ts` AND helpers):** Every exported function/method/getter must have explicit parameter types and an explicit return type!
- **Override for `**/*.test.ts` (lines 36–41):**
  - `@typescript-eslint/no-magic-numbers`: `"off"`. (`explicit-module-boundary-types` remains `"error"`.)
- **Note on `lint.test.ts` (line 92):** Currently checks `eslint.lintFiles(["*.ts"])` only; `bun run lint` runs `eslint .` across the entire repo including `test/e2e/**/*.ts`.

### 3.2 `tsconfig.json` (14 lines)
- **`include`:** `["*.ts", "src/**/*.ts", "test/**/*.ts"]` — `test/e2e/**/*.ts` IS typechecked by `bun run typecheck` (`tsc --noEmit`).
- **`exclude`:** Not defined.
- **`compilerOptions`:**
  - `"target": "ES2022"`
  - `"module": "ESNext"`
  - `"moduleResolution": "bundler"`
  - `"strict": true`
  - `"noUncheckedIndexedAccess": true` (array/index accesses yield `T | undefined`; tests/helpers must narrow indexed elements!)
  - `"skipLibCheck": true`
  - `"types": ["bun"]`
  - `"noEmit": true`

### 3.3 Constitution & Clean Code Rules (`openspec/project.md` & `.agents/skills/clean-code-best-practices/SKILL.md`)
- **Zero `any` / `as any`:** Even though `@typescript-eslint/no-explicit-any` is not yet enabled in `eslint.config.js` (planned in M1 F05), `openspec/project.md` §3.3 and `clean-code-best-practices` strictly forbid `any` and `as any` across all TypeScript files.
- **Zero inline comments inside function bodies:** `openspec/project.md` §3.4 forbids comments inside function bodies explaining *what* the code does; use well-named helpers/variables and JSDoc/TSDoc at declarations for *why* only.
- **Zero stubs/mocks in E2E tests:** `PROJECT.md` and `SCOPE.md` mandate that `test/e2e/` import and execute real production modules and real `cascade.ts` subprocesses in isolated `os.tmpdir()` directories/git repos — zero fake reference harnesses.

---

## 4. `package.json` Scripts & Verification Commands

`package.json` (`scripts` lines 9–15):
- `"start"`: `"bun run cascade.ts"`
- `"install:claude"`: `"node bin/install.mjs"`
- `"cascade:looper"`: `"bun run cascade.ts --engine antigravity --changes ..."`
- `"typecheck"`: `"tsc --noEmit"` — invoked via `bun run typecheck` (or `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`).
- `"lint"`: `"eslint ."` — invoked via `bun run lint`.
- **Tests:** No `"test"` script is defined in `package.json`; tests are run via `bun test` (e.g. `bun test` or `bun test test/e2e/`).

---

## 5. E2E Testing Track Considerations (Opaque-Box Phase A vs Phase B)

- **Existing real targets ready for Phase A opaque-box E2E tests:**
  1. **Real CLI subprocess (`bun run cascade.ts`):** `--help`/`-h`, `--dry-run` on feature branch with real `openspec/changes/*/tasks.md`, `--changes` missing error (exit `2`), protected branch (`main`/`master`/`stable`) rejection (exit `2`), dirty working tree rejection without `--allow-dirty` (exit `2`) vs acceptance with `--allow-dirty` / `--dry-run`, `neverCommit` filtering (`.atl`, `.claude/settings.local.json`), `--no-keep-alive`, `--log-dir` & `CASCADE_LOG_DIR` (plus verifying `--dry-run` creates no log dir), invalid `--engine` failure (exit `1` currently; note M1 F02 targets exit `2`), `CASCADE_*` env overrides, `printPlan()` output formatting (`HUMAN-SKIP`, `commit=...`, `verify=[...]`, `MISSING`).
  2. **Real existing modules:**
     - `config.ts`: `loadConfig`, `parseCliArgs`, `resolveEngine`, `resolveLogDir`, `isKeepAliveEnabled`, `formatHelp`, `CONSTANTS`, `FULL_VERIFY`
     - `platform.ts`: `detectPackageManager`, `resolvePackageCommands`, `startKeepAlive`, `buildKeepAliveArgs`, `normalizePlatformPath`, `resolveBinaryInPath`
     - `qa.ts`: `runVerificationPhase`, `defaultCommandRunner`, `formatVerificationFeedback`
     - `resilience.ts` & `src/engine/rollback_buffer.ts`: `RollbackStateBuffer`, `captureGitState`, `rollbackWorkingTree` (in temp git repos!)
     - `skills.ts`: `discoverSkills`, `discoverDirectives`, `formatSkillsPrompt`, `formatDirectivesPrompt`
     - `diagrams.ts`: `discoverArchifyTargets`, `buildArchifyCommand`, `syncDiagrams`
     - `src/sdd/sdd_gate.ts`, `src/sdd/analyze.ts`, `src/sdd/review_verifier.ts`, `src/sdd/surface_verifier.ts`
     - `src/core/*`, `src/gates/*`, `src/pal/*`, `src/storage/*`, `src/integration/*`
- **Modules NOT yet present on disk (do NOT statically import in Phase A):**
  - `src/config/{constants,schemas,guardrails,loader}.ts` (M1)
  - `src/runtime/*`, `src/pal/factory.ts`, `src/decorators/*`, `src/facade/*` (M2)
  - `src/integration/greptile/*` (M3)
  - `src/core/harness_injector.ts` (M4)
  - `src/core/self_improver.ts` (M5)
- **Important subprocess E2E detail:** When spawning `bun run cascade.ts` in tests, `PATH` must include Bun (`process.execPath` dir or `$HOME/.bun/bin`), and `cwd` / `--repo` should point to an isolated `mkdtempSync` git repo on a non-protected branch (e.g. `feat/test-e2e`) with local `git config user.email` and `user.name` configured, cleaned up in `finally` / `afterEach`. Note also that `cascade.ts` runs `startKeepAlive()` during CLI runs — in headless Linux CI/container environments without D-Bus/systemd session, `systemd-inhibit` falls back cleanly to `noop-fallback` and prints a `console.warn`, or `--no-keep-alive` disables it.
