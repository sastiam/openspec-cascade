# Design: Cross-Platform Keep-Alive & Engine Integration

## Context

Running tasks 24/7 overnight requires preventing system idle sleep. Currently, users must manually prefix the runner invocation with OS-specific tools (such as `caffeinate -i`). To provide a reliable, zero-configuration autonomous execution loop, `cascade.ts` needs a built-in cross-platform OS abstraction module (`platform.ts`) supporting macOS and Linux.

## Decisions

### 1. `KeepAliveController` Abstraction (`platform.ts`)

`platform.ts` exposes a clean interface to manage system sleep inhibitors:

```typescript
export interface KeepAliveController {
  readonly active: boolean;
  readonly mechanism: "caffeinate" | "systemd-inhibit" | "noop-fallback" | "disabled";
  stop(): void;
}
```

- **macOS (`darwin`)**: Spawns `caffeinate -i -w <pid>` where `<pid>` is the current process PID (`process.pid`). macOS natively links `caffeinate` to the parent process lifetime, guaranteeing that even on abrupt crashes, caffeinate terminates.
- **Linux (`linux`)**: Checks for `/usr/bin/systemd-inhibit` (or via `PATH`) and spawns `systemd-inhibit --what=idle:sleep --who="openspec-cascade" --why="OpenSpec cascade tasks executing" <hold_command>`.
  - **Graceful Fallback**: If `systemd-inhibit` is missing or fails due to permissions (e.g., container, WSL, headless environment without systemd/dbus), logs a warning (`console.warn`) and returns a `noop-fallback` controller so execution proceeds uninterrupted.
- **Other OS**: Defaults to `noop-fallback` without crashing.

### 2. Lifecycle & Signal Hooks

`startKeepAlive()` automatically attaches cleanup handlers to:
- `process.on("SIGINT", ...)`
- `process.on("SIGTERM", ...)`
- `process.on("exit", ...)`

Calling `controller.stop()` explicitly terminates the background subprocess and deregisters listeners.

### 3. CLI Integration in `cascade.ts`

- Keep-alive is enabled **by default** when `cascade.ts` starts.
- A `--no-keep-alive` CLI flag allows users to disable automatic inhibitor spawning when desired.
- When `cascade.ts` finishes (or fails), `keepAlive.stop()` is invoked in the shutdown phase.

### 4. Cross-Platform Path Normalization

Path manipulations in `platform.ts` and `cascade.ts` rely strictly on `node:path` (`resolve`, `join`, `normalize`) to eliminate platform-dependent directory separator bugs.
