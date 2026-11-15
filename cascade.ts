#!/usr/bin/env bun
/**
 * OpenSpec cascade CLI adapter.
 *
 * Parses arguments, loads configuration lazily and delegates the run to `CascadeFacade`.
 * Importing this module produces zero side effects; it re-exports the historical
 * cascade API (task parsing, verification, prompts, rollback, diagrams) for consumers.
 */

import { describeToolInput, oneLine } from "./antigravity";
import {
  EXIT_CODE_CONSTANTS,
  formatHelp,
  isKeepAliveEnabled,
  loadConfig,
  parseCliArgs,
  resolveEngine,
  RUNTIME_CONSTANTS,
} from "./config";
import {
  discoverArchifyTargets,
  syncDiagrams,
  type ArchifyTarget,
  type DiagramStepResult,
  type DiagramSyncOptions,
  type DiagramSyncResult,
} from "./diagrams";
import type { KeepAliveController } from "./platform";
import {
  formatVerificationFeedback,
  runVerificationPhase,
  type VerificationFailure,
  type VerificationResult,
} from "./qa";
import {
  captureGitState,
  Fatal,
  rollbackWorkingTree,
  RollbackStateBuffer,
  TaskFailureError,
  type CaptureGitStateOptions,
  type GitWorkingTreeState,
  type RollbackBufferOptions,
  type RollbackOptions,
  type RollbackResult,
} from "./resilience";
import { detectSubcommand, runSubcommand } from "./src/cli/commands";
import { CascadeFacade, isFailClosedError, type CascadeFacadeDependencies } from "./src/facade/cascade_facade";

export {
  blockedReason,
  commitsPerSection,
  commitTypeOf,
  isLastOfSection,
  parseTasks,
  runChecks,
  taskPrompt,
  verifyCommands,
  type Task,
  type VerifyCommandsOptions,
} from "./src/facade/tasks";
export { CascadeFacade, type CascadeFacadeDependencies, type CascadeRunResult } from "./src/facade/cascade_facade";

export {
  captureGitState,
  describeToolInput,
  discoverArchifyTargets,
  Fatal,
  formatVerificationFeedback,
  isKeepAliveEnabled,
  oneLine,
  resolveEngine,
  rollbackWorkingTree,
  RollbackStateBuffer,
  runVerificationPhase,
  syncDiagrams,
  TaskFailureError,
  type ArchifyTarget,
  type CaptureGitStateOptions,
  type DiagramStepResult,
  type DiagramSyncOptions,
  type DiagramSyncResult,
  type GitWorkingTreeState,
  type RollbackBufferOptions,
  type RollbackOptions,
  type RollbackResult,
  type VerificationFailure,
  type VerificationResult,
};

let activeFacade: CascadeFacade | undefined;

/**
 * Returns the keep-alive controller of the current CLI run, if started.
 */
export function getKeepAliveController(): KeepAliveController | undefined {
  return activeFacade?.getKeepAliveController();
}

/**
 * Executes the cascade CLI with explicit argv and env, returning a deterministic process exit code.
 */
export async function runCli(
  argv: string[] = process.argv.slice(RUNTIME_CONSTANTS.ARGV_START_INDEX),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  dependencies: CascadeFacadeDependencies = {},
): Promise<number> {
  const subcommand = detectSubcommand(argv);
  if (subcommand !== undefined) {
    return runSubcommand(subcommand, argv.slice(1));
  }
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.options.help) {
      console.log(formatHelp());
      return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
    }
    const config = loadConfig(argv, env);
    activeFacade = new CascadeFacade(dependencies);
    const result = await activeFacade.run(config);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isFailClosedError(error)) {
      console.error(`STOPPED: ${message}`);
      return EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
    }
    console.error(`CRASHED: ${error instanceof Error && error.stack ? error.stack : message}`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
  }
}

/**
 * Primary CLI entrypoint delegating to runCli and exiting with its return code.
 */
export async function main(
  argv: string[] = process.argv.slice(RUNTIME_CONSTANTS.ARGV_START_INDEX),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<void> {
  const exitCode = await runCli(argv, env);
  if (exitCode !== EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS) {
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  void main();
}
