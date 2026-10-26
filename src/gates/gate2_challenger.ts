/**
 * Gate 2: Adversarial Challenger Red-Team Fuzzing and Stress Test Runner.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.4 (LOOPER-GATE-003)
 * and OpenSpec change `looper-gate2-adversarial-challenger` Task 1.1.
 *
 * Architecture & Design Invariants:
 * 1. Adversarial Posture (Tier 5 Specialist):
 *    Spawns an ephemeral `Adversarial Challenger` subagent whose sole mandate is to break the
 *    candidate implementation using fuzz probes, extreme boundary inputs, race conditions,
 *    and unhandled error payloads.
 * 2. Attack Vectors & Stress Profiles:
 *    - Boundary & Malformed Inputs: Null pointers, undefined, empty strings, 2^31-1 integers,
 *      Unicode exploits, corrupted JSON payloads.
 *    - Concurrency & Race Conditions: Parallel invocations, out-of-order event arrivals, async stream aborts.
 *    - Resource Exhaustion: Runaway loops, token window floods, huge input buffers.
 *    - Timeout & Latency: Artificial delays, hanging promises, slow network simulations.
 * 3. Breaking Evidence & Test Preservation:
 *    Generates temporary test scripts under `test/challenger_<id>.test.ts`. If any probe triggers
 *    an unhandled crash, assertion failure, or exception, the test is permanently preserved
 *    as a minimal reproduction probe, Gate 2 issues `REPRODUCED_FAILURE`, and execution reverts to Worker.
 * 4. FSM Lifecycle Integration:
 *    Maps challenge outcomes to deterministic FSM domain events:
 *    - PASSED_NO_BREAK    -> EVT_G2_PASS (advances to Gate 3 Forensic Auditor)
 *    - REPRODUCED_FAILURE -> EVT_G2_BREAK (if attempt < maxAttempts, reverts to Worker with repro script)
 *    - REPRODUCED_FAILURE -> EVT_G2_EXHAUSTED (if attempt >= maxAttempts, escalates to diagnostic)
 * 5. Zero Magic Numbers & Strict Typing:
 *    Centralizes all thresholds, limits, timeouts, exit codes, and string literals in GATE2_CONSTANTS.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
  COGNITIVE_ROLES,
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ROLES,
  type IPalProvider,
  createPalMessage,
  createTextBlock,
  isPalTextContent,
} from "../pal/types";
import {
  ROLES_CONSTANTS,
  generateRoleSystemPrompt,
  getRoleDefinition,
} from "../core/roles";
import {
  SubagentDispatcher,
  type SubagentInstance,
  createSubagentDispatcher,
} from "../core/dispatcher";
import {
  LOOPER_EVENTS,
  LOOPER_STATES,
  type LooperEvent,
  type LooperState,
} from "../core/fsm_types";
import {
  GATE2_SYNTHESIS_CONSTANTS,
  Gate2EdgeCaseSynthesizer,
  createEdgeCaseSynthesizer,
  extractTargetFileExports,
  parseTargetFile,
  synthesizeBoundaryLimitCases,
  synthesizeConcurrencyCases,
  synthesizeEdgeCases,
  synthesizeGenericEdgeCases,
  synthesizeNullEdgeCases,
  synthesizeTimeoutCases,
  type EdgeCaseCategory,
  type Gate2SynthesisOptions,
  type TargetExportInfo,
  type TargetFileInfo,
} from "./gate2_synthesis";
import {
  GATE2_INJECTOR_CONSTANTS,
  Gate2AssertionInjector,
  Gate2InjectorError,
  Gate2InjectionError,
  Gate2RollbackError,
  TestingSandbox,
  createAssertionInjector,
  createTestingSandbox,
  formatAssertionFeedbackXml,
  formatAssertionReportMarkdown,
  type AssertionInjectionResult,
  type Gate2AssertionInjectorOptions,
  type InjectionMode,
  type InjectionStatus,
  type InjectionSuiteResult,
  type RedTeamAssertion,
  type TestingSandboxOptions,
} from "./gate2_injector";

/**
 * Central constants ensuring zero magic numbers across Gate 2 Challenger operations.
 */
export const GATE2_CONSTANTS = {
  // Verdicts
  VERDICT_PASSED_NO_BREAK: "PASSED_NO_BREAK" as const,
  VERDICT_REPRODUCED_FAILURE: "REPRODUCED_FAILURE" as const,
  VERDICT_TIMEOUT: "TIMEOUT" as const,
  VERDICT_ERROR: "ERROR" as const,

  // Recommended FSM Domain Events
  EVENT_G2_PASS: LOOPER_EVENTS.EVT_G2_PASS,
  EVENT_G2_BREAK: LOOPER_EVENTS.EVT_G2_BREAK,
  EVENT_G2_EXHAUSTED: LOOPER_EVENTS.EVT_G2_EXHAUSTED,

  // Associated FSM States
  STATE_GATE_2_CHALLENGE: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
  STATE_GATE_3_AUDIT: LOOPER_STATES.STATE_GATE_3_AUDIT,
  STATE_EXECUTE_WORKER: LOOPER_STATES.STATE_EXECUTE_WORKER,
  STATE_ESCALATE_DIAGNOSTIC: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,

  // Attempts and limits
  DEFAULT_ATTEMPT: 1,
  DEFAULT_MAX_ATTEMPTS: 2, // Specification default for MaxChallengeAttempts
  DEFAULT_GATE_TIMEOUT_MS: 300_000, // 5 minutes overall
  DEFAULT_PROBE_TIMEOUT_MS: 30_000, // 30 seconds per probe
  DEFAULT_MAX_PROBES: 20,
  DEFAULT_MAX_OUTPUT_LENGTH: 4_000,
  DEFAULT_FEEDBACK_TRUNCATION_LIMIT: 2_500,
  DEFAULT_TEMPERATURE: 0.2,

  // Attack Vectors
  VECTOR_BOUNDARY_MALFORMED: "boundary_malformed" as const,
  VECTOR_CONCURRENCY_RACE: "concurrency_race" as const,
  VECTOR_RESOURCE_EXHAUSTION: "resource_exhaustion" as const,
  VECTOR_TIMEOUT_LATENCY: "timeout_latency" as const,
  VECTOR_CUSTOM: "custom" as const,

  // File Paths & Suffixes
  DEFAULT_TEAMWORK_DIR: ".agents/teamwork",
  DEFAULT_TEST_DIR: "test",
  PROBE_FILE_PREFIX: "challenger_",
  PROBE_FILE_EXTENSION: ".test.ts",
  REPRO_SCRIPT_PREFIX: "challenger_repro_",
  REPORT_FILENAME: "challenge_report.md",
  RESULTS_JSON_FILENAME: "challenge_results.json",
  FEEDBACK_XML_FILENAME: "challenger_feedback.xml",

  // Cognitive Role Defaults
  ROLE_CHALLENGER: COGNITIVE_ROLES.CHALLENGER,
  ARCHETYPE_CHALLENGER: ROLES_CONSTANTS.ARCHETYPE_CHALLENGER,
  TIER_CHALLENGER: ROLES_CONSTANTS.TIER_CHALLENGER,
  DEFAULT_PROVIDER: "claude",
  DEFAULT_MODEL: "claude-3-7-sonnet-20250219",

  // Exit codes
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_FAILURE: 1,
  EXIT_CODE_ERROR: 2,
  EXIT_CODE_TIMEOUT: 124,

  // Numeric literals and offsets
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  INDEX_NOT_FOUND: -1,
  REGEX_CAPTURE_GROUP_ONE: 1,
  JSON_INDENT_SPACES: 2,
  UUID_TRUNCATION_LENGTH: 8,

  // Event emitter names
  EVENT_CHALLENGE_START: "challenge:start",
  EVENT_SUBAGENT_DISPATCHED: "challenge:subagent_dispatched",
  EVENT_PROBE_START: "challenge:probe_start",
  EVENT_PROBE_COMPLETE: "challenge:probe_complete",
  EVENT_BREAKING_PROBE_FOUND: "challenge:breaking_probe_found",
  EVENT_VERDICT_RESOLVED: "challenge:verdict_resolved",
  EVENT_CHALLENGE_COMPLETE: "challenge:complete",
  EVENT_CHALLENGE_ERROR: "challenge:error",
} as const;

/**
 * Gate 2 challenge verdict.
 */
export type Gate2Verdict =
  | typeof GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK
  | typeof GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE
  | typeof GATE2_CONSTANTS.VERDICT_TIMEOUT
  | typeof GATE2_CONSTANTS.VERDICT_ERROR;

/**
 * Recognized red-team adversarial attack vector categories.
 */
export type Gate2AttackVector =
  | typeof GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED
  | typeof GATE2_CONSTANTS.VECTOR_CONCURRENCY_RACE
  | typeof GATE2_CONSTANTS.VECTOR_RESOURCE_EXHAUSTION
  | typeof GATE2_CONSTANTS.VECTOR_TIMEOUT_LATENCY
  | typeof GATE2_CONSTANTS.VECTOR_CUSTOM;

/**
 * Executable adversarial test probe definition.
 */
export interface Gate2ProbeDefinition {
  readonly id: string;
  readonly name: string;
  readonly vector: Gate2AttackVector;
  readonly description: string;
  readonly probeCode: string;
  readonly targetFile?: string;
  readonly timeoutMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Individual test probe execution result.
 */
export interface Gate2ProbeResult {
  readonly probeId: string;
  readonly name: string;
  readonly vector: Gate2AttackVector;
  readonly description: string;
  readonly survived: boolean; // true if candidate did NOT break
  readonly broken: boolean;   // true if candidate crashed / assertion failed
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorOutput?: string;
  readonly durationMs: number;
  readonly probeFilePath?: string;
  readonly preservedReproPath?: string;
}

/**
 * Aggregated summary of executed adversarial test probes.
 */
export interface Gate2ProbeRunSummary {
  readonly totalProbes: number;
  readonly passedProbes: number; // survived without break
  readonly brokenProbes: number; // broke the implementation
  readonly errorProbes: number;
  readonly results: readonly Gate2ProbeResult[];
  readonly breakingProbes: readonly Gate2ProbeResult[];
}

/**
 * Comprehensive challenge report emitted by Gate 2.
 */
export interface Gate2ChallengeReport {
  readonly verdict: Gate2Verdict;
  readonly summary: string;
  readonly totalProbes: number;
  readonly survivedCount: number;
  readonly brokenCount: number;
  readonly results: readonly Gate2ProbeResult[];
  readonly breakingProbes: readonly Gate2ProbeResult[];
  readonly reproScripts: readonly string[];
  readonly unhandledFailures: readonly string[];
  readonly rawResponse?: string;
}

/**
 * Structured XML and metadata feedback produced for the Worker.
 */
export interface Gate2StructuredFeedback {
  readonly xmlFeedback: string;
  readonly verdict: Gate2Verdict;
  readonly recommendedEvent: LooperEvent;
  readonly targetFsmState: LooperState;
  readonly summary: string;
  readonly breakingProbeCount: number;
  readonly reproScriptPaths: readonly string[];
  readonly recommendations: readonly string[];
}

/**
 * Context payload provided to custom challenger executors and synthesizers.
 */
export interface Gate2ExecutionContext {
  readonly taskId?: string;
  readonly taskDescription?: string;
  readonly acceptanceCriteria: readonly string[];
  readonly targetFiles: readonly string[];
  readonly gitDiff?: string;
  readonly subagentInstance?: SubagentInstance;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly options: Readonly<Gate2ChallengerOptions>;
}

/**
 * Pluggable probe runner for executing individual probe test files.
 */
export type Gate2ProbeRunner = (
  probeFilePath: string,
  options?: { timeoutMs?: number; cwd?: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Pluggable challenger executor for custom test runners or mock suites.
 */
export type Gate2ChallengerExecutor = (
  context: Gate2ExecutionContext
) => Promise<Gate2ChallengeReport>;

/**
 * Options configuring the Gate2Challenger adversarial test runner.
 */
export interface Gate2ChallengerOptions {
  /** Root directory of the repository/workspace (defaults to process.cwd()) */
  readonly workspaceRoot?: string;
  /** Repository root directory override */
  readonly repoRoot?: string;
  /** Directory where temporary test probes are placed (defaults to <workspaceRoot>/test) */
  readonly testDir?: string;
  /** Identifier of the task under challenge */
  readonly taskId?: string;
  /** Task goal or descriptive specification */
  readonly taskDescription?: string;
  /** List of acceptance criteria required for task */
  readonly acceptanceCriteria?: readonly string[];
  /** Whitelist of authorized target files under challenge */
  readonly targetFiles?: readonly string[];
  /** Baseline git SHA */
  readonly baselineSha?: string;
  /** Pre-extracted git diff string */
  readonly diff?: string;
  /** Current challenge attempt count (default: 1) */
  readonly attempt?: number;
  /** Maximum permitted challenge attempts before escalation (default: 2) */
  readonly maxAttempts?: number;
  /** Overall challenge timeout in milliseconds (default: 300,000 ms) */
  readonly timeoutMs?: number;
  /** Per-probe test timeout in milliseconds (default: 30,000 ms) */
  readonly probeTimeoutMs?: number;
  /** LLM model name */
  readonly model?: string;
  /** Provider adapter or name */
  readonly provider?: IPalProvider | string;
  /** Optional pre-existing SubagentDispatcher instance */
  readonly dispatcher?: SubagentDispatcher;
  /** Whether to automatically clean up temporary files (default: true) */
  readonly autoCleanup?: boolean;
  /** Whether to preserve breaking probe test files permanently (default: true) */
  readonly preserveBreakingProbes?: boolean;
  /** Explicit test probes to execute */
  readonly probes?: readonly Gate2ProbeDefinition[];
  /** Custom probe runner */
  readonly probeRunner?: Gate2ProbeRunner;
  /** Pluggable challenger executor */
  readonly challengerExecutor?: Gate2ChallengerExecutor;
  /** Edge case synthesizer callback */
  readonly edgeCaseSynthesizer?: (
    context: Gate2ExecutionContext
  ) => Promise<readonly Gate2ProbeDefinition[]> | readonly Gate2ProbeDefinition[];
  /** Configuration options for automated edge case synthesis */
  readonly synthesisOptions?: Gate2SynthesisOptions;
  /** Red-team assertion injector into testing sandbox */
  readonly assertionInjector?: Gate2AssertionInjector;
  /** Testing sandbox configuration options */
  readonly sandboxOptions?: TestingSandboxOptions;
  /** Optional logging callback */
  readonly logger?: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * Final execution result returned by Gate2Challenger.
 */
export interface Gate2ChallengeResult {
  readonly success: boolean;
  readonly verdict: Gate2Verdict;
  readonly recommendedEvent: LooperEvent;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly report: Gate2ChallengeReport;
  readonly feedback?: Gate2StructuredFeedback;
  readonly breakingProbes: readonly Gate2ProbeResult[];
  readonly reproScripts: readonly string[];
  readonly subagentId?: string;
  readonly sandboxDir?: string;
  readonly durationMs: number;
  readonly timestamp: string;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base error class for Gate 2 Challenger operations.
 */
export class Gate2ChallengerError extends Error {
  readonly code: string;
  readonly details?: unknown;

  public constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "Gate2ChallengerError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown when adversarial challenge execution times out.
 */
export class Gate2TimeoutError extends Gate2ChallengerError {
  readonly timeoutMs: number;

  public constructor(timeoutMs: number, message?: string) {
    super(
      message ?? `Gate 2 adversarial challenge timed out after ${timeoutMs}ms.`,
      "GATE2_TIMEOUT_EXCEEDED",
      { timeoutMs }
    );
    this.name = "Gate2TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when subagent dispatch or sandboxing fails.
 */
export class Gate2SubagentDispatchError extends Gate2ChallengerError {
  public constructor(message: string, details?: unknown) {
    super(message, "GATE2_SUBAGENT_DISPATCH_FAILED", details);
    this.name = "Gate2SubagentDispatchError";
  }
}

/**
 * Thrown when probe execution fails with a runtime error.
 */
export class Gate2ProbeExecutionError extends Gate2ChallengerError {
  readonly probeId: string;
  readonly exitCode: number;

  public constructor(
    probeId: string,
    exitCode: number,
    message: string,
    details?: unknown
  ) {
    super(message, "GATE2_PROBE_EXECUTION_FAILED", details);
    this.name = "Gate2ProbeExecutionError";
    this.probeId = probeId;
    this.exitCode = exitCode;
  }
}

/**
 * Thrown when sandbox operations encounter filesystem errors.
 */
export class Gate2SandboxError extends Gate2ChallengerError {
  public constructor(message: string, details?: unknown) {
    super(message, "GATE2_SANDBOX_ERROR", details);
    this.name = "Gate2SandboxError";
  }
}

// ============================================================================
// HELPER FUNCTIONS & FORMATTERS
// ============================================================================

/**
 * Sanitizes a probe ID or name for use in filesystem paths.
 */
export function sanitizeProbeName(name: string): string {
  if (!name || typeof name !== "string") {
    return "probe";
  }
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * Truncates a string to maximum length with a trailing ellipsis indicator.
 */
function truncateString(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) {
    return str ?? "";
  }
  return `${str.slice(GATE2_CONSTANTS.ZERO, maxLength)}\n... [truncated]`;
}

/**
 * Escapes special XML characters for safe embedding inside XML tags.
 */
function escapeXml(unsafe: string): string {
  if (!unsafe || typeof unsafe !== "string") {
    return "";
  }
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Resolves the deterministic FSM domain event recommended by Gate 2.
 */
export function resolveGate2RecommendedEvent(
  verdict: Gate2Verdict,
  attempt: number = GATE2_CONSTANTS.DEFAULT_ATTEMPT,
  maxAttempts: number = GATE2_CONSTANTS.DEFAULT_MAX_ATTEMPTS
): LooperEvent {
  if (verdict === GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK) {
    return GATE2_CONSTANTS.EVENT_G2_PASS;
  }

  // Implementation broke, timed out, or encountered execution error
  if (attempt >= maxAttempts) {
    return GATE2_CONSTANTS.EVENT_G2_EXHAUSTED;
  }

  return GATE2_CONSTANTS.EVENT_G2_BREAK;
}

/**
 * Extracts key error traces and assertion failure messages from probe stdout/stderr.
 */
export function extractProbeErrorTrace(stdout: string, stderr: string): string {
  const combined = `${stderr}\n${stdout}`.trim();
  if (!combined) {
    return "Test probe exited with non-zero exit code but emitted empty logs.";
  }

  const lines = combined.split("\n");
  const relevantLines: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("error:") ||
      lower.includes("fail") ||
      lower.includes("expect(") ||
      lower.includes("assert") ||
      lower.includes("exception") ||
      lower.includes("typeerror") ||
      lower.includes("rangeerror") ||
      lower.includes("at ")
    ) {
      capturing = true;
      relevantLines.push(line);
      continue;
    }

    if (capturing) {
      relevantLines.push(line);
      if (relevantLines.length >= GATE2_CONSTANTS.DEFAULT_MAX_PROBES) {
        break;
      }
    }
  }

  return relevantLines.length > GATE2_CONSTANTS.ZERO
    ? relevantLines.join("\n")
    : truncateString(combined, GATE2_CONSTANTS.DEFAULT_FEEDBACK_TRUNCATION_LIMIT);
}

/**
 * Default probe runner executing subprocess via Bun.spawn.
 */
export async function defaultProbeRunner(
  probeFilePath: string,
  options?: { timeoutMs?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options?.timeoutMs ?? GATE2_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS;
  const cwd = options?.cwd ?? process.cwd();
  const isWindows = process.platform === "win32";
  const shellArgs = isWindows
    ? ["cmd.exe", "/c", "bun", "test", probeFilePath]
    : ["bun", "test", probeFilePath];

  try {
    const proc = Bun.spawn(shellArgs, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ timedOut: boolean }>((resolveTimeout) => {
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore kill failure
        }
        resolveTimeout({ timedOut: true });
      }, timeoutMs);
    });

    const completionPromise = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).then(([stdout, stderr, exitCode]) => ({
      timedOut: false,
      stdout,
      stderr,
      exitCode,
    }));

    const result = await Promise.race([completionPromise, timeoutPromise]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    if (result.timedOut) {
      return {
        stdout: "",
        stderr: `Adversarial probe timed out after ${timeoutMs}ms.`,
        exitCode: GATE2_CONSTANTS.EXIT_CODE_TIMEOUT,
      };
    }

    const completed = result as { stdout: string; stderr: string; exitCode: number };
    return {
      stdout: completed.stdout.trim(),
      stderr: completed.stderr.trim(),
      exitCode: completed.exitCode,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: GATE2_CONSTANTS.EXIT_CODE_ERROR,
    };
  }
}

/**
 * Formats contextual instructions for the Adversarial Challenger agent.
 */
export function formatChallengerPrompt(context: Gate2ExecutionContext): string {
  const sections: string[] = [];

  sections.push(
    `# Gate 2: Adversarial Challenger Red-Team Instructions\n\n` +
      `You are the Adversarial Challenger (Tier 5). Your sole objective is to break the candidate implementation ` +
      `by crafting stress tests, edge cases, and fuzzing payloads.`
  );

  if (context.taskId) {
    sections.push(`## Target Task: ${context.taskId}`);
  }

  if (context.taskDescription) {
    sections.push(`## Specification:\n${context.taskDescription}`);
  }

  if (context.acceptanceCriteria.length > GATE2_CONSTANTS.ZERO) {
    sections.push(
      `## Acceptance Criteria:\n` +
        context.acceptanceCriteria.map((ac) => `- ${ac}`).join("\n")
    );
  }

  if (context.targetFiles.length > GATE2_CONSTANTS.ZERO) {
    sections.push(
      `## Target Files Under Challenge:\n` +
        context.targetFiles.map((file) => `- \`${file}\``).join("\n")
    );
  }

  if (context.gitDiff) {
    sections.push(
      `## Candidate Implementation Git Diff:\n\`\`\`diff\n` +
        truncateString(context.gitDiff, GATE2_CONSTANTS.DEFAULT_MAX_OUTPUT_LENGTH) +
        `\n\`\`\``
    );
  }

  sections.push(
    `## Required Attack Vectors:\n` +
      `1. Boundary & Malformed Inputs (null, undefined, NaN, empty payloads, huge strings)\n` +
      `2. Concurrency & Race Conditions (parallel invocations, aborted streams)\n` +
      `3. Resource Limits (large arrays, deep objects)\n` +
      `4. Timeout & Slow Responses\n\n` +
      `Output JSON format:\n\`\`\`json\n` +
      `{\n` +
      `  "verdict": "PASSED_NO_BREAK" | "REPRODUCED_FAILURE",\n` +
      `  "summary": "Executive summary of challenge outcome",\n` +
      `  "probes": [\n` +
      `    {\n` +
      `      "id": "probe_name",\n` +
      `      "name": "Readable Name",\n` +
      `      "vector": "boundary_malformed" | "concurrency_race" | "resource_exhaustion" | "timeout_latency",\n` +
      `      "description": "What this attacks",\n` +
      `      "probeCode": "import { test, expect } from 'bun:test'; ..."\n` +
      `    }\n` +
      `  ]\n` +
      `}\n\`\`\``
  );

  return sections.join("\n\n");
}

/**
 * Formats a comprehensive Markdown report documenting the challenge findings.
 */
export function formatChallengeReportMarkdown(
  report: Gate2ChallengeReport,
  taskId?: string
): string {
  const sections: string[] = [];

  sections.push(
    `# Gate 2: Adversarial Challenger Red-Team Report\n\n` +
      `**Task ID**: \`${taskId ?? "unspecified"}\`  \n` +
      `**Verdict**: **\`${report.verdict}\`**  \n` +
      `**Timestamp**: ${new Date().toISOString()}  \n` +
      `**Summary**: ${report.summary}\n`
  );

  sections.push(
    `## Execution Statistics\n\n` +
      `| Metric | Count |\n` +
      `| :--- | :--- |\n` +
      `| **Total Probes Executed** | \`${report.totalProbes}\` |\n` +
      `| **Survived (Passed)** | \`${report.survivedCount}\` |\n` +
      `| **Broken (Failures Found)** | \`${report.brokenCount}\` |\n`
  );

  if (report.results.length > GATE2_CONSTANTS.ZERO) {
    sections.push(`## Probe Execution Log\n`);
    const tableRows = report.results.map((r) => {
      const status = r.broken ? "💥 BROKEN" : "✅ SURVIVED";
      return `| \`${r.probeId}\` | ${r.name} | \`${r.vector}\` | ${status} | \`${r.durationMs}ms\` |`;
    });

    sections.push(
      `| Probe ID | Name | Vector | Result | Duration |\n` +
        `| :--- | :--- | :--- | :--- | :--- |\n` +
        tableRows.join("\n")
    );
  }

  if (report.breakingProbes.length > GATE2_CONSTANTS.ZERO) {
    sections.push(`## 💥 Breaking Test Probes (Minimal Reproductions)\n`);
    for (const b of report.breakingProbes) {
      sections.push(
        `### Probe: ${b.name} (\`${b.probeId}\`)\n` +
          `- **Vector**: \`${b.vector}\`\n` +
          `- **Description**: ${b.description}\n` +
          (b.preservedReproPath ? `- **Reproduction Script**: \`${b.preservedReproPath}\`\n` : "") +
          `- **Error Trace**:\n\`\`\`\n` +
          (b.errorOutput ?? b.stderr ?? "Unknown error output") +
          `\n\`\`\``
      );
    }
  }

  if (report.reproScripts.length > GATE2_CONSTANTS.ZERO) {
    sections.push(
      `## Preserved Reproduction Test Scripts\n\n` +
        `The following test files have been permanently retained in the test suite to ensure non-regression:\n` +
        report.reproScripts.map((s) => `- \`${s}\``).join("\n")
    );
  }

  return sections.join("\n\n");
}

/**
 * Generates structured feedback XML and remediation advice for the Worker.
 */
export function generateGate2Feedback(
  report: Gate2ChallengeReport,
  options?: {
    taskId?: string;
    attempt?: number;
    maxAttempts?: number;
    targetFiles?: readonly string[];
    durationMs?: number;
    subagentId?: string;
  }
): Gate2StructuredFeedback {
  const taskId = options?.taskId ?? "unspecified-task";
  const attempt = options?.attempt ?? GATE2_CONSTANTS.DEFAULT_ATTEMPT;
  const maxAttempts = options?.maxAttempts ?? GATE2_CONSTANTS.DEFAULT_MAX_ATTEMPTS;
  const recommendedEvent = resolveGate2RecommendedEvent(report.verdict, attempt, maxAttempts);
  const targetFsmState =
    recommendedEvent === GATE2_CONSTANTS.EVENT_G2_PASS
      ? GATE2_CONSTANTS.STATE_GATE_3_AUDIT
      : recommendedEvent === GATE2_CONSTANTS.EVENT_G2_BREAK
        ? GATE2_CONSTANTS.STATE_EXECUTE_WORKER
        : GATE2_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC;

  const recommendations: string[] = [];
  if (report.verdict !== GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK) {
    for (const breaking of report.breakingProbes) {
      if (breaking.vector === GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED) {
        recommendations.push(
          `Harden input validation in ${breaking.name}: add guard clauses for undefined, null, empty strings, and out-of-range numerical values.`
        );
      } else if (breaking.vector === GATE2_CONSTANTS.VECTOR_CONCURRENCY_RACE) {
        recommendations.push(
          `Fix race condition in ${breaking.name}: ensure atomic locks, debounce mechanisms, or sequence idempotency guards.`
        );
      } else if (breaking.vector === GATE2_CONSTANTS.VECTOR_RESOURCE_EXHAUSTION) {
        recommendations.push(
          `Prevent resource exhaustion in ${breaking.name}: add pagination limits, chunked array processing, and heap bounds.`
        );
      } else {
        recommendations.push(
          `Fix adversarial defect in ${breaking.name}: review reproduction script ${breaking.preservedReproPath ?? breaking.probeFilePath ?? "provided"}.`
        );
      }
    }
    if (recommendations.length === GATE2_CONSTANTS.ZERO) {
      recommendations.push(
        "Review error traces and harden error boundaries against unhandled rejections and crashes."
      );
    }
  } else {
    recommendations.push(
      "Implementation successfully withstood all adversarial red-team stress vectors."
    );
  }

  const xmlLines: string[] = [
    `<challenger-feedback timestamp="${new Date().toISOString()}">`,
    `  <task-id>${escapeXml(taskId)}</task-id>`,
    `  <attempt>${attempt}</attempt>`,
    `  <max-attempts>${maxAttempts}</max-attempts>`,
    `  <verdict>${report.verdict}</verdict>`,
    `  <recommended-event>${recommendedEvent}</recommended-event>`,
    `  <target-fsm-state>${targetFsmState}</target-fsm-state>`,
    `  <summary>${escapeXml(report.summary)}</summary>`,
    `  <stats>`,
    `    <total-probes>${report.totalProbes}</total-probes>`,
    `    <survived>${report.survivedCount}</survived>`,
    `    <broken>${report.brokenCount}</broken>`,
    `  </stats>`,
  ];

  if (report.breakingProbes.length > GATE2_CONSTANTS.ZERO) {
    xmlLines.push(`  <breaking-probes count="${report.breakingProbes.length}">`);
    for (const p of report.breakingProbes) {
      xmlLines.push(`    <probe id="${escapeXml(p.probeId)}" vector="${escapeXml(p.vector)}">`);
      xmlLines.push(`      <name>${escapeXml(p.name)}</name>`);
      xmlLines.push(`      <description>${escapeXml(p.description)}</description>`);
      if (p.preservedReproPath) {
        xmlLines.push(
          `      <reproduction-file>${escapeXml(p.preservedReproPath)}</reproduction-file>`
        );
      }
      if (p.errorOutput) {
        xmlLines.push(
          `      <error-output><![CDATA[${truncateString(p.errorOutput, GATE2_CONSTANTS.DEFAULT_FEEDBACK_TRUNCATION_LIMIT)}]]></error-output>`
        );
      }
      xmlLines.push(`    </probe>`);
    }
    xmlLines.push(`  </breaking-probes>`);
  }

  xmlLines.push(`  <recommendations>`);
  for (const rec of recommendations) {
    xmlLines.push(`    <recommendation>${escapeXml(rec)}</recommendation>`);
  }
  xmlLines.push(`  </recommendations>`);
  xmlLines.push(`</challenger-feedback>`);

  return {
    xmlFeedback: xmlLines.join("\n"),
    verdict: report.verdict,
    recommendedEvent,
    targetFsmState,
    summary: report.summary,
    breakingProbeCount: report.breakingProbes.length,
    reproScriptPaths: report.reproScripts,
    recommendations,
  };
}

// ============================================================================
// GATE 2 CHALLENGER TEST RUNNER CLASS
// ============================================================================

/**
 * Gate 2 Challenger: Adversarial Red-Team Fuzzing and Stress Test Runner.
 *
 * Coordinates execution of adversarial stress probes against candidate implementations,
 * orchestrating ephemeral Tier 5 Challenger subagent sessions, executing temporary test
 * probes under `test/challenger_<id>.test.ts`, preserving minimal breaking reproductions,
 * and mapping outcomes into FSM domain events (EVT_G2_PASS, EVT_G2_BREAK, EVT_G2_EXHAUSTED).
 */
export class Gate2Challenger extends EventEmitter {
  private readonly options: Gate2ChallengerOptions;
  private readonly workspaceRoot: string;
  private readonly repoRoot: string;
  private readonly testDir: string;
  private readonly taskId?: string;
  private readonly attempt: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly autoCleanup: boolean;
  private readonly preserveBreakingProbes: boolean;
  private readonly probeRunner: Gate2ProbeRunner;
  private assertionInjectorInstance?: Gate2AssertionInjector;

  public constructor(options: Gate2ChallengerOptions = {}) {
    super();
    this.options = { ...options };
    this.workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
    this.repoRoot = normalize(options.repoRoot ?? this.workspaceRoot);
    this.testDir = normalize(
      options.testDir ?? join(this.workspaceRoot, GATE2_CONSTANTS.DEFAULT_TEST_DIR)
    );
    this.taskId = options.taskId;
    this.attempt = options.attempt ?? GATE2_CONSTANTS.DEFAULT_ATTEMPT;
    this.maxAttempts = options.maxAttempts ?? GATE2_CONSTANTS.DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? GATE2_CONSTANTS.DEFAULT_GATE_TIMEOUT_MS;
    this.probeTimeoutMs =
      options.probeTimeoutMs ?? GATE2_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS;
    this.autoCleanup = options.autoCleanup ?? true;
    this.preserveBreakingProbes = options.preserveBreakingProbes ?? true;
    this.probeRunner = options.probeRunner ?? defaultProbeRunner;
    this.assertionInjectorInstance = options.assertionInjector;
  }

  /**
   * Returns a copy of the challenger options.
   */
  public getOptions(): Readonly<Gate2ChallengerOptions> {
    return { ...this.options };
  }

  /**
   * Lazily initializes or returns the configured Gate2AssertionInjector instance.
   */
  public getAssertionInjector(): Gate2AssertionInjector {
    if (!this.assertionInjectorInstance) {
      this.assertionInjectorInstance = new Gate2AssertionInjector({
        workspaceRoot: this.workspaceRoot,
        testDir: this.testDir,
        probeRunner: this.probeRunner,
        timeoutMs: this.probeTimeoutMs,
        preserveBreakingProbes: this.preserveBreakingProbes,
        ...this.options.sandboxOptions,
      });
    }
    return this.assertionInjectorInstance;
  }

  /**
   * Formats prompt for subagent or LLM session.
   */
  public formatPrompt(context: Gate2ExecutionContext): string {
    return formatChallengerPrompt(context);
  }

  /**
   * Synthesizes baseline adversarial attack probes if none are explicitly provided.
   */
  public async synthesizeDefaultProbes(
    context: Gate2ExecutionContext
  ): Promise<readonly Gate2ProbeDefinition[]> {
    if (!context.targetFiles || context.targetFiles.length === GATE2_CONSTANTS.ZERO) {
      return [];
    }

    const synthesizer = new Gate2EdgeCaseSynthesizer({
      workspaceRoot: this.workspaceRoot,
      testDir: this.testDir,
      probeTimeoutMs: this.probeTimeoutMs,
      ...this.options.synthesisOptions,
    });

    return synthesizer.synthesizeForContext(context);
  }

  /**
   * Executes a single adversarial test probe against the candidate codebase.
   */
  public async executeProbe(probe: Gate2ProbeDefinition): Promise<Gate2ProbeResult> {
    const startTime = performance.now();
    this.emit(GATE2_CONSTANTS.EVENT_PROBE_START, { probeId: probe.id, name: probe.name });

    const safeId = sanitizeProbeName(probe.id);
    const uniqueSuffix = randomUUID().slice(
      GATE2_CONSTANTS.ZERO,
      GATE2_CONSTANTS.UUID_TRUNCATION_LENGTH
    );
    const probeFileName = `${GATE2_CONSTANTS.PROBE_FILE_PREFIX}${safeId}_${uniqueSuffix}${GATE2_CONSTANTS.PROBE_FILE_EXTENSION}`;
    const probeFilePath = join(this.testDir, probeFileName);

    let preservedReproPath: string | undefined;

    try {
      // Ensure target test directory exists
      await mkdir(this.testDir, { recursive: true });

      // Write probe test code to disk
      await writeFile(probeFilePath, probe.probeCode, "utf8");

      // Execute probe via probeRunner
      const executionTimeoutMs = probe.timeoutMs ?? this.probeTimeoutMs;
      const runnerResult = await this.probeRunner(probeFilePath, {
        timeoutMs: executionTimeoutMs,
        cwd: this.workspaceRoot,
      });

      const durationMs = Math.round(performance.now() - startTime);

      // In red-team testing:
      // exitCode === 0 => test passed => candidate SURVIVED the adversarial probe
      // exitCode !== 0 => test failed / crashed => candidate BROKE under adversarial conditions
      const survived = runnerResult.exitCode === GATE2_CONSTANTS.EXIT_CODE_SUCCESS;
      const broken = !survived;

      let errorOutput: string | undefined;
      if (broken) {
        errorOutput = extractProbeErrorTrace(runnerResult.stdout, runnerResult.stderr);

        // If probe broke the implementation and preservation is enabled, preserve it
        if (this.preserveBreakingProbes) {
          const reproFileName = `${GATE2_CONSTANTS.REPRO_SCRIPT_PREFIX}${safeId}${GATE2_CONSTANTS.PROBE_FILE_EXTENSION}`;
          preservedReproPath = join(this.testDir, reproFileName);
          try {
            await writeFile(preservedReproPath, probe.probeCode, "utf8");
          } catch (writeErr) {
            this.options.logger?.(
              "warn",
              `Could not preserve reproduction script to ${preservedReproPath}: ${writeErr}`
            );
            preservedReproPath = probeFilePath;
          }
        }
      }

      // Cleanup ephemeral probe file if survived or if repro was preserved elsewhere
      if (this.autoCleanup) {
        try {
          if (survived || preservedReproPath !== probeFilePath) {
            await unlink(probeFilePath);
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      const probeResult: Gate2ProbeResult = {
        probeId: probe.id,
        name: probe.name,
        vector: probe.vector,
        description: probe.description,
        survived,
        broken,
        exitCode: runnerResult.exitCode,
        stdout: runnerResult.stdout,
        stderr: runnerResult.stderr,
        errorOutput,
        durationMs,
        probeFilePath,
        preservedReproPath,
      };

      if (broken) {
        this.emit(GATE2_CONSTANTS.EVENT_BREAKING_PROBE_FOUND, probeResult);
      }

      this.emit(GATE2_CONSTANTS.EVENT_PROBE_COMPLETE, probeResult);
      return probeResult;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Cleanup ephemeral probe file on error
      if (this.autoCleanup) {
        try {
          await unlink(probeFilePath);
        } catch {
          // Ignore unlink errors
        }
      }

      const errorResult: Gate2ProbeResult = {
        probeId: probe.id,
        name: probe.name,
        vector: probe.vector,
        description: probe.description,
        survived: false,
        broken: true,
        exitCode: GATE2_CONSTANTS.EXIT_CODE_ERROR,
        stdout: "",
        stderr: errorMessage,
        errorOutput: errorMessage,
        durationMs,
        probeFilePath,
      };

      this.emit(GATE2_CONSTANTS.EVENT_BREAKING_PROBE_FOUND, errorResult);
      this.emit(GATE2_CONSTANTS.EVENT_PROBE_COMPLETE, errorResult);
      return errorResult;
    }
  }

  /**
   * Executes a collection of adversarial probes and aggregates the results.
   */
  public async runProbes(
    probes: readonly Gate2ProbeDefinition[]
  ): Promise<Gate2ProbeRunSummary> {
    const results: Gate2ProbeResult[] = [];
    const breakingProbes: Gate2ProbeResult[] = [];
    let passedProbes = GATE2_CONSTANTS.ZERO;
    let brokenProbes = GATE2_CONSTANTS.ZERO;
    let errorProbes = GATE2_CONSTANTS.ZERO;

    for (const probe of probes) {
      const result = await this.executeProbe(probe);
      results.push(result);

      if (result.broken) {
        brokenProbes += GATE2_CONSTANTS.ONE;
        breakingProbes.push(result);
        if (result.exitCode === GATE2_CONSTANTS.EXIT_CODE_ERROR) {
          errorProbes += GATE2_CONSTANTS.ONE;
        }
      } else {
        passedProbes += GATE2_CONSTANTS.ONE;
      }
    }

    return {
      totalProbes: probes.length,
      passedProbes,
      brokenProbes,
      errorProbes,
      results,
      breakingProbes,
    };
  }

  /**
   * Generates structured feedback XML and recommendations.
   */
  public generateFeedback(
    reportOrResult?: Gate2ChallengeReport | Gate2ChallengeResult
  ): Gate2StructuredFeedback {
    if (reportOrResult) {
      const report = "report" in reportOrResult ? reportOrResult.report : reportOrResult;
      return generateGate2Feedback(report, {
        taskId: this.taskId,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        targetFiles: this.options.targetFiles,
      });
    }

    const emptyReport: Gate2ChallengeReport = {
      verdict: GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
      summary: "No challenge probes executed; implementation unchallenged.",
      totalProbes: GATE2_CONSTANTS.ZERO,
      survivedCount: GATE2_CONSTANTS.ZERO,
      brokenCount: GATE2_CONSTANTS.ZERO,
      results: [],
      breakingProbes: [],
      reproScripts: [],
      unhandledFailures: [],
    };

    return generateGate2Feedback(emptyReport, {
      taskId: this.taskId,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
      targetFiles: this.options.targetFiles,
    });
  }

  /**
   * Executes adversarial challenge turn using PAL provider interface.
   */
  private async executePalTurn(
    provider: IPalProvider,
    prompt: string
  ): Promise<Gate2ChallengeReport | undefined> {
    const systemPrompt = generateRoleSystemPrompt(COGNITIVE_ROLES.CHALLENGER);

    const message = createPalMessage({
      role: PAL_ROLES.USER,
      content: [createTextBlock(prompt)],
    });

    const outcome = await provider.executeTurn({
      sessionId: `gate2-challenger-${this.taskId ?? "challenge"}-${randomUUID()}`,
      messages: [message],
      systemPrompt,
      temperature: GATE2_CONSTANTS.DEFAULT_TEMPERATURE,
    });

    const textBlocks = outcome.message.content
      .filter(isPalTextContent)
      .map((b) => b.text)
      .join("\n");

    return this.parseLlmResponse(textBlocks);
  }

  /**
   * Parses LLM response into structured Gate2ChallengeReport.
   */
  private parseLlmResponse(responseText: string): Gate2ChallengeReport | undefined {
    if (!responseText || typeof responseText !== "string") {
      return undefined;
    }

    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = (
        jsonMatch ? jsonMatch[GATE2_CONSTANTS.REGEX_CAPTURE_GROUP_ONE] : responseText
      ) ?? "";

      const parsed = JSON.parse(jsonStr.trim()) as {
        verdict?: string;
        summary?: string;
        probes?: readonly Gate2ProbeDefinition[];
      };

      if (parsed && typeof parsed.verdict === "string") {
        const rawVerdict = parsed.verdict.toUpperCase();
        const verdict: Gate2Verdict =
          rawVerdict === GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK ||
          rawVerdict === "PASSED" ||
          rawVerdict === "PASS"
            ? GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK
            : GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE;

        return {
          verdict,
          summary: parsed.summary ?? "Adversarial challenge completed.",
          totalProbes: parsed.probes ? parsed.probes.length : GATE2_CONSTANTS.ZERO,
          survivedCount:
            verdict === GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK
              ? (parsed.probes?.length ?? GATE2_CONSTANTS.ZERO)
              : GATE2_CONSTANTS.ZERO,
          brokenCount:
            verdict === GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE
              ? GATE2_CONSTANTS.ONE
              : GATE2_CONSTANTS.ZERO,
          results: [],
          breakingProbes: [],
          reproScripts: [],
          unhandledFailures:
            verdict === GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE
              ? [parsed.summary ?? "Candidate implementation crashed on malformed payload"]
              : [],
          rawResponse: responseText,
        };
      }
    } catch {
      // Fallback keyword scanning
      if (
        responseText.includes("VERDICT: PASSED_NO_BREAK") ||
        responseText.includes('"verdict": "PASSED_NO_BREAK"')
      ) {
        return {
          verdict: GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
          summary: "Implementation withstood all adversarial attacks without breaking.",
          totalProbes: GATE2_CONSTANTS.ZERO,
          survivedCount: GATE2_CONSTANTS.ZERO,
          brokenCount: GATE2_CONSTANTS.ZERO,
          results: [],
          breakingProbes: [],
          reproScripts: [],
          unhandledFailures: [],
          rawResponse: responseText,
        };
      }
    }

    return undefined;
  }

  /**
   * Executes the full Gate 2 Adversarial Red-Team Challenge cycle.
   */
  public async run(): Promise<Gate2ChallengeResult> {
    const startTime = performance.now();
    this.emit(GATE2_CONSTANTS.EVENT_CHALLENGE_START, {
      taskId: this.taskId,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
    });

    let subagent: SubagentInstance | undefined;
    let dispatcher = this.options.dispatcher;

    try {
      // 1. Dispatch ephemeral Challenger subagent if configured
      if (!dispatcher && this.autoCleanup !== false) {
        dispatcher = createSubagentDispatcher({
          workspaceRoot: this.workspaceRoot,
          autoCleanup: false,
        });
      }

      if (dispatcher) {
        try {
          subagent = await dispatcher.dispatch({
            role: COGNITIVE_ROLES.CHALLENGER,
            taskId: this.taskId,
            taskDescription:
              this.options.taskDescription ??
              "Perform red-team adversarial fuzzing and stress testing against candidate implementation",
            targetFiles: this.options.targetFiles,
            customConstraints: [
              "Adversarial Challenger (Tier 5): actively attempt to discover failure conditions.",
              "Author test probes strictly under test/challenger*.test.ts.",
              "Zero production source code mutations permitted.",
            ],
          });
          this.emit(GATE2_CONSTANTS.EVENT_SUBAGENT_DISPATCHED, {
            subagentId: subagent.id,
            sandboxDir: subagent.sandbox.sandboxDir,
          });
        } catch (dispatchErr) {
          this.options.logger?.(
            "warn",
            `Could not dispatch challenger subagent sandbox: ${dispatchErr}`
          );
        }
      }

      // 2. Formulate Execution Context
      const context: Gate2ExecutionContext = {
        taskId: this.taskId,
        taskDescription: this.options.taskDescription,
        acceptanceCriteria: this.options.acceptanceCriteria ?? [],
        targetFiles: this.options.targetFiles ?? [],
        gitDiff: this.options.diff,
        subagentInstance: subagent,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        options: this.options,
      };

      // 3. Collect or synthesize test probes
      let probesToRun: readonly Gate2ProbeDefinition[] = [];

      if (this.options.probes !== undefined) {
        probesToRun = this.options.probes;
      } else if (this.options.edgeCaseSynthesizer) {
        probesToRun = await this.options.edgeCaseSynthesizer(context);
      } else {
        probesToRun = await this.synthesizeDefaultProbes(context);
      }

      // 4. Run challenge executor or probe suite
      let report: Gate2ChallengeReport;

      if (this.options.challengerExecutor) {
        report = await this.options.challengerExecutor(context);
      } else if (
        probesToRun.length === GATE2_CONSTANTS.ZERO &&
        this.options.provider &&
        typeof this.options.provider !== "string"
      ) {
        const prompt = this.formatPrompt(context);
        const palReport = await this.executePalTurn(this.options.provider, prompt);
        report =
          palReport ?? {
            verdict: GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
            summary: "Challenger completed with no breaking vulnerabilities identified.",
            totalProbes: GATE2_CONSTANTS.ZERO,
            survivedCount: GATE2_CONSTANTS.ZERO,
            brokenCount: GATE2_CONSTANTS.ZERO,
            results: [],
            breakingProbes: [],
            reproScripts: [],
            unhandledFailures: [],
          };
      } else {
        // Run test probes against candidate implementation
        const summary = await this.runProbes(probesToRun);

        const hasBreak = summary.brokenProbes > GATE2_CONSTANTS.ZERO;
        const verdict: Gate2Verdict = hasBreak
          ? GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE
          : GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK;

        const reproScripts = summary.breakingProbes
          .map((b) => b.preservedReproPath ?? b.probeFilePath)
          .filter((p): p is string => Boolean(p));

        const unhandledFailures = summary.breakingProbes.map(
          (b) =>
            `${b.name} (${b.vector}): ${b.errorOutput ?? b.stderr ?? "Unhandled crash"}`
        );

        const outcomeSummary = hasBreak
          ? `Discovered ${summary.brokenProbes} breaking red-team vulnerability probe(s) in candidate implementation.`
          : `Candidate implementation successfully withstood all ${summary.totalProbes} adversarial stress probe(s).`;

        report = {
          verdict,
          summary: outcomeSummary,
          totalProbes: summary.totalProbes,
          survivedCount: summary.passedProbes,
          brokenCount: summary.brokenProbes,
          results: summary.results,
          breakingProbes: summary.breakingProbes,
          reproScripts,
          unhandledFailures,
        };
      }

      // 5. Determine recommended FSM event
      const recommendedEvent = resolveGate2RecommendedEvent(
        report.verdict,
        this.attempt,
        this.maxAttempts
      );

      this.emit(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED, {
        verdict: report.verdict,
        recommendedEvent,
        breakingCount: report.brokenCount,
      });

      const durationMs = Math.round(performance.now() - startTime);

      // 6. Generate structured feedback
      const feedback = generateGate2Feedback(report, {
        taskId: this.taskId,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        targetFiles: this.options.targetFiles,
        durationMs,
        subagentId: subagent?.id,
      });

      // 7. Write reports to subagent sandbox if present
      if (subagent) {
        try {
          const reportMarkdown = formatChallengeReportMarkdown(report, this.taskId);
          const reportPath = join(
            subagent.sandbox.sandboxDir,
            GATE2_CONSTANTS.REPORT_FILENAME
          );
          const resultsPath = join(
            subagent.sandbox.sandboxDir,
            GATE2_CONSTANTS.RESULTS_JSON_FILENAME
          );
          const feedbackPath = join(
            subagent.sandbox.sandboxDir,
            GATE2_CONSTANTS.FEEDBACK_XML_FILENAME
          );

          await mkdir(subagent.sandbox.sandboxDir, { recursive: true });
          await writeFile(reportPath, reportMarkdown, "utf8");
          await writeFile(
            resultsPath,
            JSON.stringify(report, null, GATE2_CONSTANTS.JSON_INDENT_SPACES),
            "utf8"
          );
          await writeFile(feedbackPath, feedback.xmlFeedback, "utf8");

          await dispatcher?.completeAgent(subagent.id, {
            handoffContent: reportMarkdown,
          });

          if (this.autoCleanup) {
            await dispatcher?.cleanupAgent(subagent.id);
          }
        } catch (writeErr) {
          this.options.logger?.(
            "warn",
            `Failed to write challenger reports to sandbox: ${writeErr}`
          );
        }
      }

      const result: Gate2ChallengeResult = {
        success: report.verdict === GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
        verdict: report.verdict,
        recommendedEvent,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        report,
        feedback,
        breakingProbes: report.breakingProbes,
        reproScripts: report.reproScripts,
        subagentId: subagent?.id,
        sandboxDir: subagent?.sandbox.sandboxDir,
        durationMs,
        timestamp: new Date().toISOString(),
      };

      this.emit(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE, result);
      return result;
    } catch (error) {
      if (subagent && dispatcher) {
        try {
          await dispatcher.failAgent(
            subagent.id,
            error instanceof Error ? error : new Error(String(error))
          );
        } catch {
          // ignore failure reporting errors
        }
      }

      this.emit(GATE2_CONSTANTS.EVENT_CHALLENGE_ERROR, error);
      throw error;
    }
  }
}

/**
 * Factory helper function to instantiate a Gate2Challenger.
 */
export function createGate2Challenger(
  options?: Gate2ChallengerOptions
): Gate2Challenger {
  return new Gate2Challenger(options);
}

/**
 * Executes a single Gate 2 Adversarial Red-Team Challenge cycle.
 */
export async function runGate2Challenger(
  options?: Gate2ChallengerOptions
): Promise<Gate2ChallengeResult> {
  const challenger = new Gate2Challenger(options);
  return challenger.run();
}

// Re-export Edge-Case Synthesis Engine components for unified external API
export {
  GATE2_SYNTHESIS_CONSTANTS,
  Gate2EdgeCaseSynthesizer,
  createEdgeCaseSynthesizer,
  extractTargetFileExports,
  parseTargetFile,
  synthesizeBoundaryLimitCases,
  synthesizeConcurrencyCases,
  synthesizeEdgeCases,
  synthesizeGenericEdgeCases,
  synthesizeNullEdgeCases,
  synthesizeTimeoutCases,
  type EdgeCaseCategory,
  type Gate2SynthesisOptions,
  type TargetExportInfo,
  type TargetFileInfo,
};

// Re-export Red-Team Assertion Injector components for unified external API
export {
  GATE2_INJECTOR_CONSTANTS,
  Gate2AssertionInjector,
  Gate2InjectorError,
  Gate2InjectionError,
  Gate2RollbackError,
  TestingSandbox,
  createAssertionInjector,
  createTestingSandbox,
  formatAssertionFeedbackXml,
  formatAssertionReportMarkdown,
  type AssertionInjectionResult,
  type Gate2AssertionInjectorOptions,
  type InjectionMode,
  type InjectionStatus,
  type InjectionSuiteResult,
  type RedTeamAssertion,
  type TestingSandboxOptions,
};

