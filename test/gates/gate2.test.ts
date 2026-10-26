/**
 * Unit Test Suite for Gate 2: Adversarial Challenger Red-Team Fuzzing and Stress Test Runner.
 *
 * Validates the adversarial challenger orchestrator, automated edge-case synthesis,
 * red-team assertion injection, rollback/retention protocols, FSM event mapping,
 * and structured XML feedback mechanisms implemented in `src/gates/gate2_challenger.ts`,
 * `src/gates/gate2_synthesis.ts`, and `src/gates/gate2_injector.ts` in accordance with
 * OpenSpec change `looper-gate2-adversarial-challenger` Task 1.4 and
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.4 (LOOPER-GATE-003).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATE2_CONSTANTS,
  GATE2_INJECTOR_CONSTANTS,
  GATE2_SYNTHESIS_CONSTANTS,
  Gate2AssertionInjector,
  Gate2Challenger,
  Gate2ChallengerError,
  Gate2InjectionError,
  Gate2InjectorError,
  Gate2ProbeExecutionError,
  Gate2RollbackError,
  Gate2SandboxError,
  Gate2SubagentDispatchError,
  Gate2TimeoutError,
  TestingSandbox,
  createAssertionInjector,
  createEdgeCaseSynthesizer,
  createGate2Challenger,
  createTestingSandbox,
  defaultProbeRunner,
  extractProbeErrorTrace,
  extractTargetFileExports,
  formatAssertionFeedbackXml,
  formatAssertionReportMarkdown,
  formatChallengeReportMarkdown,
  formatChallengerPrompt,
  generateGate2Feedback,
  parseTargetFile,
  resolveGate2RecommendedEvent,
  runGate2Challenger,
  sanitizeProbeName,
  synthesizeBoundaryLimitCases,
  synthesizeConcurrencyCases,
  synthesizeEdgeCases,
  synthesizeGenericEdgeCases,
  synthesizeNullEdgeCases,
  synthesizeTimeoutCases,
  type AssertionInjectionResult,
  type Gate2AttackVector,
  type Gate2ChallengeReport,
  type Gate2ChallengeResult,
  type Gate2ChallengerOptions,
  type Gate2ExecutionContext,
  type Gate2ProbeDefinition,
  type Gate2ProbeResult,
  type Gate2ProbeRunSummary,
  type Gate2StructuredFeedback,
  type Gate2Verdict,
  type InjectionSuiteResult,
  type RedTeamAssertion,
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

/**
 * Central test constants ensuring zero magic numbers across Gate 2 test suite.
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
  PROBE_EXECUTION_TIMEOUT_MS: 5_000,
  LONG_TIMEOUT_MS: 300_000,
  PROBE_TIMEOUT_MS: 30_000,
  ATTEMPT_INITIAL: 1,
  ATTEMPT_RETRY: 2,
  ATTEMPT_MAX: 2,
  ATTEMPT_EXHAUSTED: 2,
  ATTEMPT_OVER_MAX: 3,
  EXIT_SUCCESS: 0,
  EXIT_FAILURE: 1,
  EXIT_ERROR: 2,
  EXIT_TIMEOUT: 124,
  RANDOM_SLICE_START: 2,
  RANDOM_SLICE_END: 8,
  MAX_PROBES_DEFAULT: 20,
  TEMPERATURE_DEFAULT: 0.2,
  EXPECTED_PROBES_COUNT_TWO: 2,
  EXPECTED_BREAKING_COUNT_ONE: 1,
  EXPECTED_PASSING_COUNT_ONE: 1,
  TOKEN_USAGE_PROMPT: 150,
  TOKEN_USAGE_COMPLETION: 50,
  TOKEN_USAGE_TOTAL: 200,
  MAX_CONTEXT_TOKENS: 200_000,
  MAX_OUTPUT_TOKENS: 8_192,
  RATE_LIMIT_REQUESTS: 100,
  RATE_LIMIT_TOKENS: 100_000,
  RATE_LIMIT_RESET_OFFSET_MS: 60_000,
  INDEX_FIRST: 0,
  TRUNCATION_LIMIT: 2_500,
  TRUNCATION_ALLOWANCE_MARGIN: 50,
} as const;

describe("Gate 2: Adversarial Challenger Red-Team Fuzzing and Stress Test Suite (Task 1.4)", () => {
  const tempDirsToClean: string[] = [];
  let currentTestWorkspace: string;
  let currentTestDir: string;

  beforeEach(async () => {
    currentTestWorkspace = await createTempWorkspace();
    currentTestDir = join(currentTestWorkspace, GATE2_CONSTANTS.DEFAULT_TEST_DIR);
    await mkdir(currentTestDir, { recursive: true });
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
      `gate2-test-${Date.now()}-${Math.random().toString(36).slice(TEST_CONSTANTS.RANDOM_SLICE_START, TEST_CONSTANTS.RANDOM_SLICE_END)}`
    );
    await mkdir(dir, { recursive: true });
    tempDirsToClean.push(dir);
    return dir;
  }

  // ==========================================================================
  // 1. CONSTANTS INTEGRITY & ZERO MAGIC NUMBERS
  // ==========================================================================
  describe("GATE2_CONSTANTS", () => {
    it("exposes canonical challenge verdicts", () => {
      expect(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK).toBe("PASSED_NO_BREAK");
      expect(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE).toBe("REPRODUCED_FAILURE");
      expect(GATE2_CONSTANTS.VERDICT_TIMEOUT).toBe("TIMEOUT");
      expect(GATE2_CONSTANTS.VERDICT_ERROR).toBe("ERROR");
    });

    it("exposes recommended FSM domain events", () => {
      expect(GATE2_CONSTANTS.EVENT_G2_PASS).toBe(LOOPER_EVENTS.EVT_G2_PASS);
      expect(GATE2_CONSTANTS.EVENT_G2_BREAK).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      expect(GATE2_CONSTANTS.EVENT_G2_EXHAUSTED).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);
    });

    it("exposes associated FSM states", () => {
      expect(GATE2_CONSTANTS.STATE_GATE_2_CHALLENGE).toBe(LOOPER_STATES.STATE_GATE_2_CHALLENGE);
      expect(GATE2_CONSTANTS.STATE_GATE_3_AUDIT).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
      expect(GATE2_CONSTANTS.STATE_EXECUTE_WORKER).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);
      expect(GATE2_CONSTANTS.STATE_ESCALATE_DIAGNOSTIC).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);
    });

    it("defines default attempt budgets, timeouts, and execution limits", () => {
      expect(GATE2_CONSTANTS.DEFAULT_ATTEMPT).toBe(TEST_CONSTANTS.ATTEMPT_INITIAL);
      expect(GATE2_CONSTANTS.DEFAULT_MAX_ATTEMPTS).toBe(TEST_CONSTANTS.ATTEMPT_MAX);
      expect(GATE2_CONSTANTS.DEFAULT_GATE_TIMEOUT_MS).toBe(TEST_CONSTANTS.LONG_TIMEOUT_MS);
      expect(GATE2_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS).toBe(TEST_CONSTANTS.PROBE_TIMEOUT_MS);
      expect(GATE2_CONSTANTS.DEFAULT_MAX_PROBES).toBe(TEST_CONSTANTS.MAX_PROBES_DEFAULT);
      expect(GATE2_CONSTANTS.DEFAULT_TEMPERATURE).toBe(TEST_CONSTANTS.TEMPERATURE_DEFAULT);
    });

    it("defines canonical red-team adversarial attack vectors", () => {
      expect(GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED).toBe("boundary_malformed");
      expect(GATE2_CONSTANTS.VECTOR_CONCURRENCY_RACE).toBe("concurrency_race");
      expect(GATE2_CONSTANTS.VECTOR_RESOURCE_EXHAUSTION).toBe("resource_exhaustion");
      expect(GATE2_CONSTANTS.VECTOR_TIMEOUT_LATENCY).toBe("timeout_latency");
      expect(GATE2_CONSTANTS.VECTOR_CUSTOM).toBe("custom");
    });

    it("defines standard filenames, prefixes, and teamwork directories", () => {
      expect(GATE2_CONSTANTS.DEFAULT_TEAMWORK_DIR).toBe(".agents/teamwork");
      expect(GATE2_CONSTANTS.DEFAULT_TEST_DIR).toBe("test");
      expect(GATE2_CONSTANTS.PROBE_FILE_PREFIX).toBe("challenger_");
      expect(GATE2_CONSTANTS.PROBE_FILE_EXTENSION).toBe(".test.ts");
      expect(GATE2_CONSTANTS.REPRO_SCRIPT_PREFIX).toBe("challenger_repro_");
      expect(GATE2_CONSTANTS.REPORT_FILENAME).toBe("challenge_report.md");
      expect(GATE2_CONSTANTS.RESULTS_JSON_FILENAME).toBe("challenge_results.json");
      expect(GATE2_CONSTANTS.FEEDBACK_XML_FILENAME).toBe("challenger_feedback.xml");
    });

    it("defines cognitive role, archetype, tier, and default model", () => {
      expect(GATE2_CONSTANTS.ROLE_CHALLENGER).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(GATE2_CONSTANTS.ARCHETYPE_CHALLENGER).toBe("Adversarial Challenger");
      expect(GATE2_CONSTANTS.TIER_CHALLENGER).toBe(5);
      expect(GATE2_CONSTANTS.DEFAULT_PROVIDER).toBe("claude");
      expect(GATE2_CONSTANTS.DEFAULT_MODEL).toBe("claude-3-7-sonnet-20250219");
    });

    it("defines canonical process exit codes", () => {
      expect(GATE2_CONSTANTS.EXIT_CODE_SUCCESS).toBe(TEST_CONSTANTS.EXIT_SUCCESS);
      expect(GATE2_CONSTANTS.EXIT_CODE_FAILURE).toBe(TEST_CONSTANTS.EXIT_FAILURE);
      expect(GATE2_CONSTANTS.EXIT_CODE_ERROR).toBe(TEST_CONSTANTS.EXIT_ERROR);
      expect(GATE2_CONSTANTS.EXIT_CODE_TIMEOUT).toBe(TEST_CONSTANTS.EXIT_TIMEOUT);
    });

    it("defines lifecycle event emitter names", () => {
      expect(GATE2_CONSTANTS.EVENT_CHALLENGE_START).toBe("challenge:start");
      expect(GATE2_CONSTANTS.EVENT_SUBAGENT_DISPATCHED).toBe("challenge:subagent_dispatched");
      expect(GATE2_CONSTANTS.EVENT_PROBE_START).toBe("challenge:probe_start");
      expect(GATE2_CONSTANTS.EVENT_PROBE_COMPLETE).toBe("challenge:probe_complete");
      expect(GATE2_CONSTANTS.EVENT_BREAKING_PROBE_FOUND).toBe("challenge:breaking_probe_found");
      expect(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED).toBe("challenge:verdict_resolved");
      expect(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE).toBe("challenge:complete");
      expect(GATE2_CONSTANTS.EVENT_CHALLENGE_ERROR).toBe("challenge:error");
    });
  });

  // ==========================================================================
  // 2. ERROR TAXONOMY
  // ==========================================================================
  describe("Custom Error Classes", () => {
    it("instantiates Gate2ChallengerError with code and details", () => {
      const error = new Gate2ChallengerError("Base challenge error", "ERR_CODE", { key: "val" });
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("Gate2ChallengerError");
      expect(error.message).toBe("Base challenge error");
      expect(error.code).toBe("ERR_CODE");
      expect(error.details).toEqual({ key: "val" });
    });

    it("instantiates Gate2TimeoutError with timeoutMs and default or custom message", () => {
      const defaultTimeoutError = new Gate2TimeoutError(TEST_CONSTANTS.SHORT_TIMEOUT_MS);
      expect(defaultTimeoutError).toBeInstanceOf(Gate2ChallengerError);
      expect(defaultTimeoutError.name).toBe("Gate2TimeoutError");
      expect(defaultTimeoutError.code).toBe("GATE2_TIMEOUT_EXCEEDED");
      expect(defaultTimeoutError.timeoutMs).toBe(TEST_CONSTANTS.SHORT_TIMEOUT_MS);
      expect(defaultTimeoutError.message).toContain("50ms");

      const customTimeoutError = new Gate2TimeoutError(
        TEST_CONSTANTS.MOCK_TIMEOUT_MS,
        "Custom probe timeout triggered"
      );
      expect(customTimeoutError.message).toBe("Custom probe timeout triggered");
      expect(customTimeoutError.timeoutMs).toBe(TEST_CONSTANTS.MOCK_TIMEOUT_MS);
    });

    it("instantiates Gate2SubagentDispatchError with code and details", () => {
      const error = new Gate2SubagentDispatchError("Dispatch failure", { role: "challenger" });
      expect(error).toBeInstanceOf(Gate2ChallengerError);
      expect(error.name).toBe("Gate2SubagentDispatchError");
      expect(error.code).toBe("GATE2_SUBAGENT_DISPATCH_FAILED");
      expect(error.details).toEqual({ role: "challenger" });
    });

    it("instantiates Gate2ProbeExecutionError with probeId and exitCode", () => {
      const error = new Gate2ProbeExecutionError(
        "probe_123",
        TEST_CONSTANTS.EXIT_FAILURE,
        "Execution crashed",
        { signal: "SIGSEGV" }
      );
      expect(error).toBeInstanceOf(Gate2ChallengerError);
      expect(error.name).toBe("Gate2ProbeExecutionError");
      expect(error.probeId).toBe("probe_123");
      expect(error.exitCode).toBe(TEST_CONSTANTS.EXIT_FAILURE);
      expect(error.code).toBe("GATE2_PROBE_EXECUTION_FAILED");
      expect(error.details).toEqual({ signal: "SIGSEGV" });
    });

    it("instantiates Gate2SandboxError with code and details", () => {
      const error = new Gate2SandboxError("Sandbox creation failed", { path: "/tmp/invalid" });
      expect(error).toBeInstanceOf(Gate2ChallengerError);
      expect(error.name).toBe("Gate2SandboxError");
      expect(error.code).toBe("GATE2_SANDBOX_ERROR");
      expect(error.details).toEqual({ path: "/tmp/invalid" });
    });

    it("instantiates re-exported injector error classes", () => {
      const injectorErr = new Gate2InjectorError("Injector failed", "INJ_ERR", { target: "a.ts" });
      expect(injectorErr.name).toBe("Gate2InjectorError");
      expect(injectorErr.code).toBe("INJ_ERR");

      const injectionErr = new Gate2InjectionError("Injection failed", { mode: "inline" });
      expect(injectionErr.name).toBe("Gate2InjectionError");
      expect(injectionErr.code).toBe("GATE2_INJECTION_FAILED");
      expect(injectionErr.details).toEqual({ mode: "inline" });

      const rollbackErr = new Gate2RollbackError("Rollback failed", { reason: "locked" });
      expect(rollbackErr.name).toBe("Gate2RollbackError");
      expect(rollbackErr.code).toBe("GATE2_ROLLBACK_FAILED");
      expect(rollbackErr.details).toEqual({ reason: "locked" });
    });
  });

  // ==========================================================================
  // 3. UTILITY FUNCTIONS & SANITIZERS
  // ==========================================================================
  describe("Utility Functions & Sanitizers", () => {
    describe("sanitizeProbeName", () => {
      it("normalizes special characters, spaces, and punctuation to underscores", () => {
        expect(sanitizeProbeName("null-pointer.check")).toBe("null-pointer_check");
        expect(sanitizeProbeName("Fuzz_Payload!@#$123")).toBe("fuzz_payload____123");
        expect(sanitizeProbeName("Boundary Test Probes (2^31)")).toBe("boundary_test_probes__2_31_");
      });

      it("returns default fallback when given empty, null, or invalid input", () => {
        expect(sanitizeProbeName("")).toBe("probe");
        expect(sanitizeProbeName(null as unknown as string)).toBe("probe");
        expect(sanitizeProbeName(undefined as unknown as string)).toBe("probe");
      });
    });

    describe("extractProbeErrorTrace", () => {
      it("isolates relevant error lines, expect failures, and stack traces", () => {
        const stdout = "Running test...\n✓ Setup completed successfully\nRunning boundary probe...";
        const stderr =
          "TypeError: Cannot read properties of null (reading 'length')\n" +
          "    at Object.validate (src/target.ts:15:20)\n" +
          "    at Object.test (test/challenger_null.test.ts:8:5)\n" +
          "Assertion failed: expected false to be true";

        const trace = extractProbeErrorTrace(stdout, stderr);
        expect(trace).toContain("TypeError: Cannot read properties of null");
        expect(trace).toContain("at Object.validate");
        expect(trace).toContain("Assertion failed");
      });

      it("returns default explanation when both stdout and stderr are empty", () => {
        const trace = extractProbeErrorTrace("", "");
        expect(trace).toBe("Test probe exited with non-zero exit code but emitted empty logs.");
      });

      it("truncates extremely large logs exceeding feedback truncation limit when no keywords match", () => {
        const hugeStderr = "Non-keyword log content line 1\n" + "x".repeat(5_000);
        const trace = extractProbeErrorTrace("", hugeStderr);
        expect(trace.length).toBeLessThanOrEqual(
          TEST_CONSTANTS.TRUNCATION_LIMIT + TEST_CONSTANTS.TRUNCATION_ALLOWANCE_MARGIN
        );
        expect(trace).toContain("... [truncated]");
      });

      it("limits relevant error lines following keyword match to max probe cap", () => {
        const lines = [
          "Error: initial failure",
          ...Array.from({ length: 30 }, (_, i) => `   context detail line ${i}`),
        ];
        const trace = extractProbeErrorTrace("", lines.join("\n"));
        expect(trace).toContain("Error: initial failure");
        expect(trace.split("\n").length).toBeLessThanOrEqual(
          TEST_CONSTANTS.MAX_PROBES_DEFAULT + TEST_CONSTANTS.ONE
        );
      });
    });

    describe("resolveGate2RecommendedEvent", () => {
      it("returns EVT_G2_PASS when verdict is PASSED_NO_BREAK", () => {
        const event = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
          TEST_CONSTANTS.ATTEMPT_INITIAL,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(event).toBe(LOOPER_EVENTS.EVT_G2_PASS);
      });

      it("returns EVT_G2_BREAK when broken and attempt < maxAttempts", () => {
        const event = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
          TEST_CONSTANTS.ATTEMPT_INITIAL,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(event).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      });

      it("returns EVT_G2_EXHAUSTED when broken and attempt >= maxAttempts", () => {
        const event = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
          TEST_CONSTANTS.ATTEMPT_EXHAUSTED,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(event).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);

        const overMax = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
          TEST_CONSTANTS.ATTEMPT_OVER_MAX,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(overMax).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);
      });

      it("returns EVT_G2_BREAK for timeout or error verdicts when attempts remain", () => {
        const timeoutEvent = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_TIMEOUT,
          TEST_CONSTANTS.ATTEMPT_INITIAL,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(timeoutEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);

        const errorEvent = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_ERROR,
          TEST_CONSTANTS.ATTEMPT_INITIAL,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(errorEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      });

      it("returns EVT_G2_EXHAUSTED for timeout or error verdicts when attempts are exhausted", () => {
        const timeoutExhausted = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_TIMEOUT,
          TEST_CONSTANTS.ATTEMPT_EXHAUSTED,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(timeoutExhausted).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);

        const errorExhausted = resolveGate2RecommendedEvent(
          GATE2_CONSTANTS.VERDICT_ERROR,
          TEST_CONSTANTS.ATTEMPT_EXHAUSTED,
          TEST_CONSTANTS.ATTEMPT_MAX
        );
        expect(errorExhausted).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);
      });
    });
  });

  // ==========================================================================
  // 4. FORMATTERS & XML FEEDBACK GENERATION
  // ==========================================================================
  describe("Formatters and Feedback Generation", () => {
    const mockContext: Gate2ExecutionContext = {
      taskId: "TASK-ADVERSARIAL-001",
      taskDescription: "Implement safe JSON streaming parser resistant to malformed inputs",
      acceptanceCriteria: [
        "Must handle null, undefined, and empty chunks",
        "Must abort cleanly on stream cancellation",
        "Must not crash on 2^31-1 byte strings",
      ],
      targetFiles: ["src/stream_parser.ts"],
      gitDiff: "+export function parseStream() {}",
      attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
      maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
      options: {},
    };

    it("formatChallengerPrompt includes role instructions, target parameters, and JSON output schema", () => {
      const prompt = formatChallengerPrompt(mockContext);

      expect(prompt).toContain("Gate 2: Adversarial Challenger Red-Team Instructions");
      expect(prompt).toContain("Adversarial Challenger (Tier 5)");
      expect(prompt).toContain("Target Task: TASK-ADVERSARIAL-001");
      expect(prompt).toContain("Implement safe JSON streaming parser");
      expect(prompt).toContain("Must handle null, undefined, and empty chunks");
      expect(prompt).toContain("`src/stream_parser.ts`");
      expect(prompt).toContain("+export function parseStream() {}");
      expect(prompt).toContain("1. Boundary & Malformed Inputs");
      expect(prompt).toContain("2. Concurrency & Race Conditions");
      expect(prompt).toContain("3. Resource Limits");
      expect(prompt).toContain("4. Timeout & Slow Responses");
      expect(prompt).toContain('"verdict": "PASSED_NO_BREAK" | "REPRODUCED_FAILURE"');
    });

    it("formatChallengeReportMarkdown compiles execution metrics, table rows, and minimal reproductions", () => {
      const report: Gate2ChallengeReport = {
        verdict: GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
        summary: "Candidate crashed on null byte sequence in stream header.",
        totalProbes: TEST_CONSTANTS.TWO,
        survivedCount: TEST_CONSTANTS.ONE,
        brokenCount: TEST_CONSTANTS.ONE,
        results: [
          {
            probeId: "null_byte_probe",
            name: "Null Byte Stream Injection",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Passes null bytes to stream header",
            survived: false,
            broken: true,
            exitCode: TEST_CONSTANTS.EXIT_FAILURE,
            stdout: "",
            stderr: "TypeError: Cannot read properties of null",
            errorOutput: "TypeError: Cannot read properties of null at parseHeader (parser.ts:25)",
            durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
            probeFilePath: "test/challenger_null_byte_probe.test.ts",
            preservedReproPath: "test/challenger_repro_null_byte_probe.test.ts",
          },
          {
            probeId: "max_integer_probe",
            name: "Max Safe Integer Offset",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Passes Number.MAX_SAFE_INTEGER offset",
            survived: true,
            broken: false,
            exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
            stdout: "✓ passed",
            stderr: "",
            durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
            probeFilePath: "test/challenger_max_integer_probe.test.ts",
          },
        ],
        breakingProbes: [
          {
            probeId: "null_byte_probe",
            name: "Null Byte Stream Injection",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Passes null bytes to stream header",
            survived: false,
            broken: true,
            exitCode: TEST_CONSTANTS.EXIT_FAILURE,
            stdout: "",
            stderr: "TypeError: Cannot read properties of null",
            errorOutput: "TypeError: Cannot read properties of null at parseHeader (parser.ts:25)",
            durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
            preservedReproPath: "test/challenger_repro_null_byte_probe.test.ts",
          },
        ],
        reproScripts: ["test/challenger_repro_null_byte_probe.test.ts"],
        unhandledFailures: ["Null Byte Stream Injection: TypeError: Cannot read properties of null"],
      };

      const markdown = formatChallengeReportMarkdown(report, "TASK-ADVERSARIAL-001");
      expect(markdown).toContain("Gate 2: Adversarial Challenger Red-Team Report");
      expect(markdown).toContain("Task ID**: `TASK-ADVERSARIAL-001`");
      expect(markdown).toContain("Verdict**: **`REPRODUCED_FAILURE`**");
      expect(markdown).toContain("| **Total Probes Executed** | `2` |");
      expect(markdown).toContain("| **Survived (Passed)** | `1` |");
      expect(markdown).toContain("| **Broken (Failures Found)** | `1` |");
      expect(markdown).toContain("💥 BROKEN");
      expect(markdown).toContain("✅ SURVIVED");
      expect(markdown).toContain("💥 Breaking Test Probes (Minimal Reproductions)");
      expect(markdown).toContain("Reproduction Script**: `test/challenger_repro_null_byte_probe.test.ts`");
      expect(markdown).toContain("TypeError: Cannot read properties of null at parseHeader");
    });

    it("generateGate2Feedback produces structured XML feedback with vector-specific recommendations", () => {
      const breakingReport: Gate2ChallengeReport = {
        verdict: GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE,
        summary: "Candidate failed under race condition and boundary inputs.",
        totalProbes: TEST_CONSTANTS.TWO,
        survivedCount: TEST_CONSTANTS.ZERO,
        brokenCount: TEST_CONSTANTS.TWO,
        results: [],
        breakingProbes: [
          {
            probeId: "probe_boundary",
            name: "Boundary Probe",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Boundary test",
            survived: false,
            broken: true,
            exitCode: TEST_CONSTANTS.EXIT_FAILURE,
            stdout: "",
            stderr: "Error: boundary",
            errorOutput: "Error: boundary",
            durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
            preservedReproPath: "test/challenger_repro_boundary.test.ts",
          },
          {
            probeId: "probe_race",
            name: "Race Condition Probe",
            vector: GATE2_CONSTANTS.VECTOR_CONCURRENCY_RACE,
            description: "Race condition test",
            survived: false,
            broken: true,
            exitCode: TEST_CONSTANTS.EXIT_FAILURE,
            stdout: "",
            stderr: "Error: race",
            errorOutput: "Error: race",
            durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
            preservedReproPath: "test/challenger_repro_race.test.ts",
          },
        ],
        reproScripts: [
          "test/challenger_repro_boundary.test.ts",
          "test/challenger_repro_race.test.ts",
        ],
        unhandledFailures: ["Error: boundary", "Error: race"],
      };

      const feedback = generateGate2Feedback(breakingReport, {
        taskId: "TASK-FEEDBACK-001",
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
      });

      expect(feedback.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(feedback.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      expect(feedback.targetFsmState).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);
      expect(feedback.breakingProbeCount).toBe(TEST_CONSTANTS.TWO);
      expect(feedback.reproScriptPaths).toHaveLength(TEST_CONSTANTS.TWO);

      const xml = feedback.xmlFeedback;
      expect(xml).toContain('<challenger-feedback timestamp="');
      expect(xml).toContain("<task-id>TASK-FEEDBACK-001</task-id>");
      expect(xml).toContain("<attempt>1</attempt>");
      expect(xml).toContain("<max-attempts>2</max-attempts>");
      expect(xml).toContain("<verdict>REPRODUCED_FAILURE</verdict>");
      expect(xml).toContain("<recommended-event>EVT_G2_BREAK</recommended-event>");
      expect(xml).toContain("<target-fsm-state>STATE_EXECUTE_WORKER</target-fsm-state>");
      expect(xml).toContain('<breaking-probes count="2">');
      expect(xml).toContain('<probe id="probe_boundary" vector="boundary_malformed">');
      expect(xml).toContain("<reproduction-file>test/challenger_repro_boundary.test.ts</reproduction-file>");
      expect(xml).toContain("Harden input validation in Boundary Probe");
      expect(xml).toContain("Fix race condition in Race Condition Probe");
    });

    it("generateGate2Feedback formats clean XML for successful challenge pass", () => {
      const passedReport: Gate2ChallengeReport = {
        verdict: GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
        summary: "Candidate survived all probes.",
        totalProbes: TEST_CONSTANTS.FIVE,
        survivedCount: TEST_CONSTANTS.FIVE,
        brokenCount: TEST_CONSTANTS.ZERO,
        results: [],
        breakingProbes: [],
        reproScripts: [],
        unhandledFailures: [],
      };

      const feedback = generateGate2Feedback(passedReport, {
        taskId: "TASK-FEEDBACK-002",
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
      });

      expect(feedback.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(feedback.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_PASS);
      expect(feedback.targetFsmState).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
      expect(feedback.breakingProbeCount).toBe(TEST_CONSTANTS.ZERO);
      expect(feedback.xmlFeedback).toContain("<verdict>PASSED_NO_BREAK</verdict>");
      expect(feedback.xmlFeedback).toContain("<recommended-event>EVT_G2_PASS</recommended-event>");
      expect(feedback.recommendations[TEST_CONSTANTS.ZERO]).toContain(
        "Implementation successfully withstood all adversarial red-team stress vectors"
      );
    });
  });

  // ==========================================================================
  // 5. AUTOMATED EDGE-CASE SYNTHESIS ENGINE INTEGRATION
  // ==========================================================================
  describe("Automated Edge-Case Synthesis Engine", () => {
    const sampleSourceCode = `
      export function calculateDiscount(price: number, percentage: number): number {
        return price * (percentage / 100);
      }

      export async function fetchUserData(userId: string): Promise<{ id: string }> {
        return { id: userId };
      }

      export const parsePayload = (data: unknown) => {
        return JSON.parse(String(data));
      };

      export class TokenVault {
        public verify(token: string): boolean {
          return token.length > 0;
        }
      }
    `;

    it("extractTargetFileExports parses functions, async functions, arrow exports, and classes", () => {
      const targetInfo = extractTargetFileExports(sampleSourceCode, "src/calculator.ts");
      expect(targetInfo.filePath).toBe("src/calculator.ts");
      expect(targetInfo.exports.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.FOUR);

      const fnNames = targetInfo.exports.map((e) => e.name);
      expect(fnNames).toContain("calculateDiscount");
      expect(fnNames).toContain("fetchUserData");
      expect(fnNames).toContain("parsePayload");
      expect(fnNames).toContain("TokenVault");
    });

    it("synthesizeBoundaryLimitCases generates extreme numeric and string limit test probes", () => {
      const targetInfo = extractTargetFileExports(sampleSourceCode, "src/calculator.ts");
      const boundaryCases = synthesizeBoundaryLimitCases(targetInfo, {
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
      });

      expect(boundaryCases.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.ONE);
      const probeCodes = boundaryCases.map((c) => c.probeCode).join("\n");
      expect(probeCodes).toContain("2147483647"); // 2^31 - 1
      expect(probeCodes).toContain("9007199254740991"); // Number.MAX_SAFE_INTEGER
    });

    it("synthesizeNullEdgeCases generates null, undefined, and empty payload test probes", () => {
      const targetInfo = extractTargetFileExports(sampleSourceCode, "src/calculator.ts");
      const nullCases = synthesizeNullEdgeCases(targetInfo, {
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
      });

      expect(nullCases.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.ONE);
      const probeCodes = nullCases.map((c) => c.probeCode).join("\n");
      expect(probeCodes).toContain("null");
      expect(probeCodes).toContain("undefined");
    });

    it("synthesizeConcurrencyCases generates parallel invocation and race condition probes", () => {
      const targetInfo = extractTargetFileExports(sampleSourceCode, "src/calculator.ts");
      const concurrencyCases = synthesizeConcurrencyCases(targetInfo, {
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
      });

      expect(concurrencyCases.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.ONE);
      const probeCodes = concurrencyCases.map((c) => c.probeCode).join("\n");
      expect(probeCodes).toContain("Promise.all");
    });

    it("synthesizeTimeoutCases generates watchdog and slow response probes", () => {
      const targetInfo = extractTargetFileExports(sampleSourceCode, "src/calculator.ts");
      const timeoutCases = synthesizeTimeoutCases(targetInfo, {
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
      });

      expect(timeoutCases.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.ONE);
      const probeCodes = timeoutCases.map((c) => c.probeCode).join("\n");
      expect(probeCodes).toContain("watchdog");
    });

    it("synthesizeGenericEdgeCases produces fallback probes when target file has no AST exports", () => {
      const fallbackProbes = synthesizeGenericEdgeCases({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
      });
      expect(fallbackProbes.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.ONE);
      expect(fallbackProbes.some((p) => p.id.includes("generic_null"))).toBe(true);
      expect(fallbackProbes.some((p) => p.id.includes("generic_boundary"))).toBe(true);
    });

    it("createEdgeCaseSynthesizer synthesizes probes across all categories for candidate context", async () => {
      const targetFilePath = join(currentTestWorkspace, "src", "service.ts");
      await mkdir(join(currentTestWorkspace, "src"), { recursive: true });
      await writeFile(targetFilePath, sampleSourceCode, "utf8");

      const synthesizer = createEdgeCaseSynthesizer({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
      });

      const probes = await synthesizer.synthesizeForContext({
        taskId: "TASK-SYNTH-001",
        acceptanceCriteria: [],
        targetFiles: ["src/service.ts"],
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        options: {},
      });

      expect(probes.length).toBeGreaterThan(TEST_CONSTANTS.ZERO);
      const vectors = new Set(probes.map((p) => p.vector));
      expect(vectors.has(GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED)).toBe(true);
      expect(vectors.has(GATE2_CONSTANTS.VECTOR_CONCURRENCY_RACE)).toBe(true);
    });
  });

  // ==========================================================================
  // 6. RED-TEAM ASSERTION INJECTOR & TESTING SANDBOX
  // ==========================================================================
  describe("Red-Team Assertion Injector & Testing Sandbox", () => {
    it("TestingSandbox creates sandbox directory, injects probes, and cleans up cleanly", async () => {
      const sandboxDir = join(currentTestWorkspace, ".sandbox-test");
      const sandbox = new TestingSandbox({
        workspaceRoot: currentTestWorkspace,
        sandboxDir,
        permanentTestDir: currentTestDir,
      });

      const initializedDir = await sandbox.initialize();
      expect(sandbox.getIsInitialized()).toBe(true);
      expect(initializedDir).toBe(sandboxDir);

      const assertion: RedTeamAssertion = {
        id: "probe_standalone_test",
        name: "Standalone Test Probe",
        vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
        description: "Asserts sandbox standalone injection",
        assertionCode: "import { test, expect } from 'bun:test'; test('dummy', () => expect(true).toBe(true));",
      };

      const injectedFile = await sandbox.injectStandalone(assertion);
      expect(injectedFile).toBeDefined();

      const existsBefore = await stat(injectedFile).then(() => true).catch(() => false);
      expect(existsBefore).toBe(true);

      await sandbox.cleanup();
      const existsAfter = await stat(sandboxDir).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it("Clean Rollback Protocol: automatically removes probe when candidate survives (exitCode 0)", async () => {
      const mockProbeRunner = async () => {
        return { stdout: "✓ all tests passed", stderr: "", exitCode: TEST_CONSTANTS.EXIT_SUCCESS };
      };

      const injector = new Gate2AssertionInjector({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockProbeRunner,
        autoRollbackOnPass: true,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_survived_clean",
        name: "Surviving Probe",
        vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
        description: "Probe candidate survives",
        assertionCode: "import { test, expect } from 'bun:test'; test('survives', () => expect(1).toBe(1));",
      };

      const result = await injector.runAssertion(assertion);
      expect(result.survived).toBe(true);
      expect(result.broken).toBe(false);
      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_SUCCESS);
      expect(result.status).toBe("rolled_back");
      expect(result.rolledBack).toBe(true);
      expect(result.retained).toBe(false);

      // Verify that the temporary probe file was rolled back / deleted
      const probeExists = await stat(result.injectedFilePath).then(() => true).catch(() => false);
      expect(probeExists).toBe(false);
    });

    it("Permanent Retention Protocol: permanently preserves breaking probe when candidate breaks (exitCode != 0)", async () => {
      const mockBreakingRunner = async () => {
        return {
          stdout: "",
          stderr: "TypeError: candidate crashed on null payload",
          exitCode: TEST_CONSTANTS.EXIT_FAILURE,
        };
      };

      const injector = new Gate2AssertionInjector({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        permanentTestDir: currentTestDir,
        probeRunner: mockBreakingRunner,
        preserveBreakingProbes: true,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_breaking_null_retention",
        name: "Breaking Null Probe",
        vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
        description: "Breaks with TypeError",
        assertionCode: "import { test, expect } from 'bun:test'; test('crashes', () => expect(null).toBeDefined());",
      };

      const result = await injector.runAssertion(assertion);
      expect(result.survived).toBe(false);
      expect(result.broken).toBe(true);
      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_FAILURE);
      expect(result.status).toBe("retained");
      expect(result.retained).toBe(true);
      expect(result.permanentReproPath).toBeDefined();

      if (result.permanentReproPath) {
        const reproExists = await stat(result.permanentReproPath).then(() => true).catch(() => false);
        expect(reproExists).toBe(true);

        const content = await readFile(result.permanentReproPath, "utf8");
        expect(content).toContain("test('crashes'");
      }
    });
  });

  // ==========================================================================
  // 7. GATE 2 CHALLENGER ORCHESTRATOR UNIT METHODS
  // ==========================================================================
  describe("Gate2Challenger Orchestrator Unit Methods", () => {
    it("getOptions returns defensive copy of constructor options", () => {
      const options: Gate2ChallengerOptions = {
        taskId: "TASK-OPTIONS-001",
        timeoutMs: TEST_CONSTANTS.LONG_TIMEOUT_MS,
      };
      const challenger = new Gate2Challenger(options);
      const retrieved = challenger.getOptions();

      expect(retrieved.taskId).toBe("TASK-OPTIONS-001");
      expect(retrieved.timeoutMs).toBe(TEST_CONSTANTS.LONG_TIMEOUT_MS);
    });

    it("getAssertionInjector lazily instantiates and caches Gate2AssertionInjector", () => {
      const challenger = new Gate2Challenger({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
      });

      const injector1 = challenger.getAssertionInjector();
      const injector2 = challenger.getAssertionInjector();
      expect(injector1).toBeInstanceOf(Gate2AssertionInjector);
      expect(injector1).toBe(injector2);
    });

    it("executeProbe creates probe file, executes via probeRunner, and marks survived on exit 0", async () => {
      let executedPath = "";
      const mockRunner = async (filePath: string) => {
        executedPath = filePath;
        return { stdout: "✓ Probe Passed", stderr: "", exitCode: TEST_CONSTANTS.EXIT_SUCCESS };
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockRunner,
        autoCleanup: true,
      });

      const probe: Gate2ProbeDefinition = {
        id: "surviving_probe",
        name: "Surviving Test Probe",
        vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
        description: "Candidate survives edge case",
        probeCode: "import { test, expect } from 'bun:test'; test('survives', () => expect(1).toBe(1));",
      };

      const result = await challenger.executeProbe(probe);
      expect(result.probeId).toBe("surviving_probe");
      expect(result.survived).toBe(true);
      expect(result.broken).toBe(false);
      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_SUCCESS);
      expect(executedPath).toContain(GATE2_CONSTANTS.PROBE_FILE_PREFIX);
    });

    it("executeProbe marks broken on non-zero exit code and preserves reproduction script", async () => {
      const mockRunner = async () => {
        return {
          stdout: "",
          stderr: "TypeError: Unhandled exception on malformed payload",
          exitCode: TEST_CONSTANTS.EXIT_FAILURE,
        };
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockRunner,
        preserveBreakingProbes: true,
        autoCleanup: true,
      });

      const probe: Gate2ProbeDefinition = {
        id: "breaking_payload_probe",
        name: "Malformed Payload Probe",
        vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
        description: "Breaks target implementation",
        probeCode: "import { test, expect } from 'bun:test'; test('break', () => { throw new TypeError('crash'); });",
      };

      const result = await challenger.executeProbe(probe);
      expect(result.probeId).toBe("breaking_payload_probe");
      expect(result.survived).toBe(false);
      expect(result.broken).toBe(true);
      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_FAILURE);
      expect(result.preservedReproPath).toBeDefined();

      if (result.preservedReproPath) {
        const reproExists = await stat(result.preservedReproPath).then(() => true).catch(() => false);
        expect(reproExists).toBe(true);
      }
    });

    it("executeProbe catches runner thrown errors and returns error probe result", async () => {
      const throwingRunner = async () => {
        throw new Error("Subprocess spawn failed unexpectedly");
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: throwingRunner,
      });

      const probe: Gate2ProbeDefinition = {
        id: "throwing_probe",
        name: "Throwing Probe",
        vector: GATE2_CONSTANTS.VECTOR_CUSTOM,
        description: "Triggers spawn error",
        probeCode: "invalid code",
      };

      const result = await challenger.executeProbe(probe);
      expect(result.survived).toBe(false);
      expect(result.broken).toBe(true);
      expect(result.exitCode).toBe(GATE2_CONSTANTS.EXIT_CODE_ERROR);
      expect(result.stderr).toContain("Subprocess spawn failed unexpectedly");
    });

    it("runProbes executes a sequence of probes and compiles comprehensive summary", async () => {
      let callCount = 0;
      const alternatingRunner = async () => {
        callCount += 1;
        if (callCount === 1) {
          return { stdout: "✓ Pass", stderr: "", exitCode: TEST_CONSTANTS.EXIT_SUCCESS };
        }
        return { stdout: "", stderr: "💥 Crash", exitCode: TEST_CONSTANTS.EXIT_FAILURE };
      };

      const challenger = new Gate2Challenger({
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: alternatingRunner,
      });

      const probes: Gate2ProbeDefinition[] = [
        {
          id: "probe_1",
          name: "Probe One",
          vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
          description: "Passes",
          probeCode: "test 1",
        },
        {
          id: "probe_2",
          name: "Probe Two",
          vector: GATE2_CONSTANTS.VECTOR_CONCURRENCY_RACE,
          description: "Fails",
          probeCode: "test 2",
        },
      ];

      const summary = await challenger.runProbes(probes);
      expect(summary.totalProbes).toBe(TEST_CONSTANTS.TWO);
      expect(summary.passedProbes).toBe(TEST_CONSTANTS.ONE);
      expect(summary.brokenProbes).toBe(TEST_CONSTANTS.ONE);
      expect(summary.breakingProbes).toHaveLength(TEST_CONSTANTS.ONE);
      expect(summary.breakingProbes[TEST_CONSTANTS.ZERO]?.probeId).toBe("probe_2");
    });
  });

  // ==========================================================================
  // 8. FULL ORCHESTRATION CYCLE (Gate2Challenger.run) & SPEC DELTA REQUIREMENTS
  // ==========================================================================
  describe("Gate2Challenger.run() & OpenSpec Specification Scenarios", () => {
    /**
     * OpenSpec Delta Requirement:
     * "WHEN Candidate implementation crashes on malformed payload
     *  THEN Gate 2 reports an unhandled edge case failure"
     */
    it("Scenario: Candidate implementation crashes on malformed payload -> reports unhandled edge case failure", async () => {
      const mockCrashRunner = async () => {
        return {
          stdout: "RUN challenger_null_crash.test.ts",
          stderr: "TypeError: Unhandled null pointer exception at Object.parsePayload (src/payload.ts:12:15)",
          exitCode: TEST_CONSTANTS.EXIT_FAILURE,
        };
      };

      const challenger = new Gate2Challenger({
        taskId: "OPENSPEC-MALFORMED-001",
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockCrashRunner,
        preserveBreakingProbes: true,
        probes: [
          {
            id: "null_payload_crash",
            name: "Malformed Null Payload Probe",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Asserts safe handling of null payload without crashing",
            probeCode: "import { test, expect } from 'bun:test'; test('null payload crash', () => { throw new TypeError('Unhandled null pointer exception'); });",
          },
        ],
      });

      const result = await challenger.run();

      // OpenSpec assertions
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      expect(result.breakingProbes.length).toBe(TEST_CONSTANTS.ONE);
      expect(result.report.unhandledFailures.length).toBe(TEST_CONSTANTS.ONE);
      expect(result.report.unhandledFailures[TEST_CONSTANTS.ZERO]).toContain("Malformed Null Payload Probe");
      expect(result.report.unhandledFailures[TEST_CONSTANTS.ZERO]).toContain("Unhandled null pointer exception");

      // Verify permanent reproduction test script preservation
      expect(result.reproScripts.length).toBe(TEST_CONSTANTS.ONE);
      const reproPath = result.reproScripts[TEST_CONSTANTS.ZERO];
      expect(reproPath).toBeDefined();
      if (reproPath) {
        const reproExists = await stat(reproPath).then(() => true).catch(() => false);
        expect(reproExists).toBe(true);
      }

      // Verify structured XML feedback produced for the Worker
      expect(result.feedback).toBeDefined();
      expect(result.feedback?.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(result.feedback?.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
      expect(result.feedback?.targetFsmState).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);
      expect(result.feedback?.xmlFeedback).toContain("<reproduction-file>");
      expect(result.feedback?.xmlFeedback).toContain("Unhandled null pointer exception");
    });

    it("passes cleanly with PASSED_NO_BREAK and EVT_G2_PASS when all adversarial probes survive", async () => {
      const mockSuccessRunner = async () => {
        return {
          stdout: "✓ 2 boundary probes passed without failure",
          stderr: "",
          exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
        };
      };

      const challenger = new Gate2Challenger({
        taskId: "OPENSPEC-PASS-001",
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockSuccessRunner,
        probes: [
          {
            id: "probe_boundary_1",
            name: "Boundary Probe 1",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Survives boundary",
            probeCode: "import { test, expect } from 'bun:test'; test('b1', () => expect(1).toBe(1));",
          },
          {
            id: "probe_boundary_2",
            name: "Boundary Probe 2",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Survives boundary 2",
            probeCode: "import { test, expect } from 'bun:test'; test('b2', () => expect(2).toBe(2));",
          },
        ],
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_PASS);
      expect(result.breakingProbes).toHaveLength(TEST_CONSTANTS.ZERO);
      expect(result.reproScripts).toHaveLength(TEST_CONSTANTS.ZERO);
      expect(result.feedback?.targetFsmState).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
    });

    it("escalates to EVT_G2_EXHAUSTED when attempt >= maxAttempts", async () => {
      const mockCrashRunner = async () => ({
        stdout: "",
        stderr: "Crash",
        exitCode: TEST_CONSTANTS.EXIT_FAILURE,
      });

      const challenger = new Gate2Challenger({
        taskId: "OPENSPEC-EXHAUST-001",
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockCrashRunner,
        attempt: TEST_CONSTANTS.ATTEMPT_EXHAUSTED,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        probes: [
          {
            id: "exhaust_probe",
            name: "Exhaustion Probe",
            vector: GATE2_CONSTANTS.VECTOR_TIMEOUT_LATENCY,
            description: "Triggers escalation",
            probeCode: "import { test } from 'bun:test'; test('e', () => { throw new Error('fail'); });",
          },
        ],
      });

      const result = await challenger.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G2_EXHAUSTED);
      expect(result.feedback?.targetFsmState).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);
    });

    it("supports pluggable custom challengerExecutor callback", async () => {
      let customExecutorContext: Gate2ExecutionContext | undefined;

      const customExecutor = async (context: Gate2ExecutionContext): Promise<Gate2ChallengeReport> => {
        customExecutorContext = context;
        return {
          verdict: GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK,
          summary: "Custom challenger verified candidate robustness.",
          totalProbes: TEST_CONSTANTS.THREE,
          survivedCount: TEST_CONSTANTS.THREE,
          brokenCount: TEST_CONSTANTS.ZERO,
          results: [],
          breakingProbes: [],
          reproScripts: [],
          unhandledFailures: [],
        };
      };

      const challenger = new Gate2Challenger({
        taskId: "CUSTOM-EXEC-001",
        workspaceRoot: currentTestWorkspace,
        challengerExecutor: customExecutor,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(result.report.summary).toBe("Custom challenger verified candidate robustness.");
      expect(customExecutorContext?.taskId).toBe("CUSTOM-EXEC-001");
    });

    it("supports pluggable custom edgeCaseSynthesizer callback", async () => {
      const customSynthesizer = async (context: Gate2ExecutionContext): Promise<readonly Gate2ProbeDefinition[]> => {
        return [
          {
            id: "synthesized_probe",
            name: "Dynamically Synthesized Probe",
            vector: GATE2_CONSTANTS.VECTOR_RESOURCE_EXHAUSTION,
            description: "Generated by custom synthesizer",
            probeCode: "import { test, expect } from 'bun:test'; test('synth', () => expect(true).toBe(true));",
          },
        ];
      };

      const mockRunner = async () => ({
        stdout: "✓ passed",
        stderr: "",
        exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
      });

      const challenger = new Gate2Challenger({
        taskId: "CUSTOM-SYNTH-001",
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockRunner,
        edgeCaseSynthesizer: customSynthesizer,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.report.totalProbes).toBe(TEST_CONSTANTS.ONE);
      expect(result.report.results[TEST_CONSTANTS.ZERO]?.probeId).toBe("synthesized_probe");
    });

    it("integrates with PAL IPalProvider executing LLM challenge turn and parsing JSON verdict", async () => {
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
I have tested the candidate implementation with fuzz payloads.

\`\`\`json
{
  "verdict": "PASSED_NO_BREAK",
  "summary": "Implementation withstood all red-team fuzz vectors without error.",
  "probes": [
    {
      "id": "fuzz_json_01",
      "name": "Corrupted JSON Fuzz",
      "vector": "boundary_malformed",
      "description": "Fuzzing corrupted JSON tokens",
      "probeCode": "test code"
    }
  ]
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

      const challenger = new Gate2Challenger({
        taskId: "PAL-INTEG-001",
        workspaceRoot: currentTestWorkspace,
        provider: mockProvider,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(result.report.summary).toContain("Implementation withstood all red-team fuzz vectors");
      expect(turnPrompt).toContain("PAL-INTEG-001");
    });

    it("writes challenge_report.md, challenge_results.json, and challenger_feedback.xml to subagent sandbox folder", async () => {
      const mockRunner = async () => ({
        stdout: "✓ passed",
        stderr: "",
        exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
      });

      const dispatcher = createSubagentDispatcher({
        workspaceRoot: currentTestWorkspace,
        autoCleanup: false,
      });

      const challenger = new Gate2Challenger({
        taskId: "SANDBOX-ARTIFACTS-001",
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockRunner,
        dispatcher,
        autoCleanup: false,
        probes: [
          {
            id: "artifact_probe",
            name: "Artifact Test Probe",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Tests artifact generation",
            probeCode: "import { test, expect } from 'bun:test'; test('a', () => expect(1).toBe(1));",
          },
        ],
      });

      const result = await challenger.run();
      expect(result.sandboxDir).toBeDefined();

      if (result.sandboxDir) {
        const reportMd = await readFile(join(result.sandboxDir, GATE2_CONSTANTS.REPORT_FILENAME), "utf8");
        const resultsJson = await readFile(join(result.sandboxDir, GATE2_CONSTANTS.RESULTS_JSON_FILENAME), "utf8");
        const feedbackXml = await readFile(join(result.sandboxDir, GATE2_CONSTANTS.FEEDBACK_XML_FILENAME), "utf8");

        expect(reportMd).toContain("Gate 2: Adversarial Challenger Red-Team Report");
        expect(resultsJson).toContain('"verdict": "PASSED_NO_BREAK"');
        expect(feedbackXml).toContain("<challenger-feedback");
      }
    });

    it("emits expected lifecycle events during run() execution", async () => {
      const eventsEmitted: string[] = [];

      const mockRunner = async () => ({
        stdout: "✓ passed",
        stderr: "",
        exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
      });

      const challenger = new Gate2Challenger({
        taskId: "EVENT-LIFECYCLE-001",
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockRunner,
        probes: [
          {
            id: "lifecycle_probe",
            name: "Lifecycle Probe",
            vector: GATE2_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
            description: "Emits events",
            probeCode: "test code",
          },
        ],
      });

      challenger.on(GATE2_CONSTANTS.EVENT_CHALLENGE_START, () => eventsEmitted.push(GATE2_CONSTANTS.EVENT_CHALLENGE_START));
      challenger.on(GATE2_CONSTANTS.EVENT_PROBE_START, () => eventsEmitted.push(GATE2_CONSTANTS.EVENT_PROBE_START));
      challenger.on(GATE2_CONSTANTS.EVENT_PROBE_COMPLETE, () => eventsEmitted.push(GATE2_CONSTANTS.EVENT_PROBE_COMPLETE));
      challenger.on(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED, () => eventsEmitted.push(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED));
      challenger.on(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE, () => eventsEmitted.push(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE));

      await challenger.run();

      expect(eventsEmitted).toContain(GATE2_CONSTANTS.EVENT_CHALLENGE_START);
      expect(eventsEmitted).toContain(GATE2_CONSTANTS.EVENT_PROBE_START);
      expect(eventsEmitted).toContain(GATE2_CONSTANTS.EVENT_PROBE_COMPLETE);
      expect(eventsEmitted).toContain(GATE2_CONSTANTS.EVENT_VERDICT_RESOLVED);
      expect(eventsEmitted).toContain(GATE2_CONSTANTS.EVENT_CHALLENGE_COMPLETE);
    });
  });

  // ==========================================================================
  // 9. CONVENIENCE FACTORY HELPERS
  // ==========================================================================
  describe("Convenience Factory Helpers", () => {
    it("createGate2Challenger creates new Gate2Challenger instance", () => {
      const challenger = createGate2Challenger({ taskId: "FACTORY-001" });
      expect(challenger).toBeInstanceOf(Gate2Challenger);
      expect(challenger.getOptions().taskId).toBe("FACTORY-001");
    });

    it("runGate2Challenger runs challenge and returns result", async () => {
      const mockRunner = async () => ({
        stdout: "✓ passed",
        stderr: "",
        exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
      });

      const result = await runGate2Challenger({
        taskId: "FACTORY-RUN-001",
        workspaceRoot: currentTestWorkspace,
        testDir: currentTestDir,
        probeRunner: mockRunner,
        probes: [
          {
            id: "factory_probe",
            name: "Factory Probe",
            vector: GATE2_CONSTANTS.VECTOR_CUSTOM,
            description: "Factory test",
            probeCode: "test code",
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
    });

    it("createAssertionInjector & createTestingSandbox instantiate valid objects", async () => {
      const sandbox = await createTestingSandbox({ workspaceRoot: currentTestWorkspace });
      expect(sandbox).toBeInstanceOf(TestingSandbox);
      await sandbox.cleanup();

      const injector = createAssertionInjector({ workspaceRoot: currentTestWorkspace });
      expect(injector).toBeInstanceOf(Gate2AssertionInjector);
    });
  });

  // ==========================================================================
  // 10. REAL SUBPROCESS EXECUTION WITH defaultProbeRunner
  // ==========================================================================
  describe("defaultProbeRunner Subprocess Execution", () => {
    it("executes actual passing test file via Bun.spawn subprocess", async () => {
      const passingProbePath = join(currentTestDir, "real_pass.test.ts");
      await writeFile(
        passingProbePath,
        `import { describe, expect, it } from "bun:test";
         describe("Real Subprocess Pass", () => {
           it("asserts true", () => {
             expect(true).toBe(true);
           });
         });`,
        "utf8"
      );

      const result = await defaultProbeRunner(passingProbePath, {
        cwd: currentTestWorkspace,
        timeoutMs: TEST_CONSTANTS.PROBE_EXECUTION_TIMEOUT_MS,
      });

      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_SUCCESS);
      expect((result.stdout + "\n" + result.stderr).toLowerCase()).toContain("pass");
    });

    it("executes actual failing test file via Bun.spawn and captures exit code 1 and stderr", async () => {
      const failingProbePath = join(currentTestDir, "real_fail.test.ts");
      await writeFile(
        failingProbePath,
        `import { describe, expect, it } from "bun:test";
         describe("Real Subprocess Fail", () => {
           it("asserts deliberate failure", () => {
             expect(1 + 1).toBe(42);
           });
         });`,
        "utf8"
      );

      const result = await defaultProbeRunner(failingProbePath, {
        cwd: currentTestWorkspace,
        timeoutMs: TEST_CONSTANTS.PROBE_EXECUTION_TIMEOUT_MS,
      });

      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_FAILURE);
      expect(result.stderr + result.stdout).toContain("42");
    });
  });
});
