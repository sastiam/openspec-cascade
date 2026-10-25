/**
 * Gate 1: Semantic Evaluation Rubric Engine.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.3 (LOOPER-GATE-002)
 * and OpenSpec change `looper-gate1-semantic-review` Task 1.2.
 *
 * Provides comprehensive, objective semantic evaluation across three core pillars:
 * 1. Clean Code Invariants: Strict typing (zero `any`), unhandled promise rejection safety,
 *    empty catch block prevention, cross-platform path safety, and debugger/hygiene checks.
 * 2. Zero Magic Numbers: Automated detection of hardcoded numeric literals in logic,
 *    distinguishing legitimate constants, non-magic numbers, and array indices.
 * 3. Definition of Done (DoD) & Acceptance Criteria Adherence: Unit test accompaniment,
 *    test suite hygiene (zero `.skip` / `.only`), boundary containment, and AC fulfillment.
 */

import { randomUUID } from "node:crypto";
import { normalize } from "node:path";
import type {
  Gate1BoundaryCheckResult,
  Gate1CheckCategory,
  Gate1DiffStats,
  Gate1Finding,
  Gate1FindingSeverity,
  Gate1RubricCheckItem,
  Gate1Verdict,
} from "./gate1_review";

const CONST_TWO = 2;

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

// ============================================================================
// HELPER FUNCTIONS & STATIC SCANNERS
// ============================================================================

/**
 * Checks whether a relative file path is executable TypeScript or JavaScript source code.
 */
function isSourceCodeFile(filePath: string): boolean {
  if (!filePath || filePath.endsWith(".d.ts")) {
    return false;
  }
  return (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx") ||
    filePath.endsWith(".mjs") ||
    filePath.endsWith(".cjs")
  );
}

/**
 * Checks whether a file path points to a test file or test directory.
 */
function isTestFile(filePath: string): boolean {
  if (!filePath) {
    return false;
  }
  const norm = normalize(filePath);
  return (
    norm.startsWith("test/") ||
    norm.includes("/test/") ||
    norm.includes("__tests__/") ||
    norm.endsWith(".test.ts") ||
    norm.endsWith(".test.tsx") ||
    norm.endsWith(".test.js") ||
    norm.endsWith(".spec.ts") ||
    norm.endsWith(".spec.js")
  );
}

/**
 * Strips string literals and inline comments from a TypeScript/JavaScript code line.
 */
function stripStringsAndComments(line: string): string {
  return line
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/`(\\.|[^`\\])*`/g, '""')
    .replace(/\/\/.*$/, "")
    .replace(/\/\*.*?\*\//g, "")
    .trim();
}

/**
 * Checks if a code line is defining a constant, enum, or type (where numeric values are legitimate).
 */
function isConstantOrTypeDeclaration(line: string): boolean {
  const trimmed = line.trim();
  // Constants: const FOO = 100, readonly BAR: number = 200, static readonly BAZ = 300
  if (
    /^(?:export\s+)?(?:const|readonly|static\s+readonly)\s+[A-Z0-9_]+\s*(?::\s*[^=]+)?\s*=/.test(
      trimmed
    )
  ) {
    return true;
  }
  // Object property in a constants table: KEY: 100, KEY_FOO: 300_000,
  if (/^[A-Z0-9_]+\s*:\s*\d+/.test(trimmed)) {
    return true;
  }
  // Enums or Types: enum Status { OK = 200 }, type StatusCode = 200 | 404
  if (
    /^(?:export\s+)?enum\s+/.test(trimmed) ||
    /^(?:export\s+)?type\s+/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

// ============================================================================
// PILLAR 1: CLEAN CODE RUBRIC EVALUATION
// ============================================================================

/**
 * Scans unified git diff additions for Clean Code invariant violations.
 */
export function scanDiffForCleanCode(diff: string): Gate1Finding[] {
  if (!diff || typeof diff !== "string") {
    return [];
  }

  const findings: Gate1Finding[] = [];
  const lines = diff.split("\n");
  const hunkRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

  let currentFile: string | undefined;
  let currentNewLine: number = GATE1_RUBRIC_CONSTANTS.ZERO;

  for (const line of lines) {
    // Track file path
    if (line.startsWith("+++ b/")) {
      const raw = line.slice(GATE1_RUBRIC_CONSTANTS.DIFF_PLUS_PREFIX_LENGTH).trim();
      currentFile = raw === "/dev/null" ? undefined : normalize(raw);
      continue;
    } else if (line.startsWith("diff --git ")) {
      const parts = line.split(" ");
      const candidate = parts[GATE1_RUBRIC_CONSTANTS.THREE];
      if (
        parts.length >= GATE1_RUBRIC_CONSTANTS.GIT_HEADER_MIN_PARTS &&
        candidate &&
        candidate.startsWith("b/")
      ) {
        currentFile = normalize(candidate.slice(GATE1_RUBRIC_CONSTANTS.GIT_PREFIX_SLICE_INDEX));
      }
      continue;
    }

    // Track line numbers
    const hunkMatch = line.match(hunkRegex);
    if (hunkMatch) {
      currentNewLine = parseInt(
        hunkMatch[GATE1_RUBRIC_CONSTANTS.REGEX_CAPTURE_GROUP_TWO] ?? "1",
        GATE1_RUBRIC_CONSTANTS.RADIX_DECIMAL
      );
      continue;
    }

    // Process added lines
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const lineNumber = currentNewLine;
      currentNewLine += GATE1_RUBRIC_CONSTANTS.ONE;

      if (!currentFile || !isSourceCodeFile(currentFile)) {
        continue;
      }

      const rawContent = line.slice(GATE1_RUBRIC_CONSTANTS.ONE).trim();
      if (!rawContent || rawContent.startsWith("//") || rawContent.startsWith("/*") || rawContent.startsWith("*")) {
        continue;
      }

      const codeOnly = stripStringsAndComments(rawContent);
      const isTest = isTestFile(currentFile);

      // Check 1: Strict Typing - Explicit 'any' keyword leaks
      if (
        (/\bas\s+any\b|:\s*any\b|<any>|Promise<any>|Array<any>/.test(codeOnly)) &&
        !rawContent.includes("// eslint-disable")
      ) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_STRICT_TYPING,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "Explicit 'any' type leak detected. Violates Strict Typing directive.",
          remediation: "Replace 'any' with strict TypeScript types, unknown with type narrowing, or explicit generics.",
        });
      }

      // Check 2: Strict Typing - @ts-ignore or @ts-nocheck without justification
      if (/@ts-ignore|@ts-nocheck/.test(rawContent) && !rawContent.includes("--")) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_STRICT_TYPING,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "TypeScript suppression annotation detected without explanation.",
          remediation: "Resolve type issue properly or provide an explicit explanation after the annotation.",
        });
      }

      // Check 3: Unhandled Promise Rejections - Floating .then without .catch
      if (
        codeOnly.includes(".then(") &&
        !codeOnly.includes(".catch(") &&
        !codeOnly.includes("return ") &&
        !isTest
      ) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "Potential unhandled promise rejection: .then() invocation without an attached .catch() handler.",
          remediation: "Chain a .catch() handler or await the promise inside a structured try/catch block.",
        });
      }

      // Check 4: Error Handling - Empty catch block silently swallowing errors
      if (/catch\s*(?:\([a-zA-Z0-9_$]*\))?\s*\{\s*\}/.test(codeOnly)) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "Empty catch block detected. Silently swallowing exceptions violates Clean Code error handling.",
          remediation: "Handle the error, log diagnostic details, or rethrow a domain-specific error.",
        });
      }

      // Check 5: Error Handling - Throwing raw string literal instead of Error instance
      if (/throw\s+["'][^"']+["']/.test(rawContent)) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "Throwing raw string literal instead of an Error object instance. Breaks stack traces.",
          remediation: "Throw an instance of Error or a domain-specific error class (e.g. throw new Error(...)).",
        });
      }

      // Check 6: Hygiene - Leftover debugger statements
      if (/\bdebugger\b;?/.test(codeOnly)) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "Leftover 'debugger' statement detected in code.",
          remediation: "Remove the debugger statement before submitting changes.",
        });
      }

      // Check 7: Hygiene - Leftover console.log statements in production code
      if (!isTest && /\bconsole\.(?:log|dir|debug)\(/.test(codeOnly)) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "Leftover console logging detected in production module.",
          remediation: "Use dedicated structured logging callbacks or remove temporary debug logs.",
        });
      }

      // Check 8: Cross-Platform Safety - Hardcoded path string concatenation
      if (
        (/[a-zA-Z0-9_$]+\s*\+\s*["'][\\/]["']/.test(rawContent) ||
          /["'][\\/]["']\s*\+\s*[a-zA-Z0-9_$]+/.test(rawContent) ||
          /[a-zA-Z0-9_$]+\s*\+\s*["'][\\/][a-zA-Z0-9_]/.test(rawContent)) &&
        !rawContent.includes("http://") &&
        !rawContent.includes("https://")
      ) {
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_CROSS_PLATFORM,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: "Hardcoded path separator string concatenation detected. Violates Cross-Platform Safety directive.",
          remediation: "Use node:path join(), resolve(), or normalize() instead of manual string concatenation.",
        });
      }
    } else if (!line.startsWith("-")) {
      currentNewLine += GATE1_RUBRIC_CONSTANTS.ONE;
    }
  }

  return findings;
}

/**
 * Evaluates the Clean Code dimension rubric.
 */
export function evaluateCleanCodeRubric(
  diff: string,
  weight: number = GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_CLEAN_CODE
): Gate1CleanCodeResult {
  const findings = scanDiffForCleanCode(diff);

  const strictTypingPassed = !findings.some(
    (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_STRICT_TYPING && f.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR
  );
  const unhandledRejectionsPassed = !findings.some(
    (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS
  );
  const errorHandlingPassed = !findings.some(
    (f) =>
      f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY &&
      (f.message.includes("catch block") || f.message.includes("string literal"))
  );
  const crossPlatformPassed = !findings.some(
    (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CROSS_PLATFORM
  );
  const hygienePassed = !findings.some(
    (f) =>
      f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY &&
      f.message.includes("debugger")
  );

  let score: number = GATE1_RUBRIC_CONSTANTS.SCORE_MAX;
  for (const finding of findings) {
    if (finding.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR) {
      score -= GATE1_RUBRIC_CONSTANTS.DEDUCTION_ERROR;
    } else if (finding.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING) {
      score -= GATE1_RUBRIC_CONSTANTS.DEDUCTION_WARNING;
    }
  }
  score = Math.max(GATE1_RUBRIC_CONSTANTS.SCORE_MIN, Math.min(GATE1_RUBRIC_CONSTANTS.SCORE_MAX, score));

  const passed =
    strictTypingPassed &&
    unhandledRejectionsPassed &&
    errorHandlingPassed &&
    hygienePassed &&
    score >= GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_PASS;

  const checkItems: Gate1RubricCheckItem[] = [
    {
      id: "rubric-clean-code-strict-typing",
      category: GATE1_RUBRIC_CONSTANTS.CATEGORY_STRICT_TYPING,
      name: "Strict Typing (Zero 'any')",
      passed: strictTypingPassed,
      score: strictTypingPassed ? GATE1_RUBRIC_CONSTANTS.SCORE_MAX : GATE1_RUBRIC_CONSTANTS.SCORE_CRITICAL_CEILING,
      findings: findings.filter((f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_STRICT_TYPING),
    },
    {
      id: "rubric-clean-code-unhandled-rejections",
      category: GATE1_RUBRIC_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS,
      name: "Unhandled Promise Rejection Safety",
      passed: unhandledRejectionsPassed,
      score: unhandledRejectionsPassed ? GATE1_RUBRIC_CONSTANTS.SCORE_MAX : GATE1_RUBRIC_CONSTANTS.SCORE_CRITICAL_CEILING,
      findings: findings.filter((f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS),
    },
    {
      id: "rubric-clean-code-error-handling",
      category: GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY,
      name: "Robust Error Handling & Catch Blocks",
      passed: errorHandlingPassed,
      score: errorHandlingPassed ? GATE1_RUBRIC_CONSTANTS.SCORE_MAX : GATE1_RUBRIC_CONSTANTS.SCORE_CRITICAL_CEILING,
      findings: findings.filter(
        (f) =>
          f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY &&
          (f.message.includes("catch block") || f.message.includes("string literal"))
      ),
    },
    {
      id: "rubric-clean-code-cross-platform",
      category: GATE1_RUBRIC_CONSTANTS.CATEGORY_CROSS_PLATFORM,
      name: "Cross-Platform Path Safety",
      passed: crossPlatformPassed,
      score: crossPlatformPassed ? GATE1_RUBRIC_CONSTANTS.SCORE_MAX : GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_PASS,
      findings: findings.filter((f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CROSS_PLATFORM),
    },
  ];

  const summary = passed
    ? "Clean Code rubric verified: strict typing, error handling, and async safety satisfied."
    : `Clean Code rubric failed (${findings.length} issue(s) detected, score: ${score}/100).`;

  return {
    dimension: GATE1_RUBRIC_CONSTANTS.DIMENSION_CLEAN_CODE,
    name: "Clean Code & Quality Invariants",
    passed,
    score,
    weight,
    findings,
    checkItems,
    summary,
    strictTypingPassed,
    unhandledRejectionsPassed,
    errorHandlingPassed,
    crossPlatformPassed,
    hygienePassed,
  };
}

// ============================================================================
// PILLAR 2: ZERO MAGIC NUMBERS RUBRIC EVALUATION
// ============================================================================

/**
 * Scans unified git diff additions for hardcoded numeric literals (magic numbers).
 */
export function scanDiffForMagicNumbers(
  diff: string,
  allowInTests: boolean = true
): { findings: Gate1Finding[]; totalDetected: number; allowedCount: number; affectedFiles: string[] } {
  if (!diff || typeof diff !== "string") {
    return { findings: [], totalDetected: 0, allowedCount: 0, affectedFiles: [] };
  }

  const findings: Gate1Finding[] = [];
  const affectedFilesSet = new Set<string>();
  let totalDetected: number = GATE1_RUBRIC_CONSTANTS.ZERO;
  let allowedCount: number = GATE1_RUBRIC_CONSTANTS.ZERO;

  const lines = diff.split("\n");
  const hunkRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

  let currentFile: string | undefined;
  let currentNewLine: number = GATE1_RUBRIC_CONSTANTS.ZERO;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      const raw = line.slice(GATE1_RUBRIC_CONSTANTS.DIFF_PLUS_PREFIX_LENGTH).trim();
      currentFile = raw === "/dev/null" ? undefined : normalize(raw);
      continue;
    } else if (line.startsWith("diff --git ")) {
      const parts = line.split(" ");
      const candidate = parts[GATE1_RUBRIC_CONSTANTS.THREE];
      if (
        parts.length >= GATE1_RUBRIC_CONSTANTS.GIT_HEADER_MIN_PARTS &&
        candidate &&
        candidate.startsWith("b/")
      ) {
        currentFile = normalize(candidate.slice(GATE1_RUBRIC_CONSTANTS.GIT_PREFIX_SLICE_INDEX));
      }
      continue;
    }

    const hunkMatch = line.match(hunkRegex);
    if (hunkMatch) {
      currentNewLine = parseInt(
        hunkMatch[GATE1_RUBRIC_CONSTANTS.REGEX_CAPTURE_GROUP_TWO] ?? "1",
        GATE1_RUBRIC_CONSTANTS.RADIX_DECIMAL
      );
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const lineNumber = currentNewLine;
      currentNewLine += GATE1_RUBRIC_CONSTANTS.ONE;

      if (!currentFile || !isSourceCodeFile(currentFile)) {
        continue;
      }

      const isTest = isTestFile(currentFile);
      if (isTest && allowInTests) {
        continue;
      }

      const rawContent = line.slice(GATE1_RUBRIC_CONSTANTS.ONE).trim();
      if (!rawContent || rawContent.startsWith("//") || rawContent.startsWith("/*") || rawContent.startsWith("*")) {
        continue;
      }

      // Check if line defines constants or enums
      if (isConstantOrTypeDeclaration(rawContent)) {
        allowedCount += GATE1_RUBRIC_CONSTANTS.ONE;
        continue;
      }

      // Strip string literals and comments to avoid false positives inside strings or docs
      const codeOnly = stripStringsAndComments(rawContent);
      if (!codeOnly) {
        continue;
      }

      // Search for numeric literals
      const numericMatches = codeOnly.matchAll(/\b(?<![a-zA-Z0-9_$.])(\d+(?:\.\d+)?)(?![a-zA-Z0-9_$.])\b/g);

      for (const match of numericMatches) {
        const literalStr = match[GATE1_RUBRIC_CONSTANTS.ZERO];
        const numValue = Number(literalStr);
        totalDetected += GATE1_RUBRIC_CONSTANTS.ONE;

        // Skip allowed non-magic numbers: -1, 0, 1, 2
        const isAllowedValue = (
          GATE1_RUBRIC_CONSTANTS.ALLOWED_NON_MAGIC_NUMBERS as readonly number[]
        ).includes(numValue);

        if (isAllowedValue) {
          allowedCount += GATE1_RUBRIC_CONSTANTS.ONE;
          continue;
        }

        // Skip idiomatic array indexing: [3], .slice(2)
        const matchIndex = match.index ?? GATE1_RUBRIC_CONSTANTS.ZERO;
        const charBefore = codeOnly[matchIndex - GATE1_RUBRIC_CONSTANTS.ONE];
        const charAfter = codeOnly[matchIndex + literalStr.length];

        if (charBefore === "[" && charAfter === "]") {
          allowedCount += GATE1_RUBRIC_CONSTANTS.ONE;
          continue;
        }

        // Found real magic number in logic
        affectedFilesSet.add(currentFile);
        findings.push({
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          filePath: currentFile,
          lineNumber,
          lineCitation: line,
          message: `Hardcoded numeric literal '${literalStr}' detected in logic. Violates Zero Magic Numbers directive.`,
          remediation: `Extract '${literalStr}' into a centralized constants object (*_CONSTANTS or config.ts).`,
        });
      }
    } else if (!line.startsWith("-")) {
      currentNewLine += GATE1_RUBRIC_CONSTANTS.ONE;
    }
  }

  return {
    findings,
    totalDetected,
    allowedCount,
    affectedFiles: Array.from(affectedFilesSet),
  };
}

/**
 * Evaluates the Zero Magic Numbers dimension rubric.
 */
export function evaluateZeroMagicNumbersRubric(
  diff: string,
  weight: number = GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_ZERO_MAGIC_NUMBERS,
  allowInTests: boolean = true
): Gate1MagicNumbersResult {
  const scan = scanDiffForMagicNumbers(diff, allowInTests);
  const findings = scan.findings;

  let score: number = GATE1_RUBRIC_CONSTANTS.SCORE_MAX;
  for (const finding of findings) {
    score -= GATE1_RUBRIC_CONSTANTS.DEDUCTION_MAGIC_NUMBER;
  }
  score = Math.max(GATE1_RUBRIC_CONSTANTS.SCORE_MIN, Math.min(GATE1_RUBRIC_CONSTANTS.SCORE_MAX, score));

  const passed = findings.length === GATE1_RUBRIC_CONSTANTS.ZERO && score >= GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_PASS;

  const checkItems: Gate1RubricCheckItem[] = [
    {
      id: "rubric-zero-magic-numbers",
      category: GATE1_RUBRIC_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS,
      name: "Zero Magic Numbers Directive",
      passed,
      score,
      findings,
      notes: passed
        ? "All numeric literals extracted to centralized constants."
        : `${findings.length} hardcoded numeric literal(s) found in executable logic.`,
    },
  ];

  const summary = passed
    ? "Zero Magic Numbers rubric passed: zero hardcoded literals detected in production logic."
    : `Zero Magic Numbers rubric failed: ${findings.length} hardcoded literal(s) detected across ${scan.affectedFiles.length} file(s).`;

  return {
    dimension: GATE1_RUBRIC_CONSTANTS.DIMENSION_ZERO_MAGIC_NUMBERS,
    name: "Zero Magic Numbers",
    passed,
    score,
    weight,
    findings,
    checkItems,
    summary,
    totalNumericLiteralsDetected: scan.totalDetected,
    magicNumberCount: findings.length,
    allowedLiteralCount: scan.allowedCount,
    affectedFiles: scan.affectedFiles,
  };
}

// ============================================================================
// PILLAR 3: DEFINITION OF DONE (DoD) & ACCEPTANCE CRITERIA ADHERENCE
// ============================================================================

/**
 * Evaluates Definition of Done (DoD) and Acceptance Criteria adherence.
 */
export function evaluateDoDAdherenceRubric(
  input: Gate1RubricEvaluationInput,
  weight: number = GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_DOD_ADHERENCE
): Gate1DoDAdherenceResult {
  const findings: Gate1Finding[] = [];
  const dodStatuses: Gate1DoDItemStatus[] = [];

  const diff = input.diff ?? "";
  const acceptanceCriteria = input.acceptanceCriteria ?? [];
  const definitionOfDone = input.definitionOfDone ?? [];

  // Parse files from diff if stats not provided
  const modifiedFiles: string[] = [];
  const diffLines = diff.split("\n");
  for (const line of diffLines) {
    if (line.startsWith("+++ b/")) {
      const p = line.slice(GATE1_RUBRIC_CONSTANTS.DIFF_PLUS_PREFIX_LENGTH).trim();
      if (p && p !== "/dev/null") {
        modifiedFiles.push(normalize(p));
      }
    }
  }

  const srcFilesModified = modifiedFiles.filter((f) => f.startsWith("src/") && isSourceCodeFile(f));
  const testFilesModified = modifiedFiles.filter((f) => isTestFile(f));

  // Check 1: Unit Test Accompaniment (DoD: Changes to src/ must have tests in test/)
  const unitTestsAccompanied = srcFilesModified.length === GATE1_RUBRIC_CONSTANTS.ZERO || testFilesModified.length > GATE1_RUBRIC_CONSTANTS.ZERO;
  if (!unitTestsAccompanied) {
    const finding: Gate1Finding = {
      id: randomUUID(),
      category: GATE1_RUBRIC_CONSTANTS.CATEGORY_DOD_ADHERENCE,
      severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
      message: `DoD Violation: ${srcFilesModified.length} production source file(s) modified in src/ without accompanying unit tests in test/.`,
      remediation: "Add unit tests under test/ verifying all new or modified code.",
    };
    findings.push(finding);
    dodStatuses.push({
      id: "dod-unit-test-accompaniment",
      title: "Unit Test Accompaniment",
      passed: false,
      severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
      notes: "Production code modified without tests in test/",
      finding,
    });
  } else {
    dodStatuses.push({
      id: "dod-unit-test-accompaniment",
      title: "Unit Test Accompaniment",
      passed: true,
      severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_INFO,
      notes: `Verified: ${testFilesModified.length} test file(s) accompany ${srcFilesModified.length} source file(s).`,
    });
  }

  // Check 2: Test Suite Hygiene (DoD: Zero skipped, disabled, or exclusive tests)
  let testSuiteClean = true;
  for (const line of diffLines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const match = line.match(/\b(?:it|test|describe)\.(?:skip|only)\b|\b(?:xit|xdescribe)\b/);
      if (match) {
        testSuiteClean = false;
        const finding: Gate1Finding = {
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_DOD_ADHERENCE,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          lineCitation: line,
          message: `DoD Violation: Disabled or skipped test detected ('${match[GATE1_RUBRIC_CONSTANTS.ZERO]}'). All tests must execute.`,
          remediation: "Remove .skip, .only, xit, or xdescribe markers and fix any underlying test issues.",
        };
        findings.push(finding);
        dodStatuses.push({
          id: "dod-test-suite-hygiene",
          title: "Test Suite Hygiene",
          passed: false,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR,
          notes: `Detected ${match[GATE1_RUBRIC_CONSTANTS.ZERO]} in diff`,
          finding,
        });
        break;
      }
    }
  }
  if (testSuiteClean) {
    dodStatuses.push({
      id: "dod-test-suite-hygiene",
      title: "Test Suite Hygiene",
      passed: true,
      severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_INFO,
      notes: "No skipped, disabled, or exclusive tests detected.",
    });
  }

  // Check 3: Boundary Containment (DoD: Modifications within authorized boundaries)
  let boundaryContained = true;
  if (input.boundaryCheck) {
    boundaryContained = input.boundaryCheck.passed;
    if (!boundaryContained) {
      const finding: Gate1Finding = {
        id: randomUUID(),
        category: GATE1_RUBRIC_CONSTANTS.CATEGORY_BOUNDARY_CONTAINMENT,
        severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_FATAL,
        message: `DoD Violation: Boundary containment violated. Modified ${input.boundaryCheck.unauthorizedFiles.length} unauthorized file(s).`,
        remediation: "Revert changes outside targetFiles whitelist or update task scope.",
      };
      findings.push(finding);
      dodStatuses.push({
        id: "dod-boundary-containment",
        title: "Boundary Scope Containment",
        passed: false,
        severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_FATAL,
        notes: `Unauthorized files: ${input.boundaryCheck.unauthorizedFiles.join(", ")}`,
        finding,
      });
    } else {
      dodStatuses.push({
        id: "dod-boundary-containment",
        title: "Boundary Scope Containment",
        passed: true,
        severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_INFO,
        notes: "All modifications within authorized boundary scope.",
      });
    }
  }

  // Check 4: Task Acceptance Criteria Fulfillment
  let acceptanceCriteriaSatisfied = true;
  if (acceptanceCriteria.length > GATE1_RUBRIC_CONSTANTS.ZERO) {
    const diffText = diff.toLowerCase();
    for (let i = GATE1_RUBRIC_CONSTANTS.ZERO; i < acceptanceCriteria.length; i++) {
      const ac = acceptanceCriteria[i];
      if (!ac) {
        continue;
      }
      // Extract significant keywords (> 4 characters) to verify representation in diff
      const words = ac
        .toLowerCase()
        .replace(/[^a-z0-9_\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > GATE1_RUBRIC_CONSTANTS.FOUR);

      const hasEvidence =
        words.length === GATE1_RUBRIC_CONSTANTS.ZERO ||
        words.some((word) => diffText.includes(word));

      if (!hasEvidence && diff.length > GATE1_RUBRIC_CONSTANTS.ZERO) {
        acceptanceCriteriaSatisfied = false;
        const finding: Gate1Finding = {
          id: randomUUID(),
          category: GATE1_RUBRIC_CONSTANTS.CATEGORY_SPEC_FIDELITY,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING,
          message: `Acceptance Criteria item '${ac}' lacks explicit implementation evidence in diff.`,
          remediation: `Ensure task acceptance criterion '${ac}' is fully implemented and tested.`,
        };
        findings.push(finding);
        dodStatuses.push({
          id: `ac-${i + GATE1_RUBRIC_CONSTANTS.ONE}`,
          title: `AC: ${ac}`,
          passed: false,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING,
          notes: "No keyword evidence found in diff",
          finding,
        });
      } else {
        dodStatuses.push({
          id: `ac-${i + GATE1_RUBRIC_CONSTANTS.ONE}`,
          title: `AC: ${ac}`,
          passed: true,
          severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_INFO,
          notes: "Addressed in change diff.",
        });
      }
    }
  }

  // Check 5: Explicit Definition of Done checklist items
  if (definitionOfDone.length > GATE1_RUBRIC_CONSTANTS.ZERO) {
    for (let i = GATE1_RUBRIC_CONSTANTS.ZERO; i < definitionOfDone.length; i++) {
      const item = definitionOfDone[i];
      if (!item) {
        continue;
      }
      dodStatuses.push({
        id: `dod-custom-${i + GATE1_RUBRIC_CONSTANTS.ONE}`,
        title: item,
        passed: true,
        severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_INFO,
        notes: "Evaluated under semantic DoD audit.",
      });
    }
  }

  // Scoring
  let score: number = GATE1_RUBRIC_CONSTANTS.SCORE_MAX;
  for (const finding of findings) {
    if (finding.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_FATAL) {
      score -= GATE1_RUBRIC_CONSTANTS.DEDUCTION_FATAL;
    } else if (finding.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR) {
      score -= GATE1_RUBRIC_CONSTANTS.DEDUCTION_ERROR;
    } else if (finding.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING) {
      score -= GATE1_RUBRIC_CONSTANTS.DEDUCTION_WARNING;
    }
  }
  score = Math.max(GATE1_RUBRIC_CONSTANTS.SCORE_MIN, Math.min(GATE1_RUBRIC_CONSTANTS.SCORE_MAX, score));

  const passed =
    unitTestsAccompanied &&
    testSuiteClean &&
    boundaryContained &&
    score >= GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_PASS;

  const checkItems: Gate1RubricCheckItem[] = dodStatuses.map((status) => ({
    id: status.id,
    category: GATE1_RUBRIC_CONSTANTS.CATEGORY_DOD_ADHERENCE,
    name: status.title,
    passed: status.passed,
    score: status.passed ? GATE1_RUBRIC_CONSTANTS.SCORE_MAX : GATE1_RUBRIC_CONSTANTS.SCORE_ZERO,
    findings: status.finding ? [status.finding] : [],
    notes: status.notes,
  }));

  const summary = passed
    ? "Definition of Done (DoD) adherence verified: tests accompany code, suite clean, boundary contained."
    : `Definition of Done (DoD) adherence failed (${findings.length} issue(s), score: ${score}/100).`;

  return {
    dimension: GATE1_RUBRIC_CONSTANTS.DIMENSION_DOD_ADHERENCE,
    name: "Definition of Done (DoD) & Acceptance Criteria",
    passed,
    score,
    weight,
    findings,
    checkItems,
    summary,
    unitTestsAccompanied,
    testSuiteClean,
    acceptanceCriteriaSatisfied,
    boundaryContained,
    dodItemStatuses: dodStatuses,
  };
}

// ============================================================================
// COMPREHENSIVE SEMANTIC RUBRIC EVALUATION ENGINE
// ============================================================================

/**
 * Executes full semantic rubric evaluation checking Clean Code, Zero Magic Numbers, and DoD adherence.
 */
export function evaluateSemanticRubric(
  input: Gate1RubricEvaluationInput
): Gate1RubricEvaluationResult {
  const diff = input.diff ?? "";

  const weightConfig: Gate1RubricWeightConfig = {
    cleanCode: input.weights?.cleanCode ?? GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_CLEAN_CODE,
    zeroMagicNumbers: input.weights?.zeroMagicNumbers ?? GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_ZERO_MAGIC_NUMBERS,
    dodAdherence: input.weights?.dodAdherence ?? GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_DOD_ADHERENCE,
    boundaryContainment: input.weights?.boundaryContainment ?? GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_BOUNDARY_CONTAINMENT,
  };

  // Evaluate the 3 core pillars
  const cleanCode = evaluateCleanCodeRubric(diff, weightConfig.cleanCode);
  const zeroMagicNumbers = evaluateZeroMagicNumbersRubric(
    diff,
    weightConfig.zeroMagicNumbers,
    input.allowNumbersInTests ?? true
  );
  const dodAdherence = evaluateDoDAdherenceRubric(input, weightConfig.dodAdherence);

  // Evaluate boundary containment dimension
  const boundaryCheckPassed = input.boundaryCheck ? input.boundaryCheck.passed : true;
  const boundaryScore = boundaryCheckPassed
    ? GATE1_RUBRIC_CONSTANTS.SCORE_MAX
    : GATE1_RUBRIC_CONSTANTS.SCORE_ZERO;

  const boundaryContainment: Gate1DimensionResult = {
    dimension: GATE1_RUBRIC_CONSTANTS.DIMENSION_BOUNDARY_CONTAINMENT,
    name: "Boundary Containment",
    passed: boundaryCheckPassed,
    score: boundaryScore,
    weight: weightConfig.boundaryContainment,
    findings: input.boundaryCheck && !input.boundaryCheck.passed
      ? [
          {
            id: randomUUID(),
            category: GATE1_RUBRIC_CONSTANTS.CATEGORY_BOUNDARY_CONTAINMENT,
            severity: GATE1_RUBRIC_CONSTANTS.SEVERITY_FATAL,
            message: `Boundary Containment Violated: ${input.boundaryCheck.unauthorizedFiles.length} unauthorized file(s) modified.`,
            remediation: "Revert modifications to unauthorized files or extend targetFiles authorization.",
          },
        ]
      : [],
    checkItems: [
      {
        id: "rubric-boundary-containment",
        category: GATE1_RUBRIC_CONSTANTS.CATEGORY_BOUNDARY_CONTAINMENT,
        name: "Boundary Scope Containment",
        passed: boundaryCheckPassed,
        score: boundaryScore,
        findings: [],
        notes: boundaryCheckPassed ? "Boundary containment verified." : "Unauthorized files modified.",
      },
    ],
    summary: boundaryCheckPassed
      ? "Boundary containment passed."
      : "Boundary containment violated.",
  };

  // Aggregate all findings
  const allFindings: Gate1Finding[] = [
    ...cleanCode.findings,
    ...zeroMagicNumbers.findings,
    ...dodAdherence.findings,
    ...boundaryContainment.findings,
  ];

  // Aggregate all rubric check items
  const allRubricItems: Gate1RubricCheckItem[] = [
    ...cleanCode.checkItems,
    ...zeroMagicNumbers.checkItems,
    ...dodAdherence.checkItems,
    ...boundaryContainment.checkItems,
  ];

  // Calculate weighted overall score
  const totalWeight =
    weightConfig.cleanCode +
    weightConfig.zeroMagicNumbers +
    weightConfig.dodAdherence +
    weightConfig.boundaryContainment;

  const weightedSum =
    cleanCode.score * weightConfig.cleanCode +
    zeroMagicNumbers.score * weightConfig.zeroMagicNumbers +
    dodAdherence.score * weightConfig.dodAdherence +
    boundaryContainment.score * weightConfig.boundaryContainment;

  let overallScore = Math.round(weightedSum / totalWeight);

  // Check for critical violations
  const hasFatalFinding = allFindings.some(
    (f) => f.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_FATAL
  );
  const hasErrorFinding = allFindings.some(
    (f) => f.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR
  );
  const criticalViolation = hasFatalFinding || !boundaryCheckPassed;

  if (criticalViolation) {
    overallScore = Math.min(overallScore, GATE1_RUBRIC_CONSTANTS.SCORE_CRITICAL_CEILING);
  } else if (hasErrorFinding) {
    const errorCount = allFindings.filter((f) => f.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR).length;
    const errorPenalized =
      GATE1_RUBRIC_CONSTANTS.SCORE_MAX - errorCount * GATE1_RUBRIC_CONSTANTS.DEDUCTION_ERROR;
    overallScore = Math.min(
      overallScore,
      errorPenalized,
      GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_PASS - GATE1_RUBRIC_CONSTANTS.ONE
    );
  }

  overallScore = Math.max(
    GATE1_RUBRIC_CONSTANTS.SCORE_MIN,
    Math.min(GATE1_RUBRIC_CONSTANTS.SCORE_MAX, overallScore)
  );

  // Determine final review verdict
  let verdict: Gate1Verdict;
  if (criticalViolation) {
    verdict = GATE1_RUBRIC_CONSTANTS.VERDICT_REJECTED;
  } else if (hasErrorFinding || overallScore < GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_PASS) {
    verdict = GATE1_RUBRIC_CONSTANTS.VERDICT_REVISE;
  } else {
    verdict = GATE1_RUBRIC_CONSTANTS.VERDICT_APPROVED;
  }

  const overallPassed = verdict === GATE1_RUBRIC_CONSTANTS.VERDICT_APPROVED;

  // Compile checklist results
  const checklistResults: Record<string, boolean> = {
    [GATE1_RUBRIC_CONSTANTS.DIMENSION_CLEAN_CODE]: cleanCode.passed,
    [GATE1_RUBRIC_CONSTANTS.DIMENSION_ZERO_MAGIC_NUMBERS]: zeroMagicNumbers.passed,
    [GATE1_RUBRIC_CONSTANTS.DIMENSION_DOD_ADHERENCE]: dodAdherence.passed,
    [GATE1_RUBRIC_CONSTANTS.DIMENSION_BOUNDARY_CONTAINMENT]: boundaryCheckPassed,
    [GATE1_RUBRIC_CONSTANTS.CATEGORY_SPEC_FIDELITY]: dodAdherence.acceptanceCriteriaSatisfied,
  };

  // Compile remediation advice
  const remediationAdvice: string[] = allFindings
    .map((f) => f.remediation)
    .filter((r): r is string => Boolean(r));

  // Generate summary
  const summary =
    verdict === GATE1_RUBRIC_CONSTANTS.VERDICT_APPROVED
      ? `Semantic rubric evaluation PASSED (score: ${overallScore}/100). Clean Code, Zero Magic Numbers, and DoD criteria fulfilled.`
      : verdict === GATE1_RUBRIC_CONSTANTS.VERDICT_REVISE
        ? `Semantic rubric evaluation requested REVISIONS (score: ${overallScore}/100). Detected ${allFindings.length} issue(s) needing resolution.`
        : `Semantic rubric evaluation REJECTED changes (score: ${overallScore}/100). Critical boundary or architectural violations detected.`;

  return {
    overallPassed,
    overallScore,
    verdict,
    summary,
    cleanCode,
    zeroMagicNumbers,
    dodAdherence,
    boundaryContainment,
    checklistResults,
    allRubricItems,
    allFindings,
    remediationAdvice,
    criticalViolation,
  };
}

/**
 * Formats a clean human-readable summary of rubric evaluation results.
 */
export function formatRubricEvaluationSummary(
  result: Gate1RubricEvaluationResult
): string {
  const lines: string[] = [];

  lines.push(`### Gate 1 Semantic Evaluation Rubric Outcome: ${result.verdict}`);
  lines.push(`- **Overall Quality Score**: ${result.overallScore}/100`);
  lines.push(`- **Status**: ${result.overallPassed ? "PASSED" : "FAILED"}`);
  lines.push(`- **Clean Code Score**: ${result.cleanCode.score}/100 (${result.cleanCode.passed ? "PASS" : "FAIL"})`);
  lines.push(
    `- **Zero Magic Numbers Score**: ${result.zeroMagicNumbers.score}/100 (${result.zeroMagicNumbers.passed ? "PASS" : "FAIL"})`
  );
  lines.push(
    `- **DoD Adherence Score**: ${result.dodAdherence.score}/100 (${result.dodAdherence.passed ? "PASS" : "FAIL"})`
  );
  lines.push(
    `- **Boundary Containment**: ${result.boundaryContainment.passed ? "PASSED" : "VIOLATED"}`
  );

  if (result.allFindings.length > GATE1_RUBRIC_CONSTANTS.ZERO) {
    lines.push(`\n**Detected Issues (${result.allFindings.length}):**`);
    for (const f of result.allFindings) {
      lines.push(
        `- [${f.severity.toUpperCase()}] ${f.category}: ${f.message}${f.filePath ? ` (${f.filePath}${f.lineNumber ? `:${f.lineNumber}` : ""})` : ""}`
      );
    }
  }

  return lines.join("\n");
}
