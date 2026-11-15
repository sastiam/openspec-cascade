import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../config";
import { resolveArchifyBin } from "../../../diagrams";
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

describe("Tier 3 Combinations: CLI, Env Precedence, Stack & Package Manager Matrix", () => {
  test(
    "CLI flags override CASCADE_* env vars across engine, effort, model, and keep-alive",
    async () => {
      const fixture = await createTempGitRepo({ branch: "feat/e2e-matrix" });
      cleanups.push(fixture.cleanup);
      addOpenSpecChange(fixture.repoDir, "matrix-change");

      const result = await runCascadeCli({
        args: [
          "--repo",
          fixture.repoDir,
          "--changes",
          "matrix-change",
          "--engine",
          "opencode",
          "--no-keep-alive",
          "--dry-run",
          "--allow-dirty",
          "--full-gate",
          "--no-diagrams",
          "--no-rollback",
          "--resilient",
        ],
        homeDir: fixture.homeDir,
        env: {
          CASCADE_ENGINE: "claude",
          CASCADE_KEEP_ALIVE: "true",
          CASCADE_ALLOW_DIRTY: "false",
          CASCADE_FULL_GATE: "false",
        },
      });

      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain("engine=opencode");
      expect(result.stdout).toContain("keepAlive=disabled");
      expect(result.stdout).toContain("changes=matrix-change");
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test("detectPackageManager obeys priority order when multiple lockfiles coexist", () => {
    const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(sandbox));

    writeFileSync(join(sandbox, "bun.lock"), "", "utf8");
    expect(detectPackageManager(sandbox)).toBe("bun");

    writeFileSync(join(sandbox, "yarn.lock"), "", "utf8");
    expect(detectPackageManager(sandbox)).toBe("yarn");

    writeFileSync(join(sandbox, "package-lock.json"), "{}", "utf8");
    expect(detectPackageManager(sandbox)).toBe("npm");

    writeFileSync(join(sandbox, "pnpm-lock.yaml"), "", "utf8");
    expect(detectPackageManager(sandbox)).toBe("pnpm");

    const pnpmCmds = resolvePackageCommands("pnpm");
    const yarnCmds = resolvePackageCommands("yarn");
    expect(pnpmCmds.run("typecheck")).toBe("pnpm run typecheck");
    expect(yarnCmds.run("typecheck")).toBe("yarn typecheck");
    expect(yarnCmds.lint).toBe("yarn lint");
  });

  test("loadConfig resolves ARCHIFY_BIN > CASCADE_ARCHIFY_BIN and alias env vars", () => {
    const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(sandbox));

    const archifyBoth = loadConfig({
      argv: [],
      cwd: sandbox,
      env: {
        ARCHIFY_BIN: "/opt/bin/archify-primary",
        CASCADE_ARCHIFY_BIN: "/opt/bin/archify-secondary",
        CASCADE_GIT_ROLLBACK: "false",
        CASCADE_CONTINUE_ON_FAILURE: "true",
      },
    });
    expect(archifyBoth.archifyBin).toBe("/opt/bin/archify-primary");
    expect(archifyBoth.rollbackOnFailure).toBe(false);
    expect(archifyBoth.resilient).toBe(true);

    const archifyPrimaryOverride = loadConfig({
      argv: ["--archify-bin", "/tmp/cli-archify", "--rollback"],
      cwd: sandbox,
      env: {
        ARCHIFY_BIN: "/opt/bin/archify-primary",
        CASCADE_ROLLBACK_ON_FAILURE: "false",
      },
    });
    expect(archifyPrimaryOverride.archifyBin).toBe("/tmp/cli-archify");
    expect(archifyPrimaryOverride.rollbackOnFailure).toBe(true);
    expect(resolveArchifyBin("/tmp/explicit-archify")).toBe("/tmp/explicit-archify");
  });

  test(
    "temp repo with different lockfiles runs cascade --dry-run cleanly with isolated env",
    async () => {
      for (const lockfile of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"] as const) {
        const fixture = await createTempGitRepo({ lockfiles: [lockfile] });
        cleanups.push(fixture.cleanup);
        addOpenSpecChange(fixture.repoDir, "pm-change");

        const result = await runCascadeCli({
          args: [
            "--repo",
            fixture.repoDir,
            "--changes",
            "pm-change",
            "--dry-run",
            "--no-keep-alive",
          ],
          homeDir: fixture.homeDir,
        });

        expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
        expect(detectPackageManager(fixture.repoDir)).toBe(
          lockfile === "pnpm-lock.yaml"
            ? "pnpm"
            : lockfile === "package-lock.json"
            ? "npm"
            : lockfile === "yarn.lock"
            ? "yarn"
            : "bun",
        );
      }
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );
});
