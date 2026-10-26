/**
 * Unit Test Suite for Gate 1: Independent Semantic Code Reviewer Subagent.
 *
 * Validates the orchestrator, diff parser, boundary containment enforcer,
 * semantic rubric integrator, and structured feedback mechanisms implemented in
 * `src/gates/gate1_review.ts` in accordance with OpenSpec change
 * `looper-gate1-semantic-review` Task 1.4 and `projects/agnostic_looper/SPECIFICATION.md`
 * Section 3.1 & Section 3.3 (LOOPER-GATE-002).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import {
  GATE1_CONSTANTS,
  Gate1DiffExtractionError,
  Gate1ReviewError,
  Gate1Reviewer,
  Gate1SubagentDispatchError,
  Gate1TimeoutError,
  createGate1Reviewer,
  defaultGitDiffRunner,
  formatReviewReportMarkdown,
  formatReviewerPrompt,
  parseGitDiffFiles,
  parseGitDiffStats,
  resolveGate1RecommendedEvent,
  runGate1Review,
  scanDiffForSemanticIssues,
  verifyBoundaryContainment,
  type Gate1BoundaryCheckResult,
  type Gate1ExecutionContext,
  type Gate1ReviewReport,
  type Gate1ReviewResult,
  type Gate1ReviewerOptions,
} from "../../src/gates/gate1_review";
import { LOOPER_EVENTS, LOOPER_STATES } from "../../src/core/fsm_types";
import { createSubagentDispatcher } from "../../src/core/dispatcher";
import {
  COGNITIVE_ROLES,
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ROLES,
  createPalMessage,
  createTextBlock,
  type IPalProvider,
  type PalOutcome,
  type PalSessionOptions,
} from "../../src/pal/types";

/**
 * Central test constants ensuring zero magic numbers across Gate 1 test suite.
 */
const TEST_CONSTANTS = {
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  TEN: 10,
  FAST_DURATION_MS: 15,
  SHORT_TIMEOUT_MS: 50,
  MOCK_TIMEOUT_MS: 100,
  MOCK_FAILING_TIMEOUT_MS: 1,
  LONG_TIMEOUT_MS: 300_000,
  GIT_TIMEOUT_MS: 30_000,
  ATTEMPT_INITIAL: 1,
  ATTEMPT_RETRY: 2,
  ATTEMPT_MAX: 3,
  ATTEMPT_EXHAUSTED: 3,
  ATTEMPT_OVER_MAX: 4,
  SCORE_PERFECT: 100,
  SCORE_PASSING: 80,
  SCORE_REVISE_DEFAULT: 60,
  SCORE_REJECT_DEFAULT: 20,
  SCORE_CUSTOM: 88,
  SCORE_THRESHOLD_PASS: 80,
  SCORE_MIN: 0,
  EXIT_SUCCESS: 0,
  EXIT_FAILURE: 1,
  EXIT_ERROR: 2,
  LINE_NUMBER_MAGIC: 42,
  LINE_NUMBER_UNHANDLED: 20,
  DIFF_TRUNCATE_TARGET_COUNT: 5005,
  EXPECTED_INSERTIONS_TWO: 2,
  EXPECTED_DELETIONS_ONE: 1,
  EXPECTED_FILES_ONE: 1,
  EXPECTED_FILES_TWO: 2,
  EXPECTED_FILES_THREE: 3,
  INDEX_FIRST: 0,
  INDEX_SECOND: 1,
  TOKEN_USAGE_PROMPT: 150,
  TOKEN_USAGE_COMPLETION: 50,
  TOKEN_USAGE_TOTAL: 200,
  RANDOM_SLICE_START: 2,
  MAX_CONTEXT_TOKENS: 200_000,
  MAX_OUTPUT_TOKENS: 8_192,
  RATE_LIMIT_REQUESTS: 100,
  RATE_LIMIT_TOKENS: 100_000,
  RATE_LIMIT_RESET_OFFSET_MS: 60_000,
} as const;

describe("Gate 1: Independent Semantic Code Reviewer (Task 1.4)", () => {
  const tempDirsToClean: string[] = [];
  let currentTestWorkspace: string;

  beforeEach(async () => {
    currentTestWorkspace = await createTempWorkspace();
  });

  afterEach(async () => {
    while (tempDirsToClean.length > TEST_CONSTANTS.ZERO) {
      const dir = tempDirsToClean.pop();
      if (dir) {
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
    }
  });

  async function createTempWorkspace(): Promise<string> {
    const dir = join(
      tmpdir(),
      `gate1-test-${Date.now()}-${Math.random().toString(36).slice(TEST_CONSTANTS.RANDOM_SLICE_START)}`
    );
    await mkdir(dir, { recursive: true });
    tempDirsToClean.push(dir);
    return dir;
  }

  // ==========================================================================
  // 1. CONSTANTS INTEGRITY & ZERO MAGIC NUMBERS
  // ==========================================================================
  describe("GATE1_CONSTANTS", () => {
    it("exposes canonical review verdicts", () => {
      expect(GATE1_CONSTANTS.VERDICT_APPROVED).toBe("APPROVED");
      expect(GATE1_CONSTANTS.VERDICT_REVISE).toBe("REVISE");
      expect(GATE1_CONSTANTS.VERDICT_REJECTED).toBe("REJECTED");
    });

    it("exposes recommended FSM domain events", () => {
      expect(GATE1_CONSTANTS.EVENT_G1_PASS).toBe(LOOPER_EVENTS.EVT_G1_PASS);
      expect(GATE1_CONSTANTS.EVENT_G1_REVISE).toBe(LOOPER_EVENTS.EVT_G1_REVISE);
      expect(GATE1_CONSTANTS.EVENT_G1_REJECT).toBe(LOOPER_EVENTS.EVT_G1_REJECT);
    });

    it("exposes associated FSM states", () => {
      expect(GATE1_CONSTANTS.STATE_GATE_1_REVIEW).toBe(LOOPER_STATES.STATE_GATE_1_REVIEW);
      expect(GATE1_CONSTANTS.STATE_GATE_2_CHALLENGE).toBe(LOOPER_STATES.STATE_GATE_2_CHALLENGE);
      expect(GATE1_CONSTANTS.STATE_EXECUTE_WORKER).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);
      expect(GATE1_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);
    });

    it("defines default attempt budgets, timeouts, and diff limits", () => {
      expect(GATE1_CONSTANTS.DEFAULT_ATTEMPT).toBe(1);
      expect(GATE1_CONSTANTS.DEFAULT_MAX_ATTEMPTS).toBe(3);
      expect(GATE1_CONSTANTS.DEFAULT_TIMEOUT_MS).toBe(300_000);
      expect(GATE1_CONSTANTS.DEFAULT_GIT_TIMEOUT_MS).toBe(30_000);
      expect(GATE1_CONSTANTS.DEFAULT_MAX_DIFF_BYTES).toBe(500_000);
      expect(GATE1_CONSTANTS.DEFAULT_MAX_DIFF_LINES).toBe(5_000);
      expect(GATE1_CONSTANTS.DEFAULT_MAX_FINDINGS).toBe(50);
    });

    it("defines score scales, passing threshold, and default score values", () => {
      expect(GATE1_CONSTANTS.SCORE_MIN).toBe(0);
      expect(GATE1_CONSTANTS.SCORE_MAX).toBe(100);
      expect(GATE1_CONSTANTS.SCORE_THRESHOLD_PASS).toBe(80);
      expect(GATE1_CONSTANTS.SCORE_DEFAULT_APPROVED).toBe(100);
      expect(GATE1_CONSTANTS.SCORE_DEFAULT_REVISE).toBe(60);
      expect(GATE1_CONSTANTS.SCORE_DEFAULT_REJECTED).toBe(20);
    });

    it("defines cognitive role, archetype, and default model", () => {
      expect(GATE1_CONSTANTS.ROLE_REVIEWER).toBe(COGNITIVE_ROLES.REVIEWER);
      expect(GATE1_CONSTANTS.ARCHETYPE_REVIEWER).toBe("Reviewer");
      expect(GATE1_CONSTANTS.DEFAULT_PROVIDER).toBe("claude");
      expect(GATE1_CONSTANTS.DEFAULT_MODEL).toBe("claude-3-7-sonnet-20250219");
    });

    it("defines check categories and severities", () => {
      expect(GATE1_CONSTANTS.CATEGORY_SPEC_FIDELITY).toBe("specification_fidelity");
      expect(GATE1_CONSTANTS.CATEGORY_BOUNDARY_CONTAINMENT).toBe("boundary_containment");
      expect(GATE1_CONSTANTS.CATEGORY_REGRESSION_RISK).toBe("regression_risk");
      expect(GATE1_CONSTANTS.CATEGORY_CODE_QUALITY).toBe("code_quality");
      expect(GATE1_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS).toBe("zero_magic_numbers");
      expect(GATE1_CONSTANTS.CATEGORY_STRICT_TYPING).toBe("strict_typing");
      expect(GATE1_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS).toBe("unhandled_rejections");
      expect(GATE1_CONSTANTS.CATEGORY_CROSS_PLATFORM).toBe("cross_platform");
      expect(GATE1_CONSTANTS.CATEGORY_DOD_ADHERENCE).toBe("dod_adherence");

      expect(GATE1_CONSTANTS.SEVERITY_FATAL).toBe("fatal");
      expect(GATE1_CONSTANTS.SEVERITY_ERROR).toBe("error");
      expect(GATE1_CONSTANTS.SEVERITY_WARNING).toBe("warning");
      expect(GATE1_CONSTANTS.SEVERITY_INFO).toBe("info");
    });

    it("defines sandbox filenames and directories", () => {
      expect(GATE1_CONSTANTS.REPORT_FILENAME).toBe("review_report.md");
      expect(GATE1_CONSTANTS.FINDINGS_JSON_FILENAME).toBe("review_findings.json");
      expect(GATE1_CONSTANTS.FEEDBACK_XML_FILENAME).toBe("review_feedback.xml");
      expect(GATE1_CONSTANTS.DEFAULT_TEAMWORK_DIR).toBe(".agents/teamwork");
    });

    it("defines event emitter lifecycle event names", () => {
      expect(GATE1_CONSTANTS.EVENT_REVIEW_START).toBe("review:start");
      expect(GATE1_CONSTANTS.EVENT_SUBAGENT_DISPATCHED).toBe("review:subagent_dispatched");
      expect(GATE1_CONSTANTS.EVENT_DIFF_EXTRACTED).toBe("review:diff_extracted");
      expect(GATE1_CONSTANTS.EVENT_VERDICT_RESOLVED).toBe("review:verdict_resolved");
      expect(GATE1_CONSTANTS.EVENT_REVIEW_COMPLETE).toBe("review:complete");
      expect(GATE1_CONSTANTS.EVENT_REVIEW_ERROR).toBe("review:error");
    });
  });

  // ==========================================================================
  // 2. ERROR CLASSES
  // ==========================================================================
  describe("Custom Error Classes", () => {
    it("instantiates Gate1ReviewError with message, code, and details", () => {
      const error = new Gate1ReviewError("Review failed", "ERR_CODE", { foo: "bar" });
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("Gate1ReviewError");
      expect(error.message).toBe("Review failed");
      expect(error.code).toBe("ERR_CODE");
      expect(error.details).toEqual({ foo: "bar" });
    });

    it("instantiates Gate1TimeoutError with timeoutMs and default or custom message", () => {
      const defaultTimeoutError = new Gate1TimeoutError(TEST_CONSTANTS.SHORT_TIMEOUT_MS);
      expect(defaultTimeoutError).toBeInstanceOf(Gate1ReviewError);
      expect(defaultTimeoutError.name).toBe("Gate1TimeoutError");
      expect(defaultTimeoutError.code).toBe("GATE1_TIMEOUT_EXCEEDED");
      expect(defaultTimeoutError.timeoutMs).toBe(TEST_CONSTANTS.SHORT_TIMEOUT_MS);
      expect(defaultTimeoutError.message).toContain("50ms");

      const customTimeoutError = new Gate1TimeoutError(
        TEST_CONSTANTS.MOCK_TIMEOUT_MS,
        "Custom timeout occurred"
      );
      expect(customTimeoutError.message).toBe("Custom timeout occurred");
      expect(customTimeoutError.timeoutMs).toBe(TEST_CONSTANTS.MOCK_TIMEOUT_MS);
    });

    it("instantiates Gate1SubagentDispatchError with code and details", () => {
      const error = new Gate1SubagentDispatchError("Dispatch failed", { agentId: "sub-123" });
      expect(error).toBeInstanceOf(Gate1ReviewError);
      expect(error.name).toBe("Gate1SubagentDispatchError");
      expect(error.code).toBe("GATE1_SUBAGENT_DISPATCH_FAILED");
      expect(error.details).toEqual({ agentId: "sub-123" });
    });

    it("instantiates Gate1DiffExtractionError with code and details", () => {
      const error = new Gate1DiffExtractionError("Diff extraction failed", { exitCode: 1 });
      expect(error).toBeInstanceOf(Gate1ReviewError);
      expect(error.name).toBe("Gate1DiffExtractionError");
      expect(error.code).toBe("GATE1_DIFF_EXTRACTION_FAILED");
      expect(error.details).toEqual({ exitCode: 1 });
    });
  });

  // ==========================================================================
  // 3. GIT DIFF PARSERS (parseGitDiffFiles & parseGitDiffStats)
  // ==========================================================================
  describe("Git Diff Parsers", () => {
    const sampleDiff = `
diff --git a/src/core/runner.ts b/src/core/runner.ts
--- a/src/core/runner.ts
+++ b/src/core/runner.ts
@@ -10,3 +10,4 @@
 export function run(): void {
+  console.log("starting");
 }
diff --git a/test/core/runner.test.ts b/test/core/runner.test.ts
--- a/test/core/runner.test.ts
+++ b/test/core/runner.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
diff --git a/src/old.ts b/src/old.ts
--- a/src/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const deprecated = true;
`;

    it("parseGitDiffFiles extracts modified, added, and deleted file paths", () => {
      const files = parseGitDiffFiles(sampleDiff);
      expect(files).toContain(normalize("src/core/runner.ts"));
      expect(files).toContain(normalize("test/core/runner.test.ts"));
      expect(files).toContain(normalize("src/old.ts"));
      expect(files).not.toContain("/dev/null");
      expect(files.length).toBe(TEST_CONSTANTS.EXPECTED_FILES_THREE);
    });

    it("parseGitDiffFiles handles empty or non-string input safely", () => {
      expect(parseGitDiffFiles("")).toEqual([]);
      expect(parseGitDiffFiles("   \n\n  ")).toEqual([]);
      expect(parseGitDiffFiles(null as unknown as string)).toEqual([]);
      expect(parseGitDiffFiles(undefined as unknown as string)).toEqual([]);
    });

    it("parseGitDiffStats computes accurate additions, deletions, and file count", () => {
      const stats = parseGitDiffStats(sampleDiff);
      expect(stats.filesChanged).toBe(TEST_CONSTANTS.EXPECTED_FILES_THREE);
      expect(stats.insertions).toBe(TEST_CONSTANTS.EXPECTED_INSERTIONS_TWO);
      expect(stats.deletions).toBe(TEST_CONSTANTS.EXPECTED_DELETIONS_ONE);
      expect(stats.fileList).toHaveLength(TEST_CONSTANTS.EXPECTED_FILES_THREE);
    });

    it("parseGitDiffStats returns zero counters for empty diff", () => {
      const stats = parseGitDiffStats("");
      expect(stats.filesChanged).toBe(TEST_CONSTANTS.ZERO);
      expect(stats.insertions).toBe(TEST_CONSTANTS.ZERO);
      expect(stats.deletions).toBe(TEST_CONSTANTS.ZERO);
      expect(stats.fileList).toEqual([]);
    });
  });

  // ==========================================================================
  // 4. BOUNDARY CONTAINMENT VERIFICATION
  // ==========================================================================
  describe("verifyBoundaryContainment", () => {
    it("passes unrestricted when no targetFiles whitelist is specified", () => {
      const result = verifyBoundaryContainment(["src/fileA.ts", "test/fileA.test.ts"]);
      expect(result.passed).toBe(true);
      expect(result.authorizedFiles).toEqual([]);
      expect(result.unauthorizedFiles).toEqual([]);
      expect(result.details).toContain("Boundary containment passed");
    });

    it("passes when all modified files are within targetFiles whitelist", () => {
      const modified = ["src/module.ts", "test/module.test.ts"];
      const targetFiles = ["./src/module.ts", "test/module.test.ts"];
      const result = verifyBoundaryContainment(modified, targetFiles);

      expect(result.passed).toBe(true);
      expect(result.unauthorizedFiles).toHaveLength(TEST_CONSTANTS.ZERO);
      expect(result.details).toContain("Boundary containment verified");
    });

    it("supports directory glob wildcard patterns (src/**)", () => {
      const modified = ["src/gates/gate1_review.ts", "src/core/fsm.ts"];
      const targetFiles = ["src/**"];
      const result = verifyBoundaryContainment(modified, targetFiles);

      expect(result.passed).toBe(true);
      expect(result.unauthorizedFiles).toHaveLength(TEST_CONSTANTS.ZERO);
    });

    it("supports single-level glob wildcard patterns (src/*)", () => {
      const modified = ["src/index.ts", "src/gates/gate1.ts"];
      const targetFiles = ["src/*"];
      const result = verifyBoundaryContainment(modified, targetFiles);

      expect(result.passed).toBe(false);
      expect(result.unauthorizedFiles).toContain(normalize("src/gates/gate1.ts"));
    });

    it("fails and enumerates unauthorized files when scope is violated", () => {
      const modified = ["src/allowed.ts", "package.json", "secret/key.pem"];
      const targetFiles = ["src/allowed.ts"];
      const result = verifyBoundaryContainment(modified, targetFiles);

      expect(result.passed).toBe(false);
      expect(result.unauthorizedFiles).toContain("package.json");
      expect(result.unauthorizedFiles).toContain(normalize("secret/key.pem"));
      expect(result.details).toContain("Boundary containment violated!");
    });
  });

  // ==========================================================================
  // 5. FSM DOMAIN EVENT RESOLUTION
  // ==========================================================================
  describe("resolveGate1RecommendedEvent", () => {
    it("resolves APPROVED verdict to EVT_G1_PASS", () => {
      const event = resolveGate1RecommendedEvent(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(event).toBe(LOOPER_EVENTS.EVT_G1_PASS);
    });

    it("resolves REVISE verdict to EVT_G1_REVISE when attempts remain and no severe violation", () => {
      const event = resolveGate1RecommendedEvent(
        GATE1_CONSTANTS.VERDICT_REVISE,
        TEST_CONSTANTS.ATTEMPT_INITIAL,
        TEST_CONSTANTS.ATTEMPT_MAX,
        false
      );
      expect(event).toBe(LOOPER_EVENTS.EVT_G1_REVISE);
    });

    it("escalates REVISE verdict to EVT_G1_REJECT when attempt budget is exhausted", () => {
      const event = resolveGate1RecommendedEvent(
        GATE1_CONSTANTS.VERDICT_REVISE,
        TEST_CONSTANTS.ATTEMPT_EXHAUSTED,
        TEST_CONSTANTS.ATTEMPT_MAX,
        false
      );
      expect(event).toBe(LOOPER_EVENTS.EVT_G1_REJECT);
    });

    it("escalates REVISE verdict to EVT_G1_REJECT when severe violation flag is set", () => {
      const event = resolveGate1RecommendedEvent(
        GATE1_CONSTANTS.VERDICT_REVISE,
        TEST_CONSTANTS.ATTEMPT_INITIAL,
        TEST_CONSTANTS.ATTEMPT_MAX,
        true
      );
      expect(event).toBe(LOOPER_EVENTS.EVT_G1_REJECT);
    });

    it("resolves REJECTED verdict directly to EVT_G1_REJECT", () => {
      const event = resolveGate1RecommendedEvent(GATE1_CONSTANTS.VERDICT_REJECTED);
      expect(event).toBe(LOOPER_EVENTS.EVT_G1_REJECT);
    });
  });

  // ==========================================================================
  // 6. SCANNING AND FORMATTERS
  // ==========================================================================
  describe("scanDiffForSemanticIssues & Formatters", () => {
    const dirtyDiff = `
diff --git a/src/worker.ts b/src/worker.ts
--- a/src/worker.ts
+++ b/src/worker.ts
@@ -10,3 +10,6 @@
 export function processJob(): void {
+  const rawData: any = {};
+  const delay = 5000;
+  fetch("/api/run").then((r) => r.json());
 }
`;

    it("scanDiffForSemanticIssues aggregates clean code and magic number findings", () => {
      const findings = scanDiffForSemanticIssues(dirtyDiff);
      expect(findings.length).toBeGreaterThan(TEST_CONSTANTS.ZERO);

      const hasMagic = findings.some(
        (f) => f.category === GATE1_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS
      );
      const hasStrictTyping = findings.some(
        (f) => f.category === GATE1_CONSTANTS.CATEGORY_STRICT_TYPING
      );
      const hasUnhandled = findings.some(
        (f) => f.category === GATE1_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS
      );

      expect(hasMagic).toBe(true);
      expect(hasStrictTyping).toBe(true);
      expect(hasUnhandled).toBe(true);
    });

    it("scanDiffForSemanticIssues handles empty diff safely", () => {
      expect(scanDiffForSemanticIssues("")).toEqual([]);
      expect(scanDiffForSemanticIssues(undefined as unknown as string)).toEqual([]);
    });

    it("formatReviewReportMarkdown formats report with metrics, checklist, findings, and advice", () => {
      const mockReport: Gate1ReviewReport = {
        verdict: GATE1_CONSTANTS.VERDICT_REVISE,
        score: TEST_CONSTANTS.SCORE_REVISE_DEFAULT,
        summary: "Semantic audit detected actionable defects.",
        checklistResults: {
          specification_fidelity: true,
          boundary_containment: true,
          regression_risk: true,
          code_quality: false,
        },
        rubricChecks: [],
        findings: [
          {
            id: "f-1",
            category: GATE1_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS,
            severity: GATE1_CONSTANTS.SEVERITY_ERROR,
            message: "Hardcoded numeric literal 5000 detected",
            filePath: "src/worker.ts",
            lineNumber: TEST_CONSTANTS.LINE_NUMBER_MAGIC,
            lineCitation: "const delay = 5000;",
            remediation: "Extract to configuration constant",
          },
        ],
        boundaryCheck: {
          passed: true,
          authorizedFiles: ["src/worker.ts"],
          modifiedFiles: ["src/worker.ts"],
          unauthorizedFiles: [],
          details: "Boundary containment verified.",
        },
        diffStats: {
          filesChanged: TEST_CONSTANTS.EXPECTED_FILES_ONE,
          insertions: TEST_CONSTANTS.EXPECTED_INSERTIONS_TWO,
          deletions: TEST_CONSTANTS.ZERO,
          fileList: ["src/worker.ts"],
        },
        remediationAdvice: ["Centralize magic numbers"],
      };

      const markdown = formatReviewReportMarkdown(mockReport, "TASK-1.4");
      expect(markdown).toContain("# Gate 1 Semantic Code Review Report");
      expect(markdown).toContain("**Task Identifier**: `TASK-1.4`");
      expect(markdown).toContain("**Verdict**: `REVISE`");
      expect(markdown).toContain("**Quality Score**: `60/100`");
      expect(markdown).toContain("## Diff Metrics");
      expect(markdown).toContain("Files Changed: 1");
      expect(markdown).toContain("## Boundary Containment");
      expect(markdown).toContain("Status: PASSED");
      expect(markdown).toContain("## Audit Checklist");
      expect(markdown).toContain("- [x] **specification_fidelity**");
      expect(markdown).toContain("- [ ] **code_quality**");
      expect(markdown).toContain("## Findings & Line Citations (1)");
      expect(markdown).toContain("`src/worker.ts:42`");
      expect(markdown).toContain("const delay = 5000;");
      expect(markdown).toContain("## Remediation Recommendations");
      expect(markdown).toContain("- Centralize magic numbers");
    });

    it("formatReviewReportMarkdown formats zero findings cleanly", () => {
      const cleanReport: Gate1ReviewReport = {
        verdict: GATE1_CONSTANTS.VERDICT_APPROVED,
        score: TEST_CONSTANTS.SCORE_PERFECT,
        summary: "Clean code adheres to all requirements.",
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
          details: "Boundary verified.",
        },
        diffStats: {
          filesChanged: TEST_CONSTANTS.ZERO,
          insertions: TEST_CONSTANTS.ZERO,
          deletions: TEST_CONSTANTS.ZERO,
          fileList: [],
        },
        remediationAdvice: [],
      };

      const markdown = formatReviewReportMarkdown(cleanReport);
      expect(markdown).toContain("Zero defects detected. Code strictly conforms");
    });

    it("formatReviewerPrompt constructs prompt with AC, authorized files, and diff", () => {
      const context: Gate1ExecutionContext = {
        taskId: "TASK-1.4",
        taskDescription: "Create unit test suite for Gate 1",
        acceptanceCriteria: ["All unit tests pass", "Zero magic numbers"],
        targetFiles: ["test/gates/gate1.test.ts"],
        gitDiff: "+// unit test code\n",
        diffStats: {
          filesChanged: TEST_CONSTANTS.EXPECTED_FILES_ONE,
          insertions: TEST_CONSTANTS.ONE,
          deletions: TEST_CONSTANTS.ZERO,
          fileList: ["test/gates/gate1.test.ts"],
        },
        boundaryCheck: {
          passed: true,
          authorizedFiles: ["test/gates/gate1.test.ts"],
          modifiedFiles: ["test/gates/gate1.test.ts"],
          unauthorizedFiles: [],
          details: "OK",
        },
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        options: {},
      };

      const prompt = formatReviewerPrompt(context);
      expect(prompt).toContain("You are conducting an independent Gate 1 Semantic Code Review for task: TASK-1.4.");
      expect(prompt).toContain("## Task Goal\nCreate unit test suite for Gate 1");
      expect(prompt).toContain("- [ ] All unit tests pass");
      expect(prompt).toContain("- [ ] Zero magic numbers");
      expect(prompt).toContain("## Authorized Target Scope\n- `test/gates/gate1.test.ts`");
      expect(prompt).toContain("```diff\n+// unit test code");
      expect(prompt).toContain('"verdict": "APPROVED" | "REVISE" | "REJECTED"');
    });

    it("formatReviewerPrompt handles empty diff and diff truncation beyond 5000 lines", () => {
      const emptyContext: Gate1ExecutionContext = {
        acceptanceCriteria: [],
        targetFiles: [],
        gitDiff: "",
        diffStats: { filesChanged: 0, insertions: 0, deletions: 0, fileList: [] },
        boundaryCheck: { passed: true, authorizedFiles: [], modifiedFiles: [], unauthorizedFiles: [], details: "" },
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        options: {},
      };
      const emptyPrompt = formatReviewerPrompt(emptyContext);
      expect(emptyPrompt).toContain("Empty diff - no file modifications detected");

      // Generate diff exceeding DEFAULT_MAX_DIFF_LINES (5,000 lines)
      const hugeDiff = Array.from(
        { length: TEST_CONSTANTS.DIFF_TRUNCATE_TARGET_COUNT },
        (_, i) => `+line ${i}`
      ).join("\n");

      const hugeContext: Gate1ExecutionContext = {
        ...emptyContext,
        gitDiff: hugeDiff,
      };

      const truncatedPrompt = formatReviewerPrompt(hugeContext);
      expect(truncatedPrompt).toContain("*(Diff truncated to 5000 lines)*");
    });
  });

  // ==========================================================================
  // 7. DEFAULT SUBPROCESS GIT RUNNER (defaultGitDiffRunner)
  // ==========================================================================
  describe("defaultGitDiffRunner", () => {
    it("executes a valid command and captures stdout with exit code 0", async () => {
      const result = await defaultGitDiffRunner(["git", "--version"], process.cwd());
      expect(result.exitCode).toBe(GATE1_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain("git version");
    });

    it("handles command timeout cleanly and returns exit code 2", async () => {
      const isWindows = process.platform === "win32";
      const hangCommand = isWindows
        ? ["ping", "-n", "10", "127.0.0.1"]
        : ["sleep", "10"];

      const result = await defaultGitDiffRunner(
        hangCommand,
        process.cwd(),
        TEST_CONSTANTS.SHORT_TIMEOUT_MS
      );
      expect(result.exitCode).toBe(GATE1_CONSTANTS.EXIT_CODE_ERROR);
      expect(result.stderr).toContain("timed out");
    });

    it("handles nonexistent executable command safely", async () => {
      const result = await defaultGitDiffRunner(
        ["nonexistent_binary_xyz_12345"],
        process.cwd()
      );
      expect(result.exitCode).toBe(GATE1_CONSTANTS.EXIT_CODE_ERROR);
      expect(result.stderr.length).toBeGreaterThan(TEST_CONSTANTS.ZERO);
    });
  });

  // ==========================================================================
  // 8. GATE 1 REVIEWER ORCHESTRATOR UNIT METHODS
  // ==========================================================================
  describe("Gate1Reviewer Orchestrator Unit Methods", () => {
    it("instantiates reviewer and returns options copy via getOptions()", () => {
      const reviewer = new Gate1Reviewer({
        taskId: "TASK-TEST-001",
        taskDescription: "Test task description",
        targetFiles: ["src/index.ts"],
        attempt: TEST_CONSTANTS.ATTEMPT_RETRY,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        timeoutMs: TEST_CONSTANTS.LONG_TIMEOUT_MS,
      });

      const options = reviewer.getOptions();
      expect(options.taskId).toBe("TASK-TEST-001");
      expect(options.taskDescription).toBe("Test task description");
      expect(options.targetFiles).toEqual(["src/index.ts"]);
      expect(options.attempt).toBe(TEST_CONSTANTS.ATTEMPT_RETRY);
      expect(options.maxAttempts).toBe(TEST_CONSTANTS.ATTEMPT_MAX);
      expect(options.timeoutMs).toBe(TEST_CONSTANTS.LONG_TIMEOUT_MS);
    });

    it("extractGitDiff returns pre-supplied options.diff immediately without git runner", async () => {
      let runnerCalled = false;
      const customRunner = async () => {
        runnerCalled = true;
        return { stdout: "diff", stderr: "", exitCode: TEST_CONSTANTS.EXIT_SUCCESS };
      };

      const reviewer = new Gate1Reviewer({
        diff: "+pre-supplied diff content\n",
        gitRunner: customRunner,
      });

      const diff = await reviewer.extractGitDiff();
      expect(diff).toBe("+pre-supplied diff content\n");
      expect(runnerCalled).toBe(false);
    });

    it("extractGitDiff uses baselineSha when provided", async () => {
      let executedArgs: readonly string[] = [];
      const customRunner = async (args: readonly string[]) => {
        executedArgs = args;
        return { stdout: "diff output from baseline", stderr: "", exitCode: TEST_CONSTANTS.EXIT_SUCCESS };
      };

      const reviewer = new Gate1Reviewer({
        baselineSha: "abc1234",
        gitRunner: customRunner,
      });

      const diff = await reviewer.extractGitDiff();
      expect(diff).toBe("diff output from baseline");
      expect(executedArgs).toEqual(["git", "diff", "abc1234"]);
    });

    it("extractGitDiff queries HEAD and falls back to bare git diff if HEAD diff fails", async () => {
      const calls: string[][] = [];
      const customRunner = async (args: readonly string[]) => {
        calls.push([...args]);
        if (args.includes("HEAD")) {
          return { stdout: "", stderr: "fatal: ambiguous argument 'HEAD'", exitCode: TEST_CONSTANTS.EXIT_FAILURE };
        }
        return { stdout: "fallback git diff", stderr: "", exitCode: TEST_CONSTANTS.EXIT_SUCCESS };
      };

      const reviewer = new Gate1Reviewer({
        gitRunner: customRunner,
      });

      const diff = await reviewer.extractGitDiff();
      expect(diff).toBe("fallback git diff");
      expect(calls.length).toBe(TEST_CONSTANTS.TWO);
      expect(calls[TEST_CONSTANTS.INDEX_FIRST]).toEqual(["git", "diff", "HEAD"]);
      expect(calls[TEST_CONSTANTS.INDEX_SECOND]).toEqual(["git", "diff"]);
    });

    it("verifyBoundaries delegates to verifyBoundaryContainment using instance targetFiles", () => {
      const reviewer = new Gate1Reviewer({
        targetFiles: ["src/auth.ts", "test/auth.test.ts"],
      });

      const checkPass = reviewer.verifyBoundaries(["src/auth.ts"]);
      expect(checkPass.passed).toBe(true);

      const checkFail = reviewer.verifyBoundaries(["src/auth.ts", "src/unauthorized.ts"]);
      expect(checkFail.passed).toBe(false);
      expect(checkFail.unauthorizedFiles).toContain(normalize("src/unauthorized.ts"));
    });

    it("evaluateDiff invokes semantic rubric and returns complete Gate1ReviewReport", () => {
      const reviewer = new Gate1Reviewer({
        taskId: "TASK-EVAL",
        acceptanceCriteria: ["AC 1 satisfied"],
      });

      const boundaryCheck: Gate1BoundaryCheckResult = {
        passed: true,
        authorizedFiles: ["src/app.ts", "test/app.test.ts"],
        modifiedFiles: ["src/app.ts", "test/app.test.ts"],
        unauthorizedFiles: [],
        details: "OK",
      };

      const cleanDiff = `
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,4 @@
+export function greet(): string {
+  return "hello";
+}
diff --git a/test/app.test.ts b/test/app.test.ts
--- a/test/app.test.ts
+++ b/test/app.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const report = reviewer.evaluateDiff(cleanDiff, boundaryCheck);
      expect(report.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(report.score).toBeGreaterThanOrEqual(GATE1_CONSTANTS.SCORE_THRESHOLD_PASS);
      expect(report.checklistResults.clean_code).toBe(true);
      expect(report.checklistResults.zero_magic_numbers).toBe(true);
      expect(report.checklistResults.boundary_containment).toBe(true);
    });

    it("generateFeedback generates structured feedback with recommendation", () => {
      const reviewer = new Gate1Reviewer({
        taskId: "TASK-FEEDBACK",
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        diff: `
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,4 @@
+export function greet(): string {
+  return "hello";
+}
diff --git a/test/app.test.ts b/test/app.test.ts
--- a/test/app.test.ts
+++ b/test/app.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`,
      });

      const feedback = reviewer.generateFeedback();
      expect(feedback.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(feedback.recommendation).toBe("PASS");
      expect(feedback.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_PASS);
      expect(feedback.targetState).toBe(LOOPER_STATES.STATE_GATE_2_CHALLENGE);
    });
  });

  // ==========================================================================
  // 9. FULL ORCHESTRATION CYCLE (Gate1Reviewer.run) & SPEC DELTA REQUIREMENTS
  // ==========================================================================
  describe("Gate1Reviewer.run() & OpenSpec Specification Scenarios", () => {
    it("passes cleanly with APPROVED verdict and EVT_G1_PASS when code and tests conform", async () => {
      const cleanDiff = `
diff --git a/src/logic.ts b/src/logic.ts
--- a/src/logic.ts
+++ b/src/logic.ts
@@ -1,2 +1,4 @@
+export function validate(flag: boolean): boolean {
+  return flag;
+}
diff --git a/test/logic.test.ts b/test/logic.test.ts
--- a/test/logic.test.ts
+++ b/test/logic.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "SPEC-CLEAN-001",
        workspaceRoot: currentTestWorkspace,
        diff: cleanDiff,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_PASS);
      expect(result.severeViolation).toBe(false);
      expect(result.report.score).toBe(TEST_CONSTANTS.SCORE_PERFECT);
      expect(result.report.findings).toHaveLength(TEST_CONSTANTS.ZERO);
      expect(result.feedback?.recommendation).toBe("PASS");
    });

    /**
     * OpenSpec Change Requirement Scenario:
     * "WHEN Hardcoded literals or unhandled promise rejections are detected
     *  THEN Gate 1 issues a REVISE verdict with specific line citations"
     */
    it("Scenario: issues REVISE verdict with line citations when hardcoded numeric literal is detected", async () => {
      const magicNumberDiff = `
diff --git a/src/timeout_handler.ts b/src/timeout_handler.ts
--- a/src/timeout_handler.ts
+++ b/src/timeout_handler.ts
@@ -1,3 +1,5 @@
+export function configure(): void {
+  const connectionTimeout = 5000;
+}
diff --git a/test/timeout_handler.test.ts b/test/timeout_handler.test.ts
--- a/test/timeout_handler.test.ts
+++ b/test/timeout_handler.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "SPEC-GATE1-MAGIC-001",
        workspaceRoot: currentTestWorkspace,
        diff: magicNumberDiff,
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_REVISE);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_REVISE);
      expect(result.severeViolation).toBe(false);

      // Verify specific line citations
      const magicFinding = result.report.findings.find(
        (f) => f.category === GATE1_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS
      );
      expect(magicFinding).toBeDefined();
      expect(magicFinding?.filePath).toBe("src/timeout_handler.ts");
      expect(magicFinding?.lineCitation).toContain("5000");
      expect(magicFinding?.message).toContain("5000");

      // Verify feedback contains the citation in both Markdown and XML serialization
      expect(result.feedback?.recommendation).toBe("REVISE");
      expect(result.feedback?.markdownFeedback).toContain("src/timeout_handler.ts");
      expect(result.feedback?.markdownFeedback).toContain("5000");
      expect(result.feedback?.xmlFeedback).toContain("5000");
      expect(result.feedback?.actionableRecommendations[TEST_CONSTANTS.INDEX_FIRST]?.location?.filePath).toBe(
        "src/timeout_handler.ts"
      );
    });

    it("Scenario: issues REVISE verdict with line citations when unhandled promise rejection is detected", async () => {
      const unhandledRejectionDiff = `
diff --git a/src/api_client.ts b/src/api_client.ts
--- a/src/api_client.ts
+++ b/src/api_client.ts
@@ -1,3 +1,5 @@
+export function triggerSync(): void {
+  fetch("/api/sync").then((res) => res.json());
+}
diff --git a/test/api_client.test.ts b/test/api_client.test.ts
--- a/test/api_client.test.ts
+++ b/test/api_client.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "SPEC-GATE1-UNHANDLED-002",
        workspaceRoot: currentTestWorkspace,
        diff: unhandledRejectionDiff,
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_REVISE);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_REVISE);

      const unhandledFinding = result.report.findings.find(
        (f) => f.category === GATE1_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS
      );
      expect(unhandledFinding).toBeDefined();
      expect(unhandledFinding?.filePath).toBe("src/api_client.ts");
      expect(unhandledFinding?.lineCitation).toContain("fetch(\"/api/sync\").then");
      expect(unhandledFinding?.remediation).toContain(".catch()");
    });

    it("issues REVISE verdict and detects both magic numbers and unhandled rejections simultaneously", async () => {
      const combinedDirtyDiff = `
diff --git a/src/combined.ts b/src/combined.ts
--- a/src/combined.ts
+++ b/src/combined.ts
@@ -1,3 +1,6 @@
+export function execute(): void {
+  const maxWait = 9999;
+  Promise.resolve().then(() => true);
+}
diff --git a/test/combined.test.ts b/test/combined.test.ts
--- a/test/combined.test.ts
+++ b/test/combined.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "SPEC-GATE1-COMBINED-003",
        workspaceRoot: currentTestWorkspace,
        diff: combinedDirtyDiff,
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_REVISE);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_REVISE);

      const categories = result.report.findings.map((f) => f.category);
      expect(categories).toContain(GATE1_CONSTANTS.CATEGORY_ZERO_MAGIC_NUMBERS);
      expect(categories).toContain(GATE1_CONSTANTS.CATEGORY_UNHANDLED_REJECTIONS);
    });

    it("forces REJECTED verdict and EVT_G1_REJECT when boundary containment is violated", async () => {
      const diff = `
diff --git a/src/allowed.ts b/src/allowed.ts
--- a/src/allowed.ts
+++ b/src/allowed.ts
@@ -1,2 +1,3 @@
+export const ok = true;
diff --git a/src/unauthorized.ts b/src/unauthorized.ts
--- a/src/unauthorized.ts
+++ b/src/unauthorized.ts
@@ -1,2 +1,3 @@
+export const forbidden = true;
`;

      const reviewer = new Gate1Reviewer({
        taskId: "BOUNDARY-TEST-001",
        workspaceRoot: currentTestWorkspace,
        targetFiles: ["src/allowed.ts"],
        diff,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_REJECTED);
      expect(result.severeViolation).toBe(true);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_REJECT);
      expect(result.report.boundaryCheck.passed).toBe(false);
      expect(result.report.boundaryCheck.unauthorizedFiles).toContain(
        normalize("src/unauthorized.ts")
      );
    });

    it("escalates REVISE verdict to EVT_G1_REJECT when review attempt budget is exhausted", async () => {
      const magicDiff = `
diff --git a/src/service.ts b/src/service.ts
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,2 +1,4 @@
+export function delay(): void {
+  const time = 3000;
+}
diff --git a/test/service.test.ts b/test/service.test.ts
--- a/test/service.test.ts
+++ b/test/service.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "EXHAUSTED-ATTEMPTS-001",
        workspaceRoot: currentTestWorkspace,
        diff: magicDiff,
        attempt: TEST_CONSTANTS.ATTEMPT_EXHAUSTED,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_REVISE);
      // Because attempt (3) >= maxAttempts (3), recommendedEvent escalates to EVT_G1_REJECT
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_REJECT);
      expect(result.feedback?.recommendation).toBe("REJECT");
      expect(result.feedback?.targetState).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);
    });

    it("supports pluggable custom reviewExecutor engine", async () => {
      let executorCalledWithContext: Gate1ExecutionContext | undefined;

      const customExecutor = async (context: Gate1ExecutionContext): Promise<Gate1ReviewReport> => {
        executorCalledWithContext = context;
        return {
          verdict: GATE1_CONSTANTS.VERDICT_APPROVED,
          score: TEST_CONSTANTS.SCORE_CUSTOM,
          summary: "Custom engine passed",
          checklistResults: {
            specification_fidelity: true,
            boundary_containment: true,
            regression_risk: true,
            code_quality: true,
          },
          rubricChecks: [],
          findings: [],
          boundaryCheck: context.boundaryCheck,
          diffStats: context.diffStats,
          remediationAdvice: ["Custom advice"],
        };
      };

      const reviewer = new Gate1Reviewer({
        taskId: "CUSTOM-EXEC-001",
        workspaceRoot: currentTestWorkspace,
        diff: "+custom diff line\n",
        reviewExecutor: customExecutor,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(result.report.score).toBe(TEST_CONSTANTS.SCORE_CUSTOM);
      expect(result.report.summary).toBe("Custom engine passed");
      expect(executorCalledWithContext).toBeDefined();
      expect(executorCalledWithContext?.taskId).toBe("CUSTOM-EXEC-001");
    });

    it("integrates with PAL IPalProvider executing LLM turn and parsing JSON markdown response", async () => {
      let turnPrompt = "";

      const mockProvider: IPalProvider = {
        providerName: "claude",
        modelName: "claude-3-7-sonnet-20250219",
        executeTurn: async (sessionOptions: PalSessionOptions): Promise<PalOutcome> => {
          turnPrompt = sessionOptions.messages[TEST_CONSTANTS.INDEX_FIRST]?.content
            .filter((c) => c.type === "text")
            .map((c) => (c as { text: string }).text)
            .join("\n") ?? "";

          const mockLlmResponse = `
I have audited the code diff. Here is the verdict:

\`\`\`json
{
  "verdict": "APPROVED",
  "score": 98,
  "summary": "LLM subagent approved all changes with zero defects.",
  "checklistResults": {
    "specification_fidelity": true,
    "boundary_containment": true,
    "regression_risk": true,
    "code_quality": true
  },
  "findings": [],
  "remediationAdvice": []
}
\`\`\`
`;

          return {
            message: createPalMessage({
              role: PAL_ROLES.ASSISTANT,
              content: [createTextBlock(mockLlmResponse)],
            }),
            finishReason: "stop",
            usage: {
              promptTokens: TEST_CONSTANTS.TOKEN_USAGE_PROMPT,
              completionTokens: TEST_CONSTANTS.TOKEN_USAGE_COMPLETION,
              totalTokens: TEST_CONSTANTS.TOKEN_USAGE_TOTAL,
            },
          };
        },
        streamTurn: async function* () {
          // not used in synchronous executeTurn
        },
        getCapabilities: () => ({
          providerName: "claude",
          modelName: "claude-3-7-sonnet-20250219",
          maxContextTokens: TEST_CONSTANTS.MAX_CONTEXT_TOKENS,
          maxOutputTokens: TEST_CONSTANTS.MAX_OUTPUT_TOKENS,
          supportsNativeTools: true,
          supportsStreaming: true,
          supportsExtendedThinking: true,
          supportsPromptCaching: true,
        }),
        getRateLimitState: () => ({
          requestsRemaining: TEST_CONSTANTS.RATE_LIMIT_REQUESTS,
          requestsLimit: TEST_CONSTANTS.RATE_LIMIT_REQUESTS,
          tokensRemaining: TEST_CONSTANTS.RATE_LIMIT_TOKENS,
          tokensLimit: TEST_CONSTANTS.RATE_LIMIT_TOKENS,
          resetsAt: Date.now() + TEST_CONSTANTS.RATE_LIMIT_RESET_OFFSET_MS,
        }),
      };

      const reviewer = new Gate1Reviewer({
        taskId: "PAL-INTEG-001",
        workspaceRoot: currentTestWorkspace,
        diff: "+export const answer = 42;\n",
        provider: mockProvider,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(result.report.score).toBe(98);
      expect(result.report.summary).toContain("LLM subagent approved");
      expect(turnPrompt).toContain("PAL-INTEG-001");
    });

    it("parses fallback plain text LLM response when JSON code fence is absent", async () => {
      const mockProvider: IPalProvider = {
        providerName: "claude",
        modelName: "claude-3-7-sonnet-20250219",
        executeTurn: async (): Promise<PalOutcome> => ({
          message: createPalMessage({
            role: PAL_ROLES.ASSISTANT,
            content: [
              createTextBlock("Audit complete. VERDICT: APPROVED. Code meets all criteria."),
            ],
          }),
          finishReason: "stop",
          usage: {
            promptTokens: TEST_CONSTANTS.TOKEN_USAGE_PROMPT,
            completionTokens: TEST_CONSTANTS.TOKEN_USAGE_COMPLETION,
            totalTokens: TEST_CONSTANTS.TOKEN_USAGE_TOTAL,
          },
        }),
        streamTurn: async function* () {},
        getCapabilities: () => ({
          providerName: "claude",
          modelName: "claude-3-7-sonnet-20250219",
          maxContextTokens: TEST_CONSTANTS.MAX_CONTEXT_TOKENS,
          maxOutputTokens: TEST_CONSTANTS.MAX_OUTPUT_TOKENS,
          supportsNativeTools: true,
          supportsStreaming: true,
          supportsExtendedThinking: true,
          supportsPromptCaching: true,
        }),
        getRateLimitState: () => ({
          requestsRemaining: TEST_CONSTANTS.RATE_LIMIT_REQUESTS,
          requestsLimit: TEST_CONSTANTS.RATE_LIMIT_REQUESTS,
          tokensRemaining: TEST_CONSTANTS.RATE_LIMIT_TOKENS,
          tokensLimit: TEST_CONSTANTS.RATE_LIMIT_TOKENS,
          resetsAt: Date.now() + TEST_CONSTANTS.RATE_LIMIT_RESET_OFFSET_MS,
        }),
      };

      const reviewer = new Gate1Reviewer({
        taskId: "PAL-FALLBACK-002",
        workspaceRoot: currentTestWorkspace,
        diff: "+export const test = true;\n",
        provider: mockProvider,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(result.report.score).toBe(TEST_CONSTANTS.SCORE_PERFECT);
    });

    it("emits expected lifecycle events during execution", async () => {
      const emittedEvents: string[] = [];

      const cleanDiff = `
diff --git a/src/event_test.ts b/src/event_test.ts
--- a/src/event_test.ts
+++ b/src/event_test.ts
@@ -1,2 +1,3 @@
+export const eventTest = true;
diff --git a/test/event_test.test.ts b/test/event_test.test.ts
--- a/test/event_test.test.ts
+++ b/test/event_test.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "EVENTS-001",
        workspaceRoot: currentTestWorkspace,
        diff: cleanDiff,
        autoCleanup: true,
      });

      reviewer.on(GATE1_CONSTANTS.EVENT_REVIEW_START, () => emittedEvents.push("start"));
      reviewer.on(GATE1_CONSTANTS.EVENT_DIFF_EXTRACTED, () => emittedEvents.push("diff_extracted"));
      reviewer.on(GATE1_CONSTANTS.EVENT_SUBAGENT_DISPATCHED, () => emittedEvents.push("subagent_dispatched"));
      reviewer.on(GATE1_CONSTANTS.EVENT_VERDICT_RESOLVED, () => emittedEvents.push("verdict_resolved"));
      reviewer.on(GATE1_CONSTANTS.EVENT_REVIEW_COMPLETE, () => emittedEvents.push("complete"));

      await reviewer.run();

      expect(emittedEvents).toContain("start");
      expect(emittedEvents).toContain("diff_extracted");
      expect(emittedEvents).toContain("verdict_resolved");
      expect(emittedEvents).toContain("complete");
    });

    it("emits EVENT_REVIEW_ERROR and re-throws when review execution fails unrecoverably", async () => {
      let errorEventCaught: unknown;

      const failingExecutor = async (): Promise<Gate1ReviewReport> => {
        throw new Error("Unrecoverable review executor engine explosion");
      };

      const reviewer = new Gate1Reviewer({
        taskId: "ERROR-TEST-001",
        workspaceRoot: currentTestWorkspace,
        diff: "+dummy line\n",
        reviewExecutor: failingExecutor,
        autoCleanup: true,
      });

      reviewer.on(GATE1_CONSTANTS.EVENT_REVIEW_ERROR, (err) => {
        errorEventCaught = err;
      });

      let threw = false;
      try {
        await reviewer.run();
      } catch (err) {
        threw = true;
        expect((err as Error).message).toContain("Unrecoverable review executor");
      }

      expect(threw).toBe(true);
      expect(errorEventCaught).toBeDefined();
    });

    it("writes review reports and feedback XML to subagent sandbox directory", async () => {
      const tempWorkspace = await createTempWorkspace();
      const dispatcher = createSubagentDispatcher({
        workspaceRoot: tempWorkspace,
        autoCleanup: false,
      });

      const cleanDiff = `
diff --git a/src/sandbox.ts b/src/sandbox.ts
--- a/src/sandbox.ts
+++ b/src/sandbox.ts
@@ -1,2 +1,3 @@
+export const sandboxActive = true;
diff --git a/test/sandbox.test.ts b/test/sandbox.test.ts
--- a/test/sandbox.test.ts
+++ b/test/sandbox.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "SANDBOX-DIR-001",
        diff: cleanDiff,
        workspaceRoot: tempWorkspace,
        dispatcher,
      });

      const result = await reviewer.run();
      expect(result.sandboxDir).toBeDefined();

      if (result.sandboxDir) {
        tempDirsToClean.push(result.sandboxDir);

        const reportContent = await readFile(
          join(result.sandboxDir, GATE1_CONSTANTS.REPORT_FILENAME),
          "utf8"
        );
        expect(reportContent).toContain("# Gate 1 Semantic Code Review Report");
        expect(reportContent).toContain("SANDBOX-DIR-001");

        const findingsJson = await readFile(
          join(result.sandboxDir, GATE1_CONSTANTS.FINDINGS_JSON_FILENAME),
          "utf8"
        );
        const parsedFindings = JSON.parse(findingsJson);
        expect(parsedFindings.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);

        const feedbackXml = await readFile(
          join(result.sandboxDir, GATE1_CONSTANTS.FEEDBACK_XML_FILENAME),
          "utf8"
        );
        expect(feedbackXml).toContain('<verification-feedback gate="gate1"');
        expect(feedbackXml).toContain("<recommended-event>EVT_G1_PASS</recommended-event>");
      }
    });
  });

  // ==========================================================================
  // 10. CONVENIENCE FACTORY HELPERS
  // ==========================================================================
  describe("Convenience Factory Helpers (createGate1Reviewer & runGate1Review)", () => {
    it("createGate1Reviewer constructs instance with provided options", () => {
      const reviewer = createGate1Reviewer({ taskId: "FACTORY-001" });
      expect(reviewer).toBeInstanceOf(Gate1Reviewer);
      expect(reviewer.getOptions().taskId).toBe("FACTORY-001");
    });

    it("runGate1Review executes single review run and returns result", async () => {
      const cleanDiff = `
diff --git a/src/factory.ts b/src/factory.ts
--- a/src/factory.ts
+++ b/src/factory.ts
@@ -1,2 +1,3 @@
+export const factoryWorks = true;
diff --git a/test/factory.test.ts b/test/factory.test.ts
--- a/test/factory.test.ts
+++ b/test/factory.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const result = await runGate1Review({
        taskId: "ONESHOT-001",
        workspaceRoot: currentTestWorkspace,
        diff: cleanDiff,
        autoCleanup: true,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE1_CONSTANTS.VERDICT_APPROVED);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G1_PASS);
    });
  });
});
