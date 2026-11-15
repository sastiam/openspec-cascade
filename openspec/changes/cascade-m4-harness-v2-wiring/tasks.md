# Tasks: Milestone M4 (F14–F16)

## 1. Import Hygiene (F14)
- [x] 1.1 Extract `src/engine/contract.ts`, `src/integration/catalog_model.ts` and `src/gates/gate{0,1,2,3}_types.ts` with compatible re-exports.
- [x] 1.2 Add `test/architecture/import_cycles.test.ts` asserting zero cycles.

## 2. Harness Injector (F14)
- [ ] 2.1 Implement `src/core/harness_injector.ts` and `HARNESS_CONSTANTS`.
- [ ] 2.2 Add `test/core/harness_injector.test.ts`.

## 3. V2 Pipeline (F15)
- [ ] 3.1 Implement `src/facade/v2_pipeline.ts` and dispatch from `CascadeFacade` on `mode === "v2"`.
- [ ] 3.2 Add `test/facade/v2_pipeline.test.ts` (real git, real gates) and E2E coverage for `--mode v2`.

## 4. Plugin Sync (F16)
- [ ] 4.1 Implement `scripts/sync_plugin.ts`, generate `sdd_rules.json`, rewrite `sdd_gate.mjs`, add `sdd_gate.cjs`, update commands, workflow and `bin/install.mjs`.
- [ ] 4.2 Add drift and hook-parity tests; run the full verification suite on Bun and Node 24.
