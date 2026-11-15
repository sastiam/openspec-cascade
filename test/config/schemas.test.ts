import { describe, expect, test } from "bun:test";
import {
  CascadeConfigSchema,
  CascadeFileConfigSchema,
  ConfigValidationError,
  DEFAULT_GREPTILE_CONFIG,
  DEFAULT_SDD_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
  DiagramsConfigSchema,
  EffortLevelSchema,
  EngineConfigSchema,
  EngineTypeSchema,
  ExecutionModeSchema,
  GateBudgetsSchema,
  getDefaultConfig,
  GreptileConfigSchema,
  parseWithConfigError,
  RuntimeConfigSchema,
  SddConfigSchema,
  strictBooleanSchema,
  strictFiniteNumberSchema,
  TelemetryConfigSchema,
} from "../../config";

describe("Strict Zod Boundary Schemas (F02)", () => {
  test("strictFiniteNumberSchema rejects NaN, Infinity, empty strings, and booleans", () => {
    const schema = strictFiniteNumberSchema({ minExclusive: 0, max: 100, label: "budget" });

    expect(schema.parse(25.5)).toBe(25.5);
    expect(schema.parse(" 42 ")).toBe(42);

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "", "   ", "abc", true, false, null, -5, 0, 101]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  test("strictBooleanSchema accepts canonical booleans and rejects ambiguous strings", () => {
    const schema = strictBooleanSchema("flag");
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse("YES")).toBe(true);
    expect(schema.parse("1")).toBe(true);
    expect(schema.parse(false)).toBe(false);
    expect(schema.parse("no")).toBe(false);
    expect(schema.parse("0")).toBe(false);

    for (const bad of ["", "maybe", 1, 0, null]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  test("EngineTypeSchema, EffortLevelSchema, and ExecutionModeSchema validate and normalize", () => {
    expect(EngineTypeSchema.parse("AGY")).toBe("antigravity");
    expect(EngineTypeSchema.parse("OpenCode")).toBe("opencode");
    expect(EngineTypeSchema.safeParse("gpt").success).toBe(false);

    expect(EffortLevelSchema.parse("HIGH")).toBe("high");
    expect(EffortLevelSchema.safeParse("extreme").success).toBe(false);

    expect(ExecutionModeSchema.parse("V2")).toBe("v2");
    expect(ExecutionModeSchema.safeParse("v3").success).toBe(false);
  });

  test("domain sub-schemas validate canonical configurations", () => {
    const cfg = getDefaultConfig("/tmp/demo-repo");

    expect(RuntimeConfigSchema.parse(cfg).mode).toBe("v1");
    expect(EngineConfigSchema.parse(cfg).engine).toBe("claude");
    expect(
      GateBudgetsSchema.parse({
        maxAttemptsPerTask: 3,
        maxBudgetPerSessionUsd: 10,
        maxTotalBudgetUsd: 150,
        maxChallengeAttempts: 2,
        maxVictoryFailures: 3,
        spawnLimit: 16,
        tokenWatermarkPercent: 80,
      }).spawnLimit,
    ).toBe(16);
    expect(SddConfigSchema.parse(DEFAULT_SDD_CONFIG).enabled).toBe(true);
    expect(GreptileConfigSchema.parse(DEFAULT_GREPTILE_CONFIG).tokenBudget).toBe(8_000);
    expect(TelemetryConfigSchema.parse(DEFAULT_TELEMETRY_CONFIG).redactSecrets).toBe(true);
    expect(DiagramsConfigSchema.parse(cfg).autoDiagrams).toBe(true);
    expect(CascadeConfigSchema.parse(cfg).repo).toBe("/tmp/demo-repo");
  });

  test("CascadeFileConfigSchema rejects unknown keys fail-closed with ConfigValidationError", () => {
    expect(() =>
      parseWithConfigError(
        CascadeFileConfigSchema,
        { engine: "claude", unknownOption: true },
        "Config file",
      ),
    ).toThrow(ConfigValidationError);

    try {
      parseWithConfigError(CascadeFileConfigSchema, { maxBudgetPerSessionUsd: -1 }, "Config file");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      if (error instanceof ConfigValidationError) {
        expect(error.exitCode).toBe(2);
        expect(error.issues.length).toBeGreaterThan(0);
      }
    }
  });

  test("enforces integer percentages and domain-scoped minimum bounds", () => {
    const cfg = getDefaultConfig("/tmp/demo-repo");

    expect(EngineConfigSchema.safeParse({ ...cfg, usageLimitPercent: 1.5 }).success).toBe(false);
    expect(EngineConfigSchema.safeParse({ ...cfg, usageLimitPercent: 80 }).success).toBe(true);
    expect(EngineConfigSchema.safeParse({ ...cfg, maxTurnsPerSession: 0 }).success).toBe(false);
    expect(EngineConfigSchema.safeParse({ ...cfg, maxTurnsPerSession: 1 }).success).toBe(true);

    expect(
      GateBudgetsSchema.safeParse({
        maxAttemptsPerTask: 3,
        maxBudgetPerSessionUsd: 10,
        maxTotalBudgetUsd: 150,
        maxChallengeAttempts: 2,
        maxVictoryFailures: 3,
        spawnLimit: 16,
        tokenWatermarkPercent: 80.5,
      }).success,
    ).toBe(false);

    expect(SddConfigSchema.safeParse({ ...DEFAULT_SDD_CONFIG, minReviewDurationSeconds: 0 }).success).toBe(true);
    expect(SddConfigSchema.safeParse({ ...DEFAULT_SDD_CONFIG, minReviewDurationSeconds: -1 }).success).toBe(false);
  });
});
