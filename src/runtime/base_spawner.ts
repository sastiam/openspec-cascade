/**
 * Shared `ISpawner` behavior; concrete runtimes only implement process creation.
 */
import { abortableSleep, collectProcess, whichBinary } from "./process_control";
import type {
  ISpawner,
  RuntimeName,
  SpawnOptions,
  SpawnResult,
  SpawnSyncOptions,
  SpawnSyncResult,
  SpawnedProcess,
} from "./types";

/**
 * Returns `"bun"` when the Bun global is present, otherwise `"node"`.
 */
export function detectRuntime(): RuntimeName {
  return typeof globalThis.Bun !== "undefined" ? "bun" : "node";
}

export abstract class BaseSpawner implements ISpawner {
  abstract readonly runtime: RuntimeName;

  abstract spawn(argv: readonly string[], options?: SpawnOptions): SpawnedProcess;

  abstract spawnSync(argv: readonly string[], options?: SpawnSyncOptions): SpawnSyncResult;

  detectRuntime(): RuntimeName {
    return detectRuntime();
  }

  run(argv: readonly string[], options?: SpawnOptions): Promise<SpawnResult> {
    return collectProcess(this.spawn(argv, options));
  }

  which(binary: string, envPath?: string): string | null {
    return whichBinary(binary, envPath);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return abortableSleep(ms, signal);
  }
}
