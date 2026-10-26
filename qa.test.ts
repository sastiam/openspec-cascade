import { describe, expect, test } from "bun:test";
import { CONSTANTS, QA_VERIFY_COMMANDS } from "./config";
import {
  defaultCommandRunner,
  formatVerificationFeedback,
  runVerificationPhase,
  type CommandRunnerResult,
  type VerificationFailure,
} from "./qa";

describe("defaultCommandRunner", () => {
  test("executes a successful shell command and returns output with exit code 0", async () => {
    const result = await defaultCommandRunner("echo 'qa-success'", process.cwd());
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("qa-success");
    expect(result.stderr).toBe("");
    expect(result.output).toBe("qa-success");
  });

  test("executes a failing shell command and captures exit code and stderr", async () => {
    const result = await defaultCommandRunner("sh -c 'echo failure-trace >&2; exit 42'", process.cwd());
    expect(result.code).toBe(42);
    expect(result.stderr).toBe("failure-trace");
    expect(result.output).toContain("failure-trace");
  });

  test("separates stdout and stderr accurately", async () => {
    const result = await defaultCommandRunner("sh -c 'echo out-line; echo err-line >&2; exit 1'", process.cwd());
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("out-line");
    expect(result.stderr).toBe("err-line");
    expect(result.output).toContain("out-line");
    expect(result.output).toContain("err-line");
  });
});

describe("formatVerificationFeedback", () => {
  test("returns empty string when failures array is empty", () => {
    expect(formatVerificationFeedback([])).toBe("");
  });

  test("formats single failure into structured XML feedback block", () => {
    const failures: VerificationFailure[] = [
      {
        command: "bun test",
        exitCode: 1,
        stdout: "bun test v1.4.4\n1 fail",
        stderr: "Error: expected 1 to be 2\n    at test.ts:12:3",
        output: "bun test v1.4.4\n1 fail\nError: expected 1 to be 2\n    at test.ts:12:3",
      },
    ];

    const feedback = formatVerificationFeedback(failures, {
      taskId: "1.1",
      attempt: 1,
      maxAttempts: 3,
    });

    expect(feedback).toContain("Task 1.1 is not done; verification checks failed (attempt 1/3).");
    expect(feedback).toContain("<verification-feedback>");
    expect(feedback).toContain('<failure command="bun test" exit_code="1">');
    expect(feedback).toContain("### STDERR / STACK TRACE:");
    expect(feedback).toContain("Error: expected 1 to be 2");
    expect(feedback).toContain("### STDOUT:");
    expect(feedback).toContain("bun test v1.4.4");
    expect(feedback).toContain("</failure>");
    expect(feedback).toContain("</verification-feedback>");
    expect(feedback).toContain("Analyze the failure traces, fix the underlying root causes, and re-verify before finishing the task.");
  });

  test("formats output cleanly when only stdout is present", () => {
    const failures: VerificationFailure[] = [
      {
        command: "bun run lint",
        exitCode: 1,
        stdout: "sample.ts:10:5: error: Missing return type",
        stderr: "",
        output: "sample.ts:10:5: error: Missing return type",
      },
    ];

    const feedback = formatVerificationFeedback(failures, { taskId: "2.3" });
    expect(feedback).toContain("Task 2.3 is not done; verification checks failed.");
    expect(feedback).not.toContain("### STDERR / STACK TRACE:");
    expect(feedback).toContain("### STDOUT:");
    expect(feedback).toContain("sample.ts:10:5: error: Missing return type");
  });

  test("formats output cleanly when only stderr is present", () => {
    const failures: VerificationFailure[] = [
      {
        command: "bunx tsc --noEmit",
        exitCode: 2,
        stdout: "",
        stderr: "src/index.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.",
        output: "src/index.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.",
      },
    ];

    const feedback = formatVerificationFeedback(failures);
    expect(feedback).toContain("The task is not done; verification checks failed.");
    expect(feedback).toContain("### STDERR / STACK TRACE:");
    expect(feedback).toContain("error TS2322");
    expect(feedback).not.toContain("### STDOUT:");
  });

  test("truncates failure output exceeding maxLength", () => {
    const longOutput = "x".repeat(100);
    const failures: VerificationFailure[] = [
      {
        command: "bun run build",
        exitCode: 1,
        stdout: "",
        stderr: longOutput,
        output: longOutput,
      },
    ];

    const feedback = formatVerificationFeedback(failures, { maxLength: 20 });
    expect(feedback).toContain("x".repeat(20));
    expect(feedback).not.toContain("x".repeat(21));
  });

  test("formats multiple failures in order", () => {
    const failures: VerificationFailure[] = [
      {
        command: "bun test",
        exitCode: 1,
        stdout: "fail 1",
        stderr: "stack 1",
        output: "fail 1",
      },
      {
        command: "bun run lint",
        exitCode: 1,
        stdout: "lint error",
        stderr: "",
        output: "lint error",
      },
    ];

    const feedback = formatVerificationFeedback(failures, { taskId: "1.2" });
    expect(feedback).toContain('<failure command="bun test" exit_code="1">');
    expect(feedback).toContain('<failure command="bun run lint" exit_code="1">');
  });
});

describe("runVerificationPhase", () => {
  test("uses default QA verification suite when no commands are passed", async () => {
    const executed: string[] = [];
    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      executed.push(cmd);
      return { code: 0, stdout: "ok", stderr: "", output: "ok" };
    };

    const result = await runVerificationPhase({ runner: mockRunner });
    expect(result.success).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.feedbackPrompt).toBeUndefined();
    expect(executed).toEqual([...QA_VERIFY_COMMANDS]);
  });

  test("accepts commands array as first argument", async () => {
    const executed: string[] = [];
    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      executed.push(cmd);
      return { code: 0, stdout: "ok", stderr: "", output: "ok" };
    };

    const result = await runVerificationPhase(["bun test", "bun run build"], { runner: mockRunner });
    expect(result.success).toBe(true);
    expect(executed).toEqual(["bun test", "bun run build"]);
  });

  test("stops on first failure by default and formats feedback prompt", async () => {
    const executed: string[] = [];
    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      executed.push(cmd);
      if (cmd === "bunx tsc --noEmit") {
        return {
          code: 1,
          stdout: "",
          stderr: "Type error at line 5",
          output: "Type error at line 5",
        };
      }
      return { code: 0, stdout: "ok", stderr: "", output: "ok" };
    };

    const result = await runVerificationPhase({
      commands: ["bun test", "bunx tsc --noEmit", "bun run lint"],
      taskId: "1.1",
      attempt: 2,
      maxAttempts: 3,
      runner: mockRunner,
    });

    expect(result.success).toBe(false);
    expect(executed).toEqual(["bun test", "bunx tsc --noEmit"]); // bun run lint was skipped
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]?.command).toBe("bunx tsc --noEmit");
    expect(result.failures[0]?.exitCode).toBe(1);
    expect(result.failures[0]?.stderr).toBe("Type error at line 5");
    expect(result.feedbackPrompt).toBeDefined();
    expect(result.feedbackPrompt).toContain("Task 1.1 is not done; verification checks failed (attempt 2/3).");
    expect(result.feedbackPrompt).toContain('<failure command="bunx tsc --noEmit" exit_code="1">');
    expect(result.feedbackPrompt).toContain("Type error at line 5");
  });

  test("continues on failure when stopOnFirstFailure is false", async () => {
    const executed: string[] = [];
    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      executed.push(cmd);
      if (cmd === "bun test") {
        return { code: 1, stdout: "test failed", stderr: "stack", output: "test failed" };
      }
      if (cmd === "bun run lint") {
        return { code: 2, stdout: "lint failed", stderr: "", output: "lint failed" };
      }
      return { code: 0, stdout: "ok", stderr: "", output: "ok" };
    };

    const result = await runVerificationPhase({
      commands: ["bun test", "bunx tsc --noEmit", "bun run lint"],
      stopOnFirstFailure: false,
      runner: mockRunner,
    });

    expect(result.success).toBe(false);
    expect(executed).toEqual(["bun test", "bunx tsc --noEmit", "bun run lint"]);
    expect(result.failures.length).toBe(2);
    expect(result.failures[0]?.command).toBe("bun test");
    expect(result.failures[1]?.command).toBe("bun run lint");
  });

  test("invokes hooks for logging and progress reporting", async () => {
    const messages: string[] = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      return { code: cmd === "bun test" ? 0 : 1, stdout: "", stderr: "fail", output: "fail" };
    };

    const result = await runVerificationPhase({
      commands: ["bun test", "bun run lint"],
      runner: mockRunner,
      hooks: {
        say: (msg) => messages.push(msg),
        log: (event, data) => events.push({ event, data }),
      },
    });

    expect(result.success).toBe(false);
    expect(messages).toContain("  check: bun test");
    expect(messages).toContain("  ✅ bun test");
    expect(messages).toContain("  check: bun run lint");
    expect(messages).toContain("  ❌ bun run lint");
    expect(events).toEqual([
      { event: "check", data: { command: "bun test", code: 0 } },
      { event: "check", data: { command: "bun run lint", code: 1 } },
    ]);
  });

  test("passes custom cwd and timeoutMs to runner", async () => {
    let capturedCwd = "";
    let capturedTimeout = 0;

    const mockRunner = async (
      _cmd: string,
      cwd: string,
      timeoutMs: number,
    ): Promise<CommandRunnerResult> => {
      capturedCwd = cwd;
      capturedTimeout = timeoutMs;
      return { code: 0, stdout: "", stderr: "", output: "" };
    };

    await runVerificationPhase({
      commands: ["bun test"],
      cwd: "/custom/workdir",
      timeoutMs: 50_000,
      runner: mockRunner,
    });

    expect(capturedCwd).toBe("/custom/workdir");
    expect(capturedTimeout).toBe(50_000);
  });
});
