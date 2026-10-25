/**
 * Unit test suite for Gate 1 Structured Feedback Generator (Task 1.3).
 *
 * Verifies that Gate 1 structured feedback generator returns pass/revision/rejection
 * recommendations, correctly translates verdicts into FSM domain events, emits
 * machine-readable XML blocks, formatted Markdown, and actionable worker directives.
 */

import { describe, expect, it } from "bun:test";
import {
  GATE1_FEEDBACK_CONSTANTS,
  classifyFindingPriority,
  createPassFeedback,
  createRejectionFeedback,
  createRevisionFeedback,
  escapeXml,
  escapeXmlAttr,
  formatGate1MarkdownFeedback,
  formatGate1WorkerPrompt,
  formatGate1XmlFeedback,
  generateGate1Feedback,
  generatePassDetails,
  generateRejectionDetails,
  generateRevisionDetails,
  transformFindingsToActionableRecommendations,
  type Gate1ActionableRecommendation,
  type Gate1StructuredFeedback,
} from "../../src/gates/gate1_feedback";
import {
  Gate1Reviewer,
  createGate1Reviewer,
  type Gate1Finding,
  type Gate1ReviewReport,
} from "../../src/gates/gate1_review";
import { LOOPER_EVENTS, LOOPER_STATES } from "../../src/core/fsm_types";

describe("Gate 1: Structured Feedback Generator (Task 1.3)", () => {
  describe("GATE1_FEEDBACK_CONSTANTS", () => {
    it("exposes canonical recommendation identifiers", () => {
      expect(GATE1_FEEDBACK_CONSTANTS.REC_PASS).toBe("PASS");
      expect(GATE1_FEEDBACK_CONSTANTS.REC_REVISE).toBe("REVISE");
      expect(GATE1_FEEDBACK_CONSTANTS.REC_REJECT).toBe("REJECT");
    });

    it("exposes canonical FSM events and target states", () => {
      expect(GATE1_FEEDBACK_CONSTANTS.EVENT_G1_PASS).toBe(LOOPER_EVENTS.EVT_G1_PASS);
      expect(GATE1_FEEDBACK_CONSTANTS.EVENT_G1_REVISE).toBe(LOOPER_EVENTS.EVT_G1_REVISE);
      expect(GATE1_FEEDBACK_CONSTANTS.EVENT_G1_REJECT).toBe(LOOPER_EVENTS.EVT_G1_REJECT);

      expect(GATE1_FEEDBACK_CONSTANTS.STATE_GATE_2_CHALLENGE).toBe(LOOPER_STATES.STATE_GATE_2_CHALLENGE);
      expect(GATE1_FEEDBACK_CONSTANTS.STATE_EXECUTE_WORKER).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);
      expect(GATE1_FEEDBACK_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);
    });

    it("exposes priority levels and scoring thresholds", () => {
      expect(GATE1_FEEDBACK_CONSTANTS.PRIORITY_CRITICAL).toBe("CRITICAL");
      expect(GATE1_FEEDBACK_CONSTANTS.PRIORITY_HIGH).toBe("HIGH");
      expect(GATE1_FEEDBACK_CONSTANTS.PRIORITY_MEDIUM).toBe("MEDIUM");
      expect(GATE1_FEEDBACK_CONSTANTS.PRIORITY_LOW).toBe("LOW");
      expect(GATE1_FEEDBACK_CONSTANTS.SCORE_THRESHOLD_PASS).toBe(80);
      expect(GATE1_FEEDBACK_CONSTANTS.DEFAULT_MAX_ATTEMPTS).toBe(3);
    });
  });

  describe("XML escaping utilities", () => {
    it("escapes special XML tag characters", () => {
      expect(escapeXml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
      expect(escapeXml("")).toBe("");
    });

    it("escapes XML attributes including quotes", () => {
      expect(escapeXmlAttr('key="value" & test=\'val\'')).toBe(
        "key=&quot;value&quot; &amp; test=&apos;val&apos;"
      );
    });
  });

  describe("classifyFindingPriority", () => {
    it("maps fatal severity to CRITICAL priority", () => {
      expect(classifyFindingPriority("fatal")).toBe("CRITICAL");
      expect(classifyFindingPriority("fatal", "boundary_containment")).toBe("CRITICAL");
    });

    it("maps error severity to HIGH priority", () => {
      expect(classifyFindingPriority("error", "strict_typing")).toBe("HIGH");
      expect(classifyFindingPriority("error", "unhandled_rejections")).toBe("HIGH");
      expect(classifyFindingPriority("error", "zero_magic_numbers")).toBe("HIGH");
    });

    it("maps warning severity to MEDIUM priority", () => {
      expect(classifyFindingPriority("warning", "cross_platform")).toBe("MEDIUM");
      expect(classifyFindingPriority("warning", "code_quality")).toBe("MEDIUM");
    });

    it("maps info severity to LOW priority", () => {
      expect(classifyFindingPriority("info")).toBe("LOW");
    });
  });

  describe("transformFindingsToActionableRecommendations", () => {
    it("transforms raw findings into sorted actionable items", () => {
      const findings: Gate1Finding[] = [
        {
          id: "f-1",
          category: "code_quality",
          severity: "warning",
          message: "Console log in production code",
          filePath: "src/calc.ts",
          lineNumber: 10,
          remediation: "Remove console.log",
        },
        {
          id: "f-2",
          category: "boundary_containment",
          severity: "fatal",
          message: "Unauthorized file modified",
          filePath: "secret.env",
          remediation: "Revert secret.env",
        },
        {
          id: "f-3",
          category: "zero_magic_numbers",
          severity: "error",
          message: "Hardcoded literal 5000 in logic",
          filePath: "src/timer.ts",
          lineNumber: 25,
          lineCitation: "const timeout = 5000;",
          remediation: "Extract to constants",
        },
      ];

      const actionable = transformFindingsToActionableRecommendations(findings);
      expect(actionable.length).toBe(3);

      // Verify sorting: CRITICAL first, then HIGH, then MEDIUM
      expect(actionable[0]?.priority).toBe("CRITICAL");
      expect(actionable[0]?.id).toBe("f-2");
      expect(actionable[1]?.priority).toBe("HIGH");
      expect(actionable[1]?.id).toBe("f-3");
      expect(actionable[1]?.location?.lineCitation).toBe("const timeout = 5000;");
      expect(actionable[2]?.priority).toBe("MEDIUM");
      expect(actionable[2]?.id).toBe("f-1");
    });

    it("respects maxFindings limit", () => {
      const findings: Gate1Finding[] = [
        { id: "1", category: "code_quality", severity: "error", message: "Error 1" },
        { id: "2", category: "code_quality", severity: "error", message: "Error 2" },
        { id: "3", category: "code_quality", severity: "error", message: "Error 3" },
      ];

      const limited = transformFindingsToActionableRecommendations(findings, 2);
      expect(limited.length).toBe(2);
    });

    it("handles empty findings gracefully", () => {
      expect(transformFindingsToActionableRecommendations([])).toEqual([]);
    });
  });

  describe("PASS Recommendation Flow", () => {
    const approvedReport: Gate1ReviewReport = {
      verdict: "APPROVED",
      score: 100,
      summary: "Clean Code and Zero Magic Numbers satisfied.",
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
        authorizedFiles: ["src/app.ts"],
        modifiedFiles: ["src/app.ts"],
        unauthorizedFiles: [],
        details: "Boundary contained.",
      },
      diffStats: {
        filesChanged: 1,
        insertions: 20,
        deletions: 0,
        fileList: ["src/app.ts"],
      },
      remediationAdvice: [],
    };

    it("generates PASS recommendation with EVT_G1_PASS and STATE_GATE_2_CHALLENGE", () => {
      const feedback = generateGate1Feedback(approvedReport, {
        taskId: "TASK-001",
      });

      expect(feedback.verdict).toBe("APPROVED");
      expect(feedback.recommendation).toBe("PASS");
      expect(feedback.recommendedEvent).toBe("EVT_G1_PASS");
      expect(feedback.targetState).toBe("STATE_GATE_2_CHALLENGE");
      expect(feedback.score).toBe(100);
      expect(feedback.passDetails).toBeDefined();
      expect(feedback.passDetails?.nextGate).toBe("gate2_challenge");
      expect(feedback.passDetails?.verificationConfidence).toBe("MAXIMUM");
      expect(feedback.revisionDetails).toBeUndefined();
      expect(feedback.rejectionDetails).toBeUndefined();
    });

    it("formats machine-readable XML block for PASS recommendation", () => {
      const feedback = generateGate1Feedback(approvedReport, {
        taskId: "TASK-001",
      });

      const xml = feedback.xmlFeedback;
      expect(xml).toContain('<verification-feedback gate="gate1" verdict="APPROVED" recommendation="PASS" score="100">');
      expect(xml).toContain("<recommended-event>EVT_G1_PASS</recommended-event>");
      expect(xml).toContain("<target-state>STATE_GATE_2_CHALLENGE</target-state>");
      expect(xml).toContain('<pass-details confidence="MAXIMUM" next-gate="gate2_challenge">');
      expect(xml).toContain("</verification-feedback>");
    });

    it("formats GitHub markdown with NOTE alert for PASS recommendation", () => {
      const feedback = generateGate1Feedback(approvedReport, {
        taskId: "TASK-001",
      });

      const md = feedback.markdownFeedback;
      expect(md).toContain("# Gate 1 Semantic Review Verdict: APPROVED");
      expect(md).toContain("> [!NOTE]");
      expect(md).toContain("Gate 1 Semantic Review PASSED with quality score 100/100");
      expect(md).toContain("`EVT_G1_PASS`");
      expect(md).toContain("| **Recommendation** | **PASS** |");
    });
  });

  describe("REVISE Recommendation Flow", () => {
    const reviseReport: Gate1ReviewReport = {
      verdict: "REVISE",
      score: 60,
      summary: "Detected hardcoded literal and unhandled rejection.",
      checklistResults: {
        specification_fidelity: true,
        boundary_containment: true,
        regression_risk: true,
        code_quality: false,
        zero_magic_numbers: false,
        dod_adherence: true,
      },
      rubricChecks: [],
      findings: [
        {
          id: "magic-1",
          category: "zero_magic_numbers",
          severity: "error",
          message: "Hardcoded numeric literal '3000' in setTimeout",
          filePath: "src/timer.ts",
          lineNumber: 42,
          lineCitation: "setTimeout(handler, 3000);",
          remediation: "Extract 3000 to TIMER_CONSTANTS.TIMEOUT_MS",
        },
        {
          id: "async-1",
          category: "unhandled_rejections",
          severity: "error",
          message: "Promise .then without .catch",
          filePath: "src/fetch.ts",
          lineNumber: 15,
          lineCitation: "fetch('/data').then(res => res.json());",
          remediation: "Add .catch() handler or wrap in try/catch",
        },
      ],
      boundaryCheck: {
        passed: true,
        authorizedFiles: ["src/timer.ts", "src/fetch.ts"],
        modifiedFiles: ["src/timer.ts", "src/fetch.ts"],
        unauthorizedFiles: [],
        details: "Boundary contained.",
      },
      diffStats: {
        filesChanged: 2,
        insertions: 15,
        deletions: 2,
        fileList: ["src/timer.ts", "src/fetch.ts"],
      },
      remediationAdvice: [
        "Extract 3000 to TIMER_CONSTANTS.TIMEOUT_MS",
        "Add .catch() handler or wrap in try/catch",
      ],
    };

    it("generates REVISE recommendation with EVT_G1_REVISE and STATE_EXECUTE_WORKER when attempt < maxAttempts", () => {
      const feedback = generateGate1Feedback(reviseReport, {
        taskId: "TASK-002",
        attempt: 1,
        maxAttempts: 3,
      });

      expect(feedback.verdict).toBe("REVISE");
      expect(feedback.recommendation).toBe("REVISE");
      expect(feedback.recommendedEvent).toBe("EVT_G1_REVISE");
      expect(feedback.targetState).toBe("STATE_EXECUTE_WORKER");
      expect(feedback.score).toBe(60);
      expect(feedback.metadata.canRetry).toBe(true);
      expect(feedback.metadata.remainingAttempts).toBe(2);
      expect(feedback.revisionDetails).toBeDefined();
      expect(feedback.revisionDetails?.requiredRevisionsCount).toBe(2);
      expect(feedback.revisionDetails?.highCount).toBe(2);
      expect(feedback.actionableRecommendations.length).toBe(2);
    });

    it("formats machine-readable XML block for REVISE recommendation", () => {
      const feedback = generateGate1Feedback(reviseReport, {
        taskId: "TASK-002",
        attempt: 1,
        maxAttempts: 3,
      });

      const xml = feedback.xmlFeedback;
      expect(xml).toContain('<verification-feedback gate="gate1" verdict="REVISE" recommendation="REVISE" score="60">');
      expect(xml).toContain("<recommended-event>EVT_G1_REVISE</recommended-event>");
      expect(xml).toContain("<target-state>STATE_EXECUTE_WORKER</target-state>");
      expect(xml).toContain('<required-revisions count="2"');
      expect(xml).toContain('file="src/timer.ts" line="42"');
      expect(xml).toContain("<citation>setTimeout(handler, 3000);</citation>");
      expect(xml).toContain("<action>Extract 3000 to TIMER_CONSTANTS.TIMEOUT_MS</action>");
      expect(xml).toContain("</verification-feedback>");
    });

    it("formats GitHub markdown with IMPORTANT alert for REVISE recommendation", () => {
      const feedback = generateGate1Feedback(reviseReport, {
        taskId: "TASK-002",
        attempt: 1,
        maxAttempts: 3,
      });

      const md = feedback.markdownFeedback;
      expect(md).toContain("# Gate 1 Semantic Review Verdict: REVISE");
      expect(md).toContain("> [!IMPORTANT]");
      expect(md).toContain("Gate 1 Semantic Review requested REVISIONS (Attempt 1/3)");
      expect(md).toContain("`EVT_G1_REVISE`");
      expect(md).toContain("## Prioritized Findings & Remediation (2)");
      expect(md).toContain("`src/timer.ts:42`");
      expect(md).toContain("setTimeout(handler, 3000);");
    });

    it("formats clean worker re-injection prompt with exact citations", () => {
      const feedback = generateGate1Feedback(reviseReport, {
        taskId: "TASK-002",
        attempt: 1,
        maxAttempts: 3,
      });

      const prompt = formatGate1WorkerPrompt(feedback, { taskId: "TASK-002" });
      expect(prompt).toContain("Gate 1 Semantic Code Review requested revisions for TASK-002 (Attempt 1/3)");
      expect(prompt).toContain("Quality Score: 60/100");
      expect(prompt).toContain("1. [HIGH] Zero Magic Numbers Directive Violation (src/timer.ts:42)");
      expect(prompt).toContain("Citation: `setTimeout(handler, 3000);`");
      expect(prompt).toContain("Remediation: Extract 3000 to TIMER_CONSTANTS.TIMEOUT_MS");
      expect(prompt).toContain("Run local validation suite (`bun test`, `bunx tsc --noEmit`)");
    });
  });

  describe("REJECT Recommendation Flow (Escalation)", () => {
    it("escalates to REJECT when review attempt reaches maxAttempts", () => {
      const reviseReport: Gate1ReviewReport = {
        verdict: "REVISE",
        score: 60,
        summary: "Persistent magic numbers.",
        checklistResults: {
          specification_fidelity: true,
          boundary_containment: true,
          regression_risk: true,
          code_quality: false,
          zero_magic_numbers: false,
          dod_adherence: true,
        },
        rubricChecks: [],
        findings: [
          {
            id: "m-1",
            category: "zero_magic_numbers",
            severity: "error",
            message: "Magic number 1234",
            filePath: "src/calc.ts",
          },
        ],
        boundaryCheck: {
          passed: true,
          authorizedFiles: [],
          modifiedFiles: [],
          unauthorizedFiles: [],
          details: "Passed",
        },
        diffStats: { filesChanged: 1, insertions: 1, deletions: 0, fileList: ["src/calc.ts"] },
        remediationAdvice: [],
      };

      const feedback = generateGate1Feedback(reviseReport, {
        taskId: "TASK-003",
        attempt: 3,
        maxAttempts: 3,
      });

      expect(feedback.recommendation).toBe("REJECT");
      expect(feedback.recommendedEvent).toBe("EVT_G1_REJECT");
      expect(feedback.targetState).toBe("STATE_ESCALATE_DIAGNOSTIC");
      expect(feedback.metadata.canRetry).toBe(false);
      expect(feedback.rejectionDetails).toBeDefined();
      expect(feedback.rejectionDetails?.attemptsExhausted).toBe(true);
      expect(feedback.rejectionDetails?.escalationReason).toContain("attempts exhausted");
    });

    it("escalates to REJECT when boundary containment is violated", () => {
      const boundaryViolatedReport: Gate1ReviewReport = {
        verdict: "REJECTED",
        score: 30,
        summary: "Boundary containment violated.",
        checklistResults: {
          specification_fidelity: true,
          boundary_containment: false,
          regression_risk: true,
          code_quality: true,
          zero_magic_numbers: true,
          dod_adherence: false,
        },
        rubricChecks: [],
        findings: [
          {
            id: "boundary-1",
            category: "boundary_containment",
            severity: "fatal",
            message: "Modified unauthorized file: src/unauthorized.ts",
            filePath: "src/unauthorized.ts",
            remediation: "Revert src/unauthorized.ts",
          },
        ],
        boundaryCheck: {
          passed: false,
          authorizedFiles: ["src/authorized.ts"],
          modifiedFiles: ["src/authorized.ts", "src/unauthorized.ts"],
          unauthorizedFiles: ["src/unauthorized.ts"],
          details: "Unauthorized files modified: src/unauthorized.ts",
        },
        diffStats: {
          filesChanged: 2,
          insertions: 10,
          deletions: 0,
          fileList: ["src/authorized.ts", "src/unauthorized.ts"],
        },
        remediationAdvice: ["Revert src/unauthorized.ts"],
      };

      const feedback = generateGate1Feedback(boundaryViolatedReport, {
        taskId: "TASK-004",
        attempt: 1,
        maxAttempts: 3,
      });

      expect(feedback.verdict).toBe("REJECTED");
      expect(feedback.recommendation).toBe("REJECT");
      expect(feedback.recommendedEvent).toBe("EVT_G1_REJECT");
      expect(feedback.targetState).toBe("STATE_ESCALATE_DIAGNOSTIC");
      expect(feedback.metadata.severeViolation).toBe(true);
      expect(feedback.metadata.canRetry).toBe(false);
      expect(feedback.rejectionDetails?.severeViolationDetected).toBe(true);
      expect(feedback.rejectionDetails?.escalationReason).toContain("Severe boundary containment violation");

      // Verify XML output
      expect(feedback.xmlFeedback).toContain('<verification-feedback gate="gate1" verdict="REJECTED" recommendation="REJECT"');
      expect(feedback.xmlFeedback).toContain("<target-state>STATE_ESCALATE_DIAGNOSTIC</target-state>");
      expect(feedback.xmlFeedback).toContain('<rejection-details severe-violation="true"');

      // Verify Markdown output
      expect(feedback.markdownFeedback).toContain("> [!WARNING]");
      expect(feedback.markdownFeedback).toContain("Gate 1 Semantic Review REJECTED changes");
      expect(feedback.markdownFeedback).toContain("## Escalation Post-Mortem");
    });
  });

  describe("Convenience direct factory helpers", () => {
    it("createPassFeedback creates synthetic approved feedback", () => {
      const fb = createPassFeedback({ taskId: "SYN-001" });
      expect(fb.verdict).toBe("APPROVED");
      expect(fb.recommendation).toBe("PASS");
      expect(fb.recommendedEvent).toBe("EVT_G1_PASS");
      expect(fb.targetState).toBe("STATE_GATE_2_CHALLENGE");
      expect(fb.score).toBe(100);
      expect(fb.xmlFeedback).toContain('verdict="APPROVED"');
    });

    it("createRevisionFeedback creates synthetic revision feedback from findings", () => {
      const fb = createRevisionFeedback({
        taskId: "SYN-002",
        attempt: 1,
        maxAttempts: 3,
        findings: [
          {
            id: "syn-f1",
            category: "zero_magic_numbers",
            severity: "error",
            message: "Literal 42 in logic",
            filePath: "src/logic.ts",
            lineNumber: 10,
            lineCitation: "const ans = 42;",
            remediation: "Extract to ANSWER_CONSTANT",
          },
        ],
      });

      expect(fb.verdict).toBe("REVISE");
      expect(fb.recommendation).toBe("REVISE");
      expect(fb.recommendedEvent).toBe("EVT_G1_REVISE");
      expect(fb.targetState).toBe("STATE_EXECUTE_WORKER");
      expect(fb.actionableRecommendations.length).toBe(1);
      expect(fb.xmlFeedback).toContain('file="src/logic.ts" line="10"');
    });

    it("createRejectionFeedback creates synthetic rejection feedback", () => {
      const fb = createRejectionFeedback({
        taskId: "SYN-003",
        reason: "Critical boundary violation detected.",
      });

      expect(fb.verdict).toBe("REJECTED");
      expect(fb.recommendation).toBe("REJECT");
      expect(fb.recommendedEvent).toBe("EVT_G1_REJECT");
      expect(fb.targetState).toBe("STATE_ESCALATE_DIAGNOSTIC");
      expect(fb.rejectionDetails?.severeViolationDetected).toBe(true);
    });
  });

  describe("Integration with Gate1Reviewer Subagent Orchestrator", () => {
    it("Gate1Reviewer.generateFeedback produces structured feedback from report", () => {
      const reviewer = createGate1Reviewer({
        taskId: "INTEG-TASK-001",
        targetFiles: ["src/good.ts", "test/good.test.ts"],
      });

      const cleanDiff = `
diff --git a/src/good.ts b/src/good.ts
--- a/src/good.ts
+++ b/src/good.ts
@@ -1,2 +1,4 @@
+export function computeGood(): number {
+  return 0;
+}
diff --git a/test/good.test.ts b/test/good.test.ts
--- a/test/good.test.ts
+++ b/test/good.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const boundaryCheck = reviewer.verifyBoundaries(["src/good.ts", "test/good.test.ts"]);
      const report = reviewer.evaluateDiff(cleanDiff, boundaryCheck);
      const feedback = reviewer.generateFeedback(report);

      expect(feedback.verdict).toBe("APPROVED");
      expect(feedback.recommendation).toBe("PASS");
      expect(feedback.recommendedEvent).toBe("EVT_G1_PASS");
      expect(feedback.targetState).toBe("STATE_GATE_2_CHALLENGE");
      expect(feedback.score).toBe(100);
      expect(feedback.xmlFeedback).toContain("<recommended-event>EVT_G1_PASS</recommended-event>");
    });

    it("Gate1Reviewer.run attaches structured feedback to Gate1ReviewResult", async () => {
      const cleanDiff = `
diff --git a/src/clean.ts b/src/clean.ts
--- a/src/clean.ts
+++ b/src/clean.ts
@@ -1,2 +1,4 @@
+export function isClean(): boolean {
+  return true;
+}
diff --git a/test/clean.test.ts b/test/clean.test.ts
--- a/test/clean.test.ts
+++ b/test/clean.test.ts
@@ -1,2 +1,3 @@
+import { it } from "bun:test";
`;

      const reviewer = new Gate1Reviewer({
        taskId: "INTEG-RUN-001",
        diff: cleanDiff,
        autoCleanup: true,
      });

      const result = await reviewer.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe("APPROVED");
      expect(result.feedback).toBeDefined();
      expect(result.feedback?.recommendation).toBe("PASS");
      expect(result.feedback?.recommendedEvent).toBe("EVT_G1_PASS");
      expect(result.feedback?.targetState).toBe("STATE_GATE_2_CHALLENGE");
      expect(result.feedback?.xmlFeedback).toContain('gate="gate1"');
      expect(result.feedback?.markdownFeedback).toContain("# Gate 1 Semantic Review Verdict: APPROVED");
    });
  });
});
