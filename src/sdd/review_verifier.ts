/**
 * Pre-PR Diff-Match Review Verifier and Stale Cache Guard for openspec-cascade.
 *
 * Enforces verification that automated review findings match the actual branch diff
 * computed from git merge-base, guarding against stale cache hits and irrelevant findings.
 */

import { CONSTANTS } from "../../config";

export interface RawReviewFinding {
  severity: string;
  file: string;
  line?: number;
  message: string;
}

export interface ReviewFinding {
  severity: "low" | "medium" | "high" | "critical";
  file: string;
  line?: number;
  message: string;
  tier: "mechanical" | "risky" | "advisory";
}

export interface ReviewVerificationInput {
  reviewFiles: string[];
  branchDiffFiles: string[];
  elapsedSeconds: number;
  findings: RawReviewFinding[];
}

export interface ReviewVerificationResult {
  valid: boolean;
  status: "ok" | "stale" | "mismatch" | "empty";
  blockingFindingsCount: number;
  triagedFindings: ReviewFinding[];
  reason?: string;
}

/**
 * Triages a single review finding into mechanical, risky, or advisory tier.
 */
export function triageFinding(finding: RawReviewFinding): ReviewFinding {
  const text = `${finding.severity} ${finding.message}`.toLowerCase();

  const isRisky =
    text.includes("security") ||
    text.includes("vulnerability") ||
    text.includes("injection") ||
    text.includes("auth") ||
    text.includes("crypto") ||
    text.includes("concurrency") ||
    text.includes("race condition") ||
    text.includes("data loss") ||
    text.includes("breaking change");

  const isMechanical =
    text.includes("unused") ||
    text.includes("typo") ||
    text.includes("formatting") ||
    text.includes("missing null") ||
    text.includes("null check") ||
    text.includes("import");

  const severityNorm: "low" | "medium" | "high" | "critical" =
    finding.severity.toLowerCase().startsWith("crit")
      ? "critical"
      : finding.severity.toLowerCase().startsWith("high")
      ? "high"
      : finding.severity.toLowerCase().startsWith("med")
      ? "medium"
      : "low";

  const tier = isRisky ? "risky" : isMechanical ? "mechanical" : "advisory";

  return {
    severity: severityNorm,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    tier,
  };
}

/**
 * Verifies review findings against branch diff and detects stale cache hits.
 */
export function verifyReviewFindings(
  input: ReviewVerificationInput
): ReviewVerificationResult {
  const minSeconds = CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS;

  // 1. Stale cache-hit guard: sub-10 second responses indicate cached results
  if (input.elapsedSeconds < minSeconds) {
    return {
      valid: false,
      status: "stale",
      blockingFindingsCount: 0,
      triagedFindings: [],
      reason: `Review returned in ${input.elapsedSeconds}s (under threshold of ${minSeconds}s); detected stale cache hit.`,
    };
  }

  // 2. Empty branch diff guard
  if (input.branchDiffFiles.length === 0) {
    return {
      valid: true,
      status: "empty",
      blockingFindingsCount: 0,
      triagedFindings: [],
      reason: "Branch diff is empty; no review required.",
    };
  }

  // 3. Diff-match verification: referenced files must overlap with branch diff
  if (input.reviewFiles.length > 0) {
    const diffSet = new Set(input.branchDiffFiles.map((f) => f.toLowerCase().trim()));
    const hasOverlap = input.reviewFiles.some((f) =>
      diffSet.has(f.toLowerCase().trim())
    );

    if (!hasOverlap) {
      return {
        valid: false,
        status: "mismatch",
        blockingFindingsCount: 0,
        triagedFindings: [],
        reason: "Review findings reference files that do not overlap with the branch diff.",
      };
    }
  }

  // 4. Triage findings
  const triaged = input.findings.map(triageFinding);
  const blockingCount = triaged.filter(
    (f) => f.tier === "risky" || f.severity === "critical" || f.severity === "high"
  ).length;

  return {
    valid: true,
    status: "ok",
    blockingFindingsCount: blockingCount,
    triagedFindings: triaged,
  };
}
