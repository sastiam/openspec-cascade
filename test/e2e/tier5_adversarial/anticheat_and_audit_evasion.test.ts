import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditSource } from "../../../src/audit/forensic";
import { Gate3Auditor } from "../../../src/gates/gate3_audit";
import { cacheKey, GreptileCache, GreptileCacheError, sha256 } from "../../../src/integration/greptile/cache";
import { ShadowCommitManager } from "../../../src/integration/greptile/shadow";
import { verifyReviewFindings } from "../../../src/sdd/review_verifier";
import { E2E_CONSTANTS } from "../helpers/constants";
import { cleanupTempDir, createTempGitRepo, runGitCommand, type TempGitRepo } from "../helpers/temp_repo";

const repos: TempGitRepo[] = [];
const dirs: string[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
  while (dirs.length > 0) cleanupTempDir(dirs.pop() ?? "");
});

describe("Tier 5: forensic audit evasion", () => {
  test("aliased and namespaced mocks in E2E tests are still reported", () => {
    const source = [
      'import { mock as fake, spyOn as watch } from "bun:test";',
      'import { vi } from "vitest";',
      "fake(() => 1);",
      'fake.module("x", () => ({}));',
      'watch(console, "log");',
      "vi.fn();",
    ].join("\n");
    const stubs = auditSource("test/e2e/tier1_features/evasion.test.ts", source).filter((violation) => violation.rule === "e2e-stub");
    expect(stubs).toHaveLength(4);
  });

  test("comments smuggled after code or as block comments inside bodies are reported; string fixtures are not", () => {
    const source = [
      "export function f(): number {",
      "  const a = 1; /* explain */",
      "  const b = `// not a comment ${a}`;",
      "  return a + b.length; // trailing",
      "}",
    ].join("\n");
    expect(auditSource("src/x.ts", source).map((violation) => violation.line)).toEqual([2, 4]);
  });

  test("explicit any hidden in generics, assertions and parameters is reported", () => {
    const source = "export function g(x: Array<any>): Record<string, any> {\n  return x as unknown as any;\n}\n";
    expect(auditSource("src/y.ts", source).filter((violation) => violation.rule === "explicit-any")).toHaveLength(3);
  });
});

describe("Tier 5: Gate 3 anti-cheat on a real repository", () => {
  async function cheatingRepo(): Promise<{ fixture: TempGitRepo; baseline: string }> {
    const fixture = await createTempGitRepo({ branch: "feat/t5-cheat" });
    repos.push(fixture);
    const baseline = (await runGitCommand(fixture.repoDir, ["rev-parse", "HEAD"])).stdout;
    mkdirSync(join(fixture.repoDir, "src"), { recursive: true });
    mkdirSync(join(fixture.repoDir, "test"), { recursive: true });
    writeFileSync(join(fixture.repoDir, "src", "pay.ts"), 'export function pay(): number {\n  // TODO: implement\n  throw new Error("not implemented");\n}\n');
    writeFileSync(
      join(fixture.repoDir, "test", "pay.test.ts"),
      'import { expect, test } from "bun:test";\ntest.skip("pays", () => {});\ntest("works", () => {\n  expect(true).toBe(true);\n});\n',
    );
    return { fixture, baseline };
  }

  test("the complete working-tree diff exposes cheating in new untracked files to Gate 3", async () => {
    const { fixture, baseline } = await cheatingRepo();
    const naiveDiff = await runGitCommand(fixture.repoDir, ["diff", baseline]);
    expect(naiveDiff.stdout).toBe("");
    const workingTree = await new ShadowCommitManager().workingTreeDiff(fixture.repoDir, baseline);
    expect([...workingTree.files].sort()).toEqual(["src/pay.ts", "test/pay.test.ts"]);
    const result = await new Gate3Auditor({
      workspaceRoot: fixture.repoDir,
      repoRoot: fixture.repoDir,
      taskId: "T5-CHEAT",
      baselineSha: baseline,
      skipCleanRoomQa: true,
      autoRollbackOnVeto: false,
      autoCleanup: true,
      diff: workingTree.patch,
      targetFiles: workingTree.files,
    }).run();
    expect(result.veto).toBe(true);
    expect(result.recommendedEvent).toBe("EVT_G3_VETO");
    expect(result.structuredFeedback.violations.length).toBeGreaterThan(0);
    expect((await runGitCommand(fixture.repoDir, ["status", "--porcelain"])).stdout).toContain("?? src/");
  });
});

describe("Tier 5: stale-cache and cache-tampering bypass attempts", () => {
  test("sub-threshold review latency is rejected as a stale cache hit", () => {
    const verification = verifyReviewFindings({
      reviewFiles: ["src/a.ts"],
      branchDiffFiles: ["src/a.ts"],
      elapsedSeconds: 0.5,
      findings: [{ severity: "critical", file: "src/a.ts", message: "SQL injection" }],
    });
    expect(verification).toMatchObject({ valid: false, status: "stale", blockingFindingsCount: 0 });
  });

  test("a forged cache entry under the right file name but a wrong key is never served", () => {
    const root = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    dirs.push(root);
    const components = { baseSha: "base", diffHash: sha256("diff"), query: "__review__" };
    const open = new GreptileCache<{ verdict: string }>({ rootDir: root });
    open.set(components, { verdict: "genuine" });
    const forged = { version: 1, key: cacheKey({ ...components, query: "other" }), createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, value: { verdict: "forged-clean" } };
    writeFileSync(join(open.dir, `${cacheKey(components)}.json`), JSON.stringify(forged));
    expect(open.get(components)).toBeUndefined();
    expect(() => new GreptileCache<{ verdict: string }>({ rootDir: root, policy: "fail-closed" }).get(components)).toThrow(GreptileCacheError);
  });
});
