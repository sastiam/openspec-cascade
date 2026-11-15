/**
 * `ISpawner` adapter over `node:child_process`, valid on Node.js 24 LTS and Bun.
 */
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import type { Readable } from "node:stream";
import { EXIT_CODE_CONSTANTS, RUNTIME_PROCESS_CONSTANTS } from "../config/constants";
import { BaseSpawner } from "./base_spawner";
import { emptyByteStream, normalizeExitStatus, superviseProcess, toDefinedEnv } from "./process_control";
import {
  SpawnError,
  type RuntimeName,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncResult,
  type SpawnedProcess,
} from "./types";

function toWebStream(stream: Readable | null): ReadableStream<Uint8Array> {
  if (stream === null) {
    return emptyByteStream();
  }
  const iterator: AsyncIterator<Buffer | string> = stream[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(typeof next.value === "string" ? encoder.encode(next.value) : new Uint8Array(next.value));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function errorCodeOf(error: Error): string {
  return "code" in error && typeof error.code === "string" ? error.code : RUNTIME_PROCESS_CONSTANTS.ERROR_CODE_NOT_FOUND;
}

export class NodeSpawner extends BaseSpawner {
  readonly runtime: RuntimeName = "node";

  spawn(argv: readonly string[], options: SpawnOptions = {}): SpawnedProcess {
    const [command, ...args] = argv;
    if (command === undefined) {
      throw new SpawnError(argv, RUNTIME_PROCESS_CONSTANTS.ERROR_CODE_NOT_FOUND, "spawn requires a non-empty argv");
    }
    const processGroup = (options.processGroup ?? true) && process.platform !== RUNTIME_PROCESS_CONSTANTS.WINDOWS_PLATFORM;
    const child = nodeSpawn(command, args, {
      cwd: options.cwd,
      env: toDefinedEnv(options.env),
      detached: processGroup,
      windowsHide: true,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", options.stdout ?? "pipe", options.stderr ?? "pipe"],
    });
    if (options.stdin !== undefined && child.stdin !== null) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin);
    }
    const rawExit = new Promise<number>((resolve, reject) => {
      child.once("error", (error) => {
        reject(new SpawnError(argv, errorCodeOf(error), `Failed to spawn "${command}": ${error.message}`));
      });
      child.once("close", (code, signal) => resolve(normalizeExitStatus(code, signal)));
    });
    const supervision = superviseProcess({
      pid: child.pid,
      rawExit,
      processGroup,
      killSignal: options.killSignal ?? RUNTIME_PROCESS_CONSTANTS.DEFAULT_KILL_SIGNAL,
      timeoutMs: options.timeoutMs,
      abortSignal: options.abortSignal,
    });
    return {
      pid: child.pid,
      argv,
      stdout: toWebStream(child.stdout),
      stderr: toWebStream(child.stderr),
      exitCode: supervision.exitCode,
      timedOut: supervision.timedOut,
      aborted: supervision.aborted,
      kill: supervision.kill,
    };
  }

  spawnSync(argv: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncResult {
    const [command, ...args] = argv;
    if (command === undefined) {
      throw new SpawnError(argv, RUNTIME_PROCESS_CONSTANTS.ERROR_CODE_NOT_FOUND, "spawnSync requires a non-empty argv");
    }
    const result = nodeSpawnSync(command, args, {
      cwd: options.cwd,
      env: toDefinedEnv(options.env),
      input: options.stdin,
      timeout: options.timeoutMs,
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.error !== undefined && result.status === null && result.signal === null) {
      return {
        exitCode: RUNTIME_PROCESS_CONSTANTS.EXIT_CODE_COMMAND_NOT_FOUND,
        stdout: "",
        stderr: result.error.message,
      };
    }
    const timedOut = result.error !== undefined && errorCodeOf(result.error) === "ETIMEDOUT";
    return {
      exitCode: timedOut ? EXIT_CODE_CONSTANTS.EXIT_CODE_TIMEOUT : normalizeExitStatus(result.status, result.signal),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}
