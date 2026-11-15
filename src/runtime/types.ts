/**
 * Isomorphic process runtime contracts.
 *
 * Every subprocess, sleep and binary lookup in openspec-cascade goes through the
 * `ISpawner` port so the same code runs on Bun 1.4+ and Node.js 24 LTS.
 */

export type RuntimeName = "bun" | "node";

export type ProcessSignal = NodeJS.Signals;

export type ProcessEnv = Readonly<Record<string, string | undefined>>;

export type StdioMode = "pipe" | "ignore";

export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: ProcessEnv;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly stdin?: string | Uint8Array;
  readonly stdout?: StdioMode;
  readonly stderr?: StdioMode;
  readonly killSignal?: ProcessSignal;
  /** Spawns the child as a process-group leader on POSIX so kills reach grandchildren. Defaults to `true`. */
  readonly processGroup?: boolean;
}

export interface SpawnedProcess {
  readonly pid: number | undefined;
  readonly argv: readonly string[];
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  /** Normalized exit code: the real code, `128 + signal` when signalled, `124` on timeout. Rejects with `SpawnError` when the process cannot start. */
  readonly exitCode: Promise<number>;
  timedOut(): boolean;
  aborted(): boolean;
  kill(signal?: ProcessSignal): void;
}

export interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

export interface SpawnSyncOptions {
  readonly cwd?: string;
  readonly env?: ProcessEnv;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

export interface SpawnSyncResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runtime-agnostic process port.
 */
export interface ISpawner {
  readonly runtime: RuntimeName;
  detectRuntime(): RuntimeName;
  spawn(argv: readonly string[], options?: SpawnOptions): SpawnedProcess;
  run(argv: readonly string[], options?: SpawnOptions): Promise<SpawnResult>;
  spawnSync(argv: readonly string[], options?: SpawnSyncOptions): SpawnSyncResult;
  which(binary: string, envPath?: string): string | null;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/**
 * Raised when a subprocess cannot be started (for example a missing binary).
 */
export class SpawnError extends Error {
  readonly code: string;
  readonly argv: readonly string[];

  constructor(argv: readonly string[], code: string, message: string) {
    super(message);
    this.name = "SpawnError";
    this.code = code;
    this.argv = argv;
  }
}
