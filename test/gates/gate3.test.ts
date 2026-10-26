/**
 * Comprehensive Unit Test Suite for Gate 3: Forensic Victory Auditor, Anti-Cheat & Atomic Rollback Buffer.
 *
 * Validates the complete Gate 3 subsystem implementing:
 * - Gate 3 Forensic Auditor orchestrator (`src/gates/gate3_audit.ts`)
 * - Anti-Cheat Integrity Scanner (`src/gates/gate3_scanner.ts` / `src/gates/gate3_anticheat.ts`)
 * - Atomic Git Rollback Buffer & Audit Preservation Engine (`src/engine/rollback_buffer.ts`)
 * in accordance with OpenSpec change `looper-gate3-forensic-audit` Task 1.4,
 * and `projects/agnostic_looper/SPECIFICATION.md` Section 3.1, Section 3.5 (LOOPER-GATE-004),
 * Section 5.2, and Section 6.3.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, normalize } from "node:path";
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
  type CleanRoomQaCommand,
  type Gate3AuditMode,
  type Gate3AuditReport,
  type Gate3AuditResult,
  type Gate3AuditorOptions,
  type Gate3CommandRunner,
  type Gate3CommandRunnerOptions,
  type Gate3CommandRunnerResult,
  type Gate3ExecutionContext,
  type Gate3InvariantCategory,
  type Gate3InvariantCheckResult,
  type Gate3InvariantStatus,
  type Gate3Verdict,
  type Gate3Violation,
} from "../../src/gates/gate3_audit";
import {
  GATE3_SCANNER_CONSTANTS,
  Gate3AntiCheatScanner,
  createGate3AntiCheatScanner,
  formatAntiCheatReportMarkdown,
  formatAntiCheatReportXml,
  isProductionFile,
  isTestFile,
  parseUnifiedDiff,
  scanAntiCheatContent,
  scanAntiCheatDiff,
  toGate3InvariantCheckResult,
  type AntiCheatCategory,
  type AntiCheatRule,
  type AntiCheatScanReport,
  type AntiCheatSeverity,
  type AntiCheatViolation,
} from "../../src/gates/gate3_scanner";
import {
  ROLLBACK_CONSTANTS,
  RollbackStateBuffer,
  buildGitCleanCommand,
  captureGitState,
  rollbackWorkingTree,
  type CommandRunner,
  type CommandRunnerResult,
  type GitWorkingTreeState,
  type RollbackAuditEntry,
  type RollbackOptions,
  type RollbackResult,
} from "../../src/engine/rollback_buffer";
import { LOOPER_EVENTS, LOOPER_STATES, type LooperEvent } from "../../src/core/fsm_types";
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
 * Central test constants ensuring zero magic numbers across Gate 3 test suite.
 */
const TEST_CONSTANTS = {
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  TEN: 10,
  TOTAL_BUILTIN_RULES: 16,
  EXIT_CODE_ZERO: 0,
  EXIT_CODE_ONE: 1,
  EXIT_CODE_CUSTOM_FAIL: 42,
  EXIT_CODE_TIMEOUT: 124,
  FAST_DURATION_MS: 15,
  SHORT_TIMEOUT_MS: 100,
  COMMAND_TIMEOUT_MS: 2_000,
  GATE_TIMEOUT_MS: 5_000,
  ATTEMPT_INITIAL: 1,
  ATTEMPT_MAX: 3,
  MOCK_BASELINE_SHA: "1111111111111111111111111111111111111111",
  MOCK_HEAD_SHA: "2222222222222222222222222222222222222222",
  MOCK_COMMIT_SHA: "3333333333333333333333333333333333333333",
} as const;

describe("Gate 3: Forensic Victory Auditor, Anti-Cheat & Atomic Rollback Suite (Task 1.4)", () => {
  let tempDir: string;
  let teamworkDir: string;
  let srcDir: string;
  let testDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `gate3-integrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    teamworkDir = join(tempDir, ".agents", "teamwork");
    srcDir = join(tempDir, "src");
    testDir = join(tempDir, "test");

    await mkdir(teamworkDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ==========================================================================
  // SECTION 1: GATE3_CONSTANTS & TAXONOMY
  // ==========================================================================
  describe("1. GATE3_CONSTANTS & Invariant Taxonomy", () => {
    it("exposes canonical binary verdicts and victory token", () => {
      expect(GATE3_CONSTANTS.VERDICT_PASS).toBe("PASS");
      expect(GATE3_CONSTANTS.VERDICT_FAIL).toBe("FAIL");
      expect(GATE3_CONSTANTS.VERDICT_VETO).toBe("VETO");
      expect(GATE3_CONSTANTS.VICTORY_CONFIRMED).toBe("VICTORY CONFIRMED");
    });

    it("exposes canonical audit modes", () => {
      expect(GATE3_CONSTANTS.MODE_TASK).toBe("task");
      expect(GATE3_CONSTANTS.MODE_VICTORY).toBe("victory");
    });

    it("exposes canonical invariant categories and evaluation statuses", () => {
      expect(GATE3_CONSTANTS.INVARIANT_LAYOUT).toBe("layout");
      expect(GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE).toBe("git_hygiene");
      expect(GATE3_CONSTANTS.INVARIANT_CLEAN_ROOM_QA).toBe("clean_room_qa");
      expect(GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT).toBe("anti_cheat");
      expect(GATE3_CONSTANTS.INVARIANT_BOUNDARY).toBe("boundary");
      expect(GATE3_CONSTANTS.INVARIANT_CUSTOM).toBe("custom");

      expect(GATE3_CONSTANTS.STATUS_PASSED).toBe("passed");
      expect(GATE3_CONSTANTS.STATUS_VIOLATED).toBe("violated");
      expect(GATE3_CONSTANTS.STATUS_SKIPPED).toBe("skipped");
    });

    it("binds to canonical FSM domain events and states", () => {
      expect(GATE3_CONSTANTS.EVENT_G3_PASS).toBe(LOOPER_EVENTS.EVT_G3_PASS);
      expect(GATE3_CONSTANTS.EVENT_G3_VETO).toBe(LOOPER_EVENTS.EVT_G3_VETO);
      expect(GATE3_CONSTANTS.EVENT_VICTORY_PASS).toBe(LOOPER_EVENTS.EVT_VICTORY_PASS);
      expect(GATE3_CONSTANTS.EVENT_VICTORY_FAIL).toBe(LOOPER_EVENTS.EVT_VICTORY_FAIL);

      expect(GATE3_CONSTANTS.STATE_GATE_3_AUDIT).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
      expect(GATE3_CONSTANTS.STATE_VICTORY_AUDIT).toBe(LOOPER_STATES.STATE_VICTORY_AUDIT);
    });

    it("defines protected metadata directory and file extension sets", () => {
      expect(GATE3_CONSTANTS.DEFAULT_PROTECTED_METADATA_DIR).toBe(".agents/teamwork");
      expect(GATE3_CONSTANTS.FORBIDDEN_METADATA_EXTENSIONS).toContain(".ts");
      expect(GATE3_CONSTANTS.FORBIDDEN_METADATA_EXTENSIONS).toContain(".js");
      expect(GATE3_CONSTANTS.FORBIDDEN_METADATA_EXTENSIONS).toContain(".py");
      expect(GATE3_CONSTANTS.FORBIDDEN_METADATA_EXTENSIONS).toContain(".bin");

      expect(GATE3_CONSTANTS.ALLOWED_METADATA_EXTENSIONS).toContain(".md");
      expect(GATE3_CONSTANTS.ALLOWED_METADATA_EXTENSIONS).toContain(".json");
      expect(GATE3_CONSTANTS.ALLOWED_METADATA_EXTENSIONS).toContain(".xml");
      expect(GATE3_CONSTANTS.ALLOWED_METADATA_EXTENSIONS).toContain(".patch");
    });

    it("defines default clean-room QA commands and default rollback excludes", () => {
      expect(GATE3_CONSTANTS.DEFAULT_CLEAN_ROOM_QA_COMMANDS.length).toBe(TEST_CONSTANTS.THREE);
      expect(GATE3_CONSTANTS.DEFAULT_CLEAN_ROOM_QA_COMMANDS[0]?.command).toBe("bun test");
      expect(GATE3_CONSTANTS.DEFAULT_CLEAN_ROOM_QA_COMMANDS[1]?.command).toBe("bunx tsc --noEmit");
      expect(GATE3_CONSTANTS.DEFAULT_CLEAN_ROOM_QA_COMMANDS[2]?.command).toBe("bun run lint");

      expect(GATE3_CONSTANTS.DEFAULT_ROLLBACK_EXCLUDES).toContain(".agents/teamwork/");
      expect(GATE3_CONSTANTS.DEFAULT_ROLLBACK_EXCLUDES).toContain("projects/");
      expect(GATE3_CONSTANTS.DEFAULT_ROLLBACK_EXCLUDES).toContain("logs/");
    });
  });

  // ==========================================================================
  // SECTION 2: CUSTOM ERROR HIERARCHY
  // ==========================================================================
  describe("2. Custom Error Hierarchy", () => {
    it("instantiates Gate3AuditorError with message and optional cause", () => {
      const cause = new Error("inner failure");
      const err = new Gate3AuditorError("Gate 3 failure", cause);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(Gate3AuditorError);
      expect(err.name).toBe("Gate3AuditorError");
      expect(err.message).toBe("Gate 3 failure");
      expect(err.cause).toBe(cause);
    });

    it("instantiates Gate3VetoError with violations array", () => {
      const violations: readonly Gate3Violation[] = [
        {
          invariantName: "layout_integrity",
          category: GATE3_CONSTANTS.INVARIANT_LAYOUT,
          description: "Leaked .ts file",
        },
      ];
      const err = new Gate3VetoError("VETO triggered", violations);
      expect(err).toBeInstanceOf(Gate3AuditorError);
      expect(err.name).toBe("Gate3VetoError");
      expect(err.violations.length).toBe(TEST_CONSTANTS.ONE);
      expect(err.violations[0]?.invariantName).toBe("layout_integrity");
    });

    it("instantiates Gate3TimeoutError with configured duration", () => {
      const err = new Gate3TimeoutError("Execution exceeded limit", TEST_CONSTANTS.GATE_TIMEOUT_MS);
      expect(err).toBeInstanceOf(Gate3AuditorError);
      expect(err.name).toBe("Gate3TimeoutError");
      expect(err.timeoutMs).toBe(TEST_CONSTANTS.GATE_TIMEOUT_MS);
    });

    it("instantiates Gate3SubagentDispatchError with cause", () => {
      const cause = new Error("spawn failed");
      const err = new Gate3SubagentDispatchError("Auditor subagent dispatch failed", cause);
      expect(err).toBeInstanceOf(Gate3AuditorError);
      expect(err.name).toBe("Gate3SubagentDispatchError");
      expect(err.cause).toBe(cause);
    });

    it("instantiates Gate3InvariantViolationError with specific violation", () => {
      const violation: Gate3Violation = {
        invariantName: "git_hygiene",
        category: GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE,
        description: "Found secret key in git tree",
      };
      const err = new Gate3InvariantViolationError("Invariant violated", violation);
      expect(err).toBeInstanceOf(Gate3AuditorError);
      expect(err.name).toBe("Gate3InvariantViolationError");
      expect(err.violation.category).toBe(GATE3_CONSTANTS.INVARIANT_GIT_HYGIENE);
    });

    it("instantiates Gate3RollbackError during atomic rollback abort", () => {
      const cause = new Error("git reset failed");
      const err = new Gate3RollbackError("Rollback aborted", cause);
      expect(err).toBeInstanceOf(Gate3AuditorError);
      expect(err.name).toBe("Gate3RollbackError");
      expect(err.cause).toBe(cause);
    });
  });

  // ==========================================================================
  // SECTION 3: LAYOUT & GIT HYGIENE INVARIANT CHECKERS
  // ==========================================================================
  describe("3. Layout & Git Hygiene Invariant Checkers", () => {
    describe("verifyLayoutInvariant (.agents/teamwork/)", () => {
      it("passes cleanly when .agents/teamwork/ contains strictly allowed metadata files", async () => {
        await writeFile(join(teamworkDir, "briefing.md"), "# Briefing\nReady for audit.");
        await writeFile(join(teamworkDir, "state.json"), JSON.stringify({ ok: true }));
        await writeFile(join(teamworkDir, "audit.xml"), "<audit/>");
        await writeFile(join(teamworkDir, "changes.patch"), "--- a\n+++ b");

        const result = await verifyLayoutInvariant(tempDir);
        expect(result.name).toBe("layout_integrity");
        expect(result.category).toBe(GATE3_CONSTANTS.INVARIANT_LAYOUT);
        expect(result.status).toBe(GATE3_CONSTANTS.STATUS_PASSED);
        expect(result.passed).toBe(true);
        expect(result.violations.length).toBe(TEST_CONSTANTS.ZERO);
      });

      it("passes cleanly when protected metadata directory does not exist", async () => {
        const nonExistentDir = join(tempDir, "does-not-exist");
        const result = await verifyLayoutInvariant(tempDir, nonExistentDir);
        expect(result.passed).toBe(true);
        expect(result.status).toBe(GATE3_CONSTANTS.STATUS_PASSED);
        expect(result.violations.length).toBe(TEST_CONSTANTS.ZERO);
      });

      it("detects forbidden application source code files in .agents/teamwork/", async () => {
        await writeFile(
          join(teamworkDir, "agent_hack.ts"),
          "export const bypass = () => true;"
        );

        const result = await verifyLayoutInvariant(tempDir);
        expect(result.passed).toBe(false);
        expect(result.status).toBe(GATE3_CONSTANTS.STATUS_VIOLATED);
        expect(result.violations.length).toBe(TEST_CONSTANTS.ONE);
        expect(result.violations[0]?.file).toContain("agent_hack.ts");
        expect(result.remediation).toBeDefined();
      });

      it("detects forbidden binaries and nested source files in subdirectories", async () => {
        const nestedSubdir = join(teamworkDir, "nested", "deeper");
        await mkdir(nestedSubdir, { recursive: true });
        await writeFile(join(nestedSubdir, "helper.py"), "print('leaked code')");
        await writeFile(join(nestedSubdir, "artifact.bin"), Buffer.from([0x00, 0x01]));

        const result = await verifyLayoutInvariant(tempDir);
        expect(result.passed).toBe(false);
        expect(result.violations.length).toBe(TEST_CONSTANTS.TWO);
      });
    });

    describe("verifyGitHygieneInvariant", () => {
      it("passes when git status reports a completely clean working tree", async () => {
        const mockRunner: Gate3CommandRunner = async () => ({
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "",
          stderr: "",
          output: "",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
        });

        const result = await verifyGitHygieneInvariant(tempDir, mockRunner);
        expect(result.name).toBe("git_hygiene");
        expect(result.passed).toBe(true);
        expect(result.status).toBe(GATE3_CONSTANTS.STATUS_PASSED);
        expect(result.violations.length).toBe(TEST_CONSTANTS.ZERO);
      });

      it("detects temporary and editor backup files in git status", async () => {
        const mockRunner: Gate3CommandRunner = async () => ({
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "?? test/scratch.tmp\n?? src/.backup.swp\n?? root.bak",
          stderr: "",
          output: "?? test/scratch.tmp\n?? src/.backup.swp\n?? root.bak",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
        });

        const result = await verifyGitHygieneInvariant(tempDir, mockRunner);
        expect(result.passed).toBe(false);
        expect(result.violations.length).toBe(TEST_CONSTANTS.THREE);
        expect(result.violations[0]?.file).toBe("test/scratch.tmp");
      });

      it("detects exposed secret and private credential files in git status", async () => {
        const mockRunner: Gate3CommandRunner = async () => ({
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "?? id_rsa\n?? certs/server.key\n?? .env.production",
          stderr: "",
          output: "?? id_rsa\n?? certs/server.key\n?? .env.production",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
        });

        const result = await verifyGitHygieneInvariant(tempDir, mockRunner);
        expect(result.passed).toBe(false);
        expect(result.violations.length).toBe(TEST_CONSTANTS.THREE);
        expect(result.violations.some((v) => v.file?.includes("id_rsa"))).toBe(true);
        expect(result.violations.some((v) => v.file?.includes("server.key"))).toBe(true);
      });

      it("detects untracked compiled binary artifacts in working tree", async () => {
        const mockRunner: Gate3CommandRunner = async () => ({
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "?? bin/runner.exe\n?? native/addon.so",
          stderr: "",
          output: "?? bin/runner.exe\n?? native/addon.so",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
        });

        const result = await verifyGitHygieneInvariant(tempDir, mockRunner);
        expect(result.passed).toBe(false);
        expect(result.violations.length).toBe(TEST_CONSTANTS.TWO);
      });

      it("handles git command errors or non-git environments gracefully", async () => {
        const mockRunner: Gate3CommandRunner = async () => {
          throw new Error("fatal: not a git repository");
        };

        const result = await verifyGitHygieneInvariant(tempDir, mockRunner);
        expect(result.passed).toBe(true);
        expect(result.violations.length).toBe(TEST_CONSTANTS.ZERO);
      });
    });
  });

  // ==========================================================================
  // SECTION 4: DEFAULT COMMAND RUNNER (SUBPROCESS EXECUTION)
  // ==========================================================================
  describe("4. defaultGate3CommandRunner Subprocess Execution", () => {
    it("executes actual passing shell command and captures stdout cleanly", async () => {
      const res = await defaultGate3CommandRunner("echo 'empirical gate3 test'", {
        cwd: tempDir,
        timeoutMs: TEST_CONSTANTS.COMMAND_TIMEOUT_MS,
      });

      expect(res.code).toBe(TEST_CONSTANTS.EXIT_CODE_ZERO);
      expect(res.stdout).toContain("empirical gate3 test");
      expect(res.timedOut).toBe(false);
      expect(res.durationMs).toBeGreaterThanOrEqual(TEST_CONSTANTS.ZERO);
    });

    it("captures failing shell command and non-zero exit code cleanly", async () => {
      const isWindows = process.platform === "win32";
      const failCmd = isWindows ? "cmd /c exit 7" : "exit 7";

      const res = await defaultGate3CommandRunner(failCmd, {
        cwd: tempDir,
        timeoutMs: TEST_CONSTANTS.COMMAND_TIMEOUT_MS,
      });

      expect(res.code).toBe(7);
      expect(res.timedOut).toBe(false);
    });

    it("handles command timeout and returns canonical timeout exit code", async () => {
      const isWindows = process.platform === "win32";
      const sleepCmd = isWindows ? "powershell -Command Start-Sleep -Seconds 3" : "sleep 3";

      const res = await defaultGate3CommandRunner(sleepCmd, {
        cwd: tempDir,
        timeoutMs: TEST_CONSTANTS.SHORT_TIMEOUT_MS,
      });

      expect(res.timedOut).toBe(true);
      expect(res.code).toBe(GATE3_CONSTANTS.EXIT_CODE_TIMEOUT);
      expect(res.stderr).toContain("timed out");
    });
  });

  // ==========================================================================
  // SECTION 5: ANTI-CHEAT SCANNER ENGINE INTEGRATION (Task 1.2)
  // ==========================================================================
  describe("5. Anti-Cheat Scanner Engine Integration (Task 1.2)", () => {
    let scanner: Gate3AntiCheatScanner;

    beforeEach(() => {
      scanner = createGate3AntiCheatScanner({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
      });
    });

    it("initializes with 16 canonical built-in rules across anti-cheat categories", () => {
      const rules = scanner.getRules();
      expect(rules.length).toBe(TEST_CONSTANTS.TOTAL_BUILTIN_RULES);
      expect(rules.some((r) => r.id === GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_STUB)).toBe(true);
      expect(rules.some((r) => r.id === GATE3_SCANNER_CONSTANTS.RULE_MOCK_IN_PRODUCTION)).toBe(true);
      expect(rules.some((r) => r.id === GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP)).toBe(true);
      expect(rules.some((r) => r.id === GATE3_SCANNER_CONSTANTS.RULE_TRIVIAL_ASSERTION)).toBe(true);
    });

    it("detects dummy placeholder stubs in production TypeScript source", async () => {
      const prodPath = join(srcDir, "calculator.ts");
      await writeFile(
        prodPath,
        "export function add(a: number, b: number): number {\n  // placeholder calculation logic\n  return null as any; // stub\n}\n"
      );

      const report = await scanner.scanFiles(["src/calculator.ts"]);
      expect(report.passed).toBe(false);
      expect(report.veto).toBe(true);
      expect(report.violations.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.ONE);
      expect(
        report.violations.some(
          (v) =>
            v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_STUB ||
            v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_DUMMY_RETURN_PROD
        )
      ).toBe(true);
    });

    it("detects mock responses committed in production files", async () => {
      const prodPath = join(srcDir, "payment_client.ts");
      await writeFile(
        prodPath,
        'import { mock } from "bun:test";\n\nexport async function charge(amount: number) {\n  return mock(() => ({ status: 200 }));\n}\n'
      );

      const report = await scanner.scanFiles(["src/payment_client.ts"]);
      expect(report.passed).toBe(false);
      expect(report.veto).toBe(true);
      expect(
        report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_MOCK_IN_PRODUCTION)
      ).toBe(true);
    });

    it("detects skipped test suites and disabled test assertions", async () => {
      const testFilePath = join(testDir, "service.test.ts");
      await writeFile(
        testFilePath,
        "import { test } from 'bun:test';\n\ntest.skip('critical production invariant', () => {\n  // bypassed\n});\n"
      );

      const report = await scanner.scanFiles(["test/service.test.ts"]);
      expect(report.passed).toBe(false);
      expect(
        report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP)
      ).toBe(true);
    });

    it("detects trivial assertions designed to pass without real verification", async () => {
      const testFilePath = join(testDir, "trivial.test.ts");
      await writeFile(
        testFilePath,
        "import { expect, test } from 'bun:test';\n\ntest('fake verification', () => {\n  expect(true).toBe(true);\n});\n"
      );

      const report = await scanner.scanFiles(["test/trivial.test.ts"]);
      expect(report.passed).toBe(false);
      expect(
        report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_TRIVIAL_ASSERTION)
      ).toBe(true);
    });

    it("scans git diffs via parseUnifiedDiff and attributes violations to added lines", async () => {
      const rawDiff = `diff --git a/src/service.ts b/src/service.ts
index 0000000..1111111 100644
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,3 +1,4 @@
+// TODO: implement later
+return null; // stub
`;
      const diffReport = await scanAntiCheatDiff(rawDiff);
      expect(diffReport.passed).toBe(false);
      expect(diffReport.violations.length).toBeGreaterThan(TEST_CONSTANTS.ZERO);
    });

    it("allows registering custom anti-cheat rules and disabling existing rules", () => {
      const customRule: AntiCheatRule = {
        id: "CUSTOM-001-NO-CONSOLE",
        name: "No Console Log Rule",
        category: GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM,
        severity: GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING,
        description: "console.log is forbidden",
        ruleCitation: "Policy Directive",
        appliesTo: "all",
        evaluate(context) {
          if (context.content.includes("console.log")) {
            return [
              {
                ruleId: "CUSTOM-001-NO-CONSOLE",
                ruleName: "No Console Log Rule",
                category: GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM,
                severity: GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING,
                description: "console.log detected",
                file: context.filePath,
              },
            ];
          }
          return [];
        },
      };

      scanner.registerRule(customRule);
      expect(scanner.getRules().length).toBe(
        TEST_CONSTANTS.TOTAL_BUILTIN_RULES + TEST_CONSTANTS.ONE
      );

      const removed = scanner.unregisterRule("CUSTOM-001-NO-CONSOLE");
      expect(removed).toBe(true);
      expect(scanner.getRules().length).toBe(TEST_CONSTANTS.TOTAL_BUILTIN_RULES);
    });

    it("formats structured Markdown and XML reports for anti-cheat escalation", async () => {
      const code = "test.skip('evaded', () => { expect(true).toBe(true); });";
      const report = await scanner.scanContent(code, "test/sample.test.ts");

      const md = formatAntiCheatReportMarkdown(report);
      expect(md).toContain("# Gate 3 Anti-Cheat Forensic Report");
      expect(md).toContain("⛔ VETO");
      expect(md).toContain("Disabled Assertions & Evasion");

      const xml = formatAntiCheatReportXml(report);
      expect(xml).toContain("<anti-cheat-report>");
      expect(xml).toContain("<passed>false</passed>");
      expect(xml).toContain("<veto>true</veto>");
      expect(xml).toContain(GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP);
    });
  });

  // ==========================================================================
  // SECTION 6: ATOMIC GIT ROLLBACK BUFFER & AUDIT PRESERVATION (Task 1.3)
  // ==========================================================================
  describe("6. Atomic Git Rollback Buffer & State Management (Task 1.3)", () => {
    it("formats git clean commands with explicit exclude flags for memory and deliverables", () => {
      const cleanCmd = buildGitCleanCommand([
        ".agents/teamwork/",
        "projects/",
        "logs/",
      ]);
      expect(cleanCmd).toContain("git clean -fd");
      expect(cleanCmd).toContain('-e ".agents/teamwork/"');
      expect(cleanCmd).toContain('-e "projects/"');
      expect(cleanCmd).toContain('-e "logs/"');
    });

    it("RollbackStateBuffer captures baseline snapshot and detects dirty working tree", async () => {
      const mockRunner: CommandRunner = async (cmd) => {
        if (cmd.includes("rev-parse")) {
          return {
            code: TEST_CONSTANTS.EXIT_CODE_ZERO,
            stdout: TEST_CONSTANTS.MOCK_BASELINE_SHA,
            stderr: "",
            output: TEST_CONSTANTS.MOCK_BASELINE_SHA,
          };
        }
        if (cmd.includes("status --porcelain")) {
          return {
            code: TEST_CONSTANTS.EXIT_CODE_ZERO,
            stdout: " M src/gates/gate3_audit.ts\n?? test/new_test.ts",
            stderr: "",
            output: " M src/gates/gate3_audit.ts\n?? test/new_test.ts",
          };
        }
        return { code: 0, stdout: "", stderr: "", output: "" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      const baselineSha = await buffer.snapshot();
      expect(baselineSha).toBe(TEST_CONSTANTS.MOCK_BASELINE_SHA);
      expect(buffer.getBaselineSha()).toBe(TEST_CONSTANTS.MOCK_BASELINE_SHA);
      expect(await buffer.isDirty()).toBe(true);

      const gitState = await captureGitState({ cwd: tempDir, runner: mockRunner });
      expect(gitState.headSha).toBe(TEST_CONSTANTS.MOCK_BASELINE_SHA);
      expect(gitState.isDirty).toBe(true);
      expect(gitState.modifiedFiles).toContain("src/gates/gate3_audit.ts");
      expect(gitState.untrackedFiles).toContain("test/new_test.ts");
    });

    it("RollbackStateBuffer preserves registered audit logs across atomic rollback", async () => {
      const executedCommands: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executedCommands.push(cmd);
        if (cmd.includes("rev-parse")) {
          return {
            code: 0,
            stdout: TEST_CONSTANTS.MOCK_BASELINE_SHA,
            stderr: "",
            output: TEST_CONSTANTS.MOCK_BASELINE_SHA,
          };
        }
        return { code: 0, stdout: "ok", stderr: "", output: "ok" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });
      await buffer.snapshot();

      // Register audit artifacts
      const reportFile = join(teamworkDir, "gate3_audit_report.md");
      const reportContent = "# Gate 3 Veto Report\nCheating detected.";
      buffer.registerAuditLog(reportFile, reportContent);

      const rollbackRes = await buffer.rollback(TEST_CONSTANTS.MOCK_BASELINE_SHA, {
        reason: "Binary veto on cheating",
        preserveAuditLogs: true,
      });

      expect(rollbackRes.success).toBe(true);
      expect(rollbackRes.targetRef).toBe(TEST_CONSTANTS.MOCK_BASELINE_SHA);
      expect(buffer.getRollbackCount()).toBe(TEST_CONSTANTS.ONE);

      // Verify git reset and git clean were executed
      expect(executedCommands.some((c) => c.startsWith("git reset --hard"))).toBe(true);
      expect(executedCommands.some((c) => c.startsWith("git clean -fd"))).toBe(true);

      // Verify audit file survived on disk
      const restored = await readFile(reportFile, "utf-8");
      expect(restored).toBe(reportContent);
    });

    it("flushes JSONL audit log trail to disk upon demand", async () => {
      const mockRunner: CommandRunner = async (cmd) => {
        if (cmd.includes("rev-parse")) {
          return {
            code: 0,
            stdout: TEST_CONSTANTS.MOCK_BASELINE_SHA,
            stderr: "",
            output: TEST_CONSTANTS.MOCK_BASELINE_SHA,
          };
        }
        return { code: 0, stdout: "", stderr: "", output: "" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      await buffer.snapshot();
      await buffer.rollback(undefined, { reason: "Audit rollback" });

      const logPath = join(tempDir, "logs", "audit.jsonl");
      await buffer.flushAuditLogs(logPath);

      const logContent = await readFile(logPath, "utf-8");
      expect(logContent).toContain('"action":"snapshot"');
      expect(logContent).toContain('"action":"rollback"');
    });
  });

  // ==========================================================================
  // SECTION 7: REPORTING, PROMPTS & STRUCTURED XML FEEDBACK
  // ==========================================================================
  describe("7. Reporting, Prompts & Structured Feedback", () => {
    it("resolves recommended FSM domain events based on verdict and mode", () => {
      // Task mode
      expect(
        resolveGate3RecommendedEvent(GATE3_CONSTANTS.VERDICT_PASS, GATE3_CONSTANTS.MODE_TASK)
      ).toBe(LOOPER_EVENTS.EVT_G3_PASS);
      expect(
        resolveGate3RecommendedEvent(GATE3_CONSTANTS.VERDICT_FAIL, GATE3_CONSTANTS.MODE_TASK)
      ).toBe(LOOPER_EVENTS.EVT_G3_VETO);

      // Victory mode
      expect(
        resolveGate3RecommendedEvent(GATE3_CONSTANTS.VERDICT_PASS, GATE3_CONSTANTS.MODE_VICTORY)
      ).toBe(LOOPER_EVENTS.EVT_VICTORY_PASS);
      expect(
        resolveGate3RecommendedEvent(GATE3_CONSTANTS.VERDICT_FAIL, GATE3_CONSTANTS.MODE_VICTORY)
      ).toBe(LOOPER_EVENTS.EVT_VICTORY_FAIL);
    });

    it("formats markdown audit report with tables, line-item violations, and rollback details", () => {
      const report: Gate3AuditReport = {
        verdict: GATE3_CONSTANTS.VERDICT_FAIL,
        veto: true,
        victoryConfirmed: false,
        summary: "Forensic audit veto issued due to cheat stubs.",
        invariantsChecked: TEST_CONSTANTS.TWO,
        invariantsPassed: TEST_CONSTANTS.ONE,
        invariantsViolated: TEST_CONSTANTS.ONE,
        checks: [
          {
            name: "layout_integrity",
            category: GATE3_CONSTANTS.INVARIANT_LAYOUT,
            status: GATE3_CONSTANTS.STATUS_PASSED,
            passed: true,
            details: "No leaked files",
            violations: [],
            durationMs: TEST_CONSTANTS.FIVE,
          },
          {
            name: "anti_cheat",
            category: GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT,
            status: GATE3_CONSTANTS.STATUS_VIOLATED,
            passed: false,
            details: "Mock detected",
            violations: [
              {
                invariantName: "anti_cheat",
                category: GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT,
                description: "mockResolvedValue found in production",
                file: "src/service.ts",
                rule: "Zero mocks in production",
              },
            ],
            durationMs: TEST_CONSTANTS.TEN,
          },
        ],
        violations: [
          {
            invariantName: "anti_cheat",
            category: GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT,
            description: "mockResolvedValue found in production",
            file: "src/service.ts",
            rule: "Zero mocks in production",
          },
        ],
        recommendedEvent: LOOPER_EVENTS.EVT_G3_VETO,
        rollbackTriggered: true,
        rollbackResult: {
          success: true,
          targetRef: TEST_CONSTANTS.MOCK_BASELINE_SHA,
          resetOutput: "Reset ok",
          cleanOutput: "Clean ok",
        },
      };

      const md = formatAuditorReportMarkdown(report);
      expect(md).toContain("# Gate 3 Forensic Audit Report");
      expect(md).toContain("BINARY VETO EXERCISED");
      expect(md).toContain("mockResolvedValue found in production");
      expect(md).toContain("src/service.ts");
      expect(md).toContain("Atomic Rollback Execution");
      expect(md).toContain(TEST_CONSTANTS.MOCK_BASELINE_SHA);
    });

    it("formats comprehensive auditor prompt with criteria, target files, and JSON instruction", () => {
      const prompt = formatAuditorPrompt({
        taskId: "TASK-42",
        taskDescription: "Implement forensic veto buffer",
        acceptanceCriteria: ["Strict zero magic numbers", "Pass all empirical checks"],
        targetFiles: ["src/gates/gate3_audit.ts", "src/engine/rollback_buffer.ts"],
        mode: GATE3_CONSTANTS.MODE_TASK,
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
      });

      expect(prompt).toContain("# Task: Gate 3 Forensic Audit & Invariant Verification");
      expect(prompt).toContain("**Task ID**: TASK-42");
      expect(prompt).toContain("Strict zero magic numbers");
      expect(prompt).toContain("`src/gates/gate3_audit.ts`");
      expect(prompt).toContain("```json");
    });

    it("generates structured XML feedback parseable by LLM diagnostic escalators", () => {
      const report: Gate3AuditReport = {
        verdict: GATE3_CONSTANTS.VERDICT_FAIL,
        veto: true,
        victoryConfirmed: false,
        summary: "Veto triggered",
        invariantsChecked: 1,
        invariantsPassed: 0,
        invariantsViolated: 1,
        checks: [],
        violations: [
          {
            invariantName: "layout_integrity",
            category: GATE3_CONSTANTS.INVARIANT_LAYOUT,
            description: "Application source leaked in .agents/teamwork/",
            file: ".agents/teamwork/leak.ts",
            rule: "SPEC Section 3.5",
          },
        ],
        recommendedEvent: LOOPER_EVENTS.EVT_G3_VETO,
        rollbackTriggered: true,
      };

      const fb = generateGate3Feedback(report);
      expect(fb.xmlFeedback).toContain("<forensic-audit-verdict>");
      expect(fb.xmlFeedback).toContain("<verdict>FAIL</verdict>");
      expect(fb.xmlFeedback).toContain("<veto>true</veto>");
      expect(fb.xmlFeedback).toContain("<name>layout_integrity</name>");
      expect(fb.xmlFeedback).toContain("<file>.agents/teamwork/leak.ts</file>");
      expect(fb.xmlFeedback).toContain("<rollback-executed>true</rollback-executed>");
      expect(fb.xmlFeedback).toContain("</forensic-audit-verdict>");
    });
  });

  // ==========================================================================
  // SECTION 8: CLEAN-ROOM MECHANICAL QA INVARIANT
  // ==========================================================================
  describe("8. Clean-Room Mechanical QA Invariant", () => {
    it("passes when all configured QA commands exit with code 0", async () => {
      const mockRunner: Gate3CommandRunner = async (cmd) => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: `${cmd} passed`,
        stderr: "",
        output: `${cmd} passed`,
        durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
      });

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        commandRunner: mockRunner,
        cleanRoomQaCommands: [
          { command: "bun test", description: "Unit tests" },
          { command: "bunx tsc --noEmit", description: "TypeScript validation" },
        ],
      });

      const qaResult = await auditor.checkCleanRoomQa();
      expect(qaResult.passed).toBe(true);
      expect(qaResult.status).toBe(GATE3_CONSTANTS.STATUS_PASSED);
      expect(qaResult.violations.length).toBe(TEST_CONSTANTS.ZERO);
      expect(qaResult.details).toContain("All 2 clean-room verification check(s) passed");
    });

    it("records invariant violation when a mechanical QA check exits with non-zero code", async () => {
      const mockRunner: Gate3CommandRunner = async (cmd) => {
        if (cmd === "bun test") {
          return {
            code: TEST_CONSTANTS.EXIT_CODE_ONE,
            stdout: "",
            stderr: "FAIL: 2 test failures in gate3.test.ts",
            output: "FAIL: 2 test failures in gate3.test.ts",
            durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
          };
        }
        return {
          code: TEST_CONSTANTS.EXIT_CODE_ZERO,
          stdout: "ok",
          stderr: "",
          output: "ok",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
        };
      };

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        commandRunner: mockRunner,
      });

      const qaResult = await auditor.checkCleanRoomQa();
      expect(qaResult.passed).toBe(false);
      expect(qaResult.status).toBe(GATE3_CONSTANTS.STATUS_VIOLATED);
      expect(qaResult.violations.length).toBe(TEST_CONSTANTS.ONE);
      expect(qaResult.violations[0]?.category).toBe(GATE3_CONSTANTS.INVARIANT_CLEAN_ROOM_QA);
      expect(qaResult.violations[0]?.description).toContain("bun test");
    });

    it("skips clean-room QA checks when skipCleanRoomQa is enabled", async () => {
      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        skipCleanRoomQa: true,
      });

      const qaResult = await auditor.checkCleanRoomQa();
      expect(qaResult.passed).toBe(true);
      expect(qaResult.status).toBe(GATE3_CONSTANTS.STATUS_SKIPPED);
      expect(qaResult.violations.length).toBe(TEST_CONSTANTS.ZERO);
    });
  });

  // ==========================================================================
  // SECTION 9: GATE3 AUDITOR ORCHESTRATOR & LIFECYCLE HOOKS
  // ==========================================================================
  describe("9. Gate3Auditor Orchestrator Unit & Lifecycle Events", () => {
    it("initializes with options and allows baseline SHA inspection/update", () => {
      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        baselineSha: TEST_CONSTANTS.MOCK_BASELINE_SHA,
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
        autoRollbackOnVeto: true,
      });

      expect(auditor.getBaselineSha()).toBe(TEST_CONSTANTS.MOCK_BASELINE_SHA);
      auditor.setBaselineSha(TEST_CONSTANTS.MOCK_HEAD_SHA);
      expect(auditor.getBaselineSha()).toBe(TEST_CONSTANTS.MOCK_HEAD_SHA);

      const opts = auditor.getOptions();
      expect(opts.autoRollbackOnVeto).toBe(true);
      expect(opts.maxAttempts).toBe(TEST_CONSTANTS.ATTEMPT_MAX);
    });

    it("emits complete lifecycle events: audit:start, audit:invariant_check, and audit:complete", async () => {
      const emittedEvents: string[] = [];

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        skipCleanRoomQa: true,
        commandRunner: async () => ({
          code: 0,
          stdout: "",
          stderr: "",
          output: "",
          durationMs: 0,
        }),
      });

      auditor.on(GATE3_CONSTANTS.EVENT_AUDIT_START, () => emittedEvents.push("start"));
      auditor.on(GATE3_CONSTANTS.EVENT_INVARIANT_CHECK, () => emittedEvents.push("check"));
      auditor.on(GATE3_CONSTANTS.EVENT_AUDIT_COMPLETE, () => emittedEvents.push("complete"));

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(emittedEvents).toContain("start");
      expect(emittedEvents).toContain("check");
      expect(emittedEvents).toContain("complete");
    });

    it("emits audit:veto and audit:rollback when invariant breach triggers binary veto", async () => {
      const emittedEvents: string[] = [];

      // Create a layout violation
      await writeFile(join(teamworkDir, "leaked.ts"), "export const cheat = 1;");

      const mockRollbackRunner = async (): Promise<RollbackResult> => ({
        success: true,
        targetRef: TEST_CONSTANTS.MOCK_BASELINE_SHA,
        resetOutput: "reset done",
        cleanOutput: "clean done",
      });

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        baselineSha: TEST_CONSTANTS.MOCK_BASELINE_SHA,
        autoRollbackOnVeto: true,
        rollbackRunner: mockRollbackRunner,
        skipCleanRoomQa: true,
        commandRunner: async () => ({ code: 0, stdout: "", stderr: "", output: "", durationMs: 0 }),
      });

      auditor.on(GATE3_CONSTANTS.EVENT_VETO_ISSUED, () => emittedEvents.push("veto"));
      auditor.on(GATE3_CONSTANTS.EVENT_ROLLBACK_TRIGGERED, () => emittedEvents.push("rollback"));

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(result.veto).toBe(true);
      expect(result.rollbackExecuted).toBe(true);
      expect(emittedEvents).toContain("veto");
      expect(emittedEvents).toContain("rollback");
    });

    it("integrates with mock IPalProvider and executes forensic LLM audit turn", async () => {
      let promptSent = "";
      const mockPalProvider: IPalProvider = {
        providerName: "antigravity",
        modelName: "gemini-2.0-flash",
        executeTurn: async (options: PalSessionOptions): Promise<PalOutcome> => {
          const firstMsg = options.messages[0];
          const firstBlock = firstMsg?.content[0];
          if (firstBlock && firstBlock.type === PAL_CONTENT_BLOCK_TYPES.TEXT) {
            promptSent = firstBlock.text;
          }
          return {
            message: createPalMessage({
              role: PAL_ROLES.ASSISTANT,
              content: [
                createTextBlock(
                  JSON.stringify({
                    verdict: "PASS",
                    summary: "Empirical forensic analysis confirms all invariants certified.",
                  })
                ),
              ],
            }),
            finishReason: "stop",
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            },
          };
        },
        streamTurn: async function* () {},
        getCapabilities: () => ({
          providerName: "antigravity",
          modelName: "gemini-2.0-flash",
          supportsTools: true,
          supportsNativeTools: true,
          supportsStreaming: false,
          supportsVision: false,
          supportsExtendedThinking: false,
          supportsPromptCaching: false,
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
        provider: mockPalProvider,
        skipCleanRoomQa: true,
        commandRunner: async () => ({ code: 0, stdout: "", stderr: "", output: "", durationMs: 0 }),
      });

      const result = await auditor.run();
      expect(promptSent).toContain("# Task: Gate 3 Forensic Audit & Invariant Verification");
      expect(result.report.rawResponse).toContain("Empirical forensic analysis confirms");
    });

    it("evaluates registered custom invariant check functions", async () => {
      const customInvariant = async (
        ctx: Gate3ExecutionContext
      ): Promise<Gate3InvariantCheckResult> => ({
        name: "custom_licensing_check",
        category: GATE3_CONSTANTS.INVARIANT_CUSTOM,
        status: GATE3_CONSTANTS.STATUS_PASSED,
        passed: true,
        details: "License header certified on all files.",
        violations: [],
        durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
      });

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        skipCleanRoomQa: true,
        customInvariants: [customInvariant],
        commandRunner: async () => ({ code: 0, stdout: "", stderr: "", output: "", durationMs: 0 }),
      });

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(result.report.checks.some((c) => c.name === "custom_licensing_check")).toBe(true);
    });
  });

  // ==========================================================================
  // SECTION 10: OPENSPEC SPECIFICATION SCENARIOS
  // ==========================================================================
  describe("10. OpenSpec Specification Scenarios (spec.md)", () => {
    /**
     * Requirement: Forensic Integrity and Veto
     * Scenario: An agent commits mock responses in production code
     * WHEN An agent commits mock responses in production code
     * THEN Gate 3 executes binary veto and triggers atomic Git rollback
     */
    it("Scenario: An agent commits mock responses in production code -> triggers binary veto and atomic rollback", async () => {
      // 1. Arrange: Agent commits mock response stub in production code
      const prodFile = join(srcDir, "auth_provider.ts");
      await writeFile(
        prodFile,
        'import { mock } from "bun:test";\n\nexport async function verifyUserToken(token: string) {\n  return mock(() => ({ valid: true, userId: "admin" }));\n}\n'
      );

      let rollbackTargetRef: string | undefined;
      const mockRollbackRunner = async (options: RollbackOptions): Promise<RollbackResult> => {
        rollbackTargetRef = options.targetRef;
        return {
          success: true,
          targetRef: options.targetRef ?? "HEAD",
          resetOutput: "HEAD is now at baseline",
          cleanOutput: "Removing untracked files",
        };
      };

      const auditor = createGate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        targetFiles: ["src/auth_provider.ts"],
        baselineSha: TEST_CONSTANTS.MOCK_BASELINE_SHA,
        autoRollbackOnVeto: true,
        rollbackRunner: mockRollbackRunner,
        skipCleanRoomQa: true,
        commandRunner: async () => ({ code: 0, stdout: "", stderr: "", output: "", durationMs: 0 }),
      });

      // 2. Act: Execute Gate 3 Forensic Audit
      const result = await auditor.run();

      // 3. Assert: Binary VETO issued and Atomic Rollback executed
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(result.veto).toBe(true);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G3_VETO);
      expect(result.rollbackExecuted).toBe(true);
      expect(rollbackTargetRef).toBe(TEST_CONSTANTS.MOCK_BASELINE_SHA);

      expect(
        result.report.violations.some((v) => v.category === GATE3_CONSTANTS.INVARIANT_ANTI_CHEAT)
      ).toBe(true);

      const feedback = result.structuredFeedback;
      expect(feedback.xmlFeedback).toContain("<verdict>FAIL</verdict>");
      expect(feedback.xmlFeedback).toContain("<veto>true</veto>");
      expect(feedback.xmlFeedback).toContain("<rollback-executed>true</rollback-executed>");
    });

    /**
     * Requirement: Forensic Integrity and Veto
     * Scenario: All requirements and criteria pass empirical execution
     * WHEN All requirements and criteria pass empirical execution
     * THEN Gate 3 issues VICTORY CONFIRMED
     */
    it("Scenario: All requirements and criteria pass empirical execution -> Gate 3 issues VICTORY CONFIRMED", async () => {
      // 1. Arrange: Authentic implementation with zero stubs and passing empirical QA
      const prodFile = join(srcDir, "valid_feature.ts");
      await writeFile(
        prodFile,
        "export function computeTotal(items: number[]): number {\n  return items.reduce((acc, val) => acc + val, 0);\n}\n"
      );

      const testFile = join(testDir, "valid_feature.test.ts");
      await writeFile(
        testFile,
        "import { expect, test } from 'bun:test';\nimport { computeTotal } from '../src/valid_feature';\n\ntest('computes total correctly', () => {\n  expect(computeTotal([1, 2, 3])).toBe(6);\n});\n"
      );

      const mockRunner: Gate3CommandRunner = async (cmd) => ({
        code: TEST_CONSTANTS.EXIT_CODE_ZERO,
        stdout: `${cmd} PASS`,
        stderr: "",
        output: `${cmd} PASS`,
        durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
      });

      const auditor = createGate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        mode: GATE3_CONSTANTS.MODE_VICTORY,
        commandRunner: mockRunner,
        cleanRoomQaCommands: [{ command: "bun test", description: "Empirical verification" }],
      });

      // 2. Act: Execute Gate 3 Victory Audit
      const result = await auditor.run();

      // 3. Assert: VICTORY CONFIRMED and EVT_VICTORY_PASS issued
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(result.veto).toBe(false);
      expect(result.victoryConfirmed).toBe(true);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_VICTORY_PASS);
      expect(result.report.summary).toBe(GATE3_CONSTANTS.VICTORY_CONFIRMED);

      const feedback = result.structuredFeedback;
      expect(feedback.xmlFeedback).toContain("<victory-confirmed>true</victory-confirmed>");
      expect(feedback.markdownReport).toContain("VICTORY CONFIRMED");
    });
  });

  // ==========================================================================
  // SECTION 11: END-TO-END WORKFLOWS & CONVENIENCE HELPERS
  // ==========================================================================
  describe("11. End-to-End Orchestrator Workflows & Factory Helpers", () => {
    it("createGate3Auditor instantiates a fully functional auditor instance", () => {
      const auditor = createGate3Auditor({ workspaceRoot: tempDir });
      expect(auditor).toBeInstanceOf(Gate3Auditor);
    });

    it("runGate3Auditor convenience orchestrator executes end-to-end task audit cleanly", async () => {
      const result = await runGate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        skipCleanRoomQa: true,
        commandRunner: async () => ({ code: 0, stdout: "", stderr: "", output: "", durationMs: 0 }),
      });

      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(result.veto).toBe(false);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_G3_PASS);
      expect(result.report.invariantsViolated).toBe(TEST_CONSTANTS.ZERO);
    });

    it("emits EVT_VICTORY_FAIL when any invariant fails during victory audit mode", async () => {
      // Cause a failure by adding a temporary file in git status
      const mockRunner: Gate3CommandRunner = async (cmd) => {
        if (cmd === "git status --porcelain") {
          return {
            code: 0,
            stdout: "?? stray_file.tmp",
            stderr: "",
            output: "?? stray_file.tmp",
            durationMs: 0,
          };
        }
        return { code: 0, stdout: "", stderr: "", output: "", durationMs: 0 };
      };

      const result = await runGate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        mode: GATE3_CONSTANTS.MODE_VICTORY,
        skipCleanRoomQa: true,
        commandRunner: mockRunner,
      });

      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(result.veto).toBe(true);
      expect(result.victoryConfirmed).toBe(false);
      expect(result.recommendedEvent).toBe(LOOPER_EVENTS.EVT_VICTORY_FAIL);
      expect(result.report.summary).toContain("Victory audit failed");
    });

    it("generates fallback feedback when called without parameters on auditor", () => {
      const auditor = createGate3Auditor({ workspaceRoot: tempDir });
      const fb = auditor.generateFeedback();
      expect(fb.verdict).toBe(GATE3_CONSTANTS.VERDICT_PASS);
      expect(fb.veto).toBe(false);
      expect(fb.summary).toBe("No audit report evaluated.");
    });
  });
});
