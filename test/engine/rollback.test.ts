/**
 * Unit Test Suite for Atomic Git Rollback Buffer & Audit Preservation.
 *
 * Validates `RollbackStateBuffer`, `rollbackWorkingTree`, `captureGitState`,
 * `buildGitCleanCommand`, atomic snapshot/rollback/commit triad, memory protection
 * invariants (`.agents/teamwork/` and `projects/`), and forensic audit log preservation
 * in accordance with OpenSpec change `looper-gate3-forensic-audit` Task 1.3 and
 * `projects/agnostic_looper/SPECIFICATION.md` Section 5.2 & Section 6.3 (LOOPER-GATE-005).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROLLBACK_CONSTANTS,
  RollbackStateBuffer,
  buildGitCleanCommand,
  captureGitState,
  rollbackWorkingTree,
  defaultCommandRunner,
  type CommandRunner,
  type CommitOptions,
  type RollbackAuditEntry,
  type RollbackBufferOptions,
  type RollbackOptions,
} from "../../src/engine/rollback_buffer";
import { Gate3Auditor, GATE3_CONSTANTS } from "../../src/gates/gate3_audit";

const TEST_CONSTANTS = {
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  EXIT_SUCCESS: 0,
  EXIT_ERROR: 1,
} as const;

describe("Atomic Git Rollback Buffer & Audit Preservation (Task 1.3)", () => {
  let tempDir: string;
  let teamworkDir: string;
  let projectsDir: string;
  let logsDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `rollback-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    teamworkDir = join(tempDir, ".agents", "teamwork");
    projectsDir = join(tempDir, "projects");
    logsDir = join(tempDir, "logs");

    await mkdir(teamworkDir, { recursive: true });
    await mkdir(projectsDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("ROLLBACK_CONSTANTS & Invariant Definitions", () => {
    it("exposes canonical git command primitives and protected paths", () => {
      expect(ROLLBACK_CONSTANTS.GIT_RESET_CMD).toBe("git reset --hard");
      expect(ROLLBACK_CONSTANTS.GIT_CLEAN_CMD).toBe("git clean -fd");
      expect(ROLLBACK_CONSTANTS.GIT_REV_PARSE_HEAD).toBe("git rev-parse HEAD");
      expect(ROLLBACK_CONSTANTS.GIT_STATUS_PORCELAIN).toBe("git status --porcelain");
      expect(ROLLBACK_CONSTANTS.PROTECTED_TEAMWORK_DIR).toBe(".agents/teamwork/");
      expect(ROLLBACK_CONSTANTS.PROTECTED_PROJECTS_DIR).toBe("projects/");
      expect(ROLLBACK_CONSTANTS.PROTECTED_LOGS_DIR).toBe("logs/");
    });

    it("includes protected memory and deliverables in default excludes", () => {
      expect(ROLLBACK_CONSTANTS.DEFAULT_EXCLUDES).toContain(".agents/teamwork/");
      expect(ROLLBACK_CONSTANTS.DEFAULT_EXCLUDES).toContain("projects/");
      expect(ROLLBACK_CONSTANTS.DEFAULT_EXCLUDES).toContain("logs/");
      expect(ROLLBACK_CONSTANTS.DEFAULT_EXCLUDES).toContain(".atl");
      expect(ROLLBACK_CONSTANTS.DEFAULT_EXCLUDES).toContain(".claude/settings.local.json");
    });
  });

  describe("buildGitCleanCommand", () => {
    it("returns base command when no excludes provided", () => {
      expect(buildGitCleanCommand()).toBe("git clean -fd");
      expect(buildGitCleanCommand([])).toBe("git clean -fd");
    });

    it("formats exclude flags with quotes for every pattern", () => {
      const cmd = buildGitCleanCommand([".agents/teamwork/", "projects/", "logs/"]);
      expect(cmd).toBe('git clean -fd -e ".agents/teamwork/" -e "projects/" -e "logs/"');
    });

    it("filters out empty or whitespace-only patterns", () => {
      const cmd = buildGitCleanCommand(["", "  ", ".env"]);
      expect(cmd).toBe('git clean -fd -e ".env"');
    });
  });

  describe("captureGitState", () => {
    it("captures clean state with HEAD commit SHA", async () => {
      const mockRunner: CommandRunner = async (cmd) => {
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "commit-sha-abc", stderr: "", output: "commit-sha-abc" };
        }
        return { code: 0, stdout: "", stderr: "", output: "" };
      };

      const state = await captureGitState({ cwd: tempDir, runner: mockRunner });
      expect(state.headSha).toBe("commit-sha-abc");
      expect(state.isDirty).toBe(false);
      expect(state.untrackedFiles).toEqual([]);
      expect(state.modifiedFiles).toEqual([]);
    });

    it("identifies untracked and modified files accurately", async () => {
      const mockRunner: CommandRunner = async (cmd) => {
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "commit-sha-123", stderr: "", output: "commit-sha-123" };
        }
        if (cmd.includes("status --porcelain")) {
          const porcelain = [
            " M src/gates/gate3_audit.ts",
            "A  src/engine/rollback_buffer.ts",
            "?? test/engine/rollback.test.ts",
            "?? logs/audit.jsonl",
          ].join("\n");
          return { code: 0, stdout: porcelain, stderr: "", output: porcelain };
        }
        return { code: 0, stdout: "", stderr: "", output: "" };
      };

      const state = await captureGitState({ cwd: tempDir, runner: mockRunner });
      expect(state.headSha).toBe("commit-sha-123");
      expect(state.isDirty).toBe(true);
      expect(state.modifiedFiles).toEqual([
        "src/gates/gate3_audit.ts",
        "src/engine/rollback_buffer.ts",
      ]);
      expect(state.untrackedFiles).toEqual([
        "test/engine/rollback.test.ts",
        "logs/audit.jsonl",
      ]);
    });
  });

  describe("rollbackWorkingTree", () => {
    it("executes git reset and git clean with default HEAD ref and protected excludes", async () => {
      const executed: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executed.push(cmd);
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const result = await rollbackWorkingTree({
        cwd: tempDir,
        runner: mockRunner,
        cleanUntracked: true,
      });

      expect(result.success).toBe(true);
      expect(result.targetRef).toBe("HEAD");
      expect(executed[0]).toBe("git reset --hard HEAD");
      // Must include memory protection and deliverables
      expect(executed[1]).toContain('-e ".agents/teamwork/"');
      expect(executed[1]).toContain('-e "projects/"');
      expect(executed[1]).toContain('-e "logs/"');
    });

    it("aborts git clean if git reset fails", async () => {
      const executed: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executed.push(cmd);
        if (cmd.startsWith("git reset")) {
          return { code: 1, stdout: "", stderr: "reset failed", output: "reset failed" };
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const result = await rollbackWorkingTree({
        cwd: tempDir,
        runner: mockRunner,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("git reset failed");
      expect(executed.length).toBe(1);
    });

    it("preserves registered audit files across hard rollback", async () => {
      const auditFile = join(tempDir, "audit_preserved.json");
      await writeFile(auditFile, JSON.stringify({ verified: true }));

      const executed: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executed.push(cmd);
        // Simulate git reset wiping or modifying untracked files
        if (cmd.startsWith("git reset")) {
          await writeFile(auditFile, "wiped-content");
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const result = await rollbackWorkingTree({
        cwd: tempDir,
        runner: mockRunner,
        cleanUntracked: true,
        preserveAuditLogs: true,
        auditLogPaths: [auditFile],
      });

      expect(result.success).toBe(true);
      expect(result.preservedLogsCount).toBe(1);

      // Verify that original content was restored post-reset
      const content = await readFile(auditFile, "utf-8");
      expect(JSON.parse(content)).toEqual({ verified: true });
    });
  });

  describe("RollbackStateBuffer: Snapshot, Dirty Check & Rollback", () => {
    it("captures baseline snapshot and tracks state accurately", async () => {
      const mockRunner: CommandRunner = async (cmd) => {
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "sha-baseline-888", stderr: "", output: "sha-baseline-888" };
        }
        return { code: 0, stdout: "", stderr: "", output: "" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      expect(buffer.getBaselineSha()).toBeNull();
      expect(buffer.getSnapshotTimestamp()).toBeNull();
      expect(buffer.getRollbackCount()).toBe(TEST_CONSTANTS.ZERO);

      const baselineSha = await buffer.snapshot();
      expect(baselineSha).toBe("sha-baseline-888");
      expect(buffer.getBaselineSha()).toBe("sha-baseline-888");
      expect(buffer.getSnapshotTimestamp()).toBeGreaterThan(TEST_CONSTANTS.ZERO);

      const history = buffer.getAuditHistory();
      expect(history.length).toBe(TEST_CONSTANTS.ONE);
      const firstEntry = history[0];
      expect(firstEntry).toBeDefined();
      expect(firstEntry?.action).toBe(ROLLBACK_CONSTANTS.AUDIT_ACTION_SNAPSHOT);
      expect(firstEntry?.baselineSha).toBe("sha-baseline-888");
    });

    it("isDirty respects protected excludes (.agents/teamwork/, projects/, logs/)", async () => {
      const mockRunner: CommandRunner = async (cmd) => {
        if (cmd.includes("status --porcelain")) {
          const porcelain = [
            "?? .agents/teamwork/BRIEFING.md",
            "?? projects/agnostic_looper/SPECIFICATION.md",
            "?? logs/session.jsonl",
            "?? dirty_src.ts",
          ].join("\n");
          return { code: 0, stdout: porcelain, stderr: "", output: porcelain };
        }
        return { code: 0, stdout: "", stderr: "", output: "" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      // Initially dirty due to dirty_src.ts
      expect(await buffer.isDirty()).toBe(true);

      // Now add dirty_src.ts to excludes
      const cleanBuffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
        excludes: ["dirty_src.ts"],
      });
      // All other files are protected memory/projects/logs, so isDirty returns false
      expect(await cleanBuffer.isDirty()).toBe(false);
    });

    it("executes atomic rollback to baseline SHA and increments rollbackCount", async () => {
      const executed: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executed.push(cmd);
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "baseline-sha-777", stderr: "", output: "baseline-sha-777" };
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      await buffer.snapshot();
      expect(buffer.getRollbackCount()).toBe(TEST_CONSTANTS.ZERO);

      const result = await buffer.rollback();
      expect(result.success).toBe(true);
      expect(result.targetRef).toBe("baseline-sha-777");
      expect(buffer.getRollbackCount()).toBe(TEST_CONSTANTS.ONE);

      expect(executed).toContain("git reset --hard baseline-sha-777");
      const cleanCall = executed.find((c) => c.startsWith("git clean -fd"));
      expect(cleanCall).toBeDefined();
      expect(cleanCall).toContain('-e ".agents/teamwork/"');
      expect(cleanCall).toContain('-e "projects/"');

      // Rollback with custom override ref
      await buffer.rollback("custom-ref-999");
      expect(buffer.getRollbackCount()).toBe(TEST_CONSTANTS.TWO);
      expect(executed).toContain("git reset --hard custom-ref-999");
    });
  });

  describe("Audit Log Preservation Across Hard Rollback", () => {
    it("registers audit files and preserves them through in-memory restore", async () => {
      const auditLogPath = join(tempDir, "logs", "forensic_audit_report.md");
      const auditLogContent = "# Forensic Audit Report\nStatus: VETOED\nReason: Dummy stub";

      const executed: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executed.push(cmd);
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "base-sha", stderr: "", output: "base-sha" };
        }
        if (cmd.startsWith("git reset")) {
          // Simulate git reset wiping working tree files
          await writeFile(auditLogPath, "wiped by git reset");
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });
      await buffer.snapshot();

      // Register audit log with explicit content
      buffer.registerAuditLog(auditLogPath, auditLogContent);
      expect(buffer.getRegisteredAuditLogs()).toContain(auditLogPath);

      // Execute rollback
      const res = await buffer.rollback(undefined, { reason: "Invariant breach: stub found" });
      expect(res.success).toBe(true);

      // Assert audit log was restored with original content
      const restored = await readFile(auditLogPath, "utf-8");
      expect(restored).toBe(auditLogContent);

      // Verify audit trail entry
      const history = buffer.getAuditHistory();
      const rollbackEntry = history.find((e) => e.action === ROLLBACK_CONSTANTS.AUDIT_ACTION_ROLLBACK);
      expect(rollbackEntry).toBeDefined();
      expect(rollbackEntry?.reason).toBe("Invariant breach: stub found");
    });

    it("flushes recorded audit trail to disk in JSONL format", async () => {
      const mockRunner: CommandRunner = async (cmd) => {
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "base-sha-123", stderr: "", output: "base-sha-123" };
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      await buffer.snapshot();
      await buffer.rollback(undefined, { reason: "Test rollback" });

      const auditFile = join(tempDir, "logs", "custom_audit.jsonl");
      const flushedPath = await buffer.flushAuditLogs(auditFile);
      expect(flushedPath).toBe(auditFile);

      const content = await readFile(auditFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(TEST_CONSTANTS.TWO);

      const line0 = lines[0];
      const line1 = lines[1];
      expect(line0).toBeDefined();
      expect(line1).toBeDefined();

      const parsedFirst = JSON.parse(line0 ?? "{}") as RollbackAuditEntry;
      expect(parsedFirst.action).toBe(ROLLBACK_CONSTANTS.AUDIT_ACTION_SNAPSHOT);
      const parsedSecond = JSON.parse(line1 ?? "{}") as RollbackAuditEntry;
      expect(parsedSecond.action).toBe(ROLLBACK_CONSTANTS.AUDIT_ACTION_ROLLBACK);
    });
  });

  describe("RollbackStateBuffer: Atomic Conventional Commit", () => {
    it("executes certified git commit, updates baseline SHA, and increments commitCount", async () => {
      const executed: string[] = [];
      let headSha = "sha-before-commit";

      const mockRunner: CommandRunner = async (cmd) => {
        executed.push(cmd);
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: headSha, stderr: "", output: headSha };
        }
        if (cmd.startsWith("git commit")) {
          headSha = "sha-after-commit-999";
          return { code: 0, stdout: "[main 1234567] feat: task complete", stderr: "", output: "commit OK" };
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      await buffer.snapshot();
      expect(buffer.getBaselineSha()).toBe("sha-before-commit");
      expect(buffer.getCommitCount()).toBe(TEST_CONSTANTS.ZERO);

      const commitResult = await buffer.commit("feat(gates): implement atomic rollback buffer");
      expect(commitResult.success).toBe(true);
      expect(commitResult.commitSha).toBe("sha-after-commit-999");
      expect(buffer.getBaselineSha()).toBe("sha-after-commit-999");
      expect(buffer.getCommitCount()).toBe(TEST_CONSTANTS.ONE);

      expect(executed).toContain("git add -A");
      const commitCall = executed.find((c) => c.startsWith("git commit -m"));
      expect(commitCall).toBeDefined();
      expect(commitCall).toContain("feat(gates): implement atomic rollback buffer");

      const history = buffer.getAuditHistory();
      const commitEntry = history.find((e) => e.action === ROLLBACK_CONSTANTS.AUDIT_ACTION_COMMIT);
      expect(commitEntry).toBeDefined();
      expect(commitEntry?.newSha).toBe("sha-after-commit-999");
    });

    it("supports selective file staging during certified commit", async () => {
      const executed: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executed.push(cmd);
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "new-sha", stderr: "", output: "new-sha" };
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const buffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });

      await buffer.commit("fix: selective commit", {
        files: ["src/engine/rollback_buffer.ts", "test/engine/rollback.test.ts"],
      });

      const addCall = executed.find((c) => c.startsWith("git add"));
      expect(addCall).toBe('git add "src/engine/rollback_buffer.ts" "test/engine/rollback.test.ts"');
    });

    it("returns failure when commit message is empty", async () => {
      const buffer = new RollbackStateBuffer({ cwd: tempDir });
      const result = await buffer.commit("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot create commit with empty message");
    });
  });

  describe("Integration: Gate3Auditor & RollbackStateBuffer on Binary Veto", () => {
    it("triggers atomic git rollback on binary veto while preserving audit artifacts", async () => {
      // Place forbidden source file in .agents/teamwork/ to trigger layout veto
      await writeFile(join(teamworkDir, "leaked_agent_worker.ts"), "export const x = 1;");

      const executedCommands: string[] = [];
      const mockRunner: CommandRunner = async (cmd) => {
        executedCommands.push(cmd);
        if (cmd.includes("rev-parse")) {
          return { code: 0, stdout: "baseline-sha-gate3", stderr: "", output: "baseline-sha-gate3" };
        }
        return { code: 0, stdout: "OK", stderr: "", output: "OK" };
      };

      const rollbackBuffer = new RollbackStateBuffer({
        cwd: tempDir,
        runner: mockRunner,
      });
      await rollbackBuffer.snapshot();

      const auditor = new Gate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        baselineSha: "baseline-sha-gate3",
        autoRollbackOnVeto: true,
        skipCleanRoomQa: true,
        rollbackBuffer,
      });

      let rollbackTriggeredEvent = false;
      auditor.on(GATE3_CONSTANTS.EVENT_ROLLBACK_TRIGGERED, () => {
        rollbackTriggeredEvent = true;
      });

      const result = await auditor.run();
      expect(result.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(result.veto).toBe(true);
      expect(result.rollbackExecuted).toBe(true);
      expect(rollbackTriggeredEvent).toBe(true);

      // Verify that git reset was executed targeting baseline SHA
      expect(executedCommands).toContain("git reset --hard baseline-sha-gate3");
      const cleanCmd = executedCommands.find((c) => c.startsWith("git clean -fd"));
      expect(cleanCmd).toBeDefined();
      expect(cleanCmd).toContain('-e ".agents/teamwork/"');
      expect(cleanCmd).toContain('-e "projects/"');

      // Verify audit history recorded the veto rollback
      const history = rollbackBuffer.getAuditHistory();
      const vetoRollback = history.find((e) => e.action === ROLLBACK_CONSTANTS.AUDIT_ACTION_ROLLBACK);
      expect(vetoRollback).toBeDefined();
      expect(vetoRollback?.targetRef).toBe("baseline-sha-gate3");
    });
  });
});
