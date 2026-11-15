# Project: openspec-cascade Looper v2 Enhancement

## Architecture

`openspec-cascade` is evolving from a split-brain codebase (a live v1 sequential CLI runner in root `cascade.ts` + 10 root files, alongside ~45,974 LOC of disconnected v2 modules in `src/`) into a unified, dual-runtime (Bun 1.4+ & Node.js 24 LTS), Spec-Driven Development (SDD) multi-engine autonomous looper.

### Layered Hexagonal Architecture (Target)
1. **Configuration & Guardrails (`src/config/`)**: Centralized typed constants (`constants.ts`), strict Zod schemas (`schemas.ts`), AWS Well-Architected & security guardrails (`guardrails.ts`), layered loader (`loader.ts`: `CLI > CASCADE_* env > .openspec-cascade.json > defaults`), and backward-compatible `config.ts` facade. Zero magic numbers, fail-closed CLI exit code `2` on invalid input.
2. **Isomorphic Runtime (`src/runtime/`)**: `ISpawner` abstraction (`BunSpawner`, `NodeSpawner`) with `AbortSignal`, safe process-group kills, `which`, `sleep`, and cross-platform argv execution (`win32`/`linux`/`darwin`, zero `sh -c` interpolation). Eliminates all direct `Bun.*` lock-in.
3. **Provider Abstraction Layer & GoF Decorators (`src/pal/`, `src/decorators/`)**: `EngineFactory` (`src/pal/factory.ts`) unifying `claude`, `opencode`, `antigravity`/`gemini`, and `jules` behind `IPalProvider` + `EngineAdapter` bridge; wrapped by `ResilientEngineDecorator` (exponential backoff + jitter + circuit breaker) and `TelemetryMetricsDecorator`.
4. **External Integrations (`src/integration/greptile/`, `src/integration/*`)**: `IGreptileClient` over `ISpawner`, isolated `GIT_INDEX_FILE` shadow-commit manager (`shadow.ts`), SHA-256 content-addressed disk cache (`.cascade/cache/greptile/`), token-budgeted semantic context formatter (`search.ts`), and Pre-PR diff-match bridge into `src/sdd/review_verifier.ts`.
5. **Orchestration Facade & Harness Injector (`src/facade/`, `src/core/harness_injector.ts`)**: `CascadeFacade` connecting thin CLI `cascade.ts` to `HarnessInjector` -> `analyzeChangeArtifacts` -> `evaluateSddGate` -> `TaskDag` -> `LooperFSM` + `VictoryAuditLivelockPrevention` -> `SubagentDispatcher` -> `Gate 0..3` -> `DynamicEscalationLadder` -> `RollbackStateBuffer` -> `MemoryStorage`.
6. **Self-Improving Loop & CI (`src/core/self_improver.ts`, `.github/workflows/ci.yml`)**: Telemetry persistence (`.cascade/telemetry/*.jsonl`), failure pattern aggregation, bounded prompt/directive refinement, bounded pre-PR review loop, and dual-runtime CI.

### Constitution & Non-Negotiable Quality Rules (`openspec/project.md`)
- **SDD Discipline**: Every milestone requires an approved, `openspec validate --strict` OpenSpec change (`proposal.md`, `design.md`, `specs/*/spec.md`, `tasks.md`) before production code edits.
- **Zero Magic Numbers**: `@typescript-eslint/no-magic-numbers` enforced; constants live in `src/config/constants.ts` / `config.ts`.
- **Strict Typing**: `@typescript-eslint/no-explicit-any: "error"`, `strict: true`, `noUncheckedIndexedAccess: true` — zero `any` or `as any`.
- **Clean Code**: Zero inline comments inside function bodies explaining WHAT code does; JSDoc/TSDoc for WHY only.
- **Zero-Stub E2E Tests**: E2E tests MUST import and exercise real production modules / CLI binaries — NEVER fake reference harnesses or stubbed implementations.
- **Incremental Git Preservation**: Work proceeds on feature branch `feat/cascade-looper-v2` (respecting `openspec/project.md` rule #8 against mutating protected `main` directly), with Conventional Commits pushed to `origin` after every verified milestone.

---

## Feature Inventory

Every feature below has an assigned Milestone and source reference (`ORIGINAL_REQUEST.md` `## 2026-11-15T01:46:44Z` + Survey Explorers 1–3).

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Centralized Constants | `src/config/constants.ts` typed immutable namespaces unifying `config.ts` and 32 `src/*_CONSTANTS` objects | M1 | Request M1, Survey 2/3 |
| F02 | Zod Validation Schemas | `src/config/schemas.ts` (`zod` dependency) validating runtime/engine/gate/SDD/Greptile/CLI configs; strict `budget` & `NaN` coercion; fail-closed exit code `2` | M1 | Request M1, Survey 2/3 |
| F03 | Security & Well-Architected Guardrails | `src/config/guardrails.ts` (`enforceSessionBudget` strict `>=`, `redactSensitiveData` circular-ref + depth guard + container preservation, dry-run on protected branches) | M1 | Request M1 |
| F04 | Dynamic Stack Config Loader | `src/config/loader.ts` + refactored `config.ts`, `platform.ts`, `cascade.ts` integrating `detectPackageManager`/`resolvePackageCommands` (no hardcoded Bun/Nuxt/Drizzle; no import-time `loadConfig()`) | M1 | Request M1, Survey 2 |
| F05 | Strict TypeScript, ESLint & Clean Code | Enable `@typescript-eslint/no-explicit-any: "error"`, expand `lint.test.ts` to `src/**/*.ts`, eliminate all `any` leaks and inline function-body comments, M1 OpenSpec change | M1 | Request M1, Survey 2/3 |
| F06 | Isomorphic Process Runner (`ISpawner`) | `src/runtime/` (`ISpawner`, `BunSpawner`, `NodeSpawner`) with `AbortSignal`, `safelyKillProcess`, cross-platform argv execution; migrate 14 `Bun.*` sites + Node 24 test compatibility | M2 | Request M2, Survey 2/3 |
| F07 | PAL Creational Factory & Adapter Unification | `src/pal/factory.ts` (`EngineFactory` / `PalProviderFactory`) unifying `claude`, `opencode`, `antigravity`/`gemini`, and `jules`; deduplicate shared helpers; finish `looper-pal-jules-adapter` task `1.2` | M2 | Request M2, Survey 2/3 |
| F08 | GoF Resilience & Telemetry Decorators | `src/decorators/resilient_engine.ts` (exponential backoff + jitter + circuit breaker) and `src/decorators/telemetry_metrics.ts` (latency, tokens, cost, retries, error categories) | M2 | Request M2, Survey 3 |
| F09 | Unified `CascadeFacade` | `src/facade/cascade_facade.ts` coordinating preflight, dry-run, keep-alive, `EngineFactory` + decorators, `RollbackStateBuffer`; refactor `cascade.ts` to thin CLI adapter; M2 OpenSpec change | M2 | Request M2, Survey 2/3 |
| F10 | Greptile CLI Client | `src/integration/greptile/client.ts` (`IGreptileClient` over `ISpawner`: `review --agent --json`, `query`, `index`, `status`) with typed error taxonomy | M3 | Request M3, Survey 3 |
| F11 | Ephemeral Shadow Commit Manager | `src/integration/greptile/shadow.ts` using isolated temp `GIT_INDEX_FILE` (`read-tree`, `add -A`, `write-tree`, `commit-tree`) with guaranteed cleanup and zero user git-state mutation | M3 | Request M3, Survey 3 |
| F12 | Content-Addressed Greptile Cache | `src/integration/greptile/cache.ts` in `.cascade/cache/greptile/` keyed by composite SHA-256 (`baseSha + diffHash + query`) with TTL and fail-open/fail-closed policies | M3 | Request M3, Survey 3 |
| F13 | Semantic Search & Pre-PR Diff Bridge | `src/integration/greptile/search.ts` (token-budgeted prompt formatter) + bridge into `src/sdd/review_verifier.ts` (`>= 10s` stale-cache guard, merge-base diff-match); M3 OpenSpec change | M3 | Request M3, Survey 3 |
| F14 | Deterministic Harness Injector & Cycle Cleanup | `src/core/harness_injector.ts` assembling OpenSpec artifacts, constitution, skills, Greptile context, and guardrails; break circular imports in `src/gates/*`, `src/integration/catalog_*`, and `src/core/snapshot.ts` | M4 | Request M4, Survey 2/3 |
| F15 | V2 Looper Pipeline Wiring | Connect `CascadeFacade` to `Analyze` -> `SDDGate` -> `TaskDag` -> `LooperFSM` -> `SubagentDispatcher` (`IPalProvider`) -> `Gate 0..3` -> `EscalationLadder` -> `RollbackStateBuffer` -> `MemoryStorage`; preserve `--mode v1|v2` & CLI flags | M4 | Request M4, Survey 2/3 |
| F16 | Plugin & Hook Synchronization | Sync `plugins/cascade/hooks/sdd_gate.mjs` (`.mjs`/`.cjs` + shared exit code), `commands/*.md`, `workflows/cascade-looper.mjs`, `bin/install.mjs`; M4 OpenSpec change | M4 | Survey 2/3 |
| F17 | Self-Improving Looper & Telemetry | `src/core/self_improver.ts` persisting `.cascade/telemetry/*.jsonl`, classifying recurring failure signatures, and injecting bounded remediation directives via `HarnessInjector` | M5 | Request M5, Survey 3 |
| F18 | Bounded Pre-PR Loop & Integration CLI | Bounded pre-PR fix loop (`<= 3` rounds, `mechanical` vs `risky` triage) and CLI commands for `catalog_generator` / `drift_detector` / `github_project` (`--sync-catalog`, `doctor`) | M5 | Survey 3 |
| F19 | CI/CD Workflow & Repo Hygiene | `.github/workflows/ci.yml` (Bun + Node 24 tests, `tsc --noEmit`, `eslint .`, `openspec validate --strict`), `.gitignore` update (`.cascade/`, `.redteam_sandbox_*`), M5 OpenSpec change | M5 | Survey 1/3 |
| F20 | Final Certification, Docs & Dual-Runtime E2E | Update `README.md`, `docs/cli.md`, `run_looper.sh`; pass 100% E2E Tiers 1–4 + Tier 5 Adversarial Hardening against real modules (0 stubs/mocks); final `bun test` + Node 24 + `tsc` + `eslint` + `openspec validate --strict` + push to `origin` | M6 | Request M6, Survey 1–3 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Env Provisioning & Git Sync | Install Bun, `bun install --frozen-lockfile`, `git fetch origin`, create/push `feat/cascade-looper-v2`, capture baseline | none | DONE |
| E2E | E2E Testing Track | Design `TEST_INFRA.md`, write opaque-box Tiers 1–4 E2E tests (`test/e2e/`) importing real modules/CLI (0 stubs/mocks), publish `TEST_READY.md` | M0 | DONE (Phase A) |
| M1 | Zero Magic Numbers, Zod Config & Guardrails | F01–F05 (`src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `eslint.config.js`, `lint.test.ts`, OpenSpec change) + commit & push | M0 | DONE |
| M2 | Isomorphic Runtime, PAL Factory & Facade | F06–F09 (`src/runtime/*`, `src/pal/factory.ts`, `src/decorators/*`, `src/facade/*`, 14 `Bun.*` migrations, OpenSpec change) + commit & push | M1 | DONE |
| M3 | Greptile CLI Integration | F10–F13 (`src/integration/greptile/{client,shadow,cache,search,bridge}.ts`, OpenSpec change) + commit & push | M2 | PLANNED |
| M4 | Harness Injector & V2 Looper Wiring | F14–F16 (`src/core/harness_injector.ts`, cycle fixes, v2 pipeline wiring in `CascadeFacade`, plugin/hook sync, OpenSpec change) + commit & push | M2, M3 | PLANNED |
| M5 | Self-Improving Looper & CI | F17–F19 (`src/core/self_improver.ts`, bounded pre-PR loop, CLI integration, `.github/workflows/ci.yml`, `.gitignore`, OpenSpec change) + commit & push | M4 | PLANNED |
| M6 | Final Certification | F20 + Phase 1 (100% E2E Tiers 1–4) + Phase 2 (Tier 5 Adversarial Hardening) + final clean verification & push to `origin` | M5, E2E | PLANNED |

---

## Interface Contracts

### `src/config/` ↔ Consumers (M1)
- `CascadeConfigSchema`: Zod schema validating `{ engine, model, repo, changes, logDir, dryRun, allowDirty, keepAlive, fullGate, mode, maxTurns, maxBudgetUsd, usageLimitPercent, rateLimitSleepMs, verifyCommands, greptile, sdd, telemetry }`.
- `loadConfig(argv?: string[], env?: Record<string, string | undefined>): CascadeConfig` — throws `ConfigValidationError` (CLI adapter exits with code `2` fail-closed on invalid CLI/config).
- `enforceSessionBudget(spentUsd: number, maxBudgetUsd: number): void` — throws `BudgetExceededError` when `Number.isNaN(spentUsd)` or `spentUsd >= maxBudgetUsd`.
- `redactSensitiveData<T>(value: T, maxDepth?: number): T` — uses `WeakSet` for circular references, preserves `Array`/`Map`/`Set`/plain objects, redacts tokens/keys/secrets without throwing on cycles.

### `src/runtime/` ↔ PAL / Greptile / Gates (M2)
- `ISpawner`:
  - `detectRuntime(): "bun" | "node"`
  - `spawn(argv: readonly string[], options?: SpawnOptions): SpawnedProcess` (supports `cwd`, `env`, `abortSignal`, `timeoutMs`, `stdin`, streaming `stdout`/`stderr`, `exitCode` promise)
  - `spawnSync(argv: readonly string[], options?: SpawnSyncOptions): SpawnSyncResult`
  - `which(binary: string): string | null`
  - `sleep(ms: number, signal?: AbortSignal): Promise<void>`

### `src/pal/` & `src/decorators/` ↔ `CascadeFacade` (M2)
- `EngineFactory.create(engine: EngineType, options: EngineFactoryOptions): UnifiedEngine` — supports `"claude" | "opencode" | "antigravity" | "gemini" | "jules"`.
- `ResilientEngineDecorator` & `TelemetryMetricsDecorator` implement the same engine contract, composing transparently around any `EngineFactory` output.
- `CascadeFacade.run(config: CascadeConfig): Promise<CascadeRunResult>` — structured execution result with exit code, task outcomes, telemetry summary, and rollback status.

### `src/integration/greptile/` ↔ `HarnessInjector` & `review_verifier.ts` (M3)
- `IGreptileClient`: `checkStatus()`, `review(opts)`, `query(opts)`, `index(opts)`.
- `ShadowCommitManager.withShadowCommit<T>(repoPath: string, fn: (shadowSha: string) => Promise<T>): Promise<T>` — guarantees index/ref cleanup in `finally` with zero mutation to `HEAD` or working tree.
- `GreptileCache`: `get(keyComponents)`, `set(keyComponents, value)` under `.cascade/cache/greptile/` using SHA-256 keys.
- `GreptileSearch.formatContext(findings, tokenBudget)` — returns bounded context string for prompt injection.

### `src/core/harness_injector.ts` & `src/core/self_improver.ts` ↔ `CascadeFacade` (M4–M5)
- `HarnessInjector.buildExecutionContext(input: HarnessInput): Promise<InjectedHarness>` — combines OpenSpec change artifacts, constitution, skills, Greptile context, guardrails, and SelfImprover remediation directives.
- `SelfImprover.recordOutcome(telemetry: RunTelemetry): Promise<void>` & `SelfImprover.deriveDirectives(history): RemediationDirective[]` — bounded directive list injected into subsequent iterations.

---

## Code Layout
- Root CLI & backward-compatible shims: `cascade.ts`, `config.ts`, `engine.ts`, `platform.ts`, `qa.ts`, `skills.ts`, `diagrams.ts`, `resilience.ts`, `claude.ts`, `antigravity.ts`, `opencode.ts`
- `src/config/`: `constants.ts`, `schemas.ts`, `guardrails.ts`, `loader.ts`, `index.ts`
- `src/runtime/`: `types.ts`, `bun_spawner.ts`, `node_spawner.ts`, `spawner.ts`, `index.ts`
- `src/pal/`: `types.ts`, `factory.ts`, `normalizer.ts`, `mcp.ts`, `react_parser.ts`, `adapters/{claude,gemini,opencode,jules}.ts`
- `src/decorators/`: `resilient_engine.ts`, `telemetry_metrics.ts`, `index.ts`
- `src/facade/`: `cascade_facade.ts`, `index.ts`
- `src/integration/greptile/`: `client.ts`, `shadow.ts`, `cache.ts`, `search.ts`, `bridge.ts`, `index.ts`
- `src/core/`: existing v2 core + `harness_injector.ts`, `self_improver.ts`
- `src/gates/`, `src/sdd/`, `src/storage/`, `src/engine/`, `src/integration/`: existing modules (de-cycled & wired)
- `test/`: unit/integration tests + `test/e2e/{tier1_features,tier2_boundaries,tier3_combinations,tier4_scenarios,tier5_adversarial}/`
- `openspec/changes/`: `--strict`-validated OpenSpec changes for M1–M5
- `.github/workflows/ci.yml`: dual-runtime CI workflow
