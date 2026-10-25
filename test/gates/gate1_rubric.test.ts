/**
 * Unit Test Suite for Gate 1: Semantic Evaluation Rubric Engine.
 *
 * Validates the semantic evaluation rubric checking Clean Code, Zero Magic Numbers,
 * and DoD adherence implemented in `src/gates/gate1_rubric.ts` and integrated into
 * `src/gates/gate1_review.ts`, in accordance with OpenSpec change
 * `looper-gate1-semantic-review` Task 1.2 and `projects/agnostic_looper/SPECIFICATION.md`.
 */

import { describe, expect, it } from "bun:test";
import {
  GATE1_RUBRIC_CONSTANTS,
  evaluateCleanCodeRubric,
  evaluateDoDAdherenceRubric,
  evaluateSemanticRubric,
  evaluateZeroMagicNumbersRubric,
  formatRubricEvaluationSummary,
  scanDiffForCleanCode,
  scanDiffForMagicNumbers,
} from "../../src/gates/gate1_rubric";
import {
  Gate1Reviewer,
  createGate1Reviewer,
} from "../../src/gates/gate1_review";

describe("Gate 1: Semantic Evaluation Rubric (Task 1.2)", () => {
  describe("GATE1_RUBRIC_CONSTANTS", () => {
    it("exposes canonical dimension identifiers", () => {
      expect(GATE1_RUBRIC_CONSTANTS.DIMENSION_CLEAN_CODE).toBe("clean_code");
      expect(GATE1_RUBRIC_CONSTANTS.DIMENSION_ZERO_MAGIC_NUMBERS).toBe("zero_magic_numbers");
      expect(GATE1_RUBRIC_CONSTANTS.DIMENSION_DOD_ADHERENCE).toBe("dod_adherence");
      expect(GATE1_RUBRIC_CONSTANTS.DIMENSION_BOUNDARY_CONTAINMENT).toBe("boundary_containment");
      expect(GATE1_RUBRIC_CONSTANTS.DIMENSION_REGRESSION_RISK).toBe("regression_risk");
    });

    it("defines standard review verdicts", () => {
      expect(GATE1_RUBRIC_CONSTANTS.VERDICT_APPROVED).toBe("APPROVED");
      expect(GATE1_RUBRIC_CONSTANTS.VERDICT_REVISE).toBe("REVISE");
      expect(GATE1_RUBRIC_CONSTANTS.VERDICT_REJECTED).toBe("REJECTED");
    });

    it("defines scoring scale and passing thresholds", () => {
      expect(GATE1_RUBRIC_CONSTANTS.SCORE_MIN).toBe(0);
      expect(GATE1_RUBRIC_CONSTANTS.SCORE_MAX).toBe(100);
      expect(GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_PASS).toBe(80);
      expect(GATE1_RUBRIC_CONSTANTS.SCORE_THRESHOLD_REVISE).toBe(60);
      expect(GATE1_RUBRIC_CONSTANTS.SCORE_CRITICAL_CEILING).toBe(50);
    });

    it("defines default dimension weights summing to 100%", () => {
      const sum =
        GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_CLEAN_CODE +
        GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_ZERO_MAGIC_NUMBERS +
        GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_DOD_ADHERENCE +
        GATE1_RUBRIC_CONSTANTS.DEFAULT_WEIGHT_BOUNDARY_CONTAINMENT;
      expect(sum).toBe(GATE1_RUBRIC_CONSTANTS.TOTAL_WEIGHT_PERCENT);
    });

    it("defines allowed non-magic numbers", () => {
      expect(GATE1_RUBRIC_CONSTANTS.ALLOWED_NON_MAGIC_NUMBERS).toContain(-1);
      expect(GATE1_RUBRIC_CONSTANTS.ALLOWED_NON_MAGIC_NUMBERS).toContain(0);
      expect(GATE1_RUBRIC_CONSTANTS.ALLOWED_NON_MAGIC_NUMBERS).toContain(1);
      expect(GATE1_RUBRIC_CONSTANTS.ALLOWED_NON_MAGIC_NUMBERS).toContain(2);
    });
  });

  describe("Pillar 1: Clean Code Rubric", () => {
    it("detects explicit 'any' type leak as an error", () => {
      const diff = `
diff --git a/src/service.ts b/src/service.ts
--- a/src/service.ts
+++ b/src/service.ts
@@ -10,3 +10,4 @@
 export function compute(input: string): string {
+  const rawData: any = JSON.parse(input);
   return rawData.id;
 }
`;
      const findings = scanDiffForCleanCode(diff);
      expect(findings.length).toBeGreaterThan(0);
      const anyFinding = findings.find(
        (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_STRICT_TYPING
      );
      expect(anyFinding).toBeDefined();
      expect(anyFinding?.severity).toBe(GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR);
      expect(anyFinding?.filePath).toBe("src/service.ts");
      expect(anyFinding?.lineCitation).toContain("rawData: any");
      expect(anyFinding?.remediation).toContain("Replace 'any'");
    });

    it("detects unhandled promise rejection (.then without .catch) as an error", () => {
      const diff = `
diff --git a/src/client.ts b/src/client.ts
--- a/src/client.ts
+++ b/src/client.ts
@@ -20,2 +20,3 @@
 export function notify(): void {
+  fetch("/api/event").then((res) => res.json());
 }
`;
      const findings = scanDiffForCleanCode(diff);
      const asyncFinding = findings.find(
        (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS
      );
      expect(asyncFinding).toBeDefined();
      expect(asyncFinding?.severity).toBe(GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR);
      expect(asyncFinding?.lineCitation).toContain(".then((res)");
      expect(asyncFinding?.remediation).toContain(".catch()");
    });

    it("detects empty catch blocks silently swallowing errors", () => {
      const diff = `
diff --git a/src/worker.ts b/src/worker.ts
--- a/src/worker.ts
+++ b/src/worker.ts
@@ -5,3 +5,6 @@
 export function run(): void {
+  try {
+    doWork();
+  } catch (err) {}
 }
`;
      const findings = scanDiffForCleanCode(diff);
      const emptyCatchFinding = findings.find(
        (f) =>
          f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY &&
          f.message.includes("Empty catch block")
      );
      expect(emptyCatchFinding).toBeDefined();
      expect(emptyCatchFinding?.severity).toBe(GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR);
    });

    it("detects throwing raw string literals instead of Error instances", () => {
      const diff = `
diff --git a/src/handler.ts b/src/handler.ts
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -12,2 +12,3 @@
 export function validate(val: boolean): void {
+  if (!val) throw "Validation failed!";
 }
`;
      const findings = scanDiffForCleanCode(diff);
      const throwFinding = findings.find(
        (f) =>
          f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY &&
          f.message.includes("raw string literal")
      );
      expect(throwFinding).toBeDefined();
      expect(throwFinding?.severity).toBe(GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR);
    });

    it("detects leftover debugger statements", () => {
      const diff = `
diff --git a/src/parser.ts b/src/parser.ts
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -30,2 +30,3 @@
 export function parseLine(line: string): void {
+  debugger;
 }
`;
      const findings = scanDiffForCleanCode(diff);
      const debugFinding = findings.find(
        (f) =>
          f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CODE_QUALITY &&
          f.message.includes("debugger")
      );
      expect(debugFinding).toBeDefined();
      expect(debugFinding?.severity).toBe(GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR);
    });

    it("detects hardcoded path string concatenations as cross-platform warnings", () => {
      const diff = `
diff --git a/src/storage.ts b/src/storage.ts
--- a/src/storage.ts
+++ b/src/storage.ts
@@ -15,2 +15,3 @@
 export function getFilePath(baseDir: string, file: string): string {
+  const fullPath = baseDir + "/" + file;
   return fullPath;
 }
`;
      const findings = scanDiffForCleanCode(diff);
      const pathFinding = findings.find(
        (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_CROSS_PLATFORM
      );
      expect(pathFinding).toBeDefined();
      expect(pathFinding?.severity).toBe(GATE1_RUBRIC_CONSTANTS.SEVERITY_WARNING);
    });

    it("evaluates clean code rubric with score 100 when diff is clean", () => {
      const diff = `
diff --git a/src/clean.ts b/src/clean.ts
--- a/src/clean.ts
+++ b/src/clean.ts
@@ -1,3 +1,5 @@
+import { join } from "node:path";
 export function resolvePath(dir: string, file: string): string {
+  return join(dir, file);
 }
`;
      const result = evaluateCleanCodeRubric(diff);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.strictTypingPassed).toBe(true);
      expect(result.unhandledRejectionsPassed).toBe(true);
      expect(result.errorHandlingPassed).toBe(true);
      expect(result.findings.length).toBe(0);
    });
  });

  describe("Pillar 2: Zero Magic Numbers Rubric", () => {
    it("flags hardcoded timeout numbers in function calls", () => {
      const diff = `
diff --git a/src/timer.ts b/src/timer.ts
--- a/src/timer.ts
+++ b/src/timer.ts
@@ -8,2 +8,3 @@
 export function startWatchdog(): void {
+  setTimeout(() => {}, 5000);
 }
`;
      const scan = scanDiffForMagicNumbers(diff);
      expect(scan.findings.length).toBe(1);
      const finding = scan.findings[0];
      expect(finding).toBeDefined();
      if (!finding) return;
      expect(finding.category).toBe(GATE1_RUBRIC_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS);
      expect(finding.severity).toBe(GATE1_RUBRIC_CONSTANTS.SEVERITY_ERROR);
      expect(finding.message).toContain("5000");
      expect(finding.lineCitation).toContain("5000");
      expect(scan.affectedFiles).toContain("src/timer.ts");
    });

    it("flags hardcoded retry counters or comparison literals in logic", () => {
      const diff = `
diff --git a/src/retry.ts b/src/retry.ts
--- a/src/retry.ts
+++ b/src/retry.ts
@@ -14,2 +14,3 @@
 export function checkAttempts(attempts: number): boolean {
+  return attempts >= 5;
 }
`;
      const scan = scanDiffForMagicNumbers(diff);
      expect(scan.findings.length).toBe(1);
      const firstFinding = scan.findings[0];
      expect(firstFinding).toBeDefined();
      expect(firstFinding?.message).toContain("5");
    });

    it("does NOT flag constant definitions (UPPER_CASE assignments)", () => {
      const diff = `
diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,2 +1,5 @@
+export const DEFAULT_TIMEOUT_MS = 5000;
+export const MAX_RETRY_COUNT = 3;
+export const PORT: number = 8080;
`;
      const scan = scanDiffForMagicNumbers(diff);
      expect(scan.findings.length).toBe(0);
      expect(scan.allowedCount).toBeGreaterThanOrEqual(1);
    });

    it("does NOT flag allowed non-magic numbers: -1, 0, 1, 2", () => {
      const diff = `
diff --git a/src/counter.ts b/src/counter.ts
--- a/src/counter.ts
+++ b/src/counter.ts
@@ -1,4 +1,7 @@
 export function increment(val: number): number {
+  if (val === -1) return 0;
+  if (val === 0) return 1;
+  if (val === 1) return 2;
   return val + 1;
 }
`;
      const scan = scanDiffForMagicNumbers(diff);
      expect(scan.findings.length).toBe(0);
    });

    it("does NOT flag array index access or slice offsets", () => {
      const diff = `
diff --git a/src/indexer.ts b/src/indexer.ts
--- a/src/indexer.ts
+++ b/src/indexer.ts
@@ -1,2 +1,4 @@
 export function getThirdItem(items: string[]): string | undefined {
+  return items[3];
 }
`;
      const scan = scanDiffForMagicNumbers(diff);
      expect(scan.findings.length).toBe(0);
    });

    it("does NOT flag numbers inside string literals or URLs", () => {
      const diff = `
diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,2 +1,4 @@
 export function getEndpoint(): string {
+  return "http://localhost:8080/v2/items";
 }
`;
      const scan = scanDiffForMagicNumbers(diff);
      expect(scan.findings.length).toBe(0);
    });

    it("computes rubric score deductions when magic numbers are detected", () => {
      const diff = `
diff --git a/src/defect.ts b/src/defect.ts
--- a/src/defect.ts
+++ b/src/defect.ts
@@ -1,2 +1,4 @@
 export function delay(): void {
+  const d = 3000;
 }
`;
      const result = evaluateZeroMagicNumbersRubric(diff);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(85); // 100 - 15 deduction
      expect(result.magicNumberCount).toBe(1);
    });
  });

  describe("Pillar 3: Definition of Done (DoD) & Acceptance Criteria Rubric", () => {
    it("flags DoD violation when production src/ files are modified without test/ files", () => {
      const diff = `
diff --git a/src/feature.ts b/src/feature.ts
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1,2 +1,4 @@
+export function newFeature(): string {
+  return "feature";
+}
`;
      const result = evaluateDoDAdherenceRubric({ diff });
      expect(result.unitTestsAccompanied).toBe(false);
      expect(result.passed).toBe(false);
      const testViolation = result.findings.find(
        (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_DOD_ADHERENCE
      );
      expect(testViolation).toBeDefined();
      expect(testViolation?.message).toContain("production source file(s) modified in src/ without accompanying unit tests");
    });

    it("passes unit test accompaniment when test/ files are included in diff", () => {
      const diff = `
diff --git a/src/feature.ts b/src/feature.ts
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1,2 +1,4 @@
+export function newFeature(): string { return "feature"; }
diff --git a/test/feature.test.ts b/test/feature.test.ts
--- a/test/feature.test.ts
+++ b/test/feature.test.ts
@@ -1,2 +1,4 @@
+import { it, expect } from "bun:test";
+it("works", () => expect(true).toBe(true));
`;
      const result = evaluateDoDAdherenceRubric({ diff });
      expect(result.unitTestsAccompanied).toBe(true);
      expect(result.passed).toBe(true);
    });

    it("flags DoD violation when test suites contain skipped or exclusive tests", () => {
      const diff = `
diff --git a/test/sample.test.ts b/test/sample.test.ts
--- a/test/sample.test.ts
+++ b/test/sample.test.ts
@@ -1,2 +1,4 @@
+it.skip("temporarily disabled test", () => {
+});
`;
      const result = evaluateDoDAdherenceRubric({ diff });
      expect(result.testSuiteClean).toBe(false);
      const skipFinding = result.findings.find(
        (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_DOD_ADHERENCE
      );
      expect(skipFinding).toBeDefined();
      expect(skipFinding?.message).toContain("Disabled or skipped test detected");
    });

    it("flags fatal DoD violation when boundary containment is violated", () => {
      const diff = "";
      const boundaryCheck = {
        passed: false,
        authorizedFiles: ["src/allowed.ts"],
        modifiedFiles: ["src/allowed.ts", "package.json"],
        unauthorizedFiles: ["package.json"],
        details: "Unauthorized files modified",
      };
      const result = evaluateDoDAdherenceRubric({ diff, boundaryCheck });
      expect(result.boundaryContained).toBe(false);
      expect(result.passed).toBe(false);
      const fatalFinding = result.findings.find(
        (f) => f.severity === GATE1_RUBRIC_CONSTANTS.SEVERITY_FATAL
      );
      expect(fatalFinding).toBeDefined();
    });

    it("evaluates task acceptance criteria fulfillment", () => {
      const diff = `
diff --git a/src/calculator.ts b/src/calculator.ts
--- a/src/calculator.ts
+++ b/src/calculator.ts
@@ -1,2 +1,4 @@
+export function calculateRubricScore(points: number[]): number {
+  return 0;
+}
`;
      const result = evaluateDoDAdherenceRubric({
        diff,
        acceptanceCriteria: [
          "calculateRubricScore function computes total score",
          "Unrelated missing feature that is nowhere in diff",
        ],
      });
      expect(result.acceptanceCriteriaSatisfied).toBe(false);
      const acStatuses = result.dodItemStatuses.filter((s) => s.id.startsWith("ac-"));
      expect(acStatuses.length).toBe(2);
      expect(acStatuses[0]?.passed).toBe(true);
      expect(acStatuses[1]?.passed).toBe(false);
    });
  });

  describe("Comprehensive Semantic Rubric Engine (evaluateSemanticRubric)", () => {
    it("returns APPROVED with score 100 when all rubrics are perfectly satisfied", () => {
      const diff = `
diff --git a/src/calc.ts b/src/calc.ts
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,2 +1,5 @@
+export function add(a: number, b: number): number {
+  return a + b;
+}
diff --git a/test/calc.test.ts b/test/calc.test.ts
--- a/test/calc.test.ts
+++ b/test/calc.test.ts
@@ -1,2 +1,5 @@
+import { it, expect } from "bun:test";
+import { add } from "../src/calc";
+it("adds", () => expect(add(1, 2)).toBe(3));
`;
      const result = evaluateSemanticRubric({
        diff,
        acceptanceCriteria: ["Implement add function in calc"],
      });

      expect(result.overallPassed).toBe(true);
      expect(result.verdict).toBe(GATE1_RUBRIC_CONSTANTS.VERDICT_APPROVED);
      expect(result.overallScore).toBe(100);
      expect(result.cleanCode.passed).toBe(true);
      expect(result.zeroMagicNumbers.passed).toBe(true);
      expect(result.dodAdherence.passed).toBe(true);
      expect(result.criticalViolation).toBe(false);
      expect(result.allFindings.length).toBe(0);
    });

    it("returns REVISE with specific citations when magic numbers and strict typing leaks exist", () => {
      const diff = `
diff --git a/src/worker.ts b/src/worker.ts
--- a/src/worker.ts
+++ b/src/worker.ts
@@ -1,2 +1,5 @@
+export function process(val: any): void {
+  setTimeout(() => {}, 4000);
+}
diff --git a/test/worker.test.ts b/test/worker.test.ts
--- a/test/worker.test.ts
+++ b/test/worker.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;
      const result = evaluateSemanticRubric({ diff });

      expect(result.overallPassed).toBe(false);
      expect(result.verdict).toBe(GATE1_RUBRIC_CONSTANTS.VERDICT_REVISE);
      expect(result.overallScore).toBeLessThan(80);
      expect(result.allFindings.length).toBeGreaterThanOrEqual(2);

      // Verify specific line citations are populated
      const typingFinding = result.allFindings.find(
        (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_STRICT_TYPING
      );
      expect(typingFinding?.lineCitation).toContain("val: any");

      const magicFinding = result.allFindings.find(
        (f) => f.category === GATE1_RUBRIC_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS
      );
      expect(magicFinding?.lineCitation).toContain("4000");
    });

    it("returns REJECTED and criticalViolation when boundary containment fails", () => {
      const diff = `
diff --git a/src/unauthorized.ts b/src/unauthorized.ts
--- a/src/unauthorized.ts
+++ b/src/unauthorized.ts
@@ -1,2 +1,3 @@
+export const x = 1;
`;
      const boundaryCheck = {
        passed: false,
        authorizedFiles: ["src/allowed.ts"],
        modifiedFiles: ["src/unauthorized.ts"],
        unauthorizedFiles: ["src/unauthorized.ts"],
        details: "Boundary containment violated",
      };

      const result = evaluateSemanticRubric({ diff, boundaryCheck });
      expect(result.overallPassed).toBe(false);
      expect(result.verdict).toBe(GATE1_RUBRIC_CONSTANTS.VERDICT_REJECTED);
      expect(result.criticalViolation).toBe(true);
      expect(result.overallScore).toBeLessThanOrEqual(50);
    });

    it("formats human-readable summary of rubric results", () => {
      const diff = `
diff --git a/src/clean.ts b/src/clean.ts
--- a/src/clean.ts
+++ b/src/clean.ts
@@ -1,2 +1,4 @@
+export const CONST_VAL = 100;
`;
      const result = evaluateSemanticRubric({ diff });
      const summary = formatRubricEvaluationSummary(result);
      expect(summary).toContain("Gate 1 Semantic Evaluation Rubric Outcome");
      expect(summary).toContain("Overall Quality Score");
      expect(summary).toContain("Clean Code Score");
      expect(summary).toContain("Zero Magic Numbers Score");
      expect(summary).toContain("DoD Adherence Score");
    });
  });

  describe("Integration with Gate1Reviewer Subagent Orchestrator", () => {
    it("Gate1Reviewer.evaluateDiff uses rubric engine and reflects verdicts", () => {
      const reviewer = createGate1Reviewer({
        taskId: "TASK-TEST-RUBRIC",
        acceptanceCriteria: ["Implement isValid function"],
      });

      const cleanDiff = `
diff --git a/src/valid.ts b/src/valid.ts
--- a/src/valid.ts
+++ b/src/valid.ts
@@ -1,2 +1,4 @@
+export function isValid(): boolean {
+  return true;
+}
diff --git a/test/valid.test.ts b/test/valid.test.ts
--- a/test/valid.test.ts
+++ b/test/valid.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;
      const boundaryCheck = {
        passed: true,
        authorizedFiles: ["src/valid.ts", "test/valid.test.ts"],
        modifiedFiles: ["src/valid.ts", "test/valid.test.ts"],
        unauthorizedFiles: [],
        details: "Clean boundaries",
      };

      const report = reviewer.evaluateDiff(cleanDiff, boundaryCheck);
      expect(report.verdict).toBe("APPROVED");
      expect(report.score).toBe(100);
      expect(report.rubricChecks.length).toBeGreaterThan(0);
      expect(report.checklistResults.clean_code).toBe(true);
      expect(report.checklistResults.zero_magic_numbers).toBe(true);
      expect(report.checklistResults.dod_adherence).toBe(true);
    });

    it("Gate1Reviewer issues REVISE verdict when diff contains unhandled promise rejections", () => {
      const reviewer = new Gate1Reviewer({
        taskId: "TASK-TEST-ASYNC",
      });

      const badDiff = `
diff --git a/src/async_bad.ts b/src/async_bad.ts
--- a/src/async_bad.ts
+++ b/src/async_bad.ts
@@ -1,2 +1,4 @@
+export function doAsync(): void {
+  fetch("/api").then((r) => r.text());
+}
diff --git a/test/async.test.ts b/test/async.test.ts
--- a/test/async.test.ts
+++ b/test/async.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;
      const boundaryCheck = {
        passed: true,
        authorizedFiles: ["src/async_bad.ts", "test/async.test.ts"],
        modifiedFiles: ["src/async_bad.ts", "test/async.test.ts"],
        unauthorizedFiles: [],
        details: "Clean boundaries",
      };

      const report = reviewer.evaluateDiff(badDiff, boundaryCheck);
      expect(report.verdict).toBe("REVISE");
      expect(report.score).toBeLessThan(100);
      const asyncFinding = report.findings.find(
        (f) => f.category === "unhandled_rejections"
      );
      expect(asyncFinding).toBeDefined();
      expect(asyncFinding?.lineCitation).toContain(".then((r)");
    });
  });
});
