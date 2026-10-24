/**
 * QA verification stage module for openspec-cascade.
 *
 * Implements autonomous verification loops that execute test, tsc, lint, and build
 * commands, capturing exit codes and separating stdout/stderr stack traces into
 * structured error feedback blocks for agent retry loops.
 */
import { CONSTANTS } from "./config";

export interface VerificationFailure {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

export interface VerificationResult {
  success: boolean;
  failures: VerificationFailure[];
  feedbackPrompt?: string;
}

export type CommandRunnerResult = {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
};

export type CommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<CommandRunnerResult>;

export interface VerificationFeedbackOptions {
  taskId?: string;
  attempt?: number;
  maxAttempts?: number;
  maxLength?: number;
}

export interface VerificationPhaseOptions {
  /** Verification commands to run. Defaults to CONSTANTS.QA_VERIFY_COMMANDS */
  commands?: readonly string[] | string[];
  /** Working directory where commands are executed. Defaults to process.cwd() */
  cwd?: string;
  /** Task identifier for reporting (e.g. "1.1") */
  taskId?: string;
  /** Current attempt index (1-based) */
  attempt?: number;
  /** Maximum attempts allowed */
  maxAttempts?: number;
  /** Execution timeout per command in ms */
  timeoutMs?: number;
  /** Whether to stop execution on the first failing command. Defaults to true. */
  stopOnFirstFailure?: boolean;
  /** Custom runner for executing commands, enabling dependency injection for testing. */
  runner?: CommandRunner;
  /** Hooks for progress and event logging. */
  hooks?: {
    say?: (message: string) => void;
    log?: (event: string, data: Record<string, unknown>) => void;
  };
}

export async function defaultCommandRunner(
  cmd: string,
  cwd: string,
  timeoutMs: number = CONSTANTS.COMMAND_TIMEOUT_MS,
): Promise<CommandRunnerResult> {
  const argv = ["sh", "-c", cmd];
  try {
    const proc = Bun.spawn(argv, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const trimmedOut = out.trim();
    const trimmedErr = err.trim();
    const combined = [trimmedOut, trimmedErr].filter(Boolean).join("\n") || trimmedOut || trimmedErr;
    return {
      code,
      stdout: trimmedOut,
      stderr: trimmedErr,
      output: combined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: CONSTANTS.EXIT_CODE_ERROR,
      stdout: "",
      stderr: message,
      output: message,
    };
  }
}

export function formatVerificationFeedback(
  failures: VerificationFailure[],
  options?: VerificationFeedbackOptions,
): string {
  if (!failures || failures.length === 0) return "";

  const taskId = options?.taskId ? `Task ${options.taskId}` : "The task";
  const attemptInfo =
    options?.attempt !== undefined && options?.maxAttempts !== undefined
      ? ` (attempt ${options.attempt}/${options.maxAttempts})`
      : "";
  const maxLength = options?.maxLength ?? CONSTANTS.CHECK_FAILURE_OUTPUT_MAX_LENGTH;

  const failureBlocks = failures.map((f) => {
    const parts: string[] = [];
    parts.push(`<failure command="${f.command}" exit_code="${f.exitCode}">`);
    if (f.stderr.trim()) {
      parts.push("### STDERR / STACK TRACE:");
      parts.push(f.stderr.trim().slice(-maxLength));
    }
    if (f.stdout.trim()) {
      parts.push("### STDOUT:");
      parts.push(f.stdout.trim().slice(-maxLength));
    }
    if (!f.stderr.trim() && !f.stdout.trim() && f.output.trim()) {
      parts.push("### OUTPUT:");
      parts.push(f.output.trim().slice(-maxLength));
    }
    parts.push("</failure>");
    return parts.join("\n");
  });

  return [
    `${taskId} is not done; verification checks failed${attemptInfo}.`,
    "",
    "<verification-feedback>",
    ...failureBlocks,
    "</verification-feedback>",
    "",
    "Analyze the failure traces, fix the underlying root causes, and re-verify before finishing the task.",
  ].join("\n");
}

export async function runVerificationPhase(
  optionsOrCommands?: readonly string[] | string[] | VerificationPhaseOptions,
  extraOptions?: VerificationPhaseOptions,
): Promise<VerificationResult> {
  const isCommands = Array.isArray(optionsOrCommands);
  const options: VerificationPhaseOptions = isCommands
    ? { ...extraOptions, commands: optionsOrCommands as readonly string[] }
    : ((optionsOrCommands as VerificationPhaseOptions | undefined) ?? {});

  const commands =
    options.commands && options.commands.length > 0
      ? options.commands
      : CONSTANTS.QA_VERIFY_COMMANDS;
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? CONSTANTS.COMMAND_TIMEOUT_MS;
  const stopOnFirstFailure = options.stopOnFirstFailure ?? true;
  const runner = options.runner ?? defaultCommandRunner;
  const say = options.hooks?.say;
  const log = options.hooks?.log;

  const failures: VerificationFailure[] = [];

  for (const command of commands) {
    say?.(`  check: ${command}`);
    const res = await runner(command, cwd, timeoutMs);
    log?.("check", { command, code: res.code });
    say?.(`  ${res.code === CONSTANTS.EXIT_CODE_SUCCESS ? "✅" : "❌"} ${command}`);

    if (res.code !== CONSTANTS.EXIT_CODE_SUCCESS) {
      const tailLines = res.output
        .split("\n")
        .slice(-CONSTANTS.CHECK_FAILURE_TAIL_LINES)
        .join("\n");
      if (tailLines) {
        console.log(tailLines);
      }
      failures.push({
        command,
        exitCode: res.code,
        stdout: res.stdout,
        stderr: res.stderr,
        output: res.output,
      });
      if (stopOnFirstFailure) {
        break;
      }
    }
  }

  const success = failures.length === 0;
  const feedbackPrompt = success
    ? undefined
    : formatVerificationFeedback(failures, {
        taskId: options.taskId,
        attempt: options.attempt,
        maxAttempts: options.maxAttempts,
      });

  return {
    success,
    failures,
    feedbackPrompt,
  };
}
