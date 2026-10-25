/**
 * Unit Test Suite for Gate 0: Automated Oracle / Mechanical QA Test Runner.
 *
 * Validates the mechanical test runner implemented in `src/gates/gate0_qa.ts`
 * in accordance with OpenSpec change `looper-gate0-mechanical-qa`
 * and `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.2.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GATE0_CONSTANTS,
  Gate0MechanicalRunner,
  classifyCheckType,
  createGate0CheckDefinitions,
  createGate0Runner,
  defaultGate0CommandRunner,
  formatGate0Feedback,
  isFastTrackCandidate,
  runGate0QA,
  verifyGate0FilesystemLayout,
  type Gate0CheckDefinition,
  type Gate0CommandRunner,
  type Gate0CommandRunnerResult,
  type Gate0ExecutionContext,
  type Gate0Result,
} from "../../src/gates/gate0_qa";

const TEST_CONSTANTS = {
  SHORT_TIMEOUT_MS: 50,
  FAST_DURATION_MS: 10,
  ATTEMPT_INITIAL: 1,
  ATTEMPT_EXHAUSTED: 3,
  ATTEMPT_MAX: 3,
  CUSTOM_EXIT_CODE: 42,
  CUSTOM_PER_COMMAND_TIMEOUT_MS: 15_000,
} as const;

describe("Gate 0: Automated Mechanical QA Runner", () => {
  describe("GATE0_CONSTANTS", () => {
    it("exposes expected exit codes", () => {
      expect(GATE0_CONSTANTS.EXIT_CODE_SUCCESS).toBe(0);
      expect(GATE0_CONSTANTS.EXIT_CODE_FAILURE).toBe(1);
      expect(GATE0_CONSTANTS.EXIT_CODE_ERROR).toBe(2);
      expect(GATE0_CONSTANTS.EXIT_CODE_TIMEOUT).toBe(124);
    });

    it("exposes default timeouts and execution limits", () => {
      expect(GATE0_CONSTANTS.DEFAULT_GATE_TIMEOUT_MS).toBe(1_800_000);
      expect(GATE0_CONSTANTS.DEFAULT_PER_COMMAND_TIMEOUT_MS).toBe(300_000);
      expect(GATE0_CONSTANTS.DEFAULT_LAYOUT_TIMEOUT_MS).toBe(30_000);
      expect(GATE0_CONSTANTS.DEFAULT_MAX_ATTEMPTS).toBe(3);
      expect(GATE0_CONSTANTS.DEFAULT_CURRENT_ATTEMPT).toBe(1);
      expect(GATE0_CONSTANTS.DEFAULT_PREVIEW_LINES).toBe(10);
      expect(GATE0_CONSTANTS.DEFAULT_TAIL_LINES).toBe(25);
      expect(GATE0_CONSTANTS.DEFAULT_MAX_OUTPUT_LENGTH).toBe(4_000);
      expect(GATE0_CONSTANTS.DEFAULT_FEEDBACK_TRUNCATION_LIMIT).toBe(2_500);
    });

    it("exposes check types, execution statuses, and verdicts", () => {
      expect(GATE0_CONSTANTS.CHECK_TYPE_TYPECHECK).toBe("typecheck");
      expect(GATE0_CONSTANTS.CHECK_TYPE_TEST).toBe("test");
      expect(GATE0_CONSTANTS.CHECK_TYPE_LINT).toBe("lint");
      expect(GATE0_CONSTANTS.CHECK_TYPE_BUILD).toBe("build");
      expect(GATE0_CONSTANTS.CHECK_TYPE_LAYOUT).toBe("layout");
      expect(GATE0_CONSTANTS.CHECK_TYPE_CUSTOM).toBe("custom");

      expect(GATE0_CONSTANTS.STATUS_PASSED).toBe("passed");
      expect(GATE0_CONSTANTS.STATUS_FAILED).toBe("failed");
      expect(GATE0_CONSTANTS.STATUS_SKIPPED).toBe("skipped");
      expect(GATE0_CONSTANTS.STATUS_TIMEOUT).toBe("timeout");
      expect(GATE0_CONSTANTS.STATUS_ERROR).toBe("error");

      expect(GATE0_CONSTANTS.VERDICT_PASSED).toBe("PASSED");
      expect(GATE0_CONSTANTS.VERDICT_FAILED).toBe("FAILED");
      expect(GATE0_CONSTANTS.VERDICT_TIMEOUT).toBe("TIMEOUT");
      expect(GATE0_CONSTANTS.VERDICT_ERROR).toBe("ERROR");
    });

    it("defines protected metadata directory, layout check identifier, and extensions", () => {
      expect(GATE0_CONSTANTS.DEFAULT_PROTECTED_METADATA_DIR).toBe(".agents/teamwork");
      expect(GATE0_CONSTANTS.LAYOUT_CHECK_ID).toBe("gate0-filesystem-layout");
      expect(GATE0_CONSTANTS.LAYOUT_CHECK_NAME).toBe("Filesystem Layout Invariant Check");

      expect(GATE0_CONSTANTS.FORBIDDEN_SOURCE_EXTENSIONS).toContain(".ts");
      expect(GATE0_CONSTANTS.FORBIDDEN_SOURCE_EXTENSIONS).toContain(".tsx");
      expect(GATE0_CONSTANTS.FORBIDDEN_SOURCE_EXTENSIONS).toContain(".js");
      expect(GATE0_CONSTANTS.FORBIDDEN_SOURCE_EXTENSIONS).toContain(".jsx");
      expect(GATE0_CONSTANTS.FORBIDDEN_SOURCE_EXTENSIONS).toContain(".py");
      expect(GATE0_CONSTANTS.FORBIDDEN_SOURCE_EXTENSIONS).toContain(".sh");

      expect(GATE0_CONSTANTS.DOC_EXTENSIONS).toContain(".md");
      expect(GATE0_CONSTANTS.DOC_EXTENSIONS).toContain(".markdown");
      expect(GATE0_CONSTANTS.DOC_EXTENSIONS).toContain(".txt");
      expect(GATE0_CONSTANTS.DOC_EXTENSIONS).toContain(".rst");
    });

    it("defines default verification commands and policy constants", () => {
      expect(GATE0_CONSTANTS.DEFAULT_COMMANDS).toContain("bun test");
      expect(GATE0_CONSTANTS.DEFAULT_COMMANDS).toContain("bunx tsc --noEmit");
      expect(GATE0_CONSTANTS.DEFAULT_COMMANDS).toContain("bun run lint");
      expect(GATE0_CONSTANTS.DEFAULT_COMMANDS).toContain("bun run build");

      expect(GATE0_CONSTANTS.POLICY_FAST_TRACK).toBe("fast-track");
      expect(GATE0_CONSTANTS.POLICY_FULL_GATE).toBe("full-gate");
      expect(GATE0_CONSTANTS.POLICY_AUTO).toBe("auto");
    });
  });

  describe("classifyCheckType", () => {
    it("categorizes typecheck commands", () => {
      expect(classifyCheckType("bunx tsc --noEmit")).toBe("typecheck");
      expect(classifyCheckType("tsc -p tsconfig.json")).toBe("typecheck");
      expect(classifyCheckType("bun run typecheck")).toBe("typecheck");
    });

    it("categorizes test commands", () => {
      expect(classifyCheckType("bun test")).toBe("test");
      expect(classifyCheckType("bun test test/gates/gate0.test.ts")).toBe("test");
      expect(classifyCheckType("npm test")).toBe("test");
      expect(classifyCheckType("jest")).toBe("test");
      expect(classifyCheckType("vitest run")).toBe("test");
      expect(classifyCheckType("mocha test/**/*.ts")).toBe("test");
      expect(classifyCheckType("playwright test")).toBe("test");
      expect(classifyCheckType("cypress run")).toBe("test");
    });

    it("categorizes lint commands", () => {
      expect(classifyCheckType("bun run lint")).toBe("lint");
      expect(classifyCheckType("eslint .")).toBe("lint");
      expect(classifyCheckType("biome check")).toBe("lint");
    });

    it("categorizes build commands", () => {
      expect(classifyCheckType("bun run build")).toBe("build");
      expect(classifyCheckType("vite build")).toBe("build");
      expect(classifyCheckType("ncc compile")).toBe("build");
      expect(classifyCheckType("esbuild src/index.ts --bundle")).toBe("build");
    });

    it("categorizes layout commands", () => {
      expect(classifyCheckType("layout-check .agents/teamwork")).toBe("layout");
      expect(classifyCheckType("verify-layout")).toBe("layout");
    });

    it("categorizes arbitrary commands as custom", () => {
      expect(classifyCheckType("git status --porcelain")).toBe("custom");
      expect(classifyCheckType("echo 'hello world'")).toBe("custom");
    });
  });

  describe("isFastTrackCandidate", () => {
    it("returns false for undefined, null, or empty affected files", () => {
      expect(isFastTrackCandidate()).toBe(false);
      expect(isFastTrackCandidate(undefined)).toBe(false);
      expect(isFastTrackCandidate([])).toBe(false);
    });

    it("returns true for markdown documentation files", () => {
      expect(isFastTrackCandidate(["docs/architecture.md", "README.md"])).toBe(true);
      expect(isFastTrackCandidate(["openspec/changes/gate0/proposal.md"])).toBe(true);
      expect(isFastTrackCandidate(["notes.txt", "docs/guide.rst", "manual.adoc"])).toBe(true);
    });

    it("returns false as soon as a source code or config file is included", () => {
      expect(isFastTrackCandidate(["README.md", "src/gates/gate0_qa.ts"])).toBe(false);
      expect(isFastTrackCandidate(["src/index.js"])).toBe(false);
      expect(isFastTrackCandidate(["script.py"])).toBe(false);
      expect(isFastTrackCandidate(["run.sh"])).toBe(false);
      expect(isFastTrackCandidate(["package.json"])).toBe(false);
    });
  });

  describe("verifyGate0FilesystemLayout", () => {
    const testTempDir = join(process.cwd(), ".tmp-test-layout-" + Date.now());
    const metadataDir = join(testTempDir, ".agents", "teamwork");

    it("passes when directory does not exist", async () => {
      const nonExistent = await verifyGate0FilesystemLayout(testTempDir, ".agents/teamwork");
      expect(nonExistent.valid).toBe(true);
      expect(nonExistent.violations).toHaveLength(0);
      expect(nonExistent.scannedCount).toBe(0);
    });

    it("handles non-directory target path gracefully", async () => {
      await mkdir(testTempDir, { recursive: true });
      const filePath = join(testTempDir, "dummy-file.txt");
      await writeFile(filePath, "sample text", "utf-8");

      const fileTargetResult = await verifyGate0FilesystemLayout(testTempDir, filePath);
      expect(fileTargetResult.valid).toBe(true);
      expect(fileTargetResult.violations).toHaveLength(0);
      expect(fileTargetResult.scannedCount).toBe(0);

      await rm(testTempDir, { recursive: true, force: true });
    });

    it("passes when metadata directory contains exclusively allowed metadata files", async () => {
      await mkdir(metadataDir, { recursive: true });
      await writeFile(join(metadataDir, "BRIEFING.md"), "# Briefing\n", "utf-8");
      await writeFile(join(metadataDir, "progress.json"), '{"step": 1}', "utf-8");
      await writeFile(join(metadataDir, "notes.txt"), "status notes", "utf-8");

      const validResult = await verifyGate0FilesystemLayout(testTempDir, ".agents/teamwork");
      expect(validResult.valid).toBe(true);
      expect(validResult.violations).toHaveLength(0);
      expect(validResult.scannedCount).toBe(3);

      await rm(testTempDir, { recursive: true, force: true });
    });

    it("detects source code files placed inside protected metadata directory", async () => {
      await mkdir(metadataDir, { recursive: true });
      await writeFile(join(metadataDir, "BRIEFING.md"), "# Briefing\n", "utf-8");
      await writeFile(join(metadataDir, "illegal_code.ts"), "export const x = 1;\n", "utf-8");
      await writeFile(join(metadataDir, "leak.py"), "print('leaked')\n", "utf-8");

      const invalidResult = await verifyGate0FilesystemLayout(testTempDir, ".agents/teamwork");
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.violations.length).toBeGreaterThanOrEqual(2);
      expect(invalidResult.violations.some((v) => v.filePath.includes("illegal_code.ts"))).toBe(true);
      expect(invalidResult.violations.some((v) => v.filePath.includes("leak.py"))).toBe(true);

      await rm(testTempDir, { recursive: true, force: true });
    });

    it("detects forbidden source code files placed in deep nested subdirectories", async () => {
      const nestedSubDir = join(metadataDir, "nested", "deeper");
      await mkdir(nestedSubDir, { recursive: true });
      await writeFile(join(metadataDir, "valid.md"), "# Valid Doc\n", "utf-8");
      await writeFile(join(nestedSubDir, "hidden_script.sh"), "#!/bin/bash\necho bad\n", "utf-8");
      await writeFile(join(nestedSubDir, "App.java"), "public class App {}\n", "utf-8");

      const nestedResult = await verifyGate0FilesystemLayout(testTempDir, ".agents/teamwork");
      expect(nestedResult.valid).toBe(false);
      expect(nestedResult.violations.length).toBe(2);
      expect(nestedResult.violations.some((v) => v.filePath.includes("hidden_script.sh"))).toBe(true);
      expect(nestedResult.violations.some((v) => v.filePath.includes("App.java"))).toBe(true);

      await rm(testTempDir, { recursive: true, force: true });
    });
  });

  describe("createGate0CheckDefinitions", () => {
    it("generates default check suite including layout check", () => {
      const checks = createGate0CheckDefinitions({});
      expect(checks.length).toBe(5);
      expect(checks[0]?.type).toBe("layout");
      expect(checks[1]?.type).toBe("test");
      expect(checks[2]?.type).toBe("typecheck");
      expect(checks[3]?.type).toBe("lint");
      expect(checks[4]?.type).toBe("build");
    });

    it("incorporates specs into test command", () => {
      const checks = createGate0CheckDefinitions({
        specs: ["test/gates/gate0.test.ts", "test/gates/gate0_parser.test.ts"],
      });
      const testCheck = checks.find((c) => c.type === "test");
      expect(testCheck?.command).toBe("bun test test/gates/gate0.test.ts test/gates/gate0_parser.test.ts");
    });

    it("can disable layout check", () => {
      const checks = createGate0CheckDefinitions({
        enableLayoutCheck: false,
      });
      expect(checks.some((c) => c.type === "layout")).toBe(false);
      expect(checks.length).toBe(4);
    });

    it("supports custom list of string commands", () => {
      const checks = createGate0CheckDefinitions({
        enableLayoutCheck: false,
        commands: ["bun test", "bunx tsc --noEmit"],
        perCommandTimeoutMs: TEST_CONSTANTS.CUSTOM_PER_COMMAND_TIMEOUT_MS,
      });
      expect(checks.length).toBe(2);
      expect(checks[0]?.command).toBe("bun test");
      expect(checks[0]?.timeoutMs).toBe(TEST_CONSTANTS.CUSTOM_PER_COMMAND_TIMEOUT_MS);
      expect(checks[1]?.command).toBe("bunx tsc --noEmit");
    });

    it("supports custom check definition objects", () => {
      const customDefinition: Gate0CheckDefinition = {
        id: "custom-memory",
        name: "Memory Assertions",
        type: "custom",
        required: true,
      };

      const checks = createGate0CheckDefinitions({
        enableLayoutCheck: false,
        commands: [customDefinition],
      });

      expect(checks.length).toBe(1);
      expect(checks[0]?.id).toBe("custom-memory");
    });
  });

  describe("Gate0MechanicalRunner", () => {
    it("provides read-only access to options via getOptions", () => {
      const runner = new Gate0MechanicalRunner({
        stopOnFirstFailure: false,
        taskId: "1.4",
      });
      const options = runner.getOptions();
      expect(options.stopOnFirstFailure).toBe(false);
      expect(options.taskId).toBe("1.4");
    });

    it("passes when all checks succeed", async () => {
      const mockRunner: Gate0CommandRunner = async (cmd) => ({
        code: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
        stdout: `Passed: ${cmd}`,
        stderr: "",
        output: `Passed: ${cmd}`,
        durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
        timedOut: false,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: ["bun test", "bunx tsc --noEmit"],
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE0_CONSTANTS.VERDICT_PASSED);
      expect(result.exitCode).toBe(GATE0_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(result.failures).toHaveLength(0);
      expect(result.passed).toHaveLength(2);
      expect(result.summary).toContain("Gate 0 Oracle PASSED");
      expect(result.feedbackPrompt).toBeUndefined();
      expect(result.recommendedEvent).toBe("EVT_G0_PASS");
    });

    it("stops on first failure when stopOnFirstFailure is true", async () => {
      const executedCommands: string[] = [];

      const mockRunner: Gate0CommandRunner = async (cmd) => {
        executedCommands.push(cmd);
        if (cmd === "bun test") {
          return {
            code: GATE0_CONSTANTS.EXIT_CODE_FAILURE,
            stdout: "",
            stderr: "1 test failed: AssertionError",
            output: "1 test failed: AssertionError",
            durationMs: 20,
            timedOut: false,
          };
        }
        return {
          code: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
          stdout: "OK",
          stderr: "",
          output: "OK",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
          timedOut: false,
        };
      };

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: ["bun test", "bunx tsc --noEmit", "bun run lint"],
        stopOnFirstFailure: true,
        runner: mockRunner,
        taskId: "1.4",
        attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE0_CONSTANTS.VERDICT_FAILED);
      expect(result.exitCode).toBe(GATE0_CONSTANTS.EXIT_CODE_FAILURE);
      expect(result.failures).toHaveLength(1);
      expect(result.skipped).toHaveLength(2);
      expect(executedCommands).toEqual(["bun test"]);
      expect(result.feedbackPrompt).toBeDefined();
      expect(result.feedbackPrompt).toContain('<verification-feedback gate="gate0" verdict="FAILED">');
      expect(result.feedbackPrompt).toContain("1 test failed: AssertionError");
      expect(result.recommendedEvent).toBe("EVT_G0_RETRY");
    });

    it("continues on failure when stopOnFirstFailure is false", async () => {
      const executedCommands: string[] = [];

      const mockRunner: Gate0CommandRunner = async (cmd) => {
        executedCommands.push(cmd);
        const isFailing = cmd === "bun test";
        return {
          code: isFailing ? GATE0_CONSTANTS.EXIT_CODE_FAILURE : GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
          stdout: isFailing ? "" : "OK",
          stderr: isFailing ? "fail" : "",
          output: isFailing ? "fail" : "OK",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
          timedOut: false,
        };
      };

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: ["bun test", "bunx tsc --noEmit"],
        stopOnFirstFailure: false,
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.passed).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
      expect(executedCommands).toEqual(["bun test", "bunx tsc --noEmit"]);
    });

    it("fails and skips subsequent checks when layout invariant check fails", async () => {
      const testTempDir = join(process.cwd(), ".tmp-test-runner-layout-" + Date.now());
      const metadataDir = join(testTempDir, ".agents", "teamwork");
      await mkdir(metadataDir, { recursive: true });
      await writeFile(join(metadataDir, "illegal.ts"), "export const invalid = true;\n", "utf-8");

      let commandRun = false;
      const mockRunner: Gate0CommandRunner = async () => {
        commandRun = true;
        return {
          code: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
          stdout: "OK",
          stderr: "",
          output: "OK",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
          timedOut: false,
        };
      };

      const runner = new Gate0MechanicalRunner({
        repoRoot: testTempDir,
        enableLayoutCheck: true,
        stopOnFirstFailure: true,
        commands: ["bun test"],
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE0_CONSTANTS.VERDICT_FAILED);
      expect(result.layoutResult?.valid).toBe(false);
      expect(result.layoutResult?.violations.length).toBeGreaterThan(0);
      expect(result.failures[0]?.type).toBe("layout");
      expect(result.skipped).toHaveLength(1);
      expect(commandRun).toBe(false);

      await rm(testTempDir, { recursive: true, force: true });
    });

    it("handles command timeouts cleanly with TIMEOUT verdict", async () => {
      const mockRunner: Gate0CommandRunner = async (cmd) => ({
        code: GATE0_CONSTANTS.EXIT_CODE_TIMEOUT,
        stdout: "",
        stderr: `Command timed out: ${cmd}`,
        output: `Command timed out: ${cmd}`,
        durationMs: 5000,
        timedOut: true,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: ["bun test"],
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE0_CONSTANTS.VERDICT_TIMEOUT);
      expect(result.exitCode).toBe(GATE0_CONSTANTS.EXIT_CODE_TIMEOUT);
      expect(result.failures[0]?.timedOut).toBe(true);
      expect(result.failures[0]?.status).toBe("timeout");
    });

    it("supports custom check runners and injects execution context", async () => {
      let receivedContext: Gate0ExecutionContext | undefined;

      const customCheck: Gate0CheckDefinition = {
        id: "custom-validator",
        name: "Custom Memory Check",
        type: "custom",
        required: true,
        customRunner: async (ctx) => {
          receivedContext = ctx;
          return {
            id: "custom-validator",
            name: "Custom Memory Check",
            type: "custom",
            command: "internal-check",
            exitCode: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
            status: GATE0_CONSTANTS.STATUS_PASSED,
            stdout: "Memory within bounds",
            stderr: "",
            output: "Memory within bounds",
            durationMs: 5,
            timedOut: false,
          };
        },
      };

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: [customCheck],
        taskId: "1.4",
      });

      const result = await runner.run();
      expect(result.success).toBe(true);
      expect(result.passed).toHaveLength(1);
      expect(result.passed[0]?.id).toBe("custom-validator");
      expect(receivedContext?.taskId).toBe("1.4");
      expect(receivedContext?.runner).toBeDefined();
    });

    it("handles unexpected errors thrown by custom runner safely", async () => {
      const throwingCheck: Gate0CheckDefinition = {
        id: "failing-custom",
        name: "Crashing Custom Check",
        type: "custom",
        required: true,
        customRunner: async () => {
          throw new Error("Unhandled crash in check logic");
        },
      };

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: [throwingCheck],
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.status).toBe("error");
      expect(result.failures[0]?.exitCode).toBe(GATE0_CONSTANTS.EXIT_CODE_ERROR);
      expect(result.failures[0]?.errorMessage).toBe("Unhandled crash in check logic");
    });

    it("populates parsedTrace when command check fails", async () => {
      const mockRunner: Gate0CommandRunner = async () => ({
        code: GATE0_CONSTANTS.EXIT_CODE_FAILURE,
        stdout: "src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        stderr: "",
        output: "src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
        timedOut: false,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: ["bunx tsc --noEmit"],
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      const failure = result.failures[0];
      expect(failure?.parsedTrace).toBeDefined();
      expect(failure?.parsedTrace?.diagnostics.length).toBeGreaterThan(0);
      expect(failure?.parsedTrace?.diagnostics[0]?.code).toBe("TS2322");
    });

    it("triggers lifecycle hooks during run", async () => {
      const hookEvents: string[] = [];

      const mockRunner: Gate0CommandRunner = async () => ({
        code: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
        stdout: "ok",
        stderr: "",
        output: "ok",
        durationMs: 1,
        timedOut: false,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        commands: ["bun test"],
        runner: mockRunner,
        hooks: {
          onCheckStart: (c) => hookEvents.push(`start:${c.id}`),
          onCheckComplete: (r) => hookEvents.push(`complete:${r.id}`),
          onGateComplete: (res) => hookEvents.push(`gate:${res.verdict}`),
          say: (msg) => hookEvents.push(`say:${msg.slice(0, 15)}`),
          log: (evt) => hookEvents.push(`log:${evt}`),
        },
      });

      const result = await runner.run();
      expect(result.success).toBe(true);
      expect(hookEvents.some((e) => e.startsWith("start:"))).toBe(true);
      expect(hookEvents.some((e) => e.startsWith("complete:"))).toBe(true);
      expect(hookEvents.some((e) => e.startsWith("gate:PASSED"))).toBe(true);
      expect(hookEvents.some((e) => e.startsWith("log:gate0_policy"))).toBe(true);
      expect(hookEvents.some((e) => e.startsWith("log:gate0_check"))).toBe(true);
    });

    describe("Fast-Track Policy Integration", () => {
      it("grants fast-track policy and bypasses subsequent gates for pure doc changes", async () => {
        const mockRunner: Gate0CommandRunner = async () => ({
          code: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
          stdout: "OK",
          stderr: "",
          output: "OK",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
          timedOut: false,
        });

        const runner = new Gate0MechanicalRunner({
          enableLayoutCheck: false,
          affectedFiles: ["README.md", "docs/architecture.md"],
          commands: ["bun test"],
          runner: mockRunner,
        });

        const result = await runner.run();
        expect(result.success).toBe(true);
        expect(result.fastTrackEligible).toBe(true);
        expect(result.bypassedGates).toEqual(["gate1", "gate2"]);
        expect(result.recommendedEvent).toBe("EVT_G0_PASS_FAST_TRACK");
      });

      it("executes fastTrackCommands when fast-track policy is active", async () => {
        const executed: string[] = [];
        const mockRunner: Gate0CommandRunner = async (cmd) => {
          executed.push(cmd);
          return {
            code: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
            stdout: "OK",
            stderr: "",
            output: "OK",
            durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
            timedOut: false,
          };
        };

        const runner = new Gate0MechanicalRunner({
          enableLayoutCheck: false,
          affectedFiles: ["README.md"],
          commands: ["bun test", "bunx tsc --noEmit", "bun run build"],
          fastTrackCommands: ["markdownlint README.md"],
          runner: mockRunner,
        });

        const result = await runner.run();
        expect(result.success).toBe(true);
        expect(result.fastTrackEligible).toBe(true);
        expect(executed).toEqual(["markdownlint README.md"]);
      });

      it("recommends EVT_G0_RETRY when checks fail on attempt 1 of 3", async () => {
        const mockRunner: Gate0CommandRunner = async () => ({
          code: GATE0_CONSTANTS.EXIT_CODE_FAILURE,
          stdout: "",
          stderr: "check failed",
          output: "check failed",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
          timedOut: false,
        });

        const runner = new Gate0MechanicalRunner({
          enableLayoutCheck: false,
          commands: ["bun test"],
          attempt: TEST_CONSTANTS.ATTEMPT_INITIAL,
          maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
          runner: mockRunner,
        });

        const result = await runner.run();
        expect(result.success).toBe(false);
        expect(result.recommendedEvent).toBe("EVT_G0_RETRY");
      });

      it("recommends EVT_G0_EXHAUSTED when checks fail and attempt reaches maxAttempts", async () => {
        const mockRunner: Gate0CommandRunner = async () => ({
          code: GATE0_CONSTANTS.EXIT_CODE_FAILURE,
          stdout: "",
          stderr: "check failed",
          output: "check failed",
          durationMs: TEST_CONSTANTS.FAST_DURATION_MS,
          timedOut: false,
        });

        const runner = new Gate0MechanicalRunner({
          enableLayoutCheck: false,
          commands: ["bun test"],
          attempt: TEST_CONSTANTS.ATTEMPT_EXHAUSTED,
          maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
          runner: mockRunner,
        });

        const result = await runner.run();
        expect(result.success).toBe(false);
        expect(result.recommendedEvent).toBe("EVT_G0_EXHAUSTED");
      });
    });
  });

  describe("formatGate0Feedback", () => {
    it("returns empty string when gate succeeds", () => {
      const successResult: Gate0Result = {
        success: true,
        verdict: GATE0_CONSTANTS.VERDICT_PASSED,
        exitCode: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
        checks: [],
        failures: [],
        passed: [],
        skipped: [],
        durationMs: 100,
        summary: "Passed",
        fastTrackEligible: false,
        timestamp: new Date().toISOString(),
      };
      expect(formatGate0Feedback(successResult)).toBe("");
    });

    it("formats failures into XML tags with task and attempt details", () => {
      const failedResult: Gate0Result = {
        success: false,
        verdict: GATE0_CONSTANTS.VERDICT_FAILED,
        exitCode: GATE0_CONSTANTS.EXIT_CODE_FAILURE,
        checks: [],
        failures: [
          {
            id: "gate0-test",
            name: "Unit Test",
            type: "test",
            command: "bun test",
            exitCode: GATE0_CONSTANTS.EXIT_CODE_FAILURE,
            status: "failed",
            stdout: "Running test...\n3 passing",
            stderr: "1 failing\nExpected 2 to be 1",
            output: "output trace",
            durationMs: 50,
            timedOut: false,
          },
        ],
        passed: [],
        skipped: [],
        durationMs: 50,
        summary: "Failed",
        fastTrackEligible: false,
        timestamp: new Date().toISOString(),
      };

      const feedback = formatGate0Feedback(failedResult, {
        taskId: "1.4",
        attempt: 2,
        maxAttempts: TEST_CONSTANTS.ATTEMPT_MAX,
      });

      expect(feedback).toContain("Task 1.4 is not done");
      expect(feedback).toContain("(attempt 2/3)");
      expect(feedback).toContain('<verification-feedback gate="gate0" verdict="FAILED">');
      expect(feedback).toContain('<failure check_id="gate0-test" type="test" command="bun test" exit_code="1"');
      expect(feedback).toContain("<stderr>");
      expect(feedback).toContain("Expected 2 to be 1");
      expect(feedback).toContain("</failure>");
    });
  });

  describe("Convenience functions and default runner", () => {
    it("createGate0Runner returns a Gate0MechanicalRunner instance", () => {
      const runner = createGate0Runner({ enableLayoutCheck: false });
      expect(runner).toBeInstanceOf(Gate0MechanicalRunner);
    });

    it("runGate0QA executes gate with options", async () => {
      const mockRunner: Gate0CommandRunner = async () => ({
        code: GATE0_CONSTANTS.EXIT_CODE_SUCCESS,
        stdout: "all good",
        stderr: "",
        output: "all good",
        durationMs: 5,
        timedOut: false,
      });

      const res = await runGate0QA({
        enableLayoutCheck: false,
        commands: ["echo 1"],
        runner: mockRunner,
      });

      expect(res.success).toBe(true);
      expect(res.passed).toHaveLength(1);
    });

    it("defaultGate0CommandRunner executes live shell commands cleanly", async () => {
      const res = await defaultGate0CommandRunner('echo "gate0_live_test"');
      expect(res.code).toBe(GATE0_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(res.stdout).toContain("gate0_live_test");
      expect(res.timedOut).toBe(false);
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("defaultGate0CommandRunner captures non-zero exit codes", async () => {
      const res = await defaultGate0CommandRunner(`sh -c "exit ${TEST_CONSTANTS.CUSTOM_EXIT_CODE}"`);
      expect(res.code).toBe(TEST_CONSTANTS.CUSTOM_EXIT_CODE);
      expect(res.timedOut).toBe(false);
    });

    it("defaultGate0CommandRunner supports custom environment variables", async () => {
      const res = await defaultGate0CommandRunner('sh -c "echo $TEST_GATE0_ENV"', {
        env: { TEST_GATE0_ENV: "verified_env_value" },
      });
      expect(res.code).toBe(GATE0_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(res.stdout).toContain("verified_env_value");
    });

    it("defaultGate0CommandRunner handles command timeouts cleanly", async () => {
      const res = await defaultGate0CommandRunner("sleep 2", {
        timeoutMs: TEST_CONSTANTS.SHORT_TIMEOUT_MS,
      });
      expect(res.timedOut).toBe(true);
      expect(res.code).toBe(GATE0_CONSTANTS.EXIT_CODE_TIMEOUT);
      expect(res.stderr).toContain("timed out");
    });
  });
});
