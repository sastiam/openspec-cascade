# Design: Milestone M2 — Isomorphic Runtime, PAL Factory, Decorators & Facade

## Context

Bun 1.4 implements `node:child_process`, `node:timers/promises` and web streams, and Bun.spawn supports `detached` process groups at runtime. Node.js 24 LTS strips erasable TypeScript syntax natively but does not resolve extensionless relative specifiers (`import "./config"`), which this repository uses throughout.

## Decisions

### Decision 1: One `ISpawner` Port, Shared Supervision
- **Structure:** `src/runtime/types.ts` defines `ISpawner` (`runtime`, `detectRuntime`, `spawn`, `run`, `spawnSync`, `which`, `sleep`). `src/runtime/process_control.ts` holds runtime-neutral logic: `normalizeExitStatus`, `safelyKillProcess`, `superviseProcess` (timeout and abort handling with group kill and `SIGKILL` escalation after `RUNTIME_PROCESS_CONSTANTS.KILL_GRACE_MS`), `collectProcess`, `shellArgv` and `whichBinary`. `BunSpawner` and `NodeSpawner` only translate options to their native primitives.
- **Rationale:** Native `timeout` options in both runtimes kill only the direct child; supervising in shared code guarantees identical group-kill semantics and exit codes on both runtimes.

### Decision 2: Spawn Failures Reject `exitCode`
- **Structure:** A missing binary (`ENOENT`) rejects `SpawnedProcess.exitCode` with `SpawnError` (`code`, `argv`) in both runtimes; `Bun.spawn`'s synchronous throw is converted into the same rejection.
- **Rationale:** Callers handle one error channel regardless of runtime.

### Decision 3: Adapter Process Bridge Instead of Rewriting Adapters
- **Structure:** `toAdapterProcess(spawned)` maps `SpawnedProcess` to the `{ stdout, stderr, exited, kill }` shape that the existing PAL adapters and root engines consume. Default spawn functions in adapters call `getDefaultSpawner()`; existing `spawnFn` injection points remain.
- **Rationale:** Preserves the extensive adapter test suites while removing the Bun lock-in.

### Decision 4: Native Node 24 Execution via Resolve Hooks
- **Structure:** `scripts/node_ts_register.mjs` registers a synchronous `module.registerHooks` resolver that retries failed relative specifiers with `.ts` and `/index.ts`. `tsconfig.json` enables `erasableSyntaxOnly`; the `const enum` in `src/core/dag.ts` becomes an `as const` object. Node-only tests live in `test/node/*.node.ts` (outside `bun test` discovery) and use `node:test`.
- **Rationale:** No bundler or transpiler dependency; the same sources run on both runtimes.

### Decision 5: Factory + Bridge for Engine Unification
- **Structure:** `EngineFactory.create(engine, options)` returns a `UnifiedEngine` (`EngineAdapter` + `engineType` + `getProvider()`). `claude`, `opencode` and `antigravity` reuse the session-level root adapters; `gemini` is an alias of `antigravity`; `jules` is served by `PalEngineBridge` over `JulesAdapter`. `createProvider(engine)` returns the `IPalProvider` adapters with an injected spawner. `ENGINE_CONSTANTS.SUPPORTED_ENGINES` gains `jules`, and the CLI accepts `gemini` as an alias.
- **Rationale:** One creation point for both contracts; the v2 dispatcher (M4) consumes `getProvider()` while v1 consumes `runSession`.

### Decision 6: Decorators Compose Through Hooks
- **Structure:** `ResilientEngineDecorator` retries `error` outcomes and thrown non-fatal errors up to `maxRetries`, sleeping `min(maxDelay, base * 2^attempt) * random()` (full jitter) through the injected spawner, and logs `engine_retry` through the session hooks. Its circuit opens after `failureThreshold` consecutive failures and short-circuits with a `fatal` outcome (`circuit_open`) until `cooldownMs` elapses, then admits one half-open trial. `TelemetryMetricsDecorator` measures latency, counts `engine_retry` events, extracts token usage from logged events, classifies errors (`rate_limit`, `auth`, `timeout`, `circuit_open`, `budget`, `unknown`) and exposes `getSummary()`.
- **Rationale:** Decorators stay independent: telemetry observes resilience through the same hook stream the CLI uses for logging.

### Decision 7: Facade Owns Orchestration, CLI Stays Thin
- **Structure:** `CascadeFacade` (constructor dependencies: `spawner`, `engineFactory`, `output`) implements `run(config): Promise<CascadeRunResult>` with `exitCode`, `changes`, `tasks`, `rollbacks`, `telemetry`, `totalCostUsd` and `logFile`. Fail-closed errors (`ConfigValidationError`, `BudgetExceededError`, `ProtectedBranchError`, `Fatal`) map to exit `2`; unexpected errors to `1`. `cascade.ts` keeps `runCli`, `main` and re-exports of `parseTasks`, `verifyCommands`, `taskPrompt`, `runChecks`, `blockedReason`, `commitTypeOf`, `commitsPerSection`, `isLastOfSection` and `getKeepAliveController`.
- **Rationale:** The facade becomes the single orchestration entry point for v1 now and the v2 pipeline in M4.
