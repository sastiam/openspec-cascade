import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCascadeCli } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import {
  addOpenSpecChange,
  createTempGitRepo,
  runGitCommand,
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

describe("Tier 4 Scenarios: Full Dry-Run Cascade User Journey", () => {
  test(
    "multi-change dry-run journey prints pending/done/human-skip/verify/commit plan without side effects",
    async () => {
      const fixture = await createTempGitRepo({
        branch: "feat/journey-dry-run",
        files: { "src/app.ts": "export const initial = true;\n" },
      });
      cleanups.push(fixture.cleanup);

      addOpenSpecChange(fixture.repoDir, "change-alpha", {
        tasksMarkdown: [
          "## 1. Setup",
          "",
          "- [x] 1.1 Already done task",
          "- [ ] 1.2 Implement endpoint. HUMAN-SKIP: manual token rotation",
          "- [ ] 1.3 Verify: `bun test`. Commit `feat(api)`",
          "",
        ].join("\n"),
      });

      addOpenSpecChange(fixture.repoDir, "change-beta", {
        tasksMarkdown: [
          "## 1. Documentation",
          "",
          "- [ ] 1.1 Update architecture docs",
          "- [ ] 1.2 Add troubleshooting section",
          "",
        ].join("\n"),
      });

      const result = await runCascadeCli({
        args: [
          "--repo",
          fixture.repoDir,
          "--changes",
          "change-alpha,change-beta,change-missing",
          "--dry-run",
          "--no-keep-alive",
          "--log-dir",
          fixture.logDir,
        ],
        homeDir: fixture.homeDir,
      });

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain("change-alpha: 2 pending");
      expect(result.stdout).toContain("1.3 commit=feat(api) verify=[bun test]");
      const planLine = result.stdout.split("\n").find((line) => line.includes("1.3 commit=feat(api)"));
      expect(planLine).not.toContain("ignored=");
      expect(result.stdout).toContain("change-beta: 2 pending (one commit per section)");
      expect(result.stdout).toContain("change-missing: MISSING");
      expect(readFileSync(join(fixture.repoDir, "src/app.ts"), "utf8")).toBe(
        "export const initial = true;\n",
      );

      const gitHead = await runGitCommand(fixture.repoDir, ["rev-parse", "HEAD"]);
      expect(gitHead.stdout).toBe(fixture.initialSha);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test(
    "branch transition journey: mutating run fails on main (exit 2), succeeds after switching to feature branch",
    async () => {
      const fixture = await createTempGitRepo({ branch: "main" });
      cleanups.push(fixture.cleanup);
      addOpenSpecChange(fixture.repoDir, "branch-journey");

      const onMain = await runCascadeCli({
        args: [
          "--repo",
          fixture.repoDir,
          "--changes",
          "branch-journey",
          "--no-keep-alive",
        ],
        homeDir: fixture.homeDir,
      });
      expect(onMain.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(onMain.stderr).toContain('Refusing to run on protected branch "main"');

      await runGitCommand(fixture.repoDir, ["checkout", "-b", "feat/unblocked"]);

      const onFeature = await runCascadeCli({
        args: [
          "--repo",
          fixture.repoDir,
          "--changes",
          "branch-journey",
          "--dry-run",
          "--no-keep-alive",
        ],
        homeDir: fixture.homeDir,
      });
      expect(onFeature.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(onFeature.stdout).toContain("branch=feat/unblocked");
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "dirty working tree dry-run journey warns without mutating files or creating log artifacts",
    async () => {
      const fixture = await createTempGitRepo({
        files: { "tracked.txt": "before\n" },
      });
      cleanups.push(fixture.cleanup);
      addOpenSpecChange(fixture.repoDir, "dirty-dry-run");
      writeFileSync(join(fixture.repoDir, "tracked.txt"), "after\n", "utf8");

      const isolatedLogSubdir = join(fixture.logDir, "absent-log-subdir");
      const res = await runCascadeCli({
        args: [
          "--repo",
          fixture.repoDir,
          "--changes",
          "dirty-dry-run",
          "--dry-run",
          "--no-keep-alive",
          "--log-dir",
          isolatedLogSubdir,
        ],
        homeDir: fixture.homeDir,
      });

      expect(res.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(res.stdout).toContain("Working tree is dirty");
      expect(existsSync(isolatedLogSubdir)).toBe(false);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );
});
