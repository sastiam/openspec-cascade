import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RollbackStateBuffer } from "../../../src/engine/rollback_buffer";
import { Gate0MechanicalRunner, GATE0_CONSTANTS } from "../../../src/gates/gate0_qa";
import { Gate1Reviewer } from "../../../src/gates/gate1_review";
import {
  scanDiffForCleanCode,
  scanDiffForMagicNumbers,
} from "../../../src/gates/gate1_rubric";
import { Gate2EdgeCaseSynthesizer } from "../../../src/gates/gate2_synthesis";
import { Gate3AntiCheatScanner } from "../../../src/gates/gate3_scanner";
import { ProtectedSectionError, createMemoryStorage } from "../../../src/storage/memory";
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

describe("Tier 2 Boundaries: Rollback Buffer, Gates 0–3 Violations & Protected Memory", () => {
  test("RollbackStateBuffer reverts dirty code changes while preserving .agents/teamwork/ and logs/", async () => {
    const fixture = await createTempGitRepo({
      files: { "src/app.ts": "export const version = 1;\n" },
    });
    cleanups.push(fixture.cleanup);

    const teamworkDir = join(fixture.repoDir, ".agents", "teamwork");
    const logsDir = join(fixture.repoDir, "logs");
    mkdirSync(teamworkDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
    const handoffPath = join(teamworkDir, "handoff.md");
    const auditLogPath = join(logsDir, "audit.jsonl");
    writeFileSync(handoffPath, "# Preserved Handoff\n", "utf8");
    writeFileSync(auditLogPath, '{"event":"start"}\n', "utf8");

    const buffer = new RollbackStateBuffer({
      cwd: fixture.repoDir,
      auditLogDir: logsDir,
    });
    buffer.registerAuditLog(auditLogPath);

    const sha = await buffer.snapshot();
    expect(sha).toBe(fixture.initialSha);

    writeFileSync(join(fixture.repoDir, "src/app.ts"), "export const version = 999;\n", "utf8");
    writeFileSync(join(fixture.repoDir, "src/untracked.ts"), "export const bad = 1;\n", "utf8");
    expect(await buffer.isDirty()).toBe(true);

    const rollbackResult = await buffer.rollback(sha, { reason: "boundary test failure" });
    expect(rollbackResult.success).toBe(true);
    expect(readFileSync(join(fixture.repoDir, "src/app.ts"), "utf8")).toBe(
      "export const version = 1;\n",
    );
    expect(existsSync(join(fixture.repoDir, "src/untracked.ts"))).toBe(false);
    expect(existsSync(handoffPath)).toBe(true);
    expect(existsSync(auditLogPath)).toBe(true);
  });

  test("RollbackStateBuffer.commit creates a real git commit and advances HEAD", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    const buffer = new RollbackStateBuffer({ cwd: fixture.repoDir });
    const baseSha = await buffer.snapshot();

    writeFileSync(join(fixture.repoDir, "feature.ts"), "export const ok = true;\n", "utf8");
    const commitRes = await buffer.commit("feat(e2e): commit via rollback buffer");
    expect(commitRes.success).toBe(true);
    expect(commitRes.commitSha).toBeDefined();
    expect(commitRes.commitSha).not.toBe(baseSha);

    const headCheck = await runGitCommand(fixture.repoDir, ["rev-parse", "HEAD"]);
    expect(headCheck.stdout).toBe(commitRes.commitSha!);
  });

  test("Gate0MechanicalRunner detects failing commands and forbidden .ts files in .agents/teamwork/", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    const badMetadataDir = join(fixture.repoDir, ".agents", "teamwork");
    mkdirSync(badMetadataDir, { recursive: true });
    writeFileSync(join(badMetadataDir, "forbidden.ts"), "export const leak = 1;\n", "utf8");

    const runner = new Gate0MechanicalRunner({
      repoRoot: fixture.repoDir,
      cwd: fixture.repoDir,
      policy: GATE0_CONSTANTS.POLICY_FULL_GATE,
      commands: ["exit 1"],
      enableLayoutCheck: true,
    });

    const result = await runner.run();
    expect(result.success).toBe(false);
    expect(result.verdict).toBe(GATE0_CONSTANTS.VERDICT_FAILED);
    expect(result.layoutResult?.valid).toBe(false);
    expect(result.layoutResult?.violations.length).toBeGreaterThanOrEqual(1);
  });

  test("Gate1Reviewer and Gate1 rubric detect boundary containment, any, and magic numbers", () => {
    const fixturePath = "/tmp/gate1-boundary-check";
    const reviewer = new Gate1Reviewer({
      workspaceRoot: fixturePath,
      repoRoot: fixturePath,
      targetFiles: ["src/allowed.ts"],
    });

    const boundary = reviewer.verifyBoundaries(["src/allowed.ts", "src/unauthorized.ts"]);
    expect(boundary.passed).toBe(false);
    expect(boundary.unauthorizedFiles).toContain("src/unauthorized.ts");

    const dirtyDiff = [
      "diff --git a/src/sample.ts b/src/sample.ts",
      "--- a/src/sample.ts",
      "+++ b/src/sample.ts",
      "@@ -1,1 +1,4 @@",
      "+export function bad(input: any): number {",
      "+  return 4242;",
      "+}",
    ].join("\n");

    const cleanCodeFindings = scanDiffForCleanCode(dirtyDiff);
    expect(cleanCodeFindings.some((f) => f.category === "strict_typing")).toBe(true);

    const magicScan = scanDiffForMagicNumbers(dirtyDiff);
    expect(magicScan.findings.some((f) => f.category === "zero_magic_numbers")).toBe(true);
  });

  test("Gate2EdgeCaseSynthesizer synthesizes boundary probes from real module exports", async () => {
    const fixture = await createTempGitRepo({
      files: {
        "src/math.ts": [
          "export function clampScore(value: number, max: number): number {",
          "  if (!Number.isFinite(value)) return 0;",
          "  return Math.min(Math.max(0, value), max);",
          "}",
          "",
        ].join("\n"),
      },
    });
    cleanups.push(fixture.cleanup);

    const synthesizer = new Gate2EdgeCaseSynthesizer({
      workspaceRoot: fixture.repoDir,
      maxProbes: 8,
    });

    const probes = await synthesizer.synthesizeForFile("src/math.ts");
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.some((p) => p.vector === "boundary_malformed")).toBe(true);
  });

  test("Gate3AntiCheatScanner flags .skip, .only, trivial assertions, stub returns, and prod mocks", async () => {
    const scanner = new Gate3AntiCheatScanner();

    const prodStub = await scanner.scanContent(
      'import { mock } from "bun:test";\nexport function run(): unknown { return null as any; // stub\n}\n',
      "src/adapter.ts",
    );
    expect(prodStub.passed).toBe(false);
    expect(prodStub.violations.length).toBeGreaterThanOrEqual(2);

    const badTest = await scanner.scanContent(
      'test.skip("evaded", () => { expect(true).toBe(true); });\n',
      "test/sample.test.ts",
    );
    expect(badTest.passed).toBe(false);
    expect(badTest.violations.some((v) => v.ruleId === "AC-010-DISABLED-TEST-SKIP")).toBe(true);
  });

  test("MemoryStorage writeBriefing throws ProtectedSectionError when identity section is removed", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    const storage = createMemoryStorage({ baseDir: join(fixture.repoDir, ".agents", "teamwork") });
    await storage.initializeScaffolding();
    await storage.scaffoldAgentWorkspace("agent-e2e", {
      initialBriefing: [
        "# Agent Briefing",
        "",
        "## 🔒 My Identity",
        "- Agent ID: agent-e2e",
        "",
        "## 🔒 Key Constraints",
        "- Stay isolated",
        "",
      ].join("\n"),
    });

    let caughtError: unknown;
    try {
      await storage.writeBriefing("agent-e2e", "# Overwritten without protected sections\n");
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ProtectedSectionError);
  });
});
