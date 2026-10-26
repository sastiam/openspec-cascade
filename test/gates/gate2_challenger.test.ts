/**
 * Unit Test Suite for Gate 2: Adversarial Challenger Red-Team Test Runner.
 *
 * Validates Gate2Challenger, probe runner, verdict calculation, FSM event mapping,
 * sandboxing, structured XML feedback, and adversarial stress execution implemented in
 * `src/gates/gate2_challenger.ts` in accordance with OpenSpec change
 * `looper-gate2-adversarial-challenger` Task 1.1 and `projects/agnostic_looper/SPECIFICATION.md`
 * Section 3.1 & Section 3.4 (LOOPER-GATE-003).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATE2_CONSTANTS,
  Gate2Challenger,
  Gate2ChallengerError,
  Gate2ProbeExecutionError,
  Gate2SubagentDispatchError,
  Gate2TimeoutError,
  createGate2Challenger,
  defaultProbeRunner,
  extractProbeErrorTrace,
  formatChallengeReportMarkdown,
  formatChallengerPrompt,
  generateGate2Feedback,
  resolveGate2RecommendedEvent,
  runGate2Challenger,
  sanitizeProbeName,
  type Gate2ChallengeReport,
  type Gate2ChallengeResult,
  type Gate2ChallengerOptions,
  type Gate2ExecutionContext,
  type Gate2ProbeDefinition,
  type Gate2ProbeResult,
} from "../../src/gates/gate2_challenger";
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

describe("Gate 2: Adversarial Challenger Test Runner (Task 1.1)", () => {
  let tempDir: string;
  let testDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `gate2-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    testDir = join(tempDir, "test");
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Constants and Sanitizers", () => {
    it("exports all required GATE2_CONSTANTS with strict values", () => {
      expect(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK).toBe("PASSED_NO_BREAK");
      expect(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE).toBe("REPRODUCED_FAILURE");
      expect(GATE2_CONSTANTS.EVENT_G2_PASS).toBe("EVT_G2_PASS");
      expect(GATE2_CONSTANTS.EVENT_G2_BREAK).toBe("EVT_G2_BREAK");
      expect(GATE2_CONSTANTS.EVENT_G2_EXHAUSTED).toBe("EVT_G2_EXHAUSTED");
      expect(GATE2_CONSTANTS.DEFAULT_MAX_ATTEMPTS).toBe(2);
      expect(GATE2_CONSTANTS.DEFAULT_ATTEMPT).toBe(1);
      expect(GATE2_CONSTANTS.DEFAULT_GATE_TIMEOUT_MS).toBe(300_000);
      expect(GATE2_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS).toBe(30_000);
    });

    it("sanitizeProbeName normalizes probe names safely", () => {
      expect(sanitizeProbeName("null-pointer.check")).toBe("null-pointer_check");
      expect(sanitizeProbeName("Fuzz_Payload!@#123")).toBe("fuzz_payload___123");
      expect(sanitizeProbeName("")).toBe("probe");
    });

    it("extractProbeErrorTrace isolates relevant error lines", () => {
      const stdout = "Running test...\n✓ Setup passed";
      const stderr = "Error: unhandled malformed payload\n    at Object.test (test.ts:10:5)\nAssertion failed";
      const trace = extractProbeErrorTrace(stdout, stderr);
      expect(trace).toContain("Error: unhandled malformed payload");
      expect(trace).toContain("Assertion failed");
    });
  });

  describe("resolveGate2RecommendedEvent", () => {
    it("returns EVT_G2_PASS when verdict is PASSED_NO_BREAK", () => {
      const event = resolveGate2RecommendedEvent(
        GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
        1,
        2
      );
      expect(event).toBe(LOOPER_EVENTS.EVT_G2_PASS);
    });

    it("returns EVT_G2_BREAK when broken and attempt < maxAttempts", () => {
      const event = resolveGate2RecommendedEvent(
        GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
        1,
        2
      );
      expect(event).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
    });

    it("returns EVT_G2_EXHAUSTED when broken and attempt >= maxAttempts", () => {
      const event = resolveGate2RecommendedEvent(
        GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
        2,
        2
      );
      expect(event).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);
    });

    it("returns EVT_G2_EXHAUSTED when timeout occurs and attempts are exhausted", () => {
      const event = resolveGate2RecommendedEvent(
        GATE2_CONSTANTS.VERDICT_TIMEOUT,
        3,
        2
      );
      expect(event).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);
    });
  });

  describe("formatChallengerPrompt & formatChallengeReportMarkdown", () => {
    it("formats prompt including all task parameters and attack vectors", () => {
      const context: Gate2ExecutionContext = {
        taskId: "TASK-123",
        taskDescription: "Implement JSON payload parser",
        acceptanceCriteria: ["Must reject corrupted JSON", "Must handle null inputs"],
        targetFiles: ["src/parser.ts"],
        gitDiff: "+ export function parse() {}",
        attempt: 1,
        maxAttempts: 2,
        options: {},
      };

      const prompt = formatChallengerPrompt(context);
      expect(prompt).toContain("Gate 2: Adversarial Challenger Red-Team Instructions");
      expect(prompt).toContain("TASK-123");
      expect(prompt).toContain("Implement JSON payload parser");
      expect(prompt).toContain("Must reject corrupted JSON");
      expect(prompt).toContain("src/parser.ts");
      expect(prompt).toContain("+ export function parse() {}");
      expect(prompt).toContain("Boundary & Malformed Inputs");
    });

    it("formats markdown report with tables and breaking probes", () => {
      const report: Gate2ChallengeReport = {
        verdict: GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
        summary: "Candidate implementation crashed on malformed payload",
        totalProbes: 2,
        survivedCount: 1,
        brokenCount: 1,
        results: [
          {
            probeId: "p1",
            name: "Probe 1",
            vector: "boundary_malformed",
            description: "Null payload check",
            survived: true,
            broken: false,
            exitCode: 0,
            stdout: "",
            stderr: "",
            durationMs: 12,
          },
          {
            probeId: "p2",
            name: "Probe 2",
            vector: "boundary_malformed",
            description: "Corrupted JSON check",
            survived: false,
            broken: true,
            exitCode: 1,
            stdout: "",
            stderr: "TypeError: Cannot read properties of undefined",
            errorOutput: "TypeError: Cannot read properties of undefined",
            durationMs: 15,
            preservedReproPath: "/test/challenger_repro_p2.test.ts",
          },
        ],
        breakingProbes: [
          {
            probeId: "p2",
            name: "Probe 2",
            vector: "boundary_malformed",
            description: "Corrupted JSON check",
            survived: false,
            broken: true,
            exitCode: 1,
            stdout: "",
            stderr: "TypeError: Cannot read properties of undefined",
            errorOutput: "TypeError: Cannot read properties of undefined",
            durationMs: 15,
            preservedReproPath: "/test/challenger_repro_p2.test.ts",
          },
        ],
        reproScripts: ["/test/challenger_repro_p2.test.ts"],
        unhandledFailures: ["Probe 2: TypeError: Cannot read properties of undefined"],
      };

      const md = formatChallengeReportMarkdown(report, "TASK-123");
      expect(md).toContain("# Gate 2: Adversarial Challenger Red-Team Report");
      expect(md).toContain("TASK-123");
      expect(md).toContain("REPRODUCED_FAILURE");
      expect(md).toContain("Total Probes Executed");
      expect(md).toContain("TypeError: Cannot read properties of undefined");
      expect(md).toContain("/test/challenger_repro_p2.test.ts");
    });
  });

  describe("generateGate2Feedback", () => {
    it("generates XML feedback for passed challenge", () => {
      const report: Gate2ChallengeReport = {
        verdict: GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
        summary: "Implementation withstood all adversarial probes.",
        totalProbes: 3,
        survivedCount: 3,
        brokenCount: 0,
        results: [],
        breakingProbes: [],
        reproScripts: [],
        unhandledFailures: [],
      };

      const feedback = generateGate2Feedback(report, {
        taskId: "TASK-QA",
        attempt: 1,
        maxAttempts: 2,
      });

      expect(feedback.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(feedback.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_PASS);
      expect(feedback.targetFsmState).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
      expect(feedback.xmlFeedback).toContain("<verdict>PASSED_NO_BREAK</verdict>");
      expect(feedback.xmlFeedback).toContain("<recommended-event>EVT_G2_PASS</recommended-event>");
      expect(feedback.xmlFeedback).toContain("<target-fsm-state>STATE_GATE_3_AUDIT</target-fsm-state>");
      expect(feedback.xmlFeedback).toContain("<total-probes>3</total-probes>");
      expect(feedback.breakingProbeCount).toBe(0);
    });

    it("generates XML feedback for reproduced breaking failure", () => {
      const report: Gate2ChallengeReport = {
        verdict: GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
        summary: "Candidate implementation crashed on malformed payload",
        totalProbes: 1,
        survivedCount: 0,
        brokenCount: 1,
        results: [],
        breakingProbes: [
          {
            probeId: "null_probe",
            name: "Null Payload Vulnerability",
            vector: "boundary_malformed",
            description: "Crash on undefined parameter",
            survived: false,
            broken: true,
            exitCode: 1,
            stdout: "",
            stderr: "TypeError: Cannot read properties of undefined",
            errorOutput: "TypeError: Cannot read properties of undefined",
            durationMs: 25,
            preservedReproPath: "test/challenger_repro_null_probe.test.ts",
          },
        ],
        reproScripts: ["test/challenger_repro_null_probe.test.ts"],
        unhandledFailures: ["TypeError"],
      };

      const feedback = generateGate2Feedback(report, {
        taskId: "TASK-BREAK",
        attempt: 1,
        maxAttempts: 2,
      });

      expect(feedback.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(feedback.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      expect(feedback.targetFsmState).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);
      expect(feedback.xmlFeedback).toContain("<verdict>REPRODUCED_FAILURE</verdict>");
      expect(feedback.xmlFeedback).toContain("<recommended-event>EVT_G2_BREAK</recommended-event>");
      expect(feedback.xmlFeedback).toContain("<breaking-probes count=\"1\">");
      expect(feedback.xmlFeedback).toContain("<reproduction-file>test/challenger_repro_null_probe.test.ts</reproduction-file>");
      expect(feedback.recommendations[0]).toContain("Harden input validation in Null Payload Vulnerability");
    });
  });

  describe("Gate2Challenger probe execution", () => {
    it("executes probe and marks survived when probe passes (exitCode 0)", async () => {
      const probe: Gate2ProbeDefinition = {
        id: "surviving_probe",
        name: "Boundary Normal Number",
        vector: "boundary_malformed",
        description: "Checks that valid boundary number does not throw",
        probeCode: `
          import { test, expect } from "bun:test";
          test("survives", () => {
            expect(1 + 1).toBe(2);
          });
        `,
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        autoCleanup: true,
      });

      const result = await challenger.executeProbe(probe);
      expect(result.survived).toBe(true);
      expect(result.broken).toBe(false);
      expect(result.exitCode).toBe(0);
    });

    it("executes probe and marks broken when probe fails (exitCode != 0)", async () => {
      const probe: Gate2ProbeDefinition = {
        id: "crashing_probe",
        name: "Malformed Payload Rejection",
        vector: "boundary_malformed",
        description: "Candidate implementation crashes on malformed payload",
        probeCode: `
          import { test, expect } from "bun:test";
          test("forces crash", () => {
            throw new TypeError("Candidate implementation crashes on malformed payload");
          });
        `,
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        preserveBreakingProbes: true,
        autoCleanup: false,
      });

      let breakingEventReceived = false;
      challenger.on(GATE2_CONSTANTS.EVENT_BREAKING_PROBE_FOUND, (res: Gate2ProbeResult) => {
        if (res.probeId === "crashing_probe") {
          breakingEventReceived = true;
        }
      });

      const result = await challenger.executeProbe(probe);
      expect(result.survived).toBe(false);
      expect(result.broken).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.errorOutput).toContain("crashes on malformed payload");
      expect(breakingEventReceived).toBe(true);
      expect(result.preservedReproPath).toBeDefined();

      // Verify that preserved reproduction script exists on disk
      if (result.preservedReproPath) {
        const content = await readFile(result.preservedReproPath, "utf8");
        expect(content).toContain("forces crash");
      }
    });

    it("runs multiple probes and compiles run summary", async () => {
      const probes: Gate2ProbeDefinition[] = [
        {
          id: "probe_pass",
          name: "Passing Probe",
          vector: "boundary_malformed",
          description: "No break",
          probeCode: `
            import { test, expect } from "bun:test";
            test("pass", () => expect(true).toBe(true));
          `,
        },
        {
          id: "probe_fail",
          name: "Breaking Probe",
          vector: "concurrency_race",
          description: "Trigger race condition",
          probeCode: `
            import { test, expect } from "bun:test";
            test("fail", () => { throw new Error("Race condition triggered"); });
          `,
        },
      ];

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
      });

      const summary = await challenger.runProbes(probes);
      expect(summary.totalProbes).toBe(2);
      expect(summary.passedProbes).toBe(1);
      expect(summary.brokenProbes).toBe(1);
      expect(summary.breakingProbes.length).toBe(1);
      expect(summary.breakingProbes[0]?.probeId).toBe("probe_fail");
    });
  });

  describe("Gate2Challenger.run() & OpenSpec Scenarios", () => {
    it("Scenario: Candidate implementation crashes on malformed payload -> reports unhandled edge case failure", async () => {
      const crashingProbe: Gate2ProbeDefinition = {
        id: "malformed_payload_fuzz",
        name: "Malformed Payload Rejection",
        vector: "boundary_malformed",
        description: "Candidate implementation crashes on malformed payload",
        probeCode: `
          import { test, expect } from "bun:test";
          test("crash on malformed payload", () => {
            const malformed = JSON.parse('{"bad": null}');
            if (malformed.bad === null) {
              throw new Error("Unhandled edge case failure: candidate crashed on null payload");
            }
          });
        `,
      };

      const challenger = createGate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        taskId: "TASK-CRASH-TEST",
        taskDescription: "Validate input payloads",
        probes: [crashingProbe],
        attempt: 1,
        maxAttempts: 2,
      });

      const result = await challenger.run();

      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      expect(result.breakingProbes.length).toBe(1);
      expect(result.report.unhandledFailures[0]).toContain("Unhandled edge case failure");
      expect(result.feedback?.xmlFeedback).toContain("<verdict>REPRODUCED_FAILURE</verdict>");
      expect(result.reproScripts.length).toBeGreaterThan(0);
    });

    it("passes cleanly with PASSED_NO_BREAK when all adversarial probes survive", async () => {
      const robustProbe: Gate2ProbeDefinition = {
        id: "robust_boundary_probe",
        name: "Robust Input Defense",
        vector: "boundary_malformed",
        description: "Candidate implementation safely handles boundary values",
        probeCode: `
          import { test, expect } from "bun:test";
          test("safely handles boundary", () => {
            const input = "";
            const sanitized = input.trim();
            expect(sanitized).toBe("");
          });
        `,
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        taskId: "TASK-ROBUST",
        probes: [robustProbe],
        attempt: 1,
        maxAttempts: 2,
      });

      const result = await challenger.run();

      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_PASS);
      expect(result.breakingProbes.length).toBe(0);
      expect(result.report.brokenCount).toBe(0);
      expect(result.report.survivedCount).toBe(1);
    });

    it("escalates to EVT_G2_EXHAUSTED when attempt >= maxAttempts", async () => {
      const breakingProbe: Gate2ProbeDefinition = {
        id: "breaking_probe",
        name: "Timeout Simulation",
        vector: "timeout_latency",
        description: "Candidate fails under high latency",
        probeCode: `
          import { test, expect } from "bun:test";
          test("latency fail", () => {
            throw new Error("Timeout exceeded");
          });
        `,
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        taskId: "TASK-EXHAUSTED",
        probes: [breakingProbe],
        attempt: 2,
        maxAttempts: 2,
      });

      const result = await challenger.run();

      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);
      expect(result.feedback?.targetFsmState).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);
    });

    it("supports pluggable custom challengerExecutor", async () => {
      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        challengerExecutor: async (ctx) => {
          return {
            verdict: GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
            summary: `Custom executor passed for ${ctx.taskId}`,
            totalProbes: 0,
            survivedCount: 0,
            brokenCount: 0,
            results: [],
            breakingProbes: [],
            reproScripts: [],
            unhandledFailures: [],
          };
        },
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.report.summary).toContain("Custom executor passed");
    });

    it("supports pluggable edgeCaseSynthesizer callback", async () => {
      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        edgeCaseSynthesizer: async () => [
          {
            id: "synthesized_probe",
            name: "Synthesized Probe",
            vector: "concurrency_race",
            description: "Auto-synthesized probe",
            probeCode: `
              import { test, expect } from "bun:test";
              test("synth", () => expect(1).toBe(1));
            `,
          },
        ],
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.report.totalProbes).toBe(1);
      expect(result.report.survivedCount).toBe(1);
    });

    it("integrates with PAL IPalProvider executing LLM challenge turn", async () => {
      const mockProvider: IPalProvider = {
        providerName: "claude",
        modelName: "claude-3-7-sonnet-20250219",
        executeTurn: async (opts: PalSessionOptions): Promise<PalOutcome> => {
          return {
            message: createPalMessage({
              role: PAL_ROLES.ASSISTANT,
              content: [
                createTextBlock(
                  "```json\n" +
                    JSON.stringify({
                      verdict: "PASSED_NO_BREAK",
                      summary: "Candidate passed red-team LLM stress evaluation.",
                      probes: [],
                    }) +
                    "\n```"
                ),
              ],
            }),
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            finishReason: "stop",
          };
        },
        streamTurn: async function* () {},
        getCapabilities: () => ({
          providerName: "claude",
          modelName: "claude-3-7-sonnet-20250219",
          maxContextTokens: 200_000,
          maxOutputTokens: 8192,
          supportsNativeTools: true,
          supportsStreaming: true,
          supportsExtendedThinking: true,
          supportsPromptCaching: true,
        }),
        getRateLimitState: () => ({
          requestsRemaining: 100,
          requestsLimit: 100,
          tokensRemaining: 100_000,
          tokensLimit: 100_000,
          resetsAt: Date.now() + 60_000,
        }),
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        provider: mockProvider,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(result.report.summary).toContain("Candidate passed red-team LLM");
    });

    it("writes reports to subagent sandbox folder", async () => {
      const dispatcher = createSubagentDispatcher({
        workspaceRoot: tempDir,
        autoCleanup: false,
      });

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        taskId: "TASK-SANDBOX-TEST",
        dispatcher,
        autoCleanup: false,
        probes: [
          {
            id: "probe_safe",
            name: "Safe Probe",
            vector: "boundary_malformed",
            description: "No crash",
            probeCode: `
              import { test, expect } from "bun:test";
              test("ok", () => expect(true).toBe(true));
            `,
          },
        ],
      });

      const result = await challenger.run();
      expect(result.sandboxDir).toBeDefined();

      if (result.sandboxDir) {
        const reportMd = await readFile(
          join(result.sandboxDir, GATE2_CONSTANTS.REPORT_FILENAME),
          "utf8"
        );
        const reportJson = await readFile(
          join(result.sandboxDir, GATE2_CONSTANTS.RESULTS_JSON_FILENAME),
          "utf8"
        );
        const feedbackXml = await readFile(
          join(result.sandboxDir, GATE2_CONSTANTS.FEEDBACK_XML_FILENAME),
          "utf8"
        );

        expect(reportMd).toContain("# Gate 2: Adversarial Challenger Red-Team Report");
        expect(reportJson).toContain("PASSED_NO_BREAK");
        expect(feedbackXml).toContain("<challenger-feedback");
      }
    });

    it("emits expected lifecycle events during run()", async () => {
      const events: string[] = [];

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        probes: [],
      });

      challenger.on(GATE2_CONSTANTS.EVENT_CHALLENGE_START, () =>
        events.push(GATE2_CONSTANTS.EVENT_CHALLENGE_START)
      );
      challenger.on(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED, () =>
        events.push(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED)
      );
      challenger.on(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE, () =>
        events.push(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE)
      );

      await challenger.run();

      expect(events).toContain(GATE2_CONSTANTS.EVENT_CHALLENGE_START);
      expect(events).toContain(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED);
      expect(events).toContain(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE);
    });

    it("runGate2Challenger helper runs challenge and returns result", async () => {
      const result = await runGate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        probes: [],
      });

      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
    });
  });

  describe("Custom Error Classes", () => {
    it("instantiates custom error classes with proper fields", () => {
      const baseErr = new Gate2ChallengerError("base message", "ERR_CODE", { key: "val" });
      expect(baseErr.name).toBe("Gate2ChallengerError");
      expect(baseErr.code).toBe("ERR_CODE");
      expect(baseErr.details).toEqual({ key: "val" });

      const timeoutErr = new Gate2TimeoutError(5000);
      expect(timeoutErr.name).toBe("Gate2TimeoutError");
      expect(timeoutErr.timeoutMs).toBe(5000);

      const dispatchErr = new Gate2SubagentDispatchError("dispatch failed");
      expect(dispatchErr.name).toBe("Gate2SubagentDispatchError");

      const probeErr = new Gate2ProbeExecutionError("p1", 1, "failed probe");
      expect(probeErr.name).toBe("Gate2ProbeExecutionError");
      expect(probeErr.probeId).toBe("p1");
      expect(probeErr.exitCode).toBe(1);
    });
  });
});
