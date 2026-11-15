/**
 * Runtime-neutral process supervision shared by `BunSpawner` and `NodeSpawner`.
 *
 * Native runtime timeouts only signal the direct child; supervision here kills the
 * whole process group and escalates to `SIGKILL`, so both runtimes leave no orphans
 * and report identical exit codes.
 */
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { EXIT_CODE_CONSTANTS, RUNTIME_PROCESS_CONSTANTS } from "../config/constants";
import type { ProcessEnv, ProcessSignal, SpawnResult, SpawnedProcess } from "./types";

export interface KillOptions {
  readonly processGroup?: boolean;
  readonly platform?: NodeJS.Platform;
}

export interface SupervisionInput {
  readonly pid: number | undefined;
  readonly rawExit: Promise<number>;
  readonly processGroup: boolean;
  readonly killSignal: ProcessSignal;
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
}

export interface Supervision {
  readonly exitCode: Promise<number>;
  timedOut(): boolean;
  aborted(): boolean;
  kill(signal?: ProcessSignal): void;
}

/**
 * Maps a raw `(code, signal)` pair to a single POSIX-style exit code (`128 + signal number` when signalled).
 */
export function normalizeExitStatus(code: number | null, signal: string | null): number {
  if (code !== null) {
    return code;
  }
  if (signal !== null) {
    const signalNumber = (osConstants.signals as Record<string, number | undefined>)[signal];
    if (signalNumber !== undefined) {
      return RUNTIME_PROCESS_CONSTANTS.SIGNAL_EXIT_OFFSET + signalNumber;
    }
  }
  return EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
}

function isMissingProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === RUNTIME_PROCESS_CONSTANTS.ERROR_CODE_NO_PROCESS;
}

/**
 * Sends `signal` to a process (and its group on POSIX). Returns `false` when the process no longer exists.
 * On win32 the whole tree is terminated through `taskkill /T /F`.
 */
export function safelyKillProcess(
  pid: number | undefined,
  signal: ProcessSignal = RUNTIME_PROCESS_CONSTANTS.DEFAULT_KILL_SIGNAL,
  options: KillOptions = {},
): boolean {
  if (pid === undefined || pid <= 0) {
    return false;
  }
  const platform = options.platform ?? process.platform;
  if (platform === RUNTIME_PROCESS_CONSTANTS.WINDOWS_PLATFORM) {
    const result = nodeSpawnSync(
      RUNTIME_PROCESS_CONSTANTS.WINDOWS_TASKKILL,
      [...RUNTIME_PROCESS_CONSTANTS.WINDOWS_TASKKILL_FLAGS, String(pid)],
      { stdio: "ignore", windowsHide: true },
    );
    return result.status === EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
  }
  if (options.processGroup ?? true) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Applies timeout and abort supervision to a started process.
 */
export function superviseProcess(input: SupervisionInput): Supervision {
  let timedOut = false;
  let aborted = false;
  let settled = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;

  const terminate = (signal: ProcessSignal): void => {
    if (settled) {
      return;
    }
    safelyKillProcess(input.pid, signal, { processGroup: input.processGroup });
    if (escalationTimer === undefined && signal !== RUNTIME_PROCESS_CONSTANTS.FORCE_KILL_SIGNAL) {
      escalationTimer = setTimeout(() => {
        if (!settled) {
          safelyKillProcess(input.pid, RUNTIME_PROCESS_CONSTANTS.FORCE_KILL_SIGNAL, { processGroup: input.processGroup });
        }
      }, RUNTIME_PROCESS_CONSTANTS.KILL_GRACE_MS);
      escalationTimer.unref?.();
    }
  };

  const onAbort = (): void => {
    aborted = true;
    terminate(input.killSignal);
  };

  if (input.timeoutMs !== undefined && input.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate(input.killSignal);
    }, input.timeoutMs);
  }
  if (input.abortSignal?.aborted) {
    onAbort();
  } else {
    input.abortSignal?.addEventListener("abort", onAbort, { once: true });
  }

  const cleanup = (): void => {
    settled = true;
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (escalationTimer !== undefined) clearTimeout(escalationTimer);
    input.abortSignal?.removeEventListener("abort", onAbort);
  };

  const exitCode = input.rawExit.then(
    (code) => {
      cleanup();
      return timedOut ? EXIT_CODE_CONSTANTS.EXIT_CODE_TIMEOUT : code;
    },
    (error: unknown) => {
      cleanup();
      throw error;
    },
  );

  return {
    exitCode,
    timedOut: () => timedOut,
    aborted: () => aborted,
    kill: (signal) => terminate(signal ?? input.killSignal),
  };
}

/**
 * Builds the argv that runs `command` through the platform shell as a single, non-interpolated argument.
 */
export function shellArgv(command: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === RUNTIME_PROCESS_CONSTANTS.WINDOWS_PLATFORM) {
    return [RUNTIME_PROCESS_CONSTANTS.WINDOWS_SHELL, ...RUNTIME_PROCESS_CONSTANTS.WINDOWS_SHELL_FLAGS, command];
  }
  return [RUNTIME_PROCESS_CONSTANTS.POSIX_SHELL, RUNTIME_PROCESS_CONSTANTS.POSIX_SHELL_FLAG, command];
}

function isExecutableFile(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    if (platform !== RUNTIME_PROCESS_CONSTANTS.WINDOWS_PLATFORM) {
      accessSync(candidate, fsConstants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a binary on `PATH` (honouring `PATHEXT` on win32). Absolute or relative paths are checked directly.
 */
export function whichBinary(
  binary: string,
  envPath: string = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
  pathExt: string = process.env.PATHEXT ?? RUNTIME_PROCESS_CONSTANTS.WINDOWS_DEFAULT_PATHEXT,
): string | null {
  if (binary.length === 0) {
    return null;
  }
  const isWindows = platform === RUNTIME_PROCESS_CONSTANTS.WINDOWS_PLATFORM;
  const extensions = isWindows ? ["", ...pathExt.split(";").filter(Boolean)] : [""];
  if (isAbsolute(binary) || binary.includes("/") || (isWindows && binary.includes("\\"))) {
    return extensions.map((ext) => binary + ext).find((candidate) => isExecutableFile(candidate, platform)) ?? null;
  }
  const separator = isWindows ? ";" : delimiter;
  for (const directory of envPath.split(separator).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(directory, binary + ext);
      if (isExecutableFile(candidate, platform)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Sleeps for `ms`, rejecting with an `AbortError` when `signal` aborts first.
 */
export async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  await delay(Math.max(0, ms), undefined, signal === undefined ? undefined : { signal });
}

/**
 * Drops `undefined` values so runtimes never receive the literal string `"undefined"`.
 */
export function toDefinedEnv(env: ProcessEnv | undefined): Record<string, string> | undefined {
  if (env === undefined) {
    return undefined;
  }
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      defined[key] = value;
    }
  }
  return defined;
}

/**
 * Returns an already-closed byte stream, used for `"ignore"` stdio and failed spawns.
 */
export function emptyByteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

/**
 * Drains both output streams and awaits the normalized exit code.
 */
export async function collectProcess(spawned: SpawnedProcess): Promise<SpawnResult> {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(spawned.stdout).text(),
    new Response(spawned.stderr).text(),
    spawned.exitCode,
  ]);
  return { exitCode, stdout, stderr, timedOut: spawned.timedOut(), aborted: spawned.aborted() };
}
