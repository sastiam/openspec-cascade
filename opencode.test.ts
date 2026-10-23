import { describe, expect, test } from "bun:test";
import { classifyFailure, openCodeModelArg, openCodePermission, reduceOpenCodeEvent, type SessionState } from "./opencode";

const noHooks = { onTool: () => {}, onText: () => {} };
const fresh = (): SessionState => ({ texts: new Map(), costUsd: 0 });

describe("openCodeModelArg", () => {
  test("defaults to DeepSeek 4.1 Flash with the effort as variant", () => {
    expect(openCodeModelArg(undefined, "high")).toBe("opencode/deepseek-v4.1-flash#high");
  });

  test("keeps an explicit variant and omits it for effort none", () => {
    expect(openCodeModelArg("opencode/deepseek-v4-pro#max", "high")).toBe("opencode/deepseek-v4-pro#max");
    expect(openCodeModelArg("opencode/deepseek-v4-pro", "none")).toBe("opencode/deepseek-v4-pro");
  });
});

describe("openCodePermission", () => {
  test("maps Claude Bash deny rules to OpenCode bash patterns after the catch-all", () => {
    const { bash } = openCodePermission(["Bash(git push)", "Bash(git push *)"]);
    expect(Object.entries(bash)).toEqual([["*", "allow"], ["git push", "deny"], ["git push *", "deny"]]);
  });
});

describe("reduceOpenCodeEvent", () => {
  test("collects session id, deduplicated text, completed tools and step cost", () => {
    const state = fresh();
    const tools: string[] = [];
    const texts: string[] = [];
    const hooks = { onTool: (name: string) => tools.push(name), onText: (t: string) => texts.push(t) };
    const lines = [
      { type: "text", sessionID: "ses_1", part: { id: "p1", type: "text", text: "Working" } },
      { type: "text", part: { id: "p1", type: "text", text: "Working on it" } },
      { type: "tool_use", part: { type: "tool", tool: "bash", state: { status: "running", input: {} } } },
      { type: "tool_use", part: { type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" } } } },
      { type: "step_finish", part: { type: "step-finish", cost: 0.012 } },
      { type: "step_finish", properties: { part: { type: "step-finish", cost: 0.003 } } },
    ];
    for (const line of lines) reduceOpenCodeEvent(state, JSON.stringify(line), hooks);

    expect(state.sessionId).toBe("ses_1");
    expect([...state.texts.values()]).toEqual(["Working on it"]);
    expect(texts).toEqual(["Working"]);
    expect(tools).toEqual(["bash"]);
    expect(state.costUsd).toBeCloseTo(0.015);
  });

  test("records error events and ignores non-JSON lines", () => {
    const state = fresh();
    reduceOpenCodeEvent(state, "Some banner", noHooks);
    reduceOpenCodeEvent(state, JSON.stringify({ type: "error", error: { message: "429 Too Many Requests" } }), noHooks);
    expect(state.error).toContain("429");
  });
});

describe("classifyFailure", () => {
  // Real error line from `opencode run --format json` v2.1.1 with a rejected credential
  const authLine = JSON.stringify({
    type: "error",
    sessionID: "ses_example00000000000000auth",
    error: { type: "provider.auth", message: "Upstream request failed: Invalid credential", status: 401 },
  });

  test("auth errors are fatal, rate limits pause, anything else is a retryable error", () => {
    const state = fresh();
    reduceOpenCodeEvent(state, authLine, noHooks);
    expect(state.sessionId).toBe("ses_example00000000000000auth");
    expect(classifyFailure(state.error!)).toBe("fatal");
    expect(classifyFailure('{"message":"429 Too Many Requests"}')).toBe("paused");
    expect(classifyFailure("exit 1: something broke")).toBe("error");
  });
});

describe("real opencode run --format json output (v2.1.1, opencode/deepseek-v4.1-flash#high)", () => {
  const lines = [
    '{"type":"step_start","timestamp":1792787829568,"sessionID":"ses_example000000000000000ok","part":{"id":"prt_example_step_start_000002","sessionID":"ses_example000000000000000ok","messageID":"msg_example_000000000000000002","type":"step-start","snapshot":"0000000000000000000000000000000000000000"}}',
    '{"type":"text","timestamp":1792787830489,"sessionID":"ses_example000000000000000ok","part":{"id":"prt_example_text_000000000001","sessionID":"ses_example000000000000000ok","messageID":"msg_example_000000000000000002","type":"text","text":"OK","time":{"start":1792787830415,"end":1792787830489}}}',
  ];

  test("reads the session id and the reply text", () => {
    const state = fresh();
    for (const line of lines) reduceOpenCodeEvent(state, line, noHooks);
    expect(state.sessionId).toBe("ses_example000000000000000ok");
    expect([...state.texts.values()]).toEqual(["OK"]);
    expect(state.error).toBeUndefined();
  });
});
