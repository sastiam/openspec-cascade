# Explorer Handoff Report — `explorer_e2e_3` (Test Suite & Tooling)

- **Role:** `teamwork_preview_explorer` (Read-Only Test Suite & Tooling Explorer)
- **Parent:** `sub_orch_e2e_1`
- **Target Handoff:** `.agents/teamwork/sub_orch_e2e_1/explorer_e2e_3/handoff.md`
- **Core Summary:** The repository contains 47 test files (11 root `*.test.ts` + 36 `test/**/*.test.ts`, 0 existing `test/e2e/` files, 0 shared test helper files). `lint.test.ts` lives at the repo root (not `test/lint.test.ts`) and only scans `*.ts`, whereas `eslint .` scans all `**/*.ts` and enforces `@typescript-eslint/no-magic-numbers` and `@typescript-eslint/explicit-module-boundary-types` on non-test helper files under `test/e2e/helpers/`. Running `bun test` currently dirties 3 tracked files in `.agents/teamwork/reviewer_INTEG-RUN-001/` because `test/gates/gate1_feedback.test.ts:582` omits `workspaceRoot`; E2E tests must strictly isolate `workspaceRoot`/`--repo`/`--log-dir`/`HOME` in `os.tmpdir()`.

---

## 1. Observation

### 1.1 Existing `test/` Structure, Root Tests & Helpers
- **Test file inventory (47 total `*.test.ts` files, all importing `"bun:test"`):**
  - **Root (`11` files):** `antigravity.test.ts`, `cascade.test.ts`, `config.test.ts`, `diagrams.test.ts`, `engine.test.ts`, `lint.test.ts`, `opencode.test.ts`, `platform.test.ts`, `qa.test.ts`, `resilience.test.ts`, `skills.test.ts`.
  - **`test/` (`36` files across 7 subdirectories + 1 top-level):**
    - `test/installer.test.ts`
    - `test/core/` (`8`): `dag.test.ts`, `dispatcher.test.ts`, `escalation.test.ts`, `fsm.test.ts`, `fsm_guards.test.ts`, `fsm_types.test.ts`, `roles.test.ts`, `snapshot.test.ts`
    - `test/engine/` (`1`): `rollback.test.ts`
    - `test/gates/` (`13`): `gate0.test.ts`, `gate0_parser.test.ts`, `gate0_policy.test.ts`, `gate1.test.ts`, `gate1_feedback.test.ts`, `gate1_rubric.test.ts`, `gate2.test.ts`, `gate2_challenger.test.ts`, `gate2_injector.test.ts`, `gate2_synthesis.test.ts`, `gate3.test.ts`, `gate3_audit.test.ts`, `gate3_scanner.test.ts`
    - `test/integration/` (`2`): `catalog.test.ts`, `github_project.test.ts`
    - `test/pal/` (`6`): `claude.test.ts`, `gemini.test.ts`, `jules.test.ts`, `normalizer.test.ts`, `opencode.test.ts`, `types.test.ts`
    - `test/sdd/` (`4`): `analyze.test.ts`, `review_verifier.test.ts`, `sdd_gate.test.ts`, `surface_verifier.test.ts`
    - `test/storage/` (`1`): `memory.test.ts`
- **Existing test helpers & `test/e2e/`:**
  - `test/e2e/` **does not exist**.
  - `test/lint.test.ts` **does not exist** (`lint.test.ts` is at the repository root).
  - **No shared helper files exist** inside `test/`; every test file currently defines its own local `TEST_CONSTANTS`, `mkdtemp`/`mkdtempSync` setup, and `afterEach` cleanup.

### 1.2 Toolchain, TypeScript & ESLint / `lint.test.ts` Rules
- **Installed toolchain verified in workspace:**
  - `bun`: `1.4.4` (requires `export PATH="$HOME/.bun/bin:$PATH"` in non-login shells)
  - `node`: `v24.22.2`
  - `eslint`: `v10.13.0` (`bunx eslint .` exits `0` currently)
  - `typescript`: `5.9.3` (`bunx tsc --noEmit` exits `0` currently)
  - M0 baseline (from `.agents/teamwork/worker_env_setup/handoff.md`): `bun test` ran `1670` tests across `47` files (`0` fail, `8074` expect calls, `5.84s`).
- **`lint.test.ts` (root, lines 1–100):**
  - Instantiates `new ESLint()` (line 5) and verifies 4 rule behaviors via `eslint.lintText(...)` (`sample.ts` and `sample.test.ts`).
  - At **line 92**: `const results = await eslint.lintFiles(["*.ts"]);` — **only scans root `*.ts` files**, NOT `src/**/*.ts` or `test/**/*.ts` (M1 F05 plans to expand this to `src/**/*.ts`).
- **`eslint.config.js` (lines 1–43):**
  - Ignores: `node_modules/**`, `logs/**`, `graphify-out/**`, `.archify/**`, `docs/**`, `openspec/**`, `**/*.json` (does **not** ignore `test/**`).
  - Rule block for `files: ["**/*.ts"]` (lines 17–34):
    - `@typescript-eslint/no-magic-numbers`: `"error"` with `{ ignore: [-1, 0, 1], ignoreArrayIndexes: true, ignoreDefaultValues: true, ignoreClassFieldInitialValues: true, enforceConst: true, ignoreNumericLiteralTypes: true, ignoreEnums: true, ignoreReadonlyClassProperties: true, ignoreTypeIndexes: true }`.
    - `@typescript-eslint/explicit-module-boundary-types`: `"error"`.
  - Override for `files: ["**/*.test.ts"]` (lines 37–41):
    - `@typescript-eslint/no-magic-numbers`: `"off"`.
    - `@typescript-eslint/explicit-module-boundary-types` remains `"error"` if any `*.test.ts` exports a function.
  - **Critical helper constraint:** Files under `test/e2e/helpers/*.ts` match `**/*.ts` and do **NOT** match `**/*.test.ts`, so `eslint .` enforces **both** `no-magic-numbers` and `explicit-module-boundary-types` on all E2E helper modules. In addition, M1 (F05) adds `@typescript-eslint/no-explicit-any: "error"`, so helpers and tests must avoid `any` completely.
- **`tsconfig.json` (lines 1–14):**
  - `"include": ["*.ts", "src/**/*.ts", "test/**/*.ts"]` — `test/e2e/**` is automatically typechecked by `tsc --noEmit`.
  - `"strict": true`, `"noUncheckedIndexedAccess": true`, `"types": ["bun"]`, `"noEmit": true`.
  - `noUncheckedIndexedAccess: true` means indexed element access (`arr[0]`, `record[key]`) produces `T | undefined` and must be checked or narrowed.

### 1.3 Established Subprocess, Temp Repo, Cleanup & Runtime Compatibility Patterns
- **Subprocess spawning in existing tests & modules:**
  - `cascade.test.ts:176,190` and `test/installer.test.ts:73`: use `Bun.spawn([...], { stdout: "pipe", stderr: "pipe" })` and `Promise.all([new Response(proc.stdout).text(), proc.exited])`.
  - `test/gates/gate2.test.ts:1467-1509` and `test/gates/gate3_audit.test.ts:814-823`: execute real test probes / commands via `defaultProbeRunner` and `defaultGate3CommandRunner` (which wrap `Bun.spawn` with `timeoutMs`).
  - `qa.ts:74-120`: establishes the dual-runtime fallback pattern (`typeof Bun !== "undefined" && typeof Bun.spawn === "function"` -> `Bun.spawn`, else `await import("node:child_process")` -> `spawn`).
- **Temp directory & cleanup patterns:**
  - Sync tests (`cascade.test.ts:213`, `skills.test.ts:158`, `test/integration/catalog.test.ts:77`, `test/storage/memory.test.ts:89`): `mkdtempSync(join(tmpdir(), "<prefix>-"))` + `try { ... } finally { rmSync(tmp, { recursive: true, force: true }); }`.
  - Async tests (`test/core/dispatcher.test.ts:34`, `test/core/snapshot.test.ts:41`, `test/gates/gate1.test.ts:126`): `mkdtemp(join(tmpdir(), "<prefix>-"))` in `beforeEach` and `await rm(dir, { recursive: true, force: true })` in `afterEach`.
- **Node/Bun compatibility considerations:**
  - **47 of 47** existing test files import `"bun:test"` (verified via `node --test` failure `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'bun:'`).
  - `cascade.ts` currently requires Bun in Phase A: line 1 uses `#!/usr/bin/env bun`, line 143 calls `Bun.spawn`, line 285 calls `Bun.sleep`, and `platform.ts:122,237,238` defaults to `Bun.spawn` / `Bun.spawnSync`. Note also `cascade.ts:102` runs `export const config: CascadeConfig = loadConfig();` at module import time, so Phase A tests MUST invoke `cascade.ts` as a subprocess (`bun run cascade.ts ...`) rather than importing `cascade.ts` with custom flags.
  - `bin/install.mjs` and `plugins/cascade/hooks/sdd_gate.mjs` already execute natively on Node.js (`v24.22.2`).
  - **PATH hazard for subprocesses:** Non-login shells do not include `~/.bun/bin` in `PATH`. In `cli_runner.ts`, resolve the Bun binary via `process.execPath` (when running inside `bun test`, `process.execPath` is `/home/antigravity/.bun/bin/bun`) or fallback to `join(homedir(), ".bun", "bin", "bun")`, and ensure `git` / `node` directories remain in `PATH` even when testing custom `env` overrides.

### 1.4 Root Cause of `.agents/teamwork/reviewer_INTEG-RUN-001/` Dirtying During `bun test`
- Verified directly via `git ls-files`, `git diff --stat .agents/teamwork/reviewer_INTEG-RUN-001/`, `test/gates/gate1_feedback.test.ts`, `src/gates/gate1_review.ts`, and `src/core/dispatcher.ts`:
  1. `test/gates/gate1_feedback.test.ts:582-586` instantiates `new Gate1Reviewer({ taskId: "INTEG-RUN-001", diff: cleanDiff, autoCleanup: true })` **without specifying `workspaceRoot`**.
  2. `Gate1Reviewer` (`src/gates/gate1_review.ts:875`) defaults `this.workspaceRoot = normalize(options.workspaceRoot ?? process.cwd())`.
  3. `Gate1Reviewer.run()` (`src/gates/gate1_review.ts:1151-1154`) instantiates `createSubagentDispatcher({ workspaceRoot: this.workspaceRoot, autoCleanup: false })` and dispatches role `"reviewer"` with `taskId: "INTEG-RUN-001"`.
  4. `SubagentDispatcher` (`src/core/dispatcher.ts:804,867-870`) writes `BRIEFING.md`, `DISPATCH.md`, `progress.md`, `handoff.md` into `<workspaceRoot>/.agents/teamwork/reviewer_INTEG-RUN-001/`, and `Gate1Reviewer.run()` (`src/gates/gate1_review.ts:1264-1279`) writes `review_report.md`, `review_findings.json`, `review_feedback.xml` there.
  5. `dispatcher.cleanupAgent()` (`src/core/dispatcher.ts:1458-1470`) defaults `removeSandboxDir = false` and `preserveHandoff = preserveLogs = preserveBriefing = true`, leaving the directory intact.
  6. Because those 7 files under `.agents/teamwork/reviewer_INTEG-RUN-001/` are already tracked in git (commits `6f962ec`, `189330c`, `1245a89`), `bun test` overwrites them in-place, producing tracked diffs in `DISPATCH.md`, `progress.md`, and `review_feedback.xml`.
- **E2E Isolation Guarantee:** All E2E tests MUST pass explicit isolated `os.tmpdir()` paths for `--repo`, `--log-dir`, `HOME`/`XDG_CACHE_HOME`, `workspaceRoot`, `repoRoot`, `baseDir`, and `cwd`, and MUST NEVER target `process.cwd()` for mutating runs or subagent/gate sandboxes.

---

## 2. Proposed Directory & File Layout (`TEST_INFRA.md` + `test/e2e/`)

### 2.1 Root Documentation & Infrastructure
- **`TEST_INFRA.md`** (repo root): Architecture, 4-tier + Tier 5 taxonomy, complete `F01–F20` × Tiers 1–4 coverage matrix (~11 tests × 20 features + ~10 cross-cutting = ~230 planned tests across Phase A + Phase B), Phase A (active opaque-box CLI & existing modules) vs Phase B (gated on M1–M5 `DONE` in `PROJECT.md`), zero-stub/zero-mock policy, and isolation/cleanup contract.
- **`TEST_READY.md`** (repo root, Phase A gate report): Verified test inventory, active Phase A test counts, `tsc`/`eslint`/`bun test` results, and Phase B expansion checklist.

### 2.2 Shared E2E Helpers (`test/e2e/helpers/`)
Must satisfy strict ESLint (`no-magic-numbers`, `explicit-module-boundary-types`, zero `any`) and `tsc --noEmit`:
1. `test/e2e/helpers/constants.ts` — Centralized `E2E_CONSTANTS` (timeouts, exit codes `0`/`1`/`2`, temp dir prefixes, default git author identity, branch names).
2. `test/e2e/helpers/cli_runner.ts` — `runCascadeCli(options)` (invoking real `cascade.ts` via Bun executable resolved via `process.execPath` with isolated `env`, `HOME`, `--log-dir`, timeout + `proc.kill()`, returning `{ exitCode, stdout, stderr, durationMs, timedOut }`) and `runNodeScript(scriptPath, args, options)` (for `bin/install.mjs` and `plugins/cascade/hooks/sdd_gate.mjs`, supporting `stdin` piping).
3. `test/e2e/helpers/temp_repo.ts` — `createTempGitRepo(options)` (initializes isolated `os.tmpdir()` git repo with initial commit, configurable branch e.g. `feat/e2e-test` or `main`, optional dirty file, optional lockfile `pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`/`bun.lock`, optional `.agents/skills` / `AGENTS.md` / `CLAUDE.md`), `addOpenSpecChange(repoDir, changeId, tasksMarkdown, opts)` (creates `openspec/changes/<id>/{proposal.md,design.md,tasks.md,specs/core/spec.md}`), and guaranteed `cleanup()` helper.

### 2.3 E2E Test Tiers (`test/e2e/`) — Covering All 20 Features (`F01–F20`)

| Directory / File | Phase A Scope (Active Immediately, Real Modules + CLI) | Phase B Expansion (Gated on M1–M5 `DONE`) | Features Covered |
|---|---|---|---|
| `tier1_features/f01_f05_config_cli_lint.test.ts` | `config.ts` (`loadConfig`, `resolveLogDir`, `formatHelp`), `platform.ts` (`detectPackageManager`, `resolvePackageCommands`), `cascade.ts --help` & `--dry-run`, `eslint` / `lint.test.ts` baseline | M1: `src/config/constants.ts`, `CascadeConfigSchema` (`schemas.ts`), `enforceSessionBudget` & `redactSensitiveData` (`guardrails.ts`), `loader.ts` (`.openspec-cascade.json` + CLI exit code `2`) | F01–F05 |
| `tier1_features/f06_f09_runtime_pal_facade.test.ts` | `platform.ts` (`startKeepAlive`, `buildKeepAliveArgs`), `qa.ts` (`defaultCommandRunner`, `runVerificationPhase`), `engine.ts`, `src/pal/*` (`normalizer`, `mcp`, `react_parser`, adapters), `cascade.ts --engine` | M2: `src/runtime/` (`ISpawner`, `BunSpawner`, `NodeSpawner`), `EngineFactory` (`src/pal/factory.ts`), `ResilientEngineDecorator`, `TelemetryMetricsDecorator`, `CascadeFacade` | F06–F09 |
| `tier1_features/f10_f13_greptile_review.test.ts` | `src/sdd/review_verifier.ts` (`triageFinding`, `verifyReviewFindings`), real `git merge-base` / diff inspection in temp git repo | M3: `src/integration/greptile/` (`client.ts`, `shadow.ts` isolated `GIT_INDEX_FILE`, `cache.ts` SHA-256 cache, `search.ts` token-budget formatter, `bridge.ts`) | F10–F13 |
| `tier1_features/f14_f16_harness_v2_plugins.test.ts` | `cascade.ts` (`taskPrompt`, `parseTasks`, `verifyCommands`), `skills.ts`, `src/sdd/{analyze,sdd_gate,surface_verifier}.ts`, `plugins/cascade/hooks/sdd_gate.mjs` (via `node`), `bin/install.mjs --dry-run` | M4: `src/core/harness_injector.ts`, `--mode v1|v2` CLI pipeline wiring (`Analyze -> SDDGate -> TaskDag -> LooperFSM -> SubagentDispatcher -> Gate 0..3 -> RollbackStateBuffer -> MemoryStorage`) | F14–F16 |
| `tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` | `cascade.ts` `--log-dir` JSONL creation vs `--dry-run` suppression, `src/integration/{catalog_generator,drift_detector,schema_validator}.ts`, `diagrams.ts` | M5–M6: `src/core/self_improver.ts` (`.cascade/telemetry/*.jsonl`), bounded pre-PR loop (`<= 3` rounds), `--sync-catalog`/`doctor`, `.github/workflows/ci.yml`, dual-runtime Node 24 CLI runs | F17–F20 |
| `tier2_boundaries/cli_config_boundaries.test.ts` | Missing `--changes`, invalid `--engine`, protected branches (`main`/`master`/`stable`), dirty tree without `--allow-dirty`, blank env vars, relative `--log-dir` | M1/M2: NaN/negative budget CLI exit code `2`, `ISpawner` non-zero/timeout/ENOENT, `ResilientEngineDecorator` circuit breaker open state | F01–F09, F15 |
| `tier2_boundaries/sdd_and_review_boundaries.test.ts` | `sdd_gate.mjs` hook exit `2` block vs exit `0` allow (exempt paths, `CASCADE_SDD_GATE_DISABLED=1`, malformed/empty stdin), `analyzeChangeArtifacts` missing files, `review_verifier` `< 10s` stale & diff mismatch | M3/M4: `ShadowCommitManager` rollback-safe cleanup on callback throw, `GreptileCache` TTL expiry & fail-open vs fail-closed | F10–F16, F18 |
| `tier2_boundaries/rollback_and_gate_boundaries.test.ts` | `RollbackStateBuffer` real temp git repo snapshot/commit/rollback + protected excludes (`.agents/teamwork/`, `projects/`, `logs/`), `Gate0..3` boundary violations in temp workspace | M4/M5: `HarnessInjector` token truncation, `SelfImprover` bounded directive cap | F03, F14–F18, F20 |
| `tier3_combinations/cli_stack_pm_combinations.test.ts` | Precedence `CLI > CASCADE_* env > defaults` across `claude`/`opencode`/`antigravity`/`agy` × lockfiles (`pnpm`/`npm`/`yarn`/`bun`) × `--dry-run`/`--allow-dirty`/`--full-gate`/`--no-keep-alive` | M1/M2: `.openspec-cascade.json` layer + `EngineFactory` × `ResilientEngineDecorator` × `TelemetryMetricsDecorator` | F01–F09 |
| `tier3_combinations/sdd_gates_pipeline_combinations.test.ts` | `analyzeChangeArtifacts` + `surface_verifier` + `Gate0MechanicalRunner` + `Gate1Reviewer` + `Gate2Challenger` + `Gate3Auditor` (with `workspaceRoot: tempDir`) | M3/M4: `ShadowCommitManager` + `GreptileCache` + `HarnessInjector` + `LooperFSM`/`TaskDag` integration | F10–F16 |
| `tier3_combinations/resilience_and_catalog_combinations.test.ts` | `--no-rollback` / `--resilient` / `--continue-on-failure` / `--no-diagrams` flags + `TaskCatalogGenerator` + `CatalogDriftDetector` + `MemoryStorage` | M5: `SelfImprover` + bounded Pre-PR loop triage (`mechanical` vs `risky`) | F03, F15, F17–F19 |
| `tier4_scenarios/dry_run_cascade_journey.test.ts` | Full CLI `cascade.ts --dry-run` journey over multi-change temp git repo with pending/done/human-skip/verify/commit tasks | M2/M4: `--mode v2` end-to-end orchestration journey across `CascadeFacade` | F04, F09, F14–F15, F20 |
| `tier4_scenarios/installer_and_sdd_hook_journey.test.ts` | End-to-end `bin/install.mjs --dry-run --yes` + `sdd_gate.mjs` blocking edit when no active change exists, then allowing after `tasks.md` `- [ ]` is added | M4/M5: Full plugin hook sync + `openspec validate --strict` workflow | F14, F16, F19–F20 |
| `tier4_scenarios/failure_rollback_audit_journey.test.ts` | Real temp git repo dirtying -> `RollbackStateBuffer` snapshot -> `Gate3Auditor` layout veto -> atomic git rollback preserving `.agents/teamwork/` and audit JSONL logs | M3/M5: Shadow commit + Greptile review bridge + rollback + telemetry persistence | F03, F11, F15, F17, F20 |
| `tier5_adversarial/` *(Phase 2 / M6 slot)* | Directory reserved and documented in `TEST_INFRA.md` (empty or non-stubbed placeholder only until M6 Phase 2) | M6: Circular-ref redaction bombs, NaN/overflow budgets, path traversal, symlink escapes, signal/timeout kills, anti-cheat probes | F02–F03, F06, F08, F11–F13, F20 |

---

## 3. Caveats
- **No static imports of unlanded M1–M5 modules in Phase A:** Modules such as `src/config/*`, `src/runtime/*`, `src/pal/factory.ts`, `src/decorators/*`, `src/facade/*`, `src/integration/greptile/*`, `src/core/harness_injector.ts`, and `src/core/self_improver.ts` do **not** exist yet. Phase A tests must not import them (otherwise `tsc --noEmit` and `bun test` fail).
- **Existing `test/gates/gate1_feedback.test.ts:582` side effect:** Running the full `bun test` suite (as opposed to `bun test test/e2e`) still triggers `Gate1Reviewer` without `workspaceRoot` in that pre-existing test, dirtying `.agents/teamwork/reviewer_INTEG-RUN-001/{DISPATCH.md,progress.md,review_feedback.xml}`. New E2E tests must not replicate this pattern and should verify `git status --short` remains unchanged when running `bun test test/e2e`.
- **Timeout budget for subprocess E2E tests:** Bun's default per-test timeout is `5000ms`; `cli_runner` tests spawning `bun run cascade.ts` + `git init` in temp repos should pass an explicit test timeout (e.g. `15_000` ms) and subprocess timeout (`10_000` ms).

---

## 4. Conclusion
Ready for Phase A authoring of `TEST_INFRA.md`, `test/e2e/helpers/*`, and `test/e2e/tier{1..4}_*/*.test.ts`. Following the helper rules (`E2E_CONSTANTS`, explicit module boundary types, zero `any`, `process.execPath` for Bun subprocesses, and strict `os.tmpdir()` isolation) guarantees clean `tsc --noEmit`, `eslint .`, and `bun test` compliance while keeping the repository working tree unpolluted.

---

## 5. Verification Method
All observations were verified read-only in `/home/antigravity/sastiam/openspec-cascade`:
- `find . -maxdepth 3 -name "*.test.ts" -not -path "./node_modules/*" | sort` (47 files)
- `view_file` on `lint.test.ts`, `eslint.config.js`, `tsconfig.json`, `package.json`, `cascade.ts`, `config.ts`, `platform.ts`, `qa.ts`, `resilience.ts`, `cascade.test.ts`, `config.test.ts`, `platform.test.ts`, `test/installer.test.ts`, `test/engine/rollback.test.ts`, `test/gates/gate1_feedback.test.ts`, `src/gates/gate1_review.ts`, `src/core/dispatcher.ts`, `plugins/cascade/hooks/sdd_gate.mjs`, `test/sdd/*.test.ts`
- `git diff --stat .agents/teamwork/reviewer_INTEG-RUN-001/` (confirmed 3 modified tracked files)
- `export PATH="$HOME/.bun/bin:$PATH"; bunx tsc --noEmit; bunx eslint .` (`TSC=0`, `ESLINT=0`)
