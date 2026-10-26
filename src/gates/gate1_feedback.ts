/**
 * Gate 1: Structured Feedback Generator Returning Pass/Revision Recommendations.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.3 (LOOPER-GATE-002)
 * and OpenSpec change `looper-gate1-semantic-review` Task 1.3.
 *
 * Core Capabilities:
 * 1. Pass/Revision/Rejection Recommendation Engine:
 *    - APPROVED -> PASS recommendation: confirms Clean Code, Zero Magic Numbers, and DoD criteria.
 *      Recommends transition to Gate 2 Adversarial Challenger via EVT_G1_PASS.
 *    - REVISE   -> REVISE recommendation: when defects detected (magic numbers, typing leaks, async flaws)
 *      and attempts remain. Emits actionable file-and-line remediation directives and re-injects
 *      structured feedback prompt to Worker via EVT_G1_REVISE.
 *    - REJECT   -> REJECT recommendation: when attempts are exhausted or severe boundary/architectural
 *      violations are detected. Recommends escalation to diagnostic via EVT_G1_REJECT.
 * 2. Multi-Format Structured Feedback:
 *    - Structured TypeScript Object: Gate1StructuredFeedback
 *    - Machine-Readable XML: <verification-feedback gate="gate1" ...>
 *    - Human-Readable / Sandbox Markdown: formatGate1MarkdownFeedback
 *    - Machine-Readable JSON: formatGate1JsonFeedback
 *    - Worker Re-injection Prompt: formatGate1WorkerPrompt
 * 3. Priority Classification & Line Citations:
 *    Classifies findings into CRITICAL, HIGH, MEDIUM, LOW priorities with exact file citations.
 * 4. Zero Magic Numbers & Strict Typing:
 *    Centralizes all thresholds, limits, and literals in GATE1_FEEDBACK_CONSTANTS.
 */

import { randomUUID } from "node:crypto";
import { normalize } from "node:path";
import {
  LOOPER_EVENTS,
  LOOPER_STATES,
  type LooperEvent,
  type LooperState,
} from "../core/fsm_types";
import type {
  Gate1BoundaryCheckResult,
  Gate1CheckCategory,
  Gate1DiffStats,
  Gate1Finding,
  Gate1FindingSeverity,
  Gate1ReviewReport,
  Gate1ReviewResult,
  Gate1Verdict,
} from "./gate1_review";
import { GATE1_RUBRIC_CONSTANTS } from "./gate1_rubric";

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

// ============================================================================
// XML ESCAPING & UTILITY FUNCTIONS
// ============================================================================

/**
 * Escapes XML entity characters in tag content.
 */
export function escapeXml(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escapes XML entity and quote characters in attribute values.
 */
export function escapeXmlAttr(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }
  return escapeXml(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Classifies the priority of a review finding based on its severity and category.
 */
export function classifyFindingPriority(
  severity: Gate1FindingSeverity,
  category?: Gate1CheckCategory
): Gate1RecommendationPriority {
  if (severity === GATE1_FEEDBACK_CONSTANTS.SEVERITY_FATAL) {
    return GATE1_FEEDBACK_CONSTANTS.PRIORITY_CRITICAL;
  }

  if (severity === GATE1_FEEDBACK_CONSTANTS.SEVERITY_ERROR) {
    if (
      category === GATE1_FEEDBACK_CONSTANTS.CATEGORY_BOUNDARY_CONTAINMENT ||
      category === GATE1_FEEDBACK_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS ||
      category === GATE1_FEEDBACK_CONSTANTS.CATEGORY_STRICT_TYPING
    ) {
      return GATE1_FEEDBACK_CONSTANTS.PRIORITY_HIGH;
    }
    return GATE1_FEEDBACK_CONSTANTS.PRIORITY_HIGH;
  }

  if (severity === GATE1_FEEDBACK_CONSTANTS.SEVERITY_WARNING) {
    if (category === GATE1_FEEDBACK_CONSTANTS.CATEGORY_CROSS_PLATFORM) {
      return GATE1_FEEDBACK_CONSTANTS.PRIORITY_MEDIUM;
    }
    return GATE1_FEEDBACK_CONSTANTS.PRIORITY_MEDIUM;
  }

  return GATE1_FEEDBACK_CONSTANTS.PRIORITY_LOW;
}

/**
 * Generates an appropriate descriptive title for a finding.
 */
function generateFindingTitle(finding: Gate1Finding): string {
  switch (finding.category) {
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS:
      return "Zero Magic Numbers Directive Violation";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_STRICT_TYPING:
      return "Strict Typing Directive Violation (Explicit 'any')";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS:
      return "Potential Unhandled Promise Rejection Flaw";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_BOUNDARY_CONTAINMENT:
      return "Boundary Scope Containment Violation";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_DOD_ADHERENCE:
      return "Definition of Done (DoD) Adherence Violation";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_SPEC_FIDELITY:
      return "Specification Fidelity / Acceptance Criteria Gap";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_CROSS_PLATFORM:
      return "Cross-Platform Path Concatenation Flaw";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_REGRESSION_RISK:
      return "Regression Risk in Public API or Test Suite";
    case GATE1_FEEDBACK_CONSTANTS.CATEGORY_CODE_QUALITY:
    default:
      return "Clean Code & Quality Invariant Defect";
  }
}

/**
 * Transforms raw Gate 1 findings into prioritized, actionable recommendations.
 */
export function transformFindingsToActionableRecommendations(
  findings: readonly Gate1Finding[],
  maxFindings: number = GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_FINDINGS
): Gate1ActionableRecommendation[] {
  if (!findings || findings.length === GATE1_FEEDBACK_CONSTANTS.ZERO) {
    return [];
  }

  const recommendations: Gate1ActionableRecommendation[] = [];
  const priorityWeights: Record<Gate1RecommendationPriority, number> = {
    [GATE1_FEEDBACK_CONSTANTS.PRIORITY_CRITICAL]: GATE1_FEEDBACK_CONSTANTS.FOUR,
    [GATE1_FEEDBACK_CONSTANTS.PRIORITY_HIGH]: GATE1_FEEDBACK_CONSTANTS.THREE,
    [GATE1_FEEDBACK_CONSTANTS.PRIORITY_MEDIUM]: GATE1_FEEDBACK_CONSTANTS.TWO,
    [GATE1_FEEDBACK_CONSTANTS.PRIORITY_LOW]: GATE1_FEEDBACK_CONSTANTS.ONE,
  };

  const limitedFindings = findings.slice(
    GATE1_FEEDBACK_CONSTANTS.ZERO,
    Math.max(GATE1_FEEDBACK_CONSTANTS.ONE, maxFindings)
  );

  for (const finding of limitedFindings) {
    const priority = classifyFindingPriority(finding.severity, finding.category);
    const title = generateFindingTitle(finding);
    const action =
      finding.remediation ??
      `Resolve ${finding.category} issue in ${finding.filePath ?? "modified code"}.`;

    recommendations.push({
      id: finding.id || randomUUID(),
      category: finding.category,
      severity: finding.severity,
      priority,
      title,
      description: finding.message,
      action,
      location: finding.filePath
        ? {
            filePath: normalize(finding.filePath),
            lineNumber: finding.lineNumber,
            lineCitation: finding.lineCitation?.trim(),
          }
        : undefined,
    });
  }

  // Sort by priority descending (CRITICAL -> HIGH -> MEDIUM -> LOW)
  recommendations.sort(
    (a, b) => priorityWeights[b.priority] - priorityWeights[a.priority]
  );

  return recommendations;
}

// ============================================================================
// DETAILS GENERATORS FOR PASS, REVISE, REJECT
// ============================================================================

/**
 * Builds details for a PASS recommendation.
 */
export function generatePassDetails(
  report: Gate1ReviewReport,
  options?: Gate1FeedbackOptions
): Gate1PassDetails {
  const score = report.score;
  const confidence =
    score >= GATE1_FEEDBACK_CONSTANTS.SCORE_MAX
      ? GATE1_FEEDBACK_CONSTANTS.CONFIDENCE_MAXIMUM
      : score >= GATE1_FEEDBACK_CONSTANTS.SCORE_THRESHOLD_PASS
        ? GATE1_FEEDBACK_CONSTANTS.CONFIDENCE_HIGH
        : GATE1_FEEDBACK_CONSTANTS.CONFIDENCE_MEDIUM;

  const highlights: string[] = [
    "Clean Code quality invariants satisfied with zero fatal defects.",
    "Zero Magic Numbers directive verified; all numeric literals centralized.",
    "Boundary scope containment strictly observed.",
  ];

  if (report.diffStats && report.diffStats.filesChanged > GATE1_FEEDBACK_CONSTANTS.ZERO) {
    highlights.push(
      `Diff inspected: ${report.diffStats.filesChanged} file(s) changed (+${report.diffStats.insertions} / -${report.diffStats.deletions}).`
    );
  }

  return {
    qualityScore: score,
    readinessSummary: `Task ${options?.taskId ?? "under review"} passed independent semantic code review (Score: ${score}/100). Approved to advance to Gate 2 Adversarial Challenge.`,
    nextGate: GATE1_FEEDBACK_CONSTANTS.NEXT_GATE_CHALLENGER,
    targetFsmState: GATE1_FEEDBACK_CONSTANTS.STATE_GATE_2_CHALLENGE,
    verificationConfidence: confidence,
    highlights,
  };
}

/**
 * Builds details for a REVISE recommendation.
 */
export function generateRevisionDetails(
  report: Gate1ReviewReport,
  actionableRecs: readonly Gate1ActionableRecommendation[],
  options?: Gate1FeedbackOptions
): Gate1RevisionDetails {
  const attempt = options?.attempt ?? GATE1_FEEDBACK_CONSTANTS.DEFAULT_ATTEMPT;
  const maxAttempts =
    options?.maxAttempts ?? GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_ATTEMPTS;
  const attemptsRemaining = Math.max(
    GATE1_FEEDBACK_CONSTANTS.ZERO,
    maxAttempts - attempt
  );

  const criticalCount = actionableRecs.filter(
    (r) => r.priority === GATE1_FEEDBACK_CONSTANTS.PRIORITY_CRITICAL
  ).length;
  const highCount = actionableRecs.filter(
    (r) => r.priority === GATE1_FEEDBACK_CONSTANTS.PRIORITY_HIGH
  ).length;
  const mediumCount = actionableRecs.filter(
    (r) => r.priority === GATE1_FEEDBACK_CONSTANTS.PRIORITY_MEDIUM
  ).length;
  const lowCount = actionableRecs.filter(
    (r) => r.priority === GATE1_FEEDBACK_CONSTANTS.PRIORITY_LOW
  ).length;

  const priorityOrder = actionableRecs.map(
    (r) => `[${r.priority}] ${r.title}${r.location ? ` in ${r.location.filePath}` : ""}`
  );

  const workerDirectives: string[] = [
    `Address ${actionableRecs.length} review item(s) in order of priority (CRITICAL/HIGH first).`,
    "Strictly follow zero magic numbers: extract all literal numbers to constants modules.",
    "Run local verification (bun test, bunx tsc --noEmit) before completing revision turn.",
  ];

  return {
    requiredRevisionsCount: actionableRecs.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    priorityOrder,
    workerDirectives,
    retryTargetState: GATE1_FEEDBACK_CONSTANTS.STATE_EXECUTE_WORKER,
    attemptsRemaining,
  };
}

/**
 * Builds details for a REJECT recommendation.
 */
export function generateRejectionDetails(
  report: Gate1ReviewReport,
  options?: Gate1FeedbackOptions
): Gate1RejectionDetails {
  const attempt = options?.attempt ?? GATE1_FEEDBACK_CONSTANTS.DEFAULT_ATTEMPT;
  const maxAttempts =
    options?.maxAttempts ?? GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_ATTEMPTS;
  const attemptsExhausted = attempt >= maxAttempts;
  const severeViolationDetected =
    Boolean(options?.severeViolation) ||
    !report.boundaryCheck.passed ||
    report.findings.some(
      (f) => f.severity === GATE1_FEEDBACK_CONSTANTS.SEVERITY_FATAL
    );

  let escalationReason: string;
  if (severeViolationDetected && !report.boundaryCheck.passed) {
    escalationReason = `Severe boundary containment violation: modified unauthorized files (${report.boundaryCheck.unauthorizedFiles.join(", ")}).`;
  } else if (attemptsExhausted) {
    escalationReason = `Review retry attempts exhausted (${attempt}/${maxAttempts}). Unable to reach passing threshold (${report.score}/${GATE1_FEEDBACK_CONSTANTS.SCORE_THRESHOLD_PASS}).`;
  } else {
    escalationReason = `Critical architectural defect or high-severity violation detected (Score: ${report.score}/100).`;
  }

  const architecturalRisks: string[] = [];
  if (!report.boundaryCheck.passed) {
    architecturalRisks.push("Unauthorized file modification outside task target scope.");
  }
  for (const f of report.findings) {
    if (f.severity === GATE1_FEEDBACK_CONSTANTS.SEVERITY_FATAL) {
      architecturalRisks.push(`[FATAL] ${f.category}: ${f.message}`);
    }
  }

  const postMortemSummary = `Task ${options?.taskId ?? "under review"} rejected by Gate 1 Semantic Review. Escalating to ${GATE1_FEEDBACK_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC} for human intervention or root-cause diagnosis.`;

  return {
    escalationReason,
    severeViolationDetected,
    attemptsExhausted,
    escalationTargetState: GATE1_FEEDBACK_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC,
    architecturalRisks,
    postMortemSummary,
  };
}

// ============================================================================
// FORMATTERS: XML, MARKDOWN, JSON, WORKER PROMPT
// ============================================================================

/**
 * Formats structured feedback into machine-readable XML block for Looper harness.
 */
export function formatGate1XmlFeedback(feedback: Gate1FeedbackCore): string {
  const parts: string[] = [];

  parts.push(
    `<verification-feedback gate="${feedback.gate}" verdict="${escapeXmlAttr(feedback.verdict)}" recommendation="${escapeXmlAttr(feedback.recommendation)}" score="${feedback.score}">`
  );

  parts.push(`  <summary>${escapeXml(feedback.summary)}</summary>`);
  parts.push(`  <recommended-event>${escapeXml(feedback.recommendedEvent)}</recommended-event>`);
  parts.push(`  <target-state>${escapeXml(feedback.targetState)}</target-state>`);

  // Metadata attributes
  const meta = feedback.metadata;
  parts.push(
    `  <metadata attempt="${meta.attempt}" max-attempts="${meta.maxAttempts}" remaining-attempts="${meta.remainingAttempts}" can-retry="${meta.canRetry}" severe-violation="${meta.severeViolation}" timestamp="${escapeXmlAttr(meta.timestamp)}"/>`
  );

  // Reasons list
  if (feedback.reasons.length > GATE1_FEEDBACK_CONSTANTS.ZERO) {
    parts.push("  <reasons>");
    for (const reason of feedback.reasons) {
      parts.push(`    <reason>${escapeXml(reason)}</reason>`);
    }
    parts.push("  </reasons>");
  }

  // Pass details
  if (feedback.passDetails) {
    const pass = feedback.passDetails;
    parts.push(
      `  <pass-details confidence="${pass.verificationConfidence}" next-gate="${pass.nextGate}">`
    );
    parts.push(`    <readiness>${escapeXml(pass.readinessSummary)}</readiness>`);
    for (const h of pass.highlights) {
      parts.push(`    <highlight>${escapeXml(h)}</highlight>`);
    }
    parts.push("  </pass-details>");
  }

  // Revision details & actionable items
  if (feedback.revisionDetails) {
    const rev = feedback.revisionDetails;
    parts.push(
      `  <required-revisions count="${rev.requiredRevisionsCount}" critical="${rev.criticalCount}" high="${rev.highCount}" medium="${rev.mediumCount}" low="${rev.lowCount}">`
    );
    for (const r of feedback.actionableRecommendations) {
      const fileAttr = r.location?.filePath ? ` file="${escapeXmlAttr(r.location.filePath)}"` : "";
      const lineAttr = r.location?.lineNumber !== undefined ? ` line="${r.location.lineNumber}"` : "";

      parts.push(
        `    <revision id="${escapeXmlAttr(r.id)}" priority="${r.priority}" category="${r.category}" severity="${r.severity}"${fileAttr}${lineAttr}>`
      );
      parts.push(`      <title>${escapeXml(r.title)}</title>`);
      parts.push(`      <description>${escapeXml(r.description)}</description>`);
      if (r.location?.lineCitation) {
        parts.push(`      <citation>${escapeXml(r.location.lineCitation)}</citation>`);
      }
      parts.push(`      <action>${escapeXml(r.action)}</action>`);
      parts.push("    </revision>");
    }
    parts.push("  </required-revisions>");
  }

  // Rejection details
  if (feedback.rejectionDetails) {
    const rej = feedback.rejectionDetails;
    parts.push(
      `  <rejection-details severe-violation="${rej.severeViolationDetected}" attempts-exhausted="${rej.attemptsExhausted}">`
    );
    parts.push(`    <escalation-reason>${escapeXml(rej.escalationReason)}</escalation-reason>`);
    parts.push(`    <post-mortem>${escapeXml(rej.postMortemSummary)}</post-mortem>`);
    if (rej.architecturalRisks.length > GATE1_FEEDBACK_CONSTANTS.ZERO) {
      parts.push("    <architectural-risks>");
      for (const risk of rej.architecturalRisks) {
        parts.push(`      <risk>${escapeXml(risk)}</risk>`);
      }
      parts.push("    </architectural-risks>");
    }
    parts.push("  </rejection-details>");
  }

  parts.push("</verification-feedback>");
  return parts.join("\n");
}

/**
 * Formats structured feedback into GitHub-flavored Markdown for sandbox reports and PR reviews.
 */
export function formatGate1MarkdownFeedback(
  feedback: Gate1FeedbackCore,
  taskId?: string
): string {
  const sections: string[] = [];
  const id = taskId ?? feedback.metadata.taskId;

  sections.push(`# Gate 1 Semantic Review Verdict: ${feedback.verdict}`);
  if (id) {
    sections.push(`**Task**: \`${id}\``);
  }

  // GitHub alert block
  if (feedback.recommendation === GATE1_FEEDBACK_CONSTANTS.REC_PASS) {
    sections.push(
      `> [!NOTE]\n> Gate 1 Semantic Review PASSED with quality score ${feedback.score}/100. Recommended Event: \`${feedback.recommendedEvent}\`. Ready to advance to Gate 2 Adversarial Challenge.`
    );
  } else if (feedback.recommendation === GATE1_FEEDBACK_CONSTANTS.REC_REVISE) {
    sections.push(
      `> [!IMPORTANT]\n> Gate 1 Semantic Review requested REVISIONS (Attempt ${feedback.metadata.attempt}/${feedback.metadata.maxAttempts}). Recommended Event: \`${feedback.recommendedEvent}\`. Score: ${feedback.score}/100. Please address the prioritized findings below.`
    );
  } else {
    sections.push(
      `> [!WARNING]\n> Gate 1 Semantic Review REJECTED changes. Recommended Event: \`${feedback.recommendedEvent}\`. Target State: \`${feedback.targetState}\`. Critical defects or exhausted retry budget.`
    );
  }
  sections.push("");

  // Executive summary table
  sections.push("## Decision Summary");
  sections.push("| Parameter | Value |");
  sections.push("| :--- | :--- |");
  sections.push(`| **Verdict** | \`${feedback.verdict}\` |`);
  sections.push(`| **Recommendation** | **${feedback.recommendation}** |`);
  sections.push(`| **Recommended Event** | \`${feedback.recommendedEvent}\` |`);
  sections.push(`| **Target State** | \`${feedback.targetState}\` |`);
  sections.push(`| **Quality Score** | \`${feedback.score} / 100\` |`);
  sections.push(
    `| **Attempt** | ${feedback.metadata.attempt} of ${feedback.metadata.maxAttempts} (${feedback.metadata.remainingAttempts} remaining) |`
  );
  sections.push("");

  // Key reasons
  if (feedback.reasons.length > GATE1_FEEDBACK_CONSTANTS.ZERO) {
    sections.push("### Review Rationale");
    for (const r of feedback.reasons) {
      sections.push(`- ${r}`);
    }
    sections.push("");
  }

  // Pass Highlights
  if (feedback.passDetails) {
    sections.push("### Verification Highlights");
    for (const h of feedback.passDetails.highlights) {
      sections.push(`- ✓ ${h}`);
    }
    sections.push("");
  }

  // Actionable Revisions
  if (feedback.actionableRecommendations.length > GATE1_FEEDBACK_CONSTANTS.ZERO) {
    sections.push(
      `## Prioritized Findings & Remediation (${feedback.actionableRecommendations.length})`
    );

    for (let i = GATE1_FEEDBACK_CONSTANTS.ZERO; i < feedback.actionableRecommendations.length; i++) {
      const rec = feedback.actionableRecommendations[i];
      if (!rec) {
        continue;
      }

      sections.push(
        `### ${i + GATE1_FEEDBACK_CONSTANTS.ONE}. [${rec.priority}] ${rec.title}`
      );
      sections.push(`- **Category**: \`${rec.category}\` | **Severity**: \`${rec.severity}\``);

      if (rec.location) {
        const loc = rec.location.lineNumber
          ? `${rec.location.filePath}:${rec.location.lineNumber}`
          : rec.location.filePath;
        sections.push(`- **Location**: \`${loc}\``);

        if (rec.location.lineCitation) {
          sections.push(
            `- **Code Citation**:\n  \`\`\`typescript\n  ${rec.location.lineCitation.trim()}\n  \`\`\``
          );
        }
      }

      sections.push(`- **Defect**: ${rec.description}`);
      sections.push(`- **Actionable Remediation**: **${rec.action}**`);
      sections.push("");
    }
  }

  // Rejection Details
  if (feedback.rejectionDetails) {
    sections.push("## Escalation Post-Mortem");
    sections.push(`- **Reason**: ${feedback.rejectionDetails.escalationReason}`);
    sections.push(`- **Post-Mortem**: ${feedback.rejectionDetails.postMortemSummary}`);
    if (feedback.rejectionDetails.architecturalRisks.length > GATE1_FEEDBACK_CONSTANTS.ZERO) {
      sections.push("- **Architectural Invariants Violated**:");
      for (const risk of feedback.rejectionDetails.architecturalRisks) {
        sections.push(`  - ${risk}`);
      }
    }
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Formats a clean, high-priority prompt string to re-inject into the Worker subagent upon revision.
 */
export function formatGate1WorkerPrompt(
  feedback: Gate1StructuredFeedback,
  options?: Gate1FeedbackOptions
): string {
  const lines: string[] = [];
  const taskId = options?.taskId ?? feedback.metadata.taskId ?? "active task";

  lines.push(
    `Gate 1 Semantic Code Review requested revisions for ${taskId} (Attempt ${feedback.metadata.attempt}/${feedback.metadata.maxAttempts}).`
  );
  lines.push("");
  lines.push(`## Review Summary`);
  lines.push(
    `${feedback.summary} Quality Score: ${feedback.score}/100 (Threshold: ${GATE1_FEEDBACK_CONSTANTS.SCORE_THRESHOLD_PASS}).`
  );
  lines.push("");

  if (feedback.actionableRecommendations.length > GATE1_FEEDBACK_CONSTANTS.ZERO) {
    lines.push("## Required Actions (in order of priority):");
    for (let i = GATE1_FEEDBACK_CONSTANTS.ZERO; i < feedback.actionableRecommendations.length; i++) {
      const rec = feedback.actionableRecommendations[i];
      if (!rec) {
        continue;
      }

      const loc = rec.location?.filePath
        ? ` (${rec.location.filePath}${rec.location.lineNumber ? `:${rec.location.lineNumber}` : ""})`
        : "";

      lines.push(`${i + GATE1_FEEDBACK_CONSTANTS.ONE}. [${rec.priority}] ${rec.title}${loc}`);
      lines.push(`   - Defect: ${rec.description}`);
      if (rec.location?.lineCitation) {
        lines.push(`   - Citation: \`${rec.location.lineCitation.trim()}\``);
      }
      lines.push(`   - Remediation: ${rec.action}`);
    }
    lines.push("");
  }

  lines.push("## Worker Instructions:");
  lines.push("1. Fix the issues identified in the findings above.");
  lines.push("2. Verify that all numeric literals in logic are extracted to constants (*_CONSTANTS).");
  lines.push("3. Verify strict typing (zero 'any') and ensure promise chains have .catch handlers.");
  lines.push("4. Run local validation suite (`bun test`, `bunx tsc --noEmit`) to confirm zero regressions.");

  return lines.join("\n");
}

// ============================================================================
// MAIN FEEDBACK GENERATOR
// ============================================================================

/**
 * Generates structured feedback returning pass/revision/rejection recommendations.
 *
 * Accepts either a raw `Gate1ReviewReport` or an orchestrated `Gate1ReviewResult`.
 */
export function generateGate1Feedback(
  reportOrResult: Gate1ReviewReport | Gate1ReviewResult,
  options: Gate1FeedbackOptions = {}
): Gate1StructuredFeedback {
  // Normalize input
  const isResult = "report" in reportOrResult && "verdict" in reportOrResult;
  const report: Gate1ReviewReport = isResult
    ? (reportOrResult as Gate1ReviewResult).report
    : (reportOrResult as Gate1ReviewReport);

  const attempt =
    options.attempt ??
    (isResult ? (reportOrResult as Gate1ReviewResult).attempt : undefined) ??
    GATE1_FEEDBACK_CONSTANTS.DEFAULT_ATTEMPT;

  const maxAttempts =
    options.maxAttempts ??
    (isResult ? (reportOrResult as Gate1ReviewResult).maxAttempts : undefined) ??
    GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_ATTEMPTS;

  const severeViolation =
    options.severeViolation ??
    (isResult ? (reportOrResult as Gate1ReviewResult).severeViolation : undefined) ??
    (!report.boundaryCheck.passed ||
      report.findings.some(
        (f) => f.severity === GATE1_FEEDBACK_CONSTANTS.SEVERITY_FATAL
      ));

  const remainingAttempts = Math.max(
    GATE1_FEEDBACK_CONSTANTS.ZERO,
    maxAttempts - attempt
  );
  const canRetry = attempt < maxAttempts && !severeViolation;

  // Determine recommendation & recommended FSM event
  let recommendation: Gate1RecommendationType;
  let recommendedEvent: LooperEvent;
  let targetState: LooperState;

  if (report.verdict === GATE1_FEEDBACK_CONSTANTS.VERDICT_APPROVED) {
    recommendation = GATE1_FEEDBACK_CONSTANTS.REC_PASS;
    recommendedEvent = GATE1_FEEDBACK_CONSTANTS.EVENT_G1_PASS;
    targetState = GATE1_FEEDBACK_CONSTANTS.STATE_GATE_2_CHALLENGE;
  } else if (report.verdict === GATE1_FEEDBACK_CONSTANTS.VERDICT_REVISE) {
    if (canRetry) {
      recommendation = GATE1_FEEDBACK_CONSTANTS.REC_REVISE;
      recommendedEvent = GATE1_FEEDBACK_CONSTANTS.EVENT_G1_REVISE;
      targetState = GATE1_FEEDBACK_CONSTANTS.STATE_EXECUTE_WORKER;
    } else {
      recommendation = GATE1_FEEDBACK_CONSTANTS.REC_REJECT;
      recommendedEvent = GATE1_FEEDBACK_CONSTANTS.EVENT_G1_REJECT;
      targetState = GATE1_FEEDBACK_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC;
    }
  } else {
    recommendation = GATE1_FEEDBACK_CONSTANTS.REC_REJECT;
    recommendedEvent = GATE1_FEEDBACK_CONSTANTS.EVENT_G1_REJECT;
    targetState = GATE1_FEEDBACK_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC;
  }

  // Transform findings to actionable recommendations
  const actionableRecommendations = transformFindingsToActionableRecommendations(
    report.findings,
    options.maxFindings ?? GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_FINDINGS
  );

  // Compile key reasons
  const reasons: string[] = [];
  if (recommendation === GATE1_FEEDBACK_CONSTANTS.REC_PASS) {
    reasons.push("All acceptance criteria and architectural clean code invariants satisfied.");
    reasons.push("Zero magic numbers detected in executable logic.");
    reasons.push("Boundary scope containment verified.");
  } else if (recommendation === GATE1_FEEDBACK_CONSTANTS.REC_REVISE) {
    reasons.push(
      `Detected ${actionableRecommendations.length} issue(s) needing resolution before advancement.`
    );
    if (!report.checklistResults.zero_magic_numbers) {
      reasons.push("Zero Magic Numbers directive violated: hardcoded literal numbers in logic.");
    }
    if (!report.checklistResults.clean_code) {
      reasons.push("Clean Code invariants violated (strict typing leaks, unhandled rejections).");
    }
    if (!report.checklistResults.dod_adherence) {
      reasons.push("Definition of Done criteria incomplete (missing tests or disabled tests).");
    }
  } else {
    if (!report.boundaryCheck.passed) {
      reasons.push("Boundary scope containment violated: unauthorized files modified.");
    }
    if (attempt >= maxAttempts) {
      reasons.push(`Review retry attempts exhausted (${attempt}/${maxAttempts}).`);
    }
    if (severeViolation) {
      reasons.push("Severe architectural defect or fatal violation detected.");
    }
  }

  // Detailed info sections
  const passDetails =
    recommendation === GATE1_FEEDBACK_CONSTANTS.REC_PASS
      ? generatePassDetails(report, options)
      : undefined;

  const revisionDetails =
    recommendation === GATE1_FEEDBACK_CONSTANTS.REC_REVISE
      ? generateRevisionDetails(report, actionableRecommendations, options)
      : undefined;

  const rejectionDetails =
    recommendation === GATE1_FEEDBACK_CONSTANTS.REC_REJECT
      ? generateRejectionDetails(report, options)
      : undefined;

  // Metadata
  const metadata: Gate1FeedbackMetadata = {
    taskId: options.taskId,
    taskDescription: options.taskDescription,
    attempt,
    maxAttempts,
    remainingAttempts,
    canRetry,
    severeViolation,
    timestamp: new Date().toISOString(),
    durationMs: options.durationMs ?? (isResult ? (reportOrResult as Gate1ReviewResult).durationMs : undefined),
    subagentId: options.subagentId ?? (isResult ? (reportOrResult as Gate1ReviewResult).subagentId : undefined),
  };

  // Intermediate feedback core object for serialization
  const preliminaryFeedback: Gate1FeedbackCore = {
    gate: GATE1_FEEDBACK_CONSTANTS.GATE_ID,
    verdict: report.verdict,
    recommendation,
    recommendedEvent,
    targetState,
    score: report.score,
    summary: report.summary,
    reasons,
    actionableRecommendations,
    passDetails,
    revisionDetails,
    rejectionDetails,
    metadata,
  };

  const xmlFeedback = formatGate1XmlFeedback(preliminaryFeedback);
  const markdownFeedback = formatGate1MarkdownFeedback(
    preliminaryFeedback,
    options.taskId
  );
  const jsonFeedback = JSON.stringify(
    preliminaryFeedback,
    null,
    GATE1_FEEDBACK_CONSTANTS.JSON_INDENT_SPACES
  );

  return {
    ...preliminaryFeedback,
    xmlFeedback,
    markdownFeedback,
    jsonFeedback,
  };
}

// ============================================================================
// CONVENIENCE DIRECT FACTORIES
// ============================================================================

/**
 * Creates a synthetic PASS feedback result directly (useful in test harnesses or mock environments).
 */
export function createPassFeedback(options?: {
  taskId?: string;
  score?: number;
  summary?: string;
}): Gate1StructuredFeedback {
  const report: Gate1ReviewReport = {
    verdict: GATE1_FEEDBACK_CONSTANTS.VERDICT_APPROVED,
    score: options?.score ?? GATE1_FEEDBACK_CONSTANTS.SCORE_DEFAULT_APPROVED,
    summary: options?.summary ?? "Semantic review passed: Clean Code and Zero Magic Numbers satisfied.",
    checklistResults: {
      specification_fidelity: true,
      boundary_containment: true,
      regression_risk: true,
      code_quality: true,
      zero_magic_numbers: true,
      dod_adherence: true,
    },
    rubricChecks: [],
    findings: [],
    boundaryCheck: {
      passed: true,
      authorizedFiles: [],
      modifiedFiles: [],
      unauthorizedFiles: [],
      details: "Boundary containment verified.",
    },
    diffStats: {
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      fileList: [],
    },
    remediationAdvice: [],
  };

  return generateGate1Feedback(report, { taskId: options?.taskId });
}

/**
 * Creates a synthetic REVISION feedback result directly from findings.
 */
export function createRevisionFeedback(options: {
  taskId?: string;
  findings: readonly Gate1Finding[];
  score?: number;
  attempt?: number;
  maxAttempts?: number;
  summary?: string;
}): Gate1StructuredFeedback {
  const report: Gate1ReviewReport = {
    verdict: GATE1_FEEDBACK_CONSTANTS.VERDICT_REVISE,
    score: options.score ?? GATE1_FEEDBACK_CONSTANTS.SCORE_DEFAULT_REVISE,
    summary:
      options.summary ??
      `Semantic review requested revisions: ${options.findings.length} issue(s) detected.`,
    checklistResults: {
      specification_fidelity: true,
      boundary_containment: true,
      regression_risk: true,
      code_quality: false,
      zero_magic_numbers: !options.findings.some(
        (f) => f.category === GATE1_FEEDBACK_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS
      ),
      dod_adherence: true,
    },
    rubricChecks: [],
    findings: options.findings,
    boundaryCheck: {
      passed: true,
      authorizedFiles: [],
      modifiedFiles: [],
      unauthorizedFiles: [],
      details: "Boundary containment verified.",
    },
    diffStats: {
      filesChanged: 1,
      insertions: 10,
      deletions: 2,
      fileList: ["src/example.ts"],
    },
    remediationAdvice: options.findings
      .map((f) => f.remediation)
      .filter((r): r is string => Boolean(r)),
  };

  return generateGate1Feedback(report, {
    taskId: options.taskId,
    attempt: options.attempt,
    maxAttempts: options.maxAttempts,
  });
}

/**
 * Creates a synthetic REJECT feedback result directly.
 */
export function createRejectionFeedback(options: {
  taskId?: string;
  reason: string;
  findings?: readonly Gate1Finding[];
  score?: number;
  attempt?: number;
  maxAttempts?: number;
}): Gate1StructuredFeedback {
  const report: Gate1ReviewReport = {
    verdict: GATE1_FEEDBACK_CONSTANTS.VERDICT_REJECTED,
    score: options.score ?? GATE1_FEEDBACK_CONSTANTS.SCORE_DEFAULT_REJECTED,
    summary: options.reason,
    checklistResults: {
      specification_fidelity: false,
      boundary_containment: false,
      regression_risk: false,
      code_quality: false,
      zero_magic_numbers: false,
      dod_adherence: false,
    },
    rubricChecks: [],
    findings: options.findings ?? [],
    boundaryCheck: {
      passed: false,
      authorizedFiles: [],
      modifiedFiles: ["unauthorized.ts"],
      unauthorizedFiles: ["unauthorized.ts"],
      details: options.reason,
    },
    diffStats: {
      filesChanged: 1,
      insertions: 5,
      deletions: 0,
      fileList: ["unauthorized.ts"],
    },
    remediationAdvice: ["Revert unauthorized file modifications."],
  };

  return generateGate1Feedback(report, {
    taskId: options.taskId,
    attempt: options.attempt ?? GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
    maxAttempts: options.maxAttempts ?? GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
    severeViolation: true,
  });
}
