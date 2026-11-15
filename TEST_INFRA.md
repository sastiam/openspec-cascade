# E2E Test Infrastructure Architecture (`TEST_INFRA.md`)

> **Track:** E2E Testing Track (`sub_orch_e2e_2` — Iteration 2)  
> **Target Branch:** `feat/cascade-looper-v2`  
> **Policy:** **Zero Stubs / Zero Mocks** — Every E2E test executes real CLI subprocesses (`cascade.ts`, `sdd_gate.mjs`, `bin/install.mjs`, `openspec`) or imports genuine production modules (`config.ts`, `platform.ts`, `qa.ts`, `skills.ts`, `diagrams.ts`, `engine.ts`, `resilience.ts`, `src/**`).

---

## 1. Architecture & Opaque-Box Testing Philosophy

The `test/e2e/` suite validates `openspec-cascade` end-to-end across its CLI boundary, filesystem/git state invariants, SDD gates, quality gates (Gate 0–3), PAL normalizers, catalog integration, and rollback/memory recovery pipelines.

### Non-Negotiable Invariants
1. **Zero Stubs / Zero Reference Harnesses:** Tests MUST NEVER define `reference_pal`, `reference_spawner`, mock engine facades, or duplicated production logic. All tests invoke real subprocesses or real production exports.
2. **Strict Workspace Isolation:** Every subprocess and module test operates exclusively inside `os.tmpdir()` directories (`cascade-e2e-repo-*`, `cascade-e2e-home-*`, `cascade-e2e-logs-*`, `cascade-e2e-sandbox-*`), passing explicit `--repo`, `--log-dir`, `HOME`, `XDG_CACHE_HOME`, `CLAUDE_CONFIG_DIR`, `workspaceRoot`, `repoRoot`, and `baseDir`. Tests MUST NEVER mutate the main workspace repository or user `$HOME`.
3. **Clean Environment Isolation:** Subprocess helpers strip inherited `CASCADE_*` and `ARCHIFY_BIN` variables unless explicitly supplied by the test case, while preserving deterministic `PATH` resolution (`dirname(process.execPath)` + `/usr/local/bin:/usr/bin:/bin`).
4. **Build & Linter Compliance:** All `test/e2e/**/*.ts` files comply with `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`) and `eslint.config.js` (`@typescript-eslint/explicit-module-boundary-types: "error"`, `@typescript-eslint/no-magic-numbers: "error"` on `helpers/*.ts`), with zero `any`, zero `as any`, and zero inline comments inside function bodies.
5. **Two-Phase Delivery Gate:**
   - **Phase A (Active Now):** Tests exercising the real Phase A CLI (`cascade.ts`, `sdd_gate.mjs`, `bin/install.mjs`, `openspec`) and all existing production modules (`config.ts`, `platform.ts`, `qa.ts`, `skills.ts`, `diagrams.ts`, `engine.ts`, `resilience.ts`, `src/sdd/*`, `src/engine/*`, `src/core/*`, `src/gates/*`, `src/storage/*`, `src/pal/{types,normalizer,mcp,react_parser}`, `src/integration/{catalog_generator,drift_detector,schema_validator}`).
   - **Phase B (Gated on M1–M5 `DONE` in `PROJECT.md`):** Expands the same 14 test files (plus Tier 5 hardening) to import newly landed modules (`src/config/*`, `src/runtime/*`, `src/pal/factory.ts`, `src/decorators/*`, `src/facade/*`, `src/integration/greptile/*`, `src/core/harness_injector.ts`, `src/core/self_improver.ts`) once each milestone marks `DONE` in `PROJECT.md`.

---

## 2. Directory & Tier Taxonomy

```text
test/e2e/
├── helpers/
│   ├── constants.ts            # E2E_CONSTANTS (timeouts, exit codes, prefixes, git author, branches)
│   ├── cli_runner.ts           # runCascadeCli, runNodeScript, runOpenSpecCli, buildIsolatedEnv
│   └── temp_repo.ts            # createTempGitRepo, addOpenSpecChange, runGitCommand, cleanupTempDir
├── tier1_features/             # Single-feature E2E & CLI behavior
│   ├── f01_f05_config_cli_lint.test.ts
│   ├── f06_f09_runtime_pal_facade.test.ts
│   ├── f10_f13_greptile_review.test.ts
│   ├── f14_f16_harness_v2_plugins.test.ts
│   └── f17_f20_telemetry_hygiene_docs.test.ts
├── tier2_boundaries/           # Boundary, invalid input, timeout & failure modes
│   ├── cli_config_boundaries.test.ts
│   ├── sdd_and_review_boundaries.test.ts
│   └── rollback_and_gate_boundaries.test.ts
├── tier3_combinations/         # Multi-feature combinations & matrix interactions
│   ├── cli_stack_pm_combinations.test.ts
│   ├── sdd_gates_pipeline_combinations.test.ts
│   └── resilience_and_catalog_combinations.test.ts
├── tier4_scenarios/            # Full end-to-end user & failure/rollback journeys
│   ├── dry_run_cascade_journey.test.ts
│   ├── installer_and_sdd_hook_journey.test.ts
│   └── failure_rollback_audit_journey.test.ts
└── tier5_adversarial/          # Reserved Phase 2 / M6 adversarial hardening slot
    └── README.md
```

### Tier Definitions
| Tier | Directory | Scope & Verification Strategy |
|---|---|---|
| **Tier 1 — Features** | `test/e2e/tier1_features/` | Verifies each feature (`F01–F20`) along its primary happy path through real CLI execution or real module entrypoints. |
| **Tier 2 — Boundaries** | `test/e2e/tier2_boundaries/` | Exercises invalid CLI arguments, protected branches, dirty trees, `NaN`/empty env inputs, subprocess timeouts, stale caches, diff mismatches, missing OpenSpec artifacts, and Gate 0–3 / Rollback invariant violations. |
| **Tier 3 — Combinations** | `test/e2e/tier3_combinations/` | Tests cross-feature matrices: `CLI > env > defaults` precedence × engine × package manager lockfiles; `analyzeChangeArtifacts` + `surface_verifier` + `Gate 0..3`; `LooperFSM` + `DagLevelBatchResolver` + `VictoryAuditLivelockPrevention`; `TaskCatalogGenerator` + `CatalogDriftDetector`. |
| **Tier 4 — Scenarios** | `test/e2e/tier4_scenarios/` | Executes multi-step user journeys end-to-end: multi-change `--dry-run` cascade plans, `openspec validate --strict` + `sdd_gate.mjs` + `bin/install.mjs` lifecycle, and dirty-repo violation → Gate 3 veto → atomic git rollback preserving `.agents/teamwork/` and audit JSONL logs. |
| **Tier 5 — Adversarial** | `test/e2e/tier5_adversarial/` | Reserved for Phase 2 / M6 hardening after M1–M5 land: circular-reference redaction bombs, NaN/overflow budget injections, path traversal / symlink escapes, `SIGKILL`/`SIGTERM` process-group cleanup, and anti-cheat evasion probes. |

---

## 3. Comprehensive Coverage Matrix (`F01–F20` across Tiers 1–4)

Target full-program capacity across Phase A + Phase B: **~11 tests × 20 features + ~10 cross-cutting journey/combination tests = ~230 tests total**.

| Feature | Milestone | Tier 1 (Features) | Tier 2 (Boundaries) | Tier 3 (Combinations) | Tier 4 (Scenarios) | Planned Count (T1/T2/T3/T4) | Phase A Active Targets (Real Modules / CLI) | Phase B Expansion (Gated on `PROJECT.md` `DONE`) |
|---|---|---|---|---|---|---|---|---|
| **F01** Centralized Constants | M1 | `f01_f05` | `cli_config` | `cli_stack_pm` | — | 3 / 3 / 3 / 2 (11) | `config.ts` (`CONSTANTS`, `FULL_VERIFY`, `QA_VERIFY_COMMANDS`), `eslint` magic-number checks | `src/config/constants.ts` 7 namespaces + parity across `src/` |
| **F02** Zod Validation Schemas | M1 | `f01_f05` | `cli_config` | `cli_stack_pm` | `dry_run_cascade` | 3 / 4 / 2 / 2 (11) | `cascade.ts` `--engine` failure, `config.ts` `loadConfig` numeric/boolean parsing | `src/config/schemas.ts` `CascadeConfigSchema`, strict `budget`/`NaN`, CLI exit code `2` on invalid flags |
| **F03** Security & Guardrails | M1 | `f01_f05` | `cli_config`, `rollback_and_gate` | `resilience_and_catalog` | `failure_rollback` | 2 / 4 / 3 / 2 (11) | `cascade.ts` protected branches & dirty-tree guard, `RollbackStateBuffer` | `src/config/guardrails.ts` (`enforceSessionBudget` strict `>=`, `redactSensitiveData` cycle/depth guard), dry-run on protected branches |
| **F04** Dynamic Stack Loader | M1 | `f01_f05` | `cli_config` | `cli_stack_pm` | `dry_run_cascade` | 3 / 3 / 3 / 2 (11) | `platform.ts` (`detectPackageManager`, `resolvePackageCommands`), `config.ts` precedence | `src/config/loader.ts` (`.openspec-cascade.json` layer + dynamic PM wiring into `verifyCommands`) |
| **F05** Strict TS, ESLint & Clean Code | M1 | `f01_f05` | `rollback_and_gate` | `sdd_gates_pipeline` | — | 3 / 3 / 3 / 2 (11) | `eslint` programmatic verification, `Gate1Rubric` (`scanDiffForCleanCode`, `scanDiffForMagicNumbers`) | `lint.test.ts` `src/**/*.ts` scan + `@typescript-eslint/no-explicit-any: "error"` |
| **F06** Isomorphic Runner (`ISpawner`) | M2 | `f06_f09` | `cli_config` | `cli_stack_pm` | `dry_run_cascade` | 3 / 4 / 2 / 2 (11) | `platform.ts` (`startKeepAlive`, `buildKeepAliveArgs`), `qa.ts` (`defaultCommandRunner`) | `src/runtime/` (`ISpawner`, `BunSpawner`, `NodeSpawner`), `AbortSignal`, Node 24 LTS parity |
| **F07** PAL Factory & Adapters | M2 | `f06_f09` | `cli_config` | `cli_stack_pm` | — | 3 / 3 / 3 / 2 (11) | `engine.ts` (`getEngineAdapter`), `src/pal/{normalizer,mcp,react_parser,types}` | `src/pal/factory.ts` (`EngineFactory`) unifying `claude`, `opencode`, `antigravity`/`gemini`, `jules` |
| **F08** GoF Resilience & Telemetry | M2 | `f06_f09` | `cli_config` | `cli_stack_pm` | `failure_rollback` | 3 / 3 / 3 / 2 (11) | `qa.ts` (`runVerificationPhase`, `formatVerificationFeedback`), `cascade.ts` `--resilient` | `src/decorators/` (`ResilientEngineDecorator` backoff/jitter/circuit-breaker, `TelemetryMetricsDecorator`) |
| **F09** Unified `CascadeFacade` | M2 | `f06_f09` | `cli_config` | `cli_stack_pm` | `dry_run_cascade` | 3 / 3 / 3 / 2 (11) | `cascade.ts` CLI `--help` & `--dry-run` preflight/plan/usage pipeline | `src/facade/cascade_facade.ts` (`CascadeFacade.run`) & thin `cascade.ts` adapter |
| **F10** Greptile CLI Client | M3 | `f10_f13` | `sdd_and_review` | `sdd_gates_pipeline` | — | 3 / 3 / 3 / 2 (11) | `src/sdd/review_verifier.ts` (`triageFinding`) | `src/integration/greptile/client.ts` (`IGreptileClient`: `review`, `query`, `index`, `status`) |
| **F11** Ephemeral Shadow Commits | M3 | `f10_f13` | `sdd_and_review` | `sdd_gates_pipeline` | `failure_rollback` | 3 / 3 / 3 / 2 (11) | Real temp git repo `git merge-base` + `git diff --name-only` verification | `src/integration/greptile/shadow.ts` (`ShadowCommitManager` isolated `GIT_INDEX_FILE` cleanup) |
| **F12** Content-Addressed Cache | M3 | `f10_f13` | `sdd_and_review` | `sdd_gates_pipeline` | — | 3 / 4 / 2 / 2 (11) | `verifyReviewFindings` stale cache-hit guard (`elapsedSeconds < 10`) | `src/integration/greptile/cache.ts` (`.cascade/cache/greptile/` SHA-256 + TTL + fail-open/closed) |
| **F13** Semantic Search & Diff Bridge | M3 | `f10_f13` | `sdd_and_review` | `sdd_gates_pipeline` | `failure_rollback` | 3 / 3 / 3 / 2 (11) | `verifyReviewFindings` (`status: "ok" \| "stale" \| "mismatch" \| "empty"`), blocking counts | `src/integration/greptile/{search,bridge}.ts` token-budgeted context + `review_verifier` bridge |
| **F14** Harness Injector & Cycle Cleanup | M4 | `f14_f16` | `sdd_and_review`, `rollback_and_gate` | `sdd_gates_pipeline` | `installer_and_sdd_hook` | 3 / 3 / 3 / 2 (11) | `cascade.ts` (`taskPrompt`), `skills.ts`, `src/sdd/{analyze,surface_verifier}.ts` | `src/core/harness_injector.ts` (`HarnessInjector.buildExecutionContext`) + de-cycled imports |
| **F15** V2 Looper Pipeline Wiring | M4 | `f14_f16` | `rollback_and_gate` | `sdd_gates_pipeline`, `resilience_and_catalog` | `dry_run_cascade`, `failure_rollback` | 3 / 3 / 3 / 3 (12) | `LooperFSM`, `DirectedAcyclicGraph`, `VictoryAuditLivelockPrevention`, `SubagentDispatcher`, `DynamicEscalationLadder`, `Gate 0..3`, `RollbackStateBuffer` | `CascadeFacade` `--mode v1\|v2` end-to-end FSM/DAG/Gate pipeline execution |
| **F16** Plugin & Hook Synchronization | M4 | `f14_f16` | `sdd_and_review` | `sdd_gates_pipeline` | `installer_and_sdd_hook` | 3 / 4 / 2 / 2 (11) | `plugins/cascade/hooks/sdd_gate.mjs` (`node`), `src/sdd/sdd_gate.ts`, `bin/install.mjs` | Synchronized `.mjs`/`.cjs` hooks, `commands/*.md`, `workflows/cascade-looper.mjs` |
| **F17** Self-Improving Looper & Telemetry | M5 | `f17_f20` | `rollback_and_gate` | `resilience_and_catalog` | `failure_rollback` | 3 / 3 / 3 / 2 (11) | `cascade.ts --log-dir` vs `--dry-run`, `MemoryStorage`, `HeartbeatWatchdog`, `snapshot.ts` | `src/core/self_improver.ts` (`.cascade/telemetry/*.jsonl`, directive derivation) |
| **F18** Bounded Pre-PR & Catalog CLI | M5 | `f17_f20` | `sdd_and_review` | `resilience_and_catalog` | — | 3 / 3 / 3 / 2 (11) | `src/integration/{catalog_generator,drift_detector,schema_validator}.ts` | Bounded pre-PR loop (`<= 3` rounds) + `--sync-catalog` / `doctor` CLI commands |
| **F19** CI/CD Workflow & Hygiene | M5 | `f17_f20` | `sdd_and_review` | `resilience_and_catalog` | `installer_and_sdd_hook` | 3 / 3 / 3 / 2 (11) | `openspec validate --strict` CLI in temp repo, `diagrams.ts` | `.github/workflows/ci.yml` validation, `.gitignore` rules for `.cascade/` & sandboxes |
| **F20** Final Cert, Docs & Dual-Runtime | M6 | `f17_f20` | `rollback_and_gate` | `sdd_gates_pipeline` | All Tier 4 journeys | 3 / 3 / 3 / 3 (12) | Full Phase A E2E suite on Bun + Node hook/installer subprocesses | Phase 1 (100% Tiers 1–4) + Phase 2 (Tier 5 Adversarial) on Bun 1.4+ & Node 24 LTS |
| **Cross-Cutting** | M1–M6 | — | Multi-gate boundary | Multi-feature matrix | 3 E2E user journeys | 0 / 2 / 4 / 4 (10) | Full cross-tier integration across all 14 E2E files | Full v2 cross-milestone certification |

**Planned Total:** 232 tests across Phase A + Phase B (59 T1 + 67 T2 + 60 T3 + 46 T4), plus Tier 5 adversarial slot in M6.

---

## 4. Phase A vs Phase B Behavioral Alignment Notes

Phase A tests strictly assert **actual current production behavior** (never speculative behavior). Known behavioral transitions slated for M1–M5 are tracked explicitly here so Phase B upgrades remain deterministic:

| Behavior Area | Current Repo Baseline (Post-M1) | Remaining Phase B Target (M2–M5) |
|---|---|---|
| Protected branch with `--dry-run` | M1 (F03) allows `--dry-run` inspection on protected branches (`exit 0`) while blocking mutating runs (`exit 2`). | Already active (verified in Tier 2 & Tier 4). |
| Invalid `--engine` CLI value | M1 (F02) `ConfigValidationError` handled fail-closed (`exit 2`). | Already active (verified in Tier 2). |
| Invalid numeric / boolean env vars | M1 (F02) fails closed (`ConfigValidationError`) on malformed strings (`"not-a-number"`, `"maybe"`), while blank strings fall back to defaults. | Already active (verified in Tier 2). |
| Package manager in `verifyCommands` | `platform.ts` `detectPackageManager` / `resolvePackageCommands` work standalone; M1/M2 loader wiring expands as `Facade` lands. | Full `CascadeFacade` dynamic PM verification resolution. |
| `cascade.ts` runtime support | `cascade.ts` runs via Bun (`bun run cascade.ts`). | M2 (F06): `ISpawner` enables `CascadeFacade` on both Bun 1.4+ and Node.js 24 LTS. |

---

## 5. Isolation, Cleanup & Hygiene Contract

1. **Temp Repositories (`test/e2e/helpers/temp_repo.ts`):**
   - `createTempGitRepo()` creates unique directories under `os.tmpdir()`, runs `git init` with local `user.name` / `user.email`, sets branch (`feat/e2e-test` by default), commits an initial `README.md`, and returns a synchronous `cleanup()` callback invoked inside `try/finally` or `afterEach`.
2. **Pre-existing `bun test` Workspace Mutation Caveat:**
   - Pre-existing unit test `test/gates/gate1_feedback.test.ts:582` instantiates `Gate1Reviewer` without `workspaceRoot`, writing to `.agents/teamwork/reviewer_INTEG-RUN-001/`.
   - **Rule for `test/e2e/`:** Every test invoking `Gate0MechanicalRunner`, `Gate1Reviewer`, `Gate2Challenger`, `Gate3Auditor`, `SubagentDispatcher`, `MemoryStorage`, or `RollbackStateBuffer` MUST explicitly pass `workspaceRoot: tempDir`, `repoRoot: tempDir`, `baseDir: tempDir`, or `cwd: tempDir`. Running `bun test test/e2e` MUST leave `git status --short` completely free of unintended tracked modifications.

---

## 6. Verification Commands

Run with `export PATH="$HOME/.bun/bin:$PATH"`:

```bash
bunx tsc --noEmit
bunx eslint .
bun test test/e2e
bun test
```
