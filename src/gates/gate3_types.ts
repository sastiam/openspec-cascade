/**
 * Shared gate3_audit, gate3_scanner contracts extracted to keep the module graph acyclic.
 */
import { type IPalProvider } from "../pal/types";
import { SubagentDispatcher, type SubagentInstance } from "../core/dispatcher";
import { LOOPER_EVENTS, LOOPER_STATES, type LooperEvent } from "../core/fsm_types";
import { RollbackStateBuffer, type RollbackOptions, type RollbackResult, type CommandRunner } from "../engine/rollback_buffer";
import { type Gate3AntiCheatScanner } from "./gate3_scanner";

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
 * Central constants ensuring zero magic numbers across anti-cheat scanning operations.
 */
export const GATE3_SCANNER_CONSTANTS = {
  // Invariant Category (matching Gate3)
  INVARIANT_CATEGORY: "anti_cheat" as const,
  INVARIANT_NAME: "anti_cheat_integrity" as const,

  // Anti-Cheat Categories
  CATEGORY_PLACEHOLDERS: "placeholders" as const,
  CATEGORY_DISABLED_ASSERTIONS: "disabled_assertions" as const,
  CATEGORY_MOCKED_SUITES: "mocked_test_suites" as const,
  CATEGORY_CUSTOM: "custom" as const,

  // Severities
  SEVERITY_VETO: "veto" as const,
  SEVERITY_WARNING: "warning" as const,

  // Statuses
  STATUS_PASSED: "passed" as const,
  STATUS_VIOLATED: "violated" as const,

  // Rule Identifiers
  RULE_PLACEHOLDER_TODO: "AC-001-PLACEHOLDER-TODO" as const,
  RULE_PLACEHOLDER_STUB: "AC-002-PLACEHOLDER-STUB" as const,
  RULE_PLACEHOLDER_UNIMPLEMENTED: "AC-003-PLACEHOLDER-UNIMPLEMENTED" as const,
  RULE_DUMMY_RETURN_PROD: "AC-004-DUMMY-RETURN-PROD" as const,
  RULE_MOCK_IN_PRODUCTION: "AC-005-MOCK-IN-PRODUCTION" as const,
  RULE_HARDCODED_FACADE: "AC-006-HARDCODED-FACADE" as const,

  RULE_DISABLED_TEST_SKIP: "AC-010-DISABLED-TEST-SKIP" as const,
  RULE_DISABLED_TEST_TODO: "AC-011-DISABLED-TEST-TODO" as const,
  RULE_ISOLATED_TEST_ONLY: "AC-012-ISOLATED-TEST-ONLY" as const,
  RULE_COMMENTED_ASSERTION: "AC-013-COMMENTED-ASSERTION" as const,
  RULE_TRIVIAL_ASSERTION: "AC-014-TRIVIAL-ASSERTION" as const,
  RULE_EMPTY_TEST_BODY: "AC-015-EMPTY-TEST-BODY" as const,
  RULE_ASSERTION_SUPPRESSION: "AC-016-ASSERTION-SUPPRESSION" as const,

  RULE_MOCKED_SUBJECT_UNDER_TEST: "AC-020-MOCKED-SUBJECT-UNDER-TEST" as const,
  RULE_TEST_HARNESS_HIJACKING: "AC-021-TEST-HARNESS-HIJACKING" as const,
  RULE_EXCESSIVE_MOCKING: "AC-022-EXCESSIVE-MOCKING" as const,

  // Rule Citations
  CITATION_AXIOM_ORACLE:
    "SPECIFICATION.md Section 3.1: The Harness as Oracle Axiom - An agent cannot self-attest or bypass verification." as const,
  CITATION_GATE3_VETO:
    "SPECIFICATION.md Section 3.5: Gate 3 Forensic Auditor Binary Veto & Invariant Enforcement." as const,
  CITATION_OPENSPEC_MOCK_PROD:
    "OpenSpec Scenario: An agent commits mock responses in production code -> triggers binary veto." as const,
  CITATION_OPENSPEC_TEST_HYGIENE:
    "SPECIFICATION.md Section 3.1 & 3.5: No test skipping, test isolation, or test evasion permitted." as const,

  // Regex Detection Patterns
  PATTERNS: {
    // 1. Placeholders & Stubs
    PLACEHOLDER_TODO: /\/\/\s*(?:TODO|FIXME|XXX)\s*:\s*(?:implement|placeholder|stub)/i,
    PLACEHOLDER_STUB: /\/\/\s*(?:placeholder|stub|dummy)\b/i,
    PLACEHOLDER_BLOCK_COMMENT: /\/\*\s*(?:placeholder|stub|dummy|TODO:\s*implement)\s*\*\//i,
    UNIMPLEMENTED_ERROR:
      /throw\s+new\s+(?:Error|NotImplementedError)\s*\(\s*["'](?:not implemented|unimplemented|TODO|stub|placeholder)/i,
    DUMMY_RETURN_STUB:
      /return\s+(?:null|\{\}|\[\]|false|0|""|undefined)\s*(?:as\s+any)?\s*;\s*\/\/\s*(?:stub|placeholder|dummy)/i,
    DUMMY_RETURN_ANY:
      /return\s+(?:null|\{\}|\[\])\s+as\s+any\s*;/i,
    FACADE_COMMENT:
      /\/\/\s*(?:facade|fake implementation|mock-response|hardcoded response)/i,

    // Mock in production code
    MOCK_IMPORTS_PROD:
      /(?:from\s+["']bun:test["']|from\s+["']jest["']|from\s+["']@jest\/globals["']|from\s+["']vitest["']|from\s+["']sinon["'])/,
    MOCK_CALLS_PROD:
      /\b(?:jest\.fn|jest\.mock|mock\.module|mock\s*\(|spyOn\s*\()/,

    // 2. Disabled Assertions & Evasion
    TEST_SKIP: /\b(?:test|it|describe|suite)\.skip\b/,
    TEST_TODO: /\b(?:test|it)\.todo\b/,
    TEST_X_PREFIX: /\b(?:xit|xtest|xdescribe)\s*\(/,
    TEST_ONLY: /\b(?:test|it|describe|suite)\.only\b/,
    TEST_F_PREFIX: /\b(?:fit|fdescribe)\s*\(/,
    COMMENTED_ASSERTION: /\/\/\s*(?:expect|assert|assertThat)\s*\(/,
    COMMENTED_ASSERTION_BLOCK: /\/\*\s*(?:expect|assert)\s*\(.*?\*\//,

    // Trivial & self-attesting assertions
    TRIVIAL_SAME_LITERAL:
      /expect\(\s*(true|false|1|0|null|undefined|NaN)\s*\)\.toBe\(\s*\1\s*\)/,
    TRIVIAL_STRING_LITERAL:
      /expect\(\s*(["'`])([^"'\\]*)\1\s*\)\.toBe\(\s*(["'`])\2\3\s*\)/,
    TRIVIAL_IDENTIFIER_MATCH:
      /expect\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)\.toBe\(\s*\1\s*\)/,
    TRIVIAL_BOOLEAN_HELPER:
      /expect\(\s*true\s*\)\.toBeTruthy\(\)|expect\(\s*false\s*\)\.toBeFalsy\(\)/,
    TRIVIAL_NULL_HELPER:
      /expect\(\s*null\s*\)\.toBeNull\(\)|expect\(\s*undefined\s*\)\.toBeUndefined\(\)|expect\(\s*NaN\s*\)\.toBeNaN\(\)/,
    TRIVIAL_ASSERT_CALL:
      /\bassert(?:\.ok)?\(\s*true\s*\)|\bassert(?:\.strictEqual|\.equal|\.deepEqual)?\(\s*(?:true\s*,\s*true|1\s*,\s*1|["']a["']\s*,\s*["']a["'])\s*\)/,
    TRIVIAL_ARITHMETIC_TAUTOLOGY:
      /expect\(\s*1\s*\+\s*1\s*\)\.toBe\(\s*2\s*\)/,

    // Empty test bodies & suppression
    EMPTY_TEST_BODY:
      /\b(?:test|it)\s*\(\s*["'`][^"'`]+["'`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
    ASSERTION_SUPPRESSION:
      /try\s*\{\s*expect\([^)]+\)[^}]*\}\s*catch\s*(?:\([^)]*\))?\s*\{\s*\}/,

    // 3. Mocked test suites & harness hijacking
    HARNESS_HIJACKING_EXPECT:
      /(?:global|globalThis|window)\.expect\s*=/,
    HARNESS_HIJACKING_TEST:
      /(?:global|globalThis|window)\.(?:test|it|describe)\s*=/,
    PROCESS_EXIT_HIJACKING:
      /process\.exit\s*=\s*/,
    MOCK_DEFINITION:
      /\b(?:mock\.module|mock\s*\(|jest\.mock|jest\.spyOn|spyOn\s*\()/,
    REAL_ASSERTION:
      /\b(?:expect\s*\(|assert\s*\(|assert\.[a-zA-Z]+)/,
  },

  // File Classification
  PRODUCTION_PATH_PREFIXES: ["src/"] as const,
  TEST_PATH_PATTERNS: [
    /(?:^|[\\/])test[\\/]/i,
    /(?:^|[\\/])tests[\\/]/i,
    /(?:^|[\\/])spec[\\/]/i,
    /(?:^|[\\/])specs[\\/]/i,
    /(?:^|[\\/])__tests__[\\/]/i,
    /\.(?:test|spec)\.[a-zA-Z0-9]+$/i,
  ] as const,

  // Thresholds & Constants
  DEFAULT_EXCESSIVE_MOCK_THRESHOLD: 0.8, // 80% mocks vs assertions
  DEFAULT_MIN_MOCKS_FOR_EXCESSIVE: 6,
  DIFF_HEADER_PREFIX_LENGTH: 6, // "+++ b/"
  DIFF_HUNK_PREFIX: "@@" as const,
  DIFF_PLUS_PREFIX: "+" as const,
  DIFF_MINUS_PREFIX: "-" as const,
  DIFF_FILE_HEADER: "diff --git" as const,
  MAX_SNIPPET_LENGTH: 120,
  MAX_DISPLAY_VIOLATIONS: 50,

  // Zero Magic Numbers
  NUM_ZERO: 0,
  NUM_ONE: 1,
  NUM_TWO: 2,
  NUM_THREE: 3,
  INDEX_NOT_FOUND: -1,
  SLICE_ONE: 1,
  PERCENT_MULTIPLIER: 100,
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

/**
 * Categorization of anti-cheat rules.
 */
export type AntiCheatCategory =
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM;

/**
 * Severity assigned to an anti-cheat finding.
 */
export type AntiCheatSeverity =
  | typeof GATE3_SCANNER_CONSTANTS.SEVERITY_VETO
  | typeof GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING;

/**
 * Structured violation detected by an anti-cheat scanner rule.
 */
export interface AntiCheatViolation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly category: AntiCheatCategory;
  readonly severity: AntiCheatSeverity;
  readonly description: string;
  readonly file: string;
  readonly line?: number;
  readonly snippet?: string;
  readonly ruleCitation?: string;
  readonly remediation?: string;
}

/**
 * Context provided to an anti-cheat rule during file or diff evaluation.
 */
export interface AntiCheatRuleContext {
  readonly filePath: string;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly content: string;
  readonly lines: readonly string[];
  readonly addedLines?: readonly { line: string; lineNumber: number }[];
  readonly diffMode: boolean;
}

/**
 * Pluggable Anti-Cheat Rule Contract.
 */
export interface AntiCheatRule {
  readonly id: string;
  readonly name: string;
  readonly category: AntiCheatCategory;
  readonly severity: AntiCheatSeverity;
  readonly description: string;
  readonly ruleCitation: string;
  readonly appliesTo: "production" | "test" | "all";
  readonly evaluate: (
    context: AntiCheatRuleContext
  ) => AntiCheatViolation[] | Promise<AntiCheatViolation[]>;
}

/**
 * Comprehensive report generated by Gate 3 Anti-Cheat Scanner.
 */
export interface AntiCheatScanReport {
  readonly passed: boolean;
  readonly veto: boolean;
  readonly totalViolations: number;
  readonly vetoViolations: number;
  readonly warningViolations: number;
  readonly violationsByCategory: Record<AntiCheatCategory, number>;
  readonly scannedFiles: readonly string[];
  readonly violations: readonly AntiCheatViolation[];
  readonly summary: string;
  readonly durationMs: number;
}

/**
 * Configuration options for initializing Gate3AntiCheatScanner.
 */
export interface AntiCheatScannerOptions {
  readonly workspaceRoot?: string;
  readonly repoRoot?: string;
  readonly rules?: readonly AntiCheatRule[];
  readonly disabledRuleIds?: readonly string[];
  readonly excessiveMockThreshold?: number;
  readonly minMocksForExcessive?: number;
  readonly ignorePatterns?: readonly (RegExp | string)[];
  readonly customRules?: readonly AntiCheatRule[];
}

/**
 * Structured hunk diff file item.
 */
export interface DiffFileSection {
  readonly filePath: string;
  readonly addedLines: readonly { line: string; lineNumber: number }[];
  readonly fullAddedContent: string;
}
