import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RollbackStateBuffer } from "../../../src/engine/rollback_buffer";
import { Gate3Auditor, GATE3_CONSTANTS } from "../../../src/gates/gate3_audit";
import { verifyReviewFindings } from "../../../src/sdd/review_verifier";
import { classifySurfaces } from "../../../src/sdd/surface_verifier";
import { createMemoryStorage } from "../../../src/storage/memory";
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

describe("Tier 4 Scenarios: Failure, Gate 3 Binary Veto, Rollback & Pre-PR Diff Journey", () => {
  test(
    "Gate 3 binary veto triggers atomic RollbackStateBuffer recovery while preserving teamwork metadata and logs",
    async () => {
      const fixture = await createTempGitRepo({
        files: {
          "src/service.ts": "export function runService(): string { return 'ok'; }\n",
        },
      });
      cleanups.push(fixture.cleanup);

      const teamworkDir = join(fixture.repoDir, ".agents", "teamwork");
      const storage = createMemoryStorage({ baseDir: teamworkDir });
      await storage.initializeScaffolding();
      await storage.scaffoldAgentWorkspace("worker_journey_1", {
        initialBriefing: "# Briefing\n\n## 🔒 My Identity\n- ID: worker_journey_1\n",
      });

      const logsDir = join(fixture.repoDir, "logs");
      mkdirSync(logsDir, { recursive: true });
      const auditJsonl = join(logsDir, "events.jsonl");
      writeFileSync(auditJsonl, '{"step":"snapshot"}\n', "utf8");

      const rollbackBuffer = new RollbackStateBuffer({
        cwd: fixture.repoDir,
        auditLogDir: logsDir,
      });
      rollbackBuffer.registerAuditLog(auditJsonl);
      const baselineSha = await rollbackBuffer.snapshot();

      writeFileSync(
        join(fixture.repoDir, "src/service.ts"),
        "export function runService(input: any): unknown { return null as any; // stub\n}\n",
        "utf8",
      );
      writeFileSync(join(fixture.repoDir, "src/orphan_tmp.ts"), "export const x = 1;\n", "utf8");

      const diffResult = await runGitCommand(fixture.repoDir, ["diff", "HEAD"]);
      const auditor = new Gate3Auditor({
        workspaceRoot: fixture.repoDir,
        repoRoot: fixture.repoDir,
        taskId: "JOURNEY-VETO-1",
        baselineSha,
        rollbackBuffer,
        autoRollbackOnVeto: true,
        skipCleanRoomQa: true,
        diff: diffResult.stdout,
      });

      const report = await auditor.runAudit({
        taskId: "JOURNEY-VETO-1",
        baselineSha,
        gitDiff: diffResult.stdout,
        targetFiles: ["src/service.ts"],
      });

      expect(report.verdict).toBe(GATE3_CONSTANTS.VERDICT_FAIL);
      expect(report.veto).toBe(true);

      const vetoOutcome = await auditor.executeVeto(report);
      expect(vetoOutcome.rollbackExecuted).toBe(true);

      expect(readFileSync(join(fixture.repoDir, "src/service.ts"), "utf8")).toBe(
        "export function runService(): string { return 'ok'; }\n",
      );
      expect(existsSync(join(fixture.repoDir, "src/orphan_tmp.ts"))).toBe(false);
      expect(existsSync(join(teamworkDir, "worker_journey_1", "BRIEFING.md"))).toBe(true);
      expect(existsSync(auditJsonl)).toBe(true);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );

  test("pre-PR merge-base diff + surface verification + review verification journey", async () => {
    const fixture = await createTempGitRepo({ branch: "main" });
    cleanups.push(fixture.cleanup);

    await runGitCommand(fixture.repoDir, ["checkout", "-b", "feat/pre-pr-journey"]);
    mkdirSync(join(fixture.repoDir, "src", "api"), { recursive: true });
    writeFileSync(
      join(fixture.repoDir, "src", "api", "health.ts"),
      "export function health(): string { return 'ok'; }\n",
      "utf8",
    );
    await runGitCommand(fixture.repoDir, ["add", "-A"]);
    await runGitCommand(fixture.repoDir, ["commit", "-m", "feat(api): add health endpoint"]);

    const base = await runGitCommand(fixture.repoDir, ["merge-base", "main", "HEAD"]);
    const diffOut = await runGitCommand(fixture.repoDir, [
      "diff",
      "--name-only",
      `${base.stdout}..HEAD`,
    ]);
    const branchFiles = diffOut.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const surfaceReport = classifySurfaces(branchFiles);
    expect(surfaceReport.surfaces.backend).toBe(true);
    expect(surfaceReport.recommendedChecks).toContain("sdd-verify:api-contract-smoke");

    const staleAttempt = verifyReviewFindings({
      reviewFiles: branchFiles,
      branchDiffFiles: branchFiles,
      elapsedSeconds: E2E_CONSTANTS.STALE_REVIEW_ELAPSED_SECONDS,
      findings: [],
    });
    expect(staleAttempt.valid).toBe(false);
    expect(staleAttempt.status).toBe("stale");

    const validAttempt = verifyReviewFindings({
      reviewFiles: branchFiles,
      branchDiffFiles: branchFiles,
      elapsedSeconds: E2E_CONSTANTS.DEFAULT_REVIEW_ELAPSED_SECONDS,
      findings: [
        {
          severity: "low",
          file: "src/api/health.ts",
          message: "Unused helper constant",
        },
      ],
    });
    expect(validAttempt.valid).toBe(true);
    expect(validAttempt.status).toBe("ok");
    expect(validAttempt.blockingFindingsCount).toBe(0);
  });
});
