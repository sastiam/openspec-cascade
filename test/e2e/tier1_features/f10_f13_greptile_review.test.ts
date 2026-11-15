import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  triageFinding,
  verifyReviewFindings,
} from "../../../src/sdd/review_verifier";
import { GREPTILE_CONSTANTS } from "../../../src/config/constants";
import {
  formatGreptileContext,
  GreptileCache,
  GreptileCliClient,
  GreptileReviewBridge,
  sha256,
  ShadowCommitManager,
} from "../../../src/integration/greptile";
import { E2E_CONSTANTS } from "../helpers/constants";
import { createTempGitRepo, runGitCommand } from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

describe("Tier 1 Features: F10–F13 Pre-PR Review Verification & Git Merge-Base Diff", () => {
  test("triageFinding classifies risky, mechanical, and advisory findings accurately", () => {
    const risky = triageFinding({
      severity: "critical",
      file: "src/auth.ts",
      line: 14,
      message: "SQL injection vulnerability in query builder",
    });
    expect(risky.tier).toBe("risky");
    expect(risky.severity).toBe("critical");

    const mechanical = triageFinding({
      severity: "low",
      file: "src/utils.ts",
      line: 3,
      message: "Unused import detected in module header",
    });
    expect(mechanical.tier).toBe("mechanical");
    expect(mechanical.severity).toBe("low");

    const advisory = triageFinding({
      severity: "medium",
      file: "src/service.ts",
      message: "Consider extracting helper for readability",
    });
    expect(advisory.tier).toBe("advisory");
    expect(advisory.severity).toBe("medium");
  });

  test("verifyReviewFindings passes valid non-stale diff and counts blocking findings", () => {
    const result = verifyReviewFindings({
      reviewFiles: ["src/auth.ts", "src/utils.ts"],
      branchDiffFiles: ["src/auth.ts", "src/utils.ts", "README.md"],
      elapsedSeconds: E2E_CONSTANTS.DEFAULT_REVIEW_ELAPSED_SECONDS,
      findings: [
        {
          severity: "high",
          file: "src/auth.ts",
          line: 22,
          message: "Missing null check before token parsing",
        },
        {
          severity: "low",
          file: "src/utils.ts",
          line: 8,
          message: "Unused variable in helper",
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.blockingFindingsCount).toBe(1);
    expect(result.triagedFindings.length).toBe(2);
  });

  test("verifyReviewFindings integrates with real git merge-base diff in temp repo", async () => {
    const fixture = await createTempGitRepo({ branch: "main" });
    cleanups.push(fixture.cleanup);

    await runGitCommand(fixture.repoDir, ["checkout", "-b", "feat/review-target"]);
    writeFileSync(join(fixture.repoDir, "src_feature.ts"), "export const v = 1;\n", "utf8");
    await runGitCommand(fixture.repoDir, ["add", "src_feature.ts"]);
    await runGitCommand(fixture.repoDir, ["commit", "-m", "feat: add feature file"]);

    const mergeBase = await runGitCommand(fixture.repoDir, ["merge-base", "main", "HEAD"]);
    expect(mergeBase.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

    const diffNames = await runGitCommand(fixture.repoDir, [
      "diff",
      "--name-only",
      `${mergeBase.stdout}..HEAD`,
    ]);
    expect(diffNames.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

    const branchDiffFiles = diffNames.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(branchDiffFiles).toContain("src_feature.ts");

    const verification = verifyReviewFindings({
      reviewFiles: ["src_feature.ts"],
      branchDiffFiles,
      elapsedSeconds: E2E_CONSTANTS.DEFAULT_REVIEW_ELAPSED_SECONDS,
      findings: [
        {
          severity: "low",
          file: "src_feature.ts",
          message: "Formatting nit on export line",
        },
      ],
    });

    expect(verification.valid).toBe(true);
    expect(verification.status).toBe("ok");
    expect(verification.blockingFindingsCount).toBe(0);
  });
  test("ShadowCommitManager reviews uncommitted work in a detached worktree with zero repository mutation", async () => {
    const fixture = await createTempGitRepo({ branch: "main" });
    cleanups.push(fixture.cleanup);
    await runGitCommand(fixture.repoDir, ["checkout", "-b", "feat/e2e-shadow"]);
    writeFileSync(join(fixture.repoDir, "feature.ts"), "export const feature = 1;\n");
    const stateBefore = await Promise.all(
      [["rev-parse", "HEAD"], ["status", "--porcelain"], ["for-each-ref"], ["worktree", "list"]].map(
        async (args) => (await runGitCommand(fixture.repoDir, args)).stdout,
      ),
    );
    const manager = new ShadowCommitManager();
    const diff = await manager.withShadowWorktree(fixture.repoDir, async (worktreePath, snapshot) => {
      expect((await runGitCommand(worktreePath, ["ls-files"])).stdout).toContain("feature.ts");
      return manager.branchDiff(fixture.repoDir, "main", snapshot.sha);
    });
    expect(diff.files).toEqual(["feature.ts"]);
    const stateAfter = await Promise.all(
      [["rev-parse", "HEAD"], ["status", "--porcelain"], ["for-each-ref"], ["worktree", "list"]].map(
        async (args) => (await runGitCommand(fixture.repoDir, args)).stdout,
      ),
    );
    expect(stateAfter).toEqual(stateBefore);
  });

  test("GreptileReviewBridge fails closed with not_installed when the Greptile CLI is absent", async () => {
    const fixture = await createTempGitRepo({ branch: "main" });
    cleanups.push(fixture.cleanup);
    await runGitCommand(fixture.repoDir, ["checkout", "-b", "feat/e2e-greptile"]);
    writeFileSync(join(fixture.repoDir, "change.ts"), "export const change = 1;\n");
    const client = new GreptileCliClient({ binary: join(fixture.homeDir, "missing-greptile") });
    expect(await client.checkStatus(fixture.repoDir)).toMatchObject({ installed: false, authenticated: false });
    await expect(
      new GreptileReviewBridge({ client }).review({ repoPath: fixture.repoDir, baseBranch: "main" }),
    ).rejects.toMatchObject({ kind: "not_installed" });
    expect((await runGitCommand(fixture.repoDir, ["worktree", "list"])).stdout.split("\n")).toHaveLength(1);
    expect((await runGitCommand(fixture.repoDir, ["for-each-ref", "refs/cascade"])).stdout).toBe("");
  });

  test("GreptileCache and formatGreptileContext persist and bound review context on disk", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const cache = new GreptileCache<{ context: string }>({ rootDir: fixtureDir });
    const findings = [{ file: "a.ts", line: 1, severity: "critical" as const, securityIssue: true, message: "SQL injection" }];
    const context = formatGreptileContext(findings, GREPTILE_CONSTANTS.DEFAULT_TOKEN_BUDGET);
    cache.set({ baseSha: "base", diffHash: sha256("patch"), query: "review" }, { context });
    expect(existsSync(join(fixtureDir, GREPTILE_CONSTANTS.DEFAULT_CACHE_DIR))).toBe(true);
    expect(cache.get({ baseSha: "base", diffHash: sha256("patch"), query: "review" })?.context).toContain("[critical] [security] a.ts:1");
  });
});
