import { describe, expect, test } from "bun:test";
import {
  CONSTANTS,
  FULL_VERIFY,
  getDefaultConfig,
  isKeepAliveEnabled,
  loadConfig,
  parseCliArgs,
  resolveEngine,
} from "./config";

describe("resolveEngine", () => {
  test("resolves supported engine names case-insensitively", () => {
    expect(resolveEngine("claude")).toBe("claude");
    expect(resolveEngine("CLAUDE")).toBe("claude");
    expect(resolveEngine("opencode")).toBe("opencode");
    expect(resolveEngine("OPENCODE")).toBe("opencode");
    expect(resolveEngine("antigravity")).toBe("antigravity");
    expect(resolveEngine("agy")).toBe("antigravity");
    expect(resolveEngine("AGY")).toBe("antigravity");
  });

  test("defaults to claude when undefined", () => {
    expect(resolveEngine(undefined)).toBe("claude");
  });

  test("throws on invalid engine name", () => {
    expect(() => resolveEngine("unknown-engine")).toThrow(/--engine must be/);
  });
});

describe("isKeepAliveEnabled", () => {
  test("returns true by default", () => {
    expect(isKeepAliveEnabled({})).toBe(true);
    expect(isKeepAliveEnabled({ "no-keep-alive": false })).toBe(true);
  });

  test("returns false when --no-keep-alive is true", () => {
    expect(isKeepAliveEnabled({ "no-keep-alive": true })).toBe(false);
  });

  test("returns false when keep-alive is explicitly disabled", () => {
    expect(isKeepAliveEnabled({ "keep-alive": false })).toBe(false);
  });

  test("returns true when keep-alive is explicitly enabled", () => {
    expect(isKeepAliveEnabled({ "keep-alive": true })).toBe(true);
  });
});

describe("parseCliArgs", () => {
  test("parses standard CLI flags into options", () => {
    const { options } = parseCliArgs([
      "--repo",
      "/test/repo",
      "--changes",
      "ch1,ch2",
      "--allow-dirty",
      "--dry-run",
      "--full-gate",
      "--engine",
      "antigravity",
      "--model",
      "custom-model",
      "--effort",
      "low",
    ]);

    expect(options.repo).toBe("/test/repo");
    expect(options.changes).toBe("ch1,ch2");
    expect(options["allow-dirty"]).toBe(true);
    expect(options["dry-run"]).toBe(true);
    expect(options["full-gate"]).toBe(true);
    expect(options.engine).toBe("antigravity");
    expect(options.model).toBe("custom-model");
    expect(options.effort).toBe("low");
  });

  test("handles empty argv gracefully", () => {
    const { options, positionals } = parseCliArgs([]);
    expect(options).toBeDefined();
    expect(positionals).toEqual([]);
  });
});

describe("loadConfig", () => {
  test("loads default configuration when no args or env provided", () => {
    const config = loadConfig({ argv: [], env: {}, cwd: "/mock/repo" });

    expect(config.repo).toBe("/mock/repo");
    expect(config.changes).toEqual([]);
    expect(config.allowDirty).toBe(false);
    expect(config.dryRun).toBe(false);
    expect(config.fullGate).toBe(false);
    expect(config.engine).toBe("claude");
    expect(config.keepAlive).toBe(true);
    expect(config.effort).toBe(CONSTANTS.DEFAULT_EFFORT);
    expect(config.model).toBeUndefined();

    // Verification of centralized constants
    expect(config.usageLimitPercent).toBe(CONSTANTS.USAGE_LIMIT_PERCENT);
    expect(config.resetMarginMs).toBe(CONSTANTS.RESET_MARGIN_MS);
    expect(config.unknownResetSleepMs).toBe(CONSTANTS.UNKNOWN_RESET_SLEEP_MS);
    expect(config.minPauseMs).toBe(CONSTANTS.MIN_PAUSE_MS);
    expect(config.maxAttemptsPerTask).toBe(CONSTANTS.MAX_ATTEMPTS_PER_TASK);
    expect(config.maxTurnsPerSession).toBe(CONSTANTS.MAX_TURNS_PER_SESSION);
    expect(config.maxBudgetPerSessionUsd).toBe(CONSTANTS.MAX_BUDGET_PER_SESSION_USD);
    expect(config.maxTotalBudgetUsd).toBe(CONSTANTS.MAX_TOTAL_BUDGET_USD);
    expect(config.commandTimeoutMs).toBe(CONSTANTS.COMMAND_TIMEOUT_MS);
    expect(config.engineSessionTimeoutMs).toBe(CONSTANTS.ENGINE_SESSION_TIMEOUT_MS);
    expect(config.rateLimitSleepMs).toBe(CONSTANTS.RATE_LIMIT_SLEEP_MS);

    expect(config.protectedBranches).toEqual(CONSTANTS.PROTECTED_BRANCHES);
    expect(config.neverCommit).toEqual(CONSTANTS.NEVER_COMMIT);
    expect(config.deniedBash).toEqual(CONSTANTS.DENIED_BASH);
    expect(config.allowedTools).toEqual(CONSTANTS.ALLOWED_TOOLS);
    expect(config.settingSources).toEqual(CONSTANTS.SETTING_SOURCES);
    expect(config.defaultVerify).toEqual(CONSTANTS.DEFAULT_VERIFY);
    expect(config.fullVerify).toEqual(FULL_VERIFY);
    expect(config.defaultAntigravityModel).toBe(CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL);
    expect(config.defaultOpenCodeModel).toBe(CONSTANTS.DEFAULT_OPENCODE_MODEL);
    expect(config.autoDiagrams).toBe(true);
    expect(config.graphifyCommand).toBe(CONSTANTS.GRAPHIFY_COMMAND);
    expect(config.archifyAction).toBe(CONSTANTS.ARCHIFY_ACTION);
    expect(config.archifyQuality).toBe(CONSTANTS.ARCHIFY_DEFAULT_QUALITY);
    expect(config.archifyBin).toBeUndefined();
  });

  test("loads configuration overrides from environment variables", () => {
    const env: Record<string, string> = {
      CASCADE_REPO: "/env/repo",
      CASCADE_CHANGES: "change-a, change-b",
      CASCADE_ALLOW_DIRTY: "true",
      CASCADE_DRY_RUN: "1",
      CASCADE_FULL_GATE: "true",
      CASCADE_ENGINE: "opencode",
      CASCADE_KEEP_ALIVE: "false",
      CASCADE_MODEL: "env-model",
      CASCADE_EFFORT: "none",
      CASCADE_MAX_ATTEMPTS: "5",
      CASCADE_MAX_TURNS: "100",
      CASCADE_MAX_BUDGET_USD: "25",
      CASCADE_TOTAL_BUDGET_USD: "300",
      CASCADE_USAGE_LIMIT_PERCENT: "90",
      CASCADE_COMMAND_TIMEOUT_MS: "600000",
      CASCADE_RESET_MARGIN_MS: "180000",
      CASCADE_UNKNOWN_RESET_SLEEP_MS: "900000",
      CASCADE_MIN_PAUSE_MS: "30000",
      CASCADE_ENGINE_TIMEOUT_MS: "1200000",
      CASCADE_RATE_LIMIT_SLEEP_MS: "600000",
      CASCADE_AUTO_DIAGRAMS: "false",
      CASCADE_GRAPHIFY_COMMAND: "custom-graphify",
      CASCADE_ARCHIFY_ACTION: "render",
      CASCADE_ARCHIFY_QUALITY: "standard",
      CASCADE_ARCHIFY_BIN: "/custom/archify",
    };

    const config = loadConfig({ argv: [], env, cwd: "/mock/repo" });

    expect(config.repo).toBe("/env/repo");
    expect(config.changes).toEqual(["change-a", "change-b"]);
    expect(config.allowDirty).toBe(true);
    expect(config.dryRun).toBe(true);
    expect(config.fullGate).toBe(true);
    expect(config.engine).toBe("opencode");
    expect(config.keepAlive).toBe(false);
    expect(config.model).toBe("env-model");
    expect(config.effort).toBe("none");
    expect(config.maxAttemptsPerTask).toBe(5);
    expect(config.maxTurnsPerSession).toBe(100);
    expect(config.maxBudgetPerSessionUsd).toBe(25);
    expect(config.maxTotalBudgetUsd).toBe(300);
    expect(config.usageLimitPercent).toBe(90);
    expect(config.commandTimeoutMs).toBe(600000);
    expect(config.resetMarginMs).toBe(180000);
    expect(config.unknownResetSleepMs).toBe(900000);
    expect(config.minPauseMs).toBe(30000);
    expect(config.engineSessionTimeoutMs).toBe(1200000);
    expect(config.rateLimitSleepMs).toBe(600000);
    expect(config.autoDiagrams).toBe(false);
    expect(config.graphifyCommand).toBe("custom-graphify");
    expect(config.archifyAction).toBe("render");
    expect(config.archifyQuality).toBe("standard");
    expect(config.archifyBin).toBe("/custom/archify");
  });

  test("CLI arguments take precedence over environment variables", () => {
    const env: Record<string, string> = {
      CASCADE_REPO: "/env/repo",
      CASCADE_CHANGES: "env-ch1",
      CASCADE_ENGINE: "opencode",
      CASCADE_MODEL: "env-model",
      CASCADE_EFFORT: "low",
    };

    const argv = [
      "--repo",
      "/cli/repo",
      "--changes",
      "cli-ch1,cli-ch2",
      "--engine",
      "antigravity",
      "--model",
      "cli-model",
      "--effort",
      "high",
      "--allow-dirty",
    ];

    const config = loadConfig({ argv, env, cwd: "/mock/repo" });

    expect(config.repo).toBe("/cli/repo");
    expect(config.changes).toEqual(["cli-ch1", "cli-ch2"]);
    expect(config.engine).toBe("antigravity");
    expect(config.model).toBe("cli-model");
    expect(config.effort).toBe("high");
    expect(config.allowDirty).toBe(true);
  });

  test("Explicit overrides take precedence over both CLI and environment", () => {
    const env = { CASCADE_ENGINE: "claude" };
    const argv = ["--engine", "opencode"];
    const overrides = { engine: "antigravity" as const, maxAttemptsPerTask: 10 };

    const config = loadConfig({ argv, env, overrides });
    expect(config.engine).toBe("antigravity");
    expect(config.maxAttemptsPerTask).toBe(10);
  });

  test("handles --no-keep-alive flag correctly", () => {
    const config = loadConfig({ argv: ["--no-keep-alive"], env: {}, cwd: "/mock/repo" });
    expect(config.keepAlive).toBe(false);
  });

  test("handles rollback configuration and CLI flags", () => {
    const def = loadConfig({ argv: [], env: {}, cwd: "/mock/repo" });
    expect(def.rollbackOnFailure).toBe(true);

    const disabled = loadConfig({ argv: ["--no-rollback"], env: {}, cwd: "/mock/repo" });
    expect(disabled.rollbackOnFailure).toBe(false);

    const enabled = loadConfig({ argv: ["--rollback"], env: {}, cwd: "/mock/repo" });
    expect(enabled.rollbackOnFailure).toBe(true);

    const envDisabled = loadConfig({ argv: [], env: { CASCADE_ROLLBACK_ON_FAILURE: "false" } });
    expect(envDisabled.rollbackOnFailure).toBe(false);

    const envGitRollback = loadConfig({ argv: [], env: { CASCADE_GIT_ROLLBACK: "true" } });
    expect(envGitRollback.rollbackOnFailure).toBe(true);
  });

  test("handles 24/7 resilience configuration and CLI flags", () => {
    const def = loadConfig({ argv: [], env: {}, cwd: "/mock/repo" });
    expect(def.resilient).toBe(false);

    const flagResilient = loadConfig({ argv: ["--resilient"], env: {}, cwd: "/mock/repo" });
    expect(flagResilient.resilient).toBe(true);

    const flagContinue = loadConfig({ argv: ["--continue-on-failure"], env: {}, cwd: "/mock/repo" });
    expect(flagContinue.resilient).toBe(true);

    const envResilient = loadConfig({ argv: [], env: { CASCADE_RESILIENT: "true" } });
    expect(envResilient.resilient).toBe(true);

    const envContinue = loadConfig({ argv: [], env: { CASCADE_CONTINUE_ON_FAILURE: "true" } });
    expect(envContinue.resilient).toBe(true);
  });

  test("getDefaultConfig returns defaults for current cwd", () => {
    const def = getDefaultConfig("/mock/cwd");
    expect(def.repo).toBe("/mock/cwd");
    expect(def.engine).toBe("claude");
    expect(def.changes).toEqual([]);
    expect(def.keepAlive).toBe(true);
  });
});

describe("CONSTANTS integrity", () => {
  test("defines all required zero-magic-number constants", () => {
    expect(CONSTANTS.USAGE_LIMIT_PERCENT).toBe(95);
    expect(CONSTANTS.MAX_ATTEMPTS_PER_TASK).toBe(3);
    expect(CONSTANTS.MAX_TURNS_PER_SESSION).toBe(60);
    expect(CONSTANTS.MAX_BUDGET_PER_SESSION_USD).toBe(10);
    expect(CONSTANTS.MAX_TOTAL_BUDGET_USD).toBe(150);
    expect(CONSTANTS.EXIT_CODE_SUCCESS).toBe(0);
    expect(CONSTANTS.EXIT_CODE_ERROR).toBe(1);
    expect(CONSTANTS.EXIT_CODE_FATAL).toBe(2);
    expect(CONSTANTS.ONE_LINE_MAX_LENGTH).toBe(140);
    expect(CONSTANTS.TOOL_INPUT_MAX_LENGTH).toBe(100);
    expect(CONSTANTS.TOKEN_PRICE_BASE).toBe(1_000_000);
    expect(CONSTANTS.DECIMAL_PLACES_USD).toBe(2);
    expect(CONSTANTS.ARGV_START_INDEX).toBe(2);
    expect(CONSTANTS.GRAPHIFY_COMMAND).toBe("graphify update .");
    expect(CONSTANTS.ARCHIFY_ACTION).toBe("deliver");
    expect(CONSTANTS.ARCHIFY_DEFAULT_QUALITY).toBe("showcase");
    expect(CONSTANTS.ARCHIFY_DIR_NAME).toBe(".archify");
    expect(CONSTANTS.ARCHIFY_CANDIDATE_JSON).toBe("candidate.json");
    expect(CONSTANTS.ARCHIFY_CANDIDATE_MD).toBe("candidate.archify.md");
    expect(CONSTANTS.ARCHIFY_DEFAULT_TYPE).toBe("architecture");
    expect(CONSTANTS.ARCHIFY_EXPLAINER_TYPE).toBe("explainer");
    expect(CONSTANTS.ARCHIFY_FALLBACK_EXT).toBe(".html");
    expect(CONSTANTS.DIAGRAM_SYNC_TIMEOUT_MS).toBe(300_000);
    expect(CONSTANTS.GIT_RESET_CMD).toBe("git reset --hard");
    expect(CONSTANTS.GIT_CLEAN_CMD).toBe("git clean -fd");
    expect(CONSTANTS.GIT_HEAD_REF).toBe("HEAD");
    expect(CONSTANTS.ROLLBACK_ON_FAILURE).toBe(true);
    expect(CONSTANTS.RESILIENT_MODE).toBe(false);
  });
});
