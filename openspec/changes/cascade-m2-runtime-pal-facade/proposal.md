# Proposal: Milestone M2 — Isomorphic Runtime, PAL Factory, GoF Decorators & CascadeFacade

## Why

`openspec-cascade` is locked to Bun: fourteen production sites call `Bun.spawn`, `Bun.spawnSync` or `Bun.sleep` directly (root `cascade.ts`, `qa.ts`, `platform.ts`, `opencode.ts`, `antigravity.ts`, `src/engine/rollback_buffer.ts`, `src/pal/adapters/{opencode,gemini,jules}.ts`, `src/gates/{gate0_qa,gate1_review,gate2_challenger,gate2_injector,gate3_audit}.ts`). Subprocess timeouts only kill the direct child, leaving grandchildren alive. Engine selection is a hard-coded record in `engine.ts` that cannot reach the v2 `IPalProvider` adapters (notably Jules). Resilience (retry/backoff/circuit breaking) and telemetry are absent at the engine boundary, and `cascade.ts` mixes CLI parsing with ~600 lines of orchestration, preventing reuse by the v2 pipeline (M4).

## What Changes

1. **F06 — `src/runtime/`**: `ISpawner` port with `BunSpawner` (native `Bun.spawn`) and `NodeSpawner` (`node:child_process`) adapters; POSIX process-group isolation, `safelyKillProcess` (group kill, `SIGTERM` → grace → `SIGKILL`, `taskkill /T` on win32), `AbortSignal` + `timeoutMs` supervision (exit `124` on timeout), normalized exit codes (`128 + signal`), `which`, abortable `sleep`, and `shellArgv` (the command string is passed as one argv element, never interpolated). Every direct `Bun.*` production site migrates to the port. Node 24 LTS executes the TypeScript sources natively through `scripts/node_ts_register.mjs` (extensionless-specifier resolution) with `erasableSyntaxOnly` enforced by `tsconfig.json`.
2. **F07 — `src/pal/factory.ts`**: `EngineFactory` creating `UnifiedEngine` instances for `claude`, `opencode`, `antigravity`/`gemini` and `jules`, plus `createProvider` for the four `IPalProvider` adapters with an injected `ISpawner`; `PalEngineBridge` adapts any `IPalProvider` to the session-level `EngineAdapter` contract so `--engine jules` works end to end. Shared failure classification and record guards move to `src/pal/shared.ts`. `looper-pal-jules-adapter` task `1.2` (headless authentication research) is closed.
3. **F08 — `src/decorators/`**: `ResilientEngineDecorator` (bounded retries with exponential backoff + full jitter and a closed/open/half-open circuit breaker) and `TelemetryMetricsDecorator` (latency, cost, turns, tokens, retries, error categories, aggregate summary), both implementing `UnifiedEngine` and composing transparently.
4. **F09 — `src/facade/`**: `CascadeFacade.run(config)` owns preflight, dry-run planning, keep-alive, engine construction (factory + decorators), task execution, verification, commits and `RollbackStateBuffer`, returning a structured `CascadeRunResult`. Task helpers move to `src/facade/tasks.ts`; `cascade.ts` becomes a thin CLI adapter that re-exports its historical API.

## Definition of Done

- `bunx openspec validate cascade-m2-runtime-pal-facade --strict` exits `0`.
- Zero direct `Bun.spawn`/`Bun.spawnSync`/`Bun.sleep` calls in production files outside `src/runtime/bun_spawner.ts`.
- `bun test`, `bunx tsc --noEmit`, `bunx eslint .` and `bun run scripts/forensic_audit.ts` exit `0`.
- `node --import ./scripts/node_ts_register.mjs --test test/node/*.node.ts` passes on Node.js 24 LTS, and `cascade.ts --help` / `--dry-run` run under Node 24.
