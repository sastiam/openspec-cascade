/**
 * Shared gate0_qa, gate0_parser, gate0_policy contracts extracted to keep the module graph acyclic.
 */
/**
 * Central constants ensuring zero magic numbers across Gate 0 policy evaluation operations.
 */
export const GATE0_POLICY_CONSTANTS = {
  // Policies
  POLICY_FAST_TRACK: "fast-track" as const,
  POLICY_FULL_GATE: "full-gate" as const,
  POLICY_AUTO: "auto" as const,

  // Verification Gates
  GATE_0: "gate0" as const,
  GATE_1: "gate1" as const,
  GATE_2: "gate2" as const,
  GATE_3: "gate3" as const,

  // FSM Event transitions for Gate 0
  EVT_G0_PASS: "EVT_G0_PASS" as const,
  EVT_G0_PASS_FAST_TRACK: "EVT_G0_PASS_FAST_TRACK" as const,
  EVT_G0_RETRY: "EVT_G0_RETRY" as const,
  EVT_G0_EXHAUSTED: "EVT_G0_EXHAUSTED" as const,

  // Defaults
  DEFAULT_MAX_ATTEMPTS: 3,
  DEFAULT_CURRENT_ATTEMPT: 1,
  DEFAULT_COMMAND_SUCCESS_EXIT_CODE: 0,
  PREVIEW_FILE_COUNT_LIMIT: 3,

  // Permitted documentation file extensions
  DOC_EXTENSIONS: [
    ".md",
    ".markdown",
    ".mdown",
    ".mkd",
    ".txt",
    ".rst",
    ".adoc",
    ".asciidoc",
    ".pdf",
    ".rtf",
  ] as const,

  // Permitted documentation assets inside doc/metadata directories
  DOC_ASSET_EXTENSIONS: [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".mermaid",
    ".puml",
    ".drawio",
  ] as const,

  // Permitted documentation and metadata directories
  DOC_DIRECTORIES: [
    "docs/",
    "doc/",
    "documentation/",
    "openspec/",
    ".agents/teamwork/",
    ".archify/",
    "graphify-out/",
  ] as const,

  // Permitted metadata extensions strictly within doc/metadata directories
  METADATA_EXTENSIONS: [
    ".json",
    ".yaml",
    ".yml",
  ] as const,

  // Standard root documentation basenames (case-insensitive)
  DOC_ROOT_BASENAMES: [
    "readme",
    "license",
    "licence",
    "changelog",
    "contributing",
    "authors",
    "contributors",
    "notice",
    "security",
    "archify",
    "patents",
    "code_of_conduct",
    "governance",
    "roadmap",
    "support",
  ] as const,

  // Disqualified source code file extensions (prohibited from fast-track)
  DISQUALIFIED_EXTENSIONS: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".pyc",
    ".pyw",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".kts",
    ".c",
    ".cc",
    ".cpp",
    ".cxx",
    ".h",
    ".hh",
    ".hpp",
    ".cs",
    ".swift",
    ".php",
    ".pl",
    ".pm",
    ".scala",
    ".clj",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".bat",
    ".cmd",
    ".ps1",
    ".sql",
    ".prisma",
  ] as const,

  // Critical build, runtime, and dependency files (prohibited from fast-track)
  DISQUALIFIED_CONFIG_FILES: [
    "package.json",
    "package-lock.json",
    "bun.lock",
    "bun.lockb",
    "yarn.lock",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "makefile",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "turbo.json",
    "nx.json",
    "eslint.config.js",
    "eslint.config.mjs",
    "biome.json",
  ] as const,

  // Production code and build directories (prohibited from fast-track)
  DISQUALIFIED_DIRECTORIES: [
    "src/",
    "test/",
    "tests/",
    "lib/",
    "bin/",
    ".github/workflows/",
  ] as const,
} as const;

/**
 * Central constants ensuring zero magic numbers across Gate 0 mechanical test runner operations.
 */
export const GATE0_CONSTANTS = {
  // Exit Codes
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_FAILURE: 1,
  EXIT_CODE_ERROR: 2,
  EXIT_CODE_TIMEOUT: 124,

  // Timeouts (milliseconds)
  DEFAULT_GATE_TIMEOUT_MS: 1_800_000,
  DEFAULT_PER_COMMAND_TIMEOUT_MS: 300_000,
  DEFAULT_LAYOUT_TIMEOUT_MS: 30_000,

  // Attempts and limits
  DEFAULT_MAX_ATTEMPTS: 3,
  DEFAULT_CURRENT_ATTEMPT: 1,
  DEFAULT_PREVIEW_LINES: 10,
  DEFAULT_TAIL_LINES: 25,
  DEFAULT_MAX_OUTPUT_LENGTH: 4_000,
  DEFAULT_FEEDBACK_TRUNCATION_LIMIT: 2_500,

  // Protected Paths & Layout Invariants
  DEFAULT_PROTECTED_METADATA_DIR: ".agents/teamwork",
  LAYOUT_CHECK_ID: "gate0-filesystem-layout",
  LAYOUT_CHECK_NAME: "Filesystem Layout Invariant Check",

  // Prohibited code file extensions in metadata directory
  FORBIDDEN_SOURCE_EXTENSIONS: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".sh",
    ".bash",
  ] as const,

  // Permitted documentation file extensions
  DOC_EXTENSIONS: [
    ".md",
    ".markdown",
    ".txt",
    ".rst",
    ".adoc",
  ] as const,

  // Default Standard Verification Commands
  DEFAULT_COMMANDS: [
    "bun test",
    "bunx tsc --noEmit",
    "bun run lint",
    "bun run build",
  ] as const,

  // Status Strings
  STATUS_PASSED: "passed" as const,
  STATUS_FAILED: "failed" as const,
  STATUS_SKIPPED: "skipped" as const,
  STATUS_TIMEOUT: "timeout" as const,
  STATUS_ERROR: "error" as const,

  // Check Types
  CHECK_TYPE_TYPECHECK: "typecheck" as const,
  CHECK_TYPE_TEST: "test" as const,
  CHECK_TYPE_LINT: "lint" as const,
  CHECK_TYPE_BUILD: "build" as const,
  CHECK_TYPE_LAYOUT: "layout" as const,
  CHECK_TYPE_CUSTOM: "custom" as const,

  // Gate Verdicts
  VERDICT_PASSED: "PASSED" as const,
  VERDICT_FAILED: "FAILED" as const,
  VERDICT_TIMEOUT: "TIMEOUT" as const,
  VERDICT_ERROR: "ERROR" as const,

  // Gate Execution Policies
  POLICY_FAST_TRACK: GATE0_POLICY_CONSTANTS.POLICY_FAST_TRACK,
  POLICY_FULL_GATE: GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE,
  POLICY_AUTO: GATE0_POLICY_CONSTANTS.POLICY_AUTO,
} as const;

/**
 * Central constants ensuring zero magic numbers across Gate 0 trace parsing and XML formatting.
 */
export const GATE0_PARSER_CONSTANTS = {
  // Limits
  DEFAULT_MAX_DIAGNOSTICS: 20,
  DEFAULT_MAX_TEST_FAILURES: 15,
  DEFAULT_MAX_STACK_FRAMES: 10,
  DEFAULT_TAIL_LINES: 25,
  DEFAULT_FEEDBACK_TRUNCATION_LIMIT: 2500,
  DEFAULT_MAX_ERROR_MESSAGE_LENGTH: 500,
  DEFAULT_MAX_RAW_SNIPPET_LINES: 5,

  // Radix for integer conversions
  RADIX_DECIMAL: 10,

  // Severities
  SEVERITY_ERROR: "error" as const,
  SEVERITY_WARNING: "warning" as const,
  SEVERITY_INFO: "info" as const,

  // Diagnostic Sources
  SOURCE_TSC: "tsc" as const,
  SOURCE_ESLINT: "eslint" as const,
  SOURCE_BIOME: "biome" as const,
  SOURCE_COMPILER: "compiler" as const,
  SOURCE_LINTER: "linter" as const,
  SOURCE_GENERIC: "generic" as const,

  // Capture group indexes for TypeScript flex regex:
  // [full, file, line, col, severity, code, message]
  TSC_INDEX_FILE: 1,
  TSC_INDEX_LINE: 2,
  TSC_INDEX_COL: 3,
  TSC_INDEX_SEVERITY: 4,
  TSC_INDEX_CODE: 5,
  TSC_INDEX_MESSAGE: 6,

  // Capture group indexes for ESLint stylish regex:
  // [full, line, col, severity, message, rule]
  ESLINT_STYLISH_INDEX_LINE: 1,
  ESLINT_STYLISH_INDEX_COL: 2,
  ESLINT_STYLISH_INDEX_SEVERITY: 3,
  ESLINT_STYLISH_INDEX_MESSAGE: 4,
  ESLINT_STYLISH_INDEX_RULE: 5,

  // Capture group indexes for ESLint compact regex:
  // [full, file, line, col, severity, message, bracketRule, parenRule]
  ESLINT_COMPACT_INDEX_FILE: 1,
  ESLINT_COMPACT_INDEX_LINE: 2,
  ESLINT_COMPACT_INDEX_COL: 3,
  ESLINT_COMPACT_INDEX_SEVERITY: 4,
  ESLINT_COMPACT_INDEX_MESSAGE: 5,
  ESLINT_COMPACT_INDEX_RULE_BRACKET: 6,
  ESLINT_COMPACT_INDEX_RULE_PAREN: 7,

  // Capture group indexes for Biome error regex:
  // [full, file, line, col, rule]
  BIOME_INDEX_FILE: 1,
  BIOME_INDEX_LINE: 2,
  BIOME_INDEX_COL: 3,
  BIOME_INDEX_RULE: 4,

  // Capture group indexes for Stack Frame (named):
  // [full, func, file, line, col]
  FRAME_NAMED_INDEX_FUNC: 1,
  FRAME_NAMED_INDEX_FILE: 2,
  FRAME_NAMED_INDEX_LINE: 3,
  FRAME_NAMED_INDEX_COL: 4,

  // Capture group indexes for Stack Frame (anonymous):
  // [full, file, line, col]
  FRAME_ANON_INDEX_FILE: 1,
  FRAME_ANON_INDEX_LINE: 2,
  FRAME_ANON_INDEX_COL: 3,

  // Capture group indexes for Bun test failure header:
  // [full, file, suiteAndName]
  BUN_FAIL_HEADER_INDEX_FILE: 1,
  BUN_FAIL_HEADER_INDEX_NAME: 2,

  // Capture group indexes for Expected / Received:
  EXPECTED_INDEX_VALUE: 1,
  RECEIVED_INDEX_VALUE: 1,
} as const;

/**
 * Valid check types recognized by Gate 0.
 */
export type Gate0CheckType =
  | typeof GATE0_CONSTANTS.CHECK_TYPE_TYPECHECK
  | typeof GATE0_CONSTANTS.CHECK_TYPE_TEST
  | typeof GATE0_CONSTANTS.CHECK_TYPE_LINT
  | typeof GATE0_CONSTANTS.CHECK_TYPE_BUILD
  | typeof GATE0_CONSTANTS.CHECK_TYPE_LAYOUT
  | typeof GATE0_CONSTANTS.CHECK_TYPE_CUSTOM;

/**
 * Execution status for an individual Gate 0 check.
 */
export type Gate0CheckStatus =
  | typeof GATE0_CONSTANTS.STATUS_PASSED
  | typeof GATE0_CONSTANTS.STATUS_FAILED
  | typeof GATE0_CONSTANTS.STATUS_SKIPPED
  | typeof GATE0_CONSTANTS.STATUS_TIMEOUT
  | typeof GATE0_CONSTANTS.STATUS_ERROR;

/**
 * Gate-level binary verdict.
 */
export type Gate0Verdict =
  | typeof GATE0_CONSTANTS.VERDICT_PASSED
  | typeof GATE0_CONSTANTS.VERDICT_FAILED
  | typeof GATE0_CONSTANTS.VERDICT_TIMEOUT
  | typeof GATE0_CONSTANTS.VERDICT_ERROR;

/**
 * Result emitted by an executed shell command.
 */
export interface Gate0CommandRunnerResult {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Options passed to a command runner.
 */
export interface Gate0CommandRunnerOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * Pluggable command runner interface for dependency injection and deterministic testing.
 */
export type Gate0CommandRunner = (
  command: string,
  options?: Gate0CommandRunnerOptions,
) => Promise<Gate0CommandRunnerResult>;

/**
 * Context provided to running checks.
 */
export interface Gate0ExecutionContext {
  repoRoot: string;
  cwd: string;
  runner: Gate0CommandRunner;
  timeoutMs: number;
  perCommandTimeoutMs: number;
  attempt: number;
  maxAttempts: number;
  taskId?: string;
  affectedFiles?: readonly string[];
  specs?: readonly string[];
  env?: Record<string, string>;
}

/**
 * Definition of a single verification check in Gate 0.
 */
export interface Gate0CheckDefinition {
  id: string;
  name: string;
  type: Gate0CheckType;
  command?: string;
  customRunner?: (context: Gate0ExecutionContext) => Promise<Gate0CheckExecutionResult>;
  required: boolean;
  timeoutMs?: number;
  cwd?: string;
  description?: string;
}

/**
 * Outcome of executing a single check.
 */
export interface Gate0CheckExecutionResult {
  id: string;
  name: string;
  type: Gate0CheckType;
  command: string;
  exitCode: number;
  status: Gate0CheckStatus;
  stdout: string;
  stderr: string;
  output: string;
  durationMs: number;
  timedOut: boolean;
  errorMessage?: string;
  parsedTrace?: Gate0ParsedTrace;
}

/**
 * Violation report for protected directory layout invariant breach.
 */
export interface Gate0LayoutViolation {
  filePath: string;
  reason: string;
  rule: string;
}

/**
 * Outcome of filesystem layout verification.
 */
export interface Gate0LayoutCheckResult {
  valid: boolean;
  violations: Gate0LayoutViolation[];
  inspectedDir: string;
  scannedCount: number;
}

/**
 * Observability and lifecycle hooks for Gate 0 execution.
 */
export interface Gate0RunnerHooks {
  onCheckStart?: (check: Gate0CheckDefinition) => void;
  onCheckComplete?: (result: Gate0CheckExecutionResult) => void;
  onGateComplete?: (result: Gate0Result) => void;
  say?: (message: string) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Options configuring the Gate 0 mechanical test runner.
 */
export interface Gate0RunnerOptions {
  /** Target repository or workspace root directory */
  repoRoot?: string;
  /** Working directory for command execution. Defaults to process.cwd() */
  cwd?: string;
  /** Verification commands or custom check definitions to run */
  commands?: readonly string[] | readonly Gate0CheckDefinition[] | string[] | Gate0CheckDefinition[];
  /** File paths modified by the worker session */
  affectedFiles?: readonly string[] | string[];
  /** Specific test specs to focus execution on (e.g. test/gates/gate0.test.ts) */
  specs?: readonly string[] | string[];
  /** Gate execution overall timeout in ms */
  timeoutMs?: number;
  /** Per-command timeout in ms */
  perCommandTimeoutMs?: number;
  /** Stop execution immediately upon encountering first failed check */
  stopOnFirstFailure?: boolean;
  /** Enable Agnostic Looper filesystem layout assertion for .agents/teamwork */
  enableLayoutCheck?: boolean;
  /** Target directory for metadata layout assertion */
  protectedMetadataDir?: string;
  /** Custom command runner for dependency injection */
  runner?: Gate0CommandRunner;
  /** Task identifier (e.g. "1.1") */
  taskId?: string;
  /** Current attempt counter */
  attempt?: number;
  /** Maximum attempt counter */
  maxAttempts?: number;
  /** Additional environment variables passed to runner */
  env?: Record<string, string>;
  /** Commands or custom check definitions executed specifically during Fast-Track bypass */
  fastTrackCommands?: readonly string[] | readonly Gate0CheckDefinition[] | string[] | Gate0CheckDefinition[];
  /** Gate execution policy: "fast-track", "full-gate", or "auto" (default: "auto") */
  policy?: GatePolicySelection;
  /** Whether to allow fast-track policy bypass for documentation-only changes. Defaults to true */
  allowFastTrack?: boolean;
  /** Hooks for progress and event reporting */
  hooks?: Gate0RunnerHooks;
}

/**
 * Options for formatting structured verification feedback.
 */
export interface Gate0FeedbackOptions {
  taskId?: string;
  attempt?: number;
  maxAttempts?: number;
  maxLength?: number;
  tailLines?: number;
}

/**
 * Comprehensive execution report generated by Gate 0.
 */
export interface Gate0Result {
  success: boolean;
  verdict: Gate0Verdict;
  exitCode: number;
  checks: Gate0CheckExecutionResult[];
  failures: Gate0CheckExecutionResult[];
  passed: Gate0CheckExecutionResult[];
  skipped: Gate0CheckExecutionResult[];
  durationMs: number;
  summary: string;
  layoutResult?: Gate0LayoutCheckResult;
  fastTrackEligible: boolean;
  policy?: GateExecutionPolicy;
  policyResult?: GatePolicyEvaluationResult;
  bypassedGates?: readonly ("gate1" | "gate2")[];
  recommendedEvent?: Gate0PolicyRecommendedEvent;
  feedbackPrompt?: string;
  timestamp: string;
}

/**
 * Diagnostic severity level for compiler and linter findings.
 */
export type Gate0DiagnosticSeverity =
  | typeof GATE0_PARSER_CONSTANTS.SEVERITY_ERROR
  | typeof GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
  | typeof GATE0_PARSER_CONSTANTS.SEVERITY_INFO;

/**
 * Origin source identifying which tool produced a diagnostic.
 */
export type Gate0DiagnosticSource =
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_TSC
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_ESLINT
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_BIOME
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_COMPILER
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_LINTER
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_GENERIC;

/**
 * Structured compiler or linter diagnostic.
 */
export interface Gate0ParsedDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  severity: Gate0DiagnosticSeverity;
  source: Gate0DiagnosticSource;
  raw?: string;
}

/**
 * Structured stack trace frame.
 */
export interface Gate0StackFrame {
  raw: string;
  functionName?: string;
  file?: string;
  line?: number;
  column?: number;
  isInternal: boolean;
  isProject: boolean;
}

/**
 * Structured unit test failure report.
 */
export interface Gate0ParsedTestFailure {
  testName?: string;
  file?: string;
  line?: number;
  expected?: string;
  received?: string;
  message: string;
  stackFrames: Gate0StackFrame[];
  rawSnippet?: string;
}

/**
 * Complete parsed trace bundle for a failed Gate 0 check.
 */
export interface Gate0ParsedTrace {
  diagnostics: Gate0ParsedDiagnostic[];
  testFailures: Gate0ParsedTestFailure[];
  stackFrames: Gate0StackFrame[];
  sanitizedStderr: string;
  sanitizedStdout: string;
  sanitizedOutput: string;
  summaryMessage?: string;
}

/**
 * Gate execution policy identifier.
 */
export type GateExecutionPolicy =
  | typeof GATE0_POLICY_CONSTANTS.POLICY_FAST_TRACK
  | typeof GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE;

/**
 * Policy mode requested by the caller: "fast-track", "full-gate", or "auto" (default).
 */
export type GatePolicySelection =
  | GateExecutionPolicy
  | typeof GATE0_POLICY_CONSTANTS.POLICY_AUTO;

/**
 * Bypassed gate names during Fast-Track policy.
 */
export type Gate0BypassedGate =
  | typeof GATE0_POLICY_CONSTANTS.GATE_1
  | typeof GATE0_POLICY_CONSTANTS.GATE_2;

/**
 * Required verification gates.
 */
export type Gate0RequiredGate =
  | typeof GATE0_POLICY_CONSTANTS.GATE_0
  | typeof GATE0_POLICY_CONSTANTS.GATE_1
  | typeof GATE0_POLICY_CONSTANTS.GATE_2
  | typeof GATE0_POLICY_CONSTANTS.GATE_3;

/**
 * FSM transition events emitted from Gate 0 evaluation.
 */
export type Gate0PolicyRecommendedEvent =
  | typeof GATE0_POLICY_CONSTANTS.EVT_G0_PASS
  | typeof GATE0_POLICY_CONSTANTS.EVT_G0_PASS_FAST_TRACK
  | typeof GATE0_POLICY_CONSTANTS.EVT_G0_RETRY
  | typeof GATE0_POLICY_CONSTANTS.EVT_G0_EXHAUSTED;

/**
 * Options configuring Gate execution policy evaluation.
 */
export interface GatePolicyEvaluationOptions {
  /** File paths modified or affected by the worker */
  affectedFiles?: readonly string[] | string[];
  /** Requested policy selection mode: "fast-track", "full-gate", or "auto" */
  policy?: GatePolicySelection;
  /** Whether to allow fast-track policy bypass. Set to false to force Full-Gate */
  allowFastTrack?: boolean;
  /** Optional task description or goal */
  taskDescription?: string;
  /** Task identifier (e.g. "1.3") */
  taskId?: string;
  /** Repository root directory */
  repoRoot?: string;
}

/**
 * Detailed report produced by the Gate execution policy evaluator.
 */
export interface GatePolicyEvaluationResult {
  /** Selected policy: "fast-track" or "full-gate" */
  policy: GateExecutionPolicy;
  /** Whether Fast-Track bypass is granted */
  isFastTrack: boolean;
  /** Bypassed verification gates (Gate 1 & Gate 2 for fast-track; none for full-gate) */
  bypassedGates: readonly Gate0BypassedGate[];
  /** Required verification gates */
  requiredGates: readonly Gate0RequiredGate[];
  /** Human-readable rationale for the policy determination */
  reason: string;
  /** Files that disqualified the change from Fast-Track bypass */
  disqualifiedFiles: readonly string[];
  /** Files recognized as qualifying documentation or safe metadata */
  candidateFiles: readonly string[];
  /** Full list of normalized files inspected */
  inspectedFiles: readonly string[];
  /** FSM event recommended upon successful Gate 0 exit */
  recommendedSuccessEvent: typeof GATE0_POLICY_CONSTANTS.EVT_G0_PASS | typeof GATE0_POLICY_CONSTANTS.EVT_G0_PASS_FAST_TRACK;
}

/**
 * Options for resolving the recommended Gate 0 FSM transition event.
 */
export interface ResolveGate0EventOptions {
  /** Whether all Gate 0 mechanical checks passed */
  success: boolean;
  /** Whether Fast-Track policy is active */
  isFastTrack?: boolean;
  /** Current attempt index */
  attempt?: number;
  /** Maximum allowed attempts */
  maxAttempts?: number;
}
