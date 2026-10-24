import { describe, expect, test } from "bun:test";
import { CONSTANTS, getDefaultConfig } from "./config";
import {
  antigravityAdapter,
  AntigravityAdapter,
  claudeAdapter,
  ClaudeAdapter,
  engineAdapters,
  getEngineAdapter,
  openCodeAdapter,
  OpenCodeAdapter,
  type EngineAdapter,
  type EngineHooks,
  type EngineOutcome,
  type EngineSessionOptions,
} from "./engine";
import { claudeAgentOptions, toEpochMs } from "./claude";

describe("EngineAdapter Interface & Registry", () => {
  test("engineAdapters contains all supported engines", () => {
    expect(engineAdapters.claude).toBeInstanceOf(ClaudeAdapter);
    expect(engineAdapters.opencode).toBeInstanceOf(OpenCodeAdapter);
    expect(engineAdapters.antigravity).toBeInstanceOf(AntigravityAdapter);
  });

  test("getEngineAdapter resolves known engines and aliases", () => {
    expect(getEngineAdapter("claude")).toBe(claudeAdapter);
    expect(getEngineAdapter("opencode")).toBe(openCodeAdapter);
    expect(getEngineAdapter("antigravity")).toBe(antigravityAdapter);
    expect(getEngineAdapter("agy")).toBe(antigravityAdapter);
    expect(getEngineAdapter(undefined)).toBe(claudeAdapter);
  });

  test("getEngineAdapter throws on invalid engine", () => {
    expect(() => getEngineAdapter("unsupported" as any)).toThrow();
  });
});

describe("ClaudeAdapter", () => {
  const adapter: EngineAdapter = claudeAdapter;

  test("implements EngineAdapter interface correctly", () => {
    expect(adapter.name).toBe("claude");
    expect(adapter.supportsPlanMeters()).toBe(true);
    expect(typeof adapter.getDefaultModel()).toBe("string");
    expect(adapter.getDefaultModel()).toBe(CONSTANTS.DEFAULT_CLAUDE_MODEL);
    expect(typeof adapter.runSession).toBe("function");
    expect(typeof adapter.readUsage).toBe("function");
  });

  test("toEpochMs converts second timestamps and preserves millisecond timestamps", () => {
    const epochSec = 1700000000;
    const epochMs = 1700000000000;
    expect(toEpochMs(epochSec)).toBe(epochSec * CONSTANTS.MS_PER_SECOND);
    expect(toEpochMs(epochMs)).toBe(epochMs);
  });

  test("claudeAgentOptions constructs options from EngineSessionOptions and config", () => {
    const config = getDefaultConfig();
    const abortController = new AbortController();
    const options: EngineSessionOptions = {
      prompt: "test prompt",
      cwd: "/test/dir",
      resume: "session-123",
      model: "claude-3-7-sonnet-custom",
      effort: "high",
      config,
      hooks: {
        onTool: () => {},
        onText: () => {},
        log: () => {},
      },
    };

    const agentOpts = claudeAgentOptions(options, abortController);
    expect(agentOpts.cwd).toBe("/test/dir");
    expect(agentOpts.resume).toBe("session-123");
    expect(agentOpts.model).toBe("claude-3-7-sonnet-custom");
    expect(agentOpts.effort).toBe("high");
    expect(agentOpts.permissionMode).toBe("dontAsk");
    expect(agentOpts.maxTurns).toBe(CONSTANTS.MAX_TURNS_PER_SESSION);
    expect(agentOpts.maxBudgetUsd).toBe(CONSTANTS.MAX_BUDGET_PER_SESSION_USD);
  });

  test("claudeAgentOptions omits effort when effort is none", () => {
    const config = getDefaultConfig();
    const abortController = new AbortController();
    const options: EngineSessionOptions = {
      prompt: "test",
      cwd: "/test",
      effort: "none",
      config,
      hooks: { onTool: () => {}, onText: () => {}, log: () => {} },
    };

    const agentOpts = claudeAgentOptions(options, abortController);
    expect(agentOpts.effort).toBeUndefined();
  });
});

describe("OpenCodeAdapter", () => {
  const adapter: EngineAdapter = openCodeAdapter;

  test("implements EngineAdapter interface correctly", () => {
    expect(adapter.name).toBe("opencode");
    expect(adapter.supportsPlanMeters()).toBe(false);
    expect(typeof adapter.getDefaultModel()).toBe("string");
    expect(adapter.getDefaultModel()).toBe(CONSTANTS.DEFAULT_OPENCODE_MODEL);
    expect(adapter.getDefaultModel("high")).toBe(`${CONSTANTS.DEFAULT_OPENCODE_MODEL}#high`);
    expect(adapter.getDefaultModel("none")).toBe(CONSTANTS.DEFAULT_OPENCODE_MODEL);
    expect(typeof adapter.runSession).toBe("function");
  });
});

describe("AntigravityAdapter", () => {
  const adapter: EngineAdapter = antigravityAdapter;

  test("implements EngineAdapter interface correctly", () => {
    expect(adapter.name).toBe("antigravity");
    expect(adapter.supportsPlanMeters()).toBe(false);
    expect(typeof adapter.getDefaultModel()).toBe("string");
    expect(adapter.getDefaultModel()).toBe(CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL);
    expect(typeof adapter.runSession).toBe("function");
  });
});
