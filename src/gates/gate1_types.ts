/**
 * Shared gate1_review, gate1_rubric, gate1_feedback contracts extracted to keep the module graph acyclic.
 */
import { COGNITIVE_ROLES, type IPalProvider } from "../pal/types";
import { ROLES_CONSTANTS } from "../core/roles";
import { SubagentDispatcher, type SubagentInstance } from "../core/dispatcher";
import { LOOPER_EVENTS, LOOPER_STATES, type LooperEvent, type LooperState } from "../core/fsm_types";

/**
 * Central constants ensuring zero magic numbers across Gate 1 operations.
 */
export const GATE1_CONSTANTS = {
  // Verdicts
  VERDICT_APPROVED: "APPROVED" as const,
  VERDICT_REVISE: "REVISE" as const,
  VERDICT_REJECTED: "REJECTED" as const,

  // Recommended FSM Domain Events
  EVENT_G1_PASS: LOOPER_EVENTS.EVT_G1_PASS,
  EVENT_G1_REVISE: LOOPER_EVENTS.EVT_G1_REVISE,
  EVENT_G1_REJECT: LOOPER_EVENTS.EVT_G1_REJECT,

  // Associated FSM States
  STATE_GATE_1_REVIEW: LOOPER_STATES.STATE_GATE_1_REVIEW,
  STATE_GATE_2_CHALLENGE: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
  STATE_EXECUTE_WORKER: LOOPER_STATES.STATE_EXECUTE_WORKER,
  STATE_ESCALATE_DIAGNOSTIC: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,

  // Attempts and limits
  DEFAULT_ATTEMPT: 1,
  DEFAULT_MAX_ATTEMPTS: 3,
  DEFAULT_TIMEOUT_MS: 300_000, // 5 minutes
  DEFAULT_GIT_TIMEOUT_MS: 30_000, // 30 seconds
  DEFAULT_MAX_DIFF_BYTES: 500_000, // 500 KB limit for diff injection
  DEFAULT_MAX_DIFF_LINES: 5_000,
  DEFAULT_MAX_FINDINGS: 50,

  // Scoring thresholds
  SCORE_MIN: 0,
  SCORE_MAX: 100,
  SCORE_THRESHOLD_PASS: 80,
  SCORE_DEFAULT_APPROVED: 100,
  SCORE_DEFAULT_REVISE: 60,
  SCORE_DEFAULT_REJECTED: 20,

  // Score deductions by severity
  DEDUCTION_FATAL: 40,
  DEDUCTION_ERROR: 20,
  DEDUCTION_WARNING: 5,
  DEDUCTION_INFO: 0,

  // Cognitive Role & Archetype Defaults
  ROLE_REVIEWER: COGNITIVE_ROLES.REVIEWER,
  ARCHETYPE_REVIEWER: ROLES_CONSTANTS.ARCHETYPE_REVIEWER,
  TIER_REVIEWER: ROLES_CONSTANTS.TIER_REVIEWER,
  DEFAULT_PROVIDER: "claude",
  DEFAULT_MODEL: "claude-3-7-sonnet-20250219",

  // Check Categories
  CATEGORY_SPEC_FIDELITY: "specification_fidelity" as const,
  CATEGORY_BOUNDARY_CONTAINMENT: "boundary_containment" as const,
  CATEGORY_REGRESSION_RISK: "regression_risk" as const,
  CATEGORY_CODE_QUALITY: "code_quality" as const,
  CATEGORY_ZERO_MAGIC_NUMBERS: "zero_magic_numbers" as const,
  CATEGORY_STRICT_TYPING: "strict_typing" as const,
  CATEGORY_UNHANDLED_REJECTIONS: "unhandled_rejections" as const,
  CATEGORY_CROSS_PLATFORM: "cross_platform" as const,
  CATEGORY_DOD_ADHERENCE: "dod_adherence" as const,

  // Severity Levels
  SEVERITY_FATAL: "fatal" as const,
  SEVERITY_ERROR: "error" as const,
  SEVERITY_WARNING: "warning" as const,
  SEVERITY_INFO: "info" as const,

  // Sandbox Files & Paths
  REPORT_FILENAME: "review_report.md",
  FINDINGS_JSON_FILENAME: "review_findings.json",
  FEEDBACK_XML_FILENAME: "review_feedback.xml",
  DEFAULT_TEAMWORK_DIR: ".agents/teamwork",
  DIFF_HUNK_PREFIX: "@@ -",

  // Numeric literals & offsets
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  INDEX_NOT_FOUND: -1,
  LINE_OFFSET_ONE: 1,
  REGEX_CAPTURE_GROUP_ONE: 1,
  REGEX_CAPTURE_GROUP_TWO: 2,
  GIT_HEADER_MIN_PARTS: 4,
  GIT_PREFIX_SLICE_INDEX: 2,
  DIFF_PLUS_PREFIX_LENGTH: 6,
  DIFF_MINUS_PREFIX_LENGTH: 6,
  RELATIVE_PREFIX_LENGTH: 2,
  GLOB_DOUBLE_STAR_OFFSET: -3,
  GLOB_SINGLE_STAR_OFFSET: -2,
  RUBRIC_SCORE_DEFECTIVE: 50,
  RUBRIC_SCORE_DEGRADED: 60,
  JSON_INDENT_SPACES: 2,
  RADIX_DECIMAL: 10,
  TEMPERATURE_DEFAULT: 0.1,

  // Exit codes
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_FAILURE: 1,
  EXIT_CODE_ERROR: 2,

  // Event emitter names
  EVENT_REVIEW_START: "review:start",
  EVENT_SUBAGENT_DISPATCHED: "review:subagent_dispatched",
  EVENT_DIFF_EXTRACTED: "review:diff_extracted",
  EVENT_VERDICT_RESOLVED: "review:verdict_resolved",
  EVENT_REVIEW_COMPLETE: "review:complete",
  EVENT_REVIEW_ERROR: "review:error",
} as const;

export const GATE1_CROSS_PLATFORM = GATE1_CONSTANTS.CATEGORY_CROSS_PLATFORM;

export const CONST_TWO = 2;

/**
 * Central constants ensuring zero magic numbers across Gate 1 rubric evaluation operations.
 */
export const GATE1_RUBRIC_CONSTANTS = {
  // Dimension Identifiers
  DIMENSION_CLEAN_CODE: "clean_code" as const,
  DIMENSION_ZERO_MAGIC_NUMBERS: "zero_magic_numbers" as const,
  DIMENSION_DOD_ADHERENCE: "dod_adherence" as const,
  DIMENSION_BOUNDARY_CONTAINMENT: "boundary_containment" as const,
  DIMENSION_REGRESSION_RISK: "regression_risk" as const,

  // Check Category Identifiers
  CATEGORY_SPEC_FIDELITY: "specification_fidelity" as const,
  CATEGORY_BOUNDARY_CONTAINMENT: "boundary_containment" as const,
  CATEGORY_REGRESSION_RISK: "regression_risk" as const,
  CATEGORY_CODE_QUALITY: "code_quality" as const,
  CATEGORY_ZERO_MAGIC_NUMBERS: "zero_magic_numbers" as const,
  CATEGORY_STRICT_TYPING: "strict_typing" as const,
  CATEGORY_UNHANDLED_REJECTIONS: "unhandled_rejections" as const,
  CATEGORY_CROSS_PLATFORM: "cross_platform" as const,
  CATEGORY_DOD_ADHERENCE: "dod_adherence" as const,

  // Finding Severities
  SEVERITY_FATAL: "fatal" as const,
  SEVERITY_ERROR: "error" as const,
  SEVERITY_WARNING: "warning" as const,
  SEVERITY_INFO: "info" as const,

  // Review Verdicts
  VERDICT_APPROVED: "APPROVED" as const,
  VERDICT_REVISE: "REVISE" as const,
  VERDICT_REJECTED: "REJECTED" as const,

  // Default Dimension Weights (must sum to 100)
  DEFAULT_WEIGHT_CLEAN_CODE: 30,
  DEFAULT_WEIGHT_ZERO_MAGIC_NUMBERS: 25,
  DEFAULT_WEIGHT_DOD_ADHERENCE: 35,
  DEFAULT_WEIGHT_BOUNDARY_CONTAINMENT: 10,
  TOTAL_WEIGHT_PERCENT: 100,

  // Score Scale & Thresholds
  SCORE_ZERO: 0,
  SCORE_MIN: 0,
  SCORE_MAX: 100,
  SCORE_THRESHOLD_PASS: 80,
  SCORE_THRESHOLD_REVISE: 60,
  SCORE_CRITICAL_CEILING: 50,

  // Deductions by Severity
  DEDUCTION_FATAL: 40,
  DEDUCTION_ERROR: 20,
  DEDUCTION_WARNING: 5,
  DEDUCTION_INFO: 0,

  // Specific Category Deductions
  DEDUCTION_STRICT_TYPING: 20,
  DEDUCTION_UNHANDLED_REJECTION: 20,
  DEDUCTION_EMPTY_CATCH: 20,
  DEDUCTION_THROW_NON_ERROR: 15,
  DEDUCTION_DEBUGGER: 30,
  DEDUCTION_CONSOLE_LOG: 5,
  DEDUCTION_PATH_CONCAT: 10,
  DEDUCTION_MAGIC_NUMBER: 15,
  DEDUCTION_MISSING_TESTS: 30,
  DEDUCTION_SKIPPED_TESTS: 25,
  DEDUCTION_UNMET_CRITERIA: 20,
  DEDUCTION_BOUNDARY_VIOLATION: 40,

  // Non-magic idiomatic small numbers
  ALLOWED_NON_MAGIC_NUMBERS: [-1, 0, 1, CONST_TWO] as const,

  // Numeric literals and offsets
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  RADIX_DECIMAL: 10,
  INDEX_NOT_FOUND: -1,
  REGEX_CAPTURE_GROUP_ONE: 1,
  REGEX_CAPTURE_GROUP_TWO: 2,
  GIT_HEADER_MIN_PARTS: 4,
  GIT_PREFIX_SLICE_INDEX: 2,
  DIFF_PLUS_PREFIX_LENGTH: 6,
  DIFF_MINUS_PREFIX_LENGTH: 6,
  MIN_SIGNIFICANT_DELETIONS: 20,
} as const;

/**
 * Central constants ensuring zero magic numbers across Gate 1 feedback operations.
 */
export const GATE1_FEEDBACK_CONSTANTS = {
  // Recommendation Types
  REC_PASS: "PASS" as const,
  REC_REVISE: "REVISE" as const,
  REC_REJECT: "REJECT" as const,

  // Verdicts
  VERDICT_APPROVED: "APPROVED" as const,
  VERDICT_REVISE: "REVISE" as const,
  VERDICT_REJECTED: "REJECTED" as const,

  // Gate Identifier
  GATE_ID: "gate1" as const,

  // Recommendation Priorities
  PRIORITY_CRITICAL: "CRITICAL" as const,
  PRIORITY_HIGH: "HIGH" as const,
  PRIORITY_MEDIUM: "MEDIUM" as const,
  PRIORITY_LOW: "LOW" as const,

  // Finding Severities
  SEVERITY_FATAL: "fatal" as const,
  SEVERITY_ERROR: "error" as const,
  SEVERITY_WARNING: "warning" as const,
  SEVERITY_INFO: "info" as const,

  // Check Categories
  CATEGORY_SPEC_FIDELITY: "specification_fidelity" as const,
  CATEGORY_BOUNDARY_CONTAINMENT: "boundary_containment" as const,
  CATEGORY_REGRESSION_RISK: "regression_risk" as const,
  CATEGORY_CODE_QUALITY: "code_quality" as const,
  CATEGORY_ZERO_MAGIC_NUMBERS: "zero_magic_numbers" as const,
  CATEGORY_STRICT_TYPING: "strict_typing" as const,
  CATEGORY_UNHANDLED_REJECTIONS: "unhandled_rejections" as const,
  CATEGORY_CROSS_PLATFORM: "cross_platform" as const,
  CATEGORY_DOD_ADHERENCE: "dod_adherence" as const,

  // Verification Confidence
  CONFIDENCE_HIGH: "HIGH" as const,
  CONFIDENCE_MEDIUM: "MEDIUM" as const,
  CONFIDENCE_MAXIMUM: "MAXIMUM" as const,

  // Next Gates & Stages
  NEXT_GATE_CHALLENGER: "gate2_challenge" as const,
  NEXT_STAGE_WORKER: "worker_revision" as const,
  NEXT_STAGE_DIAGNOSTIC: "escalate_diagnostic" as const,

  // Recommended FSM Domain Events
  EVENT_G1_PASS: LOOPER_EVENTS.EVT_G1_PASS,
  EVENT_G1_REVISE: LOOPER_EVENTS.EVT_G1_REVISE,
  EVENT_G1_REJECT: LOOPER_EVENTS.EVT_G1_REJECT,

  // Associated Target FSM States
  STATE_GATE_2_CHALLENGE: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
  STATE_EXECUTE_WORKER: LOOPER_STATES.STATE_EXECUTE_WORKER,
  STATE_ESCALATE_DIAGNOSTIC: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,

  // Score defaults and thresholds
  SCORE_MIN: 0,
  SCORE_MAX: 100,
  SCORE_THRESHOLD_PASS: 80,
  SCORE_DEFAULT_APPROVED: 100,
  SCORE_DEFAULT_REVISE: 60,
  SCORE_DEFAULT_REJECTED: 20,

  // Attempt defaults and limits
  DEFAULT_ATTEMPT: 1,
  DEFAULT_MAX_ATTEMPTS: 3,
  DEFAULT_MAX_FINDINGS: 50,
  DEFAULT_MAX_CITATION_LINES: 10,
  DEFAULT_TRUNCATION_LIMIT: 3000,

  // Numeric literals
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  JSON_INDENT_SPACES: 2,
  RADIX_DECIMAL: 10,
} as const;

/**
 * Gate 1 semantic review verdict.
 */
export type Gate1Verdict =
  | typeof GATE1_CONSTANTS.VERDICT_APPROVED
  | typeof GATE1_CONSTANTS.VERDICT_REVISE
  | typeof GATE1_CONSTANTS.VERDICT_REJECTED;

/**
 * Finding severity classification.
 */
export type Gate1FindingSeverity =
  | typeof GATE1_CONSTANTS.SEVERITY_FATAL
  | typeof GATE1_CONSTANTS.SEVERITY_ERROR
  | typeof GATE1_CONSTANTS.SEVERITY_WARNING
  | typeof GATE1_CONSTANTS.SEVERITY_INFO;

/**
 * Recognized semantic review categories.
 */
export type Gate1CheckCategory =
  | typeof GATE1_CONSTANTS.CATEGORY_SPEC_FIDELITY
  | typeof GATE1_CONSTANTS.CATEGORY_BOUNDARY_CONTAINMENT
  | typeof GATE1_CONSTANTS.CATEGORY_REGRESSION_RISK
  | typeof GATE1_CONSTANTS.CATEGORY_CODE_QUALITY
  | typeof GATE1_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS
  | typeof GATE1_CONSTANTS.CATEGORY_STRICT_TYPING
  | typeof GATE1_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS
  | typeof GATE1_CONSTANTS.CATEGORY_DOD_ADHERENCE
  | typeof GATE1_CROSS_PLATFORM;

export type Gate1CROSS_PLATFORM = typeof GATE1_CONSTANTS.CATEGORY_CROSS_PLATFORM;

/**
 * Structured finding citation produced by Gate 1 audit.
 */
export interface Gate1Finding {
  readonly id: string;
  readonly category: Gate1CheckCategory;
  readonly severity: Gate1FindingSeverity;
  readonly message: string;
  readonly filePath?: string;
  readonly lineNumber?: number;
  readonly lineCitation?: string;
  readonly remediation?: string;
}

/**
 * Outcome of boundary containment check.
 */
export interface Gate1BoundaryCheckResult {
  readonly passed: boolean;
  readonly authorizedFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly unauthorizedFiles: readonly string[];
  readonly details: string;
}

/**
 * Git diff metrics and stats.
 */
export interface Gate1DiffStats {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly fileList: readonly string[];
}

/**
 * Individual checklist rubric item outcome.
 */
export interface Gate1RubricCheckItem {
  readonly id: string;
  readonly category: Gate1CheckCategory;
  readonly name: string;
  readonly passed: boolean;
  readonly score: number;
  readonly findings: readonly Gate1Finding[];
  readonly notes?: string;
}

/**
 * Complete review report emitted by Gate 1.
 */
export interface Gate1ReviewReport {
  readonly verdict: Gate1Verdict;
  readonly score: number;
  readonly summary: string;
  readonly checklistResults: Readonly<Record<string, boolean>>;
  readonly rubricChecks: readonly Gate1RubricCheckItem[];
  readonly findings: readonly Gate1Finding[];
  readonly boundaryCheck: Gate1BoundaryCheckResult;
  readonly diffStats: Gate1DiffStats;
  readonly remediationAdvice: readonly string[];
  readonly rawResponse?: string;
}

/**
 * Final execution result returned by Gate1Reviewer orchestrator.
 */
export interface Gate1ReviewResult {
  readonly success: boolean;
  readonly verdict: Gate1Verdict;
  readonly recommendedEvent: LooperEvent;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly report: Gate1ReviewReport;
  readonly severeViolation: boolean;
  readonly feedback?: Gate1StructuredFeedback;
  readonly subagentId?: string;
  readonly sandboxDir?: string;
  readonly durationMs: number;
  readonly timestamp: string;
}

/**
 * Context payload provided to custom review execution engines.
 */
export interface Gate1ExecutionContext {
  readonly taskId?: string;
  readonly taskDescription?: string;
  readonly acceptanceCriteria: readonly string[];
  readonly targetFiles: readonly string[];
  readonly gitDiff: string;
  readonly diffStats: Gate1DiffStats;
  readonly boundaryCheck: Gate1BoundaryCheckResult;
  readonly subagentInstance?: SubagentInstance;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly options: Readonly<Gate1ReviewerOptions>;
}

/**
 * Pluggable review executor for custom runner engines or unit testing.
 */
export type Gate1ReviewExecutor = (
  context: Gate1ExecutionContext
) => Promise<Gate1ReviewReport>;

/**
 * Options configuring the Gate1Reviewer orchestrator.
 */
export interface Gate1ReviewerOptions {
  /** Root directory of the repository/workspace (defaults to process.cwd()) */
  readonly workspaceRoot?: string;
  /** Repository root directory override */
  readonly repoRoot?: string;
  /** Identifier of the task under review */
  readonly taskId?: string;
  /** Task goal or descriptive specification */
  readonly taskDescription?: string;
  /** List of acceptance criteria required for task approval */
  readonly acceptanceCriteria?: readonly string[];
  /** Definition of Done items */
  readonly definitionOfDone?: readonly string[];
  /** Whitelist of authorized target files (enforces boundary containment) */
  readonly targetFiles?: readonly string[];
  /** Baseline git SHA for computing diff */
  readonly baselineSha?: string;
  /** Pre-extracted git diff string (skips shell diff extraction if supplied) */
  readonly diff?: string;
  /** Current review attempt count (default: 1) */
  readonly attempt?: number;
  /** Maximum permitted review attempts before escalation (default: 3) */
  readonly maxAttempts?: number;
  /** Review timeout in milliseconds (default: 300,000 ms) */
  readonly timeoutMs?: number;
  /** LLM model name */
  readonly model?: string;
  /** Provider adapter or name */
  readonly provider?: IPalProvider | string;
  /** Optional pre-existing SubagentDispatcher instance */
  readonly dispatcher?: SubagentDispatcher;
  /** Whether to automatically clean up subagent sandbox upon completion (default: false) */
  readonly autoCleanup?: boolean;
  /** Custom git diff command runner for testing or non-standard git environments */
  readonly gitRunner?: (
    commandArgs: readonly string[],
    cwd: string,
    timeoutMs?: number
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Pluggable review executor */
  readonly reviewExecutor?: Gate1ReviewExecutor;
  /** Optional logging callback */
  readonly logger?: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * Recognizable rubric evaluation dimensions.
 */
export type Gate1RubricDimension =
  | typeof GATE1_RUBRIC_CONSTANTS.DIMENSION_CLEAN_CODE
  | typeof GATE1_RUBRIC_CONSTANTS.DIMENSION_ZERO_MAGIC_NUMBERS
  | typeof GATE1_RUBRIC_CONSTANTS.DIMENSION_DOD_ADHERENCE
  | typeof GATE1_RUBRIC_CONSTANTS.DIMENSION_BOUNDARY_CONTAINMENT
  | typeof GATE1_RUBRIC_CONSTANTS.DIMENSION_REGRESSION_RISK;

/**
 * Configurable weights for rubric dimensions.
 */
export interface Gate1RubricWeightConfig {
  readonly cleanCode: number;
  readonly zeroMagicNumbers: number;
  readonly dodAdherence: number;
  readonly boundaryContainment: number;
}

/**
 * Outcome of evaluating a single rubric dimension.
 */
export interface Gate1DimensionResult {
  readonly dimension: Gate1RubricDimension;
  readonly name: string;
  readonly passed: boolean;
  readonly score: number;
  readonly weight: number;
  readonly findings: readonly Gate1Finding[];
  readonly checkItems: readonly Gate1RubricCheckItem[];
  readonly summary: string;
}

/**
 * Clean Code rubric evaluation output.
 */
export interface Gate1CleanCodeResult extends Gate1DimensionResult {
  readonly strictTypingPassed: boolean;
  readonly unhandledRejectionsPassed: boolean;
  readonly errorHandlingPassed: boolean;
  readonly crossPlatformPassed: boolean;
  readonly hygienePassed: boolean;
}

/**
 * Zero Magic Numbers rubric evaluation output.
 */
export interface Gate1MagicNumbersResult extends Gate1DimensionResult {
  readonly totalNumericLiteralsDetected: number;
  readonly magicNumberCount: number;
  readonly allowedLiteralCount: number;
  readonly affectedFiles: readonly string[];
}

/**
 * Definition of Done item assessment status.
 */
export interface Gate1DoDItemStatus {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly severity: Gate1FindingSeverity;
  readonly notes: string;
  readonly finding?: Gate1Finding;
}

/**
 * DoD Adherence rubric evaluation output.
 */
export interface Gate1DoDAdherenceResult extends Gate1DimensionResult {
  readonly unitTestsAccompanied: boolean;
  readonly testSuiteClean: boolean;
  readonly acceptanceCriteriaSatisfied: boolean;
  readonly boundaryContained: boolean;
  readonly dodItemStatuses: readonly Gate1DoDItemStatus[];
}

/**
 * Input payload supplied to the semantic rubric evaluation engine.
 */
export interface Gate1RubricEvaluationInput {
  readonly diff: string;
  readonly diffStats?: Gate1DiffStats;
  readonly boundaryCheck?: Gate1BoundaryCheckResult;
  readonly acceptanceCriteria?: readonly string[];
  readonly definitionOfDone?: readonly string[];
  readonly taskId?: string;
  readonly taskDescription?: string;
  readonly weights?: Partial<Gate1RubricWeightConfig>;
  readonly allowNumbersInTests?: boolean;
}

/**
 * Comprehensive outcome returned by the semantic rubric evaluation engine.
 */
export interface Gate1RubricEvaluationResult {
  readonly overallPassed: boolean;
  readonly overallScore: number;
  readonly verdict: Gate1Verdict;
  readonly summary: string;
  readonly cleanCode: Gate1CleanCodeResult;
  readonly zeroMagicNumbers: Gate1MagicNumbersResult;
  readonly dodAdherence: Gate1DoDAdherenceResult;
  readonly boundaryContainment: Gate1DimensionResult;
  readonly checklistResults: Readonly<Record<string, boolean>>;
  readonly allRubricItems: readonly Gate1RubricCheckItem[];
  readonly allFindings: readonly Gate1Finding[];
  readonly remediationAdvice: readonly string[];
  readonly criticalViolation: boolean;
}

/**
 * Gate 1 recommendation decision classification.
 */
export type Gate1RecommendationType =
  | typeof GATE1_FEEDBACK_CONSTANTS.REC_PASS
  | typeof GATE1_FEEDBACK_CONSTANTS.REC_REVISE
  | typeof GATE1_FEEDBACK_CONSTANTS.REC_REJECT;

/**
 * Actionable recommendation priority level.
 */
export type Gate1RecommendationPriority =
  | typeof GATE1_FEEDBACK_CONSTANTS.PRIORITY_CRITICAL
  | typeof GATE1_FEEDBACK_CONSTANTS.PRIORITY_HIGH
  | typeof GATE1_FEEDBACK_CONSTANTS.PRIORITY_MEDIUM
  | typeof GATE1_FEEDBACK_CONSTANTS.PRIORITY_LOW;

/**
 * Actionable recommendation item with location citation and remediation advice.
 */
export interface Gate1ActionableRecommendation {
  readonly id: string;
  readonly category: Gate1CheckCategory;
  readonly severity: Gate1FindingSeverity;
  readonly priority: Gate1RecommendationPriority;
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly location?: {
    readonly filePath: string;
    readonly lineNumber?: number;
    readonly lineCitation?: string;
  };
}

/**
 * Metadata accompanying structured review feedback.
 */
export interface Gate1FeedbackMetadata {
  readonly taskId?: string;
  readonly taskDescription?: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly remainingAttempts: number;
  readonly canRetry: boolean;
  readonly severeViolation: boolean;
  readonly timestamp: string;
  readonly durationMs?: number;
  readonly subagentId?: string;
}

/**
 * Detailed information for PASS recommendations.
 */
export interface Gate1PassDetails {
  readonly qualityScore: number;
  readonly readinessSummary: string;
  readonly nextGate: typeof GATE1_FEEDBACK_CONSTANTS.NEXT_GATE_CHALLENGER;
  readonly targetFsmState: LooperState;
  readonly verificationConfidence:
    | typeof GATE1_FEEDBACK_CONSTANTS.CONFIDENCE_HIGH
    | typeof GATE1_FEEDBACK_CONSTANTS.CONFIDENCE_MEDIUM
    | typeof GATE1_FEEDBACK_CONSTANTS.CONFIDENCE_MAXIMUM;
  readonly highlights: readonly string[];
}

/**
 * Detailed information for REVISE recommendations.
 */
export interface Gate1RevisionDetails {
  readonly requiredRevisionsCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly lowCount: number;
  readonly priorityOrder: readonly string[];
  readonly workerDirectives: readonly string[];
  readonly retryTargetState: LooperState;
  readonly attemptsRemaining: number;
}

/**
 * Detailed information for REJECT recommendations.
 */
export interface Gate1RejectionDetails {
  readonly escalationReason: string;
  readonly severeViolationDetected: boolean;
  readonly attemptsExhausted: boolean;
  readonly escalationTargetState: LooperState;
  readonly architecturalRisks: readonly string[];
  readonly postMortemSummary: string;
}

/**
 * Core feedback payload before text/markup serialization.
 */
export interface Gate1FeedbackCore {
  readonly gate: typeof GATE1_FEEDBACK_CONSTANTS.GATE_ID;
  readonly verdict: Gate1Verdict;
  readonly recommendation: Gate1RecommendationType;
  readonly recommendedEvent: LooperEvent;
  readonly targetState: LooperState;
  readonly score: number;
  readonly summary: string;
  readonly reasons: readonly string[];
  readonly actionableRecommendations: readonly Gate1ActionableRecommendation[];
  readonly passDetails?: Gate1PassDetails;
  readonly revisionDetails?: Gate1RevisionDetails;
  readonly rejectionDetails?: Gate1RejectionDetails;
  readonly metadata: Gate1FeedbackMetadata;
}

/**
 * Comprehensive structured feedback object produced by Gate 1 feedback generator.
 */
export interface Gate1StructuredFeedback extends Gate1FeedbackCore {
  readonly xmlFeedback: string;
  readonly markdownFeedback: string;
  readonly jsonFeedback: string;
}

/**
 * Configuration options for generating structured feedback.
 */
export interface Gate1FeedbackOptions {
  readonly taskId?: string;
  readonly taskDescription?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly workerRole?: string;
  readonly targetFiles?: readonly string[];
  readonly maxFindings?: number;
  readonly includeLineCitations?: boolean;
  readonly severeViolation?: boolean;
  readonly durationMs?: number;
  readonly subagentId?: string;
}
