import { describe, expect, test } from "bun:test";
import { CONSTANTS } from "./config";
import {
  buildGitCleanCommand,
  captureGitState,
  Fatal,
  rollbackWorkingTree,
  RollbackStateBuffer,
  TaskFailureError,
  type CommandRunner,
} from "./resilience";

describe("buildGitCleanCommand", () => {
  test("returns base git clean command when no excludes provided", () => {
    expect(buildGitCleanCommand()).toBe("git clean -fd");
    expect(buildGitCleanCommand([])).toBe("git clean -fd");
  });

  test("appends exclude flags correctly for single pattern", () => {
    expect(buildGitCleanCommand([".env"])).toBe('git clean -fd -e ".env"');
  });

  test("appends multiple exclude flags formatted properly", () => {
    expect(buildGitCleanCommand([".env", "*.local", "node_modules/"])).toBe(
      'git clean -fd -e ".env" -e "*.local" -e "node_modules/"',
    );
  });

  test("filters out empty or whitespace-only patterns", () => {
    expect(buildGitCleanCommand(["", "  ", ".env"])).toBe('git clean -fd -e ".env"');
  });
});

describe("captureGitState", () => {
  test("captures clean git state with commit SHA", async () => {
    const mockRunner: CommandRunner = async (cmd) => {
      if (cmd.includes("rev-parse")) {
        return { code: 0, stdout: "abc1234", stderr: "", output: "abc1234" };
      }
      return { code: 0, stdout: "", stderr: "", output: "" };
    };

    const state = await captureGitState({ runner: mockRunner });
    expect(state.headSha).toBe("abc1234");
    expect(state.isDirty).toBe(false);
    expect(state.untrackedFiles).toEqual([]);
    expect(state.modifiedFiles).toEqual([]);
  });

  test("identifies untracked and modified files accurately", async () => {
    const mockRunner: CommandRunner = async (cmd) => {
      if (cmd.includes("rev-parse")) {
        return { code: 0, stdout: "deadbeef", stderr: "", output: "deadbeef" };
      }
      if (cmd.includes("status --porcelain")) {
        const porcelain = [
          " M src/index.ts",
          "A  src/new-feature.ts",
          "?? temp/artifact.tmp",
          "?? scratch.js",
        ].join("\n");
        return { code: 0, stdout: porcelain, stderr: "", output: porcelain };
      }
      return { code: 0, stdout: "", stderr: "", output: "" };
    };

    const state = await captureGitState({ runner: mockRunner });
    expect(state.headSha).toBe("deadbeef");
    expect(state.isDirty).toBe(true);
    expect(state.modifiedFiles).toEqual(["src/index.ts", "src/new-feature.ts"]);
    expect(state.untrackedFiles).toEqual(["temp/artifact.tmp", "scratch.js"]);
  });

  test("falls back to HEAD ref when rev-parse command fails", async () => {
    const mockRunner: CommandRunner = async () => ({
      code: 1,
      stdout: "",
      stderr: "fatal: not a git repository",
      output: "fatal: not a git repository",
    });

    const state = await captureGitState({ runner: mockRunner });
    expect(state.headSha).toBe(CONSTANTS.GIT_HEAD_REF);
    expect(state.isDirty).toBe(false);
  });
});

describe("rollbackWorkingTree", () => {
  test("executes git reset and clean with default HEAD ref", async () => {
    const executed: string[] = [];
    const mockRunner: CommandRunner = async (cmd) => {
      executed.push(cmd);
      return { code: 0, stdout: "OK", stderr: "", output: "OK" };
    };

    const result = await rollbackWorkingTree({
      runner: mockRunner,
      cleanUntracked: true,
      excludes: [".env"],
    });

    expect(result.success).toBe(true);
    expect(result.targetRef).toBe("HEAD");
    expect(executed).toEqual([
      "git reset --hard HEAD",
      'git clean -fd -e ".env"',
    ]);
  });

  test("uses specified targetRef for rollback", async () => {
    const executed: string[] = [];
    const mockRunner: CommandRunner = async (cmd) => {
      executed.push(cmd);
      return { code: 0, stdout: "OK", stderr: "", output: "OK" };
    };

    const result = await rollbackWorkingTree({
      targetRef: "commit-sha-1234",
      runner: mockRunner,
      cleanUntracked: false,
    });

    expect(result.success).toBe(true);
    expect(result.targetRef).toBe("commit-sha-1234");
    expect(executed).toEqual(["git reset --hard commit-sha-1234"]);
  });

  test("returns failure and aborts if git reset fails", async () => {
    const executed: string[] = [];
    const mockRunner: CommandRunner = async (cmd) => {
      executed.push(cmd);
      if (cmd.startsWith("git reset")) {
        return { code: 1, stdout: "", stderr: "reset error", output: "reset error" };
      }
      return { code: 0, stdout: "OK", stderr: "", output: "OK" };
    };

    const result = await rollbackWorkingTree({ runner: mockRunner });
    expect(result.success).toBe(false);
    expect(result.error).toContain("git reset failed");
    expect(executed.length).toBe(1); // clean should not run if reset failed
  });

  test("returns failure if git clean fails", async () => {
    const executed: string[] = [];
    const mockRunner: CommandRunner = async (cmd) => {
      executed.push(cmd);
      if (cmd.startsWith("git clean")) {
        return { code: 1, stdout: "", stderr: "permission denied", output: "permission denied" };
      }
      return { code: 0, stdout: "OK", stderr: "", output: "OK" };
    };

    const result = await rollbackWorkingTree({ runner: mockRunner });
    expect(result.success).toBe(false);
    expect(result.error).toContain("git clean failed");
    expect(executed.length).toBe(2);
  });

  test("invokes hooks during rollback lifecycle", async () => {
    const said: string[] = [];
    const logged: Array<{ event: string; data: Record<string, unknown> }> = [];

    const mockRunner: CommandRunner = async () => ({
      code: 0,
      stdout: "OK",
      stderr: "",
      output: "OK",
    });

    const result = await rollbackWorkingTree({
      runner: mockRunner,
      hooks: {
        say: (msg) => said.push(msg),
        log: (evt, data) => logged.push({ event: evt, data }),
      },
    });

    expect(result.success).toBe(true);
    expect(said.some((s) => s.includes("resetting working tree"))).toBe(true);
    expect(said.some((s) => s.includes("cleanly restored"))).toBe(true);
    expect(logged.some((l) => l.event === "rollback_start")).toBe(true);
    expect(logged.some((l) => l.event === "rollback_success")).toBe(true);
  });
});

describe("RollbackStateBuffer", () => {
  test("records snapshot baseline and provides baseline getters", async () => {
    const mockRunner: CommandRunner = async (cmd) => {
      if (cmd.includes("rev-parse")) {
        return { code: 0, stdout: "baseline-sha-999", stderr: "", output: "baseline-sha-999" };
      }
      return { code: 0, stdout: "", stderr: "", output: "" };
    };

    const buffer = new RollbackStateBuffer({ runner: mockRunner });
    expect(buffer.getBaselineSha()).toBeNull();
    expect(buffer.getSnapshotTimestamp()).toBeNull();
    expect(buffer.getRollbackCount()).toBe(0);

    const sha = await buffer.snapshot();
    expect(sha).toBe("baseline-sha-999");
    expect(buffer.getBaselineSha()).toBe("baseline-sha-999");
    expect(buffer.getSnapshotTimestamp()).toBeGreaterThan(0);
  });

  test("isDirty detects dirty state while honoring excludes", async () => {
    const mockRunner: CommandRunner = async (cmd) => {
      if (cmd.includes("status --porcelain")) {
        const porcelain = ["?? .env", "?? .env.local", "?? dirty-file.ts"].join("\n");
        return { code: 0, stdout: porcelain, stderr: "", output: porcelain };
      }
      return { code: 0, stdout: "", stderr: "", output: "" };
    };

    const buffer = new RollbackStateBuffer({
      runner: mockRunner,
      excludes: [".env", ".env.local"],
    });

    expect(await buffer.isDirty()).toBe(true);

    // If excludes include dirty-file.ts as well:
    const cleanBuffer = new RollbackStateBuffer({
      runner: mockRunner,
      excludes: [".env", ".env.local", "dirty-file.ts"],
    });
    expect(await cleanBuffer.isDirty()).toBe(false);
  });

  test("rollback restores to baseline SHA and tracks rollback count", async () => {
    const executed: string[] = [];
    const mockRunner: CommandRunner = async (cmd) => {
      executed.push(cmd);
      if (cmd.includes("rev-parse")) {
        return { code: 0, stdout: "snapshot-sha-555", stderr: "", output: "snapshot-sha-555" };
      }
      return { code: 0, stdout: "OK", stderr: "", output: "OK" };
    };

    const buffer = new RollbackStateBuffer({ runner: mockRunner });
    await buffer.snapshot();
    expect(buffer.getRollbackCount()).toBe(0);

    const result = await buffer.rollback();
    expect(result.success).toBe(true);
    expect(result.targetRef).toBe("snapshot-sha-555");
    expect(buffer.getRollbackCount()).toBe(1);
    expect(executed).toContain("git reset --hard snapshot-sha-555");

    await buffer.rollback("override-ref-777");
    expect(buffer.getRollbackCount()).toBe(2);
    expect(executed).toContain("git reset --hard override-ref-777");
  });
});

describe("TaskFailureError", () => {
  test("creates error with full message including log path", () => {
    const err = new TaskFailureError("1.3", "qa-stage", 3, "logs/2026.jsonl");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(Fatal);
    expect(err.name).toBe("TaskFailureError");
    expect(err.taskId).toBe("1.3");
    expect(err.change).toBe("qa-stage");
    expect(err.attempts).toBe(3);
    expect(err.logPath).toBe("logs/2026.jsonl");
    expect(err.message).toBe("Task 1.3 of qa-stage failed after 3 attempts; see logs/2026.jsonl");
  });

  test("creates error message without log path when omitted", () => {
    const err = new TaskFailureError("2.1", "feature-x", 3);
    expect(err.message).toBe("Task 2.1 of feature-x failed after 3 attempts");
  });
});
