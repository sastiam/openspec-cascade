# Exploration Handoff — `explorer_e2e_2` (Architecture & Modules)

- **Target Track:** `sub_orch_e2e_1` (E2E Testing Track — Phase A)
- **Authoritative Sources Checked:** `PROJECT.md`, `openspec/project.md`, `.agents/teamwork/ORIGINAL_REQUEST.md` (`## 2026-11-15T01:46:44Z`), `package.json`, `tsconfig.json`, `eslint.config.js`, `cascade.ts`, `config.ts`, `platform.ts`, `resilience.ts`, `src/**`, `openspec/**`, `plugins/**`
- **Repository Branch & Working Tree State:** On branch `feat/cascade-looper-v2` (synced with `origin/feat/cascade-looper-v2`). Only `.agents/teamwork/*` and `PROJECT.md` are modified/untracked. **M1 has NOT started creating any files in `src/config/` or modifying `src/` / root `*.ts` yet.**

---

## 1. Current Inventory of `src/` and `openspec/`

### 1.1 `src/` (40 files, 45,974 LOC total)
- `src/core/` (9 files):
  - `src/core/dag.ts` (2,122 lines)
  - `src/core/dispatcher.ts` (1,501 lines)
  - `src/core/escalation.ts` (3,146 lines)
  - `src/core/fsm.ts` (1,190 lines)
  - `src/core/fsm_guards.ts` (333 lines)
  - `src/core/fsm_types.ts` (892 lines)
  - `src/core/roles.ts` (1,238 lines)
  - `src/core/snapshot.ts` (1,314 lines)
  - `src/core/victory_livelock.ts` (292 lines)
- `src/engine/` (1 file):
  - `src/engine/rollback_buffer.ts` (891 lines)
- `src/gates/` (12 files):
  - `src/gates/gate0_parser.ts` (925 lines)
  - `src/gates/gate0_policy.ts` (631 lines)
  - `src/gates/gate0_qa.ts` (987 lines)
  - `src/gates/gate1_feedback.ts` (1,136 lines)
  - `src/gates/gate1_review.ts` (1,344 lines)
  - `src/gates/gate1_rubric.ts` (1,264 lines)
  - `src/gates/gate2_challenger.ts` (1,574 lines)
  - `src/gates/gate2_injector.ts` (1,292 lines)
  - `src/gates/gate2_synthesis.ts` (1,079 lines)
  - `src/gates/gate3_anticheat.ts` (7 lines — re-export facade of `./gate3_scanner`)
  - `src/gates/gate3_audit.ts` (1,678 lines)
  - `src/gates/gate3_scanner.ts` (1,482 lines)
- `src/integration/` (5 files):
  - `src/integration/catalog_generator.ts` (1,155 lines)
  - `src/integration/drift_detector.ts` (1,106 lines)
  - `src/integration/errors.ts` (31 lines)
  - `src/integration/github_project.ts` (2,308 lines)
  - `src/integration/schema_validator.ts` (645 lines)
- `src/pal/` (8 files):
  - `src/pal/adapters/claude.ts` (1,676 lines)
  - `src/pal/adapters/gemini.ts` (3,037 lines)
  - `src/pal/adapters/jules.ts` (1,332 lines)
  - `src/pal/adapters/opencode.ts` (1,888 lines)
  - `src/pal/mcp.ts` (1,142 lines)
  - `src/pal/normalizer.ts` (1,420 lines)
  - `src/pal/react_parser.ts` (847 lines)
  - `src/pal/types.ts` (682 lines)
- `src/sdd/` (4 files):
  - `src/sdd/analyze.ts` (220 lines)
  - `src/sdd/review_verifier.ts` (145 lines)
  - `src/sdd/sdd_gate.ts` (152 lines)
  - `src/sdd/surface_verifier.ts` (73 lines)
- `src/storage/` (1 file):
  - `src/storage/memory.ts` (1,797 lines)

*(Root runtime files currently active in v1: `cascade.ts`, `config.ts`, `engine.ts`, `platform.ts`, `qa.ts`, `skills.ts`, `diagrams.ts`, `resilience.ts`, `claude.ts`, `antigravity.ts`, `opencode.ts`.)*

### 1.2 `openspec/`
- `openspec/config.yaml` — `schema: spec-driven`
- `openspec/project.md` — OpenSpec Cascade Constitution
- `openspec/specs/.gitkeep` — empty main specs directory (no synced main specs yet)
- `openspec/changes/archive/.gitkeep` — empty archive directory
- `openspec/changes/` — 22 active change directories (all passing `./node_modules/.bin/openspec validate --all --strict`):
  - `add-antigravity-engine`, `cascade-v2-sdd-framework`, `cross-platform-keep-alive`, `in-repo-skills`, `looper-core-dag-scheduler`, `looper-core-fsm`, `looper-core-router-escalation`, `looper-core-subagent-dispatcher`, `looper-gate0-mechanical-qa`, `looper-gate1-semantic-review`, `looper-gate2-adversarial-challenger`, `looper-gate3-forensic-audit`, `looper-integration-catalog-sync`, `looper-integration-github-project`, `looper-pal-canonical-schema`, `looper-pal-claude-adapter`, `looper-pal-gemini-adapter`, `looper-pal-jules-adapter`, `looper-pal-opencode-adapter`, `looper-storage-memory`, `qa-stage-and-diagrams`, `well-architecture-config`.

---

## 2. M1–M5 Target Modules: Exists vs. Does NOT Exist Yet

**CRITICAL FOR PHASE A E2E TESTS:** Do NOT write static `import` statements to any module marked `DOES NOT EXIST YET` below, or `tsc --noEmit` and `bun test` will fail! Gate Phase B direct-import tests on M1–M5 completion.

| Milestone | Target Path / Module | Exists Now? | Notes |
|---|---|---|---|
| **M1** | `src/config/` (`constants.ts`, `schemas.ts`, `guardrails.ts`, `loader.ts`, `index.ts`) | **NO** | `src/config/` directory does not exist. `zod` is NOT in `package.json` yet. Current config lives in root `config.ts`. |
| **M2** | `src/runtime/` (`types.ts`, `bun_spawner.ts`, `node_spawner.ts`, `spawner.ts`, `index.ts`) | **NO** | `src/runtime/` does not exist. Existing code calls `Bun.spawn` / `Bun.spawnSync` / `Bun.sleep` / `Bun.which` directly (14+ sites). |
| **M2** | `src/pal/factory.ts` (`EngineFactory` / `PalProviderFactory`) | **NO** | `src/pal/` has `types.ts`, `normalizer.ts`, `mcp.ts`, `react_parser.ts`, and `adapters/{claude,gemini,opencode,jules}.ts`, but NO `factory.ts`. Root `engine.ts` only has `getEngineAdapter()` for `claude`/`opencode`/`antigravity`. |
| **M2** | `src/decorators/` (`resilient_engine.ts`, `telemetry_metrics.ts`, `index.ts`) | **NO** | `src/decorators/` does not exist. |
| **M2** | `src/facade/` (`cascade_facade.ts`, `index.ts`) | **NO** | `src/facade/` does not exist. CLI entrypoint is root `cascade.ts` (v1 sequential runner). |
| **M3** | `src/integration/greptile/` (`client.ts`, `shadow.ts`, `cache.ts`, `search.ts`, `bridge.ts`, `index.ts`) | **NO** | `src/integration/greptile/` does not exist. |
| **M4** | `src/core/harness_injector.ts` | **NO** | Does not exist yet (prompt assembly is currently `taskPrompt()` in root `cascade.ts:351`). |
| **M5** | `src/core/self_improver.ts` | **NO** | Does not exist yet. |
| **M5** | `.github/workflows/ci.yml` | **NO** | No `.github/` workflows directory verified in repo root yet. |

---

## 3. Existing Modules Summary (Safe Real Targets for Phase A E2E Tests)

All existing modules below compile under `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `types: ["bun"]`) and `eslint.config.js` (`@typescript-eslint/no-magic-numbers` off for `**/*.test.ts`, `@typescript-eslint/explicit-module-boundary-types: "error"`).

### 3.1 Root CLI & V1 Runner (`cascade.ts`, `config.ts`, `platform.ts`, `resilience.ts`)
- **`cascade.ts`** (`#!/usr/bin/env bun`):
  - **Import-time caveat:** `cascade.ts:102` executes `export const config: CascadeConfig = loadConfig()` at module top-level (guarded only by `--help` at lines 97–100 when `import.meta.main`). Importing `cascade.ts` directly in a test parses `process.argv`! Prefer spawning `bun run cascade.ts ...` as a subprocess for CLI E2E tests.
  - **Implemented CLI flags (`config.ts:378-402`):** `--repo`, `--changes`, `--allow-dirty`, `--dry-run`, `--full-gate`, `--engine` (`claude|opencode|antigravity|agy`), `--no-keep-alive`, `--keep-alive`, `--model`, `--effort`, `--log-dir`, `-h/--help`, `--no-diagrams`, `--diagrams`, `--graphify-command`, `--archify-action`, `--archify-quality`, `--archify-bin`, `--no-rollback`, `--rollback`, `--resilient`, `--continue-on-failure`. Uses `parseArgs({ strict: false })` right now (`config.ts:402`), so unknown flags are currently ignored rather than failing with exit code `2` (M1 will harden this).
  - **Implemented Preflight Guards (`cascade.ts:561-575`):**
    - Missing `--changes` → throws `Fatal` → exits with code `2` (`CONSTANTS.EXIT_CODE_FATAL` at `cascade.ts:624`).
    - Protected branches (`main`, `master`, `stable` in `CONSTANTS.PROTECTED_BRANCHES` at `config.ts:44`) → throws `Fatal` → exit code `2` (even on `--dry-run` currently, `cascade.ts:564`).
    - Dirty working tree (ignoring `.atl`, `.claude/settings.local.json`) → throws `Fatal` (exit `2`) unless `--allow-dirty` or `--dry-run`.
  - **Exported pure helpers (`cascade.ts`):** `parseTasks`, `verifyCommands`, `blockedReason`, `commitTypeOf`, `commitsPerSection`, `isLastOfSection`, `taskPrompt`, `runChecks`.
- **`config.ts`**:
  - `CONSTANTS` (lines 16–164), `FULL_VERIFY`, `QA_VERIFY_COMMANDS`, `resolveEngine`, `isKeepAliveEnabled`, `resolveLogDir`, `formatHelp`, `parseCliArgs`, `loadConfig`, `getDefaultConfig`.
  - Precedence: `overrides > cliOpts > env (CASCADE_*) > defaults`. Note: `--dry-run` suppresses log directory creation (`cascade.ts:123`).
- **`platform.ts`**:
  - `detectPackageManager(cwd)` (lines 324–330): checks `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`/`bun.lockb`, defaults to `"npm"`.
  - `resolvePackageCommands(pm)` (lines 335–370): returns `{ test, lint, build, typecheck, run }` for `pnpm | npm | yarn | bun`.
  - `normalizePlatformPath`, `startKeepAlive`, `findSystemdInhibit`, `canRunSystemdInhibit`, `buildKeepAliveArgs`.

### 3.2 `src/sdd/` — Spec-Driven Development Gates
Imports `CONSTANTS` from `../../config`.
- **`src/sdd/sdd_gate.ts`**:
  - `isProductionSourceFile(filePath: string): boolean` (lines 29–66): checks `CONSTANTS.SDD_PRODUCTION_EXTENSIONS` (`.ts`, `.tsx`, `.js`, `.jsx`, `.vue`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.php`, `.kt`) and exempts `SDD_EXEMPT_PATH_SEGMENTS` (`/test/`, `/tests/`, `/__tests__/`, `/spec/`, `/specs/`, `/docs/`, `/openspec/`, `/.agents/`, `/.claude/`, `/dist/`), prefixes (`test_`, `test.`, `spec.`), and suffixes (`.test.`, `.spec.`).
  - `isGatedTool(toolName: string): boolean` (lines 71–73): gates `Edit`, `Write`, `MultiEdit`.
  - `findActiveOpenSpecChange(repoRoot?: string): Promise<string | null>` (lines 79–114): scans `openspec/changes/<changeId>/tasks.md` for at least one line trimming to `- [ ]`.
  - `evaluateSddGate(input: SddGateInput): Promise<SddGateResult>` (lines 119–152): bypasses if `process.env.CASCADE_SDD_GATE_DISABLED === "1"`; otherwise blocks gated tool edits to production source files when no active OpenSpec change with unchecked tasks exists (`{ allowed: false, activeChangeId: null, reason }`).
  - *(Matching Claude hook: `plugins/cascade/hooks/sdd_gate.mjs`, exits `2` on block, `0` on allow/bypass.)*
- **`src/sdd/analyze.ts`**:
  - `extractRequirementsFromSpec(specContent)`, `extractTasks(tasksContent)`, `analyzeChangeArtifacts(changeId, repoRoot): Promise<AnalysisResult>` (lines 73–220).
  - Checks existence of `proposal.md`, `design.md`, `tasks.md` (blocking if missing), `openspec/project.md` (non-blocking advisory if missing), parses `specs/*.md` and `specs/*/spec.md` for `## Requirement:` / `### Requirement:`, verifies keyword coverage (`word.length > 3`) against `tasks.md` checkboxes (blocking if uncovered), detects empty tasks when proposal exists (blocking orphan), and checks constitution heuristic.
- **`src/sdd/review_verifier.ts`**:
  - `triageFinding(finding)` (lines 43–83): classifies findings into `tier: "risky" | "mechanical" | "advisory"` and normalized `severity: "low" | "medium" | "high" | "critical"`.
  - `verifyReviewFindings(input)` (lines 88–145): enforces stale cache-hit guard (`elapsedSeconds < CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS` (10s) → `{ valid: false, status: "stale" }`), empty diff short-circuit (`status: "empty"`), diff-match overlap between `reviewFiles` and `branchDiffFiles` (`status: "mismatch"` if disjoint), and counts blocking findings (`risky`, `critical`, `high`).
- **`src/sdd/surface_verifier.ts`**:
  - `classifySurfaces(filePaths: string[]): SurfaceReport` (lines 27–73): classifies paths into `frontend` (`.vue`, `.tsx`, `.jsx`, `.svelte`, `.html`, `.css`, `.scss`, `.sass`, `.less`), `backend` (`/api/`, `/routes/`, `/controllers/`, `/handlers/`, `/server/`, `/resolvers/`), or `core`, returning `recommendedChecks` (`DEFAULT_VERIFY` + `sdd-verify:frontend-render-check` / `sdd-verify:api-contract-smoke`).

### 3.3 `src/engine/` — Atomic Git Rollback Buffer
- **`src/engine/rollback_buffer.ts`** (re-exported by root `resilience.ts`):
  - `ROLLBACK_CONSTANTS` (lines 35–80): protects `.agents/teamwork/`, `projects/`, `logs/`, `.atl`, `.claude/settings.local.json` via `DEFAULT_EXCLUDES`.
  - `captureGitState(options?)` (lines 327–365): captures `headSha`, `isDirty`, `untrackedFiles`, `modifiedFiles`.
  - `buildGitCleanCommand(excludes?)` (lines 313–322): builds `git clean -fd -e "..."`.
  - `rollbackWorkingTree(options?)` (lines 371+): preserves registered audit logs in memory across `git reset --hard` + `git clean -fd` with exclusion flags, then restores preserved logs.
  - `RollbackStateBuffer` class (line 521+): atomic triad `snapshot()`, `rollback()`, `commit()`, plus audit trail (`rollback_audit.jsonl`).
  - *Note:* `defaultCommandRunner` uses `Bun.spawn` directly (line 241), and tests can inject a custom `runner` or run against a real temp git repo under Bun.

### 3.4 `src/core/` — Task DAG, FSM, Livelock Prevention, Dispatcher, Escalation, Roles, Snapshot
- **`src/core/fsm_types.ts`**:
  - `LOOPER_STATES` (lines 47–66): 16 non-terminal states (`STATE_INIT`, `STATE_PLAN_DECOMPOSE`, `STATE_DISPATCH_WORKER`, `STATE_EXECUTE_WORKER`, `STATE_DISPATCH_EXPLORER`, `STATE_EXECUTE_EXPLORER`, `STATE_GATE_0_AUTO`, `STATE_GATE_1_REVIEW`, `STATE_GATE_2_CHALLENGE`, `STATE_GATE_3_AUDIT`, `STATE_COMMIT_CHECKPOINT`, `STATE_ESCALATE_DIAGNOSTIC`, `STATE_ROLLBACK_RECOVERY`, `STATE_VICTORY_TRIAGE`, `STATE_SUCCESSION`, `STATE_VICTORY_AUDIT`) + 2 terminal states (`STATE_COMPLETED`, `STATE_ABORTED`).
  - `LOOPER_EVENTS` (lines 107–145): 37 typed events; `FSM_TRANSITION_RULES` (39 transition rules); `FSM_TRANSITION_MATRIX`, `FSM_STATE_ADJACENCY`, `FSM_ALLOWED_EVENTS`; `InvalidStateTransitionError`.
- **`src/core/fsm_guards.ts`**:
  - `createStandardTransitionGuards(options?)` (lines 229–333): deterministic predicates for role dispatch, `hasActiveDagTasks`, `spawnCount`/`tokenUtilizationPercent` succession, Fast-Track vs Full-Gate, Gate 0/1/2 retry caps, and Victory Audit livelock prevention (`createVictoryTriageReopenedGuard`, `createVictoryTriageBlockedGuard`).
- **`src/core/victory_livelock.ts`**:
  - `VictoryAuditLivelockPrevention` (lines 70–292): tracks `_failureCount`, per-task and per-module failure counts, trips circuit breaker from `CLOSED` to `ESCALATED` after `maxFailures` (default `2`), `evaluateTriage()` returns `EVT_TRIAGE_REOPENED` or `EVT_TRIAGE_BLOCKED` (`STATE_ABORTED`).
- **`src/core/fsm.ts`**:
  - `LooperFSM` (lines 220–1190): `dispatchSync()`, `transitionSync()`, `dispatchSyncWithSnapshot()`, `triageVictorySync()`, `registerStandardGuards()`, `onEnter`/`onExit`/`beforeTransition`/`onTransition` hooks, immutable context & history ring buffer. Pure in-memory/EventEmitter (no `Bun.*` calls).
- **`src/core/dag.ts`**:
  - `DirectedAcyclicGraph<T>` (lines 393+): `addNode`, `addEdge`/`addDependency`, `wouldCreateCycle`, `hasCycle`, `findCycle`, `findCycles`, `assertAcyclic`, `topologicalSort`, `getBatches`, `resolveLevels`, `getExecutableTasks`.
  - `DagLevelBatchResolver<T>` (lines 1418+): stateful execution tracker (`markInProgress`, `markCompleted`, `markFailed`, `markBlocked`, `markSkipped`, `resetTask`, `getNextExecutableBatch`, `exportSnapshot`/`importSnapshot`). Throws `CircularDependencyError`, `DagNodeNotFoundError`, `DagValidationError`, `DagExecutionError`.
- **`src/core/dispatcher.ts`**:
  - `SubagentDispatcher` (lines 587–1496) & `createSubagentDispatcher`: manages concurrent subagent lifecycle (`dispatch`, `completeAgent`, `failAgent`, `terminateAgent`, `cleanupAgent`), enforces `maxConcurrentAgents` (`MaxConcurrencyExceededError`), `maxOrchestratorSpawns` (`OrchestratorSuccessionLimitError`), role write-path sandboxing (`SandboxAccessViolationError`), heartbeats, handoffs, and skill discovery.
- **`src/core/escalation.ts`**:
  - `DynamicEscalationLadder` (lines 1668+): rungs `0..N`, `classifyFailure`, `routeFailure`, `handleFailureWithRouting`, `advanceToRung`, `markBlocked`, `decomposeTask`, `serialize`.
  - `OrchestratorSuccessionManager` (lines 2571+) & `FailureClassifier` (lines 2999+).
- **`src/core/roles.ts`**:
  - `normalizeRole`, `getRoleDefinition`, `isCodeMutationAllowed`, `isTestExecutionAllowed`, `canRoleDispatch`, `roleHoldsBinaryVeto`, `validateWritePath`, `generateRoleSystemPrompt`.
- **`src/core/snapshot.ts`**:
  - `createHandoffPayload`, `formatHandoffMarkdown`, `parseHandoffMarkdown`, `validateHandoffReport`, `captureContextSnapshot`, `saveContextSnapshot`, `loadContextSnapshot`, `createSuccessionSnapshot`. *(Imports `captureGitState` from `../../resilience`.)*

### 3.5 `src/storage/` — Persistent Memory & Heartbeat Watchdog
- **`src/storage/memory.ts`**:
  - `MemoryStorage` (lines 1431–1794) & `createMemoryStorage`: manages `.agents/teamwork/` (`sentinel/`, `briefing/`, `state/`), `initializeScaffolding()`, `scaffoldAgentWorkspace()`, `writeAtomic()` (swap-file atomic writes), `writeBriefing()` (protected section guard for `## 🔒 My Identity`, `## 🔒 Key Constraints` throwing `ProtectedSectionError`), `writeStateAtomic()`, `readAtomic()`.
  - `HeartbeatWatchdog` (lines 1126+) & `createHeartbeatWatchdog`: emits `STALENESS` / `RECOVERY` events based on `Last visited:` timestamps in `progress.md`.

### 3.6 `src/gates/` — Quality Gates 0–3
- **Gate 0 (Mechanical QA & Policy):**
  - `src/gates/gate0_policy.ts`: `evaluateGateExecutionPolicy`, `isFastTrackCandidate`, `isDocumentationFile`, `isDisqualifiedFile`, `detectGitAffectedFiles`.
  - `src/gates/gate0_qa.ts`: `Gate0MechanicalRunner`, `runGate0QA`, `verifyGate0FilesystemLayout`, `createGate0CheckDefinitions` (uses `Bun.spawn` in `defaultGate0CommandRunner`; supports injected `commandRunner`).
  - `src/gates/gate0_parser.ts`: failure parsing and XML/markdown feedback generation.
- **Gate 1 (Semantic Review & Rubric):**
  - `src/gates/gate1_rubric.ts`: `evaluateSemanticRubric`, `evaluateCleanCodeRubric`, `evaluateZeroMagicNumbersRubric`, `evaluateDoDAdherenceRubric`, `scanDiffForCleanCode`, `scanDiffForMagicNumbers`. Pure functions operating on git diff strings!
  - `src/gates/gate1_review.ts`: `Gate1Reviewer`, `runGate1Review`, `parseGitDiffFiles`, `parseGitDiffStats`, `verifyBoundaryContainment` (boundary containment check on modified files vs authorized targets).
  - `src/gates/gate1_feedback.ts`: `generateGate1Feedback`, `formatGate1XmlFeedback`, `formatGate1MarkdownFeedback`.
- **Gate 2 (Adversarial Challenger):**
  - `src/gates/gate2_synthesis.ts`: `Gate2EdgeCaseSynthesizer`, `synthesizeEdgeCases`, `extractTargetFileExports` (parses TypeScript exports to generate null/boundary/concurrency/timeout probes).
  - `src/gates/gate2_injector.ts`: `TestingSandbox`, `Gate2AssertionInjector` (ephemeral sandbox probe injection & rollback).
  - `src/gates/gate2_challenger.ts`: `Gate2Challenger`, `runGate2Challenger`.
- **Gate 3 (Forensic Audit & Anti-Cheat Scanner):**
  - `src/gates/gate3_scanner.ts` (re-exported by `src/gates/gate3_anticheat.ts`): `Gate3AntiCheatScanner`, `scanAntiCheatDiff`, `scanAntiCheatContent`, `parseUnifiedDiff`, `DEFAULT_ANTI_CHEAT_RULES` (detects `any`, disabled tests, mocked internals, hardcoded test shortcuts).
  - `src/gates/gate3_audit.ts`: `Gate3Auditor`, `verifyLayoutInvariant`, `verifyGitHygieneInvariant`, `generateGate3Feedback`.

### 3.7 `src/pal/` & `src/integration/`
- **`src/pal/`**:
  - `src/pal/types.ts`: `IPalProvider` (`ProviderAdapter`), `PalError`, `PalMessage`, `PalOutcome`, `PalStreamEvent`, `COGNITIVE_ROLES`, `PAL_PROVIDER_NAMES`, helper constructors.
  - `src/pal/normalizer.ts`: `PalNormalizer`, `normalizeTurns`, `reconcileToolBatch`, `toClaudePayload`/`fromClaudeResponse`, `toGeminiPayload`/`fromGeminiResponse`, `toOpenAiPayload`/`fromOpenAiResponse`.
  - `src/pal/mcp.ts`: `InMemoryMcpClient`, `McpToolBridge`, `PalToolDispatcher`, `validateToolArguments`.
  - `src/pal/react_parser.ts`: `extractReActToolCalls`, `repairTruncatedJson`, `repairJsonArguments`, `detectTruncatedReActTag`, `stitchTruncatedToolCall`.
  - `src/pal/adapters/{claude,gemini,opencode,jules}.ts`: `ClaudeAdapter`, `GeminiAdapter`, `OpenCodeAdapter`, `JulesAdapter` (note: `gemini.ts`, `opencode.ts`, `jules.ts` fall back to `Bun.spawn` if no custom spawn function is injected).
- **`src/integration/`**:
  - `src/integration/schema_validator.ts`: `TaskSchemaValidator`, `validateTaskSchema`, `validateCatalogSchema`, `assert100PercentCompliance` (validates the 4 required sections: `Propósito de la tarea`, `Qué se espera lograr`, `Goal de la tarea`, `Criterios de completitud`).
  - `src/integration/catalog_generator.ts`: `TaskCatalogGenerator`, `generateCatalogFiles`, `parseTaskBodySections`, `formatCatalogJson`, `formatCatalogMarkdown`, `atomicWriteFile`.
  - `src/integration/drift_detector.ts`: `CatalogDriftDetector`, `detectCatalogDrift`, `assertNoDrift`, `compareTaskItems`.
  - `src/integration/github_project.ts`: `GitHubProjectService`, `executeWithRetry`, `isRateLimitError`, `isTransientNetworkError`.

---

## 4. `openspec/` Schema & `--strict` Validation Requirements (for Temp-Repo E2E Fixtures)

Verified directly against `openspec/config.yaml`, `openspec/project.md`, and `./node_modules/.bin/openspec validate --all --strict` (`@fission-ai/openspec` v1.17.0, 22/22 repo changes passing):

1. **Repository Layout:**
   ```
   openspec/
   ├── config.yaml                  # Must specify: schema: spec-driven
   ├── project.md                   # Constitution (advisory for analyze.ts, recommended for realism)
   ├── specs/                       # Optional main specs directory
   └── changes/
       └── <change-id>/
           ├── .openspec.yaml       # e.g. schema: spec-driven\ncreated: YYYY-MM-DD
           ├── proposal.md          # Sections: # Proposal: ..., ## Why, ## What Changes, (## Definition of Done)
           ├── design.md            # Sections: # Design: ..., ## Context, ## Decisions
           ├── tasks.md             # Checkboxes: - [ ] 1.1 ... or - [x] 1.1 ... under ## N. Section
           └── specs/
               └── <capability-slug>/
                   └── spec.md      # Delta spec file
   ```
2. **`spec.md` Strict Format Rules (`--strict`):**
   - Must contain delta section headers such as `## ADDED Requirements` (or `MODIFIED` / `REMOVED` / `RENAMED`).
   - Each requirement heading must be `### Requirement: <Title>` (note: `src/sdd/analyze.ts` accepts `## Requirement:` or `### Requirement:`).
   - Requirement body **MUST** contain normative `SHALL` or `MUST` (first line of requirement body per `openspec/project.md:28`).
   - Each requirement **MUST** have at least one `#### Scenario: <Scenario Name>` with `- **WHEN** ...`, (optional `- **AND** ...`), `- **THEN** ...` bullets.
3. **`tasks.md` Conventions (`cascade.ts:154-177` & `src/sdd/sdd_gate.ts:97-99`):**
   - Section headers: `## 1. <Section Title>`
   - Task items parsed by `cascade.ts:parseTasks()`: `- [ ] 1.1 <Task text>` or `- [ ] **T001**: <Task text>` (indented continuation lines are appended).
   - Active change detection in `sdd_gate.ts` / `sdd_gate.mjs`: checks for any line trimming to `- [ ]` in `openspec/changes/<changeId>/tasks.md`.
   - Verification tasks recognized by `cascade.ts:verifyCommands()`: contain `Verify:` or `full verification` (and backticked `bun ...` commands), and commit tasks contain ``Commit `type(scope)` `` or `` `type` commit``.
4. **Analyze Gate (`src/sdd/analyze.ts`) Coupling:**
   - Every requirement title in `specs/<cap>/spec.md` must share at least one keyword (`length > 3`) with a task in `tasks.md` to pass `analyzeChangeArtifacts()` with 0 blocking coverage gaps.
   - `proposal.md`, `design.md`, and `tasks.md` must all be present and non-empty (at least 1 task).
5. **CLI Invocation for OpenSpec in Temp Fixtures:**
   - OpenSpec CLI is local at `./node_modules/.bin/openspec` (v1.17.0, NOT globally on `PATH` in this container unless invoked via `./node_modules/.bin/openspec` or `bunx openspec`). Temp-repo E2E tests validating `--strict` can invoke `<repoRoot>/node_modules/.bin/openspec validate --strict` (or `bunx openspec validate <change-id> --strict` with `PATH` including repo `node_modules/.bin`).

---

## 5. Compiler & Linter Rules Relevant to Writing E2E Tests

- **`tsconfig.json`**: `strict: true`, `noUncheckedIndexedAccess: true`, `target: "ES2022"`, `moduleResolution: "bundler"`, `types: ["bun"]`, includes `["*.ts", "src/**/*.ts", "test/**/*.ts"]`. All `test/e2e/**/*.ts` files are typechecked by `bun run typecheck` (`tsc --noEmit`).
- **`eslint.config.js`**:
  - `files: ["**/*.ts"]` enforces:
    - `@typescript-eslint/no-magic-numbers: "error"` (except `**/*.test.ts` where it is `"off"` — **important:** helper files under `test/e2e/helpers/*.ts` DO NOT match `**/*.test.ts`, so helpers MUST NOT contain magic numbers other than `-1, 0, 1` or `const` declarations!).
    - `@typescript-eslint/explicit-module-boundary-types: "error"` on **ALL** `**/*.ts` files (including `*.test.ts` and `helpers/*.ts`) — every exported function/method MUST have explicit parameter and return types!
- **Pre-existing `src/` Circular Imports (M4 F14 target, informational):**
  - `src/gates/*` and `src/integration/catalog_*` and `src/core/snapshot.ts` (`../../resilience`) have known cross-imports noted in `PROJECT.md` F14, though all 36 existing `test/**/*.test.ts` files currently import them under Bun without runtime crash.
