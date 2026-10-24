/**
 * 24/7 failure resilience and git rollback state buffer module for openspec-cascade.
 *
 * Provides working tree state capture, snapshotting, and atomic git rollback
 * to ensure that failed task attempts cleanly revert changes without leaving dirty
 * working tree artifacts, enabling resilient 24/7 autonomous task execution.
 */

import { CONSTANTS } from "./config";
import { defaultCommandRunner, type CommandRunner, type CommandRunnerResult } from "./qa";

export type { CommandRunner, CommandRunnerResult };

export interface GitWorkingTreeState {
  headSha: string;
  isDirty: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
}

export interface CaptureGitStateOptions {
  cwd?: string;
  timeoutMs?: number;
  runner?: CommandRunner;
}

export interface RollbackOptions {
  cwd?: string;
  targetRef?: string;
  cleanUntracked?: boolean;
  excludes?: readonly string[] | string[];
  timeoutMs?: number;
  runner?: CommandRunner;
  hooks?: {
    say?: (message: string) => void;
    log?: (event: string, data: Record<string, unknown>) => void;
  };
}

export interface RollbackResult {
  success: boolean;
  targetRef: string;
  resetOutput: string;
  cleanOutput: string;
  error?: string;
}

export interface RollbackBufferOptions {
  cwd?: string;
  excludes?: readonly string[] | string[];
  timeoutMs?: number;
  runner?: CommandRunner;
  hooks?: {
    say?: (message: string) => void;
    log?: (event: string, data: Record<string, unknown>) => void;
  };
}

/**
 * Builds the git clean command line with optional exclude patterns.
 */
export function buildGitCleanCommand(excludes?: readonly string[] | string[]): string {
  if (!excludes || excludes.length === 0) {
    return CONSTANTS.GIT_CLEAN_CMD;
  }
  const flags = excludes
    .filter((pat) => Boolean(pat && pat.trim()))
    .map((pat) => `-e "${pat.trim()}"`)
    .join(" ");
  return flags ? `${CONSTANTS.GIT_CLEAN_CMD} ${flags}` : CONSTANTS.GIT_CLEAN_CMD;
}

/**
 * Captures the current git state: HEAD SHA, dirty status, untracked, and modified files.
 */
export async function captureGitState(options: CaptureGitStateOptions = {}): Promise<GitWorkingTreeState> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? CONSTANTS.COMMAND_TIMEOUT_MS;
  const runner = options.runner ?? defaultCommandRunner;

  let headSha: string = CONSTANTS.GIT_HEAD_REF;
  const revRes = await runner(CONSTANTS.GIT_REV_PARSE_HEAD, cwd, timeoutMs);
  if (revRes.code === CONSTANTS.EXIT_CODE_SUCCESS && revRes.stdout.trim()) {
    headSha = revRes.stdout.trim();
  }

  const untrackedFiles: string[] = [];
  const modifiedFiles: string[] = [];

  const statusRes = await runner(CONSTANTS.GIT_STATUS_PORCELAIN, cwd, timeoutMs);
  if (statusRes.code === CONSTANTS.EXIT_CODE_SUCCESS && statusRes.stdout.trim()) {
    const lines = statusRes.stdout.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const statusPrefix = line.slice(0, CONSTANTS.GIT_STATUS_CODE_LENGTH);
      const filePath = line.slice(CONSTANTS.GIT_STATUS_PREFIX_LENGTH).trim();
      if (statusPrefix === "??") {
        untrackedFiles.push(filePath);
      } else {
        modifiedFiles.push(filePath);
      }
    }
  }

  return {
    headSha,
    isDirty: untrackedFiles.length > 0 || modifiedFiles.length > 0,
    untrackedFiles,
    modifiedFiles,
  };
}

/**
 * Rolls back the repository working tree to the specified target reference.
 * Executes git reset --hard <targetRef> and cleans untracked files via git clean -fd.
 */
export async function rollbackWorkingTree(options: RollbackOptions = {}): Promise<RollbackResult> {
  const cwd = options.cwd ?? process.cwd();
  const targetRef = options.targetRef ?? CONSTANTS.GIT_HEAD_REF;
  const cleanUntracked = options.cleanUntracked ?? true;
  const excludes = options.excludes ?? CONSTANTS.NEVER_COMMIT;
  const timeoutMs = options.timeoutMs ?? CONSTANTS.COMMAND_TIMEOUT_MS;
  const runner = options.runner ?? defaultCommandRunner;
  const say = options.hooks?.say;
  const log = options.hooks?.log;

  say?.(`  [rollback] resetting working tree to ${targetRef}...`);
  log?.("rollback_start", { targetRef, cleanUntracked });

  const resetCmd = `${CONSTANTS.GIT_RESET_CMD} ${targetRef}`;
  const resetRes = await runner(resetCmd, cwd, timeoutMs);

  if (resetRes.code !== CONSTANTS.EXIT_CODE_SUCCESS) {
    const error = `git reset failed (exit ${resetRes.code}): ${resetRes.stderr || resetRes.output}`;
    say?.(`  ❌ ${error}`);
    log?.("rollback_error", { phase: "reset", error, code: resetRes.code });
    return {
      success: false,
      targetRef,
      resetOutput: resetRes.output,
      cleanOutput: "",
      error,
    };
  }

  let cleanOutput = "";
  if (cleanUntracked) {
    const cleanCmd = buildGitCleanCommand(excludes);
    const cleanRes = await runner(cleanCmd, cwd, timeoutMs);
    cleanOutput = cleanRes.output;

    if (cleanRes.code !== CONSTANTS.EXIT_CODE_SUCCESS) {
      const error = `git clean failed (exit ${cleanRes.code}): ${cleanRes.stderr || cleanRes.output}`;
      say?.(`  ❌ ${error}`);
      log?.("rollback_error", { phase: "clean", error, code: cleanRes.code });
      return {
        success: false,
        targetRef,
        resetOutput: resetRes.output,
        cleanOutput: cleanRes.output,
        error,
      };
    }
  }

  say?.(`  ✅ Working tree cleanly restored to ${targetRef}`);
  log?.("rollback_success", { targetRef, cleanUntracked });

  return {
    success: true,
    targetRef,
    resetOutput: resetRes.output,
    cleanOutput,
  };
}

/**
 * Stateful buffer that captures git commit baseline snapshots and manages clean rollbacks
 * across multi-attempt task execution loops.
 */
export class RollbackStateBuffer {
  private readonly cwd: string;
  private readonly excludes: readonly string[];
  private readonly timeoutMs: number;
  private readonly runner: CommandRunner;
  private readonly hooks?: {
    say?: (message: string) => void;
    log?: (event: string, data: Record<string, unknown>) => void;
  };
  private baselineSha: string | null = null;
  private snapshotTakenAt: number | null = null;
  private rollbackCount: number = 0;

  constructor(options: RollbackBufferOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.excludes = options.excludes ?? CONSTANTS.NEVER_COMMIT;
    this.timeoutMs = options.timeoutMs ?? CONSTANTS.COMMAND_TIMEOUT_MS;
    this.runner = options.runner ?? defaultCommandRunner;
    this.hooks = options.hooks;
  }

  /**
   * Captures the current HEAD commit SHA as the rollback baseline.
   */
  async snapshot(): Promise<string> {
    const state = await captureGitState({
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
      runner: this.runner,
    });
    this.baselineSha = state.headSha;
    this.snapshotTakenAt = Date.now();
    this.hooks?.log?.("rollback_snapshot", { sha: this.baselineSha });
    return this.baselineSha;
  }

  /**
   * Checks whether the working tree currently has modifications or untracked files
   * (excluding patterns in the excludes list).
   */
  async isDirty(): Promise<boolean> {
    const state = await captureGitState({
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
      runner: this.runner,
    });

    const isExcluded = (filePath: string): boolean =>
      this.excludes.some((ex) => filePath === ex || filePath.startsWith(ex));

    const dirtyUntracked = state.untrackedFiles.some((f) => !isExcluded(f));
    const dirtyModified = state.modifiedFiles.some((f) => !isExcluded(f));

    return dirtyUntracked || dirtyModified;
  }

  /**
   * Reverts all changes in the working tree back to the baseline snapshot, or to a custom ref.
   */
  async rollback(targetRefOverride?: string): Promise<RollbackResult> {
    const targetRef = targetRefOverride ?? this.baselineSha ?? CONSTANTS.GIT_HEAD_REF;
    const result = await rollbackWorkingTree({
      cwd: this.cwd,
      targetRef,
      cleanUntracked: true,
      excludes: this.excludes,
      timeoutMs: this.timeoutMs,
      runner: this.runner,
      hooks: this.hooks,
    });
    if (result.success) {
      this.rollbackCount++;
    }
    return result;
  }

  getBaselineSha(): string | null {
    return this.baselineSha;
  }

  getSnapshotTimestamp(): number | null {
    return this.snapshotTakenAt;
  }

  getRollbackCount(): number {
    return this.rollbackCount;
  }
}

/**
 * Fatal execution error that halts the cascade runner.
 */
export class Fatal extends Error {}

/**
 * Dedicated error class representing a task that exhausted its retry budget.
 */
export class TaskFailureError extends Fatal {
  constructor(
    public readonly taskId: string,
    public readonly change: string,
    public readonly attempts: number,
    public readonly logPath?: string,
  ) {
    const logInfo = logPath ? `; see ${logPath}` : "";
    super(`Task ${taskId} of ${change} failed after ${attempts} attempts${logInfo}`);
    this.name = "TaskFailureError";
  }
}
