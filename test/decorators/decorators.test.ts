import { describe, expect, test } from "bun:test";
import type { EngineHooks } from "../../engine";
import {
  classifyEngineError,
  computeBackoffDelay,
  extractTokenUsage,
  ResilientEngineDecorator,
  summarizeTelemetry,
  TelemetryMetricsDecorator,
} from "../../src/decorators";
import { ScriptedEngine } from "./engine_test_double";

function hooks(events: Array<[string, Record<string, unknown>]> = []): EngineHooks {
  return { onText: () => undefined, onTool: () => undefined, log: (event, data) => events.push([event, data]) };
}

const done = { kind: "done", result: "ok", costUsd: 1 } as const;
const error = { kind: "error", reason: "exit 1: flaky", costUsd: 0.5 } as const;

describe("computeBackoffDelay", () => {
  test("is bounded by full jitter and the max delay", () => {
    expect(computeBackoffDelay(0, 100, 1_000, () => 0.999)).toBe(99);
    expect(computeBackoffDelay(3, 100, 1_000, () => 0.5)).toBe(400);
    expect(computeBackoffDelay(10, 100, 1_000, () => 1)).toBe(1_000);
    expect(computeBackoffDelay(2, 100, 1_000, () => 0)).toBe(0);
  });
});

describe("ResilientEngineDecorator", () => {
  test("retries a transient error once and succeeds, summing cost", async () => {
    const inner = new ScriptedEngine([{ ...error, sessionId: "s-1" }, done]);
    const sleeps: number[] = [];
    const events: Array<[string, Record<string, unknown>]> = [];
    const decorator = new ResilientEngineDecorator(inner, {
      baseDelayMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
    });
    const outcome = await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks(events) });
    expect(outcome).toEqual({ ...done, costUsd: 1.5 });
    expect(sleeps).toEqual([50]);
    expect(events.filter(([event]) => event === "engine_retry")).toHaveLength(1);
    expect(inner.calls[1]?.resume).toBe("s-1");
  });

  test("does not retry fatal or paused outcomes", async () => {
    for (const outcome of [
      { kind: "fatal", reason: "auth", costUsd: 0 } as const,
      { kind: "paused", resumeAt: 1, costUsd: 0 } as const,
    ]) {
      const inner = new ScriptedEngine([outcome, done]);
      const decorator = new ResilientEngineDecorator(inner, { sleep: async () => undefined });
      expect((await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks() })).kind).toBe(outcome.kind);
      expect(inner.calls).toHaveLength(1);
    }
  });

  test("gives up after maxRetries and converts thrown errors into error outcomes", async () => {
    const inner = new ScriptedEngine([new Error("socket hang up"), error, error, done]);
    const decorator = new ResilientEngineDecorator(inner, { maxRetries: 2, sleep: async () => undefined });
    const outcome = await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks() });
    expect(outcome.kind).toBe("error");
    expect(inner.calls).toHaveLength(3);
  });

  test("opens the circuit, short-circuits, then recovers through half-open", async () => {
    let now = 0;
    const inner = new ScriptedEngine([error, error, done]);
    const events: Array<[string, Record<string, unknown>]> = [];
    const decorator = new ResilientEngineDecorator(inner, {
      maxRetries: 1,
      failureThreshold: 2,
      cooldownMs: 1_000,
      sleep: async () => undefined,
      now: () => now,
    });
    expect((await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks(events) })).kind).toBe("error");
    expect(decorator.circuitState).toBe("open");
    const shortCircuit = await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks(events) });
    expect(shortCircuit.kind).toBe("fatal");
    if (shortCircuit.kind === "fatal") expect(shortCircuit.reason).toContain("circuit_open");
    expect(inner.calls).toHaveLength(2);
    now = 1_000;
    expect((await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks(events) })).kind).toBe("done");
    expect(decorator.circuitState).toBe("closed");
    const transitions = events.filter(([event]) => event === "engine_circuit").map(([, data]) => data.to);
    expect(transitions).toEqual(["open", "half_open", "closed"]);
  });

  test("a failed half-open trial re-opens the circuit", async () => {
    let now = 0;
    const inner = new ScriptedEngine([error, error]);
    const decorator = new ResilientEngineDecorator(inner, {
      maxRetries: 0,
      failureThreshold: 1,
      cooldownMs: 10,
      sleep: async () => undefined,
      now: () => now,
    });
    await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks() });
    now = 10;
    await decorator.runSession({ prompt: "p", cwd: ".", hooks: hooks() });
    expect(decorator.circuitState).toBe("open");
  });

  test("delegates identity and provider accessors", () => {
    const decorator = new ResilientEngineDecorator(new ScriptedEngine([]));
    expect(decorator.name).toBe("opencode");
    expect(decorator.engineType).toBe("opencode");
    expect(decorator.getDefaultModel()).toBe("scripted-model");
    expect(decorator.supportsPlanMeters()).toBe(false);
    expect(decorator.readUsage).toBeUndefined();
    expect(() => decorator.getProvider()).toThrow("provider not available");
  });
});

describe("TelemetryMetricsDecorator", () => {
  test("records latency, cost, tokens, retries and categories across composed decorators", async () => {
    let clock = 0;
    const inner = new ScriptedEngine([
      { ...error, reason: "429 Too Many Requests" },
      done,
      { kind: "error", reason: "429 rate limit", costUsd: 0 },
      { kind: "paused", resumeAt: 5, costUsd: 0 },
    ]);
    const resilient = new ResilientEngineDecorator(inner, { maxRetries: 1, sleep: async () => undefined });
    const sunk: string[] = [];
    const telemetry = new TelemetryMetricsDecorator(resilient, {
      now: () => (clock += 10),
      sink: (record) => sunk.push(record.outcome),
    });
    await telemetry.runSession({ prompt: "p", cwd: ".", hooks: hooks() });
    await telemetry.runSession({ prompt: "p", cwd: ".", hooks: hooks() });
    const summary = telemetry.getSummary();
    expect(summary.sessions).toBe(2);
    expect(summary.outcomes).toEqual({ done: 1, paused: 1 });
    expect(summary.retries).toBe(2);
    expect(summary.totalCostUsd).toBe(1.5);
    expect(summary.inputTokens).toBe(40);
    expect(summary.outputTokens).toBe(20);
    expect(summary.errorsByCategory).toEqual({ rate_limit: 1 });
    expect(summary.averageLatencyMs).toBe(10);
    expect(sunk).toEqual(["done", "paused"]);
    expect(telemetry.getRecords()).toHaveLength(2);
  });

  test("records thrown errors and rethrows them", async () => {
    const telemetry = new TelemetryMetricsDecorator(new ScriptedEngine([new Error("ETIMEDOUT request timed out")]));
    await expect(telemetry.runSession({ prompt: "p", cwd: ".", hooks: hooks() })).rejects.toThrow("timed out");
    expect(telemetry.getRecords()[0]).toMatchObject({ outcome: "thrown", errorCategory: "timeout" });
    expect(telemetry.engineType).toBe("opencode");
  });

  test("classification and token extraction helpers", () => {
    expect(classifyEngineError("OpenCode: unauthorized")).toBe("auth");
    expect(classifyEngineError("circuit_open after 5")).toBe("circuit_open");
    expect(classifyEngineError("session budget exceeded")).toBe("budget");
    expect(classifyEngineError("segfault")).toBe("unknown");
    expect(extractTokenUsage({ tokens: { promptTokens: 3, completionTokens: 4 } })).toEqual({ input: 3, output: 4 });
    expect(extractTokenUsage({ usage: [1] })).toEqual({ input: 0, output: 0 });
    expect(summarizeTelemetry([]).averageLatencyMs).toBe(0);
  });
});
