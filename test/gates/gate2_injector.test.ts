/**
 * Unit Test Suite for Gate 2: Red-Team Assertion Injector into Testing Sandbox.
 *
 * Validates Gate2AssertionInjector, TestingSandbox, standalone probe injection,
 * inline assertion injection, clean rollback on survival, permanent retention
 * of breaking assertions, attempt budget enforcement, and structured telemetry
 * implemented in `src/gates/gate2_injector.ts` in accordance with OpenSpec change
 * `looper-gate2-adversarial-challenger` Task 1.3 and `projects/agnostic_looper/SPECIFICATION.md`
 * Section 3.1 & Section 3.4 (LOOPER-GATE-003).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATE2_INJECTOR_CONSTANTS,
  Gate2AssertionInjector,
  Gate2InjectionError,
  Gate2InjectorError,
  Gate2RollbackError,
  Gate2SandboxError,
  TestingSandbox,
  createAssertionInjector,
  createTestingSandbox,
  formatAssertionFeedbackXml,
  formatAssertionReportMarkdown,
  type AssertionInjectionResult,
  type Gate2AssertionInjectorOptions,
  type InjectionSuiteResult,
  type RedTeamAssertion,
} from "../../src/gates/gate2_injector";
import {
  Gate2Challenger,
  type Gate2ProbeDefinition,
} from "../../src/gates/gate2_challenger";

/**
 * Central test constants ensuring zero magic numbers across test suite.
 */
const TEST_CONSTANTS = {
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  EXIT_SUCCESS: 0,
  EXIT_FAILURE: 1,
  EXIT_TIMEOUT: 124,
  FAST_TIMEOUT_MS: 50,
  PROBE_DURATION_MS: 15,
  SAMPLE_MAX_ATTEMPTS: 3,
  NON_EXISTENT_DIR_OFFSET: 9999,
} as const;

describe("Gate 2: Red-Team Assertion Injector into Testing Sandbox (Task 1.3)", () => {
  let testWorkspace: string;
  let testSandboxDir: string;
  let testSuiteDir: string;

  beforeEach(async () => {
    testWorkspace = join(
      tmpdir(),
      `gate2_injector_test_${Date.now()}_${Math.random().toString().slice(TEST_CONSTANTS.TWO)}`
    );
    testSandboxDir = join(testWorkspace, ".redteam_sandbox");
    testSuiteDir = join(testWorkspace, "test");

    await mkdir(testWorkspace, { recursive: true });
    await mkdir(testSuiteDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ==========================================================================
  // SECTION 1: CONSTANTS & ERROR CLASSES
  // ==========================================================================

  describe("Constants and Error Taxonomy", () => {
    it("exposes canonical constants with zero magic numbers", () => {
      expect(GATE2_INJECTOR_CONSTANTS.MODE_STANDALONE).toBe("standalone");
      expect(GATE2_INJECTOR_CONSTANTS.MODE_INLINE).toBe("inline");
      expect(GATE2_INJECTOR_CONSTANTS.MODE_WRAPPER).toBe("wrapper");

      expect(GATE2_INJECTOR_CONSTANTS.STATUS_PENDING).toBe("pending");
      expect(GATE2_INJECTOR_CONSTANTS.STATUS_SURVIVED).toBe("survived");
      expect(GATE2_INJECTOR_CONSTANTS.STATUS_BROKEN).toBe("broken");
      expect(GATE2_INJECTOR_CONSTANTS.STATUS_ROLLED_BACK).toBe("rolled_back");
      expect(GATE2_INJECTOR_CONSTANTS.STATUS_RETAINED).toBe("retained");

      expect(GATE2_INJECTOR_CONSTANTS.EXIT_CODE_SUCCESS).toBe(TEST_CONSTANTS.EXIT_SUCCESS);
      expect(GATE2_INJECTOR_CONSTANTS.EXIT_CODE_FAILURE).toBe(TEST_CONSTANTS.EXIT_FAILURE);
      expect(GATE2_INJECTOR_CONSTANTS.EXIT_CODE_TIMEOUT).toBe(TEST_CONSTANTS.EXIT_TIMEOUT);
      expect(GATE2_INJECTOR_CONSTANTS.MAX_PERMITTED_ATTEMPTS).toBe(TEST_CONSTANTS.THREE);
    });

    it("instantiates custom error hierarchy with message, code, and details", () => {
      const baseErr = new Gate2InjectorError("Base error", "BASE_ERR", { info: 123 });
      expect(baseErr.name).toBe("Gate2InjectorError");
      expect(baseErr.code).toBe("BASE_ERR");
      expect(baseErr.message).toBe("Base error");

      const sandboxErr = new Gate2SandboxError("Sandbox error");
      expect(sandboxErr.name).toBe("Gate2SandboxError");
      expect(sandboxErr.code).toBe("GATE2_SANDBOX_ERROR");

      const injectionErr = new Gate2InjectionError("Injection error");
      expect(injectionErr.name).toBe("Gate2InjectionError");
      expect(injectionErr.code).toBe("GATE2_INJECTION_FAILED");

      const rollbackErr = new Gate2RollbackError("Rollback error");
      expect(rollbackErr.name).toBe("Gate2RollbackError");
      expect(rollbackErr.code).toBe("GATE2_ROLLBACK_FAILED");
    });
  });

  // ==========================================================================
  // SECTION 2: TESTING SANDBOX DIRECTORY & LIFECYCLE
  // ==========================================================================

  describe("TestingSandbox Lifecycle & Filesystem Management", () => {
    it("initializes isolated sandbox directory structure on demand", async () => {
      const sandbox = new TestingSandbox({
        workspaceRoot: testWorkspace,
        sandboxDir: testSandboxDir,
        permanentTestDir: testSuiteDir,
      });

      expect(sandbox.getIsInitialized()).toBe(false);
      const initializedPath = await sandbox.initialize();
      expect(sandbox.getIsInitialized()).toBe(true);
      expect(initializedPath).toBe(testSandboxDir);
      expect(existsSync(testSandboxDir)).toBe(true);
    });

    it("injects standalone test probe into sandbox directory", async () => {
      const sandbox = await createTestingSandbox({
        workspaceRoot: testWorkspace,
        sandboxDir: testSandboxDir,
        permanentTestDir: testSuiteDir,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_boundary_01",
        name: "Boundary Null Check",
        vector: "boundary_malformed",
        description: "Asserts robust handling of null payloads",
        assertionCode: `import { test, expect } from "bun:test"; test("null check", () => { expect(1).toBe(1); });`,
      };

      const injectedPath = await sandbox.injectStandalone(assertion);
      expect(existsSync(injectedPath)).toBe(true);
      expect(sandbox.getCreatedFiles().includes(injectedPath)).toBe(true);

      const content = await readFile(injectedPath, "utf8");
      expect(content).toContain(`test("null check"`);
    });

    it("injects inline assertion into target file with distinct markers", async () => {
      const targetTestFile = join(testSuiteDir, "sample_target.test.ts");
      const originalCode = `import { test, expect } from "bun:test";\ntest("baseline test", () => { expect(true).toBe(true); });\n`;
      await writeFile(targetTestFile, originalCode, "utf8");

      const sandbox = await createTestingSandbox({
        workspaceRoot: testWorkspace,
        sandboxDir: testSandboxDir,
        permanentTestDir: testSuiteDir,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_inline_01",
        name: "Inline Adversarial Probe",
        vector: "concurrency_race",
        description: "Inline burst testing",
        assertionCode: `test("injected inline", () => { expect(2).toBe(2); });`,
      };

      const injectedFile = await sandbox.injectInline(targetTestFile, assertion);
      expect(injectedFile).toBe(targetTestFile);

      const mutatedContent = await readFile(targetTestFile, "utf8");
      expect(mutatedContent).toContain("/* RED-TEAM INJECTION [START]: probe_inline_01");
      expect(mutatedContent).toContain("/* RED-TEAM INJECTION [END]: probe_inline_01");
      expect(mutatedContent).toContain(`test("injected inline"`);
    });

    it("rolls back standalone test probe by removing the created file", async () => {
      const sandbox = await createTestingSandbox({
        workspaceRoot: testWorkspace,
        sandboxDir: testSandboxDir,
        permanentTestDir: testSuiteDir,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_rollback_standalone",
        name: "Rollback Standalone",
        vector: "boundary_malformed",
        description: "Tests standalone rollback",
        assertionCode: `test("dummy", () => {});`,
      };

      const injectedPath = await sandbox.injectStandalone(assertion);
      expect(existsSync(injectedPath)).toBe(true);

      const rolledBack = await sandbox.rollbackAssertion("probe_rollback_standalone");
      expect(rolledBack).toBe(true);
      expect(existsSync(injectedPath)).toBe(false);
    });

    it("rolls back inline assertion by cleanly restoring original file content", async () => {
      const targetFile = join(testSuiteDir, "sample_inline_rollback.test.ts");
      const originalCode = `// Original Header\nexport const x = 42;\n`;
      await writeFile(targetFile, originalCode, "utf8");

      const sandbox = await createTestingSandbox({
        workspaceRoot: testWorkspace,
        sandboxDir: testSandboxDir,
        permanentTestDir: testSuiteDir,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_inline_restore",
        name: "Inline Restore Check",
        vector: "timeout_latency",
        description: "Tests clean inline restoration",
        assertionCode: `// Injected code here`,
      };

      await sandbox.injectInline(targetFile, assertion);
      const mutated = await readFile(targetFile, "utf8");
      expect(mutated).not.toBe(originalCode);

      const rolledBack = await sandbox.rollbackAssertion("probe_inline_restore");
      expect(rolledBack).toBe(true);

      const restored = await readFile(targetFile, "utf8");
      expect(restored).toBe(originalCode);
    });

    it("permanently retains breaking assertion to permanent test suite directory", async () => {
      const sandbox = await createTestingSandbox({
        workspaceRoot: testWorkspace,
        sandboxDir: testSandboxDir,
        permanentTestDir: testSuiteDir,
      });

      const breakingAssertion: RedTeamAssertion = {
        id: "probe_fuzz_crash",
        name: "Fuzz Crash Payload",
        vector: "boundary_malformed",
        description: "Crashes on undefined memory access",
        assertionCode: `test("fuzz break", () => { throw new Error("Unhandled crash"); });`,
      };

      const reproPath = await sandbox.retainBreakingAssertion(breakingAssertion);
      expect(existsSync(reproPath)).toBe(true);
      expect(sandbox.getRetainedFiles().includes(reproPath)).toBe(true);

      const reproContent = await readFile(reproPath, "utf8");
      expect(reproContent).toContain("Red-Team Minimal Reproduction Probe: Fuzz Crash Payload");
      expect(reproContent).toContain("Probe ID: probe_fuzz_crash");
      expect(reproContent).toContain("import { describe, expect, it, test } from \"bun:test\";");
    });

    it("cleans up sandbox directory and rolls back all temporary un-retained files", async () => {
      const sandbox = await createTestingSandbox({
        workspaceRoot: testWorkspace,
        sandboxDir: testSandboxDir,
        permanentTestDir: testSuiteDir,
        autoCleanup: true,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_cleanup_test",
        name: "Cleanup Test",
        vector: "resource_exhaustion",
        description: "Tests bulk cleanup",
        assertionCode: `test("cleanup", () => {});`,
      };

      await sandbox.injectStandalone(assertion);
      expect(existsSync(testSandboxDir)).toBe(true);

      await sandbox.cleanup();
      expect(existsSync(testSandboxDir)).toBe(false);
    });
  });

  // ==========================================================================
  // SECTION 3: GATE2 ASSERTION INJECTOR ORCHESTRATION & PROTOCOLS
  // ==========================================================================

  describe("Gate2AssertionInjector Execution Protocols", () => {
    it("converts Gate2ProbeDefinitions into RedTeamAssertions accurately", () => {
      const injector = createAssertionInjector({
        workspaceRoot: testWorkspace,
      });

      const probe: Gate2ProbeDefinition = {
        id: "probe_synthesis_01",
        name: "Null Probe",
        vector: "boundary_malformed",
        description: "Generated null probe",
        probeCode: "test code",
        targetFile: "src/foo.ts",
      };

      const assertion = injector.convertProbeToAssertion(probe, {
        mode: "inline",
      });

      expect(assertion.id).toBe("probe_synthesis_01");
      expect(assertion.name).toBe("Null Probe");
      expect(assertion.vector).toBe("boundary_malformed");
      expect(assertion.assertionCode).toBe("test code");
      expect(assertion.mode).toBe("inline");
      expect(assertion.targetFile).toBe("src/foo.ts");

      const list = injector.convertSynthesizedToAssertions([probe]);
      expect(list.length).toBe(TEST_CONSTANTS.ONE);
      expect(list[TEST_CONSTANTS.ZERO]?.id).toBe("probe_synthesis_01");
    });

    it("Clean Rollback Protocol: automatically rolls back probe when candidate SURVIVES (exit 0)", async () => {
      const mockRunner = async () => ({
        stdout: "1 pass\n0 fail",
        stderr: "",
        exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
      });

      const injector = new Gate2AssertionInjector({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
        probeRunner: mockRunner,
        autoRollbackOnPass: true,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_survived_test",
        name: "Surviving Probe",
        vector: "boundary_malformed",
        description: "Candidate implementation survives successfully",
        assertionCode: `import { test, expect } from "bun:test"; test("pass", () => expect(1).toBe(1));`,
      };

      const result = await injector.runAssertion(assertion);

      expect(result.survived).toBe(true);
      expect(result.broken).toBe(false);
      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_SUCCESS);
      expect(result.status).toBe("rolled_back");
      expect(result.rolledBack).toBe(true);
      expect(result.retained).toBe(false);

      // Verify the standalone probe file was deleted by clean rollback
      expect(existsSync(result.injectedFilePath)).toBe(false);
    });

    it("Permanent Retention Protocol: permanently retains breaking probe when candidate BREAKS (exit != 0)", async () => {
      const mockRunner = async () => ({
        stdout: "0 pass\n1 fail",
        stderr: "TypeError: Cannot read properties of undefined (reading 'split')",
        exitCode: TEST_CONSTANTS.EXIT_FAILURE,
      });

      const injector = new Gate2AssertionInjector({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
        permanentTestDir: testSuiteDir,
        probeRunner: mockRunner,
        preserveBreakingProbes: true,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_crash_vulnerability",
        name: "Crash Vulnerability Probe",
        vector: "boundary_malformed",
        description: "Reproduces unhandled TypeError on malformed input",
        assertionCode: `import { test } from "bun:test"; test("crash", () => { throw new TypeError("Cannot read properties of undefined"); });`,
      };

      const result = await injector.runAssertion(assertion);

      expect(result.survived).toBe(false);
      expect(result.broken).toBe(true);
      expect(result.exitCode).toBe(TEST_CONSTANTS.EXIT_FAILURE);
      expect(result.status).toBe("retained");
      expect(result.retained).toBe(true);
      expect(result.permanentReproPath).toBeDefined();

      if (result.permanentReproPath) {
        expect(existsSync(result.permanentReproPath)).toBe(true);
        const savedCode = await readFile(result.permanentReproPath, "utf8");
        expect(savedCode).toContain("Red-Team Minimal Reproduction Probe: Crash Vulnerability Probe");
      }
    });

    it("executes inline assertion, retains repro on break, and cleans up target test file", async () => {
      const targetFile = join(testSuiteDir, "user_service.test.ts");
      const originalContent = `import { test, expect } from "bun:test";\ntest("normal behavior", () => expect(true).toBe(true));\n`;
      await writeFile(targetFile, originalContent, "utf8");

      const mockRunner = async () => ({
        stdout: "Normal passed\nInjected failed",
        stderr: "AssertionError: Expected 200 but received 500",
        exitCode: TEST_CONSTANTS.EXIT_FAILURE,
      });

      const injector = new Gate2AssertionInjector({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
        probeRunner: mockRunner,
        preserveBreakingProbes: true,
      });

      const assertion: RedTeamAssertion = {
        id: "probe_inline_break",
        name: "Inline API Failure",
        vector: "boundary_malformed",
        mode: "inline",
        targetFile,
        description: "Tests inline failure retention and target cleanup",
        assertionCode: `test("red-team adversarial", () => { throw new Error("AssertionError: Expected 200 but received 500"); });`,
      };

      const result = await injector.runAssertion(assertion);

      expect(result.broken).toBe(true);
      expect(result.retained).toBe(true);
      expect(result.rolledBack).toBe(true); // Target file restored!

      // Target file should be restored to original clean state
      const targetAfterRun = await readFile(targetFile, "utf8");
      expect(targetAfterRun).toBe(originalContent);

      // Reproduction file was retained
      if (result.permanentReproPath) {
        expect(existsSync(result.permanentReproPath)).toBe(true);
      }
    });

    it("runs assertion suite and aggregates comprehensive run statistics", async () => {
      let callCount = TEST_CONSTANTS.ZERO;
      const mockRunner = async () => {
        callCount++;
        // First probe survives, second breaks
        if (callCount === TEST_CONSTANTS.ONE) {
          return { stdout: "Passed", stderr: "", exitCode: TEST_CONSTANTS.EXIT_SUCCESS };
        }
        return { stdout: "", stderr: "Crash in probe 2", exitCode: TEST_CONSTANTS.EXIT_FAILURE };
      };

      const injector = new Gate2AssertionInjector({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
        probeRunner: mockRunner,
      });

      const assertions: RedTeamAssertion[] = [
        {
          id: "suite_probe_01",
          name: "Suite Probe 1",
          vector: "concurrency_race",
          description: "Passes cleanly",
          assertionCode: `test("p1", () => {});`,
        },
        {
          id: "suite_probe_02",
          name: "Suite Probe 2",
          vector: "boundary_malformed",
          description: "Breaks candidate",
          assertionCode: `test("p2", () => { throw new Error("Crash"); });`,
        },
      ];

      const suiteResult: InjectionSuiteResult = await injector.runSuite(assertions);

      expect(suiteResult.totalInjected).toBe(TEST_CONSTANTS.TWO);
      expect(suiteResult.survivedCount).toBe(TEST_CONSTANTS.ONE);
      expect(suiteResult.brokenCount).toBe(TEST_CONSTANTS.ONE);
      expect(suiteResult.breakingResults.length).toBe(TEST_CONSTANTS.ONE);
      expect(suiteResult.retainedPaths.length).toBe(TEST_CONSTANTS.ONE);
      expect(suiteResult.cleanRollbackPerformed).toBe(true);
    });

    it("injectAndExecute runs suite and automatically cleans up sandbox upon completion", async () => {
      const mockRunner = async () => ({
        stdout: "ok",
        stderr: "",
        exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
      });

      const injector = new Gate2AssertionInjector({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
        probeRunner: mockRunner,
      });

      const assertions: RedTeamAssertion[] = [
        {
          id: "auto_clean_probe",
          name: "Auto Clean",
          vector: "timeout_latency",
          description: "Passes and cleans sandbox",
          assertionCode: `test("auto", () => {});`,
        },
      ];

      const suiteResult = await injector.injectAndExecute(assertions, {
        autoCleanup: true,
      });

      expect(suiteResult.totalInjected).toBe(TEST_CONSTANTS.ONE);
      expect(suiteResult.survivedCount).toBe(TEST_CONSTANTS.ONE);
      expect(existsSync(suiteResult.sandboxDir)).toBe(false);
    });

    it("emits expected lifecycle events during assertion injection and execution", async () => {
      const eventsEmitted: string[] = [];

      const mockRunner = async () => ({
        stdout: "",
        stderr: "Boom",
        exitCode: TEST_CONSTANTS.EXIT_FAILURE,
      });

      const injector = new Gate2AssertionInjector({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
        probeRunner: mockRunner,
      });

      injector.on(GATE2_INJECTOR_CONSTANTS.EVENT_SANDBOX_CREATED, () => {
        eventsEmitted.push(GATE2_INJECTOR_CONSTANTS.EVENT_SANDBOX_CREATED);
      });
      injector.on(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_INJECTED, () => {
        eventsEmitted.push(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_INJECTED);
      });
      injector.on(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_EXECUTING, () => {
        eventsEmitted.push(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_EXECUTING);
      });
      injector.on(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_BROKEN, () => {
        eventsEmitted.push(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_BROKEN);
      });
      injector.on(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_RETAINED, () => {
        eventsEmitted.push(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_RETAINED);
      });

      const assertion: RedTeamAssertion = {
        id: "events_probe",
        name: "Events Probe",
        vector: "boundary_malformed",
        description: "Validates lifecycle event sequence",
        assertionCode: `test("events", () => { throw new Error("Boom"); });`,
      };

      await injector.runAssertion(assertion);

      expect(eventsEmitted).toContain(GATE2_INJECTOR_CONSTANTS.EVENT_SANDBOX_CREATED);
      expect(eventsEmitted).toContain(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_INJECTED);
      expect(eventsEmitted).toContain(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_EXECUTING);
      expect(eventsEmitted).toContain(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_BROKEN);
      expect(eventsEmitted).toContain(GATE2_INJECTOR_CONSTANTS.EVENT_ASSERTION_RETAINED);
    });
  });

  // ==========================================================================
  // SECTION 4: FORMATTERS & TELEMETRY
  // ==========================================================================

  describe("Feedback XML and Markdown Formatters", () => {
    it("formatAssertionFeedbackXml produces well-structured machine-readable XML", () => {
      const mockResult: InjectionSuiteResult = {
        totalInjected: TEST_CONSTANTS.TWO,
        survivedCount: TEST_CONSTANTS.ONE,
        brokenCount: TEST_CONSTANTS.ONE,
        errorCount: TEST_CONSTANTS.ZERO,
        cleanRollbackPerformed: true,
        durationMs: 120,
        sandboxDir: "/tmp/sandbox",
        retainedPaths: ["test/challenger_repro_broken_01.test.ts"],
        results: [],
        breakingResults: [
          {
            assertionId: "broken_01",
            name: "Broken Memory",
            vector: "resource_exhaustion",
            mode: "standalone",
            status: "retained",
            survived: false,
            broken: true,
            exitCode: TEST_CONSTANTS.EXIT_FAILURE,
            stdout: "",
            stderr: "Out of memory",
            errorTrace: "RangeError: Out of memory",
            durationMs: 50,
            injectedFilePath: "/tmp/sandbox/probe.ts",
            permanentReproPath: "test/challenger_repro_broken_01.test.ts",
            rolledBack: false,
            retained: true,
          },
        ],
      };

      const xml = formatAssertionFeedbackXml(mockResult, {
        taskId: "TASK-GATE2-003",
        attempt: TEST_CONSTANTS.ONE,
        maxAttempts: TEST_CONSTANTS.TWO,
      });

      expect(xml).toContain("<redteam-assertion-feedback");
      expect(xml).toContain("<task-id>TASK-GATE2-003</task-id>");
      expect(xml).toContain("<total-injected>2</total-injected>");
      expect(xml).toContain("<survived>1</survived>");
      expect(xml).toContain("<broken>1</broken>");
      expect(xml).toContain("<clean-rollback>true</clean-rollback>");
      expect(xml).toContain("<reproduction-file>test/challenger_repro_broken_01.test.ts</reproduction-file>");
      expect(xml).toContain("RangeError: Out of memory");
      expect(xml).toContain("</redteam-assertion-feedback>");
    });

    it("formatAssertionReportMarkdown produces clean GitHub Flavored Markdown", () => {
      const mockResult: InjectionSuiteResult = {
        totalInjected: TEST_CONSTANTS.ONE,
        survivedCount: TEST_CONSTANTS.ZERO,
        brokenCount: TEST_CONSTANTS.ONE,
        errorCount: TEST_CONSTANTS.ZERO,
        cleanRollbackPerformed: true,
        durationMs: 75,
        sandboxDir: "/tmp/sandbox",
        retainedPaths: ["test/challenger_repro_p1.test.ts"],
        results: [
          {
            assertionId: "p1",
            name: "Probe 1",
            vector: "boundary_malformed",
            mode: "standalone",
            status: "retained",
            survived: false,
            broken: true,
            exitCode: TEST_CONSTANTS.EXIT_FAILURE,
            stdout: "",
            stderr: "Boom",
            durationMs: 25,
            injectedFilePath: "/tmp/p1.ts",
            permanentReproPath: "test/challenger_repro_p1.test.ts",
            rolledBack: false,
            retained: true,
          },
        ],
        breakingResults: [],
      };

      const md = formatAssertionReportMarkdown(mockResult, "TASK-123");
      expect(md).toContain("# Gate 2: Red-Team Assertion Injection Report");
      expect(md).toContain("**Task ID**: `TASK-123`");
      expect(md).toContain("| **Total Assertions Injected** | `1` |");
      expect(md).toContain("`p1`");
      expect(md).toContain("💥 BROKEN");
      expect(md).toContain("test/challenger_repro_p1.test.ts");
    });
  });

  // ==========================================================================
  // SECTION 5: INTEGRATION WITH GATE2 CHALLENGER
  // ==========================================================================

  describe("Integration with Gate2Challenger", () => {
    it("Gate2Challenger initializes and exposes Gate2AssertionInjector instance", () => {
      const challenger = new Gate2Challenger({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
      });

      const injector = challenger.getAssertionInjector();
      expect(injector).toBeInstanceOf(Gate2AssertionInjector);
      expect(challenger.getAssertionInjector()).toBe(injector); // Singleton per challenger instance
    });

    it("executes synthesized probes through Gate2AssertionInjector with clean rollback", async () => {
      const mockRunner = async () => ({
        stdout: "1 pass",
        stderr: "",
        exitCode: TEST_CONSTANTS.EXIT_SUCCESS,
      });

      const challenger = new Gate2Challenger({
        workspaceRoot: testWorkspace,
        testDir: testSuiteDir,
        probeRunner: mockRunner,
      });

      const injector = challenger.getAssertionInjector();

      const synthesizedProbe: Gate2ProbeDefinition = {
        id: "synth_probe_race",
        name: "Synthesized Race Condition Probe",
        vector: "concurrency_race",
        description: "Tests parallel calls for race conditions",
        probeCode: `import { test, expect } from "bun:test"; test("race", () => expect(1).toBe(1));`,
      };

      const assertion = injector.convertProbeToAssertion(synthesizedProbe);
      const result = await injector.runAssertion(assertion);

      expect(result.survived).toBe(true);
      expect(result.rolledBack).toBe(true);
      expect(existsSync(result.injectedFilePath)).toBe(false);
    });
  });
});
