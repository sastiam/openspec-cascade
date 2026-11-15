# Tasks: Milestone M2 (F06–F09)

## 1. Isomorphic Runtime (F06)
- [x] 1.1 Add `RUNTIME_PROCESS_CONSTANTS` and implement `src/runtime/{types,process_control,bun_spawner,node_spawner,spawner,index}.ts`.
- [x] 1.2 Add `test/runtime/spawner.test.ts` running the shared contract against both `BunSpawner` and `NodeSpawner` (output, timeout group kill, abort, ENOENT, which, sleep, shellArgv).
- [x] 1.3 Migrate every production `Bun.spawn`/`Bun.spawnSync`/`Bun.sleep` site to `ISpawner` and add a static regression test.
- [x] 1.4 Add `scripts/node_ts_register.mjs`, enable `erasableSyntaxOnly`, replace the `const enum` in `src/core/dag.ts`, and add `test/node/*.node.ts` for Node 24.

## 2. PAL Factory & Adapter Unification (F07)
- [x] 2.1 Implement `src/pal/shared.ts` and deduplicate failure classification in `opencode.ts` and `antigravity.ts`.
- [x] 2.2 Implement `src/pal/factory.ts` (`EngineFactory`, `PalEngineBridge`, `createProvider`) and add `jules` plus the `gemini` alias to engine configuration.
- [x] 2.3 Close `looper-pal-jules-adapter` task `1.2` with documented headless authentication findings.
- [x] 2.4 Add `test/pal/factory.test.ts`.

## 3. Decorators (F08)
- [x] 3.1 Implement `src/decorators/{resilient_engine,telemetry_metrics,index}.ts`.
- [x] 3.2 Add `test/decorators/*.test.ts` covering retry, jitter bounds, non-retryable outcomes, circuit open/half-open, and telemetry aggregation.

## 4. CascadeFacade (F09)
- [x] 4.1 Move task helpers to `src/facade/tasks.ts` and implement `src/facade/{cascade_facade,index}.ts`.
- [x] 4.2 Reduce `cascade.ts` to a thin CLI adapter preserving exports and exit codes.
- [x] 4.3 Add `test/facade/cascade_facade.test.ts` and expand E2E Tier 1/2 coverage for F06–F09 including Node 24 CLI execution.
- [x] 4.4 Run `bun test`, `bunx tsc --noEmit`, `bunx eslint .`, `bun run scripts/forensic_audit.ts` and the Node 24 suite.
