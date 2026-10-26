/**
 * Unit Test Suite for Gate 3: Forensic Victory Auditor & System Invariant Guardian.
 *
 * Validates Gate3Auditor, binary veto capability, layout invariants, git hygiene,
 * clean-room QA runner, anti-cheat detection, atomic rollback buffering, FSM event mapping,
 * and structured XML feedback implemented in `src/gates/gate3_audit.ts` in accordance with
 * OpenSpec change `looper-gate3-forensic-audit` Task 1.1 and `projects/agnostic_looper/SPECIFICATION.md`
 * Section 3.1 & Section 3.5 (LOOPER-GATE-004).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATE3_CONSTANTS,
  Gate3Auditor,
  Gate3AuditorError,
  Gate3InvariantViolationError,
  Gate3RollbackError,
  Gate3SubagentDispatchError,
  Gate3TimeoutError,
  Gate3VetoError,
  createGate3Auditor,
  defaultGate3CommandRunner,
  formatAuditorPrompt,
  formatAuditorReportMarkdown,
  generateGate3Feedback,
  resolveGate3RecommendedEvent,
  runGate3Auditor,
  verifyGitHygieneInvariant,
  verifyLayoutInvariant,
  type Gate3AuditMode,
  type Gate3AuditReport,
  type Gate3AuditResult,
  type Gate3AuditorOptions,
  type Gate3CommandRunnerOptions,
  type Gate3CommandRunnerResult,
  type Gate3ExecutionContext,
  type Gate3InvariantCheckResult,
  type Gate3Verdict,
} from "../../src/gates/gate3_audit";
import { LOOPER_EVENTS, LOOPER_STATES } from "../../src/core/fsm_types";
import { ROLES_CONSTANTS } from "../../src/core/roles";
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
 * Central test constants ensuring zero magic numbers.
 */
const TEST_CONSTANTS = {
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  EXIT_CODE_ZERO: 0,
  EXIT_CODE_ONE: 1,
  TIMEOUT_MS_SHORT: 2_000,
  TIMEOUT_MS_TEST: 5_000,
} as const;

describe("Gate 3: Forensic Auditor with Binary Veto Capability (Task 1.1)", () => {
  let tempDir: string;
  let teamworkDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `gate3-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    teamworkDir = join(tempDir, ".agents", "teamwork");
    await mkdir(teamworkDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Gate3Auditor Initialization & Options", () => {
    it("initializes with default options and canonical states", () => {
      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
      });

      const opts = auditor.getOptions();
      expect(opts.workspaceRoot).toBe(tempDir);
      expect(opts.repoRoot).toBe(tempDir);
      expect(auditor.getBaselineSha()).toBeUndefined();
    });

    it("allows updating and querying baseline SHA", () => {
      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        baselineSha: "abc1234",
      });

      expect(auditor.getBaselineSha()).toBe("abc1234");
      auditor.setBaselineSha("def5678");
      expect(auditor.getBaselineSha()).toBe("def5678");
    });

    it("resolves recommended FSM events correctly for task and victory modes", () => {
      // Task mode
      expect(resolveGate3RecommendedEvent("PASS", "task")).toBe(
        LOOPER_EVENTS.EVT_G3_PASS
      );
      expect(resolveGate3RecommendedEvent("FAIL", "task")).toBe(
        LOOPER_EVENTS.EVT_G3_VETO
      );

      // Victory mode
      expect(resolveGate3RecommendedEvent("PASS", "victory")).toBe(
        LOOPER_EVENTS.EVT_VICTORY_PASS
      );
      expect(resolveGate3RecommendedEvent("FAIL", "victory")).toBe(
        LOOPER_EVENTS.EVT_VICTORY_FAIL
      );
    });
  });

  describe("Layout Invariant Verification (.agents/teamwork/)", () => {
    it("passes when .agents/teamwork/ contains strictly coordination metadata", async () => {
      await writeFile(join(teamworkDir, "BRIEFING.md"), "# Briefing\nContent");
      await writeFile(join(teamworkDir, "DISPATCH.md"), "# Dispatch\nContent");
      await writeFile(join(teamworkDir, "progress.md"), "# Progress\nTimestamp");
      await writeFile(join(teamworkDir, "state.json"), JSON.stringify({ active: true }));

      const check = await verifyLayoutInvariant(tempDir);
      expect(check.passed).toBe(true);
      expect(check.violations.length).toBe(TEST_CONSTANTS.ZERO);
      expect(check.category).toBe(GATE3_CONSTANTS.INVARIANT_LAYOUT);
    });

    it("passes cleanly when .agents/teamwork/ does not exist", async () => {
      const emptyDir = join(tempDir, "empty_workspace");
      const check = await verifyLayoutInvariant(emptyDir);
      expect(check.passed).toBe(true);
      expect(check.violations.length).toBe(TEST_CONSTANTS.ZERO);
    });

    it("detects forbidden application source code files in .agents/teamwork/", async () => {
      const nestedDir = join(teamworkDir, "worker_1");
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(nestedDir, "leak.ts"), "export const leaked = true;");

      const check = await verifyLayoutInvariant(tempDir);
      expect(check.passed).toBe(false);
      expect(check.violations.length).toBe(TEST_CONSTANTS.ONE);
      expect(check.violations[0]?.category).toBe(GATE3_CONSTANTS.INVARIANT_LAYOUT);
      expect(check.violations[0]?.description).toContain("leak.ts");
    });

    it("detects forbidden compiled binary files in .agents/teamwork/", async () => {
      await writeFile(join(teamworkDir, "payload.bin"), "binarycontent");

      const check = await verifyLayoutInvariant(tempDir);
      expect(check.passed).toBe(false);
      expect(check.violations.length).toBe(TEST_CONSTANTS.ONE);
      expect(check.violations[0]?.file).toContain("payload.bin");
    });
  });

  describe("Git Hygiene Invariant Verification", () => {
    it("passes when git status returns clean working tree", async () => {
      const mockRunner = async () => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: "",
        stderr: "",
        output: "",
        durationMs: 5,
      });

      const check = await verifyGitHygieneInvariant(tempDir, mockRunner);
      expect(check.passed).toBe(true);
      expect(check.violations.length).toBe(TEST_CONSTANTS.ZERO);
    });

    it("detects untracked temporary and editor backup files", async () => {
      const mockRunner = async () => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: "?? test.tmp\n?? config.bak\n?? script.js~",
        stderr: "",
        output: "?? test.tmp\n?? config.bak\n?? script.js~",
        durationMs: 5,
      });

      const check = await verifyGitHygieneInvariant(tempDir, mockRunner);
      expect(check.passed).toBe(false);
      expect(check.violations.length).toBe(TEST_CONSTANTS.THREE);
      expect(check.violations[0]?.description).toContain("test.tmp");
      expect(check.violations[1]?.description).toContain("config.bak");
      expect(check.violations[2]?.description).toContain("script.js~");
    });

    it("detects untracked secret keys and credentials", async () => {
      const mockRunner = async () => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: "?? id_rsa\n?? secrets.key\n?? .env.production",
        stderr: "",
        output: "?? id_rsa\n?? secrets.key\n?? .env.production",
        durationMs: 5,
      });

      const check = await verifyGitHygieneInvariant(tempDir, mockRunner);
      expect(check.passed).toBe(false);
      expect(check.violations.length).toBe(TEST_CONSTANTS.THREE);
      expect(check.violations.some((v) => v.file === "id_rsa")).toBe(true);
      expect(check.violations.some((v) => v.file === "secrets.key")).toBe(true);
      expect(check.violations.some((v) => v.file === ".env.production")).toBe(true);
    });

    it("detects untracked binary artifacts", async () => {
      const mockRunner = async () => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: "?? compiled.so\n?? app.exe",
        stderr: "",
        output: "?? compiled.so\n?? app.exe",
        durationMs: 5,
      });

      const check = await verifyGitHygieneInvariant(tempDir, mockRunner);
      expect(check.passed).toBe(false);
      expect(check.violations.length).toBe(TEST_CONSTANTS.TWO);
      expect(check.violations[0]?.description).toContain("compiled.so");
      expect(check.violations[1]?.description).toContain("app.exe");
    });
  });

  describe("Clean-Room Mechanical QA Invariant", () => {
    it("passes when all configured QA commands exit with code 0", async () => {
      const executed: string[] = [];
      const mockRunner = async (cmd: string) => {
        executed.push(cmd);
        return {
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "All tests passed",
          stderr: "",
          output: "All tests passed",
          durationMs: 10,
        };
      };

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        commandRunner: mockRunner,
        cleanRoomQaCommands: ["bun test", "bunx tsc --noEmit"],
      });

      const check = await auditor.checkCleanRoomQa();
      expect(check.passed).toBe(true);
      expect(check.violations.length).toBe(TEST_CONSTANTS.ZERO);
      expect(executed).toEqual(["bun test", "bunx tsc --noEmit"]);
    });

    it("records invariant violation when a QA command fails", async () => {
      const mockRunner = async (cmd: string) => {
        if (cmd === "bun test") {
          return {
            code: TEST_CONSTANTS.EXIT_CODE_ONE,
            stdout: "",
            stderr: "FAIL: 1 assertion failed",
            output: "FAIL: 1 assertion failed",
            durationMs: 12,
          };
        }
        return {
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "OK",
          stderr: "",
          output: "OK",
          durationMs: 5,
        };
      };

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        commandRunner: mockRunner,
        cleanRoomQaCommands: ["bun test", "bunx tsc --noEmit"],
      });

      const check = await auditor.checkCleanRoomQa();
      expect(check.passed).toBe(false);
      expect(check.violations.length).toBe(TEST_CONSTANTS.ONE);
      expect(check.violations[0]?.description).toContain("bun test");
      expect(check.violations[0]?.description).toContain("exited with code 1");
    });

    it("skips clean-room QA when skipCleanRoomQa is enabled", async () => {
      let called = false;
      const mockRunner = async () => {
        called = true;
        return {
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "",
          stderr: "",
          output: "",
          durationMs: 0,
        };
      };

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        commandRunner: mockRunner,
        skipCleanRoomQa: true,
      });

      const check = await auditor.checkCleanRoomQa();
      expect(check.passed).toBe(true);
      expect(check.status).toBe(GATE3_CONSTANTS.STATUS_SKIPPED);
      expect(called).toBe(false);
    });
  });

  describe("Anti-Cheat Invariant & OpenSpec Scenarios", () => {
    it("Scenario: An agent commits mock responses in production code -> triggers anti-cheat violation", async () => {
      const diffWithMock = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -10,2 +10,4 @@",
        "+export function computeResult() {",
        "+  return null as any; // stub",
        "+}",
      ].join("\n");

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        diff: diffWithMock,
      });

      const checks = await auditor.checkAntiCheatInvariant({
        gitDiff: diffWithMock,
      });

      expect(checks.length).toBe(TEST_CONSTANTS.ONE);
      expect(checks[0]?.passed).toBe(false);
      expect(checks[0]?.violations.length).toBe(TEST_CONSTANTS.ONE);
      expect(checks[0]?.violations[0]?.description).toContain("Mock placeholder or dummy stub in production code");
      expect(checks[0]?.violations[0]?.file).toBe("src/service.ts");
    });

    it("detects skipped test suites or todo assertions in test files", async () => {
      const diffWithSkip = [
        "diff --git a/test/feature.test.ts b/test/feature.test.ts",
        "--- a/test/feature.test.ts",
        "+++ b/test/feature.test.ts",
        "@@ -1,2 +1,3 @@",
        "+test.skip('evaded test case', () => {",
        "+  expect(true).toBe(true);",
        "+});",
      ].join("\n");

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        diff: diffWithSkip,
      });

      const checks = await auditor.checkAntiCheatInvariant({
        gitDiff: diffWithSkip,
      });

      expect(checks.length).toBe(TEST_CONSTANTS.ONE);
      expect(checks[0]?.passed).toBe(false);
      expect(checks[0]?.violations.length).toBe(TEST_CONSTANTS.TWO);
      expect(checks[0]?.violations.some((v) => v.description.includes("Disabled or skipped test"))).toBe(true);
      expect(checks[0]?.violations.some((v) => v.description.includes("Trivial or self-attesting assertion"))).toBe(true);
    });

    it("supports pluggable antiCheatScanner hook", async () => {
      const customScanner = async (ctx: Gate3ExecutionContext) => ({
        name: "custom_anti_cheat",
        category: GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT,
        status: GATE3_CONSTANTS.STATUS_VIOLATED,
        passed: false,
        details: "Custom cheat pattern discovered",
        violations: [
          {
            invariantName: "custom_anti_cheat",
            category: GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT,
            description: "Custom stub found in payload",
            file: "src/logic.ts",
          },
        ],
        durationMs: 5,
      });

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        antiCheatScanner: customScanner,
      });

      const checks = await auditor.checkAntiCheatInvariant({});
      expect(checks.length).toBe(TEST_CONSTANTS.ONE);
      expect(checks[0]?.name).toBe("custom_anti_cheat");
      expect(checks[0]?.passed).toBe(false);
      expect(checks[0]?.violations.length).toBe(TEST_CONSTANTS.ONE);
    });
  });

  describe("Binary Veto & Rollback Execution", () => {
    it("issues PASS and EVT_G3_PASS when all invariants hold", async () => {
      const mockRunner = async () => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: "",
        stderr: "",
        output: "",
        durationMs: 5,
      });

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        skipCleanRoomQa: true,
        commandRunner: mockRunner,
      });

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(result.veto).toBe(false);
      expect(result.victoryConfirmed).toBe(false);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G3_PASS);
      expect(result.rollbackExecuted).toBe(false);
      expect(result.report.violations.length).toBe(TEST_CONSTANTS.ZERO);
    });

    it("exercises binary veto and issues EVT_G3_VETO when layout invariant fails", async () => {
      // Place forbidden source file in .agents/teamwork
      await writeFile(join(teamworkDir, "cheat.ts"), "export const x = 1;");

      let vetoEventEmitted = false;
      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        skipCleanRoomQa: true,
      });

      auditor.on(GATE3_CONSTANTS.EVENT_VETO_ISSUED, () => {
        vetoEventEmitted = true;
      });

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(result.veto).toBe(true);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G3_VETO);
      expect(vetoEventEmitted).toBe(true);
      expect(result.report.invariantsViolated).toBeGreaterThan(TEST_CONSTANTS.ZERO);
    });

    it("triggers atomic git rollback on binary veto when autoRollbackOnVeto is enabled", async () => {
      // Place forbidden file to trigger veto
      await writeFile(join(teamworkDir, "forbidden.ts"), "code");

      let rollbackExecuted = false;
      let targetRefPassed = "";
      const mockRollbackRunner = async (opts: { targetRef?: string }) => {
        rollbackExecuted = true;
        targetRefPassed = opts.targetRef ?? "";
        return {
          success: true,
          targetRef: targetRefPassed,
          resetOutput: "HEAD is now at baseline",
          cleanOutput: "Removing untracked files",
        };
      };

      let rollbackEventEmitted = false;
      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        baselineSha: "baseline123",
        autoRollbackOnVeto: true,
        skipCleanRoomQa: true,
        rollbackRunner: mockRollbackRunner,
      });

      auditor.on(GATE3_CONSTANTS.EVENT_ROLLBACK_TRIGGERED, () => {
        rollbackEventEmitted = true;
      });

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(result.veto).toBe(true);
      expect(rollbackExecuted).toBe(true);
      expect(targetRefPassed).toBe("baseline123");
      expect(result.rollbackExecuted).toBe(true);
      expect(rollbackEventEmitted).toBe(true);
      expect(result.report.rollbackTriggered).toBe(true);
    });

    it("handles rollback failure cleanly and raises Gate3RollbackError in executeVeto", async () => {
      const mockFailingRollback = async () => {
        throw new Error("Git lock active");
      };

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        baselineSha: "baseline456",
        autoRollbackOnVeto: true,
        skipCleanRoomQa: true,
        rollbackRunner: mockFailingRollback,
      });

      const failingReport: Gate3AuditReport = {
        verdict: GATE3_CONSTANTS.VERDICT_FAIL,
        veto: true,
        victoryConfirmed: false,
        summary: "Veto",
        invariantsChecked: 1,
        invariantsPassed: 0,
        invariantsViolated: 1,
        checks: [],
        violations: [
          {
            invariantName: "test",
            category: "layout",
            description: "Violation",
          },
        ],
        recommendedEvent: LOOPER_EVENTS.EVT_G3_VETO,
        rollbackTriggered: false,
      };

      expect(auditor.executeVeto(failingReport, true)).rejects.toThrow(
        Gate3RollbackError
      );
    });
  });

  describe("Victory Mode (mode: 'victory')", () => {
    it("Scenario: All requirements and criteria pass empirical execution -> issues VICTORY CONFIRMED", async () => {
      const mockRunner = async () => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: "",
        stderr: "",
        output: "",
        durationMs: 5,
      });

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        mode: GATE3_CONSTANTS.MODE_VICTORY,
        skipCleanRoomQa: true,
        commandRunner: mockRunner,
      });

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(result.veto).toBe(false);
      expect(result.victoryConfirmed).toBe(true);
      expect(result.report.summary).toBe(GATE3_CONSTANTS.VICTORY_CONFIRMED);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_VICTORY_PASS);
    });

    it("emits EVT_VICTORY_FAIL when invariants are violated in victory mode", async () => {
      await writeFile(join(teamworkDir, "dirty.ts"), "leak");

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        mode: GATE3_CONSTANTS.MODE_VICTORY,
        skipCleanRoomQa: true,
      });

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(result.victoryConfirmed).toBe(false);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_VICTORY_FAIL);
    });
  });

  describe("Subagent Dispatcher & Sandbox Artifact Generation", () => {
    it("dispatches Tier 6 Auditor subagent and writes reports to sandbox directory", async () => {
      const dispatcher = createSubagentDispatcher({
        workspaceRoot: tempDir,
        autoCleanup: false,
      });

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        taskId: "task-gate3-1.1",
        taskDescription: "Forensic audit of task 1.1",
        dispatcher,
        skipCleanRoomQa: true,
        autoCleanup: false,
      });

      let dispatchedSubagentId: string | undefined;
      auditor.on(GATE3_CONSTANTS.EVENT_SUBAGENT_DISPATCHED, (evt: { subagentId: string }) => {
        dispatchedSubagentId = evt.subagentId;
      });

      const result = await auditor.run();
      expect(dispatchedSubagentId).toBeDefined();

      if (dispatchedSubagentId) {
        const agent = dispatcher.getAgent(dispatchedSubagentId);
        expect(agent).toBeDefined();
        expect(agent?.role).toBe(COGNITIVE_ROLES.AUDITOR);
        expect(agent?.roleDefinition.tier).toBe(ROLES_CONSTANTS.TIER_AUDITOR);

        // Verify artifact files written into subagent sandbox directory
        const reportContent = await readFile(
          join(agent!.sandbox.sandboxDir, "audit_report.md"),
          "utf-8"
        );
        expect(reportContent).toContain("# Gate 3 Forensic Audit Report");

        const jsonContent = await readFile(
          join(agent!.sandbox.sandboxDir, "audit_results.json"),
          "utf-8"
        );
        const parsedJson = JSON.parse(jsonContent);
        expect(parsedJson.verdict).toBe(result.verdict);

        const xmlContent = await readFile(
          join(agent!.sandbox.sandboxDir, "auditor_feedback.xml"),
          "utf-8"
        );
        expect(xmlContent).toContain("<forensic-audit-verdict>");

        await dispatcher.cleanupAgent(dispatchedSubagentId);
      }
    });
  });

  describe("PAL Provider Integration & Prompt Formatting", () => {
    it("executes LLM audit turn with mock IPalProvider and captures response", async () => {
      let promptDelivered = "";
      const mockProvider: IPalProvider = {
        providerName: "antigravity",
        modelName: "gemini-2.0-flash",
        executeTurn: async (opts: PalSessionOptions): Promise<PalOutcome> => {
          const firstMsg = opts.messages[0];
          const firstContent = firstMsg?.content[0];
          promptDelivered = firstContent && firstContent.type === "text"
            ? firstContent.text
            : "";
          return {
            message: createPalMessage({
              role: PAL_ROLES.ASSISTANT,
              content: [createTextBlock('```json\n{"verdict":"PASS","summary":"Verified"}\n```')],
            }),
            finishReason: "stop",
            usage: {
              promptTokens: 100,
              completionTokens: 20,
              totalTokens: 120,
            },
          };
        },
        streamTurn: async function* () {},
        getCapabilities: () => ({
          providerName: "antigravity",
          modelName: "gemini-2.0-flash",
          supportsNativeTools: false,
          supportsExtendedThinking: false,
          supportsStreaming: false,
          supportsPromptCaching: false,
          supportsToolCalling: false,
          supportsVision: false,
          maxContextTokens: 2_000_000,
          maxOutputTokens: 8_192,
        }),
        getRateLimitState: () => ({
          requestsRemaining: 100,
          requestsLimit: 100,
          tokensRemaining: 1_000_000,
          tokensLimit: 1_000_000,
          resetsAt: Date.now() + 60_000,
        }),
      };

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        provider: mockProvider,
        skipCleanRoomQa: true,
      });

      const result = await auditor.run();
      expect(promptDelivered).toContain("# Task: Gate 3 Forensic Audit & Invariant Verification");
      expect(result.report.rawResponse).toContain('{"verdict":"PASS"');
    });

    it("formats auditor prompt with acceptance criteria and target files", () => {
      const prompt = formatAuditorPrompt({
        taskId: "LOOPER-004",
        taskDescription: "Implement Gate 3 Auditor",
        acceptanceCriteria: ["Zero magic numbers", "Binary veto power"],
        targetFiles: ["src/gates/gate3_audit.ts"],
        mode: "task",
      });

      expect(prompt).toContain("**Task ID**: LOOPER-004");
      expect(prompt).toContain("Zero magic numbers");
      expect(prompt).toContain("`src/gates/gate3_audit.ts`");
    });
  });

  describe("Feedback Generation & Markdown Formatting", () => {
    it("formats markdown report with checklist and violations", () => {
      const report: Gate3AuditReport = {
        verdict: GATE3_CONSTANTS.VERDICT_FAIL,
        veto: true,
        victoryConfirmed: false,
        summary: "Forensic audit VETO",
        invariantsChecked: 2,
        invariantsPassed: 1,
        invariantsViolated: 1,
        checks: [
          {
            name: "layout_integrity",
            category: "layout",
            status: "passed",
            passed: true,
            details: "Layout clean",
            violations: [],
            durationMs: 4,
          },
          {
            name: "git_hygiene",
            category: "git_hygiene",
            status: "violated",
            passed: false,
            details: "Temp file found",
            violations: [
              {
                invariantName: "git_hygiene",
                category: "git_hygiene",
                description: "Temporary file: file.tmp",
                file: "file.tmp",
                rule: "Zero temp files",
              },
            ],
            durationMs: 6,
          },
        ],
        violations: [
          {
            invariantName: "git_hygiene",
            category: "git_hygiene",
            description: "Temporary file: file.tmp",
            file: "file.tmp",
            rule: "Zero temp files",
          },
        ],
        recommendedEvent: LOOPER_EVENTS.EVT_G3_VETO,
        rollbackTriggered: true,
        rollbackResult: {
          success: true,
          targetRef: "HEAD~1",
          resetOutput: "Reset complete",
          cleanOutput: "Clean complete",
        },
      };

      const md = formatAuditorReportMarkdown(report);
      expect(md).toContain("# Gate 3 Forensic Audit Report");
      expect(md).toContain("BINARY VETO EXERCISED");
      expect(md).toContain("Temporary file: file.tmp");
      expect(md).toContain("Atomic Rollback Execution");

      const fb = generateGate3Feedback(report);
      expect(fb.xmlFeedback).toContain("<verdict>FAIL</verdict>");
      expect(fb.xmlFeedback).toContain("<veto>true</veto>");
      expect(fb.xmlFeedback).toContain("<file>file.tmp</file>");
      expect(fb.xmlFeedback).toContain("<rollback-executed>true</rollback-executed>");
    });
  });

  describe("Convenience Factory Helpers", () => {
    it("createGate3Auditor creates a Gate3Auditor instance", () => {
      const auditor = createGate3Auditor({ workspaceRoot: tempDir });
      expect(auditor).toBeInstanceOf(Gate3Auditor);
    });

    it("runGate3Auditor executes and returns result", async () => {
      const result = await runGate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        skipCleanRoomQa: true,
      });

      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G3_PASS);
    });

    it("defaultGate3CommandRunner executes actual passing command via Bun.spawn", async () => {
      const res = await defaultGate3CommandRunner("echo 'gate3 empirical verification'", {
        cwd: tempDir,
        timeoutMs: TEST_CONSTANTS.TIMEOUT_MS_SHORT,
      });

      expect(res.code).toBe(TEST_CONSTANTS.EXIT_CODE_ZERO);
      expect(res.stdout).toContain("gate3 empirical verification");
      expect(res.timedOut).toBe(false);
    });
  });
});
