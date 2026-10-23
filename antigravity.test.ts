import { describe, expect, test } from "bun:test";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  antigravityEffortArg,
  antigravityModelArg,
  buildAntigravityArgs,
  classifyFailure,
  estimateCostUsd,
  reduceAntigravityEvent,
  type SessionState,
} from "./antigravity";

const noHooks = { onTool: () => {}, onText: () => {} };
const fresh = (): SessionState => ({
  texts: [],
  tokens: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, totalTokens: 0 },
  costUsd: 0,
});

describe("antigravityModelArg", () => {
  test("defaults to Gemini 3.8 Flash High", () => {
    expect(antigravityModelArg(undefined)).toBe(ANTIGRAVITY_DEFAULT_MODEL);
    expect(antigravityModelArg("")).toBe(ANTIGRAVITY_DEFAULT_MODEL);
    expect(antigravityModelArg("   ")).toBe(ANTIGRAVITY_DEFAULT_MODEL);
  });

  test("uses provided model if specified", () => {
    expect(antigravityModelArg("gemini-4-argon-medium")).toBe("gemini-4-argon-medium");
  });
});

describe("antigravityEffortArg", () => {
  test("returns effort when provided", () => {
    expect(antigravityEffortArg("high")).toBe("high");
    expect(antigravityEffortArg("max")).toBe("max");
  });

  test("returns undefined for empty or none", () => {
    expect(antigravityEffortArg(undefined)).toBeUndefined();
    expect(antigravityEffortArg("none")).toBeUndefined();
  });
});

describe("buildAntigravityArgs", () => {
  test("constructs base argument array with required flags", () => {
    const argv = buildAntigravityArgs({
      prompt: "do something",
      model: "gemini-3.8-flash-high",
    });
    expect(argv).toEqual([
      "agy",
      "-p",
      "do something",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--model",
      "gemini-3.8-flash-high",
    ]);
  });

  test("includes effort and conversation flags when requested", () => {
    const argv = buildAntigravityArgs({
      prompt: "continue task",
      model: "gemini-3.8-flash-high",
      effort: "high",
      resume: "conv-12345",
    });
    expect(argv).toContain("--effort");
    expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
    expect(argv).toContain("--conversation");
    expect(argv[argv.indexOf("--conversation") + 1]).toBe("conv-12345");
  });
});

describe("estimateCostUsd", () => {
  test("computes cost for flash models", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      thinkingTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 2_000_000,
    };
    const cost = estimateCostUsd("gemini-3.8-flash-high", usage);
    expect(cost).toBeCloseTo(0.15 + 0.60);
  });

  test("computes cost for argon/pro models", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      thinkingTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 2_000_000,
    };
    const cost = estimateCostUsd("gemini-4-argon-medium", usage);
    expect(cost).toBeCloseTo(1.25 + 5.00);
  });
});

describe("reduceAntigravityEvent", () => {
  test("processes init, step_update, and result events", () => {
    const state = fresh();
    const tools: string[] = [];
    const texts: string[] = [];
    const hooks = {
      onTool: (name: string) => tools.push(name),
      onText: (t: string) => texts.push(t),
    };

    const lines = [
      JSON.stringify({ event: "init", conversation_id: "conv-100", init: { cwd: "/app" } }),
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-100",
          step_index: 1,
          state: "ACTIVE",
          step_type: "agent_response",
          text_delta: "Hello ",
        },
      }),
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-100",
          step_index: 1,
          state: "ACTIVE",
          step_type: "agent_response",
          text_delta: "World!",
        },
      }),
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-100",
          step_index: 2,
          state: "ACTIVE",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: { name: "run_command", parameters: { CommandLine: "ls" } },
        },
      }),
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-100",
          status: "SUCCESS",
          response: "Hello World!",
          usage: {
            input_tokens: 500,
            output_tokens: 50,
            thinking_tokens: 20,
            cache_read_tokens: 0,
            total_tokens: 550,
          },
        },
      }),
    ];

    for (const line of lines) reduceAntigravityEvent(state, line, hooks);

    expect(state.sessionId).toBe("conv-100");
    expect(texts).toEqual(["Hello ", "World!"]);
    expect(tools).toEqual(["run_command"]);
    expect(state.tokens.inputTokens).toBe(500);
    expect(state.tokens.outputTokens).toBe(50);
    expect(state.tokens.totalTokens).toBe(550);
    expect(state.error).toBeUndefined();
  });

  test("captures error when result status is not SUCCESS", () => {
    const state = fresh();
    reduceAntigravityEvent(
      state,
      JSON.stringify({
        event: "result",
        result: { conversation_id: "conv-err", status: "ERROR", error: "Something broke" },
      }),
      noHooks,
    );
    expect(state.error).toBe("Something broke");
  });

  test("ignores non-JSON lines and banners", () => {
    const state = fresh();
    reduceAntigravityEvent(state, "⠋ Fetching available models...", noHooks);
    expect(state.error).toBeUndefined();
    expect(state.sessionId).toBeUndefined();
  });
});

describe("classifyFailure", () => {
  test("unauthorized and auth failures are fatal", () => {
    expect(classifyFailure("authentication failed: invalid credential")).toBe("fatal");
    expect(classifyFailure('error: "status": 401 unauthorized')).toBe("fatal");
  });

  test("rate limits and quotas are paused", () => {
    expect(classifyFailure("429 Too Many Requests")).toBe("paused");
    expect(classifyFailure("RESOURCE_EXHAUSTED: quota exceeded")).toBe("paused");
  });

  test("general errors are retryable error", () => {
    expect(classifyFailure("exit 1: command failed")).toBe("error");
    expect(classifyFailure("syntax error in script")).toBe("error");
  });
});

describe("real agy stream-json output", () => {
  const lines = [
    '{"event":"init","conversation_id":"155ff3f2-b329-4ec4-9efc-a0affc9ec866","init":{"cwd":"/workspace","permission_mode":"always-proceed"}}',
    '{"event":"step_update","step_update":{"conversation_id":"155ff3f2-b329-4ec4-9efc-a0affc9ec866","step_index":0,"state":"DONE","step_type":"user_input"}}',
    '{"event":"step_update","step_update":{"conversation_id":"155ff3f2-b329-4ec4-9efc-a0affc9ec866","step_index":1,"state":"DONE","step_type":"agent_response","duration_seconds":2.4,"usage":{"input_tokens":7460,"output_tokens":67,"thinking_tokens":27,"cache_read_tokens":0,"total_tokens":7527}}}',
    '{"event":"step_update","step_update":{"conversation_id":"155ff3f2-b329-4ec4-9efc-a0affc9ec866","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo test"}}}}',
    '{"event":"step_update","step_update":{"conversation_id":"155ff3f2-b329-4ec4-9efc-a0affc9ec866","step_index":2,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":0.09,"tool_info":{"name":"run_command","parameters":{"CommandLine":"echo test"},"output":"test\\n"}}}',
    '{"event":"step_update","step_update":{"conversation_id":"155ff3f2-b329-4ec4-9efc-a0affc9ec866","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"Done"}}',
    '{"event":"result","result":{"conversation_id":"155ff3f2-b329-4ec4-9efc-a0affc9ec866","status":"SUCCESS","response":"Done","duration_seconds":4.4,"num_turns":1,"usage":{"input_tokens":15076,"output_tokens":98,"thinking_tokens":44,"cache_read_tokens":0,"total_tokens":15174}}}',
  ];

  test("extracts conversation id, tool calls, text and token usage accurately", () => {
    const state = fresh();
    const tools: string[] = [];
    const texts: string[] = [];
    const hooks = {
      onTool: (name: string) => tools.push(name),
      onText: (t: string) => texts.push(t),
    };

    for (const line of lines) reduceAntigravityEvent(state, line, hooks);

    expect(state.sessionId).toBe("155ff3f2-b329-4ec4-9efc-a0affc9ec866");
    expect(tools).toEqual(["run_command"]);
    expect(texts).toEqual(["Done"]);
    expect(state.tokens.totalTokens).toBe(15174);
    expect(state.tokens.inputTokens).toBe(15076);
    expect(state.tokens.outputTokens).toBe(98);
    expect(state.error).toBeUndefined();
  });
});
