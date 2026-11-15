/**
 * 24/7 failure resilience and git rollback state buffer module for openspec-cascade.
 *
 * Provides working tree state capture, snapshotting, and atomic git rollback
 * to ensure that failed task attempts cleanly revert changes without leaving dirty
 * working tree artifacts, enabling resilient 24/7 autonomous task execution.
 */

import {
  ROLLBACK_CONSTANTS,
  buildGitCleanCommand,
  captureGitState,
  defaultCommandRunner,
  rollbackWorkingTree,
  RollbackStateBuffer,
  type CaptureGitStateOptions,
  type CommandRunner,
  type CommandRunnerResult,
  type CommitOptions,
  type CommitResult,
  type GitWorkingTreeState,
  type PreservedAuditLog,
  type RollbackAuditAction,
  type RollbackAuditEntry,
  type RollbackBufferOptions,
  type RollbackOptions,
  type RollbackResult,
} from "./src/engine/rollback_buffer";

export {
  ROLLBACK_CONSTANTS,
  buildGitCleanCommand,
  captureGitState,
  defaultCommandRunner,
  rollbackWorkingTree,
  RollbackStateBuffer,
  type CaptureGitStateOptions,
  type CommandRunner,
  type CommandRunnerResult,
  type CommitOptions,
  type CommitResult,
  type GitWorkingTreeState,
  type PreservedAuditLog,
  type RollbackAuditAction,
  type RollbackAuditEntry,
  type RollbackBufferOptions,
  type RollbackOptions,
  type RollbackResult,
};

/**
 * Fatal execution error that halts the cascade runner.
 */
export class Fatal extends Error {}

/**
 * Dedicated error class representing a task that exhausted its retry budget.
 */
export class TaskFailureError extends Fatal {
  readonly taskId: string;
  readonly change: string;
  readonly attempts: number;
  readonly logPath?: string;

  constructor(taskId: string, change: string, attempts: number, logPath?: string) {
    const logInfo = logPath ? `; see ${logPath}` : "";
    super(`Task ${taskId} of ${change} failed after ${attempts} attempts${logInfo}`);
    this.taskId = taskId;
    this.change = change;
    this.attempts = attempts;
    this.logPath = logPath;
    this.name = "TaskFailureError";
  }
}
