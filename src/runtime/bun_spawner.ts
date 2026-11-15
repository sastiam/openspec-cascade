/**
 * `ISpawner` adapter over the native `Bun.spawn` / `Bun.spawnSync` primitives.
 *
 * This is the only production module allowed to reference the Bun process API.
 */
import { EXIT_CODE_CONSTANTS, RUNTIME_PROCESS_CONSTANTS } from "../config/constants";
import { BaseSpawner } from "./base_spawner";
import { emptyByteStream, superviseProcess, toDefinedEnv } from "./process_control";
import {
  SpawnError,
  type RuntimeName,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncResult,
  type SpawnedProcess,
} from "./types";

interface BunSubprocessView {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array> | number | undefined | null;
  readonly stderr: ReadableStream<Uint8Array> | number | undefined | null;
  readonly exited: Promise<number>;
}

function asStream(value: ReadableStream<Uint8Array> | number | undefined | null): ReadableStream<Uint8Array> {
  return value instanceof ReadableStream ? value : emptyByteStream();
}

function bunRuntime(): typeof Bun {
  if (typeof globalThis.Bun === "undefined") {
    throw new SpawnError([], RUNTIME_PROCESS_CONSTANTS.ERROR_CODE_NOT_FOUND, "BunSpawner requires the Bun runtime");
  }
  return globalThis.Bun;
}

function spawnFailure(argv: readonly string[], error: unknown): SpawnedProcess {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : RUNTIME_PROCESS_CONSTANTS.ERROR_CODE_NOT_FOUND;
  const failure = Promise.reject(new SpawnError(argv, code, `Failed to spawn "${argv[0] ?? ""}": ${message}`));
  failure.catch(() => undefined);
  return {
    pid: undefined,
    argv,
    stdout: emptyByteStream(),
    stderr: emptyByteStream(),
    exitCode: failure,
    timedOut: () => false,
    aborted: () => false,
    kill: () => undefined,
  };
}

export class BunSpawner extends BaseSpawner {
  readonly runtime: RuntimeName = "bun";

  spawn(argv: readonly string[], options: SpawnOptions = {}): SpawnedProcess {
    if (argv.length === 0) {
      throw new SpawnError(argv, RUNTIME_PROCESS_CONSTANTS.ERROR_CODE_NOT_FOUND, "spawn requires a non-empty argv");
    }
    const processGroup = (options.processGroup ?? true) && process.platform !== RUNTIME_PROCESS_CONSTANTS.WINDOWS_PLATFORM;
    let subprocess: BunSubprocessView;
    try {
      const spawnOptions = {
        cwd: options.cwd,
        env: toDefinedEnv(options.env),
        stdin: options.stdin === undefined ? ("ignore" as const) : Buffer.from(options.stdin),
        stdout: options.stdout ?? "pipe",
        stderr: options.stderr ?? "pipe",
        detached: processGroup,
        windowsHide: true,
      };
      subprocess = bunRuntime().spawn([...argv], spawnOptions);
    } catch (error) {
      return spawnFailure(argv, error);
    }
    const supervision = superviseProcess({
      pid: subprocess.pid,
      rawExit: subprocess.exited,
      processGroup,
      killSignal: options.killSignal ?? RUNTIME_PROCESS_CONSTANTS.DEFAULT_KILL_SIGNAL,
      timeoutMs: options.timeoutMs,
      abortSignal: options.abortSignal,
    });
    return {
      pid: subprocess.pid,
      argv,
      stdout: asStream(subprocess.stdout),
      stderr: asStream(subprocess.stderr),
      exitCode: supervision.exitCode,
      timedOut: supervision.timedOut,
      aborted: supervision.aborted,
      kill: supervision.kill,
    };
  }

  spawnSync(argv: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncResult {
    try {
      const result = bunRuntime().spawnSync([...argv], {
        cwd: options.cwd,
        env: toDefinedEnv(options.env),
        stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
        stdout: "pipe",
        stderr: "pipe",
        timeout: options.timeoutMs,
      });
      const decoder = new TextDecoder();
      const timedOut = "exitedDueToTimeout" in result && result.exitedDueToTimeout === true;
      return {
        exitCode: timedOut ? EXIT_CODE_CONSTANTS.EXIT_CODE_TIMEOUT : result.exitCode ?? EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR,
        stdout: result.stdout ? decoder.decode(result.stdout) : "",
        stderr: result.stderr ? decoder.decode(result.stderr) : "",
      };
    } catch (error) {
      return {
        exitCode: RUNTIME_PROCESS_CONSTANTS.EXIT_CODE_COMMAND_NOT_FOUND,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
