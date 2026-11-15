import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEngineAdapter } from "../../../engine";
import { buildKeepAliveArgs, startKeepAlive } from "../../../platform";
import {
  defaultCommandRunner,
  formatVerificationFeedback,
  runVerificationPhase,
} from "../../../qa";
import {
  InMemoryMcpClient,
  PalToolDispatcher,
  validateToolArguments,
} from "../../../src/pal/mcp";
import { PalNormalizer } from "../../../src/pal/normalizer";
import { extractReActToolCalls, repairTruncatedJson } from "../../../src/pal/react_parser";
import {
  COGNITIVE_ROLES,
  PAL_ROLES,
  createPalMessage,
  createTextBlock,
  createToolCallBlock,
  createToolResultBlock,
} from "../../../src/pal/types";
import { runCascadeCli } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import {
  addOpenSpecChange,
  cleanupTempDir,
  createTempGitRepo,
} from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

describe("Tier 1 Features: F06–F09 Runtime, Keep-Alive, PAL & Facade CLI", () => {
  test("platform buildKeepAliveArgs and startKeepAlive handle disabled and noop-fallback modes", () => {
    const darwinArgs = buildKeepAliveArgs({ platform: "darwin", pid: 1234 });
    expect(darwinArgs).not.toBeNull();
    expect(darwinArgs?.command[0]).toBe("caffeinate");
    expect(darwinArgs?.command).toContain("1234");

    const linuxArgs = buildKeepAliveArgs({
      platform: "linux",
      pid: 5678,
      systemdInhibitPath: "/usr/bin/systemd-inhibit",
    });
    expect(linuxArgs).not.toBeNull();
    expect(linuxArgs?.command[0]).toBe("/usr/bin/systemd-inhibit");

    const disabledController = startKeepAlive({ enabled: false });
    expect(disabledController.active).toBe(false);
    expect(disabledController.mechanism).toBe("disabled");
    disabledController.stop();
    expect(disabledController.active).toBe(false);

    const unsupportedController = startKeepAlive({
      enabled: true,
      platform: "win32",
      logWarning: () => {},
    });
    expect(unsupportedController.active).toBe(true);
    expect(unsupportedController.mechanism).toBe("noop-fallback");
    unsupportedController.stop();
    expect(unsupportedController.active).toBe(false);
  });

  test("qa defaultCommandRunner and runVerificationPhase execute real commands in temp dir", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(sandbox));

    writeFileSync(join(sandbox, "check.txt"), "ok\n", "utf8");
    const cmdRes = await defaultCommandRunner("cat check.txt", sandbox, E2E_CONSTANTS.SHORT_SUBPROCESS_TIMEOUT_MS);
    expect(cmdRes.code).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
    expect(cmdRes.stdout.trim()).toBe("ok");

    const phaseResult = await runVerificationPhase({
      commands: ["test -f check.txt", "echo verified"],
      cwd: sandbox,
      timeoutMs: E2E_CONSTANTS.SHORT_SUBPROCESS_TIMEOUT_MS,
    });
    expect(phaseResult.success).toBe(true);
    expect(phaseResult.failures.length).toBe(0);
    expect(phaseResult.feedbackPrompt).toBeUndefined();

    const failFeedback = formatVerificationFeedback(
      [
        {
          command: "bun test",
          exitCode: 1,
          stdout: "",
          stderr: "Assertion failed at line 10",
          output: "Assertion failed at line 10",
        },
      ],
      { taskId: "1.2", attempt: 1, maxAttempts: 3 },
    );
    expect(failFeedback).toContain("<verification-feedback>");
    expect(failFeedback).toContain("Task 1.2");
    expect(failFeedback).toContain("attempt 1/3");
  });

  test("engine registry resolves claude, opencode, antigravity, and agy aliases", () => {
    const claude = getEngineAdapter("claude");
    const opencode = getEngineAdapter("opencode");
    const antigravity = getEngineAdapter("antigravity");
    const agy = getEngineAdapter("agy");

    expect(claude.name).toBe("claude");
    expect(claude.supportsPlanMeters()).toBe(true);
    expect(opencode.name).toBe("opencode");
    expect(opencode.supportsPlanMeters()).toBe(false);
    expect(antigravity.name).toBe("antigravity");
    expect(agy.name).toBe("antigravity");
  });

  test("PalNormalizer converts canonical turns across Claude, Gemini, and OpenAI payloads", () => {
    const normalizer = new PalNormalizer();
    const messages = [
      createPalMessage({ role: PAL_ROLES.USER, content: [createTextBlock("Inspect status")] }),
      createPalMessage({
        role: PAL_ROLES.ASSISTANT,
        content: [createToolCallBlock("call-1", "read_file", { path: "README.md" })],
      }),
      createPalMessage({
        role: PAL_ROLES.TOOL,
        content: [createToolResultBlock("call-1", "read_file", "Fixture content")],
      }),
    ];

    const claudePayload = normalizer.toClaude(messages);
    expect(claudePayload.messages.length).toBeGreaterThanOrEqual(2);

    const geminiPayload = normalizer.toGemini(messages);
    expect(geminiPayload.contents.length).toBeGreaterThanOrEqual(2);

    const openAiPayload = normalizer.toOpenAi(messages);
    expect(openAiPayload.messages.length).toBeGreaterThanOrEqual(3);
  });

  test("InMemoryMcpClient and PalToolDispatcher register and invoke tools end-to-end", async () => {
    const client = new InMemoryMcpClient("e2e-server");
    client.addTool(
      {
        name: "echo_upper",
        description: "Uppercases input text",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
        },
      },
      async (args: Record<string, unknown>) => ({
        content: [{ type: "text", text: String(args.text ?? "").toUpperCase() }],
      }),
    );

    const dispatcher = new PalToolDispatcher();
    const discovered = await dispatcher.registerMcpServer(client, {
      prefixServerName: true,
    });
    expect(discovered.length).toBe(1);
    expect(discovered[0]?.name).toBe("e2e-server__echo_upper");

    const validation = validateToolArguments(
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      { text: "hello" },
    );
    expect(validation.valid).toBe(true);

    const result = await dispatcher.dispatch(
      createToolCallBlock("call-mcp-1", "e2e-server__echo_upper", { text: "hello" }),
      {
        agentId: "e2e-agent",
        role: COGNITIVE_ROLES.WORKER,
        workingDirectory: ".",
        logger: () => {},
      },
    );
    expect(result.isError).toBe(false);
    expect(result.content).toContain("HELLO");
  });

  test("ReAct parser extracts XML tool calls and repairs truncated JSON arguments", () => {
    const extracted = extractReActToolCalls(
      'Thinking...\n<tool_call>{"name": "read_file", "arguments": {"path": "config.ts"}}</tool_call>',
    );
    expect(extracted.toolCalls.length).toBe(1);
    expect(extracted.toolCalls[0]?.name).toBe("read_file");
    expect(extracted.toolCalls[0]?.arguments).toEqual({ path: "config.ts" });

    const repaired = repairTruncatedJson('{"path": "cascade.ts", "lines": [1, 2');
    expect(JSON.parse(repaired)).toEqual({ path: "cascade.ts", lines: [1, 2] });
  });

  test(
    "cascade CLI --dry-run honors --engine flag across supported engines",
    async () => {
      const fixture = await createTempGitRepo({ branch: "feat/e2e-engines" });
      cleanups.push(fixture.cleanup);

      addOpenSpecChange(fixture.repoDir, "engine-check");

      for (const flag of ["claude", "opencode", "agy"]) {
        const expectedEngine = flag === "agy" ? "antigravity" : flag;
        const result = await runCascadeCli({
          args: [
            "--repo",
            fixture.repoDir,
            "--changes",
            "engine-check",
            "--engine",
            flag,
            "--dry-run",
            "--no-keep-alive",
          ],
          homeDir: fixture.homeDir,
        });

        expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
        expect(result.stdout).toContain(`engine=${expectedEngine}`);
      }
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );
});
