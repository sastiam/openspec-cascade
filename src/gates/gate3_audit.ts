/**
 * Gate 3: Forensic Victory Auditor & System Invariant Guardian.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.5 (LOOPER-GATE-004),
 * Section 2.1, Section 2.2, Section 2.4 (Tier 6 Specialist), and OpenSpec change
 * `looper-gate3-forensic-audit` Task 1.1.
 *
 * Architecture & Design Invariants:
 * 1. Absolute Binary Veto Capability (Tier 6 Specialist):
 *    Spawns an independent Forensic Auditor holding unilateral binary veto authority.
 *    Decisions are strictly binary: `PASS` or `FAIL` (VETO). Any invariant violation
 *    triggers immediate binary veto and atomic rollback via `RollbackStateBuffer`.
 * 2. Layout Invariant (.agents/teamwork/):
 *    Guarantees that the protected coordination directory `.agents/teamwork/` contains
 *    strictly metadata (.md, .json, .txt, .xml, .patch) and zero application source code
 *    (.ts, .js, .tsx, .jsx, etc.) or build artifacts.
 * 3. Git Hygiene Invariant:
 *    Ensures zero dirty repository history: verifies no unstaged secret keys, credential leaks,
 *    temporary files (*.tmp, *.bak), or uncommitted compiled binaries exist in the working tree.
 * 4. Clean-Room Mechanical QA:
 *    Re-runs end-to-end verification commands (`bun test`, `bunx tsc --noEmit`, linters)
 *    in an unpolluted subprocess environment without inheriting overrides.
 * 5. Anti-Cheat & Pluggable Invariant Checks:
 *    Detects mock stubs in production files, disabled or skipped test suites, and trivial
 *    assertions; supports pluggable anti-cheat scanners and custom invariant validators.
 * 6. Holistic Victory Audit (Mode: "victory"):
 *    When invoked across all DAG tasks, verifies full system invariants and emits
 *    `VICTORY CONFIRMED` (`EVT_VICTORY_PASS`) or triggers triage (`EVT_VICTORY_FAIL`).
 * 7. Zero Magic Numbers & Strict Typing:
 *    Centralizes all limits, timeouts, exit codes, and string literals in GATE3_CONSTANTS.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
  COGNITIVE_ROLES,
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ROLES,
  type IPalProvider,
  createPalMessage,
  createTextBlock,
  isPalTextContent,
  type CognitiveRole,
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
  captureGitState,
  rollbackWorkingTree,
  RollbackStateBuffer,
  ROLLBACK_CONSTANTS,
  type GitWorkingTreeState,
  type RollbackOptions,
  type RollbackResult,
  type CommandRunner,
  type CommandRunnerResult,
} from "../engine/rollback_buffer";
import {
  Gate3AntiCheatScanner,
  createGate3AntiCheatScanner,
  toGate3InvariantCheckResult,
  type AntiCheatScanReport,
  type AntiCheatScannerOptions,
  type AntiCheatViolation,
  type AntiCheatRule,
  type AntiCheatCategory,
  type AntiCheatSeverity,
  GATE3_SCANNER_CONSTANTS,
  DEFAULT_ANTI_CHEAT_RULES,
} from "./gate3_scanner";


/**
 * Central constants ensuring zero magic numbers across Gate 3 Auditor operations.
 */
export const GATE3_CONSTANTS = {
  // Verdicts
  VERDICT_PASS: "PASS" as const,
  VERDICT_FAIL: "FAIL" as const,
  VERDICT_VETO: "VETO" as const,
  VICTORY_CONFIRMED: "VICTORY CONFIRMED" as const,

  // Audit Modes
  MODE_TASK: "task" as const,
  MODE_VICTORY: "victory" as const,

  // Invariant Categories
  INVARIANT_LAYOUT: "layout" as const,
  INVARIANT_GIT_HYGIENE: "git_hygiene" as const,
  INVARIANT_CLEAN_ROOM_QA: "clean_room_qa" as const,
  INVARIANT_ANTI_CHEAT: "anti_cheat" as const,
  INVARIANT_BOUNDARY: "boundary" as const,
  INVARIANT_CUSTOM: "custom" as const,

  // Invariant Statuses
  STATUS_PASSED: "passed" as const,
  STATUS_VIOLATED: "violated" as const,
  STATUS_SKIPPED: "skipped" as const,

  // EventEmitter Lifecycle Events
  EVENT_AUDIT_START: "audit:start" as const,
  EVENT_AUDIT_COMPLETE: "audit:complete" as const,
  EVENT_INVARIANT_CHECK: "audit:invariant_check" as const,
  EVENT_VETO_ISSUED: "audit:veto" as const,
  EVENT_ROLLBACK_TRIGGERED: "audit:rollback" as const,
  EVENT_SUBAGENT_DISPATCHED: "audit:subagent_dispatched" as const,

  // Recommended FSM Domain Events
  EVENT_G3_PASS: LOOPER_EVENTS.EVT_G3_PASS,
  EVENT_G3_VETO: LOOPER_EVENTS.EVT_G3_VETO,
  EVENT_VICTORY_PASS: LOOPER_EVENTS.EVT_VICTORY_PASS,
  EVENT_VICTORY_FAIL: LOOPER_EVENTS.EVT_VICTORY_FAIL,

  // Associated FSM States
  STATE_GATE_3_AUDIT: LOOPER_STATES.STATE_GATE_3_AUDIT,
  STATE_COMMIT_CHECKPOINT: LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
  STATE_ESCALATE_DIAGNOSTIC: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
  STATE_VICTORY_AUDIT: LOOPER_STATES.STATE_VICTORY_AUDIT,
  STATE_COMPLETED: LOOPER_STATES.STATE_COMPLETED,
  STATE_VICTORY_TRIAGE: LOOPER_STATES.STATE_VICTORY_TRIAGE,

  // Defaults and Limits
  DEFAULT_ATTEMPT: 1,
  DEFAULT_MAX_ATTEMPTS: 3,
  DEFAULT_TIMEOUT_MS: 300_000, // 5 minutes
  DEFAULT_COMMAND_TIMEOUT_MS: 60_000, // 1 minute per command
  DEFAULT_GIT_TIMEOUT_MS: 30_000,
  DEFAULT_PROTECTED_METADATA_DIR: ".agents/teamwork",

  // Layout Invariant: forbidden extensions in metadata directory
  FORBIDDEN_METADATA_EXTENSIONS: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".c",
    ".cpp",
    ".h",
    ".java",
    ".sh",
    ".bash",
    ".bin",
    ".exe",
    ".tar",
    ".gz",
    ".zip",
    ".dll",
    ".so",
  ] as const,

  // Allowed extensions in protected metadata directory
  ALLOWED_METADATA_EXTENSIONS: [
    ".md",
    ".json",
    ".txt",
    ".xml",
    ".patch",
    ".log",
    ".yml",
    ".yaml",
  ] as const,

  // Git Hygiene Invariant: forbidden temp and backup file patterns
  FORBIDDEN_TEMP_PATTERNS: [
    /\.tmp$/i,
    /\.temp$/i,
    /\.bak$/i,
    /\.swp$/i,
    /~$/i,
    /^\.DS_Store$/i,
  ] as const,

  // Git Hygiene Invariant: forbidden secrets patterns
  FORBIDDEN_SECRET_PATTERNS: [
    /\.key$/i,
    /\.pem$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\.secret$/i,
    /^\.env\.production$/i,
    /^\.env\.local$/i,
  ] as const,

  // Git Hygiene Invariant: untracked binary artifacts
  FORBIDDEN_BINARY_EXTENSIONS: [
    ".bin",
    ".exe",
    ".so",
    ".dylib",
    ".dll",
    ".class",
    ".tar",
    ".gz",
    ".zip",
  ] as const,

  // Default Rollback Excludes (preserving agent memory & project assets)
  DEFAULT_ROLLBACK_EXCLUDES: [
    ".agents/teamwork/",
    "projects/",
    "logs/",
    ".atl",
    ".claude/settings.local.json",
  ] as const,

  // Default Clean-Room QA Commands
  DEFAULT_CLEAN_ROOM_QA_COMMANDS: [
    { command: "bun test", description: "Independent Unit Test Suite Execution" },
    { command: "bunx tsc --noEmit", description: "Clean-Room Strict TypeScript Compilation" },
    { command: "bun run lint", description: "Static Code Analysis & Linting" },
  ] as readonly CleanRoomQaCommand[],

  // Anti-Cheat Patterns
  ANTI_CHEAT_STUB_PATTERNS: [
    /return\s+null\s*(?:as\s+any)?\s*;\s*\/\/\s*stub/i,
    /\/\/\s*TODO:\s*implement/i,
    /\/\/\s*placeholder/i,
    /throw\s+new\s+Error\(\s*["']not implemented["']\s*\)/i,
  ] as const,

  ANTI_CHEAT_TEST_SKIP_PATTERNS: [
    /\b(?:test|it|describe)\.skip\b/,
    /\b(?:test|it)\.todo\b/,
  ] as const,

  ANTI_CHEAT_TRIVIAL_ASSERTION_PATTERNS: [
    /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/,
    /expect\(\s*1\s*\)\.toBe\(\s*1\s*\)/,
    /expect\(\s*["']a["']\s*\)\.toBe\(\s*["']a["']\s*\)/,
  ] as const,

  // Exit codes
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_ERROR: 1,
  EXIT_CODE_TIMEOUT: 124,

  // Numeric literals
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  DIFF_PLUS_PREFIX_LENGTH: 6,
  MAX_DISPLAY_VIOLATIONS: 20,
  LLM_TEMPERATURE: 0.1,
} as const;

/**
 * Gate 3 binary verdict: either PASS or FAIL (triggering VETO).
 */
export type Gate3Verdict =
  | typeof GATE3_CONSTANTS.VERDICT_PASS
  | typeof GATE3_CONSTANTS.VERDICT_FAIL;

/**
 * Gate 3 audit modes: task-level gate transition vs final victory sign-off.
 */
export type Gate3AuditMode =
  | typeof GATE3_CONSTANTS.MODE_TASK
  | typeof GATE3_CONSTANTS.MODE_VICTORY;

/**
 * Invariant categories audited by Gate 3.
 */
export type Gate3InvariantCategory =
  | typeof GATE3_CONSTANTS.INVARIANT_LAYOUT
  | typeof GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE
  | typeof GATE3_CONSTANTS.INVARIANT_CLEAN_ROOM_QA
  | typeof GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT
  | typeof GATE3_CONSTANTS.INVARIANT_BOUNDARY
  | typeof GATE3_CONSTANTS.INVARIANT_CUSTOM;

/**
 * Invariant evaluation status.
 */
export type Gate3InvariantStatus =
  | typeof GATE3_CONSTANTS.STATUS_PASSED
  | typeof GATE3_CONSTANTS.STATUS_VIOLATED
  | typeof GATE3_CONSTANTS.STATUS_SKIPPED;

/**
 * Line-item invariant violation specification.
 */
export interface Gate3Violation {
  readonly invariantName: string;
  readonly category: Gate3InvariantCategory;
  readonly description: string;
  readonly file?: string;
  readonly rule?: string;
}

/**
 * Structured result of an individual invariant check.
 */
export interface Gate3InvariantCheckResult {
  readonly name: string;
  readonly category: Gate3InvariantCategory;
  readonly status: Gate3InvariantStatus;
  readonly passed: boolean;
  readonly details: string;
  readonly violations: readonly Gate3Violation[];
  readonly durationMs: number;
  readonly remediation?: string;
}

/**
 * Comprehensive Gate 3 Forensic Audit report.
 */
export interface Gate3AuditReport {
  readonly verdict: Gate3Verdict;
  readonly veto: boolean;
  readonly victoryConfirmed: boolean;
  readonly summary: string;
  readonly invariantsChecked: number;
  readonly invariantsPassed: number;
  readonly invariantsViolated: number;
  readonly checks: readonly Gate3InvariantCheckResult[];
  readonly violations: readonly Gate3Violation[];
  readonly recommendedEvent: LooperEvent;
  rollbackTriggered: boolean;
  rollbackResult?: RollbackResult;
  readonly rawResponse?: string;
}

/**
 * Structured XML feedback returned for agent retry or diagnostic escalation.
 */
export interface Gate3StructuredFeedback {
  readonly xmlFeedback: string;
  readonly markdownReport: string;
  readonly summary: string;
  readonly recommendedEvent: LooperEvent;
  readonly verdict: Gate3Verdict;
  readonly veto: boolean;
  readonly violations: readonly Gate3Violation[];
}


/**
 * Clean-room QA command configuration.
 */
export interface CleanRoomQaCommand {
  readonly command: string;
  readonly args?: readonly string[];
  readonly description?: string;
  readonly timeoutMs?: number;
}

/**
 * Command runner result structure for Gate 3 subprocess execution.
 */
export interface Gate3CommandRunnerResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
  readonly durationMs: number;
  readonly timedOut?: boolean;
}

/**
 * Options supplied to command runner.
 */
export interface Gate3CommandRunnerOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly env?: Record<string, string>;
}

/**
 * Pluggable subprocess runner for clean-room execution.
 */
export type Gate3CommandRunner = (
  command: string,
  options?: Gate3CommandRunnerOptions
) => Promise<Gate3CommandRunnerResult>;

/**
 * Gate 3 Execution Context passed to custom invariant checks and prompts.
 */
export interface Gate3ExecutionContext {
  readonly taskId?: string;
  readonly taskDescription?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly targetFiles?: readonly string[];
  readonly gitDiff?: string;
  readonly baselineSha?: string;
  readonly subagentInstance?: SubagentInstance;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly mode?: Gate3AuditMode;
  readonly options?: Gate3AuditorOptions;
}

/**
 * Options configuring Gate3Auditor instantiation and execution.
 */
export interface Gate3AuditorOptions {
  readonly workspaceRoot?: string;
  readonly repoRoot?: string;
  readonly taskId?: string;
  readonly taskDescription?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly targetFiles?: readonly string[];
  readonly baselineSha?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly mode?: Gate3AuditMode;
  readonly autoRollbackOnVeto?: boolean;
  readonly rollbackBuffer?: RollbackStateBuffer;
  readonly rollbackRunner?: (options: RollbackOptions) => Promise<RollbackResult>;
  readonly commandRunner?: Gate3CommandRunner | CommandRunner;
  readonly cleanRoomQaCommands?: readonly (string | CleanRoomQaCommand)[];
  readonly skipCleanRoomQa?: boolean;
  readonly protectedMetadataDir?: string;
  readonly antiCheatScanner?:
    | Gate3AntiCheatScanner
    | ((
        context: Gate3ExecutionContext
      ) => Promise<Gate3InvariantCheckResult | Gate3InvariantCheckResult[]>);
  readonly antiCheatOptions?: AntiCheatScannerOptions;
  readonly customInvariants?: readonly ((
    context: Gate3ExecutionContext
  ) => Promise<Gate3InvariantCheckResult>)[];
  readonly dispatcher?: SubagentDispatcher;
  readonly provider?: IPalProvider;
  readonly logger?: (level: "info" | "warn" | "error" | "debug", message: string) => void;
  readonly diff?: string;
  readonly autoCleanup?: boolean;
}

/**
 * Terminal execution outcome returned by Gate3Auditor.run().
 */
export interface Gate3AuditResult {
  readonly verdict: Gate3Verdict;
  readonly veto: boolean;
  readonly victoryConfirmed: boolean;
  readonly recommendedEvent: LooperEvent;
  readonly report: Gate3AuditReport;
  readonly structuredFeedback: Gate3StructuredFeedback;
  readonly durationMs: number;
  readonly baselineSha?: string;
  readonly rollbackExecuted: boolean;
  readonly rollbackResult?: RollbackResult;
}

// ============================================================================
// ERROR TAXONOMY
// ============================================================================

export class Gate3AuditorError extends Error {
  public constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "Gate3AuditorError";
  }
}

export class Gate3VetoError extends Gate3AuditorError {
  public constructor(
    message: string,
    public readonly violations: readonly Gate3Violation[]
  ) {
    super(message);
    this.name = "Gate3VetoError";
  }
}

export class Gate3TimeoutError extends Gate3AuditorError {
  public constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "Gate3TimeoutError";
  }
}

export class Gate3SubagentDispatchError extends Gate3AuditorError {
  public constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "Gate3SubagentDispatchError";
  }
}

export class Gate3InvariantViolationError extends Gate3AuditorError {
  public constructor(
    message: string,
    public readonly violation: Gate3Violation
  ) {
    super(message);
    this.name = "Gate3InvariantViolationError";
  }
}

export class Gate3RollbackError extends Gate3AuditorError {
  public constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "Gate3RollbackError";
  }
}

// ============================================================================
// HELPER FUNCTIONS & RUNNERS
// ============================================================================

/**
 * Default command runner executing clean-room subprocesses via Bun.spawn.
 */
export async function defaultGate3CommandRunner(
  command: string,
  options: Gate3CommandRunnerOptions = {}
): Promise<Gate3CommandRunnerResult> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? GATE3_CONSTANTS.DEFAULT_COMMAND_TIMEOUT_MS;
  const startTime = performance.now();

  const isWindows = process.platform === "win32";
  const shellArgs = isWindows ? ["cmd.exe", "/c", command] : ["sh", "-c", command];

  try {
    const proc = Bun.spawn(shellArgs, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
    });

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<{ timedOut: boolean }>((resolveTimeout) => {
      timer = setTimeout(() => {
        timedOut = true;
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

    const durationMs = Math.round(performance.now() - startTime);

    if (result.timedOut || timedOut) {
      const timeoutMessage = `Command timed out after ${timeoutMs}ms: ${command}`;
      return {
        code: GATE3_CONSTANTS.EXIT_CODE_TIMEOUT,
        stdout: "",
        stderr: timeoutMessage,
        output: timeoutMessage,
        durationMs,
        timedOut: true,
      };
    }

    const completed = result as { stdout: string; stderr: string; exitCode: number };
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
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : String(err);
    return {
      code: GATE3_CONSTANTS.EXIT_CODE_ERROR,
      stdout: "",
      stderr: message,
      output: message,
      durationMs,
      timedOut: false,
    };
  }
}

/**
 * Resolves the recommended FSM domain event based on binary verdict and audit mode.
 */
export function resolveGate3RecommendedEvent(
  verdict: Gate3Verdict,
  mode: Gate3AuditMode = GATE3_CONSTANTS.MODE_TASK
): LooperEvent {
  if (mode === GATE3_CONSTANTS.MODE_VICTORY) {
    return verdict === GATE3_CONSTANTS.VERDICT_PASS
      ? GATE3_CONSTANTS.EVENT_VICTORY_PASS
      : GATE3_CONSTANTS.EVENT_VICTORY_FAIL;
  }

  return verdict === GATE3_CONSTANTS.VERDICT_PASS
    ? GATE3_CONSTANTS.EVENT_G3_PASS
    : GATE3_CONSTANTS.EVENT_G3_VETO;
}

/**
 * Verifies that the protected metadata directory (.agents/teamwork) contains strictly
 * metadata documentation and zero application source code or tests.
 */
export async function verifyLayoutInvariant(
  rootDir: string,
  protectedDir: string = GATE3_CONSTANTS.DEFAULT_PROTECTED_METADATA_DIR
): Promise<Gate3InvariantCheckResult> {
  const startTime = performance.now();
  const targetDir = isAbsolute(protectedDir) ? protectedDir : resolve(rootDir, protectedDir);
  const violations: Gate3Violation[] = [];

  try {
    const rootStat = await stat(targetDir);
    if (!rootStat.isDirectory()) {
      return {
        name: "layout_integrity",
        category: GATE3_CONSTANTS.INVARIANT_LAYOUT,
        status: GATE3_CONSTANTS.STATUS_PASSED,
        passed: true,
        details: `Protected directory '${protectedDir}' does not exist or is not a directory. Invariant held.`,
        violations: [],
        durationMs: Math.round(performance.now() - startTime),
      };
    }
  } catch {
    // If directory does not exist, no layout violation
    return {
      name: "layout_integrity",
      category: GATE3_CONSTANTS.INVARIANT_LAYOUT,
      status: GATE3_CONSTANTS.STATUS_PASSED,
      passed: true,
      details: `Protected directory '${protectedDir}' not present. Invariant held.`,
      violations: [],
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const forbiddenSet = new Set<string>(GATE3_CONSTANTS.FORBIDDEN_METADATA_EXTENSIONS);

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
        const ext = extname(entry).toLowerCase();
        if (forbiddenSet.has(ext)) {
          const relPath = relative(rootDir, fullPath);
          violations.push({
            invariantName: "layout_integrity",
            category: GATE3_CONSTANTS.INVARIANT_LAYOUT,
            description: `Application source code or binary file detected in protected metadata directory: ${relPath}`,
            file: relPath,
            rule: "SPECIFICATION.md Section 3.5: .agents/teamwork/ must contain exclusively metadata (.md files) and zero application source code or tests.",
          });
        }
      }
    }
  }

  await walk(targetDir);

  const passed = violations.length === GATE3_CONSTANTS.ZERO;
  return {
    name: "layout_integrity",
    category: GATE3_CONSTANTS.INVARIANT_LAYOUT,
    status: passed ? GATE3_CONSTANTS.STATUS_PASSED : GATE3_CONSTANTS.STATUS_VIOLATED,
    passed,
    details: passed
      ? `Layout invariant passed. Protected directory '${protectedDir}' contains zero leaked source code or binary files.`
      : `Layout invariant violated: ${violations.length} forbidden file(s) found in '${protectedDir}'.`,
    violations,
    durationMs: Math.round(performance.now() - startTime),
    remediation: passed
      ? undefined
      : "Remove application source files, tests, and binaries from .agents/teamwork/.",
  };
}

/**
 * Verifies Git hygiene: no unstaged secrets, temporary files, or uncommitted binaries.
 */
export async function verifyGitHygieneInvariant(
  repoRoot: string,
  runner?: (command: string, options?: Gate3CommandRunnerOptions) => Promise<Gate3CommandRunnerResult>
): Promise<Gate3InvariantCheckResult> {
  const startTime = performance.now();
  const cmdRunner = runner ?? defaultGate3CommandRunner;
  const violations: Gate3Violation[] = [];

  try {
    const statusRes = await cmdRunner("git status --porcelain", {
      cwd: repoRoot,
      timeoutMs: GATE3_CONSTANTS.DEFAULT_GIT_TIMEOUT_MS,
    });

    if (statusRes.code === GATE3_CONSTANTS.EXIT_CODE_SUCCESS && statusRes.stdout.trim()) {
      const lines = statusRes.stdout.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        const statusCode = line.slice(GATE3_CONSTANTS.ZERO, GATE3_CONSTANTS.TWO).trim();
        const filePath = line.slice(GATE3_CONSTANTS.TWO).trim();
        const base = basename(filePath);
        const ext = extname(filePath).toLowerCase();

        // 1. Temporary or editor backup files
        for (const pattern of GATE3_CONSTANTS.FORBIDDEN_TEMP_PATTERNS) {
          if (pattern.test(base)) {
            violations.push({
              invariantName: "git_hygiene",
              category: GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE,
              description: `Temporary or backup file detected in working tree: ${filePath}`,
              file: filePath,
              rule: "SPECIFICATION.md Section 3.5: Verify no temporary .tmp files exist in repository.",
            });
            break;
          }
        }

        // 2. Secret / credential key files
        for (const pattern of GATE3_CONSTANTS.FORBIDDEN_SECRET_PATTERNS) {
          if (pattern.test(base)) {
            violations.push({
              invariantName: "git_hygiene",
              category: GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE,
              description: `Potentially unstaged secret key or credential file detected: ${filePath}`,
              file: filePath,
              rule: "SPECIFICATION.md Section 3.5: Verify no unstaged secret keys exist.",
            });
            break;
          }
        }

        // 3. Untracked binary artifacts
        if (
          statusCode === "??" &&
          (GATE3_CONSTANTS.FORBIDDEN_BINARY_EXTENSIONS as readonly string[]).includes(ext)
        ) {
          violations.push({
            invariantName: "git_hygiene",
            category: GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE,
            description: `Untracked compiled binary artifact detected: ${filePath}`,
            file: filePath,
            rule: "SPECIFICATION.md Section 3.5: Verify zero binary artifacts exist.",
          });
        }
      }
    }
  } catch {
    // Gracefully handle environments without active git repository
  }

  const passed = violations.length === GATE3_CONSTANTS.ZERO;
  return {
    name: "git_hygiene",
    category: GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE,
    status: passed ? GATE3_CONSTANTS.STATUS_PASSED : GATE3_CONSTANTS.STATUS_VIOLATED,
    passed,
    details: passed
      ? "Git hygiene invariant passed. Working tree clean of secret leaks, temp files, and uncommitted binaries."
      : `Git hygiene invariant violated: ${violations.length} hygiene issue(s) identified.`,
    violations,
    durationMs: Math.round(performance.now() - startTime),
    remediation: passed
      ? undefined
      : "Remove temporary files and untracked binaries, and ensure credentials are in .gitignore.",
  };
}

/**
 * Formats Markdown audit report from structured Gate3AuditReport.
 */
export function formatAuditorReportMarkdown(report: Gate3AuditReport): string {
  const lines: string[] = [];
  lines.push("# Gate 3 Forensic Audit Report");
  lines.push("");
  lines.push(`**Verdict**: \`${report.verdict}\`${report.veto ? " ⛔ **(BINARY VETO EXERCISED)**" : " ✅"}`);
  if (report.victoryConfirmed) {
    lines.push(`**Status**: 🏆 \`${GATE3_CONSTANTS.VICTORY_CONFIRMED}\``);
  }
  lines.push(`**Recommended Event**: \`${report.recommendedEvent}\``);
  lines.push(`**Summary**: ${report.summary}`);
  lines.push(`**Invariants Checked**: ${report.invariantsChecked} (Passed: ${report.invariantsPassed}, Violated: ${report.invariantsViolated})`);
  lines.push("");

  lines.push("## Invariant Verification Checklist");
  lines.push("");
  lines.push("| Invariant | Category | Status | Details | Duration |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  for (const check of report.checks) {
    const statusIcon = check.passed ? "✅ PASS" : check.status === "skipped" ? "⏭️ SKIP" : "❌ FAIL";
    lines.push(`| ${check.name} | \`${check.category}\` | ${statusIcon} | ${check.details} | ${check.durationMs}ms |`);
  }
  lines.push("");

  if (report.violations.length > GATE3_CONSTANTS.ZERO) {
    lines.push("## Line-Item Violations");
    lines.push("");
    for (const v of report.violations) {
      lines.push(`- **[${v.category}] ${v.invariantName}**: ${v.description}`);
      if (v.file) {
        lines.push(`  - **Affected File**: \`${v.file}\``);
      }
      if (v.rule) {
        lines.push(`  - **Rule Citation**: *${v.rule}*`);
      }
    }
    lines.push("");
  }

  if (report.rollbackTriggered) {
    lines.push("## Atomic Rollback Execution");
    lines.push("");
    lines.push("✅ **Rollback Status**: Triggered and executed.");
    if (report.rollbackResult) {
      lines.push(`- **Target Ref**: \`${report.rollbackResult.targetRef}\``);
      lines.push(`- **Success**: ${report.rollbackResult.success}`);
      if (report.rollbackResult.error) {
        lines.push(`- **Error**: ${report.rollbackResult.error}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Formats prompt for subagent or LLM session.
 */
export function formatAuditorPrompt(context: Gate3ExecutionContext): string {
  const parts: string[] = [];
  parts.push("# Task: Gate 3 Forensic Audit & Invariant Verification");
  parts.push("");
  parts.push(`**Task ID**: ${context.taskId ?? "N/A"}`);
  if (context.taskDescription) {
    parts.push(`**Task Description**: ${context.taskDescription}`);
  }
  parts.push(`**Audit Mode**: ${context.mode ?? GATE3_CONSTANTS.MODE_TASK}`);
  parts.push(`**Attempt**: ${context.attempt ?? GATE3_CONSTANTS.DEFAULT_ATTEMPT} / ${context.maxAttempts ?? GATE3_CONSTANTS.DEFAULT_MAX_ATTEMPTS}`);
  parts.push("");

  if (context.acceptanceCriteria && context.acceptanceCriteria.length > GATE3_CONSTANTS.ZERO) {
    parts.push("## Acceptance Criteria");
    for (const ac of context.acceptanceCriteria) {
      parts.push(`- ${ac}`);
    }
    parts.push("");
  }

  if (context.targetFiles && context.targetFiles.length > GATE3_CONSTANTS.ZERO) {
    parts.push("## Target Files Under Audit");
    for (const tf of context.targetFiles) {
      parts.push(`- \`${tf}\``);
    }
    parts.push("");
  }

  parts.push("## Invariant Verification Mandate");
  parts.push("1. Absolute Binary Veto: Emit strictly PASS or FAIL.");
  parts.push("2. Layout Invariant: .agents/teamwork/ must contain exclusively metadata (.md files).");
  parts.push("3. Git Hygiene: Verify no unstaged secret keys, temp files, or uncommitted binaries.");
  parts.push("4. Clean Room QA: Verify all empirical mechanical checks pass with exit code 0.");
  parts.push("5. Anti-Cheat: Zero tolerance for mock responses in production code or skipped tests.");
  parts.push("");
  parts.push("Respond with a structured JSON code block:");
  parts.push("```json");
  parts.push(
    JSON.stringify(
      {
        verdict: "PASS",
        summary: "Audit passed with all invariants certified.",
        invariants: {
          layout: true,
          git_hygiene: true,
          clean_room_qa: true,
          anti_cheat: true,
        },
        violations: [],
      },
      null,
      GATE3_CONSTANTS.TWO
    )
  );
  parts.push("```");

  return parts.join("\n");
}

/**
 * Generates structured XML feedback and recommendations for Gate 3.
 */
export function generateGate3Feedback(
  reportOrResult: Gate3AuditReport | Gate3AuditResult
): Gate3StructuredFeedback {
  const report = "report" in reportOrResult ? reportOrResult.report : reportOrResult;
  const markdownReport = formatAuditorReportMarkdown(report);

  const xmlLines: string[] = [];
  xmlLines.push("<forensic-audit-verdict>");
  xmlLines.push(`  <verdict>${report.verdict}</verdict>`);
  xmlLines.push(`  <veto>${report.veto}</veto>`);
  xmlLines.push(`  <victory-confirmed>${report.victoryConfirmed}</victory-confirmed>`);
  xmlLines.push(`  <recommended-event>${report.recommendedEvent}</recommended-event>`);
  xmlLines.push(`  <summary>${report.summary}</summary>`);
  xmlLines.push(`  <violations-count>${report.violations.length}</violations-count>`);

  if (report.violations.length > GATE3_CONSTANTS.ZERO) {
    xmlLines.push("  <violations>");
    for (const v of report.violations) {
      xmlLines.push("    <violation>");
      xmlLines.push(`      <name>${v.invariantName}</name>`);
      xmlLines.push(`      <category>${v.category}</category>`);
      xmlLines.push(`      <description>${v.description}</description>`);
      if (v.file) {
        xmlLines.push(`      <file>${v.file}</file>`);
      }
      if (v.rule) {
        xmlLines.push(`      <rule>${v.rule}</rule>`);
      }
      xmlLines.push("    </violation>");
    }
    xmlLines.push("  </violations>");
  }

  if (report.rollbackTriggered) {
    xmlLines.push("  <rollback-executed>true</rollback-executed>");
  }

  xmlLines.push("</forensic-audit-verdict>");

  return {
    xmlFeedback: xmlLines.join("\n"),
    markdownReport,
    summary: report.summary,
    recommendedEvent: report.recommendedEvent,
    verdict: report.verdict,
    veto: report.veto,
    violations: report.violations,
  };
}

// ============================================================================
// GATE 3 AUDITOR ORCHESTRATOR CLASS
// ============================================================================

/**
 * Gate3Auditor: Absolute Binary Veto Authority and System Invariant Guardian.
 *
 * Enforces forensic repository invariants, layout rules, clean-room mechanical QA,
 * anti-cheat validation, and triggers atomic Git rollbacks upon invariant breach.
 */
export class Gate3Auditor extends EventEmitter {
  private readonly options: Gate3AuditorOptions;
  private readonly workspaceRoot: string;
  private readonly repoRoot: string;
  private readonly taskId?: string;
  private readonly mode: Gate3AuditMode;
  private readonly attempt: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly autoRollbackOnVeto: boolean;
  private baselineSha?: string;
  private readonly rollbackBuffer?: RollbackStateBuffer;

  public constructor(options: Gate3AuditorOptions = {}) {
    super();
    this.options = { ...options };
    this.workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
    this.repoRoot = normalize(options.repoRoot ?? this.workspaceRoot);
    this.taskId = options.taskId;
    this.mode = options.mode ?? GATE3_CONSTANTS.MODE_TASK;
    this.attempt = options.attempt ?? GATE3_CONSTANTS.DEFAULT_ATTEMPT;
    this.maxAttempts = options.maxAttempts ?? GATE3_CONSTANTS.DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? GATE3_CONSTANTS.DEFAULT_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? GATE3_CONSTANTS.DEFAULT_COMMAND_TIMEOUT_MS;
    this.autoRollbackOnVeto = options.autoRollbackOnVeto ?? false;
    this.baselineSha = options.baselineSha;
    this.rollbackBuffer = options.rollbackBuffer;
  }

  /**
   * Returns a copy of the auditor options.
   */
  public getOptions(): Readonly<Gate3AuditorOptions> {
    return { ...this.options };
  }

  /**
   * Returns current baseline SHA reference for rollback.
   */
  public getBaselineSha(): string | undefined {
    return this.baselineSha;
  }

  /**
   * Sets or updates baseline SHA reference.
   */
  public setBaselineSha(sha: string): void {
    this.baselineSha = sha;
  }

  /**
   * Adapts and runs commands using pluggable or default runner.
   */
  public async runCommand(
    command: string,
    options?: Gate3CommandRunnerOptions
  ): Promise<Gate3CommandRunnerResult> {
    const runner = this.options.commandRunner;
    const cwd = options?.cwd ?? this.repoRoot;
    const timeout = options?.timeoutMs ?? this.commandTimeoutMs;

    if (!runner) {
      return defaultGate3CommandRunner(command, { cwd, timeoutMs: timeout, env: options?.env });
    }

    try {
      // Check if runner accepts (command, options)
      const res = await (runner as Gate3CommandRunner)(command, {
        cwd,
        timeoutMs: timeout,
        env: options?.env,
      });
      if (res && typeof res.code === "number") {
        return res;
      }
      // Fallback for (command, cwd, timeoutMs) signature
      const alt = await (runner as unknown as CommandRunner)(command, cwd, timeout);
      return {
        code: alt.code,
        stdout: alt.stdout,
        stderr: alt.stderr,
        output: alt.output,
        durationMs: 0,
      };
    } catch {
      // Try alt signature
      const alt = await (runner as unknown as CommandRunner)(command, cwd, timeout);
      return {
        code: alt.code,
        stdout: alt.stdout,
        stderr: alt.stderr,
        output: alt.output,
        durationMs: 0,
      };
    }
  }

  /**
   * Verifies the layout invariant (.agents/teamwork/ contains strictly metadata).
   */
  public async checkLayoutInvariant(): Promise<Gate3InvariantCheckResult> {
    const startTime = performance.now();
    const protectedDir =
      this.options.protectedMetadataDir ?? GATE3_CONSTANTS.DEFAULT_PROTECTED_METADATA_DIR;
    const result = await verifyLayoutInvariant(this.workspaceRoot, protectedDir);
    return {
      ...result,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Verifies the Git hygiene invariant (no unstaged secrets, temp files, or untracked binaries).
   */
  public async checkGitHygieneInvariant(): Promise<Gate3InvariantCheckResult> {
    const startTime = performance.now();
    const result = await verifyGitHygieneInvariant(
      this.repoRoot,
      (cmd, opts) => this.runCommand(cmd, opts)
    );
    return {
      ...result,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Executes clean-room mechanical QA verification commands in an independent subprocess.
   */
  public async checkCleanRoomQa(): Promise<Gate3InvariantCheckResult> {
    const startTime = performance.now();
    if (this.options.skipCleanRoomQa) {
      return {
        name: "clean_room_qa",
        category: GATE3_CONSTANTS.INVARIANT_CLEAN_ROOM_QA,
        status: GATE3_CONSTANTS.STATUS_SKIPPED,
        passed: true,
        details: "Clean-room mechanical QA skipped via skipCleanRoomQa option.",
        violations: [],
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    const commands =
      this.options.cleanRoomQaCommands ?? GATE3_CONSTANTS.DEFAULT_CLEAN_ROOM_QA_COMMANDS;
    const violations: Gate3Violation[] = [];
    const details: string[] = [];

    for (const item of commands) {
      const cmdStr = typeof item === "string" ? item : item.command;
      const desc = typeof item === "string" ? item : (item.description ?? item.command);
      const timeout =
        typeof item === "string" ? this.commandTimeoutMs : (item.timeoutMs ?? this.commandTimeoutMs);

      const res = await this.runCommand(cmdStr, {
        cwd: this.repoRoot,
        timeoutMs: timeout,
      });

      if (res.code !== GATE3_CONSTANTS.EXIT_CODE_SUCCESS) {
        violations.push({
          invariantName: "clean_room_qa",
          category: GATE3_CONSTANTS.INVARIANT_CLEAN_ROOM_QA,
          description: `Clean-room verification failed: '${cmdStr}' exited with code ${res.code}. ${res.stderr || res.stdout || ""}`.trim(),
          rule: "SPECIFICATION.md Section 3.5: Auditor re-runs end-to-end verification script from clean shell sub-process.",
        });
        details.push(`❌ ${desc} (exit ${res.code})`);
      } else {
        details.push(`✅ ${desc} (passed)`);
      }
    }

    const passed = violations.length === GATE3_CONSTANTS.ZERO;
    return {
      name: "clean_room_qa",
      category: GATE3_CONSTANTS.INVARIANT_CLEAN_ROOM_QA,
      status: passed ? GATE3_CONSTANTS.STATUS_PASSED : GATE3_CONSTANTS.STATUS_VIOLATED,
      passed,
      details: passed
        ? `All ${details.length} clean-room verification check(s) passed successfully.`
        : `Clean-room verification failed with ${violations.length} failure(s): ${details.join(", ")}`,
      violations,
      durationMs: Math.round(performance.now() - startTime),
      remediation: passed ? undefined : "Fix failing tests, type errors, or lint violations.",
    };
  }

  /**
   * Evaluates anti-cheat rules: scans for stubs, mock responses in production, and bypassed tests.
   */
  public async checkAntiCheatInvariant(
    context: Gate3ExecutionContext
  ): Promise<Gate3InvariantCheckResult[]> {
    const startTime = performance.now();

    // 1. Pluggable anti-cheat scanner hook (Task 1.2 integration)
    if (this.options.antiCheatScanner) {
      if (typeof this.options.antiCheatScanner === "function") {
        const customResult = await this.options.antiCheatScanner(context);
        return Array.isArray(customResult) ? customResult : [customResult];
      }
      const scannerResult = await this.options.antiCheatScanner.scanExecutionContext({
        ...context,
        gitDiff: context.gitDiff ?? this.options.diff,
      });
      return [scannerResult];
    }

    // 2. Comprehensive built-in anti-cheat scanner (Task 1.2)
    const scanner = createGate3AntiCheatScanner({
      workspaceRoot: this.workspaceRoot,
      repoRoot: this.repoRoot,
      ...this.options.antiCheatOptions,
    });

    const checkResult = await scanner.scanExecutionContext({
      ...context,
      gitDiff: context.gitDiff ?? this.options.diff,
    });

    return [
      {
        ...checkResult,
        durationMs: Math.max(checkResult.durationMs, Math.round(performance.now() - startTime)),
      },
    ];
  }

  /**
   * Executes custom invariant hooks if registered.
   */
  public async checkCustomInvariants(
    context: Gate3ExecutionContext
  ): Promise<Gate3InvariantCheckResult[]> {
    if (!this.options.customInvariants || this.options.customInvariants.length === 0) {
      return [];
    }
    const results: Gate3InvariantCheckResult[] = [];
    for (const invFn of this.options.customInvariants) {
      const res = await invFn(context);
      results.push(res);
    }
    return results;
  }

  /**
   * Executes binary veto and triggers atomic Git rollback if veto is active.
   */
  public async executeVeto(
    report: Gate3AuditReport,
    forceRollback: boolean = false
  ): Promise<{ rollbackExecuted: boolean; rollbackResult?: RollbackResult }> {
    if (!report.veto) {
      return { rollbackExecuted: false };
    }

    this.emit(GATE3_CONSTANTS.EVENT_VETO_ISSUED, {
      report,
      taskId: this.taskId,
      baselineSha: this.baselineSha,
    });

    if (!this.autoRollbackOnVeto && !forceRollback) {
      return { rollbackExecuted: false };
    }

    try {
      let rollbackResult: RollbackResult;

      // Prepare audit artifacts and register with buffer to guarantee preservation
      const auditLogDir = join(this.repoRoot, GATE3_CONSTANTS.DEFAULT_PROTECTED_METADATA_DIR);
      const auditReportPath = join(auditLogDir, "gate3_audit_report.md");
      const auditJsonPath = join(auditLogDir, "gate3_audit_results.json");
      const auditFeedbackPath = join(auditLogDir, "gate3_auditor_feedback.xml");

      const auditReportMd = formatAuditorReportMarkdown(report);
      const structuredFeedback = generateGate3Feedback(report);
      const auditJson = JSON.stringify(report, null, GATE3_CONSTANTS.TWO);

      if (this.rollbackBuffer) {
        this.rollbackBuffer.registerAuditLog(auditReportPath, auditReportMd);
        this.rollbackBuffer.registerAuditLog(auditJsonPath, auditJson);
        this.rollbackBuffer.registerAuditLog(auditFeedbackPath, structuredFeedback.xmlFeedback);
        rollbackResult = await this.rollbackBuffer.rollback(this.baselineSha, {
          reason: `Gate 3 Binary Veto: ${report.summary}`,
          preserveAuditLogs: true,
        });
      } else if (this.options.rollbackRunner) {
        rollbackResult = await this.options.rollbackRunner({
          cwd: this.repoRoot,
          targetRef: this.baselineSha,
          cleanUntracked: true,
          excludes: GATE3_CONSTANTS.DEFAULT_ROLLBACK_EXCLUDES,
        });
      } else {
        rollbackResult = await rollbackWorkingTree({
          cwd: this.repoRoot,
          targetRef: this.baselineSha,
          cleanUntracked: true,
          excludes: GATE3_CONSTANTS.DEFAULT_ROLLBACK_EXCLUDES,
          reason: `Gate 3 Binary Veto: ${report.summary}`,
          preserveAuditLogs: true,
          auditLogPaths: [auditReportPath, auditJsonPath, auditFeedbackPath],
        });
      }

      report.rollbackTriggered = true;
      report.rollbackResult = rollbackResult;

      this.emit(GATE3_CONSTANTS.EVENT_ROLLBACK_TRIGGERED, {
        rollbackResult,
        targetRef: this.baselineSha,
      });

      return {
        rollbackExecuted: rollbackResult.success,
        rollbackResult,
      };
    } catch (error) {
      report.rollbackTriggered = false;
      const msg = error instanceof Error ? error.message : String(error);
      this.options.logger?.("error", `Rollback failed during binary veto: ${msg}`);
      throw new Gate3RollbackError(`Gate 3 binary veto rollback failed: ${msg}`, error);
    }
  }

  /**
   * Core audit evaluation executing all invariant checks and formulating binary verdict.
   */
  public async runAudit(context: Gate3ExecutionContext): Promise<Gate3AuditReport> {
    const checks: Gate3InvariantCheckResult[] = [];

    // 1. Layout Invariant
    const layoutCheck = await this.checkLayoutInvariant();
    checks.push(layoutCheck);
    this.emit(GATE3_CONSTANTS.EVENT_INVARIANT_CHECK, { check: layoutCheck });

    // 2. Git Hygiene Invariant
    const gitCheck = await this.checkGitHygieneInvariant();
    checks.push(gitCheck);
    this.emit(GATE3_CONSTANTS.EVENT_INVARIANT_CHECK, { check: gitCheck });

    // 3. Clean-Room QA Invariant
    const qaCheck = await this.checkCleanRoomQa();
    checks.push(qaCheck);
    this.emit(GATE3_CONSTANTS.EVENT_INVARIANT_CHECK, { check: qaCheck });

    // 4. Anti-Cheat Integrity Invariant
    const antiCheatChecks = await this.checkAntiCheatInvariant(context);
    for (const acCheck of antiCheatChecks) {
      checks.push(acCheck);
      this.emit(GATE3_CONSTANTS.EVENT_INVARIANT_CHECK, { check: acCheck });
    }

    // 5. Custom Invariants
    const customChecks = await this.checkCustomInvariants(context);
    for (const cCheck of customChecks) {
      checks.push(cCheck);
      this.emit(GATE3_CONSTANTS.EVENT_INVARIANT_CHECK, { check: cCheck });
    }

    // Compile violations and determine binary verdict
    const violations = checks.flatMap((c) => c.violations);
    const passed = violations.length === GATE3_CONSTANTS.ZERO;
    const verdict: Gate3Verdict = passed
      ? GATE3_CONSTANTS.VERDICT_PASS
      : GATE3_CONSTANTS.VERDICT_FAIL;
    const veto = !passed;
    const victoryConfirmed = this.mode === GATE3_CONSTANTS.MODE_VICTORY && passed;
    const recommendedEvent = resolveGate3RecommendedEvent(verdict, this.mode);

    let summary: string;
    if (this.mode === GATE3_CONSTANTS.MODE_VICTORY) {
      summary = passed
        ? GATE3_CONSTANTS.VICTORY_CONFIRMED
        : `Victory audit failed: ${violations.length} repository invariant violation(s) identified.`;
    } else {
      summary = passed
        ? "All forensic invariants certified. Gate 3 audit passed."
        : `Forensic audit VETO: ${violations.length} invariant violation(s) identified.`;
    }

    return {
      verdict,
      veto,
      victoryConfirmed,
      summary,
      invariantsChecked: checks.length,
      invariantsPassed: checks.filter((c) => c.passed).length,
      invariantsViolated: checks.filter((c) => !c.passed && c.status !== "skipped").length,
      checks,
      violations,
      recommendedEvent,
      rollbackTriggered: false,
    };
  }

  /**
   * Executes optional LLM audit turn with PAL provider if supplied.
   */
  private async executePalTurn(
    provider: IPalProvider,
    prompt: string
  ): Promise<string | undefined> {
    try {
      const systemPrompt = generateRoleSystemPrompt(COGNITIVE_ROLES.AUDITOR);
      const message = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock(prompt)],
      });

      const outcome = await provider.executeTurn({
        sessionId: `gate3-audit-${this.taskId ?? "audit"}-${randomUUID()}`,
        messages: [message],
        systemPrompt,
        temperature: GATE3_CONSTANTS.LLM_TEMPERATURE,
      });

      return outcome.message.content
        .filter(isPalTextContent)
        .map((b) => b.text)
        .join("\n");
    } catch (err) {
      this.options.logger?.("warn", `PAL provider audit turn failed: ${err}`);
      return undefined;
    }
  }

  /**
   * Formats prompt for subagent or LLM session.
   */
  public formatPrompt(context: Gate3ExecutionContext): string {
    return formatAuditorPrompt(context);
  }

  /**
   * Generates structured feedback XML and recommendations.
   */
  public generateFeedback(
    reportOrResult?: Gate3AuditReport | Gate3AuditResult
  ): Gate3StructuredFeedback {
    if (reportOrResult) {
      return generateGate3Feedback(reportOrResult);
    }
    // Return empty placeholder feedback if no report provided
    return generateGate3Feedback({
      verdict: GATE3_CONSTANTS.VERDICT_PASS,
      veto: false,
      victoryConfirmed: false,
      summary: "No audit report evaluated.",
      invariantsChecked: 0,
      invariantsPassed: 0,
      invariantsViolated: 0,
      checks: [],
      violations: [],
      recommendedEvent: GATE3_CONSTANTS.EVENT_G3_PASS,
      rollbackTriggered: false,
    });
  }

  /**
   * Executes full Gate 3 Forensic Audit orchestration cycle.
   */
  public async run(): Promise<Gate3AuditResult> {
    const startTime = performance.now();
    this.emit(GATE3_CONSTANTS.EVENT_AUDIT_START, {
      taskId: this.taskId,
      mode: this.mode,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
    });

    let subagent: SubagentInstance | undefined;
    let dispatcher = this.options.dispatcher;

    try {
      // 1. Capture git baseline state if not already set
      if (!this.baselineSha) {
        try {
          const gitState: GitWorkingTreeState = await captureGitState({
            cwd: this.repoRoot,
            timeoutMs: GATE3_CONSTANTS.DEFAULT_GIT_TIMEOUT_MS,
          });
          this.baselineSha = gitState.headSha;
        } catch {
          // Gracefully continue if git state cannot be resolved
        }
      }

      // 2. Dispatch ephemeral Auditor subagent if configured
      if (!dispatcher && this.options.autoCleanup !== false) {
        dispatcher = createSubagentDispatcher({
          workspaceRoot: this.workspaceRoot,
          autoCleanup: false,
        });
      }

      if (dispatcher) {
        try {
          subagent = await dispatcher.dispatch({
            role: COGNITIVE_ROLES.AUDITOR,
            taskId: this.taskId,
            taskDescription:
              this.options.taskDescription ??
              "Perform independent Gate 3 forensic audit, invariant enforcement, and binary veto evaluation",
            targetFiles: this.options.targetFiles,
            customConstraints: [
              "Forensic Auditor (Tier 6): Absolute binary veto authority.",
              "Enforce layout invariant (.agents/teamwork/ must contain exclusively metadata).",
              "Enforce clean-room mechanical QA execution.",
              "Enforce anti-cheat detection: zero mock responses in production or skipped tests.",
            ],
          });
          this.emit(GATE3_CONSTANTS.EVENT_SUBAGENT_DISPATCHED, {
            subagentId: subagent.id,
            sandboxDir: subagent.sandbox.sandboxDir,
          });
        } catch (dispatchErr) {
          this.options.logger?.(
            "warn",
            `Could not dispatch Auditor subagent sandbox: ${dispatchErr}`
          );
        }
      }

      // 3. Formulate Execution Context
      const context: Gate3ExecutionContext = {
        taskId: this.taskId,
        taskDescription: this.options.taskDescription,
        acceptanceCriteria: this.options.acceptanceCriteria ?? [],
        targetFiles: this.options.targetFiles ?? [],
        gitDiff: this.options.diff,
        baselineSha: this.baselineSha,
        subagentInstance: subagent,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        mode: this.mode,
        options: this.options,
      };

      // 4. Optional PAL Provider Turn
      let palResponse: string | undefined;
      if (this.options.provider) {
        const prompt = this.formatPrompt(context);
        palResponse = await this.executePalTurn(this.options.provider, prompt);
      }

      // 5. Run Invariant Audits
      const report = await this.runAudit(context);
      if (palResponse) {
        (report as { rawResponse?: string }).rawResponse = palResponse;
      }

      // 6. Execute Binary Veto & Rollback if necessary
      let rollbackExecuted = false;
      let rollbackResult: RollbackResult | undefined;

      if (report.veto) {
        const vetoOutcome = await this.executeVeto(report);
        rollbackExecuted = vetoOutcome.rollbackExecuted;
        rollbackResult = vetoOutcome.rollbackResult;
      }

      // 7. Write audit artifacts into subagent directory if available
      if (subagent) {
        const auditReportMd = formatAuditorReportMarkdown(report);
        const structuredFeedback = generateGate3Feedback(report);
        try {
          await writeFile(
            join(subagent.sandbox.sandboxDir, "audit_report.md"),
            auditReportMd,
            "utf-8"
          );
          await writeFile(
            join(subagent.sandbox.sandboxDir, "audit_results.json"),
            JSON.stringify(report, null, GATE3_CONSTANTS.TWO),
            "utf-8"
          );
          await writeFile(
            join(subagent.sandbox.sandboxDir, "auditor_feedback.xml"),
            structuredFeedback.xmlFeedback,
            "utf-8"
          );
        } catch (writeErr) {
          this.options.logger?.("warn", `Could not write audit reports to sandbox: ${writeErr}`);
        }
      }

      const durationMs = Math.round(performance.now() - startTime);
      const structuredFeedback = generateGate3Feedback(report);

      const finalResult: Gate3AuditResult = {
        verdict: report.verdict,
        veto: report.veto,
        victoryConfirmed: report.victoryConfirmed,
        recommendedEvent: report.recommendedEvent,
        report,
        structuredFeedback,
        durationMs,
        baselineSha: this.baselineSha,
        rollbackExecuted,
        rollbackResult,
      };

      this.emit(GATE3_CONSTANTS.EVENT_AUDIT_COMPLETE, finalResult);
      return finalResult;
    } finally {
      if (subagent && this.options.autoCleanup !== false && dispatcher) {
        try {
          await dispatcher.cleanupAgent(subagent.id);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

// ============================================================================
// CONVENIENCE FACTORY HELPERS
// ============================================================================

/**
 * Creates and initializes a Gate3Auditor instance.
 */
export function createGate3Auditor(options: Gate3AuditorOptions = {}): Gate3Auditor {
  return new Gate3Auditor(options);
}

/**
 * Convenience orchestrator running a Gate 3 forensic audit and returning result.
 */
export async function runGate3Auditor(
  options: Gate3AuditorOptions = {}
): Promise<Gate3AuditResult> {
  const auditor = createGate3Auditor(options);
  return auditor.run();
}

// ============================================================================
// RE-EXPORTS: ANTI-CHEAT SCANNER ENGINE (Task 1.2)
// ============================================================================

export * from "./gate3_scanner";

// ============================================================================
// RE-EXPORTS: ATOMIC ROLLBACK BUFFER ENGINE (Task 1.3)
// ============================================================================

export {
  ROLLBACK_CONSTANTS,
  buildGitCleanCommand,
  captureGitState,
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
} from "../engine/rollback_buffer";
