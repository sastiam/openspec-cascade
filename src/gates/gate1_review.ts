/**
 * Gate 1: Independent Semantic Code Reviewer Subagent Orchestrator.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.3 (LOOPER-GATE-002)
 * and OpenSpec change `looper-gate1-semantic-review` Task 1.1.
 *
 * Architecture & Design Invariants:
 * 1. Independent Read-Only Session:
 *    Spawns an ephemeral `Reviewer` (Tier 4) subagent session with zero code mutation permissions.
 *    Reviewer evaluates git diffs, task acceptance criteria, boundary containment, and clean code.
 * 2. 4-Point Audit Checklist:
 *    - Specification Fidelity: Does the change satisfy all acceptance criteria without omitting details?
 *    - Boundary Containment: Did the worker modify files outside authorized target scope?
 *    - Regression Risk: Does modification alter public API contracts or delete existing tests?
 *    - Code Quality: Zero magic numbers, strict typing (zero `any`), unhandled rejections, cross-platform safety.
 * 3. FSM Lifecycle Integration:
 *    Maps verdicts to FSM domain events:
 *    - APPROVED -> EVT_G1_PASS (advances to Gate 2 Challenger)
 *    - REVISE   -> EVT_G1_REVISE (feeds feedback to Worker if attempt < maxAttempts)
 *    - REJECT   -> EVT_G1_REJECT (escalates to diagnostic if attempts exhausted or severe violation)
 * 4. Zero Magic Numbers & Strict Typing:
 *    Centralizes all thresholds, limits, exit codes, and string literals in GATE1_CONSTANTS.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
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
  evaluateSemanticRubric,
  scanDiffForCleanCode,
  scanDiffForMagicNumbers,
} from "./gate1_rubric";
import {
  generateGate1Feedback,
  type Gate1FeedbackOptions,
  type Gate1StructuredFeedback,
} from "./gate1_feedback";

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

type Gate1CROSS_PLATFORM = typeof GATE1_CONSTANTS.CATEGORY_CROSS_PLATFORM;
const GATE1_CROSS_PLATFORM = GATE1_CONSTANTS.CATEGORY_CROSS_PLATFORM;

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

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base error class for Gate 1 review operations.
 */
export class Gate1ReviewError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "Gate1ReviewError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown when review execution times out.
 */
export class Gate1TimeoutError extends Gate1ReviewError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string) {
    super(
      message ?? `Gate 1 review timed out after ${timeoutMs}ms.`,
      "GATE1_TIMEOUT_EXCEEDED",
      { timeoutMs }
    );
    this.name = "Gate1TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when subagent dispatch or sandboxing fails.
 */
export class Gate1SubagentDispatchError extends Gate1ReviewError {
  constructor(message: string, details?: unknown) {
    super(message, "GATE1_SUBAGENT_DISPATCH_FAILED", details);
    this.name = "Gate1SubagentDispatchError";
  }
}

/**
 * Thrown when git diff extraction fails unrecoverably.
 */
export class Gate1DiffExtractionError extends Gate1ReviewError {
  constructor(message: string, details?: unknown) {
    super(message, "GATE1_DIFF_EXTRACTION_FAILED", details);
    this.name = "Gate1DiffExtractionError";
  }
}

// ============================================================================
// HELPER FUNCTIONS & PARSERS
// ============================================================================

/**
 * Parses distinct modified, added, or deleted file paths from unified git diff output.
 */
export function parseGitDiffFiles(diff: string): string[] {
  if (!diff || typeof diff !== "string") {
    return [];
  }

  const files = new Set<string>();
  const lines = diff.split("\n");

  for (const line of lines) {
    // Check standard git diff header: diff --git a/path b/path
    if (line.startsWith("diff --git ")) {
      const parts = line.split(" ");
      if (parts.length >= GATE1_CONSTANTS.GIT_HEADER_MIN_PARTS) {
        const bPath = parts[GATE1_CONSTANTS.THREE];
        if (bPath && bPath.startsWith("b/")) {
          files.add(normalize(bPath.slice(GATE1_CONSTANTS.GIT_PREFIX_SLICE_INDEX)));
        }
      }
      continue;
    }

    // Check +++ b/path
    if (line.startsWith("+++ b/")) {
      const path = line.slice(GATE1_CONSTANTS.DIFF_PLUS_PREFIX_LENGTH).trim();
      if (path && path !== "/dev/null") {
        files.add(normalize(path));
      }
      continue;
    }

    // Check --- a/path (for deleted files)
    if (line.startsWith("--- a/")) {
      const path = line.slice(GATE1_CONSTANTS.DIFF_MINUS_PREFIX_LENGTH).trim();
      if (path && path !== "/dev/null") {
        files.add(normalize(path));
      }
      continue;
    }
  }

  return Array.from(files);
}

/**
 * Computes additions, deletions, and affected file list statistics from unified git diff.
 */
export function parseGitDiffStats(diff: string): Gate1DiffStats {
  if (!diff || typeof diff !== "string") {
    return {
      filesChanged: GATE1_CONSTANTS.ZERO,
      insertions: GATE1_CONSTANTS.ZERO,
      deletions: GATE1_CONSTANTS.ZERO,
      fileList: [],
    };
  }

  const fileList = parseGitDiffFiles(diff);
  const lines = diff.split("\n");
  let insertions = GATE1_CONSTANTS.ZERO;
  let deletions = GATE1_CONSTANTS.ZERO;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      insertions += GATE1_CONSTANTS.ONE;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += GATE1_CONSTANTS.ONE;
    }
  }

  return {
    filesChanged: fileList.length,
    insertions,
    deletions,
    fileList,
  };
}

/**
 * Verifies boundary containment: ensures no files outside targetFiles were modified.
 */
export function verifyBoundaryContainment(
  modifiedFiles: readonly string[],
  targetFiles?: readonly string[],
  workspaceRoot?: string
): Gate1BoundaryCheckResult {
  const root = workspaceRoot ?? process.cwd();

  // If no target files whitelist is specified, boundary containment passes unrestricted
  if (!targetFiles || targetFiles.length === GATE1_CONSTANTS.ZERO) {
    return {
      passed: true,
      authorizedFiles: [],
      modifiedFiles: [...modifiedFiles],
      unauthorizedFiles: [],
      details: "Boundary containment passed (no target files restrictions declared).",
    };
  }

  // Normalize authorized paths
  const normalizedAuthorized = new Set(
    targetFiles.map((target) => {
      const clean = target.startsWith("./")
        ? target.slice(GATE1_CONSTANTS.RELATIVE_PREFIX_LENGTH)
        : target;
      return isAbsolute(clean) ? relative(root, clean) : normalize(clean);
    })
  );

  const unauthorized: string[] = [];

  for (const file of modifiedFiles) {
    const clean = file.startsWith("./")
      ? file.slice(GATE1_CONSTANTS.RELATIVE_PREFIX_LENGTH)
      : file;
    const normalizedFile = isAbsolute(clean) ? relative(root, clean) : normalize(clean);

    let isAuthorized = normalizedAuthorized.has(normalizedFile);

    // Support wildcard or directory prefix match (e.g. "src/**")
    if (!isAuthorized) {
      for (const auth of normalizedAuthorized) {
        if (auth.endsWith("/**")) {
          const prefix = auth.slice(GATE1_CONSTANTS.ZERO, GATE1_CONSTANTS.GLOB_DOUBLE_STAR_OFFSET);
          if (normalizedFile.startsWith(prefix)) {
            isAuthorized = true;
            break;
          }
        } else if (auth.endsWith("/*")) {
          const prefix = auth.slice(GATE1_CONSTANTS.ZERO, GATE1_CONSTANTS.GLOB_SINGLE_STAR_OFFSET);
          if (normalizedFile.startsWith(prefix) && !normalizedFile.slice(prefix.length + 1).includes("/")) {
            isAuthorized = true;
            break;
          }
        }
      }
    }

    if (!isAuthorized) {
      unauthorized.push(normalizedFile);
    }
  }

  const passed = unauthorized.length === GATE1_CONSTANTS.ZERO;
  const details = passed
    ? `Boundary containment verified. All ${modifiedFiles.length} modified file(s) within authorized target scope.`
    : `Boundary containment violated! ${unauthorized.length} unauthorized file(s) modified: ${unauthorized.join(", ")}.`;

  return {
    passed,
    authorizedFiles: Array.from(normalizedAuthorized),
    modifiedFiles: [...modifiedFiles],
    unauthorizedFiles: unauthorized,
    details,
  };
}

/**
 * Resolves the recommended FSM domain event based on Gate 1 verdict and retry state.
 */
export function resolveGate1RecommendedEvent(
  verdict: Gate1Verdict,
  attempt: number = GATE1_CONSTANTS.DEFAULT_ATTEMPT,
  maxAttempts: number = GATE1_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
  severeViolation: boolean = false
): LooperEvent {
  if (verdict === GATE1_CONSTANTS.VERDICT_APPROVED) {
    return LOOPER_EVENTS.EVT_G1_PASS;
  }

  if (verdict === GATE1_CONSTANTS.VERDICT_REVISE) {
    // If retry budget remains and no severe violation, recommend local Worker revision
    if (attempt < maxAttempts && !severeViolation) {
      return LOOPER_EVENTS.EVT_G1_REVISE;
    }
    // Attempts exhausted or severe violation: escalate to diagnostic
    return LOOPER_EVENTS.EVT_G1_REJECT;
  }

  // Explicit REJECT verdict
  return LOOPER_EVENTS.EVT_G1_REJECT;
}

/**
 * Scans unified diff hunks for semantic code quality defects:
 * - Hardcoded numeric literals (magic numbers)
 * - Potential unhandled promise rejections
 * - Explicit `any` type leaks
 * - Cross-platform path separation flaws
 */
export function scanDiffForSemanticIssues(diff: string): Gate1Finding[] {
  if (!diff || typeof diff !== "string") {
    return [];
  }
  return [
    ...scanDiffForCleanCode(diff),
    ...scanDiffForMagicNumbers(diff, true).findings,
  ];
}

/**
 * Formats a clean markdown review report for storage in the Reviewer sandbox.
 */
export function formatReviewReportMarkdown(
  report: Gate1ReviewReport,
  taskId?: string
): string {
  const sections: string[] = [];

  sections.push(`# Gate 1 Semantic Code Review Report`);
  if (taskId) {
    sections.push(`**Task Identifier**: \`${taskId}\``);
  }
  sections.push(`**Verdict**: \`${report.verdict}\``);
  sections.push(`**Quality Score**: \`${report.score}/100\``);
  sections.push(`**Summary**: ${report.summary}`);
  sections.push("");

  // Diff Stats
  sections.push(`## Diff Metrics`);
  sections.push(`- Files Changed: ${report.diffStats.filesChanged}`);
  sections.push(`- Additions: +${report.diffStats.insertions}`);
  sections.push(`- Deletions: -${report.diffStats.deletions}`);
  if (report.diffStats.fileList.length > 0) {
    sections.push(`- Modified Files:\n  ${report.diffStats.fileList.map((f) => `\`${f}\``).join(", ")}`);
  }
  sections.push("");

  // Boundary Containment
  sections.push(`## Boundary Containment`);
  sections.push(`- Status: ${report.boundaryCheck.passed ? "PASSED" : "VIOLATED"}`);
  sections.push(`- Details: ${report.boundaryCheck.details}`);
  if (report.boundaryCheck.unauthorizedFiles.length > 0) {
    sections.push(`- Unauthorized Files: ${report.boundaryCheck.unauthorizedFiles.map((f) => `\`${f}\``).join(", ")}`);
  }
  sections.push("");

  // Checklist
  sections.push(`## Audit Checklist`);
  for (const [key, passed] of Object.entries(report.checklistResults)) {
    sections.push(`- [${passed ? "x" : " "}] **${key}**`);
  }
  sections.push("");

  // Findings
  sections.push(`## Findings & Line Citations (${report.findings.length})`);
  if (report.findings.length === 0) {
    sections.push("Zero defects detected. Code strictly conforms to acceptance criteria and architectural standards.");
  } else {
    for (const finding of report.findings) {
      sections.push(`### [${finding.severity.toUpperCase()}] ${finding.category}`);
      if (finding.filePath) {
        sections.push(`- **Location**: \`${finding.filePath}${finding.lineNumber ? `:${finding.lineNumber}` : ""}\``);
      }
      if (finding.lineCitation) {
        sections.push(`- **Citation**:\n  \`\`\`typescript\n  ${finding.lineCitation.trim()}\n  \`\`\``);
      }
      sections.push(`- **Issue**: ${finding.message}`);
      if (finding.remediation) {
        sections.push(`- **Remediation**: ${finding.remediation}`);
      }
      sections.push("");
    }
  }

  // Recommendations
  if (report.remediationAdvice.length > 0) {
    sections.push(`## Remediation Recommendations`);
    for (const advice of report.remediationAdvice) {
      sections.push(`- ${advice}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Formats structured prompt for the Reviewer LLM session.
 */
export function formatReviewerPrompt(context: Gate1ExecutionContext): string {
  const sections: string[] = [];

  sections.push(`You are conducting an independent Gate 1 Semantic Code Review for task: ${context.taskId ?? "unspecified"}.`);
  sections.push("");

  if (context.taskDescription) {
    sections.push(`## Task Goal\n${context.taskDescription}\n`);
  }

  if (context.acceptanceCriteria && context.acceptanceCriteria.length > 0) {
    sections.push("## Task Acceptance Criteria");
    for (const ac of context.acceptanceCriteria) {
      sections.push(`- [ ] ${ac}`);
    }
    sections.push("");
  }

  if (context.targetFiles && context.targetFiles.length > 0) {
    sections.push(`## Authorized Target Scope\n${context.targetFiles.map((f) => `- \`${f}\``).join("\n")}\n`);
  }

  sections.push(`## Unified Git Diff under Review`);
  if (!context.gitDiff || context.gitDiff.trim().length === 0) {
    sections.push("*(Empty diff - no file modifications detected)*\n");
  } else {
    // Truncate diff if exceeding maximum lines or bytes
    const diffLines = context.gitDiff.split("\n");
    if (diffLines.length > GATE1_CONSTANTS.DEFAULT_MAX_DIFF_LINES) {
      const truncated = diffLines.slice(GATE1_CONSTANTS.ZERO, GATE1_CONSTANTS.DEFAULT_MAX_DIFF_LINES).join("\n");
      sections.push(`\`\`\`diff\n${truncated}\n\`\`\`\n*(Diff truncated to ${GATE1_CONSTANTS.DEFAULT_MAX_DIFF_LINES} lines)*\n`);
    } else {
      sections.push(`\`\`\`diff\n${context.gitDiff}\n\`\`\`\n`);
    }
  }

  sections.push(`## Review Checklist & Output Instructions
Audit the diff against the 4 core dimensions:
1. Specification Fidelity: Does the implementation fulfill all declared acceptance criteria?
2. Boundary Containment: Are all changes confined strictly to authorized files?
3. Regression Risk: Are tests preserved and APIs backward-compatible?
4. Code Quality: Strict typing (zero \`any\`), zero magic numbers, unhandled rejection safety, cross-platform paths.

Respond with a JSON object inside a \`\`\`json block adhering to this structure:
{
  "verdict": "APPROVED" | "REVISE" | "REJECTED",
  "score": number, // 0 to 100
  "summary": "High-level review summary",
  "checklistResults": {
    "specification_fidelity": boolean,
    "boundary_containment": boolean,
    "regression_risk": boolean,
    "code_quality": boolean
  },
  "findings": [
    {
      "category": "specification_fidelity" | "boundary_containment" | "zero_magic_numbers" | "strict_typing" | "unhandled_rejections",
      "severity": "fatal" | "error" | "warning" | "info",
      "filePath": "src/path/to/file.ts",
      "lineNumber": 42,
      "lineCitation": "const timeout = 5000;",
      "message": "Specific explanation of defect",
      "remediation": "Actionable instructions to resolve"
    }
  ],
  "remediationAdvice": ["Advice 1", "Advice 2"]
}`);

  return sections.join("\n");
}

/**
 * Default git diff runner executing subprocess via Bun.spawn.
 */
export async function defaultGitDiffRunner(
  commandArgs: readonly string[],
  cwd: string,
  timeoutMs: number = GATE1_CONSTANTS.DEFAULT_GIT_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const isWindows = process.platform === "win32";
  const shellArgs = isWindows ? ["cmd.exe", "/c", ...commandArgs] : [...commandArgs];

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
        stderr: `Git command timed out after ${timeoutMs}ms.`,
        exitCode: GATE1_CONSTANTS.EXIT_CODE_ERROR,
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
      exitCode: GATE1_CONSTANTS.EXIT_CODE_ERROR,
    };
  }
}

// ============================================================================
// GATE 1 REVIEWER SUBAGENT ORCHESTRATOR CLASS
// ============================================================================

/**
 * Gate 1 Reviewer: Independent Semantic Code Review Subagent Orchestrator.
 *
 * Coordinates the execution of Gate 1 independent review sessions, scaffolding ephemeral
 * Reviewer sandboxes, managing git diff extraction, enforcing boundary containment,
 * auditing clean code directives, and translating outcomes into FSM domain events.
 */
export class Gate1Reviewer extends EventEmitter {
  private readonly options: Gate1ReviewerOptions;
  private readonly workspaceRoot: string;
  private readonly repoRoot: string;
  private readonly taskId?: string;
  private readonly attempt: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly gitRunner: (
    commandArgs: readonly string[],
    cwd: string,
    timeoutMs?: number
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

  public constructor(options: Gate1ReviewerOptions = {}) {
    super();
    this.options = { ...options };
    this.workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
    this.repoRoot = normalize(options.repoRoot ?? this.workspaceRoot);
    this.taskId = options.taskId;
    this.attempt = options.attempt ?? GATE1_CONSTANTS.DEFAULT_ATTEMPT;
    this.maxAttempts = options.maxAttempts ?? GATE1_CONSTANTS.DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? GATE1_CONSTANTS.DEFAULT_TIMEOUT_MS;
    this.gitRunner = options.gitRunner ?? defaultGitDiffRunner;
  }

  /**
   * Returns a copy of the reviewer options.
   */
  public getOptions(): Readonly<Gate1ReviewerOptions> {
    return { ...this.options };
  }

  /**
   * Extracts git diff between working tree and baseline commit or HEAD.
   */
  public async extractGitDiff(): Promise<string> {
    if (this.options.diff !== undefined) {
      return this.options.diff;
    }

    const args = this.options.baselineSha
      ? ["git", "diff", this.options.baselineSha]
      : ["git", "diff", "HEAD"];

    const result = await this.gitRunner(args, this.repoRoot, GATE1_CONSTANTS.DEFAULT_GIT_TIMEOUT_MS);

    // If git diff HEAD failed (e.g. empty git repo or initial commit), try bare git diff
    if (result.exitCode !== GATE1_CONSTANTS.EXIT_CODE_SUCCESS && !this.options.baselineSha) {
      const fallback = await this.gitRunner(["git", "diff"], this.repoRoot, GATE1_CONSTANTS.DEFAULT_GIT_TIMEOUT_MS);
      if (fallback.exitCode === GATE1_CONSTANTS.EXIT_CODE_SUCCESS) {
        return fallback.stdout;
      }
    }

    return result.stdout;
  }

  /**
   * Verifies boundary containment against authorized target files.
   */
  public verifyBoundaries(modifiedFiles: readonly string[]): Gate1BoundaryCheckResult {
    return verifyBoundaryContainment(
      modifiedFiles,
      this.options.targetFiles,
      this.workspaceRoot
    );
  }

  /**
   * Formats prompt for subagent or LLM session.
   */
  public formatPrompt(context: Gate1ExecutionContext): string {
    return formatReviewerPrompt(context);
  }

  /**
   * Evaluates diff against comprehensive semantic evaluation rubric checking
   * Clean Code, Zero Magic Numbers, and DoD adherence.
   */
  public evaluateDiff(
    diff: string,
    boundaryCheck: Gate1BoundaryCheckResult,
    options?: {
      acceptanceCriteria?: readonly string[];
      definitionOfDone?: readonly string[];
      taskId?: string;
    }
  ): Gate1ReviewReport {
    const diffStats = parseGitDiffStats(diff);
    const rubricResult = evaluateSemanticRubric({
      diff,
      diffStats,
      boundaryCheck,
      acceptanceCriteria: options?.acceptanceCriteria ?? this.options.acceptanceCriteria,
      definitionOfDone: options?.definitionOfDone ?? this.options.definitionOfDone,
      taskId: options?.taskId ?? this.taskId,
    });

    return {
      verdict: rubricResult.verdict,
      score: rubricResult.overallScore,
      summary: rubricResult.summary,
      checklistResults: rubricResult.checklistResults,
      rubricChecks: rubricResult.allRubricItems,
      findings: rubricResult.allFindings,
      boundaryCheck,
      diffStats,
      remediationAdvice: rubricResult.remediationAdvice,
    };
  }

  /**
   * Generates structured feedback returning pass/revision recommendations.
   */
  public generateFeedback(
    reportOrResult?: Gate1ReviewReport | Gate1ReviewResult,
    options?: Gate1FeedbackOptions
  ): Gate1StructuredFeedback {
    if (reportOrResult) {
      return generateGate1Feedback(reportOrResult, {
        taskId: this.taskId,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        targetFiles: this.options.targetFiles,
        ...options,
      });
    }

    const diff = this.options.diff ?? "";
    const diffStats = parseGitDiffStats(diff);
    const boundaryCheck = this.verifyBoundaries(diffStats.fileList);
    const report = this.evaluateDiff(diff, boundaryCheck);

    return generateGate1Feedback(report, {
      taskId: this.taskId,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
      targetFiles: this.options.targetFiles,
      ...options,
    });
  }

  /**
   * Executes review turn using PAL provider interface.
   */
  private async executePalTurn(
    provider: IPalProvider,
    prompt: string
  ): Promise<Gate1ReviewReport | undefined> {
    const roleDef = getRoleDefinition(COGNITIVE_ROLES.REVIEWER);
    const systemPrompt = generateRoleSystemPrompt(COGNITIVE_ROLES.REVIEWER);

    const message = createPalMessage({
      role: PAL_ROLES.USER,
      content: [createTextBlock(prompt)],
    });

    const outcome = await provider.executeTurn({
      sessionId: `gate1-review-${this.taskId ?? "review"}-${randomUUID()}`,
      messages: [message],
      systemPrompt,
      temperature: 0.1,
    });

    // Extract text blocks
    const textBlocks = outcome.message.content
      .filter(isPalTextContent)
      .map((b) => b.text)
      .join("\n");

    return this.parseLlmResponse(textBlocks);
  }

  /**
   * Parses LLM response into structured Gate1ReviewReport.
   */
  private parseLlmResponse(responseText: string): Gate1ReviewReport | undefined {
    if (!responseText || typeof responseText !== "string") {
      return undefined;
    }

    try {
      // Look for ```json ... ``` code fence
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = (jsonMatch ? jsonMatch[GATE1_CONSTANTS.REGEX_CAPTURE_GROUP_ONE] : responseText) ?? "";

      const parsed = JSON.parse(jsonStr.trim()) as Partial<Gate1ReviewReport>;

      if (parsed && typeof parsed.verdict === "string") {
        const rawVerdict = parsed.verdict.toUpperCase();
        const verdict: Gate1Verdict =
          rawVerdict === GATE1_CONSTANTS.VERDICT_APPROVED
            ? GATE1_CONSTANTS.VERDICT_APPROVED
            : rawVerdict === GATE1_CONSTANTS.VERDICT_REVISE
              ? GATE1_CONSTANTS.VERDICT_REVISE
              : GATE1_CONSTANTS.VERDICT_REJECTED;

        return {
          verdict,
          score:
            typeof parsed.score === "number"
              ? parsed.score
              : GATE1_CONSTANTS.SCORE_THRESHOLD_PASS,
          summary: parsed.summary ?? "Semantic review response parsed.",
          checklistResults: parsed.checklistResults ?? {
            specification_fidelity: true,
            boundary_containment: true,
            regression_risk: true,
            code_quality: true,
          },
          rubricChecks: parsed.rubricChecks ?? [],
          findings: parsed.findings ?? [],
          boundaryCheck: parsed.boundaryCheck ?? {
            passed: true,
            authorizedFiles: [],
            modifiedFiles: [],
            unauthorizedFiles: [],
            details: "Boundary check default.",
          },
          diffStats: parsed.diffStats ?? {
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
            fileList: [],
          },
          remediationAdvice: parsed.remediationAdvice ?? [],
          rawResponse: responseText,
        };
      }
    } catch {
      // Fallback: search for explicit keywords
      if (responseText.includes("VERDICT: APPROVED") || responseText.includes('"verdict": "APPROVED"')) {
        return {
          verdict: GATE1_CONSTANTS.VERDICT_APPROVED,
          score: 100,
          summary: "Approved by LLM semantic audit.",
          checklistResults: {
            specification_fidelity: true,
            boundary_containment: true,
            regression_risk: true,
            code_quality: true,
          },
          rubricChecks: [],
          findings: [],
          boundaryCheck: {
            passed: true,
            authorizedFiles: [],
            modifiedFiles: [],
            unauthorizedFiles: [],
            details: "Parsed from text.",
          },
          diffStats: {
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
            fileList: [],
          },
          remediationAdvice: [],
          rawResponse: responseText,
        };
      }
    }

    return undefined;
  }

  /**
   * Executes the full Gate 1 Semantic Review orchestration cycle.
   */
  public async run(): Promise<Gate1ReviewResult> {
    const startTime = performance.now();
    this.emit(GATE1_CONSTANTS.EVENT_REVIEW_START, {
      taskId: this.taskId,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
    });

    let subagent: SubagentInstance | undefined;
    let dispatcher = this.options.dispatcher;

    try {
      // 1. Extract git diff
      const gitDiff = await this.extractGitDiff();
      const diffStats = parseGitDiffStats(gitDiff);
      this.emit(GATE1_CONSTANTS.EVENT_DIFF_EXTRACTED, { diffStats });

      // 2. Perform boundary containment check
      const boundaryCheck = this.verifyBoundaries(diffStats.fileList);

      // 3. Dispatch ephemeral Reviewer subagent if dispatcher configured
      if (!dispatcher && this.options.autoCleanup !== false) {
        // Instantiate lightweight dispatcher if none supplied
        dispatcher = createSubagentDispatcher({
          workspaceRoot: this.workspaceRoot,
          autoCleanup: false,
        });
      }

      if (dispatcher) {
        try {
          subagent = await dispatcher.dispatch({
            role: COGNITIVE_ROLES.REVIEWER,
            taskId: this.taskId,
            taskDescription:
              this.options.taskDescription ?? "Perform independent semantic code review on git diff",
            targetFiles: this.options.targetFiles,
            customConstraints: [
              "Independent read-only session: zero code modifications permitted.",
              "Perform 4-point audit: spec fidelity, boundary containment, regression risk, and clean code.",
              "Enforce Zero Magic Numbers, Strict Typing, and Unhandled Rejection safety.",
            ],
          });
          this.emit(GATE1_CONSTANTS.EVENT_SUBAGENT_DISPATCHED, {
            subagentId: subagent.id,
            sandboxDir: subagent.sandbox.sandboxDir,
          });
        } catch (dispatchErr) {
          this.options.logger?.("warn", `Could not dispatch subagent sandbox: ${dispatchErr}`);
        }
      }

      // 4. Formulate Execution Context
      const context: Gate1ExecutionContext = {
        taskId: this.taskId,
        taskDescription: this.options.taskDescription,
        acceptanceCriteria: this.options.acceptanceCriteria ?? [],
        targetFiles: this.options.targetFiles ?? [],
        gitDiff,
        diffStats,
        boundaryCheck,
        subagentInstance: subagent,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        options: this.options,
      };

      // 5. Run review execution engine
      let report: Gate1ReviewReport;

      if (this.options.reviewExecutor) {
        report = await this.options.reviewExecutor(context);
      } else if (this.options.provider && typeof this.options.provider !== "string") {
        const prompt = this.formatPrompt(context);
        const palReport = await this.executePalTurn(this.options.provider, prompt);
        report =
          palReport ??
          this.evaluateDiff(gitDiff, boundaryCheck, {
            acceptanceCriteria: this.options.acceptanceCriteria,
            definitionOfDone: this.options.definitionOfDone,
            taskId: this.taskId,
          });
      } else {
        // Default local semantic evaluation
        report = this.evaluateDiff(gitDiff, boundaryCheck, {
          acceptanceCriteria: this.options.acceptanceCriteria,
          definitionOfDone: this.options.definitionOfDone,
          taskId: this.taskId,
        });
      }

      // Ensure boundary containment violations are strictly merged
      if (!boundaryCheck.passed && report.boundaryCheck.passed) {
        report = {
          ...report,
          verdict: GATE1_CONSTANTS.VERDICT_REJECTED,
          boundaryCheck,
        };
      }

      // 6. Determine FSM Recommended Event & Severe Violation Flag
      const severeViolation =
        !boundaryCheck.passed ||
        report.findings.some((f) => f.severity === GATE1_CONSTANTS.SEVERITY_FATAL);

      const recommendedEvent = resolveGate1RecommendedEvent(
        report.verdict,
        this.attempt,
        this.maxAttempts,
        severeViolation
      );

      this.emit(GATE1_CONSTANTS.EVENT_VERDICT_RESOLVED, {
        verdict: report.verdict,
        recommendedEvent,
        score: report.score,
      });

      const durationMs = Math.round(performance.now() - startTime);

      // Generate structured feedback returning pass/revision recommendations
      const feedback = generateGate1Feedback(report, {
        taskId: this.taskId,
        taskDescription: this.options.taskDescription,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        targetFiles: this.options.targetFiles,
        severeViolation,
        durationMs,
        subagentId: subagent?.id,
      });

      // 7. Write reports to subagent sandbox if available
      if (subagent) {
        try {
          const reportMarkdown = formatReviewReportMarkdown(report, this.taskId);
          const reportPath = join(subagent.sandbox.sandboxDir, GATE1_CONSTANTS.REPORT_FILENAME);
          const findingsPath = join(subagent.sandbox.sandboxDir, GATE1_CONSTANTS.FINDINGS_JSON_FILENAME);
          const feedbackPath = join(subagent.sandbox.sandboxDir, GATE1_CONSTANTS.FEEDBACK_XML_FILENAME);

          await mkdir(subagent.sandbox.sandboxDir, { recursive: true });
          await writeFile(reportPath, reportMarkdown, "utf8");
          await writeFile(
            findingsPath,
            JSON.stringify(report, null, GATE1_CONSTANTS.JSON_INDENT_SPACES),
            "utf8"
          );
          await writeFile(feedbackPath, feedback.xmlFeedback, "utf8");

          await dispatcher?.completeAgent(subagent.id, {
            handoffContent: reportMarkdown,
          });

          if (this.options.autoCleanup) {
            await dispatcher?.cleanupAgent(subagent.id);
          }
        } catch (writeErr) {
          this.options.logger?.("warn", `Failed to write review reports to sandbox: ${writeErr}`);
        }
      }

      const result: Gate1ReviewResult = {
        success: report.verdict === GATE1_CONSTANTS.VERDICT_APPROVED,
        verdict: report.verdict,
        recommendedEvent,
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        report,
        severeViolation,
        feedback,
        subagentId: subagent?.id,
        sandboxDir: subagent?.sandbox.sandboxDir,
        durationMs,
        timestamp: new Date().toISOString(),
      };

      this.emit(GATE1_CONSTANTS.EVENT_REVIEW_COMPLETE, result);
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

      this.emit(GATE1_CONSTANTS.EVENT_REVIEW_ERROR, error);
      throw error;
    }
  }
}

/**
 * Factory helper function to instantiate a Gate1Reviewer.
 */
export function createGate1Reviewer(
  options?: Gate1ReviewerOptions
): Gate1Reviewer {
  return new Gate1Reviewer(options);
}

/**
 * Executes a single Gate 1 Semantic Code Review cycle.
 */
export async function runGate1Review(
  options?: Gate1ReviewerOptions
): Promise<Gate1ReviewResult> {
  const reviewer = new Gate1Reviewer(options);
  return reviewer.run();
}

export * from "./gate1_rubric";
export * from "./gate1_feedback";
