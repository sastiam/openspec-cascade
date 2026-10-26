/**
 * Unit Test Suite for Gate 0: Fast-Track Policy Bypass Evaluator.
 *
 * Validates the documentation-only fast-track policy bypass implemented in
 * `src/gates/gate0_policy.ts` and integrated in `src/gates/gate0_qa.ts`, in accordance
 * with OpenSpec change `looper-gate0-mechanical-qa` Task 1.3 and
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.6 & Section 2.2.2.
 */

import { describe, expect, it } from "bun:test";
import {
  GATE0_POLICY_CONSTANTS,
  Gate0MechanicalRunner,
  detectGitAffectedFiles,
  evaluateGateExecutionPolicy,
  isDisqualifiedFile,
  isDocumentationFile,
  isFastTrackCandidate,
  normalizeFilePath,
  resolveGate0RecommendedEvent,
  type Gate0CommandRunner,
} from "../../src/gates/gate0_qa";

describe("Gate 0: Fast-Track Policy Bypass for Documentation-Only Changes (Task 1.3)", () => {
  describe("GATE0_POLICY_CONSTANTS", () => {
    it("exposes canonical policy names and gate identifiers", () => {
      expect(GATE0_POLICY_CONSTANTS.POLICY_FAST_TRACK).toBe("fast-track");
      expect(GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE).toBe("full-gate");
      expect(GATE0_POLICY_CONSTANTS.POLICY_AUTO).toBe("auto");

      expect(GATE0_POLICY_CONSTANTS.GATE_0).toBe("gate0");
      expect(GATE0_POLICY_CONSTANTS.GATE_1).toBe("gate1");
      expect(GATE0_POLICY_CONSTANTS.GATE_2).toBe("gate2");
      expect(GATE0_POLICY_CONSTANTS.GATE_3).toBe("gate3");
    });

    it("defines FSM transition events for Gate 0", () => {
      expect(GATE0_POLICY_CONSTANTS.EVT_G0_PASS).toBe("EVT_G0_PASS");
      expect(GATE0_POLICY_CONSTANTS.EVT_G0_PASS_FAST_TRACK).toBe("EVT_G0_PASS_FAST_TRACK");
      expect(GATE0_POLICY_CONSTANTS.EVT_G0_RETRY).toBe("EVT_G0_RETRY");
      expect(GATE0_POLICY_CONSTANTS.EVT_G0_EXHAUSTED).toBe("EVT_G0_EXHAUSTED");
    });

    it("specifies documentation and disqualified extensions", () => {
      expect(GATE0_POLICY_CONSTANTS.DOC_EXTENSIONS).toContain(".md");
      expect(GATE0_POLICY_CONSTANTS.DOC_EXTENSIONS).toContain(".markdown");
      expect(GATE0_POLICY_CONSTANTS.DOC_EXTENSIONS).toContain(".txt");
      expect(GATE0_POLICY_CONSTANTS.DOC_EXTENSIONS).toContain(".rst");

      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_EXTENSIONS).toContain(".ts");
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_EXTENSIONS).toContain(".js");
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_EXTENSIONS).toContain(".py");
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_EXTENSIONS).toContain(".sh");
    });

    it("specifies disqualified configuration files and directories", () => {
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_CONFIG_FILES).toContain("package.json");
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_CONFIG_FILES).toContain("tsconfig.json");
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_CONFIG_FILES).toContain("bun.lock");

      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_DIRECTORIES).toContain("src/");
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_DIRECTORIES).toContain("test/");
      expect(GATE0_POLICY_CONSTANTS.DISQUALIFIED_DIRECTORIES).toContain(".github/workflows/");
    });
  });

  describe("normalizeFilePath", () => {
    it("converts Windows separators, strips leading ./, and trims whitespace", () => {
      expect(normalizeFilePath("docs\\architecture.md")).toBe("docs/architecture.md");
      expect(normalizeFilePath("./README.md")).toBe("README.md");
      expect(normalizeFilePath("   openspec/proposal.md   ")).toBe("openspec/proposal.md");
    });
  });

  describe("isDisqualifiedFile", () => {
    it("identifies executable source code extensions as disqualified", () => {
      expect(isDisqualifiedFile("src/index.ts")).toBe(true);
      expect(isDisqualifiedFile("script.py")).toBe(true);
      expect(isDisqualifiedFile("server.js")).toBe(true);
      expect(isDisqualifiedFile("deploy.sh")).toBe(true);
      expect(isDisqualifiedFile("main.go")).toBe(true);
      expect(isDisqualifiedFile("lib.rs")).toBe(true);
    });

    it("identifies secret environment files as disqualified", () => {
      expect(isDisqualifiedFile(".env")).toBe(true);
      expect(isDisqualifiedFile(".env.local")).toBe(true);
      expect(isDisqualifiedFile(".env.production")).toBe(true);
    });

    it("identifies package, build, and configuration files as disqualified", () => {
      expect(isDisqualifiedFile("package.json")).toBe(true);
      expect(isDisqualifiedFile("tsconfig.json")).toBe(true);
      expect(isDisqualifiedFile("bun.lock")).toBe(true);
      expect(isDisqualifiedFile("bun.lockb")).toBe(true);
      expect(isDisqualifiedFile("Dockerfile")).toBe(true);
      expect(isDisqualifiedFile("docker-compose.yml")).toBe(true);
      expect(isDisqualifiedFile("Makefile")).toBe(true);
    });

    it("identifies source, test, and workflow directories as disqualified", () => {
      expect(isDisqualifiedFile("src/notes.txt")).toBe(true);
      expect(isDisqualifiedFile("test/fixture.md")).toBe(true);
      expect(isDisqualifiedFile(".github/workflows/ci.yml")).toBe(true);
    });

    it("returns false for valid documentation files outside disqualified zones", () => {
      expect(isDisqualifiedFile("README.md")).toBe(false);
      expect(isDisqualifiedFile("docs/architecture.md")).toBe(false);
      expect(isDisqualifiedFile("openspec/changes/gate0/tasks.md")).toBe(false);
      expect(isDisqualifiedFile(".agents/teamwork/BRIEFING.md")).toBe(false);
    });

    it("returns true for empty or non-string inputs", () => {
      expect(isDisqualifiedFile("")).toBe(true);
      expect(isDisqualifiedFile("   ")).toBe(true);
      // @ts-expect-error test invalid types
      expect(isDisqualifiedFile(null)).toBe(true);
      // @ts-expect-error test invalid types
      expect(isDisqualifiedFile(undefined)).toBe(true);
    });
  });

  describe("isDocumentationFile", () => {
    it("recognizes standard markdown and text documentation extensions", () => {
      expect(isDocumentationFile("README.md")).toBe(true);
      expect(isDocumentationFile("docs/user_guide.markdown")).toBe(true);
      expect(isDocumentationFile("notes.txt")).toBe(true);
      expect(isDocumentationFile("manual.rst")).toBe(true);
      expect(isDocumentationFile("spec.adoc")).toBe(true);
    });

    it("recognizes standard repository root documentation files with or without extensions", () => {
      expect(isDocumentationFile("LICENSE")).toBe(true);
      expect(isDocumentationFile("LICENSE.txt")).toBe(true);
      expect(isDocumentationFile("CHANGELOG.md")).toBe(true);
      expect(isDocumentationFile("CONTRIBUTING.md")).toBe(true);
      expect(isDocumentationFile("AUTHORS")).toBe(true);
      expect(isDocumentationFile("NOTICE")).toBe(true);
      expect(isDocumentationFile("SECURITY.md")).toBe(true);
      expect(isDocumentationFile("ARCHIFY.md")).toBe(true);
    });

    it("recognizes documentation assets and metadata inside documentation folders", () => {
      expect(isDocumentationFile("docs/images/arch.svg")).toBe(true);
      expect(isDocumentationFile("docs/diagrams/flow.mermaid")).toBe(true);
      expect(isDocumentationFile("docs/diagrams/model.puml")).toBe(true);
      expect(isDocumentationFile("openspec/changes/gate0/.openspec.yaml")).toBe(true);
      expect(isDocumentationFile(".agents/teamwork/plan.json")).toBe(true);
      expect(isDocumentationFile(".archify/manifest.json")).toBe(true);
      expect(isDocumentationFile("graphify-out/GRAPH_REPORT.md")).toBe(true);
    });

    it("rejects executable code files even if placed inside a doc folder", () => {
      expect(isDocumentationFile("docs/setup.sh")).toBe(false);
      expect(isDocumentationFile("docs/example.ts")).toBe(false);
      expect(isDocumentationFile("openspec/helper.py")).toBe(false);
      expect(isDocumentationFile(".agents/teamwork/script.js")).toBe(false);
    });

    it("returns false for empty or non-string inputs", () => {
      expect(isDocumentationFile("")).toBe(false);
      // @ts-expect-error test invalid types
      expect(isDocumentationFile(undefined)).toBe(false);
    });
  });

  describe("isFastTrackCandidate", () => {
    it("returns false for undefined, null, or empty file lists", () => {
      expect(isFastTrackCandidate(undefined)).toBe(false);
      expect(isFastTrackCandidate([])).toBe(false);
    });

    it("returns true when every file is a documentation file", () => {
      expect(
        isFastTrackCandidate([
          "README.md",
          "docs/architecture.md",
          "openspec/changes/gate0/proposal.md",
          "openspec/changes/gate0/tasks.md",
        ]),
      ).toBe(true);
    });

    it("returns false when any file in the list is source code or configuration", () => {
      expect(
        isFastTrackCandidate([
          "README.md",
          "docs/architecture.md",
          "src/gates/gate0_qa.ts",
        ]),
      ).toBe(false);

      expect(
        isFastTrackCandidate([
          "README.md",
          "package.json",
        ]),
      ).toBe(false);
    });
  });

  describe("evaluateGateExecutionPolicy", () => {
    it("assigns Full-Gate policy when no affected files are provided (safety default)", () => {
      const result = evaluateGateExecutionPolicy();
      expect(result.policy).toBe("full-gate");
      expect(result.isFastTrack).toBe(false);
      expect(result.bypassedGates).toHaveLength(0);
      expect(result.requiredGates).toEqual(["gate0", "gate1", "gate2", "gate3"]);
      expect(result.reason).toContain("No affected files specified; defaulting to Full-Gate");
      expect(result.recommendedSuccessEvent).toBe("EVT_G0_PASS");
    });

    it("grants Fast-Track policy bypass for pure documentation changes in auto mode", () => {
      const files = [
        "docs/overview.md",
        "README.md",
        "openspec/changes/gate0/design.md",
        ".agents/teamwork/notes.txt",
      ];
      const result = evaluateGateExecutionPolicy(files);

      expect(result.policy).toBe("fast-track");
      expect(result.isFastTrack).toBe(true);
      expect(result.bypassedGates).toEqual(["gate1", "gate2"]);
      expect(result.requiredGates).toEqual(["gate0", "gate3"]);
      expect(result.candidateFiles).toEqual(files);
      expect(result.disqualifiedFiles).toHaveLength(0);
      expect(result.reason).toContain("Fast-Track policy bypass granted");
      expect(result.recommendedSuccessEvent).toBe("EVT_G0_PASS_FAST_TRACK");
    });

    it("requires Full-Gate policy when source code files are included", () => {
      const files = ["README.md", "src/gates/gate0_qa.ts", "test/gates/gate0.test.ts"];
      const result = evaluateGateExecutionPolicy({ affectedFiles: files });

      expect(result.policy).toBe("full-gate");
      expect(result.isFastTrack).toBe(false);
      expect(result.bypassedGates).toHaveLength(0);
      expect(result.requiredGates).toEqual(["gate0", "gate1", "gate2", "gate3"]);
      expect(result.disqualifiedFiles).toEqual(["src/gates/gate0_qa.ts", "test/gates/gate0.test.ts"]);
      expect(result.candidateFiles).toEqual(["README.md"]);
      expect(result.reason).toContain("Full-Gate policy required: 2 non-documentation / source files detected");
      expect(result.recommendedSuccessEvent).toBe("EVT_G0_PASS");
    });

    it("respects allowFastTrack: false by enforcing Full-Gate policy even for documentation", () => {
      const result = evaluateGateExecutionPolicy({
        affectedFiles: ["README.md", "docs/index.md"],
        allowFastTrack: false,
      });

      expect(result.policy).toBe("full-gate");
      expect(result.isFastTrack).toBe(false);
      expect(result.bypassedGates).toHaveLength(0);
      expect(result.requiredGates).toEqual(["gate0", "gate1", "gate2", "gate3"]);
      expect(result.reason).toContain("Fast-track policy disabled by configuration");
      expect(result.recommendedSuccessEvent).toBe("EVT_G0_PASS");
    });

    it("honors explicit policy: full-gate override", () => {
      const result = evaluateGateExecutionPolicy({
        affectedFiles: ["docs/manual.md"],
        policy: "full-gate",
      });

      expect(result.policy).toBe("full-gate");
      expect(result.isFastTrack).toBe(false);
      expect(result.reason).toContain("Explicit Full-Gate policy requested");
    });

    it("grants explicit policy: fast-track when files are clean documentation", () => {
      const result = evaluateGateExecutionPolicy({
        affectedFiles: ["docs/manual.md"],
        policy: "fast-track",
      });

      expect(result.policy).toBe("fast-track");
      expect(result.isFastTrack).toBe(true);
      expect(result.bypassedGates).toEqual(["gate1", "gate2"]);
      expect(result.requiredGates).toEqual(["gate0", "gate3"]);
      expect(result.recommendedSuccessEvent).toBe("EVT_G0_PASS_FAST_TRACK");
    });

    it("safety overrides explicit policy: fast-track when source files are detected", () => {
      const result = evaluateGateExecutionPolicy({
        affectedFiles: ["docs/manual.md", "src/core/fsm.ts"],
        policy: "fast-track",
      });

      expect(result.policy).toBe("full-gate");
      expect(result.isFastTrack).toBe(false);
      expect(result.reason).toContain("Explicit fast-track policy rejected: 1 source code or configuration files detected");
      expect(result.disqualifiedFiles).toEqual(["src/core/fsm.ts"]);
    });
  });

  describe("resolveGate0RecommendedEvent", () => {
    it("recommends EVT_G0_PASS_FAST_TRACK on success when Fast-Track is active", () => {
      const evt = resolveGate0RecommendedEvent({
        success: true,
        isFastTrack: true,
      });
      expect(evt).toBe("EVT_G0_PASS_FAST_TRACK");
    });

    it("recommends EVT_G0_PASS on success under Full-Gate policy", () => {
      const evt = resolveGate0RecommendedEvent({
        success: true,
        isFastTrack: false,
      });
      expect(evt).toBe("EVT_G0_PASS");
    });

    it("recommends EVT_G0_RETRY on check failure when retry attempts remain", () => {
      const evt = resolveGate0RecommendedEvent({
        success: false,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(evt).toBe("EVT_G0_RETRY");
    });

    it("recommends EVT_G0_EXHAUSTED when retry attempts reach maxAttempts", () => {
      const evt = resolveGate0RecommendedEvent({
        success: false,
        attempt: 3,
        maxAttempts: 3,
      });
      expect(evt).toBe("EVT_G0_EXHAUSTED");
    });
  });

  describe("detectGitAffectedFiles", () => {
    it("parses staged and unstaged files from git status porcelain output", async () => {
      const mockGitOutput = [
        "M  docs/architecture.md",
        "?? openspec/changes/gate0/tasks.md",
        "R  old_notes.txt -> docs/notes.txt",
        'A  "docs/spaced file.md"',
      ].join("\n");

      const mockRunner: Gate0CommandRunner = async () => ({
        code: 0,
        stdout: mockGitOutput,
        stderr: "",
        output: mockGitOutput,
        durationMs: 5,
        timedOut: false,
      });

      const files = await detectGitAffectedFiles(mockRunner);
      expect(files).toEqual([
        "docs/architecture.md",
        "openspec/changes/gate0/tasks.md",
        "docs/notes.txt",
        "docs/spaced file.md",
      ]);
    });

    it("returns empty array when runner fails or is omitted", async () => {
      expect(await detectGitAffectedFiles()).toEqual([]);

      const failRunner: Gate0CommandRunner = async () => ({
        code: 128,
        stdout: "",
        stderr: "fatal: not a git repository",
        output: "fatal: not a git repository",
        durationMs: 5,
        timedOut: false,
      });

      expect(await detectGitAffectedFiles(failRunner)).toEqual([]);
    });
  });

  describe("Gate0MechanicalRunner Fast-Track Integration", () => {
    it("evaluates fast-track policy and populates Gate0Result telemetry on success", async () => {
      const mockRunner: Gate0CommandRunner = async (cmd) => ({
        code: 0,
        stdout: `Passed: ${cmd}`,
        stderr: "",
        output: `Passed: ${cmd}`,
        durationMs: 5,
        timedOut: false,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        affectedFiles: ["README.md", "docs/specs.md"],
        commands: ["echo 'checking docs'"],
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(true);
      expect(result.fastTrackEligible).toBe(true);
      expect(result.policy).toBe("fast-track");
      expect(result.policyResult).toBeDefined();
      expect(result.policyResult?.isFastTrack).toBe(true);
      expect(result.bypassedGates).toEqual(["gate1", "gate2"]);
      expect(result.recommendedEvent).toBe("EVT_G0_PASS_FAST_TRACK");
    });

    it("evaluates full-gate policy when source code files are affected", async () => {
      const mockRunner: Gate0CommandRunner = async (cmd) => ({
        code: 0,
        stdout: `Passed: ${cmd}`,
        stderr: "",
        output: `Passed: ${cmd}`,
        durationMs: 5,
        timedOut: false,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        affectedFiles: ["src/gates/gate0_qa.ts"],
        commands: ["bun test"],
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(true);
      expect(result.fastTrackEligible).toBe(false);
      expect(result.policy).toBe("full-gate");
      expect(result.bypassedGates).toHaveLength(0);
      expect(result.recommendedEvent).toBe("EVT_G0_PASS");
    });

    it("executes custom fastTrackCommands when fast-track policy is active", async () => {
      const executedCommands: string[] = [];
      const mockRunner: Gate0CommandRunner = async (cmd) => {
        executedCommands.push(cmd);
        return {
          code: 0,
          stdout: "ok",
          stderr: "",
          output: "ok",
          durationMs: 5,
          timedOut: false,
        };
      };

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        affectedFiles: ["docs/guide.md"],
        fastTrackCommands: ["markdownlint docs/guide.md"],
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(true);
      expect(result.policy).toBe("fast-track");
      expect(executedCommands).toEqual(["markdownlint docs/guide.md"]);
      expect(result.checks[0]?.command).toBe("markdownlint docs/guide.md");
    });

    it("recommends EVT_G0_RETRY when a fast-track check fails on attempt 1 of 3", async () => {
      const mockRunner: Gate0CommandRunner = async () => ({
        code: 1,
        stdout: "",
        stderr: "markdown syntax error on line 42",
        output: "markdown syntax error on line 42",
        durationMs: 10,
        timedOut: false,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        affectedFiles: ["docs/guide.md"],
        commands: ["markdownlint docs/guide.md"],
        attempt: 1,
        maxAttempts: 3,
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      expect(result.policy).toBe("fast-track");
      expect(result.recommendedEvent).toBe("EVT_G0_RETRY");
    });

    it("recommends EVT_G0_EXHAUSTED when attempt reaches maxAttempts on failure", async () => {
      const mockRunner: Gate0CommandRunner = async () => ({
        code: 1,
        stdout: "",
        stderr: "fatal doc failure",
        output: "fatal doc failure",
        durationMs: 10,
        timedOut: false,
      });

      const runner = new Gate0MechanicalRunner({
        enableLayoutCheck: false,
        affectedFiles: ["docs/guide.md"],
        commands: ["markdownlint docs/guide.md"],
        attempt: 3,
        maxAttempts: 3,
        runner: mockRunner,
      });

      const result = await runner.run();
      expect(result.success).toBe(false);
      expect(result.policy).toBe("fast-track");
      expect(result.recommendedEvent).toBe("EVT_G0_EXHAUSTED");
    });
  });
});
