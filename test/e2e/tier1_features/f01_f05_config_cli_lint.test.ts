import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import {
  CONSTANTS,
  FULL_VERIFY,
  formatHelp,
  loadConfig,
  resolveLogDir,
} from "../../../config";
import { detectPackageManager, resolvePackageCommands } from "../../../platform";
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

describe("Tier 1 Features: F01–F05 Config, CLI, Package Manager & Lint", () => {
  test(
    "cascade CLI --help and -h print documented flags and exit 0",
    async () => {
      const helpLong = await runCascadeCli({ args: ["--help"] });
      expect(helpLong.timedOut).toBe(false);
      expect(helpLong.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(helpLong.stdout).toContain("--changes");
      expect(helpLong.stdout).toContain("--dry-run");
      expect(helpLong.stdout).toContain("--engine");
      expect(helpLong.stdout).toContain("--log-dir");

      const helpShort = await runCascadeCli({ args: ["-h"] });
      expect(helpShort.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(helpShort.stdout.trim()).toBe(formatHelp().trim());
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test(
    "cascade CLI --dry-run prints plan and usage on feature branch without creating logDir",
    async () => {
      const fixture = await createTempGitRepo({ branch: "feat/e2e-f01" });
      cleanups.push(fixture.cleanup);

      addOpenSpecChange(fixture.repoDir, "alpha-change", {
        tasksMarkdown: [
          "## 1. Core",
          "",
          "- [x] 1.1 Completed setup",
          "- [ ] 1.2 Implement feature handler",
          "- [ ] 1.3 Verify: `bun test`. Commit `feat(core)`",
          "",
        ].join("\n"),
      });

      const customLogDir = join(fixture.logDir, "nested-should-not-exist");
      const result = await runCascadeCli({
        args: [
          "--repo",
          fixture.repoDir,
          "--changes",
          "alpha-change",
          "--dry-run",
          "--no-keep-alive",
          "--log-dir",
          customLogDir,
        ],
        homeDir: fixture.homeDir,
        cwd: fixture.repoDir,
      });

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain("branch=feat/e2e-f01");
      expect(result.stdout).toContain("log=disabled (dry-run)");
      expect(result.stdout).toContain("alpha-change: 2 pending");
      expect(result.stdout).toContain("1.2");
      expect(result.stdout).toContain("1.3");
      expect(result.stdout).toContain("usage:");
      expect(existsSync(customLogDir)).toBe(false);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test("config CONSTANTS and FULL_VERIFY expose non-empty centralized defaults", () => {
    expect(CONSTANTS.EXIT_CODE_SUCCESS).toBe(0);
    expect(CONSTANTS.EXIT_CODE_ERROR).toBe(1);
    expect(CONSTANTS.EXIT_CODE_FATAL).toBe(2);
    expect(CONSTANTS.PROTECTED_BRANCHES).toContain("main");
    expect(CONSTANTS.PROTECTED_BRANCHES).toContain("master");
    expect(CONSTANTS.PROTECTED_BRANCHES).toContain("stable");
    expect(FULL_VERIFY.length).toBeGreaterThan(0);
  });

  test("loadConfig enforces precedence overrides > CLI > env > defaults", () => {
    const tempDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(tempDir));

    const fromEnv = loadConfig({
      argv: [],
      cwd: tempDir,
      env: {
        CASCADE_ENGINE: "opencode",
        CASCADE_EFFORT: "medium",
        CASCADE_MAX_TURNS: "42",
        CASCADE_DRY_RUN: "true",
      },
    });
    expect(fromEnv.engine).toBe("opencode");
    expect(fromEnv.effort).toBe("medium");
    expect(fromEnv.maxTurnsPerSession).toBe(42);
    expect(fromEnv.dryRun).toBe(true);

    const fromCli = loadConfig({
      argv: ["--engine", "agy", "--effort", "low", "--model", "gemini-2.5-pro"],
      cwd: tempDir,
      env: {
        CASCADE_ENGINE: "opencode",
        CASCADE_EFFORT: "medium",
      },
    });
    expect(fromCli.engine).toBe("antigravity");
    expect(fromCli.effort).toBe("low");
    expect(fromCli.model).toBe("gemini-2.5-pro");

    const fromOverrides = loadConfig({
      argv: ["--engine", "agy"],
      cwd: tempDir,
      env: { CASCADE_ENGINE: "opencode" },
      overrides: { engine: "claude", maxBudgetPerSessionUsd: 25 },
    });
    expect(fromOverrides.engine).toBe("claude");
    expect(fromOverrides.maxBudgetPerSessionUsd).toBe(25);
  });

  test("resolveLogDir handles explicit CLI option, env fallback, and default home path", () => {
    const baseHome = "/tmp/e2e-home";
    const baseRepo = "/tmp/my-app";
    const baseCwd = "/tmp/workdir";

    expect(
      resolveLogDir({
        option: "relative-logs",
        env: "/tmp/env-logs",
        repo: baseRepo,
        home: baseHome,
        cwd: baseCwd,
      }),
    ).toBe("/tmp/workdir/relative-logs");

    expect(
      resolveLogDir({
        env: "env-rel",
        repo: baseRepo,
        home: baseHome,
        cwd: baseCwd,
      }),
    ).toBe("/tmp/workdir/env-rel");

    expect(
      resolveLogDir({
        repo: baseRepo,
        home: baseHome,
        cwd: baseCwd,
      }),
    ).toBe("/tmp/e2e-home/.cache/openspec-cascade/logs/my-app");
  });

  test("detectPackageManager and resolvePackageCommands handle all lockfiles cleanly", () => {
    const cases: Array<{ lockfile: string; expectedPm: "pnpm" | "npm" | "yarn" | "bun" }> = [
      { lockfile: "pnpm-lock.yaml", expectedPm: "pnpm" },
      { lockfile: "package-lock.json", expectedPm: "npm" },
      { lockfile: "yarn.lock", expectedPm: "yarn" },
      { lockfile: "bun.lock", expectedPm: "bun" },
      { lockfile: "bun.lockb", expectedPm: "bun" },
    ];

    for (const item of cases) {
      const dir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
      try {
        writeFileSync(join(dir, item.lockfile), "# lock\n", "utf8");
        const detected = detectPackageManager(dir);
        expect(detected).toBe(item.expectedPm);

        const commands = resolvePackageCommands(detected);
        expect(commands.test).toContain(item.expectedPm);
        expect(commands.run("custom")).toContain(item.expectedPm);
      } finally {
        cleanupTempDir(dir);
      }
    }

    const emptyDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(emptyDir));
    expect(detectPackageManager(emptyDir)).toBe("npm");
  });

  test("eslint enforces zero magic numbers and explicit boundary types on E2E helpers", async () => {
    const eslint = new ESLint({ cwd: E2E_CONSTANTS.REPO_ROOT });
    const results = await eslint.lintFiles([
      "test/e2e/helpers/constants.ts",
      "test/e2e/helpers/cli_runner.ts",
      "test/e2e/helpers/temp_repo.ts",
      "config.ts",
    ]);

    const errorCount = results.reduce((sum, entry) => sum + entry.errorCount, 0);
    const warningCount = results.reduce((sum, entry) => sum + entry.warningCount, 0);

    expect(results.length).toBe(4);
    expect(errorCount).toBe(0);
    expect(warningCount).toBe(0);
  });
});
