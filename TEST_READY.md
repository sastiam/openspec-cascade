# E2E Test Readiness Report (`TEST_READY.md`)

> **Phase:** Phase A + Phase B (M1–M5) + Tier 5 adversarial hardening (M6) — certified on Bun 1.4.4 and Node.js 24.22.3
> **Branch:** `feat/cascade-looper-v2`
> **Policy:** zero mocks, zero stubs, zero reference harnesses in `test/e2e/` (enforced by `scripts/forensic_audit.ts`, alias-aware since M6)

---

## 1. Final Certification (verified 2026-11-15)

| Command | Exit | Result |
|---|---|---|
| `bunx tsc --noEmit` | `0` | `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` |
| `bunx eslint .` | `0` | zero errors/warnings (`no-explicit-any`, `no-magic-numbers`, explicit module boundary types) |
| `bun run scripts/forensic_audit.ts` | `0` | 64 files audited, 0 violations |
| `bun run scripts/sync_plugin.ts --check` | `0` | plugin SDD hook rules match `SDD_CONSTANTS` |
| `bunx openspec validate --all --strict` | `0` | 29 passed, 0 failed |
| `bun test test/e2e` | `0` | **115 pass, 0 fail, 491 `expect()`** across 18 files |
| `bun test` | `0` | **1953 pass, 0 fail, 9320 `expect()`** across 86 files |
| `npm run test:node` (Node 24.22.3) | `0` | **15 pass, 0 fail** (runtime, spawner, config, factory, facade dry run, Greptile shadow/cache, harness, v2 pipeline, self-improver, `doctor`, CLI `--help`/`--dry-run`/exit codes) |

Dual-runtime scope: the full suite uses `bun:test` and runs on Bun; Node.js 24 parity is certified by the dedicated `node:test` suite in `test/node/`, which executes the same production sources natively through `scripts/node_ts_register.mjs`.

---

## 2. E2E Inventory (`test/e2e/`)

| Tier | File | Tests |
|---|---|---:|
| 1 | `tier1_features/f01_f05_config_cli_lint.test.ts` | 7 |
| 1 | `tier1_features/f06_f09_runtime_pal_facade.test.ts` | 10 |
| 1 | `tier1_features/f10_f13_greptile_review.test.ts` | 6 |
| 1 | `tier1_features/f14_f16_harness_v2_plugins.test.ts` | 9 |
| 1 | `tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` | 5 |
| 2 | `tier2_boundaries/cli_config_boundaries.test.ts` | 7 |
| 2 | `tier2_boundaries/rollback_and_gate_boundaries.test.ts` | 7 |
| 2 | `tier2_boundaries/sdd_and_review_boundaries.test.ts` | 6 |
| 3 | `tier3_combinations/cli_stack_pm_combinations.test.ts` | 4 |
| 3 | `tier3_combinations/resilience_and_catalog_combinations.test.ts` | 4 |
| 3 | `tier3_combinations/sdd_gates_pipeline_combinations.test.ts` | 4 |
| 4 | `tier4_scenarios/dry_run_cascade_journey.test.ts` | 3 |
| 4 | `tier4_scenarios/failure_rollback_audit_journey.test.ts` | 2 |
| 4 | `tier4_scenarios/installer_and_sdd_hook_journey.test.ts` | 2 |
| 5 | `tier5_adversarial/anticheat_and_audit_evasion.test.ts` | 6 |
| 5 | `tier5_adversarial/filesystem_and_process.test.ts` | 12 |
| 5 | `tier5_adversarial/input_injection.test.ts` | 17 |
| 5 | `tier5_adversarial/redaction_bombs.test.ts` | 4 |
| **Total** | **18 files** | **115** |

Phase B coverage for M2–M5 landed in Tier 1 (real CLI on Bun: `--engine jules|gemini`, `--mode v2`, `doctor`, `drift`, `review`; real modules: `ISpawner`, `EngineFactory` + decorators, `CascadeFacade`, `ShadowCommitManager`, `GreptileReviewBridge`, `GreptileCache`, `HarnessInjector`, plugin `.mjs`/`.cjs` hooks, `SelfImprover`) and in Tier 5. Scenarios that need an agent to edit files (v2 checkpoint commits, Gate 3 veto of a cheating worker, rollback after exhausted retries, self-improvement directives reaching later prompts) are covered by integration tests in `test/facade/` and `test/core/` with a scripted engine, because the E2E policy forbids stubbing engines and no real LLM engine is available in CI. Tiers 2–4 keep their Phase A scope; the ~232-test target in `TEST_INFRA.md` was not reached (115 E2E tests plus 1838 unit/integration tests).

---

## 3. Tier 5 Findings Fixed in M6

| Probe | Finding | Fix |
|---|---|---|
| `--changes ../../etc` | Accepted; facade, pipeline and harness read files outside the repo | `ChangeIdSchema` allowlist (exit `2`), harness guard |
| ``Verify: `bun test; touch x` `` | Shell chaining executed from `tasks.md` | `isSafeVerifyCommand` drops spans with shell control operators |
| `import { mock as fake }` | E2E stub evaded the forensic audit | Alias-aware `e2e-stub` rule |
| `src/app.ts.` | SDD gate classified as non-production (Windows strips trailing dots) | Trailing dot/space normalization in TS gate and plugin hook core |
| Cheating in new untracked files | v2 Gate 3 received no diff; `git diff <baseline>` omits untracked files | `ShadowCommitManager.workingTreeDiff` feeds Gates 1–3 the complete diff |
