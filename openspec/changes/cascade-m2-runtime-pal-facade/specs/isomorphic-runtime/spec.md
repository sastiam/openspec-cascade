# Spec: Isomorphic Runtime

## ADDED Requirements

### Requirement: ISpawner Port With Bun and Node Adapters
The system MUST provide an `ISpawner` port implemented by `BunSpawner` and `NodeSpawner` exposing `spawn`, `run`, `spawnSync`, `which`, `sleep` and `detectRuntime` with identical observable behavior on Bun 1.4+ and Node.js 24 LTS.

#### Scenario: Run collects output and exit code
- **WHEN** `run(["sh", "-c", "printf out; printf err >&2; exit 3"])` executes on either spawner
- **THEN** it resolves `{ exitCode: 3, stdout: "out", stderr: "err", timedOut: false, aborted: false }`

#### Scenario: Timeout kills the whole process group
- **WHEN** a command spawning a background grandchild exceeds `timeoutMs`
- **THEN** the process group is terminated, `timedOut` is `true`, the exit code is `124`, and no grandchild survives

#### Scenario: Abort signal terminates the process
- **WHEN** the provided `AbortSignal` is aborted while the process runs
- **THEN** the process group is killed and the result reports `aborted: true`

#### Scenario: Missing binary rejects with SpawnError
- **WHEN** `spawn(["definitely-missing-binary"])` is called
- **THEN** `exitCode` rejects with `SpawnError` whose `code` is `"ENOENT"`

### Requirement: Shell Commands Never Interpolate
The system MUST execute shell command strings only through `shellArgv(command)`, passing the whole command as a single argv element (`sh -c <command>` on POSIX, `cmd.exe /d /s /c <command>` on win32).

#### Scenario: Shell argv per platform
- **WHEN** `shellArgv("bun test", "linux")` and `shellArgv("bun test", "win32")` are called
- **THEN** they return `["sh", "-c", "bun test"]` and `["cmd.exe", "/d", "/s", "/c", "bun test"]`

### Requirement: Zero Direct Bun API Usage In Production
The system MUST route every production subprocess and sleep through `ISpawner`, leaving `src/runtime/bun_spawner.ts` as the only production file referencing `Bun.spawn`, `Bun.spawnSync` or `Bun.sleep`.

#### Scenario: Static scan finds no Bun API calls
- **WHEN** production TypeScript files are scanned for `Bun.spawn`, `Bun.spawnSync` and `Bun.sleep`
- **THEN** only `src/runtime/bun_spawner.ts` matches

### Requirement: Native Node 24 Execution
The system MUST run its TypeScript sources on Node.js 24 LTS through `scripts/node_ts_register.mjs` and MUST restrict sources to erasable TypeScript syntax.

#### Scenario: CLI help under Node
- **WHEN** `node --import ./scripts/node_ts_register.mjs cascade.ts --help` runs on Node 24
- **THEN** it prints the usage text and exits `0`
