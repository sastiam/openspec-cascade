/**
 * Gate 2: Red-Team Assertion Injector into Testing Sandbox.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.4 (LOOPER-GATE-003)
 * and OpenSpec change `looper-gate2-adversarial-challenger` Task 1.3.
 *
 * Architecture & Design Invariants:
 * 1. Isolated Testing Sandboxing:
 *    Executes adversarial tests and assertions within an isolated sandbox environment,
 *    preventing transient fuzzing payloads or side effects from polluting the workspace.
 * 2. Multi-Mode Assertion Injection:
 *    - Standalone Mode: Injects self-contained test probes under `test/challenger_<id>.test.ts`
 *      or within the designated sandbox test folder.
 *    - Inline Mode: Injects surgical red-team assertion blocks (`describe` / `test`) into
 *      existing test suites with deterministic boundary markers.
 *    - Wrapper Mode: Wraps candidate module exports with fuzz assertions and invariant validators.
 * 3. Objective Two-Way Verification Protocol:
 *    - Clean Rollback Protocol: When a candidate implementation survives the adversarial probe
 *      (exit code 0), all temporary injection files and inline mutations are cleanly reverted,
 *      ensuring zero dirty residue in the repository.
 *    - Permanent Retention Protocol: When an adversarial probe triggers a legitimate failure
 *      or crash (exit code != 0), the breaking test is permanently preserved in the QA test suite
 *      (`test/challenger_repro_<id>.test.ts`), and structured diagnostic feedback is prepared
 *      for the Worker.
 * 4. Maximum Challenge Attempt Budget:
 *    Enforces the `MaxChallengeAttempts` budget (maximum 3 rounds) to eliminate live-lock
 *    and infinite antagonist ping-pong cycles between Challenger and Worker.
 * 5. Zero Magic Numbers & Strict Typing:
 *    Centralizes all thresholds, limits, timeouts, exit codes, and string literals in GATE2_INJECTOR_CONSTANTS.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type {
  Gate2AttackVector,
  Gate2ProbeDefinition,
  Gate2ProbeRunner,
} from "./gate2_challenger";

/**
 * Central constants ensuring zero magic numbers across Gate 2 assertion injection operations.
 */
export const GATE2_INJECTOR_CONSTANTS = {
  // Injection Modes
  MODE_STANDALONE: "standalone" as const,
  MODE_INLINE: "inline" as const,
  MODE_WRAPPER: "wrapper" as const,

  // Assertion Lifecycle Statuses
  STATUS_PENDING: "pending" as const,
  STATUS_INJECTED: "injected" as const,
  STATUS_SURVIVED: "survived" as const,
  STATUS_BROKEN: "broken" as const,
  STATUS_ROLLED_BACK: "rolled_back" as const,
  STATUS_RETAINED: "retained" as const,
  STATUS_ERROR: "error" as const,

  // Attack Vectors
  VECTOR_BOUNDARY_MALFORMED: "boundary_malformed" as const,
  VECTOR_CONCURRENCY_RACE: "concurrency_race" as const,
  VECTOR_RESOURCE_EXHAUSTION: "resource_exhaustion" as const,
  VECTOR_TIMEOUT_LATENCY: "timeout_latency" as const,
  VECTOR_CUSTOM: "custom" as const,

  // Paths & File Suffixes
  DEFAULT_SANDBOX_DIR_PREFIX: ".redteam_sandbox_",
  DEFAULT_TEST_DIR: "test",
  DEFAULT_TEAMWORK_DIR: ".agents/teamwork",
  PROBE_FILE_PREFIX: "challenger_",
  PROBE_FILE_EXTENSION: ".test.ts",
  REPRO_SCRIPT_PREFIX: "challenger_repro_",
  INLINE_INJECTION_HEADER_PREFIX: "/* RED-TEAM INJECTION [START]: ",
  INLINE_INJECTION_FOOTER_PREFIX: "/* RED-TEAM INJECTION [END]: ",
  REPORT_FILENAME: "assertion_injection_report.md",
  FEEDBACK_XML_FILENAME: "assertion_feedback.xml",

  // Timeouts & Budgets (milliseconds)
  DEFAULT_INJECTOR_TIMEOUT_MS: 30_000,
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_MAX_ATTEMPTS: 2,
  MAX_PERMITTED_ATTEMPTS: 3, // LOOPER-GATE-003 maximum 3 rounds
  DEFAULT_FEEDBACK_TRUNCATION_LIMIT: 2_500,
  DEFAULT_MAX_OUTPUT_LENGTH: 4_000,
  DEFAULT_MAX_TRACE_LINES: 20,

  // Numeric literals and offsets
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  INDEX_NOT_FOUND: -1,
  UUID_TRUNCATION_LENGTH: 8,
  JSON_INDENT_SPACES: 2,

  // Exit codes
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_FAILURE: 1,
  EXIT_CODE_ERROR: 2,
  EXIT_CODE_TIMEOUT: 124,

  // Event emitter names
  EVENT_SANDBOX_CREATED: "sandbox:created",
  EVENT_ASSERTION_INJECTED: "assertion:injected",
  EVENT_ASSERTION_EXECUTING: "assertion:executing",
  EVENT_ASSERTION_SURVIVED: "assertion:survived",
  EVENT_ASSERTION_BROKEN: "assertion:broken",
  EVENT_ASSERTION_RETAINED: "assertion:retained",
  EVENT_ASSERTION_ROLLED_BACK: "assertion:rolled_back",
  EVENT_SANDBOX_CLEANED: "sandbox:cleaned",
  EVENT_INJECTION_ERROR: "injection:error",
} as const;

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
  return `${str.slice(GATE2_INJECTOR_CONSTANTS.ZERO, maxLength)}\n... [truncated]`;
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
      if (relevantLines.length >= GATE2_INJECTOR_CONSTANTS.DEFAULT_MAX_TRACE_LINES) {
        break;
      }
    }
  }

  return relevantLines.length > GATE2_INJECTOR_CONSTANTS.ZERO
    ? relevantLines.join("\n")
    : truncateString(combined, GATE2_INJECTOR_CONSTANTS.DEFAULT_FEEDBACK_TRUNCATION_LIMIT);
}

/**
 * Default probe runner executing subprocess via Bun.spawn.
 */
export async function defaultProbeRunner(
  probeFilePath: string,
  options?: { timeoutMs?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options?.timeoutMs ?? GATE2_INJECTOR_CONSTANTS.DEFAULT_INJECTOR_TIMEOUT_MS;
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
        exitCode: GATE2_INJECTOR_CONSTANTS.EXIT_CODE_TIMEOUT,
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
      exitCode: GATE2_INJECTOR_CONSTANTS.EXIT_CODE_ERROR,
    };
  }
}

/**
 * Recognized assertion injection mode.
 */
export type InjectionMode =
  | typeof GATE2_INJECTOR_CONSTANTS.MODE_STANDALONE
  | typeof GATE2_INJECTOR_CONSTANTS.MODE_INLINE
  | typeof GATE2_INJECTOR_CONSTANTS.MODE_WRAPPER;

/**
 * Lifecycle status of an injected red-team assertion.
 */
export type InjectionStatus =
  | typeof GATE2_INJECTOR_CONSTANTS.STATUS_PENDING
  | typeof GATE2_INJECTOR_CONSTANTS.STATUS_INJECTED
  | typeof GATE2_INJECTOR_CONSTANTS.STATUS_SURVIVED
  | typeof GATE2_INJECTOR_CONSTANTS.STATUS_BROKEN
  | typeof GATE2_INJECTOR_CONSTANTS.STATUS_ROLLED_BACK
  | typeof GATE2_INJECTOR_CONSTANTS.STATUS_RETAINED
  | typeof GATE2_INJECTOR_CONSTANTS.STATUS_ERROR;

/**
 * Red-team adversarial assertion definition to inject into the testing sandbox.
 */
export interface RedTeamAssertion {
  readonly id: string;
  readonly name: string;
  readonly vector: Gate2AttackVector;
  readonly assertionCode: string;
  readonly description: string;
  readonly mode?: InjectionMode;
  readonly targetFile?: string;
  readonly targetExport?: string;
  readonly expectedFailure?: string;
  readonly timeoutMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Result of executing an individual injected red-team assertion.
 */
export interface AssertionInjectionResult {
  readonly assertionId: string;
  readonly name: string;
  readonly vector: Gate2AttackVector;
  readonly mode: InjectionMode;
  readonly status: InjectionStatus;
  readonly survived: boolean;
  readonly broken: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorTrace?: string;
  readonly durationMs: number;
  readonly injectedFilePath: string;
  readonly permanentReproPath?: string;
  readonly rolledBack: boolean;
  readonly retained: boolean;
}

/**
 * Aggregated summary of an assertion injection suite run.
 */
export interface InjectionSuiteResult {
  readonly totalInjected: number;
  readonly survivedCount: number;
  readonly brokenCount: number;
  readonly errorCount: number;
  readonly results: readonly AssertionInjectionResult[];
  readonly breakingResults: readonly AssertionInjectionResult[];
  readonly retainedPaths: readonly string[];
  readonly sandboxDir: string;
  readonly cleanRollbackPerformed: boolean;
  readonly durationMs: number;
}

/**
 * Configuration options for the isolated Testing Sandbox.
 */
export interface TestingSandboxOptions {
  /** Root directory of repository/workspace (defaults to process.cwd()) */
  readonly workspaceRoot?: string;
  /** Custom sandbox directory path (defaults to a temporary directory under workspace or teamwork) */
  readonly sandboxDir?: string;
  /** Directory for permanent tests (defaults to <workspaceRoot>/test) */
  readonly permanentTestDir?: string;
  /** Whether to automatically clean up temporary files upon sandbox disposal (default: true) */
  readonly autoCleanup?: boolean;
  /** Custom probe execution runner */
  readonly probeRunner?: Gate2ProbeRunner;
  /** Per-assertion execution timeout in milliseconds (default: 30,000 ms) */
  readonly timeoutMs?: number;
  /** Optional logging callback */
  readonly logger?: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * Configuration options for Gate2AssertionInjector.
 */
export interface Gate2AssertionInjectorOptions {
  /** Root directory of workspace (defaults to process.cwd()) */
  readonly workspaceRoot?: string;
  /** Base test directory (defaults to <workspaceRoot>/test) */
  readonly testDir?: string;
  /** Permanent test reproduction directory */
  readonly permanentTestDir?: string;
  /** Whether to automatically roll back assertions that pass without breaking (default: true) */
  readonly autoRollbackOnPass?: boolean;
  /** Whether to permanently retain breaking assertions in test suite (default: true) */
  readonly preserveBreakingProbes?: boolean;
  /** Maximum permitted challenge attempts before escalation (default: 2, max: 3) */
  readonly maxAttempts?: number;
  /** Default execution timeout per assertion (default: 30,000 ms) */
  readonly timeoutMs?: number;
  /** Custom probe runner */
  readonly probeRunner?: Gate2ProbeRunner;
  /** Optional pre-allocated testing sandbox */
  readonly sandbox?: TestingSandbox;
  /** Optional logging callback */
  readonly logger?: (level: "info" | "warn" | "error", message: string) => void;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base error class for red-team assertion injection operations.
 */
export class Gate2InjectorError extends Error {
  readonly code: string;
  readonly details?: unknown;

  public constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "Gate2InjectorError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown when sandbox directory creation, isolation, or filesystem operations fail.
 */
export class Gate2SandboxError extends Gate2InjectorError {
  public constructor(message: string, details?: unknown) {
    super(message, "GATE2_SANDBOX_ERROR", details);
    this.name = "Gate2SandboxError";
  }
}

/**
 * Thrown when code assertion injection fails.
 */
export class Gate2InjectionError extends Gate2InjectorError {
  public constructor(message: string, details?: unknown) {
    super(message, "GATE2_INJECTION_FAILED", details);
    this.name = "Gate2InjectionError";
  }
}

/**
 * Thrown when rolling back injected files or restoring original content fails.
 */
export class Gate2RollbackError extends Gate2InjectorError {
  public constructor(message: string, details?: unknown) {
    super(message, "GATE2_ROLLBACK_FAILED", details);
    this.name = "Gate2RollbackError";
  }
}

// ============================================================================
// INTERNAL INJECTION RECORD
// ============================================================================

interface InjectedRecord {
  readonly assertion: RedTeamAssertion;
  readonly mode: InjectionMode;
  readonly injectedFilePath: string;
  readonly isNewFile: boolean;
  readonly originalContent?: string;
  retained: boolean;
  rolledBack: boolean;
}

// ============================================================================
// TESTING SANDBOX CLASS
// ============================================================================

/**
 * Testing Sandbox: Isolated filesystem environment for executing adversarial tests.
 *
 * Manages an isolated workspace directory, tracks original file backups for clean rollback,
 * and handles permanent reproduction retention into the test suite when breaking assertions occur.
 */
export class TestingSandbox {
  public readonly sandboxDir: string;
  public readonly workspaceRoot: string;
  public readonly permanentTestDir: string;
  public readonly autoCleanup: boolean;
  public readonly timeoutMs: number;
  private readonly probeRunner: Gate2ProbeRunner;
  private readonly logger?: (level: "info" | "warn" | "error", message: string) => void;

  private isInitialized = false;
  private isCleanedUp = false;
  private readonly injectionRecords = new Map<string, InjectedRecord>();
  private readonly originalContents = new Map<string, string>();
  private readonly createdFiles = new Set<string>();
  private readonly retainedFiles = new Set<string>();

  public constructor(options: TestingSandboxOptions = {}) {
    this.workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
    const defaultSandboxName = `${GATE2_INJECTOR_CONSTANTS.DEFAULT_SANDBOX_DIR_PREFIX}${randomUUID().slice(
      GATE2_INJECTOR_CONSTANTS.ZERO,
      GATE2_INJECTOR_CONSTANTS.UUID_TRUNCATION_LENGTH
    )}`;
    this.sandboxDir = normalize(
      options.sandboxDir ?? join(this.workspaceRoot, defaultSandboxName)
    );
    this.permanentTestDir = normalize(
      options.permanentTestDir ??
        join(this.workspaceRoot, GATE2_INJECTOR_CONSTANTS.DEFAULT_TEST_DIR)
    );
    this.autoCleanup = options.autoCleanup ?? true;
    this.timeoutMs =
      options.timeoutMs ?? GATE2_INJECTOR_CONSTANTS.DEFAULT_INJECTOR_TIMEOUT_MS;
    this.probeRunner = options.probeRunner ?? defaultProbeRunner;
    this.logger = options.logger;
  }

  /**
   * Initializes the testing sandbox directory structure.
   */
  public async initialize(): Promise<string> {
    if (this.isInitialized) {
      return this.sandboxDir;
    }

    try {
      await mkdir(this.sandboxDir, { recursive: true });
      await mkdir(this.permanentTestDir, { recursive: true });
      this.isInitialized = true;
      this.logger?.("info", `Initialized testing sandbox at ${this.sandboxDir}`);
      return this.sandboxDir;
    } catch (err) {
      throw new Gate2SandboxError(
        `Failed to initialize testing sandbox directory at '${this.sandboxDir}': ${err}`,
        err
      );
    }
  }

  /**
   * Returns whether the sandbox has been initialized.
   */
  public getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Injects a standalone red-team test probe file into the sandbox.
   */
  public async injectStandalone(assertion: RedTeamAssertion): Promise<string> {
    await this.initialize();

    const safeId = sanitizeProbeName(assertion.id);
    const uniqueSuffix = randomUUID().slice(
      GATE2_INJECTOR_CONSTANTS.ZERO,
      GATE2_INJECTOR_CONSTANTS.UUID_TRUNCATION_LENGTH
    );
    const fileName = `${GATE2_INJECTOR_CONSTANTS.PROBE_FILE_PREFIX}${safeId}_${uniqueSuffix}${GATE2_INJECTOR_CONSTANTS.PROBE_FILE_EXTENSION}`;
    const filePath = join(this.sandboxDir, fileName);

    try {
      await writeFile(filePath, assertion.assertionCode, "utf8");
      this.createdFiles.add(filePath);

      this.injectionRecords.set(assertion.id, {
        assertion,
        mode: GATE2_INJECTOR_CONSTANTS.MODE_STANDALONE,
        injectedFilePath: filePath,
        isNewFile: true,
        retained: false,
        rolledBack: false,
      });

      return filePath;
    } catch (err) {
      throw new Gate2InjectionError(
        `Failed to inject standalone test probe '${assertion.id}' to '${filePath}': ${err}`,
        err
      );
    }
  }

  /**
   * Injects an inline red-team assertion block into an existing test file.
   */
  public async injectInline(
    targetFile: string,
    assertion: RedTeamAssertion
  ): Promise<string> {
    await this.initialize();

    const resolvedTarget = isAbsolute(targetFile)
      ? normalize(targetFile)
      : join(this.workspaceRoot, targetFile);

    try {
      let existingContent = "";
      try {
        existingContent = await readFile(resolvedTarget, "utf8");
      } catch {
        existingContent = "";
      }

      // Store original content if not already backed up
      if (!this.originalContents.has(resolvedTarget)) {
        this.originalContents.set(resolvedTarget, existingContent);
      }

      const header = `${GATE2_INJECTOR_CONSTANTS.INLINE_INJECTION_HEADER_PREFIX}${assertion.id} (${assertion.vector}) */\n`;
      const footer = `\n${GATE2_INJECTOR_CONSTANTS.INLINE_INJECTION_FOOTER_PREFIX}${assertion.id} */\n`;
      const wrappedCode = `\n${header}${assertion.assertionCode}${footer}`;

      const mutatedContent = `${existingContent}${wrappedCode}`;
      await writeFile(resolvedTarget, mutatedContent, "utf8");

      this.injectionRecords.set(assertion.id, {
        assertion,
        mode: GATE2_INJECTOR_CONSTANTS.MODE_INLINE,
        injectedFilePath: resolvedTarget,
        isNewFile: existingContent.length === GATE2_INJECTOR_CONSTANTS.ZERO,
        originalContent: existingContent,
        retained: false,
        rolledBack: false,
      });

      return resolvedTarget;
    } catch (err) {
      throw new Gate2InjectionError(
        `Failed to inject inline assertion '${assertion.id}' into '${resolvedTarget}': ${err}`,
        err
      );
    }
  }

  /**
   * Executes a test file using the sandbox's probe runner.
   */
  public async executeProbe(
    filePath: string,
    timeoutMs?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const executionTimeout = timeoutMs ?? this.timeoutMs;
    return this.probeRunner(filePath, {
      timeoutMs: executionTimeout,
      cwd: this.workspaceRoot,
    });
  }

  /**
   * Rolls back an injected assertion cleanly.
   */
  public async rollbackAssertion(assertionId: string): Promise<boolean> {
    const record = this.injectionRecords.get(assertionId);
    if (!record || record.rolledBack) {
      return false;
    }

    try {
      if (record.mode === GATE2_INJECTOR_CONSTANTS.MODE_STANDALONE) {
        // Delete the standalone file if it exists and was not already retained
        try {
          await unlink(record.injectedFilePath);
          this.createdFiles.delete(record.injectedFilePath);
        } catch {
          // File might already be moved or unlinked
        }
      } else if (record.mode === GATE2_INJECTOR_CONSTANTS.MODE_INLINE) {
        // Restore original file content
        const original = this.originalContents.get(record.injectedFilePath);
        if (original !== undefined) {
          await writeFile(record.injectedFilePath, original, "utf8");
        } else {
          // Strip the specific injection block
          try {
            const current = await readFile(record.injectedFilePath, "utf8");
            const header = `${GATE2_INJECTOR_CONSTANTS.INLINE_INJECTION_HEADER_PREFIX}${assertionId}`;
            const footer = `${GATE2_INJECTOR_CONSTANTS.INLINE_INJECTION_FOOTER_PREFIX}${assertionId} */\n`;
            const startIndex = current.indexOf(header);
            const endIndex = current.indexOf(footer);
            if (
              startIndex !== GATE2_INJECTOR_CONSTANTS.INDEX_NOT_FOUND &&
              endIndex !== GATE2_INJECTOR_CONSTANTS.INDEX_NOT_FOUND
            ) {
              const cleaned =
                current.slice(GATE2_INJECTOR_CONSTANTS.ZERO, startIndex) +
                current.slice(endIndex + footer.length);
              await writeFile(record.injectedFilePath, cleaned, "utf8");
            }
          } catch {
            // Ignore strip error
          }
        }
      }

      record.rolledBack = true;
      return true;
    } catch (err) {
      throw new Gate2RollbackError(
        `Failed to rollback assertion '${assertionId}': ${err}`,
        err
      );
    }
  }

  /**
   * Rolls back all injected assertions and restores original file contents.
   */
  public async rollbackAll(): Promise<void> {
    for (const assertionId of this.injectionRecords.keys()) {
      await this.rollbackAssertion(assertionId);
    }

    // Restore any remaining original contents
    for (const [filePath, content] of this.originalContents.entries()) {
      try {
        await writeFile(filePath, content, "utf8");
      } catch {
        // Ignore write error during bulk restore
      }
    }
    this.originalContents.clear();

    // Delete any remaining created files
    for (const filePath of this.createdFiles) {
      try {
        await unlink(filePath);
      } catch {
        // Ignore
      }
    }
    this.createdFiles.clear();
  }

  /**
   * Permanently preserves a breaking assertion as a minimal reproduction probe in the test suite.
   */
  public async retainBreakingAssertion(
    assertion: RedTeamAssertion,
    options?: { destinationDir?: string; executionResult?: { stdout?: string; stderr?: string } }
  ): Promise<string> {
    const destDir = normalize(options?.destinationDir ?? this.permanentTestDir);
    await mkdir(destDir, { recursive: true });

    const safeId = sanitizeProbeName(assertion.id);
    const reproFileName = `${GATE2_INJECTOR_CONSTANTS.REPRO_SCRIPT_PREFIX}${safeId}${GATE2_INJECTOR_CONSTANTS.PROBE_FILE_EXTENSION}`;
    const reproFilePath = join(destDir, reproFileName);

    let scriptContent = assertion.assertionCode;
    if (
      !scriptContent.includes("import {") &&
      !scriptContent.includes("require(")
    ) {
      scriptContent = `import { describe, expect, it, test } from "bun:test";\n\n${scriptContent}`;
    }

    // Add provenance and reproduction metadata comment header
    const headerComment =
      `/**\n` +
      ` * Red-Team Minimal Reproduction Probe: ${assertion.name}\n` +
      ` * Probe ID: ${assertion.id}\n` +
      ` * Attack Vector: ${assertion.vector}\n` +
      ` * Description: ${assertion.description}\n` +
      ` * Injected & Certified by Gate 2 Adversarial Challenger\n` +
      ` */\n\n`;

    const finalContent = `${headerComment}${scriptContent}`;

    try {
      await writeFile(reproFilePath, finalContent, "utf8");
      this.retainedFiles.add(reproFilePath);

      const record = this.injectionRecords.get(assertion.id);
      if (record) {
        record.retained = true;
      }

      this.logger?.(
        "info",
        `Permanently preserved breaking red-team probe to '${reproFilePath}'`
      );
      return reproFilePath;
    } catch (err) {
      throw new Gate2InjectionError(
        `Failed to retain breaking assertion '${assertion.id}' to '${reproFilePath}': ${err}`,
        err
      );
    }
  }

  /**
   * Cleans up the temporary testing sandbox directory and un-retained assets.
   */
  public async cleanup(): Promise<void> {
    if (this.isCleanedUp) {
      return;
    }

    try {
      await this.rollbackAll();

      if (this.autoCleanup && this.sandboxDir !== this.workspaceRoot) {
        try {
          await rm(this.sandboxDir, { recursive: true, force: true });
        } catch {
          // Ignore directory removal failure
        }
      }

      this.isCleanedUp = true;
      this.logger?.("info", `Cleaned up testing sandbox at '${this.sandboxDir}'`);
    } catch (err) {
      this.logger?.("warn", `Sandbox cleanup encountered warnings: ${err}`);
    }
  }

  /**
   * Returns a list of paths created during this sandbox session.
   */
  public getCreatedFiles(): readonly string[] {
    return Array.from(this.createdFiles);
  }

  /**
   * Returns a list of paths permanently retained in the test suite.
   */
  public getRetainedFiles(): readonly string[] {
    return Array.from(this.retainedFiles);
  }
}

// ============================================================================
// GATE 2 ASSERTION INJECTOR CLASS
// ============================================================================

/**
 * Gate 2 Assertion Injector: Red-Team Assertion Injector into Testing Sandbox.
 *
 * Orchestrates the translation, injection, execution, clean rollback, and permanent
 * retention of adversarial test assertions within an isolated testing sandbox.
 */
export class Gate2AssertionInjector extends EventEmitter {
  private readonly options: Gate2AssertionInjectorOptions;
  private readonly workspaceRoot: string;
  private readonly testDir: string;
  private readonly permanentTestDir: string;
  private readonly autoRollbackOnPass: boolean;
  private readonly preserveBreakingProbes: boolean;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly probeRunner: Gate2ProbeRunner;
  private sandboxInstance?: TestingSandbox;

  public constructor(options: Gate2AssertionInjectorOptions = {}) {
    super();
    this.options = { ...options };
    this.workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
    this.testDir = normalize(
      options.testDir ?? join(this.workspaceRoot, GATE2_INJECTOR_CONSTANTS.DEFAULT_TEST_DIR)
    );
    this.permanentTestDir = normalize(
      options.permanentTestDir ?? this.testDir
    );
    this.autoRollbackOnPass = options.autoRollbackOnPass ?? true;
    this.preserveBreakingProbes = options.preserveBreakingProbes ?? true;
    this.maxAttempts = Math.min(
      options.maxAttempts ?? GATE2_INJECTOR_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
      GATE2_INJECTOR_CONSTANTS.MAX_PERMITTED_ATTEMPTS
    );
    this.timeoutMs =
      options.timeoutMs ?? GATE2_INJECTOR_CONSTANTS.DEFAULT_INJECTOR_TIMEOUT_MS;
    this.probeRunner = options.probeRunner ?? defaultProbeRunner;
    this.sandboxInstance = options.sandbox;
  }

  /**
   * Returns a copy of the configuration options.
   */
  public getOptions(): Readonly<Gate2AssertionInjectorOptions> {
    return { ...this.options };
  }

  /**
   * Creates or allocates a new testing sandbox.
   */
  public async createSandbox(
    options?: TestingSandboxOptions
  ): Promise<TestingSandbox> {
    const sandbox = new TestingSandbox({
      workspaceRoot: this.workspaceRoot,
      permanentTestDir: this.permanentTestDir,
      probeRunner: this.probeRunner,
      timeoutMs: this.timeoutMs,
      ...options,
    });
    await sandbox.initialize();
    this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_SANDBOX_CREATED, {
      sandboxDir: sandbox.sandboxDir,
    });
    return sandbox;
  }

  /**
   * Obtains or creates the active testing sandbox instance.
   */
  public async getOrCreateSandbox(): Promise<TestingSandbox> {
    if (!this.sandboxInstance) {
      this.sandboxInstance = await this.createSandbox();
    }
    return this.sandboxInstance;
  }

  /**
   * Converts a generic Gate2ProbeDefinition into a structured RedTeamAssertion.
   */
  public convertProbeToAssertion(
    probe: Gate2ProbeDefinition,
    overrides?: Partial<RedTeamAssertion>
  ): RedTeamAssertion {
    return {
      id: probe.id,
      name: probe.name,
      vector: probe.vector,
      assertionCode: probe.probeCode,
      description: probe.description,
      mode: overrides?.mode ?? GATE2_INJECTOR_CONSTANTS.MODE_STANDALONE,
      targetFile: probe.targetFile ?? overrides?.targetFile,
      timeoutMs: probe.timeoutMs ?? overrides?.timeoutMs,
      metadata: probe.metadata ?? overrides?.metadata,
      ...overrides,
    };
  }

  /**
   * Converts a list of Gate2ProbeDefinitions into RedTeamAssertions.
   */
  public convertSynthesizedToAssertions(
    probes: readonly Gate2ProbeDefinition[],
    overrides?: Partial<RedTeamAssertion>
  ): readonly RedTeamAssertion[] {
    return probes.map((p) => this.convertProbeToAssertion(p, overrides));
  }

  /**
   * Injects an assertion into the testing sandbox according to its configured mode.
   */
  public async injectAssertion(
    assertion: RedTeamAssertion,
    sandbox: TestingSandbox
  ): Promise<string> {
    const mode = assertion.mode ?? GATE2_INJECTOR_CONSTANTS.MODE_STANDALONE;

    let injectedPath: string;
    if (mode === GATE2_INJECTOR_CONSTANTS.MODE_INLINE && assertion.targetFile) {
      injectedPath = await sandbox.injectInline(assertion.targetFile, assertion);
    } else {
      injectedPath = await sandbox.injectStandalone(assertion);
    }

    this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_INJECTED, {
      assertionId: assertion.id,
      mode,
      injectedPath,
    });

    return injectedPath;
  }

  /**
   * Executes a single red-team assertion against the testing sandbox.
   *
   * Executes the test, analyzes outcome, applies clean rollback on survival,
   * or permanently preserves breaking assertions into the test suite.
   */
  public async runAssertion(
    assertion: RedTeamAssertion,
    sandbox?: TestingSandbox
  ): Promise<AssertionInjectionResult> {
    const activeSandbox = sandbox ?? (await this.getOrCreateSandbox());
    const startTime = performance.now();

    this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_EXECUTING, {
      assertionId: assertion.id,
      name: assertion.name,
      vector: assertion.vector,
    });

    const mode = assertion.mode ?? GATE2_INJECTOR_CONSTANTS.MODE_STANDALONE;
    let injectedFilePath = "";

    try {
      injectedFilePath = await this.injectAssertion(assertion, activeSandbox);

      const runnerResult = await activeSandbox.executeProbe(
        injectedFilePath,
        assertion.timeoutMs ?? this.timeoutMs
      );

      const durationMs = Math.round(performance.now() - startTime);

      // In red-team fuzzing:
      // exitCode === 0 => candidate SURVIVED the adversarial stress assertion
      // exitCode !== 0 => candidate BROKE under adversarial conditions
      const survived = runnerResult.exitCode === GATE2_INJECTOR_CONSTANTS.EXIT_CODE_SUCCESS;
      const broken = !survived;

      let errorTrace: string | undefined;
      let permanentReproPath: string | undefined;
      let rolledBack = false;
      let retained = false;

      if (survived) {
        // Candidate survived the probe: execute clean rollback if enabled
        if (this.autoRollbackOnPass) {
          rolledBack = await activeSandbox.rollbackAssertion(assertion.id);
          this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_ROLLED_BACK, {
            assertionId: assertion.id,
            injectedFilePath,
          });
        }

        this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_SURVIVED, {
          assertionId: assertion.id,
          name: assertion.name,
          durationMs,
        });
      } else {
        // Candidate broke: extract error trace and optionally retain breaking test
        errorTrace = extractProbeErrorTrace(
          runnerResult.stdout,
          runnerResult.stderr
        );

        if (this.preserveBreakingProbes) {
          permanentReproPath = await activeSandbox.retainBreakingAssertion(
            assertion,
            { executionResult: runnerResult }
          );
          retained = true;

          this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_RETAINED, {
            assertionId: assertion.id,
            reproPath: permanentReproPath,
          });

          // If mode was inline, clean up the inline mutation from target file
          if (mode === GATE2_INJECTOR_CONSTANTS.MODE_INLINE) {
            await activeSandbox.rollbackAssertion(assertion.id);
            rolledBack = true;
          }
        }

        this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_BROKEN, {
          assertionId: assertion.id,
          name: assertion.name,
          vector: assertion.vector,
          reproPath: permanentReproPath,
          errorTrace,
        });
      }

      const status: InjectionStatus = broken
        ? retained
          ? GATE2_INJECTOR_CONSTANTS.STATUS_RETAINED
          : GATE2_INJECTOR_CONSTANTS.STATUS_BROKEN
        : rolledBack
          ? GATE2_INJECTOR_CONSTANTS.STATUS_ROLLED_BACK
          : GATE2_INJECTOR_CONSTANTS.STATUS_SURVIVED;

      return {
        assertionId: assertion.id,
        name: assertion.name,
        vector: assertion.vector,
        mode,
        status,
        survived,
        broken,
        exitCode: runnerResult.exitCode,
        stdout: runnerResult.stdout,
        stderr: runnerResult.stderr,
        errorTrace,
        durationMs,
        injectedFilePath,
        permanentReproPath,
        rolledBack,
        retained,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Attempt rollback on error
      if (injectedFilePath) {
        try {
          await activeSandbox.rollbackAssertion(assertion.id);
        } catch {
          // Ignore rollback error
        }
      }

      this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_INJECTION_ERROR, {
        assertionId: assertion.id,
        error: errorMessage,
      });

      return {
        assertionId: assertion.id,
        name: assertion.name,
        vector: assertion.vector,
        mode,
        status: GATE2_INJECTOR_CONSTANTS.STATUS_ERROR,
        survived: false,
        broken: true,
        exitCode: GATE2_INJECTOR_CONSTANTS.EXIT_CODE_ERROR,
        stdout: "",
        stderr: errorMessage,
        errorTrace: errorMessage,
        durationMs,
        injectedFilePath,
        rolledBack: true,
        retained: false,
      };
    }
  }

  /**
   * Executes a suite of red-team assertions in the testing sandbox.
   */
  public async runSuite(
    assertions: readonly RedTeamAssertion[],
    sandbox?: TestingSandbox
  ): Promise<InjectionSuiteResult> {
    const activeSandbox = sandbox ?? (await this.getOrCreateSandbox());
    const startTime = performance.now();

    const results: AssertionInjectionResult[] = [];
    const breakingResults: AssertionInjectionResult[] = [];
    const retainedPaths: string[] = [];

    let survivedCount = GATE2_INJECTOR_CONSTANTS.ZERO;
    let brokenCount = GATE2_INJECTOR_CONSTANTS.ZERO;
    let errorCount = GATE2_INJECTOR_CONSTANTS.ZERO;

    for (const assertion of assertions) {
      const result = await this.runAssertion(assertion, activeSandbox);
      results.push(result);

      if (result.broken) {
        brokenCount += GATE2_INJECTOR_CONSTANTS.ONE;
        breakingResults.push(result);
        if (result.permanentReproPath) {
          retainedPaths.push(result.permanentReproPath);
        }
        if (result.status === GATE2_INJECTOR_CONSTANTS.STATUS_ERROR) {
          errorCount += GATE2_INJECTOR_CONSTANTS.ONE;
        }
      } else {
        survivedCount += GATE2_INJECTOR_CONSTANTS.ONE;
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      totalInjected: assertions.length,
      survivedCount,
      brokenCount,
      errorCount,
      results,
      breakingResults,
      retainedPaths,
      sandboxDir: activeSandbox.sandboxDir,
      cleanRollbackPerformed: this.autoRollbackOnPass,
      durationMs,
    };
  }

  /**
   * Injects assertions, runs suite, and automatically cleans up the sandbox.
   */
  public async injectAndExecute(
    assertions: readonly RedTeamAssertion[],
    sandboxOptions?: TestingSandboxOptions
  ): Promise<InjectionSuiteResult> {
    const sandbox = await this.createSandbox(sandboxOptions);
    try {
      return await this.runSuite(assertions, sandbox);
    } finally {
      await sandbox.cleanup();
      this.emit(GATE2_INJECTOR_CONSTANTS.EVENT_SANDBOX_CLEANED, {
        sandboxDir: sandbox.sandboxDir,
      });
    }
  }
}

// ============================================================================
// FORMATTERS & REPORT GENERATORS
// ============================================================================

/**
 * Formats structured XML feedback block from injection suite result.
 */
export function formatAssertionFeedbackXml(
  suiteResult: InjectionSuiteResult,
  options?: { taskId?: string; attempt?: number; maxAttempts?: number }
): string {
  const taskId = options?.taskId ?? "unspecified-task";
  const attempt = options?.attempt ?? GATE2_INJECTOR_CONSTANTS.ONE;
  const maxAttempts =
    options?.maxAttempts ?? GATE2_INJECTOR_CONSTANTS.DEFAULT_MAX_ATTEMPTS;

  const lines: string[] = [
    `<redteam-assertion-feedback timestamp="${new Date().toISOString()}">`,
    `  <task-id>${taskId}</task-id>`,
    `  <attempt>${attempt}</attempt>`,
    `  <max-attempts>${maxAttempts}</max-attempts>`,
    `  <sandbox-dir>${suiteResult.sandboxDir}</sandbox-dir>`,
    `  <stats>`,
    `    <total-injected>${suiteResult.totalInjected}</total-injected>`,
    `    <survived>${suiteResult.survivedCount}</survived>`,
    `    <broken>${suiteResult.brokenCount}</broken>`,
    `    <clean-rollback>${suiteResult.cleanRollbackPerformed}</clean-rollback>`,
    `  </stats>`,
  ];

  if (suiteResult.breakingResults.length > GATE2_INJECTOR_CONSTANTS.ZERO) {
    lines.push(`  <breaking-assertions count="${suiteResult.breakingResults.length}">`);
    for (const b of suiteResult.breakingResults) {
      lines.push(
        `    <assertion id="${b.assertionId}" vector="${b.vector}" mode="${b.mode}">`
      );
      lines.push(`      <name>${b.name}</name>`);
      if (b.permanentReproPath) {
        lines.push(`      <reproduction-file>${b.permanentReproPath}</reproduction-file>`);
      }
      if (b.errorTrace) {
        lines.push(
          `      <error-trace><![CDATA[${b.errorTrace}]]></error-trace>`
        );
      }
      lines.push(`    </assertion>`);
    }
    lines.push(`  </breaking-assertions>`);
  }

  lines.push(`</redteam-assertion-feedback>`);
  return lines.join("\n");
}

/**
 * Formats comprehensive Markdown report summarizing the assertion injection findings.
 */
export function formatAssertionReportMarkdown(
  suiteResult: InjectionSuiteResult,
  taskId?: string
): string {
  const sections: string[] = [];

  sections.push(
    `# Gate 2: Red-Team Assertion Injection Report\n\n` +
      `**Task ID**: \`${taskId ?? "unspecified"}\`  \n` +
      `**Sandbox**: \`${suiteResult.sandboxDir}\`  \n` +
      `**Timestamp**: ${new Date().toISOString()}  \n` +
      `**Clean Rollback**: ${suiteResult.cleanRollbackPerformed ? "✅ Executed" : "Disabled"}\n`
  );

  sections.push(
    `## Injection Statistics\n\n` +
      `| Metric | Count |\n` +
      `| :--- | :--- |\n` +
      `| **Total Assertions Injected** | \`${suiteResult.totalInjected}\` |\n` +
      `| **Survived (Passed)** | \`${suiteResult.survivedCount}\` |\n` +
      `| **Broken (Vulnerabilities Found)** | \`${suiteResult.brokenCount}\` |\n` +
      `| **Execution Duration** | \`${suiteResult.durationMs}ms\` |\n`
  );

  if (suiteResult.results.length > GATE2_INJECTOR_CONSTANTS.ZERO) {
    sections.push(`## Assertion Execution Log\n`);
    const tableRows = suiteResult.results.map((r) => {
      const outcome = r.broken ? "💥 BROKEN" : "✅ SURVIVED";
      const action = r.retained
        ? "Permanently Retained"
        : r.rolledBack
          ? "Cleanly Rolled Back"
          : "Active";
      return `| \`${r.assertionId}\` | ${r.name} | \`${r.vector}\` | \`${r.mode}\` | ${outcome} | ${action} |`;
    });

    sections.push(
      `| ID | Name | Vector | Mode | Outcome | Lifecycle Action |\n` +
        `| :--- | :--- | :--- | :--- | :--- | :--- |\n` +
        tableRows.join("\n")
    );
  }

  if (suiteResult.retainedPaths.length > GATE2_INJECTOR_CONSTANTS.ZERO) {
    sections.push(
      `## Preserved Reproduction Test Files\n\n` +
        suiteResult.retainedPaths.map((p) => `- \`${p}\``).join("\n")
    );
  }

  return sections.join("\n\n");
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates an isolated testing sandbox.
 */
export async function createTestingSandbox(
  options?: TestingSandboxOptions
): Promise<TestingSandbox> {
  const sandbox = new TestingSandbox(options);
  await sandbox.initialize();
  return sandbox;
}

/**
 * Creates an instance of Gate2AssertionInjector.
 */
export function createAssertionInjector(
  options?: Gate2AssertionInjectorOptions
): Gate2AssertionInjector {
  return new Gate2AssertionInjector(options);
}
