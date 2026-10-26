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
