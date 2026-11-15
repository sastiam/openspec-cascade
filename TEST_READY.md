# E2E Test Readiness Report (`TEST_READY.md`)

> **Track:** E2E Testing Track (`sub_orch_e2e_2` — Iteration 2)  
> **Phase:** **Phase A Complete & Certified** (Ready for Phase B milestone expansion as M2–M5 mark `DONE` in `PROJECT.md`)  
> **Target Branch:** `feat/cascade-looper-v2`

---

## 1. Verification Gate Summary (Verified 2026-11-15)

| Verification Command | Exit Code | Result Summary |
|---|---|---|
| `bunx tsc --noEmit` | `0` | Zero TypeScript errors across `src/**`, root `*.ts`, and `test/e2e/**` (`strict: true`, `noUncheckedIndexedAccess: true`) |
| `bunx eslint .` | `0` | Zero ESLint errors or warnings (enforces `@typescript-eslint/no-magic-numbers` on `helpers/*.ts`, `@typescript-eslint/explicit-module-boundary-types`, zero `any`) |
| `bun test test/e2e` | `0` | **64 pass, 0 fail, 349 `expect()` calls** across **14 test files** (`[21.78s]`) |
| `bun test` | `0` | **1757 pass, 0 fail, 8601 `expect()` calls** across **65 test files** (`[27.82s]`) |

---

## 2. Implemented E2E Infrastructure & Test Inventory

### Helpers (`test/e2e/helpers/`)
| File | Purpose |
|---|---|
| `test/e2e/helpers/constants.ts` | Centralized `E2E_CONSTANTS` (entrypoint paths, exit codes `0`/`1`/`2`, subprocess/test timeouts, temp dir prefixes, git author config, branch defaults) |
| `test/e2e/helpers/cli_runner.ts` | Real subprocess runners (`runCascadeCli`, `runNodeScript`, `runOpenSpecCli`, `buildIsolatedEnv`) with stripped `CASCADE_*` inheritance, isolated `HOME`/`XDG_CACHE_HOME`, and `SIGKILL` timeout cleanup |
| `test/e2e/helpers/temp_repo.ts` | Isolated `os.tmpdir()` git repository builder (`createTempGitRepo`, `addOpenSpecChange`, `runGitCommand`, `cleanupTempDir`) |

### Test Suites (`14` files, `64` E2E tests)
| Tier | File | Tests | Real Modules / CLIs Exercised |
|---|---|---:|---|
| **Tier 1 — Features** | `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts` | 7 | `cascade.ts --help/-h/--dry-run`, `config.ts`, `platform.ts`, `ESLint` |
| **Tier 1 — Features** | `test/e2e/tier1_features/f06_f09_runtime_pal_facade.test.ts` | 7 | `platform.ts`, `qa.ts`, `engine.ts`, `PalNormalizer`, `InMemoryMcpClient`, `PalToolDispatcher`, `react_parser.ts`, `cascade.ts --engine` |
| **Tier 1 — Features** | `test/e2e/tier1_features/f10_f13_greptile_review.test.ts` | 3 | `src/sdd/review_verifier.ts`, real `git merge-base` + `git diff --name-only` |
| **Tier 1 — Features** | `test/e2e/tier1_features/f14_f16_harness_v2_plugins.test.ts` | 5 | `cascade.ts` task parsing/prompting, `skills.ts`, `analyze.ts`, `openspec validate --strict`, `surface_verifier.ts`, `sdd_gate.ts`, `sdd_gate.mjs`, `bin/install.mjs` |
| **Tier 1 — Features** | `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` | 3 | `TaskCatalogGenerator`, `detectCatalogDrift`, `schema_validator.ts`, `diagrams.ts`, `MemoryStorage` |
| **Tier 2 — Boundaries** | `test/e2e/tier2_boundaries/cli_config_boundaries.test.ts` | 7 | Invalid `--changes`/`--engine`, protected branches (`main`/`master`/`stable`) mutating vs `--dry-run`, dirty working tree + `neverCommit`, Zod `ConfigValidationError`, subprocess timeout kill |
| **Tier 2 — Boundaries** | `test/e2e/tier2_boundaries/sdd_and_review_boundaries.test.ts` | 6 | `sdd_gate.mjs` blocks/exemptions/bypass/malformed stdin, `evaluateSddGate`, `analyzeChangeArtifacts` blocking checks, `verifyReviewFindings` stale/empty/mismatch, `openspec validate --strict` failures |
| **Tier 2 — Boundaries** | `test/e2e/tier2_boundaries/rollback_and_gate_boundaries.test.ts` | 7 | `RollbackStateBuffer` rollback/commit, `Gate0MechanicalRunner`, `Gate1Reviewer` + rubric, `Gate2EdgeCaseSynthesizer`, `Gate3AntiCheatScanner`, `MemoryStorage` `ProtectedSectionError` |
| **Tier 3 — Combinations** | `test/e2e/tier3_combinations/cli_stack_pm_combinations.test.ts` | 4 | CLI > env precedence matrix, lockfile priority matrix (`pnpm`/`npm`/`yarn`/`bun`), `ARCHIFY_BIN` precedence, temp repo lockfile matrix |
| **Tier 3 — Combinations** | `test/e2e/tier3_combinations/sdd_gates_pipeline_combinations.test.ts` | 4 | `analyze` + `sdd_gate` + `surface_verifier`, Gate 0–3 clean repo evaluation, `DirectedAcyclicGraph` + `DagLevelBatchResolver` + `LooperFSM` + `VictoryAuditLivelockPrevention`, `SubagentDispatcher` + `DynamicEscalationLadder` |
| **Tier 3 — Combinations** | `test/e2e/tier3_combinations/resilience_and_catalog_combinations.test.ts` | 4 | `TaskCatalogGenerator` + `assertNoDrift` + `SchemaValidationError`, `MemoryStorage` + `HeartbeatWatchdog`, `runVerificationPhase` multi-failure aggregation, `snapshot.ts` handoff round-trip |
| **Tier 4 — Scenarios** | `test/e2e/tier4_scenarios/dry_run_cascade_journey.test.ts` | 3 | Multi-change `--dry-run` cascade journey, protected-branch -> feature-branch transition journey, dirty working tree `--dry-run` non-mutation journey |
| **Tier 4 — Scenarios** | `test/e2e/tier4_scenarios/installer_and_sdd_hook_journey.test.ts` | 2 | Full SDD hook lifecycle (block -> strict scaffold -> allow -> block on completion), `bin/install.mjs --yes` isolated `CLAUDE_CONFIG_DIR` provisioning |
| **Tier 4 — Scenarios** | `test/e2e/tier4_scenarios/failure_rollback_audit_journey.test.ts` | 2 | Gate 3 binary veto -> `RollbackStateBuffer` atomic recovery preserving `.agents/teamwork/` & `logs/`, pre-PR `git merge-base` diff + surface + review verification |
| **Tier 5 — Adversarial** | `test/e2e/tier5_adversarial/README.md` | — | Reserved Phase 2 / M6 adversarial hardening slot |
| **Total** | **14 test files + 4 infra/helper docs** | **64** | **Zero mocks / zero stubs / 100% isolated `os.tmpdir()` execution** |

---

## 3. Observed Production Baseline Alignment (Post-M1)

Real CLI and config execution during Phase A E2E testing verified that M1 (`src/config/schemas.ts`, `src/config/loader.ts`) is already active on the working branch:
- Invalid `--engine` CLI values exit **`2`** (`ConfigValidationError`).
- Protected branches (`main`, `master`, `stable`) block mutating runs with exit **`2`** while permitting `--dry-run` inspection (`exit 0`).
- `loadConfig` fails closed (`ConfigValidationError`) on non-numeric/non-boolean env strings (`CASCADE_MAX_TURNS="not-a-number"`, `CASCADE_DRY_RUN="maybe"`), while blank numeric env strings (`"   "`, `""`) fall back to centralized defaults.

---

## 4. Phase B Expansion Gate Checklist (`PROJECT.md` M2–M5)

Expand the existing 14 test files (and populate `test/e2e/tier5_adversarial/` in M6) as each milestone transitions to **`DONE`** in `PROJECT.md`:

- [x] **M1 (`F01–F05`):** Config schemas, guardrails, strict CLI validation, ESLint magic-number enforcement (M1 `src/config/*` modules are active and verified on the working tree; `PROJECT.md` formally tracks `M1` as `IN_PROGRESS` pending final milestone closure).
- [ ] **M2 (`F06–F09`):** Gate on `src/runtime/*` (`ISpawner`, `BunSpawner`, `NodeSpawner`), `src/pal/factory.ts`, `src/decorators/*`, `src/facade/cascade_facade.ts` -> add dual-runtime Bun + Node 24 LTS CLI execution & resilience/telemetry decorator E2E coverage.
- [ ] **M3 (`F10–F13`):** Gate on `src/integration/greptile/*` (`client.ts`, `shadow.ts`, `cache.ts`, `search.ts`, `bridge.ts`) -> add isolated `GIT_INDEX_FILE` shadow commit & `.cascade/cache/greptile/` E2E coverage.
- [ ] **M4 (`F14–F16`):** Gate on `src/core/harness_injector.ts`, `--mode v1|v2` in `CascadeFacade`, synchronized plugin `.mjs`/`.cjs`/workflow assets -> add full v2 looper pipeline CLI E2E coverage.
- [ ] **M5 (`F17–F19`):** Gate on `src/core/self_improver.ts`, `--sync-catalog` / `doctor` CLI commands, `.github/workflows/ci.yml` -> add telemetry directive & catalog CLI E2E coverage.
- [ ] **M6 (`F20` + Tier 5):** Dual-runtime final certification + adversarial hardening probes in `test/e2e/tier5_adversarial/`.
