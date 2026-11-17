import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, verifyCommands, type Task } from "../../cascade";
import { ConfigValidationError, loadConfig, parseCliArgs, VERIFY_CONSTANTS } from "../../config";
import { hasLockfile, isNuxtProject, tryDetectPackageManager } from "../../platform";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Layered Dynamic Stack Config Loader & Lazy CLI (F04)", () => {
  test("parseCliArgs enforces strict: true and throws ConfigValidationError on unknown flags", () => {
    expect(() => parseCliArgs(["--unknown-flag"])).toThrow(ConfigValidationError);

    const parsed = parseCliArgs([
      "--budget",
      "12.5",
      "--total-budget",
      "200",
      "--usage-limit",
      "80",
      "--max-turns",
      "40",
      "--max-attempts",
      "4",
      "--mode",
      "v2",
      "--config",
      "custom.json",
    ]);
    expect(parsed.options.budget).toBe("12.5");
    expect(parsed.options["total-budget"]).toBe("200");
    expect(parsed.options["usage-limit"]).toBe("80");
    expect(parsed.options["max-turns"]).toBe("40");
    expect(parsed.options["max-attempts"]).toBe("4");
    expect(parsed.options.mode).toBe("v2");
    expect(parsed.options.config).toBe("custom.json");
  });

  test("loadConfig enforces precedence overrides > CLI > env > .openspec-cascade.json > defaults", () => {
    const repoDir = makeTempDir("cascade-loader-prec-");
    writeFileSync(
      join(repoDir, ".openspec-cascade.json"),
      JSON.stringify({
        engine: "opencode",
        maxBudgetPerSessionUsd: 15,
        maxTurnsPerSession: 30,
        mode: "v2",
        sdd: { minKeywordLength: 4 },
      }),
    );

    const fromFile = loadConfig({ argv: [], env: {}, cwd: repoDir });
    expect(fromFile.engine).toBe("opencode");
    expect(fromFile.maxBudgetPerSessionUsd).toBe(15);
    expect(fromFile.maxTurnsPerSession).toBe(30);
    expect(fromFile.mode).toBe("v2");
    expect(fromFile.sdd.minKeywordLength).toBe(4);

    const fromEnv = loadConfig({
      argv: [],
      env: { CASCADE_ENGINE: "antigravity", CASCADE_MAX_BUDGET_USD: "20" },
      cwd: repoDir,
    });
    expect(fromEnv.engine).toBe("antigravity");
    expect(fromEnv.maxBudgetPerSessionUsd).toBe(20);
    expect(fromEnv.maxTurnsPerSession).toBe(30);

    const fromCli = loadConfig({
      argv: ["--engine", "claude", "--budget", "25"],
      env: { CASCADE_ENGINE: "antigravity", CASCADE_MAX_BUDGET_USD: "20" },
      cwd: repoDir,
    });
    expect(fromCli.engine).toBe("claude");
    expect(fromCli.maxBudgetPerSessionUsd).toBe(25);

    const fromOverrides = loadConfig({
      argv: ["--engine", "claude", "--budget", "25"],
      env: { CASCADE_ENGINE: "antigravity" },
      cwd: repoDir,
      overrides: { engine: "opencode", maxBudgetPerSessionUsd: 50 },
    });
    expect(fromOverrides.engine).toBe("opencode");
    expect(fromOverrides.maxBudgetPerSessionUsd).toBe(50);
  });

  test("loadConfig supports positional (argv, env) signature", () => {
    const cfg = loadConfig(["--engine", "agy", "--mode", "v2", "--budget", "8"], {});
    expect(cfg.engine).toBe("antigravity");
    expect(cfg.mode).toBe("v2");
    expect(cfg.maxBudgetPerSessionUsd).toBe(8);
  });

  test("loadConfig fails closed on invalid CLI inputs and malformed/missing config files", () => {
    const dir = makeTempDir("cascade-loader-fail-");

    expect(() => loadConfig({ argv: ["--budget", "-5"], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--budget", "abc"], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--budget", ""], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--usage-limit", "150"], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--max-turns", "0"], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--mode", "v99"], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--engine", "invalid"], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--config", "does-not-exist.json"], env: {}, cwd: dir })).toThrow(
      ConfigValidationError,
    );

    writeFileSync(join(dir, ".openspec-cascade.json"), "{ invalid json");
    expect(() => loadConfig({ argv: [], env: {}, cwd: dir })).toThrow(ConfigValidationError);

    writeFileSync(join(dir, ".openspec-cascade.json"), JSON.stringify({ unexpectedKey: 123 }));
    expect(() => loadConfig({ argv: [], env: {}, cwd: dir })).toThrow(ConfigValidationError);
  });

  test("detects stack dynamically from lockfile without Nuxt lock-in", () => {
    const pnpmDir = makeTempDir("cascade-pm-pnpm-");
    writeFileSync(join(pnpmDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    expect(hasLockfile(pnpmDir)).toBe(true);
    expect(tryDetectPackageManager(pnpmDir)).toBe("pnpm");
    expect(isNuxtProject(pnpmDir)).toBe(false);

    const pnpmCfg = loadConfig({ argv: [], env: {}, cwd: pnpmDir });
    expect(pnpmCfg.defaultVerify).toEqual(["pnpm test", "pnpm run lint"]);
    expect(pnpmCfg.fullVerify).toEqual(["pnpm run typecheck", "pnpm run lint", "pnpm test", "pnpm run build"]);

    const fullTask: Task = {
      id: "1.1",
      done: false,
      text: "Run full verification: `pnpm test`, `tsc --noEmit`",
      section: "1. Core",
      line: 1,
    };
    const cmds = verifyCommands(fullTask, false, { repoRoot: pnpmDir, config: pnpmCfg });
    expect(cmds).not.toContain("bunx nuxi prepare");
    expect(cmds).toContain("pnpm test");
    expect(cmds).toContain("pnpm run typecheck");

    const nuxtDir = makeTempDir("cascade-pm-nuxt-");
    writeFileSync(join(nuxtDir, "bun.lock"), "");
    writeFileSync(join(nuxtDir, "nuxt.config.ts"), "export default {}");
    expect(isNuxtProject(nuxtDir)).toBe(true);

    const nuxtCmds = verifyCommands(
      { id: "1.2", done: false, text: "Verify: `bunx tsc --noEmit`", section: "1. App", line: 2 },
      false,
      { repoRoot: nuxtDir },
    );
    expect(nuxtCmds).toContain("bunx nuxi prepare");
    expect(nuxtCmds).toContain("bunx tsc --noEmit -p .nuxt/tsconfig.server.json");
  });

  test("runCli enforces fail-closed exit code 2 on invalid flags/values and 0 on --help", async () => {
    expect(await runCli(["--help"], {})).toBe(0);
    expect(await runCli(["--unknown-flag"], {})).toBe(2);
    expect(await runCli(["--engine", "invalid"], {})).toBe(2);
    expect(await runCli(["--budget", "-5"], {})).toBe(2);
    expect(await runCli(["--budget", "abc"], {})).toBe(2);
  });

  test("resolves logDir in strict precedence overrides > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default", () => {
    const repoDir = makeTempDir("cascade-logdir-prec-");
    writeFileSync(
      join(repoDir, ".openspec-cascade.json"),
      JSON.stringify({ logDir: "/file/logs" }),
    );

    expect(loadConfig({ argv: [], env: {}, cwd: repoDir }).logDir).toBe("/file/logs");
    expect(loadConfig({ argv: [], env: { CASCADE_LOG_DIR: "   " }, cwd: repoDir }).logDir).toBe("/file/logs");
    expect(loadConfig({ argv: [], env: { CASCADE_LOG_DIR: "/env/logs" }, cwd: repoDir }).logDir).toBe("/env/logs");
    expect(
      loadConfig({ argv: ["--log-dir", "/cli/logs"], env: { CASCADE_LOG_DIR: "/env/logs" }, cwd: repoDir }).logDir,
    ).toBe("/cli/logs");
    expect(
      loadConfig({
        argv: ["--log-dir", "/cli/logs"],
        env: { CASCADE_LOG_DIR: "/env/logs" },
        cwd: repoDir,
        overrides: { logDir: "/override/logs" },
      }).logDir,
    ).toBe("/override/logs");
  });

  test("ignores blank CASCADE_CHANGES so .openspec-cascade.json changes are preserved", () => {
    const repoDir = makeTempDir("cascade-blank-changes-");
    writeFileSync(
      join(repoDir, ".openspec-cascade.json"),
      JSON.stringify({ changes: ["file-change-1", "file-change-2"] }),
    );

    expect(loadConfig({ argv: [], env: { CASCADE_CHANGES: "" }, cwd: repoDir }).changes).toEqual([
      "file-change-1",
      "file-change-2",
    ]);
    expect(loadConfig({ argv: [], env: { CASCADE_CHANGES: "   \t " }, cwd: repoDir }).changes).toEqual([
      "file-change-1",
      "file-change-2",
    ]);
    expect(loadConfig({ argv: [], env: { CASCADE_CHANGES: "env-a, env-b" }, cwd: repoDir }).changes).toEqual([
      "env-a",
      "env-b",
    ]);
  });

  test("rejects empty --repo, CASCADE_REPO, overrides.repo, and --log-dir before path normalization", () => {
    const dir = makeTempDir("cascade-empty-repo-");

    expect(() => loadConfig({ argv: ["--repo", ""], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--repo", "   "], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: [], env: { CASCADE_REPO: "" }, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: [], env: { CASCADE_REPO: "  " }, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: [], env: {}, cwd: dir, overrides: { repo: "" } })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: [], env: {}, cwd: dir, overrides: { repo: "   " } })).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig({ argv: ["--log-dir", ""], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: ["--log-dir", "   "], env: {}, cwd: dir })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ argv: [], env: {}, cwd: dir, overrides: { logDir: "" } })).toThrow(
      ConfigValidationError,
    );

    const cliWins = loadConfig({ argv: ["--repo", dir], env: { CASCADE_REPO: "" }, cwd: dir });
    expect(cliWins.repo).toBe(dir);
  });

  test("rejects fractional usageLimitPercent and exits 2 with zero logDir side effects in runCli", async () => {
    const repoDir = makeTempDir("cascade-cli-nosideeffects-");

    expect(() => loadConfig({ argv: ["--usage-limit", "1.5"], env: {}, cwd: repoDir })).toThrow(ConfigValidationError);
    expect(() =>
      loadConfig({ argv: [], env: { CASCADE_USAGE_LIMIT_PERCENT: "92.5" }, cwd: repoDir }),
    ).toThrow(ConfigValidationError);

    const logDirUsage = join(repoDir, "logs-usage-float");
    expect(
      await runCli(["--repo", repoDir, "--changes", "demo", "--usage-limit", "1.5", "--log-dir", logDirUsage], {}),
    ).toBe(2);
    expect(existsSync(logDirUsage)).toBe(false);

    const logDirEmptyRepo = join(repoDir, "logs-empty-repo");
    expect(await runCli(["--repo", "", "--changes", "demo", "--log-dir", logDirEmptyRepo], {})).toBe(2);
    expect(existsSync(logDirEmptyRepo)).toBe(false);

    const logDirEmptyEnvRepo = join(repoDir, "logs-empty-env-repo");
    expect(await runCli(["--changes", "demo", "--log-dir", logDirEmptyEnvRepo], { CASCADE_REPO: "" })).toBe(2);
    expect(existsSync(logDirEmptyEnvRepo)).toBe(false);

    expect(await runCli(["--repo", repoDir, "--changes", "demo", "--log-dir", ""], {})).toBe(2);
  });
});

describe("alwaysVerify", () => {
  function writeConfigFile(dir: string, content: Record<string, unknown>): void {
    writeFileSync(join(dir, ".openspec-cascade.json"), JSON.stringify(content));
  }

  function loadFrom(dir: string) {
    return loadConfig({ argv: [], env: {}, cwd: dir });
  }

  function thrownMessage(action: () => unknown): string {
    try {
      action();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      return (error as Error).message;
    }
    throw new Error("expected loading to throw");
  }

  test("defaults to an empty list when the key is absent", () => {
    const dir = makeTempDir("cascade-always-absent-");
    writeConfigFile(dir, { engine: "claude" });
    expect(loadFrom(dir).alwaysVerify).toEqual([]);
  });

  test("loads a valid list exactly, in order", () => {
    const dir = makeTempDir("cascade-always-valid-");
    writeConfigFile(dir, { alwaysVerify: ["bun run arch:check", "bun test"] });
    expect(loadFrom(dir).alwaysVerify).toEqual(["bun run arch:check", "bun test"]);
  });

  test("rejects an unsafe command in the config file and names it", () => {
    const dir = makeTempDir("cascade-always-unsafe-file-");
    writeConfigFile(dir, { alwaysVerify: ["bun run arch:check", "bun run lint && rm -rf dist"] });
    expect(thrownMessage(() => loadFrom(dir))).toContain("bun run lint && rm -rf dist");
  });

  test("rejects an unsafe command in overrides and names it", () => {
    const dir = makeTempDir("cascade-always-unsafe-overrides-");
    const message = thrownMessage(() =>
      loadConfig({ argv: [], env: {}, cwd: dir, overrides: { alwaysVerify: ["bun test | tee out.txt"] } }),
    );
    expect(message).toContain("bun test | tee out.txt");
  });

  test("warns once in v2 mode when alwaysVerify is not empty", () => {
    const dir = makeTempDir("cascade-always-v2-");
    writeConfigFile(dir, { mode: "v2", alwaysVerify: ["bun run arch:check"] });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const config = loadFrom(dir);
      expect(config.alwaysVerify).toEqual(["bun run arch:check"]);
      expect(warn).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0]?.[0]);
      expect(text).toBe(VERIFY_CONSTANTS.ALWAYS_VERIFY_V2_WARNING);
      expect(text).toContain("alwaysVerify");
      expect(text).toContain("v2");
    } finally {
      warn.mockRestore();
    }
  });

  test("does not warn in v1 mode", () => {
    const dir = makeTempDir("cascade-always-v1-");
    writeConfigFile(dir, { mode: "v1", alwaysVerify: ["bun run arch:check"] });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(loadFrom(dir).alwaysVerify).toEqual(["bun run arch:check"]);
      expect(warn).toHaveBeenCalledTimes(0);
    } finally {
      warn.mockRestore();
    }
  });
});
