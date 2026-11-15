# Scope — E2E Testing Track (`sub_orch_e2e_1`)

## Phase A Deliverables (Current Milestone)
1. `TEST_INFRA.md` at repository root covering:
   - Architecture of the opaque-box E2E test suite (`test/e2e/helpers/` + `tier1_features/`, `tier2_boundaries/`, `tier3_combinations/`, `tier4_scenarios/`, `tier5_adversarial/` plan)
   - Coverage matrix mapping all 20 features (`F01–F20`) across Tiers 1–4 (~11 tests × 20 features + 10 cross-cutting = ~230 tests plan)
   - Phase A active opaque-box CLI/existing-module tests vs Phase B direct module-import tests gated on M1–M5 `DONE` status in `PROJECT.md`
   - Zero-stub / zero-mock guarantee and runtime isolation rules (temp dirs, temp git repos, process cleanup)
2. `test/e2e/helpers/cli_runner.ts` (and related opaque-box helpers like temp git repo / OpenSpec fixture builders):
   - Real subprocess runner executing `cascade.ts` via Bun (and Node where supported) in isolated temporary directories/git repositories
   - Clean environment isolation, timeout enforcement, structured stdout/stderr/exitCode capture, guaranteed temp cleanup
3. `test/e2e/` Tier 1–4 Opaque-Box Tests (Phase A):
   - Exercising real CLI (`cascade.ts` `--help`, `--dry-run`, invalid CLI flags/config overrides, env var overrides, protected branch guards, dirty working tree guards, OpenSpec artifact validation, package manager detection across npm/pnpm/yarn/bun, rollback safety, telemetry/logging paths) and existing real production modules (where already present in `src/` and root)
   - Zero fake stubs/reference harnesses
   - Zero broken static imports to unlanded M1–M5 modules
   - 100% compliant with `tsc --noEmit`, `eslint .`, and `bun test`
4. Status report / `TEST_READY.md` readiness (Phase A gate passage reported to parent `c2daf3a0e3806ea39f4fd8e1779b73da` to coordinate Phase B expansion as M1–M5 land in `PROJECT.md`).

## Strictly Out of Scope (Do Not Touch)
- `src/**`, root `*.ts`, `package.json`, `eslint.config.js`, `tsconfig.json`, `openspec/**`
- `git commit`, `git push`, `git checkout` on main workspace repo (only create/manipulate isolated temp git repos under `os.tmpdir()` inside tests!)
