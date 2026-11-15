/**
 * Gate 0: Automated Oracle / Mechanical QA Test Runner.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.2 (LOOPER-GATE-001)
 * and OpenSpec change `looper-gate0-mechanical-qa` Task 1.1.
 *
 * Provides a deterministic, automated mechanical QA execution engine that runs unit tests,
 * TypeScript compilation, code style / linters, build assertions, and filesystem layout invariants.
 * Enforces zero-tolerance mechanical quality, exit code 0 gating, and prepares structured XML feedback.
 */

import { getDefaultSpawner } from "../runtime/spawner";
import { shellArgv } from "../runtime/process_control";
import { readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { formatGate0Feedback, parseGate0Trace } from "./gate0_parser";
import { evaluateGateExecutionPolicy, isDisqualifiedFile, isDocumentationFile, isFastTrackCandidate, normalizeFilePath, resolveGate0RecommendedEvent, detectGitAffectedFiles } from "./gate0_policy";
import {
  GATE0_POLICY_CONSTANTS,
  GATE0_PARSER_CONSTANTS,
  GATE0_CONSTANTS,
  type Gate0ParsedTrace,
  type Gate0BypassedGate,
  type Gate0PolicyRecommendedEvent,
  type Gate0RequiredGate,
  type GateExecutionPolicy,
  type GatePolicyEvaluationOptions,
  type GatePolicyEvaluationResult,
  type GatePolicySelection,
  type ResolveGate0EventOptions,
  type Gate0StackFrame,
  type Gate0ParsedTestFailure,
  type Gate0ParsedDiagnostic,
  type Gate0DiagnosticSource,
  type Gate0DiagnosticSeverity,
  type Gate0Result,
  type Gate0LayoutCheckResult,
  type Gate0LayoutViolation,
  type Gate0CheckExecutionResult,
  type Gate0CheckStatus,
  type Gate0CheckType,
  type Gate0Verdict,
  type Gate0RunnerOptions,
  type Gate0CheckDefinition,
  type Gate0ExecutionContext,
  type Gate0CommandRunner,
  type Gate0CommandRunnerResult,
  type Gate0CommandRunnerOptions,
} from "./gate0_types";
export { GATE0_CONSTANTS } from "./gate0_types";
export type { Gate0CheckType, Gate0CheckStatus, Gate0Verdict, Gate0CommandRunnerResult, Gate0CommandRunnerOptions, Gate0CommandRunner, Gate0ExecutionContext, Gate0CheckDefinition, Gate0CheckExecutionResult, Gate0LayoutViolation, Gate0LayoutCheckResult, Gate0RunnerHooks, Gate0RunnerOptions, Gate0FeedbackOptions, Gate0Result } from "./gate0_types";


/**
 * Default command runner executing subprocesses via the runtime ISpawner.
 */
export async function defaultGate0CommandRunner(
  command: string,
  options: Gate0CommandRunnerOptions = {},
): Promise<Gate0CommandRunnerResult> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? GATE0_CONSTANTS.DEFAULT_PER_COMMAND_TIMEOUT_MS;
  const startTime = performance.now();

  try {
    const result = await getDefaultSpawner().run(shellArgv(command), { cwd, timeoutMs, env: { ...process.env, ...(options.env ?? {}) } });

    const durationMs = Math.round(performance.now() - startTime);

    if (result.timedOut) {
      const timeoutMessage = `Command timed out after ${timeoutMs}ms: ${command}`;
      return {
        code: GATE0_CONSTANTS.EXIT_CODE_TIMEOUT,
        stdout: "",
        stderr: timeoutMessage,
        output: timeoutMessage,
        durationMs,
        timedOut: true,
      };
    }

    const completed = result;
    const trimmedOut = completed.stdout.trim();
    const trimmedErr = completed.stderr.trim();
    const combined = [trimmedOut, trimmedErr].filter(Boolean).join("\n") || trimmedOut || trimmedErr;

    return {
      code: completed.exitCode,
      stdout: trimmedOut,
      stderr: trimmedErr,
      output: combined,
      durationMs,
      timedOut: false,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: GATE0_CONSTANTS.EXIT_CODE_ERROR,
      stdout: "",
      stderr: message,
      output: message,
      durationMs,
      timedOut: false,
    };
  }
}

/**
 * Classifies a raw shell command string into a canonical Gate 0 check type.
 */
export function classifyCheckType(command: string): Gate0CheckType {
  const normalized = command.trim().toLowerCase();

  if (normalized.includes("tsc") || normalized.includes("typecheck")) {
    return GATE0_CONSTANTS.CHECK_TYPE_TYPECHECK;
  }
  if (
    normalized.includes("test") ||
    normalized.includes("jest") ||
    normalized.includes("vitest") ||
    normalized.includes("mocha") ||
    normalized.includes("playwright") ||
    normalized.includes("cypress")
  ) {
    return GATE0_CONSTANTS.CHECK_TYPE_TEST;
  }
  if (
    normalized.includes("eslint") ||
    normalized.includes("biome") ||
    normalized.includes("lint")
  ) {
    return GATE0_CONSTANTS.CHECK_TYPE_LINT;
  }
  if (
    normalized.includes("build") ||
    normalized.includes("bundle") ||
    normalized.includes("compile")
  ) {
    return GATE0_CONSTANTS.CHECK_TYPE_BUILD;
  }
  if (normalized.includes("layout")) {
    return GATE0_CONSTANTS.CHECK_TYPE_LAYOUT;
  }

  return GATE0_CONSTANTS.CHECK_TYPE_CUSTOM;
}

/**
 * Verifies that the protected metadata directory (.agents/teamwork) contains strictly
 * coordination documentation and zero application source code files.
 */
export async function verifyGate0FilesystemLayout(
  rootDir: string,
  protectedDir: string = GATE0_CONSTANTS.DEFAULT_PROTECTED_METADATA_DIR,
): Promise<Gate0LayoutCheckResult> {
  const targetDir = isAbsolute(protectedDir) ? protectedDir : resolve(rootDir, protectedDir);
  const violations: Gate0LayoutViolation[] = [];
  let scannedCount = 0;

  try {
    const rootStat = await stat(targetDir);
    if (!rootStat.isDirectory()) {
      return { valid: true, violations: [], inspectedDir: targetDir, scannedCount: 0 };
    }
  } catch {
    // If directory does not exist, there are no violations
    return { valid: true, violations: [], inspectedDir: targetDir, scannedCount: 0 };
  }

  const forbiddenSet = new Set<string>(GATE0_CONSTANTS.FORBIDDEN_SOURCE_EXTENSIONS);

  async function walk(currentDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      let entryStat;
      try {
        entryStat = await stat(fullPath);
      } catch {
        continue;
      }

      if (entryStat.isDirectory()) {
        await walk(fullPath);
      } else if (entryStat.isFile()) {
        scannedCount += 1;
        const ext = extname(entry).toLowerCase();
        if (forbiddenSet.has(ext)) {
          const relPath = relative(rootDir, fullPath);
          violations.push({
            filePath: relPath,
            reason: `Application source code file found in protected metadata directory: ${relPath}`,
            rule: "Agnostic Looper Layout Invariant: .agents/teamwork/ must contain exclusively coordination metadata (.md, .json), strictly zero application source code or tests.",
          });
        }
      }
    }
  }

  await walk(targetDir);

  return {
    valid: violations.length === 0,
    violations,
    inspectedDir: targetDir,
    scannedCount,
  };
}

// Re-export structured parser, XML formatting, and diagnostic types
export {
  GATE0_PARSER_CONSTANTS,
  escapeXml,
  escapeXmlAttr,
  formatFailureXml,
  formatGate0Feedback,
  parseGate0Trace,
  parseLinterErrors,
  parseStackTrace,
  parseTestFailures,
  parseTypeScriptErrors,
  stripAnsi,
  type Gate0DiagnosticSeverity,
  type Gate0DiagnosticSource,
  type Gate0ParsedDiagnostic,
  type Gate0ParsedTrace,
  type Gate0ParsedTestFailure,
  type Gate0StackFrame,
} from "./gate0_parser";

// Re-export fast-track policy bypass evaluator and types
export {
  GATE0_POLICY_CONSTANTS,
  detectGitAffectedFiles,
  evaluateGateExecutionPolicy,
  isDisqualifiedFile,
  isDocumentationFile,
  isFastTrackCandidate,
  normalizeFilePath,
  resolveGate0RecommendedEvent,
  type Gate0BypassedGate,
  type Gate0PolicyRecommendedEvent,
  type Gate0RequiredGate,
  type GateExecutionPolicy,
  type GatePolicyEvaluationOptions,
  type GatePolicyEvaluationResult,
  type GatePolicySelection,
  type ResolveGate0EventOptions,
} from "./gate0_policy";

/**
 * Builds canonical check definitions from options.
 */
export function createGate0CheckDefinitions(options: Gate0RunnerOptions): Gate0CheckDefinition[] {
  const definitions: Gate0CheckDefinition[] = [];

  // 1. Filesystem layout assertion (if enabled)
  if (options.enableLayoutCheck !== false) {
    definitions.push({
      id: GATE0_CONSTANTS.LAYOUT_CHECK_ID,
      name: GATE0_CONSTANTS.LAYOUT_CHECK_NAME,
      type: GATE0_CONSTANTS.CHECK_TYPE_LAYOUT,
      command: `layout-check ${options.protectedMetadataDir ?? GATE0_CONSTANTS.DEFAULT_PROTECTED_METADATA_DIR}`,
      required: true,
      description: "Asserts .agents/teamwork/ directory contains zero application source files",
    });
  }

  // 2. Command checks
  const rawCommands = options.commands;

  if (rawCommands && rawCommands.length > 0) {
    let index = 0;
    for (const item of rawCommands) {
      index += 1;
      if (typeof item === "string") {
        const type = classifyCheckType(item);
        definitions.push({
          id: `gate0-cmd-${index}`,
          name: item,
          type,
          command: item,
          required: true,
          timeoutMs: options.perCommandTimeoutMs,
        });
      } else {
        definitions.push(item);
      }
    }
  } else {
    // Standard default suite: bun test, tsc, lint, build
    const specs = options.specs && options.specs.length > 0 ? options.specs.join(" ") : "";
    const testCmd = specs ? `bun test ${specs}` : "bun test";

    const defaultItems: Array<{ id: string; name: string; command: string; type: Gate0CheckType }> = [
      {
        id: "gate0-test",
        name: "Unit Test Suite",
        command: testCmd,
        type: GATE0_CONSTANTS.CHECK_TYPE_TEST,
      },
      {
        id: "gate0-typecheck",
        name: "TypeScript Compilation",
        command: "bunx tsc --noEmit",
        type: GATE0_CONSTANTS.CHECK_TYPE_TYPECHECK,
      },
      {
        id: "gate0-lint",
        name: "Code Linter",
        command: "bun run lint",
        type: GATE0_CONSTANTS.CHECK_TYPE_LINT,
      },
      {
        id: "gate0-build",
        name: "Application Build",
        command: "bun run build",
        type: GATE0_CONSTANTS.CHECK_TYPE_BUILD,
      },
    ];

    for (const def of defaultItems) {
      definitions.push({
        id: def.id,
        name: def.name,
        type: def.type,
        command: def.command,
        required: true,
        timeoutMs: options.perCommandTimeoutMs,
      });
    }
  }

  return definitions;
}

/**
 * Gate 0 Mechanical Test Runner Engine.
 *
 * Implements an objective, automated oracle executing deterministic quality checks
 * and providing structured diagnostic traces.
 */
export class Gate0MechanicalRunner {
  private readonly options: Gate0RunnerOptions;
  private readonly repoRoot: string;
  private readonly cwd: string;
  private readonly runner: Gate0CommandRunner;
  private readonly timeoutMs: number;
  private readonly perCommandTimeoutMs: number;
  private readonly stopOnFirstFailure: boolean;

  public constructor(options: Gate0RunnerOptions = {}) {
    this.options = { ...options };
    this.repoRoot = normalize(options.repoRoot ?? options.cwd ?? process.cwd());
    this.cwd = normalize(options.cwd ?? this.repoRoot);
    this.runner = options.runner ?? defaultGate0CommandRunner;
    this.timeoutMs = options.timeoutMs ?? GATE0_CONSTANTS.DEFAULT_GATE_TIMEOUT_MS;
    this.perCommandTimeoutMs =
      options.perCommandTimeoutMs ?? GATE0_CONSTANTS.DEFAULT_PER_COMMAND_TIMEOUT_MS;
    this.stopOnFirstFailure = options.stopOnFirstFailure ?? true;
  }

  /**
   * Returns a copy of the runner configuration options.
   */
  public getOptions(): Readonly<Gate0RunnerOptions> {
    return { ...this.options };
  }

  /**
   * Executes the complete Gate 0 verification suite.
   */
  public async run(): Promise<Gate0Result> {
    const startTime = performance.now();
    const hooks = this.options.hooks;

    // Evaluate Gate Execution Policy (Fast-Track vs Full-Gate)
    const policyResult = evaluateGateExecutionPolicy({
      affectedFiles: this.options.affectedFiles,
      policy: this.options.policy,
      allowFastTrack: this.options.allowFastTrack,
      taskId: this.options.taskId,
      repoRoot: this.repoRoot,
    });

    hooks?.log?.("gate0_policy", {
      policy: policyResult.policy,
      isFastTrack: policyResult.isFastTrack,
      reason: policyResult.reason,
      bypassedGates: policyResult.bypassedGates,
    });

    if (policyResult.isFastTrack) {
      hooks?.say?.(`  [Gate 0] Fast-Track policy bypass active: ${policyResult.reason}`);
    }

    const checks =
      policyResult.isFastTrack && this.options.fastTrackCommands && this.options.fastTrackCommands.length > 0
        ? createGate0CheckDefinitions({ ...this.options, commands: this.options.fastTrackCommands })
        : createGate0CheckDefinitions(this.options);

    const checkResults: Gate0CheckExecutionResult[] = [];
    const failures: Gate0CheckExecutionResult[] = [];
    const passed: Gate0CheckExecutionResult[] = [];
    const skipped: Gate0CheckExecutionResult[] = [];
    let layoutResult: Gate0LayoutCheckResult | undefined;

    const context: Gate0ExecutionContext = {
      repoRoot: this.repoRoot,
      cwd: this.cwd,
      runner: this.runner,
      timeoutMs: this.timeoutMs,
      perCommandTimeoutMs: this.perCommandTimeoutMs,
      attempt: this.options.attempt ?? GATE0_CONSTANTS.DEFAULT_CURRENT_ATTEMPT,
      maxAttempts: this.options.maxAttempts ?? GATE0_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
      taskId: this.options.taskId,
      affectedFiles: this.options.affectedFiles,
      specs: this.options.specs,
      env: this.options.env,
    };

    let halted = false;

    for (const check of checks) {

      if (halted) {
        const skippedResult: Gate0CheckExecutionResult = {
          id: check.id,
          name: check.name,
          type: check.type,
          command: check.command ?? "",
          exitCode: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
          status: GATE0_CONSTANTS.STATUS_SKIPPED,
          stdout: "",
          stderr: "",
          output: "Skipped due to prior check failure in Gate 0.",
          durationMs: 0,
          timedOut: false,
        };
        checkResults.push(skippedResult);
        skipped.push(skippedResult);
        continue;
      }

      hooks?.onCheckStart?.(check);
      hooks?.say?.(`  [Gate 0] running: ${check.name} (${check.command ?? check.type})`);

      let executionResult: Gate0CheckExecutionResult;

      if (check.type === GATE0_CONSTANTS.CHECK_TYPE_LAYOUT) {
        layoutResult = await verifyGate0FilesystemLayout(
          this.repoRoot,
          this.options.protectedMetadataDir,
        );
        executionResult = this.createLayoutExecutionResult(check, layoutResult);
      } else if (check.customRunner) {
        const checkStartTime = performance.now();
        try {
          executionResult = await check.customRunner(context);
        } catch (error) {
          const durationMs = Math.round(performance.now() - checkStartTime);
          const message = error instanceof Error ? error.message : String(error);
          executionResult = {
            id: check.id,
            name: check.name,
            type: check.type,
            command: check.command ?? "custom-runner",
            exitCode: GATE0_CONSTANTS.EXIT_CODE_ERROR,
            status: GATE0_CONSTANTS.STATUS_ERROR,
            stdout: "",
            stderr: message,
            output: message,
            durationMs,
            timedOut: false,
            errorMessage: message,
          };
        }
      } else {
        executionResult = await this.executeCommandCheck(check);
      }

      checkResults.push(executionResult);
      hooks?.onCheckComplete?.(executionResult);
      hooks?.log?.("gate0_check", {
        id: executionResult.id,
        status: executionResult.status,
        code: executionResult.exitCode,
      });

      const isPass = executionResult.status === GATE0_CONSTANTS.STATUS_PASSED;
      const statusIcon = isPass ? "✅" : "❌";
      hooks?.say?.(`  [Gate 0] ${statusIcon} ${check.name} (exit ${executionResult.exitCode})`);

      if (isPass) {
        passed.push(executionResult);
      } else {
        failures.push(executionResult);
        if (check.required && this.stopOnFirstFailure) {
          halted = true;
        }
      }
    }

    const totalDurationMs = Math.round(performance.now() - startTime);
    const success = failures.length === 0;
    const exitCode = success
      ? GATE0_CONSTANTS.EXIT_CODE_SUCCESS
      : failures[0]?.exitCode ?? GATE0_CONSTANTS.EXIT_CODE_FAILURE;

    let verdict: Gate0Verdict = GATE0_CONSTANTS.VERDICT_PASSED;
    if (!success) {
      const hasTimeout = failures.some((f) => f.timedOut);
      verdict = hasTimeout ? GATE0_CONSTANTS.VERDICT_TIMEOUT : GATE0_CONSTANTS.VERDICT_FAILED;
    }

    const summary = success
      ? `Gate 0 Oracle PASSED: ${passed.length}/${checkResults.length} checks succeeded in ${totalDurationMs}ms.`
      : `Gate 0 Oracle FAILED: ${failures.length}/${checkResults.length} checks failed (exit ${exitCode}) in ${totalDurationMs}ms.`;

    const recommendedEvent = resolveGate0RecommendedEvent({
      success,
      isFastTrack: policyResult.isFastTrack,
      attempt: this.options.attempt ?? GATE0_CONSTANTS.DEFAULT_CURRENT_ATTEMPT,
      maxAttempts: this.options.maxAttempts ?? GATE0_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
    });

    const result: Gate0Result = {
      success,
      verdict,
      exitCode,
      checks: checkResults,
      failures,
      passed,
      skipped,
      durationMs: totalDurationMs,
      summary,
      layoutResult,
      fastTrackEligible: policyResult.isFastTrack,
      policy: policyResult.policy,
      policyResult,
      bypassedGates: policyResult.bypassedGates,
      recommendedEvent,
      timestamp: new Date().toISOString(),
    };

    if (!success) {
      result.feedbackPrompt = formatGate0Feedback(result, {
        taskId: this.options.taskId,
        attempt: this.options.attempt,
        maxAttempts: this.options.maxAttempts,
      });
    }

    hooks?.onGateComplete?.(result);

    return result;
  }

  /**
   * Executes a shell command check using the configured command runner.
   */
  private async executeCommandCheck(check: Gate0CheckDefinition): Promise<Gate0CheckExecutionResult> {
    const command = check.command ?? "";
    const timeoutMs = check.timeoutMs ?? this.perCommandTimeoutMs;
    const cwd = check.cwd ? resolve(this.repoRoot, check.cwd) : this.cwd;

    const res = await this.runner(command, {
      cwd,
      timeoutMs,
      env: this.options.env,
    });

    let status: Gate0CheckStatus = GATE0_CONSTANTS.STATUS_FAILED;
    if (res.timedOut) {
      status = GATE0_CONSTANTS.STATUS_TIMEOUT;
    } else if (res.code === GATE0_CONSTANTS.EXIT_CODE_SUCCESS) {
      status = GATE0_CONSTANTS.STATUS_PASSED;
    }

    const parsedTrace =
      status !== GATE0_CONSTANTS.STATUS_PASSED
        ? parseGate0Trace(res.stdout, res.stderr, check.type, command)
        : undefined;

    return {
      id: check.id,
      name: check.name,
      type: check.type,
      command,
      exitCode: res.code,
      status,
      stdout: res.stdout,
      stderr: res.stderr,
      output: res.output,
      durationMs: res.durationMs,
      timedOut: res.timedOut,
      parsedTrace,
    };
  }

  /**
   * Adapts a filesystem layout result to a check execution result.
   */
  private createLayoutExecutionResult(
    check: Gate0CheckDefinition,
    layoutResult: Gate0LayoutCheckResult,
  ): Gate0CheckExecutionResult {
    const isPass = layoutResult.valid;
    const output = isPass
      ? `Layout valid: ${layoutResult.scannedCount} files inspected in ${layoutResult.inspectedDir}, zero source code violations.`
      : layoutResult.violations.map((v) => `${v.filePath}: ${v.reason}`).join("\n");

    return {
      id: check.id,
      name: check.name,
      type: check.type,
      command: check.command ?? "layout-check",
      exitCode: isPass ? GATE0_CONSTANTS.EXIT_CODE_SUCCESS : GATE0_CONSTANTS.EXIT_CODE_FAILURE,
      status: isPass ? GATE0_CONSTANTS.STATUS_PASSED : GATE0_CONSTANTS.STATUS_FAILED,
      stdout: isPass ? output : "",
      stderr: isPass ? "" : output,
      output,
      durationMs: 0,
      timedOut: false,
      errorMessage: isPass ? undefined : `Found ${layoutResult.violations.length} layout violations`,
    };
  }
}

/**
 * Top-level convenience function to execute Gate 0 mechanical QA checks.
 */
export async function runGate0QA(options: Gate0RunnerOptions = {}): Promise<Gate0Result> {
  const runner = new Gate0MechanicalRunner(options);
  return runner.run();
}

/**
 * Factory creating a configured Gate0MechanicalRunner instance.
 */
export function createGate0Runner(options: Gate0RunnerOptions = {}): Gate0MechanicalRunner {
  return new Gate0MechanicalRunner(options);
}
