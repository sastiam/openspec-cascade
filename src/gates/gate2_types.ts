/**
 * Shared gate2_challenger, gate2_injector, gate2_synthesis contracts extracted to keep the module graph acyclic.
 */
import { COGNITIVE_ROLES, type IPalProvider } from "../pal/types";
import { ROLES_CONSTANTS } from "../core/roles";
import { SubagentDispatcher, type SubagentInstance } from "../core/dispatcher";
import { LOOPER_EVENTS, LOOPER_STATES, type LooperEvent, type LooperState } from "../core/fsm_types";
import { type TestingSandbox, type Gate2AssertionInjector } from "./gate2_injector";

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
 * Central constants ensuring zero magic numbers across Gate 2 synthesis operations.
 */
export const GATE2_SYNTHESIS_CONSTANTS = {
  // Attack Vectors (aligned with GATE2_CONSTANTS)
  VECTOR_BOUNDARY_MALFORMED: "boundary_malformed" as const,
  VECTOR_CONCURRENCY_RACE: "concurrency_race" as const,
  VECTOR_RESOURCE_EXHAUSTION: "resource_exhaustion" as const,
  VECTOR_TIMEOUT_LATENCY: "timeout_latency" as const,
  VECTOR_CUSTOM: "custom" as const,

  // Synthesis Categories
  CATEGORY_NULL_UNDEFINED: "null_undefined" as const,
  CATEGORY_BOUNDARY_LIMITS: "boundary_limits" as const,
  CATEGORY_CONCURRENCY_RACE: "concurrency_race" as const,
  CATEGORY_TIMEOUT_LATENCY: "timeout_latency" as const,
  CATEGORY_MALFORMED_PAYLOAD: "malformed_payload" as const,
  CATEGORY_UNICODE_EXPLOIT: "unicode_exploit" as const,
  CATEGORY_RESOURCE_EXHAUSTION: "resource_exhaustion" as const,

  // Numerical Boundaries
  INT32_MAX: 2_147_483_647,
  INT32_MIN: -2_147_483_648,
  SAFE_INT_MAX: Number.MAX_SAFE_INTEGER, // 9007199254740991
  SAFE_INT_MIN: Number.MIN_SAFE_INTEGER, // -9007199254740991
  NUM_ZERO: 0,
  NUM_NEGATIVE_ZERO: -0,
  NUM_ONE: 1,
  NUM_NEGATIVE_ONE: -1,
  NUM_EPSILON: Number.EPSILON,

  // Boundary String Sizes & Sequences
  EMPTY_STRING: "",
  WHITESPACE_STRING: "   \t\r\n   ",
  UNICODE_NULL_BYTE: "\0",
  UNICODE_ZALGO_SAMPLE: "H̵e̸l̷l̸o̶_̸W̸o̸r̷l̷d̸",
  UNICODE_RTL_OVERRIDE: "\u202Ereversed_payload\u202C",
  UNICODE_ZERO_WIDTH: "\u200B\u200C\u200D\uFEFF",
  UNICODE_EMOJI_SEQUENCE: "🔥💥🚀🧑‍💻👾🧪",
  HUGE_STRING_SIZE: 100_000,
  LARGE_STRING_CHUNK: 1_000,

  // Collection Sizes
  EMPTY_ARRAY_LENGTH: 0,
  LARGE_ARRAY_LENGTH: 10_000,
  DEEP_NESTING_DEPTH: 50,

  // Concurrency Defaults
  DEFAULT_CONCURRENCY_PARALLEL_COUNT: 20,
  HIGH_CONCURRENCY_PARALLEL_COUNT: 50,
  MICROTASK_BURST_COUNT: 10,
  STAGGER_DELAY_MS: 5,

  // Timeout Defaults
  DEFAULT_PROBE_TIMEOUT_MS: 30_000,
  DEFAULT_OPERATION_TIMEOUT_MS: 2_000,
  SIMULATED_LATENCY_DELAY_MS: 1_500,
  WATCHDOG_GRACE_PERIOD_MS: 500,

  // Synthesis Limits
  DEFAULT_MAX_PROBES_PER_VECTOR: 2,
  DEFAULT_MAX_TOTAL_PROBES: 16,
  MAX_EXPORTS_PER_FILE: 10,

  // File Paths & Suffixes
  TEST_DIR_DEFAULT: "test",
  SRC_DIR_DEFAULT: "src",
  TS_EXTENSION: ".ts",
  JS_EXTENSION: ".js",
  PROBE_PREFIX: "synth_",

  // Numeric literals and offsets
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  INDEX_NOT_FOUND: -1,
  SLICE_START: 0,
  RADIX_DECIMAL: 10,
  UUID_TRUNCATION_LENGTH: 8,
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

export // ============================================================================
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

/**
 * Recognized edge case category types.
 */
export type EdgeCaseCategory =
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_NULL_UNDEFINED
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_BOUNDARY_LIMITS
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_CONCURRENCY_RACE
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_TIMEOUT_LATENCY
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_MALFORMED_PAYLOAD
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_UNICODE_EXPLOIT
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_RESOURCE_EXHAUSTION;

/**
 * Discovered export entry from static code analysis.
 */
export interface TargetExportInfo {
  readonly name: string;
  readonly kind: "function" | "class" | "const_arrow" | "unknown";
  readonly isAsync: boolean;
  readonly parameterCount: number;
}

/**
 * Analyzed target file metadata for synthesis.
 */
export interface TargetFileInfo {
  readonly filePath: string;
  readonly relativePath: string;
  readonly exports: readonly TargetExportInfo[];
  readonly hasDefaultExport: boolean;
}

/**
 * Options configuring automated edge case synthesis.
 */
export interface Gate2SynthesisOptions {
  /** Root directory of workspace (defaults to process.cwd()) */
  readonly workspaceRoot?: string;
  /** Directory where test probes are located/executed (defaults to <workspaceRoot>/test) */
  readonly testDir?: string;
  /** Specific target files to analyze and synthesize probes for */
  readonly targetFiles?: readonly string[];
  /** Enabled attack vector categories (defaults to all) */
  readonly includeVectors?: readonly Gate2AttackVector[];
  /** Enabled subcategories (defaults to all) */
  readonly includeCategories?: readonly EdgeCaseCategory[];
  /** Maximum total probes to synthesize across all targets */
  readonly maxProbes?: number;
  /** Concurrency level for parallel probes */
  readonly concurrencyCount?: number;
  /** Operation watchdog timeout in milliseconds */
  readonly operationTimeoutMs?: number;
  /** Probe execution timeout in milliseconds */
  readonly probeTimeoutMs?: number;
  /** Task description context */
  readonly taskDescription?: string;
  /** Acceptance criteria context */
  readonly acceptanceCriteria?: readonly string[];
  /** Optional pre-parsed target files */
  readonly targetFileInfos?: readonly TargetFileInfo[];
}
