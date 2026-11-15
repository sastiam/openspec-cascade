# Feature Inventory & M1–M6 Design Requirements — `explorer_cascade_survey_3`

**Core Summary:** `openspec-cascade` (`main` @ `70e2537`) contains **52,631 LOC** across **51 production TypeScript files** (11 root + 40 `src/`) and **47 `.test.ts` files** (11 root + 36 `test/`), split between a working v1 sequential runner (`cascade.ts`, 625 LOC) and ~45,974 LOC of largely unwired v2 Looper/PAL/Gate/SDD/GitHub-Integration modules in `src/`. None of the M1–M6 enhancements from `ORIGINAL_REQUEST.md` (`src/config/`, `src/runtime/`, `src/pal/factory.ts`, `src/decorators/`, `src/facade/`, `src/integration/greptile/`, M4 Harness Injector, M5 Self-Improving Looper, M6 Certification) exist on `main`, and the repository currently fails `Node.js 24 LTS` execution/testing because all 47 test files import `"bun:test"` and 14 production call sites invoke `Bun.*` directly without Node fallbacks.

---

## 1. Observation

### 1.1 Codebase Scale & Structural Split (Root v1 vs. `src/` v2)
Verified via `wc -l *.ts src/**/*.ts src/**/**/*.ts` and `rg -n 'from "\./src/|from "\.\./'`:
- **Root production modules (11 files, ~3,000+ LOC):**
  - `cascade.ts` (625L) — CLI entrypoint & sequential task loop (`runCascade`, `runTask`, `parseTasks`, `extractSpecPaths`, `rollback` at lines 439–450).
  - `config.ts` (656L) — `CONSTANTS`, `CascadeConfig`, `resolveEngine`, `resolveLogDir`, `buildConfig`.
  - `engine.ts` (82L) — `EngineAdapter` port & `getEngineAdapter()` for `claude`, `opencode`, `antigravity`.
  - `claude.ts` (169L), `opencode.ts` (169L), `antigravity.ts` (356L) — v1 engine drivers.
  - `qa.ts` (249L) — `parseVerify`, `runChecks`, `formatFailureFeedback`, `runVerificationPhase`.
  - `skills.ts` (261L) — `discoverSkills`, `discoverProjectDirectives`, `buildSkillsAndDirectivesXml`.
  - `platform.ts` (373L) — `startKeepAlive` (`caffeinate` / `systemd-inhibit`), `detectPackageManager`, `resolvePackageCommands`.
  - `diagrams.ts` (291L) — `syncDiagrams`, `discoverArchifyTargets`, `resolveArchifyBin`.
  - `resilience.ts` (71L) — `Fatal`, `TaskFailureError`, and re-export of `src/engine/rollback_buffer.ts`.
- **Wiring Reality (`rg` cross-module import check):**
  - `cascade.ts` (lines 17–67) imports ONLY root modules (`./config`, `./engine`, `./platform`, `./qa`, `./diagrams`, `./skills`, `./resilience`, `./antigravity`).
  - The **only** `src/` module imported by root is `src/engine/rollback_buffer.ts` (via `resilience.ts:28`). Even then, `cascade.ts:439–450` implements its own raw `rollback()` (`git reset --hard && git clean -fd`) rather than using `RollbackStateBuffer`.
  - All other `src/` modules (**~45,000 LOC** across `src/core/`, `src/gates/`, `src/pal/`, `src/sdd/`, `src/storage/`, `src/integration/`) are **unwired from `cascade.ts`** and exercised only by unit tests in `test/`.

### 1.2 Existing `src/` Subsystem Inventory
1. **`src/core/` (12,976 LOC across 9 files):**
   - `fsm_types.ts` (892L) & `fsm_guards.ts` (333L) & `fsm.ts` (1,190L): 18-state (`16` non-terminal + `2` terminal) / 37-event / 39-rule `LooperFSM` with `VictoryAuditLivelockPrevention` (`victory_livelock.ts`, 292L, circuit breaker `CLOSED` -> `ESCALATED` at threshold `2`).
   - `dag.ts` (2,122L): `TaskDag` with Kahn topological sorting, cycle path diagnostics, and level-batching.
   - `roles.ts` (1,238L): 7-tier cognitive role matrix (Tier 0 Sentinel through Tier 6 Forensic Auditor) + write-path validation.
   - `dispatcher.ts` (1,501L): `SubagentDispatcher` managing `.agents/teamwork/<agent_id>/` sandboxes, 16-spawn limit, concurrency caps, heartbeats, and inter-agent messaging.
   - `snapshot.ts` (1,314L): Point-in-time context snapshots, succession snapshots, 5-component `handoff.md` formatting/validation.
   - `escalation.ts` (3,146L): 6-rung dynamic escalation ladder (`local_retry` -> `challenger_diagnostic` -> `explorer_deep_dive` -> `clean_worker_replacement` -> `task_redecomposition` -> `sentinel_escalation`), `OrchestratorSuccessionManager`, and `FailureClassifier` (`retry` | `prompt_enrichment` | `forensic_audit`).
2. **`src/gates/` (10,775 LOC across 12 files):**
   - Gate 0 (`gate0_qa.ts` 987L, `gate0_parser.ts` 925L, `gate0_policy.ts` 631L): Mechanical QA runner, ANSI/stack/tsc/lint parser, Fast-Track vs. Full-Gate policy evaluator.
   - Gate 1 (`gate1_review.ts` 1,344L, `gate1_rubric.ts` 1,264L, `gate1_feedback.ts` 1,136L): Ephemeral Reviewer subagent orchestrator, boundary containment check, magic-number & clean-code diff scanner, XML/MD/JSON feedback.
   - Gate 2 (`gate2_challenger.ts` 1,574L, `gate2_injector.ts` 1,292L, `gate2_synthesis.ts` 1,079L): Adversarial edge-case synthesizer, isolated `TestingSandbox`, standalone/inline assertion injector with clean rollback or permanent `test/challenger_repro_*.test.ts` retention.
   - Gate 3 (`gate3_audit.ts` 1,678L, `gate3_scanner.ts` 1,482L, `gate3_anticheat.ts` 7L): Forensic Auditor with binary `PASS`/`FAIL` veto, `.agents/teamwork/` layout check, git hygiene check, clean-room QA, anti-cheat scanner, and `RollbackStateBuffer` trigger.
3. **`src/pal/` (12,024 LOC across 8 files):**
   - `types.ts` (682L): `IPalProvider` (`executeTurn`, `streamTurn`, `getCapabilities`, `getRateLimitState`), canonical `PalMessage` / `PalContentBlock` (`text`, `thought`, `tool_call`, `tool_result`, `image`), `PalError`.
   - `normalizer.ts` (1,420L), `mcp.ts` (1,142L), `react_parser.ts` (847L): Turn-folding normalizers, MCP schema bridge & `PalToolDispatcher`, ReAct `<tool_call>` fallback parser & JSON repair.
   - `adapters/claude.ts` (1,676L), `adapters/gemini.ts` (3,037L), `adapters/opencode.ts` (1,888L), `adapters/jules.ts` (1,332L): Full PAL adapters. Note `JulesAdapter` (`jules remote` async batch CLI) exists ONLY in `src/pal/adapters/jules.ts` and is absent from root `engine.ts` / `config.ts`.
   - **Missing in `src/pal/`**: No `factory.ts`, no `EngineAdapter` <-> `IPalProvider` bridge, no `src/decorators/`, no `src/facade/`.
4. **`src/sdd/` (590 LOC across 4 files):**
   - `sdd_gate.ts` (152L): PreToolUse SDD gate blocking edits to `SDD_PRODUCTION_EXTENSIONS` without an active change in `openspec/changes/*/tasks.md` containing `- [ ]`.
   - `analyze.ts` (220L): Cross-artifact analyzer checking `proposal.md`, `design.md`, `tasks.md`, `specs/`, requirement-to-task keyword coverage, and `openspec/project.md` constitution.
   - `surface_verifier.ts` (73L): Classifies diffs into `frontend`, `backend`, `core` surfaces and appends `sdd-verify:frontend-render-check` / `sdd-verify:api-contract-smoke`.
   - `review_verifier.ts` (145L): Pre-PR diff-match verifier (`reviewFiles` vs `branchDiffFiles`), `10s` stale-cache guard (`SDD_MIN_REVIEW_DURATION_SECONDS`), and finding triage (`mechanical` | `risky` | `advisory`).
5. **`src/storage/` & `src/engine/` & `src/integration/` (7,933 LOC across 7 files):**
   - `src/storage/memory.ts` (1,797L): Atomic swap-file persistence, `BRIEFING.md` `🔒` protected-section guard, heartbeat watchdog.
   - `src/engine/rollback_buffer.ts` (891L): `RollbackStateBuffer` preserving `.agents/teamwork/`, `projects/`, `logs/`.
   - `src/integration/`: `github_project.ts` (2,308L), `catalog_generator.ts` (1,155L), `drift_detector.ts` (1,106L), `schema_validator.ts` (645L), `errors.ts` (31L) — scoped to GitHub Project #4; **no `src/integration/greptile/` exists**.

### 1.3 Plugin, Skills, Configuration & Quality Guardrail Findings
- **Plugin & Skills (`.agents/skills/` vs `plugins/cascade/`):**
  - 14 skills exist in `.agents/skills/*/SKILL.md` and are mirrored identically in `plugins/cascade/skills/*/SKILL.md` (`diff -rq` showed only `.openspec-target` extra in `.agents/skills/`).
  - `plugins/cascade/hooks/sdd_gate.mjs` (55L) duplicates `src/sdd/sdd_gate.ts` with drift: `sdd_gate.mjs:5` omits `.mjs` and `.cjs` from `SRC_EXT` (whereas `config.ts` `SDD_PRODUCTION_EXTENSIONS` includes them), and hardcodes exit code `2`.
  - `plugins/cascade/workflows/cascade-looper.mjs:18,24` and `plugins/cascade/commands/{cascade,cascade-looper}.md` hardcode `bun run cascade.ts`.
  - `bin/install.mjs` (219L) installs the plugin & `~/.claude/workflows/cascade-looper.mjs` and runs `bun link` / `npm link`.
- **Magic Numbers & Scattered Constants:**
  - `config.ts` centralizes root `CONSTANTS`, yet **32 separate `*_CONSTANTS` objects** remain decentralized across `src/` (`FSM_CONSTANTS`, `GATE0_CONSTANTS`..`GATE3_CONSTANTS`, `CLAUDE_ADAPTER_CONSTANTS`, etc.), duplicating timeouts, attempt counts, and `.agents/teamwork` paths.
  - `zod` is NOT in `package.json` (`dependencies` has only `@anthropic-ai/claude-agent-sdk`); config files/env vars lack schema validation.
- **Explicit `any` & Clean Code Drift (`rg '\bany\b'`):**
  - `eslint.config.js` extends `tseslint.configs.base` and enforces `no-magic-numbers` + `explicit-module-boundary-types`, **but does NOT enable `@typescript-eslint/no-explicit-any`**.
  - Production `any` violations verified at: `platform.ts:34-36,174` (`(...args: any[]) => void`), `opencode.ts:55` (`Record<string, any>`), `antigravity.ts:98,198` (`Record<string, any>`), `src/pal/adapters/gemini.ts:1890,1914` (`as any`), `projects/agnostic_looper/verify_project_items.ts:168` (`(t: any)`).
  - `openspec/project.md:41` ("NEVER write comments inside function bodies explaining WHAT the code does") is violated by inline `//` step comments inside `src/` functions (e.g., `src/core/fsm.ts:761,782,793,798`, `src/gates/gate0_qa.ts:601,613`, `src/sdd/analyze.ts:86,120,133,161`).
- **Dual-Runtime & Test Blocker (`Bun` vs `Node 24 LTS`):**
  - `tsconfig.json:9` has `"types": ["bun"]`.
  - **47/47 `.test.ts` files** import `"bun:test"`, failing under `node --test` (`ERR_UNSUPPORTED_ESM_URL_SCHEME`).
  - **14 production locations** directly invoke `Bun.spawn` / `Bun.spawnSync` / `Bun.sleep` / `Bun.which` without Node fallback (`cascade.ts:143,285`, `opencode.ts:98`, `antigravity.ts:278`, `diagrams.ts:178`, `platform.ts:122,237,238`, `src/pal/adapters/opencode.ts:1036`, `jules.ts:717`, `gemini.ts:1824`, `src/engine/rollback_buffer.ts:241`, `src/gates/gate0_qa.ts:364`, `gate1_review.ts:790`, `gate2_challenger.ts:577`, `gate2_injector.ts:195`, `gate3_audit.ts:541`).
  - `package.json` has no `"test"` script.
- **CI/CD & Environment State:**
  - `.github/workflows/` does NOT exist (zero CI automation).
  - `.gitignore` (2 lines: `node_modules/`, `logs/`) does not ignore `.cascade/`, `.redteam_sandbox_*`, or runtime `.agents/teamwork/` runs.
  - Container check: `node v24.22.2` and `gh` (authenticated as `sastiam`) are present; `bun`, `greptile`, and `node_modules/` are absent, so `bun test` / `tsc` / `eslint` currently exit `127`.

---

## 2. Logic Chain

1. **Why M1 (Config/Zod/Guardrails) must come first:** `config.ts` already enforces `CONSTANTS`, and `eslint.config.js` already blocks magic numbers, but `zod` is missing, 32 `src/` `*_CONSTANTS` objects duplicate defaults, and `@typescript-eslint/no-explicit-any` is disabled (allowing `any` in `platform.ts`, `opencode.ts`, `antigravity.ts`, `gemini.ts`). Establishing `src/config/` (with `config.ts` as a backward-compatible facade) and tightening ESLint gives M2–M6 validated schemas, env-var precedence, and zero-`any` enforcement.
2. **Why M2 (Isomorphic Runtime, PAL Factory, GoF Decorators, Facade) is the structural keystone:** `openspec/project.md` mandates Bun 1.4+ with Node 24 LTS compatibility, yet 47/47 tests and 14 production call sites are Bun-locked. Meanwhile, `src/pal/` (12,024 LOC including Jules) is completely isolated from `engine.ts` and `cascade.ts`. Building `src/runtime/` (`ISpawner` + Node/Bun test shim), `src/pal/factory.ts`, `src/decorators/` (retry/backoff/circuit-breaker + telemetry), and `src/facade/` (`CascadeFacade`) unifies both engines and enables Node 24 CI/testing.
3. **Why M3 (Greptile CLI Integration) bridges `pre-pr-review` and `src/sdd/review_verifier.ts`:** `review_verifier.ts` already implements the 10-second stale-cache guard and merge-base diff-match logic, and `.agents/skills/pre-pr-review/SKILL.md` specifies the bounded fix loop, but no CLI wrapper, ephemeral shadow-commit indexer, disk cache, or semantic context formatter exists. Putting `src/integration/greptile/` (`client.ts`, `shadow.ts`, `cache.ts`, `search.ts`) on top of `ISpawner` (M2) and Zod config (M1) enables uncommitted-diff reviews without mutating user git state and degrades safely when `greptile` is absent.
4. **Why M4 (Harness Injector) is required to realize v2:** `cascade.ts` currently bypasses `src/core/`, `src/gates/`, `src/sdd/`, and `src/storage/` (~45K LOC), even running its own `git clean -fd` instead of `RollbackStateBuffer`. Wiring `CascadeFacade` to `Analyze` -> `SDDGate` -> `TaskDag` -> `LooperFSM` -> `Gate 0..3` -> `DynamicEscalationLadder` -> `RollbackStateBuffer` + Greptile context injection turns the isolated `src/` libraries into the live execution harness.
5. **Why M5 (Self-Improving Looper) & M6 (Final Certification) close the loop:** Once M4 emits structured gate/escalation/Greptile telemetry, M5 can close the self-improvement loop (aggregating failure signatures, refining skill/rubric directives, enforcing bounded fix loops, syncing GitHub Project/catalogs, and running `.github/workflows/ci.yml`). M6 then certifies dual-runtime Bun + Node 24 E2E tests using **real production modules (zero fake reference harnesses)**, strict Clean Code / `tsc` / `eslint` zero-warning compliance, `openspec validate --strict`, and synchronized docs/plugin artifacts.

---

## 3. Caveats

- **Baseline test/lint/typecheck pass rates are unverified** on `main` because `bun` and `node_modules/` are not installed in this container (`exit 127`). `explorer_cascade_survey_1/handoff.md` confirmed the same blocker.
- **`greptile` CLI is not installed** in this environment; M3 live CLI invocations will require mocking/subprocess stubs in unit tests and explicit unavailable/fail-open handling in runtime preflight.
- **Individual test files in `test/` (36 files, 31,558 LOC)** were scanned for `bun:test` imports and LOC rather than read line-by-line; their assertions are inferred from `src/` interfaces and `odd/tasks/global-cli-command.md` (which reported 1,564 passing tests prior to PR #42/#43).
- **20 of 22 `openspec/changes/` directories** were inventoried rather than read in full; `openspec/project.md`, `well-architecture-config/proposal.md`, and `cascade-v2-sdd-framework/specs/sdd-framework/spec.md` were read directly.

---

## 4. Conclusion — Complete Feature Inventory & M1–M6 Design Requirements

### 4.1 Current Feature Inventory Summary
| Feature Area | Current Status on `main` | Key Modules | Gap / Action Needed |
|---|---|---|---|
| CLI & Sequential Task Runner | **Live (v1)** | `cascade.ts`, `run_looper.sh` | Wire to `CascadeFacade` & v2 `src/core/` + `src/gates/` |
| Centralized Config | **Partial** | `config.ts` | Add Zod schema, `src/config/`, layered loader; unify 32 `src/*_CONSTANTS` |
| Engine Adapters (v1) | **Live (3 engines)** | `engine.ts`, `claude.ts`, `opencode.ts`, `antigravity.ts` | Bridge to `src/pal/` + add Jules + GoF decorators |
| PAL & 4 Provider Adapters | **Implemented, Unwired** | `src/pal/{types,normalizer,mcp,react_parser}.ts`, `adapters/*` | Add `src/pal/factory.ts` + unify with `EngineAdapter` |
| Looper Core (FSM, DAG, Roles, Escalation, Snapshot) | **Implemented, Unwired** | `src/core/*`, `src/storage/memory.ts` | Wire into M4 Harness Injector & `CascadeFacade` |
| 4-Tier Verification Gates (0–3) | **Implemented, Unwired** | `src/gates/*` | Replace `qa.ts`-only loop in `cascade.ts` via M4 |
| Rollback Buffer | **Partial** | `resilience.ts`, `src/engine/rollback_buffer.ts` | Replace raw `cascade.ts:442` `git clean -fd` with `RollbackStateBuffer` |
| SDD Framework | **Implemented, Unwired** | `src/sdd/*`, `plugins/cascade/hooks/sdd_gate.mjs` | Wire `analyze`/`surface_verifier`/`review_verifier` into runner; sync `.mjs` hook |
| Greptile CLI Integration | **Missing** | *(none; `review_verifier.ts` has diff-match only)* | Implement M3 `src/integration/greptile/` (`F10–F13`) |
| GitHub Project #4 & Catalog Sync | **Implemented, Unwired** | `src/integration/{github_project,catalog_generator,drift_detector,schema_validator}.ts` | Expose via CLI subcommands / M5 telemetry |
| Cross-Platform Keep-Alive & Diagrams | **Live (Bun-coupled)** | `platform.ts`, `diagrams.ts`, `skills.ts` | Migrate `Bun.*` calls to `src/runtime/` |
| CI/CD & Dual-Runtime (Node 24 + Bun) | **Missing** | `package.json`, `tsconfig.json`, `eslint.config.js` | Add `src/runtime/`, Node test compatibility, `.github/workflows/ci.yml` |

### 4.2 Concrete Design Requirements by Milestone (M1–M6)

#### **M1 — Zero Magic Numbers, Zod Config & Quality Guardrails (`F01–F05`)**
- **Dependencies:** Add `zod` to `package.json` (`dependencies`).
- **Target Structure:**
  - `src/config/defaults.ts` — Centralized typed defaults (`DEFAULT_TIMEOUTS`, `DEFAULT_LIMITS`, `DEFAULT_PATHS`, `DEFAULT_MODELS`, `DEFAULT_SDD`, `DEFAULT_GREPTILE`, `DEFAULT_TELEMETRY`, `DEFAULT_ALLOWED_TOOLS`, `DEFAULT_DENIED_BASH`).
  - `src/config/schema.ts` — Strict Zod schemas (`RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `CascadeConfigSchema`) with bounded numeric constraints (no magic validation constants).
  - `src/config/loader.ts` — Deterministic precedence (`CLI args` > `CASCADE_* env` > `.openspec-cascade.json` > `defaults`), `resolveEngine()`, `resolveLogDir()`, `loadConfig()` returning validated immutable config or typed `ConfigValidationError`.
  - `src/config/index.ts` & backward-compatible `config.ts` facade preserving existing exports (`CONSTANTS`, `CascadeConfig`, `buildConfig`, `resolveEngine`, `resolveLogDir`).
- **Guardrails:**
  - Update `eslint.config.js` to enable `@typescript-eslint/no-explicit-any: "error"` and fix all existing `any` instances (`platform.ts:34-36,174`, `opencode.ts:55`, `antigravity.ts:98,198`, `src/pal/adapters/gemini.ts:1890,1914`, `projects/agnostic_looper/verify_project_items.ts:168`).
  - Enforce Clean Code Rule #1 (zero inline comments inside function bodies) across all new/touched files.

#### **M2 — Isomorphic Runtime (`Bun` + `Node 24 LTS`), PAL Factory, GoF Decorators & `CascadeFacade` (`F06–F09`)**
- **`F06` Isomorphic Subprocess & Runtime Abstraction (`src/runtime/`):**
  - `ISpawner` interface (`spawn(argv, options)`, `spawnSync(argv, options)`, `which(bin)`, `sleep(ms)`, `detectRuntime(): "bun" | "node"`).
  - `BunSpawner` & `NodeSpawner` (using `node:child_process` + `timers/promises` + `Readable.toWeb`), handling process group/timeout kills cleanly (`safelyKillProcess`) and cross-platform Windows/Linux/macOS paths.
  - Replace all 14 direct `Bun.spawn`/`Bun.spawnSync`/`Bun.sleep`/`Bun.which` call sites in root + `src/` with `src/runtime/` (`getDefaultSpawner()`).
  - Update `tsconfig.json` (`"types": ["bun", "node"]`) and provide isomorphic test compatibility (e.g., `src/runtime/test_compat` or `node --test` support + `package.json` `"test"` / `"test:node"` scripts).
- **`F07` PAL Creational Factory (`src/pal/factory.ts`):**
  - `EngineFactory` / `PalProviderFactory` resolving `claude`, `opencode`, `antigravity`/`gemini`, and `jules` into a unified `IPalProvider` + `EngineAdapter` bridge so `JulesAdapter` becomes first-class in CLI/cascade runs.
- **`F08` GoF Structural Decorators (`src/decorators/`):**
  - `ResilientEngineDecorator`: wraps any `IPalProvider` / `EngineAdapter` with exponential backoff + jitter, rate-limit pause/reset handling, and a configurable circuit breaker.
  - `TelemetryMetricsDecorator`: records per-session/turn latency, token usage, USD cost, retry counts, and error categories via injected sink (zero inline coupling to console/fs).
- **`F09` Unified Orchestration Facade (`src/facade/cascade_facade.ts`):**
  - `CascadeFacade` coordinating config loading, preflight checks (`--dry-run`, branch guard, `openspec` change validation), keep-alive (`startKeepAlive`), `EngineFactory` + decorators, `RollbackStateBuffer`, and structured run summary. Refactor `cascade.ts` into a thin CLI adapter calling `CascadeFacade`.

#### **M3 — Greptile CLI Integration (`F10–F13`, `src/integration/greptile/`)**
- **`F10` Greptile CLI Client (`src/integration/greptile/client.ts`):**
  - `IGreptileClient` over `ISpawner`: `checkStatus()`, `review({ target, baseBranch, diffMode })` (`greptile review --agent --json`), `query({ prompt, repo, ref })`, `index()`; typed error taxonomy (`GreptileNotFoundError`, `GreptileAuthError`, `GreptileTimeoutError`, `GreptileQuotaError`).
- **`F11` Ephemeral Shadow Commit Manager (`src/integration/greptile/shadow.ts`):**
  - Creates temporary git commit/tree objects for uncommitted working tree changes using an isolated temporary `GIT_INDEX_FILE` (`git read-tree`, `git add -A`, `git write-tree`, `git commit-tree`), returning a transient ref/SHA for Greptile indexing and cleaning up ephemerally (`finally`) with **zero mutation** to the user's `HEAD`, staging index, or working tree.
- **`F12` Content-Addressed Disk Cache (`src/integration/greptile/cache.ts`):**
  - Stores responses under `.cascade/cache/greptile/` keyed by composite SHA-256 of `(baseSha + tree/diffHash + query/mode)`, with TTL expiration and fail-open/fail-closed policy enforcement.
- **`F13` Semantic Search & Prompt Formatter + Pre-PR Bridge (`src/integration/greptile/search.ts` & `bridge.ts`):**
  - Token-budgeted context formatter injecting relevant Greptile findings/symbols into worker/reviewer prompts.
  - Bridges `greptile review` findings + `git diff <merge-base>...HEAD --name-only` directly into `src/sdd/review_verifier.ts` (`verifyReviewFindings()` with `>= 10s` stale-cache guard and `mechanical`/`risky`/`advisory` triage).

#### **M4 — Harness Injector (V2 Looper + Gates + SDD + Greptile Wiring)**
- **Core Wiring (`src/facade/` or `src/core/harness_injector.ts`):**
  - Connect `CascadeFacade` to the existing v2 subsystems currently dormant in `src/`:
    1. **SDD Pre-Flight:** Run `analyzeChangeArtifacts()` (`src/sdd/analyze.ts`) before starting a change and enforce `evaluateSddGate()` (`src/sdd/sdd_gate.ts`) on tool writes.
    2. **DAG & FSM Execution:** Parse tasks/dependencies into `TaskDag` (`src/core/dag.ts`) and drive execution via `LooperFSM` (`src/core/fsm.ts`) + `VictoryAuditLivelockPrevention` (`src/core/victory_livelock.ts`).
    3. **Context & Memory:** Scaffold `.agents/teamwork/<agent_id>/` via `SubagentDispatcher` (`src/core/dispatcher.ts`) and `MemoryStorage` (`src/storage/memory.ts`), injecting skills (`skills.ts`) + Greptile semantic context (M3).
    4. **4-Tier Gate Pipeline & Surface Checks:** Execute `Gate0MechanicalRunner` (with `Gate0Policy` Fast-Track for docs-only diffs) -> `classifySurfaces()` (`src/sdd/surface_verifier.ts`) -> `Gate1Reviewer` (plus Greptile diff-match check) -> `Gate2Challenger` -> `Gate3Auditor`.
    5. **Escalation & Atomic Rollback:** Wire `DynamicEscalationLadder` (`src/core/escalation.ts`) and `RollbackStateBuffer` (`src/engine/rollback_buffer.ts`) so `cascade.ts` never calls raw `git clean -fd` without `.agents/teamwork/` and `projects/` exclusions.
  - Preserve `--mode v1|v2` (or progressive default with `--legacy`) and all existing CLI flags (`--repo`, `--changes`, `--dry-run`, `--full-gate`, `--engine`, `--no-keep-alive`, `--allow-dirty`, `--log-dir`, `--help`).
  - Sync `plugins/cascade/hooks/sdd_gate.mjs` (add `.mjs`/`.cjs` extensions to match `config.ts`) and update `plugins/cascade/commands/*.md` + `workflows/cascade-looper.mjs` to support `openspec-cascade` / Node 24 + Bun.

#### **M5 — Self-Improving Looper, Telemetry Aggregation & CI/CD**
- **Closed-Loop Self-Improvement (`src/core/self_improver.ts` or `src/telemetry/`):**
  - Persist structured run & failure telemetry (`.cascade/telemetry/*.jsonl`): failing gate, escalation rung reached, Greptile findings, retry count, cost/duration.
  - Failure pattern synthesizer: detects recurring failure signatures across tasks/runs (e.g., repeated magic-number violations, missing boundary checks, stale review hits) and generates structured remediation directives / checklist updates injected into subsequent task prompts (bounded to prevent prompt bloat).
  - Bounded pre-PR fix loop (`<= 3` iterations, matching `.agents/skills/pre-pr-review/SKILL.md`), separating auto-fixable `mechanical` findings from human-gated `risky` findings.
- **Integration & Hygiene:**
  - Expose `src/integration/catalog_generator.ts` / `drift_detector.ts` / `github_project.ts` optionally via CLI flags (`--sync-catalog`, `openspec-cascade doctor`).
  - Add `.github/workflows/ci.yml` executing `bun test`, Node 24 test suite, `tsc --noEmit`, `eslint .`, and `openspec validate --strict`.
  - Update `.gitignore` for `.cascade/` and `.redteam_sandbox_*`.

#### **M6 — Final Certification & Production Readiness**
- **Zero-Stub E2E Verification (`test/e2e/`):**
  - Tier 1 (Feature E2E), Tier 2 (Integration Boundaries), Tier 3 (Resilience/Rollback/Circuit-Breaker) tests importing **only real production modules** (`src/config/`, `src/runtime/`, `src/pal/`, `src/decorators/`, `src/facade/`, `src/integration/greptile/`, `src/core/`, `src/gates/`, `src/sdd/`) — strictly zero mock reference harnesses.
- **Clean-Room Quality Gate:**
  - `bun test` AND Node 24 LTS test run pass with `0` failures.
  - `tsc --noEmit` exits `0`; `eslint .` exits `0` with `0` warnings and `@typescript-eslint/no-explicit-any` enforced.
  - `openspec validate --strict` passes on all created M1–M6 OpenSpec changes (`proposal.md`, `design.md`, `tasks.md`, `specs/*/spec.md`).
  - Update `README.md`, `docs/cli.md` (add `antigravity`, `jules`, v2 looper, Greptile, Node 24), `bin/install.mjs`, and `run_looper.sh`.

---

## 5. Verification Method

Any agent can independently verify these observations in `/home/antigravity/sastiam/openspec-cascade`:

1. **Verify unwired `src/` modules vs `cascade.ts`:**
   ```bash
   rg -n 'from "\./src/|from "\.\./' --glob '*.ts' --glob '!test/**' --glob '!node_modules/**' .
   ```
   Expected: Root imports `src/` ONLY at `resilience.ts:28` (`./src/engine/rollback_buffer`).
2. **Verify `Bun.*` coupling & `bun:test` lock-in:**
   ```bash
   rg -n 'Bun\.' --glob '*.ts' --glob '!*.test.ts' --glob '!test/**' --glob '!node_modules/**' .
   find . -name '*.test.ts' -not -path './node_modules/*' -exec grep -L 'bun:test' {} +
   ```
   Expected: 14 production locations calling `Bun.*`; `0` test files without `bun:test`.
3. **Verify missing M1–M3 directories & explicit `any` instances:**
   ```bash
   ls -d src/config src/runtime src/decorators src/facade src/integration/greptile 2>&1
   rg -n '\bany\b' --glob '*.ts' --glob '!*.test.ts' --glob '!test/**' --glob '!node_modules/**' platform.ts opencode.ts antigravity.ts src/pal/adapters/gemini.ts
   ```
   Expected: All 5 directories missing; explicit `any` matches at `platform.ts:34-36,174`, `opencode.ts:55`, `antigravity.ts:98,198`, `src/pal/adapters/gemini.ts:1890,1914`.
4. **Verify baseline toolchain once provisioned (`bun install` + `bun`):**
   ```bash
   bun test && bun run typecheck && bun run lint
   ```
5. **Invalidation Conditions:** Any commit adding `src/config/`, `src/runtime/`, `src/pal/factory.ts`, `src/decorators/`, `src/facade/`, `src/integration/greptile/`, `.github/workflows/`, or modifying `cascade.ts` / `package.json` invalidates the gap inventory above and requires re-inspection.
