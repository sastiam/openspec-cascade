import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSTANTS, loadConfig, resolveLogDir } from "../../../config";
import { runCascadeCli, runNodeScript } from "../helpers/cli_runner";
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

describe("Tier 2 Boundaries: CLI & Config Invalid Inputs, Protected Branches, Dirty Trees & Timeouts", () => {
  test(
    "cascade CLI exits 2 when --changes is omitted or blank",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);

      const missing = await runCascadeCli({
        args: ["--repo", fixture.repoDir, "--dry-run", "--no-keep-alive"],
        homeDir: fixture.homeDir,
      });

      expect(missing.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(missing.stderr).toContain("--changes");

      const emptyCsv = await runCascadeCli({
        args: ["--repo", fixture.repoDir, "--changes", " , ", "--dry-run", "--no-keep-alive"],
        homeDir: fixture.homeDir,
      });
      expect(emptyCsv.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test(
    "cascade CLI exits 2 on unsupported --engine value (fail-closed validation)",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);

      const result = await runCascadeCli({
        args: [
          "--repo",
          fixture.repoDir,
          "--changes",
          "any-change",
          "--engine",
          "nonexistent-engine",
          "--dry-run",
        ],
        homeDir: fixture.homeDir,
      });

      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(result.stderr).toContain("--engine must be");
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test(
    "cascade CLI refuses mutating runs on protected branches (exit 2) while allowing --dry-run",
    async () => {
      for (const protectedBranch of E2E_CONSTANTS.PROTECTED_BRANCHES) {
        const fixture = await createTempGitRepo({ branch: protectedBranch });
        cleanups.push(fixture.cleanup);
        addOpenSpecChange(fixture.repoDir, "sample-change");

        const mutating = await runCascadeCli({
          args: [
            "--repo",
            fixture.repoDir,
            "--changes",
            "sample-change",
            "--no-keep-alive",
          ],
          homeDir: fixture.homeDir,
        });

        expect(mutating.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
        expect(mutating.stderr).toContain(`Refusing to run on protected branch "${protectedBranch}"`);

        const dryRun = await runCascadeCli({
          args: [
            "--repo",
            fixture.repoDir,
            "--changes",
            "sample-change",
            "--dry-run",
            "--no-keep-alive",
          ],
          homeDir: fixture.homeDir,
        });
        expect(dryRun.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
        expect(dryRun.stdout).toContain(`branch=${protectedBranch}`);
      }
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "cascade CLI blocks dirty working tree without --allow-dirty (exit 2) but tolerates neverCommit files",
    async () => {
      const dirtyFixture = await createTempGitRepo({
        dirtyFiles: { "uncommitted.txt": "dirty content\n" },
      });
      cleanups.push(dirtyFixture.cleanup);

      const blocked = await runCascadeCli({
        args: [
          "--repo",
          dirtyFixture.repoDir,
          "--changes",
          "sample-change",
          "--no-keep-alive",
        ],
        homeDir: dirtyFixture.homeDir,
      });

      expect(blocked.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(blocked.stderr).toContain("Working tree is dirty");

      const allowedByDryRun = await runCascadeCli({
        args: [
          "--repo",
          dirtyFixture.repoDir,
          "--changes",
          "sample-change",
          "--dry-run",
          "--no-keep-alive",
        ],
        homeDir: dirtyFixture.homeDir,
      });
      expect(allowedByDryRun.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(allowedByDryRun.stdout).toContain("Working tree is dirty");

      const neverCommitFixture = await createTempGitRepo({
        files: { ".claude/README.md": "tracked\n" },
        dirtyFiles: { ".claude/settings.local.json": "{}\n" },
      });
      cleanups.push(neverCommitFixture.cleanup);

      const ignoredDirty = await runCascadeCli({
        args: [
          "--repo",
          neverCommitFixture.repoDir,
          "--changes",
          "sample-change",
          "--dry-run",
          "--no-keep-alive",
        ],
        homeDir: neverCommitFixture.homeDir,
      });
      expect(ignoredDirty.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(ignoredDirty.stdout).not.toContain("Working tree is dirty");
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test("loadConfig falls back on blank env vars and fails closed on invalid numeric or boolean strings", () => {
    const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(sandbox));

    const blankFallback = loadConfig({
      argv: [],
      cwd: sandbox,
      env: {
        CASCADE_MAX_TURNS: "   ",
        CASCADE_MAX_BUDGET_USD: "",
        CASCADE_ALLOW_DIRTY: "0",
      },
    });

    expect(blankFallback.maxTurnsPerSession).toBe(CONSTANTS.MAX_TURNS_PER_SESSION);
    expect(blankFallback.maxBudgetPerSessionUsd).toBe(CONSTANTS.MAX_BUDGET_PER_SESSION_USD);
    expect(blankFallback.dryRun).toBe(false);
    expect(blankFallback.allowDirty).toBe(false);

    expect(() =>
      loadConfig({
        argv: [],
        cwd: sandbox,
        env: { CASCADE_MAX_TURNS: "not-a-number" },
      }),
    ).toThrow(/Invalid/i);

    expect(() =>
      loadConfig({
        argv: [],
        cwd: sandbox,
        env: { CASCADE_DRY_RUN: "maybe" },
      }),
    ).toThrow(/Invalid dryRun/i);
  });

  test("resolveLogDir falls back when option and env are whitespace only", () => {
    const resolved = resolveLogDir({
      option: "   ",
      env: "\t",
      repo: "/tmp/workspace/demo-repo",
      home: "/tmp/custom-home",
      cwd: "/tmp/cwd",
    });

    expect(resolved).toBe("/tmp/custom-home/.cache/openspec-cascade/logs/demo-repo");
  });

  test(
    "subprocess runner enforces timeout and kills runaway child processes cleanly",
    async () => {
      const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
      cleanups.push(() => cleanupTempDir(sandbox));

      const sleeperScript = join(sandbox, "sleep_forever.mjs");
      writeFileSync(sleeperScript, "setTimeout(() => {}, 60000);\n", "utf8");

      const res = await runNodeScript(sleeperScript, [], {
        cwd: sandbox,
        timeoutMs: 250,
      });

      expect(res.timedOut).toBe(true);
      expect(res.durationMs).toBeLessThan(E2E_CONSTANTS.SHORT_SUBPROCESS_TIMEOUT_MS);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );
});
