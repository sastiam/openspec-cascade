/**
 * Cross-platform keep-alive and OS abstraction module.
 *
 * Prevents OS sleep during long-running tasks on macOS (via `caffeinate`)
 * and Linux (via `systemd-inhibit`), with graceful fallback when tools are
 * unavailable or permissions are restricted.
 */

import { existsSync } from "node:fs";
import { delimiter, normalize, resolve } from "node:path";

export const DEFAULT_SYSTEMD_INHIBIT_PATH = "/usr/bin/systemd-inhibit";
export const SYSTEMD_INHIBIT_WHAT = "idle:sleep";
export const SYSTEMD_INHIBIT_WHO = "openspec-cascade";
export const SYSTEMD_INHIBIT_WHY = "OpenSpec cascade tasks executing";
export const SYSTEMD_INHIBIT_HOLD_COMMAND = ["sleep", "infinity"] as const;

export const CAFFEINATE_BIN = "caffeinate";
export const CAFFEINATE_FLAG_IDLE = "-i";
export const CAFFEINATE_FLAG_WAIT_PID = "-w";

export const EXIT_CODE_SIGINT = 130;
export const EXIT_CODE_SIGTERM = 143;

export type KeepAliveMechanism = "caffeinate" | "systemd-inhibit" | "noop-fallback" | "disabled";

export interface KeepAliveController {
  readonly active: boolean;
  readonly mechanism: KeepAliveMechanism;
  stop(): void;
}

export interface ProcessSignalTarget {
  on(event: string, listener: (...args: any[]) => void): this | unknown;
  off?(event: string, listener: (...args: any[]) => void): this | unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): this | unknown;
  exit?(code?: number): void;
}

export interface KeepAliveChildProcess {
  kill(signal?: number | string): void;
}

export interface KeepAliveOptions {
  /** If false, disables keep-alive entirely. Default: true. */
  enabled?: boolean;
  /** Operating system platform. Default: process.platform. */
  platform?: NodeJS.Platform;
  /** Process ID to monitor (used by caffeinate on macOS). Default: process.pid. */
  pid?: number;
  /** Explicit path to systemd-inhibit binary. Default: auto-detected. */
  systemdInhibitPath?: string | null;
  /** If true, signal handlers will terminate the process. Default: true. */
  exitOnSignal?: boolean;
  /** Warning logger callback. Default: console.warn. */
  logWarning?: (message: string) => void;
  /** Target process emitter for lifecycle signals. Default: global process. */
  processTarget?: ProcessSignalTarget;
  /** Subprocess spawner. Default: Bun.spawn. */
  spawn?: (command: string[], options: { stdout: "ignore"; stderr: "ignore" }) => KeepAliveChildProcess;
  /** Synchronous subprocess runner for preflight checks. Default: Bun.spawnSync. */
  spawnSync?: (command: string[], options: { stdout: "ignore"; stderr: "pipe" }) => { exitCode: number; success?: boolean };
}

/**
 * Normalizes a file or directory path using standard node:path operations.
 */
export function normalizePlatformPath(filePath: string): string {
  return normalize(resolve(filePath));
}

/**
 * Checks if the platform is macOS (darwin).
 */
export function isMacOS(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

/**
 * Checks if the platform is Linux.
 */
export function isLinux(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux";
}

/**
 * Searches for an executable binary in the provided PATH string.
 */
export function resolveBinaryInPath(binaryName: string, envPath: string = process.env.PATH ?? ""): string | null {
  if (binaryName.startsWith("/") && existsSync(binaryName)) {
    return normalizePlatformPath(binaryName);
  }
  const dirs = envPath.split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = resolve(dir, binaryName);
    try {
      if (existsSync(full)) {
        return normalizePlatformPath(full);
      }
    } catch {
      // Ignore inaccessible directories in PATH
    }
  }
  return null;
}

/**
 * Resolves the systemd-inhibit binary path on Linux systems.
 */
export function findSystemdInhibit(envPath: string = process.env.PATH ?? ""): string | null {
  if (existsSync(DEFAULT_SYSTEMD_INHIBIT_PATH)) {
    return normalizePlatformPath(DEFAULT_SYSTEMD_INHIBIT_PATH);
  }
  return resolveBinaryInPath("systemd-inhibit", envPath);
}

/**
 * Checks whether systemd-inhibit is available and can acquire an inhibitor lock.
 */
export function canRunSystemdInhibit(
  binaryPath: string,
  spawnSyncFn: (command: string[], options: { stdout: "ignore"; stderr: "pipe" }) => { exitCode: number; success?: boolean } = Bun.spawnSync,
): boolean {
  try {
    const proc = spawnSyncFn([
      binaryPath,
      `--what=${SYSTEMD_INHIBIT_WHAT}`,
      `--who=${SYSTEMD_INHIBIT_WHO}`,
      `--why=${SYSTEMD_INHIBIT_WHY}`,
      "true",
    ], {
      stdout: "ignore",
      stderr: "pipe",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Builds the keep-alive CLI command array and mechanism for the given platform.
 */
export function buildKeepAliveArgs(options: {
  platform: NodeJS.Platform;
  pid: number;
  systemdInhibitPath?: string;
}): { command: string[]; mechanism: "caffeinate" | "systemd-inhibit" } | null {
  if (isMacOS(options.platform)) {
    return {
      command: [CAFFEINATE_BIN, CAFFEINATE_FLAG_IDLE, CAFFEINATE_FLAG_WAIT_PID, String(options.pid)],
      mechanism: "caffeinate",
    };
  }
  if (isLinux(options.platform)) {
    const bin = options.systemdInhibitPath ?? DEFAULT_SYSTEMD_INHIBIT_PATH;
    return {
      command: [
        bin,
        `--what=${SYSTEMD_INHIBIT_WHAT}`,
        `--who=${SYSTEMD_INHIBIT_WHO}`,
        `--why=${SYSTEMD_INHIBIT_WHY}`,
        ...SYSTEMD_INHIBIT_HOLD_COMMAND,
      ],
      mechanism: "systemd-inhibit",
    };
  }
  return null;
}

function removeEventListener(
  target: ProcessSignalTarget,
  event: string,
  listener: (...args: any[]) => void,
): void {
  if (typeof target.off === "function") {
    target.off(event, listener);
  } else if (typeof target.removeListener === "function") {
    target.removeListener(event, listener);
  }
}

function attachSignalHandlers(
  target: ProcessSignalTarget,
  onStop: () => void,
  exitOnSignal: boolean,
): () => void {
  const onSigInt = () => {
    onStop();
    if (exitOnSignal) {
      target.exit?.(EXIT_CODE_SIGINT);
    }
  };

  const onSigTerm = () => {
    onStop();
    if (exitOnSignal) {
      target.exit?.(EXIT_CODE_SIGTERM);
    }
  };

  const onExit = () => {
    onStop();
  };

  target.on("SIGINT", onSigInt);
  target.on("SIGTERM", onSigTerm);
  target.on("exit", onExit);

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    removeEventListener(target, "SIGINT", onSigInt);
    removeEventListener(target, "SIGTERM", onSigTerm);
    removeEventListener(target, "exit", onExit);
  };
}

/**
 * Starts a cross-platform sleep inhibitor and attaches lifecycle cleanup handlers.
 */
export function startKeepAlive(options: KeepAliveOptions = {}): KeepAliveController {
  const enabled = options.enabled ?? true;
  if (!enabled) {
    return {
      active: false,
      mechanism: "disabled",
      stop: () => {},
    };
  }

  const platform = options.platform ?? process.platform;
  const pid = options.pid ?? process.pid;
  const logWarning = options.logWarning ?? console.warn;
  const processTarget = options.processTarget ?? process;
  const spawnFn = options.spawn ?? Bun.spawn;
  const spawnSyncFn = options.spawnSync ?? Bun.spawnSync;

  let active = true;
  let childProc: KeepAliveChildProcess | null = null;
  let mechanism: KeepAliveMechanism = "noop-fallback";

  const detachSignals = attachSignalHandlers(
    processTarget,
    () => stopController(),
    options.exitOnSignal ?? true,
  );

  function stopController(): void {
    if (!active) return;
    active = false;
    detachSignals();
    if (childProc) {
      try {
        childProc.kill();
      } catch {
        // Subprocess already terminated
      }
      childProc = null;
    }
  }

  if (isMacOS(platform)) {
    const args = buildKeepAliveArgs({ platform, pid });
    if (args) {
      try {
        childProc = spawnFn(args.command, { stdout: "ignore", stderr: "ignore" });
        mechanism = "caffeinate";
      } catch (err) {
        logWarning(`caffeinate failed to spawn: ${err instanceof Error ? err.message : String(err)}, using noop-fallback`);
        mechanism = "noop-fallback";
      }
    }
  } else if (isLinux(platform)) {
    const bin = options.systemdInhibitPath ?? findSystemdInhibit();
    if (!bin) {
      logWarning("systemd-inhibit not found, falling back to noop-fallback keep-alive");
      mechanism = "noop-fallback";
    } else if (!canRunSystemdInhibit(bin, spawnSyncFn)) {
      logWarning("systemd-inhibit permission check failed, falling back to noop-fallback keep-alive");
      mechanism = "noop-fallback";
    } else {
      const args = buildKeepAliveArgs({ platform, pid, systemdInhibitPath: bin });
      if (args) {
        try {
          childProc = spawnFn(args.command, { stdout: "ignore", stderr: "ignore" });
          mechanism = "systemd-inhibit";
        } catch (err) {
          logWarning(`systemd-inhibit failed to spawn: ${err instanceof Error ? err.message : String(err)}, using noop-fallback`);
          mechanism = "noop-fallback";
        }
      }
    }
  } else {
    // Other OS defaults to noop-fallback
    mechanism = "noop-fallback";
  }

  return {
    get active() {
      return active;
    },
    get mechanism() {
      return mechanism;
    },
    stop: stopController,
  };
}
