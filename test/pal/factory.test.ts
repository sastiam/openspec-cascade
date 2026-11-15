import { describe, expect, test } from "bun:test";
import { ConfigValidationError } from "../../src/config/schemas";
import { PalEngineBridge } from "../../src/pal/bridge";
import { createAdapterSpawnFn, EngineFactory, getDefaultEngineFactory, resolveEngineType } from "../../src/pal/factory";
import {
  createPalMessage,
  createTextBlock,
  createToolCallBlock,
  PAL_ERROR_KINDS,
  PalError,
  type IPalProvider,
  type PalOutcome,
} from "../../src/pal/types";
import { NodeSpawner } from "../../src/runtime";
import { engineAdapters, getEngineAdapter } from "../../engine";
import type { EngineHooks } from "../../engine";

function recordingHooks(): EngineHooks & { texts: string[]; tools: string[]; events: string[] } {
  const texts: string[] = [];
  const tools: string[] = [];
  const events: string[] = [];
  return {
    texts,
    tools,
    events,
    onText: (text) => texts.push(text),
    onTool: (name) => tools.push(name),
    log: (event) => events.push(event),
  };
}

function scriptedProvider(result: PalOutcome | Error): IPalProvider {
  return {
    providerName: "jules",
    modelName: "scripted",
    executeTurn: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
    streamTurn: async function* () {},
    getCapabilities: () => ({
      providerName: "jules",
      modelName: "scripted",
      maxContextTokens: 1,
      maxOutputTokens: 1,
      supportsNativeTools: false,
      supportsStreaming: false,
      supportsExtendedThinking: false,
      supportsPromptCaching: false,
    }),
    getRateLimitState: () => ({ requestsRemaining: 1, requestsLimit: 1, tokensRemaining: 1, tokensLimit: 1, resetsAt: 0 }),
  };
}

describe("EngineFactory", () => {
  const factory = new EngineFactory({ spawner: new NodeSpawner() });

  test.each([
    ["claude", "claude", "claude"],
    ["opencode", "opencode", "opencode"],
    ["antigravity", "antigravity", "antigravity"],
    ["gemini", "antigravity", "antigravity"],
    ["agy", "antigravity", "antigravity"],
    ["jules", "jules", "jules"],
  ])("create(%s) yields a unified %s engine with a %s provider", (engine, canonical, providerName) => {
    const unified = factory.create(engine, { cwd: process.cwd() });
    expect(unified.engineType).toBe(canonical as never);
    expect(unified.name).toBe(canonical as never);
    expect(typeof unified.getDefaultModel()).toBe("string");
    expect(unified.getProvider().providerName).toBe(providerName as never);
  });

  test("claude keeps plan meters and usage reader; CLI engines do not", () => {
    expect(factory.create("claude").supportsPlanMeters()).toBe(true);
    expect(factory.create("claude").readUsage).toBeDefined();
    expect(factory.create("opencode").supportsPlanMeters()).toBe(false);
    expect(factory.create("jules").readUsage).toBeUndefined();
  });

  test("unknown engines fail closed with exit code 2", () => {
    expect(() => factory.create("unknown")).toThrow(ConfigValidationError);
    try {
      resolveEngineType("nope");
    } catch (error) {
      expect((error as ConfigValidationError).exitCode).toBe(2);
    }
  });

  test("supported engines and default factory", () => {
    expect(EngineFactory.supportedEngines()).toEqual(["claude", "opencode", "antigravity", "jules"]);
    expect(getDefaultEngineFactory()).toBe(getDefaultEngineFactory());
    expect(factory.create("opencode", { spawner: new NodeSpawner() }).engineType).toBe("opencode");
  });

  test("adapter spawn function runs real processes through the spawner", async () => {
    const spawnFn = createAdapterSpawnFn(new NodeSpawner());
    const proc = spawnFn(["sh", "-c", "printf adapter"], { cwd: process.cwd() });
    expect(await new Response(proc.stdout).text()).toBe("adapter");
    expect(await proc.exited).toBe(0);
  });

  test("engine registry exposes jules through the PAL bridge", () => {
    expect(engineAdapters.jules).toBeInstanceOf(PalEngineBridge);
    expect(getEngineAdapter("jules").name).toBe("jules");
    expect(getEngineAdapter("gemini").name).toBe("antigravity");
  });

  test("real Jules engine without the CLI installed fails closed instead of crashing", async () => {
    const unified = factory.create("jules", { cwd: process.cwd() });
    const hooks = recordingHooks();
    const outcome = await unified.runSession({ prompt: "noop", cwd: process.cwd(), hooks });
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind === "fatal") expect(outcome.reason).toContain("jules");
  });
});

describe("PalEngineBridge", () => {
  const base = { engineType: "jules" as const, defaultModel: "jules" };

  test("maps a completed turn to done and reports text and tool calls", async () => {
    const bridge = new PalEngineBridge({
      ...base,
      createProvider: () =>
        scriptedProvider({
          message: createPalMessage({
            role: "assistant",
            content: [createTextBlock("all done"), createToolCallBlock("call-1", "Edit", { file: "a.ts" })],
          }),
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        }),
    });
    const hooks = recordingHooks();
    const outcome = await bridge.runSession({ prompt: "do it", cwd: process.cwd(), resume: "s-1", hooks });
    expect(outcome).toEqual({ kind: "done", sessionId: "s-1", result: "all done", costUsd: 0 });
    expect(hooks.texts).toEqual(["all done"]);
    expect(hooks.tools).toEqual(["Edit"]);
    expect(hooks.events).toContain("pal_turn");
    expect(bridge.getDefaultModel()).toBe("jules");
    expect(bridge.supportsPlanMeters()).toBe(false);
  });

  test("rate limits pause until resetsAt or the configured sleep", async () => {
    const now = 1_000;
    const withReset = new PalEngineBridge({
      ...base,
      now: () => now,
      createProvider: () => scriptedProvider(new PalError(PAL_ERROR_KINDS.RATE_LIMIT, "slow down", true, 5_000)),
    });
    expect(await withReset.runSession({ prompt: "p", cwd: ".", hooks: recordingHooks() })).toMatchObject({
      kind: "paused",
      resumeAt: 5_000,
    });
    const withoutReset = new PalEngineBridge({
      ...base,
      now: () => now,
      rateLimitSleepMs: 10,
      createProvider: () => scriptedProvider(new PalError(PAL_ERROR_KINDS.OVERLOADED, "busy", true)),
    });
    expect(await withoutReset.runSession({ prompt: "p", cwd: ".", hooks: recordingHooks() })).toMatchObject({
      kind: "paused",
      resumeAt: 1_010,
    });
  });

  test("auth failures are fatal, retryable errors and foreign errors are retryable", async () => {
    const fatal = new PalEngineBridge({
      ...base,
      createProvider: () => scriptedProvider(new PalError(PAL_ERROR_KINDS.AUTH_FAILURE, "login", false)),
    });
    expect((await fatal.runSession({ prompt: "p", cwd: ".", hooks: recordingHooks() })).kind).toBe("fatal");
    const retryable = new PalError(PAL_ERROR_KINDS.TIMEOUT, "slow", true);
    const timeout = new PalEngineBridge({ ...base, createProvider: () => scriptedProvider(retryable) });
    expect((await timeout.runSession({ prompt: "p", cwd: ".", hooks: recordingHooks() })).kind).toBe("error");
    const foreign = new PalEngineBridge({ ...base, createProvider: () => scriptedProvider(new Error("boom")) });
    expect(await foreign.runSession({ prompt: "p", cwd: ".", hooks: recordingHooks() })).toMatchObject({
      kind: "error",
      reason: "jules: boom",
    });
  });
});
