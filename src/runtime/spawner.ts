/**
 * Spawner selection and process-wide default instance.
 */
import { BunSpawner } from "./bun_spawner";
import { detectRuntime } from "./base_spawner";
import { NodeSpawner } from "./node_spawner";
import type { ISpawner, RuntimeName, SpawnedProcess } from "./types";

let defaultSpawner: ISpawner | undefined;

/**
 * Creates a spawner for the requested runtime, defaulting to the current one.
 */
export function createSpawner(runtime: RuntimeName = detectRuntime()): ISpawner {
  return runtime === "bun" ? new BunSpawner() : new NodeSpawner();
}

/**
 * Returns the lazily created process-wide spawner for the current runtime.
 */
export function getDefaultSpawner(): ISpawner {
  defaultSpawner ??= createSpawner();
  return defaultSpawner;
}

/**
 * Replaces the process-wide spawner (for example to inject a sandboxed spawner). Passing `undefined` resets it.
 */
export function setDefaultSpawner(spawner: ISpawner | undefined): void {
  defaultSpawner = spawner;
}

/**
 * Process shape consumed by the PAL adapters and root engines (`stdout`, `stderr`, `exited`, `kill`).
 */
export interface AdapterProcess {
  readonly pid: number | undefined;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill(signal?: number | string): void;
}

/**
 * Bridges a `SpawnedProcess` to the adapter process shape.
 */
export function toAdapterProcess(spawned: SpawnedProcess): AdapterProcess {
  return {
    pid: spawned.pid,
    stdout: spawned.stdout,
    stderr: spawned.stderr,
    exited: spawned.exitCode,
    kill: (signal) => spawned.kill(typeof signal === "string" ? (signal as NodeJS.Signals) : undefined),
  };
}
