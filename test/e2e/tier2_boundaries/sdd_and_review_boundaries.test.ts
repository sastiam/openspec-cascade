import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeChangeArtifacts } from "../../../src/sdd/analyze";
import { verifyReviewFindings } from "../../../src/sdd/review_verifier";
import { evaluateSddGate } from "../../../src/sdd/sdd_gate";
import { runNodeScript, runOpenSpecCli } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import { addOpenSpecChange, createTempGitRepo } from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

describe("Tier 2 Boundaries: SDD Gate Hook, Analyze Gate, Review Verifier & Strict OpenSpec", () => {
  test(
    "sdd_gate.mjs blocks production source edits (exit 2) without an active change and allows exempt paths",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);
      mkdirSync(join(fixture.repoDir, "openspec"), { recursive: true });

      const blocked = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: JSON.stringify({
          tool_name: "Edit",
          tool_input: { file_path: join(fixture.repoDir, "src", "service.ts") },
          cwd: fixture.repoDir,
        }),
      });
      expect(blocked.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(blocked.stderr).toContain("SDD Gate Block");

      const exemptTest = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: join(fixture.repoDir, "test", "service.test.ts") },
          cwd: fixture.repoDir,
        }),
      });
      expect(exemptTest.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

      const exemptDocs = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: join(fixture.repoDir, "docs", "guide.md") },
          cwd: fixture.repoDir,
        }),
      });
      expect(exemptDocs.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test(
    "sdd_gate.mjs bypasses on CASCADE_SDD_GATE_DISABLED=1 and ignores non-gated tools or malformed stdin",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);

      const bypassed = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        env: { CASCADE_SDD_GATE_DISABLED: "1" },
        stdin: JSON.stringify({
          tool_name: "Edit",
          tool_input: { file_path: join(fixture.repoDir, "src", "service.ts") },
          cwd: fixture.repoDir,
        }),
      });
      expect(bypassed.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

      const readTool = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: JSON.stringify({
          tool_name: "Read",
          tool_input: { file_path: join(fixture.repoDir, "src", "service.ts") },
          cwd: fixture.repoDir,
        }),
      });
      expect(readTool.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

      const malformed = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: "{not-json",
      });
      expect(malformed.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

      const emptyStdin = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: "",
      });
      expect(emptyStdin.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test("evaluateSddGate blocks when tasks.md exists but all tasks are checked off", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    addOpenSpecChange(fixture.repoDir, "completed-only", {
      tasksMarkdown: "## 1. Done\n\n- [x] 1.1 Already finished\n",
    });

    const result = await evaluateSddGate({
      toolName: "MultiEdit",
      filePath: join(fixture.repoDir, "src", "index.ts"),
      repoRoot: fixture.repoDir,
    });

    expect(result.allowed).toBe(false);
    expect(result.activeChangeId).toBeNull();
  });

  test("analyzeChangeArtifacts catches missing artifacts, empty tasks, and uncovered requirements", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    addOpenSpecChange(fixture.repoDir, "missing-design", {
      includeDesign: false,
      includeConstitution: true,
    });
    const missingDesignRes = await analyzeChangeArtifacts("missing-design", fixture.repoDir);
    expect(missingDesignRes.passed).toBe(false);
    expect(missingDesignRes.confirmedBlocking).toBeGreaterThanOrEqual(1);

    addOpenSpecChange(fixture.repoDir, "uncovered-req", {
      includeConstitution: true,
      tasksMarkdown: "## 1. Misc\n\n- [ ] 1.1 Update unrelated documentation\n",
      specMarkdown: [
        "## ADDED Requirements",
        "",
        "### Requirement: Cryptographic token verification",
        "The system SHALL validate HMAC signatures before accepting tokens.",
        "",
        "#### Scenario: Invalid token rejected",
        "- **WHEN** a malformed token arrives",
        "- **THEN** the request fails",
        "",
      ].join("\n"),
    });
    const uncoveredRes = await analyzeChangeArtifacts("uncovered-req", fixture.repoDir);
    expect(uncoveredRes.passed).toBe(false);
    expect(uncoveredRes.findings.some((f) => f.type === "coverage" && f.blocking)).toBe(true);

    addOpenSpecChange(fixture.repoDir, "empty-tasks", {
      includeConstitution: true,
      tasksMarkdown: "## 1. Empty\n\nNo checkboxes defined.\n",
    });
    const emptyTasksRes = await analyzeChangeArtifacts("empty-tasks", fixture.repoDir);
    expect(emptyTasksRes.passed).toBe(false);
    expect(emptyTasksRes.findings.some((f) => f.type === "orphan" && f.blocking)).toBe(true);
  });

  test("verifyReviewFindings enforces stale cache guard (<10s), empty diff, and disjoint mismatch", () => {
    const stale = verifyReviewFindings({
      reviewFiles: ["src/a.ts"],
      branchDiffFiles: ["src/a.ts"],
      elapsedSeconds: E2E_CONSTANTS.STALE_REVIEW_ELAPSED_SECONDS,
      findings: [],
    });
    expect(stale.valid).toBe(false);
    expect(stale.status).toBe("stale");

    const empty = verifyReviewFindings({
      reviewFiles: ["src/a.ts"],
      branchDiffFiles: [],
      elapsedSeconds: E2E_CONSTANTS.DEFAULT_REVIEW_ELAPSED_SECONDS,
      findings: [],
    });
    expect(empty.valid).toBe(true);
    expect(empty.status).toBe("empty");

    const mismatch = verifyReviewFindings({
      reviewFiles: ["src/unrelated.ts"],
      branchDiffFiles: ["src/actual.ts"],
      elapsedSeconds: E2E_CONSTANTS.DEFAULT_REVIEW_ELAPSED_SECONDS,
      findings: [],
    });
    expect(mismatch.valid).toBe(false);
    expect(mismatch.status).toBe("mismatch");
  });

  test(
    "openspec validate --strict fails on invalid spec lacking normative SHALL/MUST or Scenario",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);

      const changeDir = addOpenSpecChange(fixture.repoDir, "bad-spec-change", {
        includeSpec: false,
      });
      const specDir = join(changeDir, "specs", "broken");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "## ADDED Requirements\n\n### Requirement: Weak spec\nMissing normative keyword and scenario.\n",
        "utf8",
      );

      const res = await runOpenSpecCli(fixture.repoDir, [
        "validate",
        "bad-spec-change",
        "--strict",
      ]);
      expect(res.exitCode).not.toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );
});
