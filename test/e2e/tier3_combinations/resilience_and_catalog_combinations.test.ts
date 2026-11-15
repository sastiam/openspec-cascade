import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerificationPhase } from "../../../qa";
import {
  createHandoffPayload,
  formatHandoffMarkdown,
  parseHandoffMarkdown,
  validateHandoffReport,
} from "../../../src/core/snapshot";
import { TaskCatalogGenerator } from "../../../src/integration/catalog_generator";
import { CatalogDriftError, assertNoDrift } from "../../../src/integration/drift_detector";
import type { ProjectV2Item } from "../../../src/integration/github_project";
import { SchemaValidationError } from "../../../src/integration/schema_validator";
import { createHeartbeatWatchdog, createMemoryStorage } from "../../../src/storage/memory";
import { E2E_CONSTANTS } from "../helpers/constants";
import { cleanupTempDir } from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

describe("Tier 3 Combinations: Resilience, Catalog Sync, Memory Watchdog & Handoff Snapshot", () => {
  test("TaskCatalogGenerator + SchemaValidator + assertNoDrift enforce strict compliance and drift detection", async () => {
    const outDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(outDir));

    const validItem: ProjectV2Item = {
      id: "PVTI_100",
      type: "ISSUE",
      status: "In progress",
      priority: "P0",
      size: "M",
      content: {
        __typename: "Issue",
        id: "ISSUE_100",
        number: 100,
        title: "[LOOPER-CORE-100] Resilience Integration",
        body: [
          "## 1. Propósito de la tarea",
          "Asegurar resiliencia integral.",
          "",
          "## 2. Qué se espera lograr",
          "Catalogo sincronizado y verificado.",
          "",
          "## 3. Goal de la tarea",
          "Mantener cero drift entre local y remoto.",
          "",
          "## 4. Criterios de completitud / Definition of Done",
          "- [ ] Ejecutar suite E2E sin errores",
          "",
        ].join("\n"),
        url: "https://github.com/sastiam/openspec-cascade/issues/100",
      },
    };

    const generator = new TaskCatalogGenerator({ outputDir: outDir, validateSchema: true });
    const generated = await generator.generate([validItem]);

    const cleanReport = assertNoDrift(generated.items, [validItem]);
    expect(cleanReport.hasDrift).toBe(false);

    const driftedRemote: ProjectV2Item = {
      ...validItem,
      priority: "P1",
    };
    expect(() => assertNoDrift(generated.items, [driftedRemote])).toThrow(CatalogDriftError);

    const invalidItem: ProjectV2Item = {
      ...validItem,
      id: "PVTI_101",
      content: {
        __typename: "Issue",
        id: "ISSUE_101",
        number: 101,
        title: "[LOOPER-CORE-101] Incomplete Task",
        body: "## 1. Propósito de la tarea\nSolo una seccion.\n",
        url: "https://github.com/sastiam/openspec-cascade/issues/101",
      },
    };
    await expect(generator.generate([invalidItem])).rejects.toThrow(SchemaValidationError);
  });

  test("MemoryStorage + HeartbeatWatchdog detect healthy vs stale agent progress files", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(baseDir));

    const storage = createMemoryStorage({ baseDir });
    await storage.initializeScaffolding();

    const nowIso = new Date().toISOString();
    await storage.scaffoldAgentWorkspace("worker-healthy", {
      initialProgress: `# Progress\n\nLast visited: ${nowIso}\nStatus: RUNNING\n`,
    });

    const staleIso = new Date(Date.now() - 1_200_000).toISOString();
    await storage.scaffoldAgentWorkspace("worker-stale", {
      initialProgress: `# Progress\n\nLast visited: ${staleIso}\nStatus: RUNNING\n`,
    });

    const watchdog = createHeartbeatWatchdog({
      baseDir,
      thresholdMs: 300_000,
    });

    const healthyInspection = await watchdog.checkAgent("worker-healthy");
    expect(healthyInspection.status).toBe("healthy");

    const staleInspection = await watchdog.checkAgent("worker-stale");
    expect(staleInspection.status).toBe("stale");
  });

  test("qa runVerificationPhase with stopOnFirstFailure=false aggregates multiple failing checks", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(sandbox));

    writeFileSync(join(sandbox, "marker.txt"), "ready\n", "utf8");

    const res = await runVerificationPhase({
      commands: ["echo ok", "false", "sh -c 'echo bad >&2; exit 2'"],
      cwd: sandbox,
      stopOnFirstFailure: false,
      timeoutMs: E2E_CONSTANTS.SHORT_SUBPROCESS_TIMEOUT_MS,
    });

    expect(res.success).toBe(false);
    expect(res.failures.length).toBe(2);
    expect(res.feedbackPrompt).toContain("<verification-feedback>");
    expect(res.feedbackPrompt).toContain('exit_code="2"');
  });

  test("snapshot createHandoffPayload + formatHandoffMarkdown + parseHandoffMarkdown round-trips cleanly", () => {
    const payload = createHandoffPayload({
      agentId: "worker_e2e_1",
      role: "worker",
      taskId: "E2E-SNAP-1",
      verdict: "COMPLETED",
      observation: "Observed clean module integration across gate layers.",
      logicChain: "Verified inputs -> executed checks -> confirmed outputs.",
      caveats: "Executed within isolated temp sandbox.",
      conclusion: "All checks passed deterministically.",
      verificationMethod: "bun test test/e2e exited 0.",
      modifiedFiles: ["src/core/fsm.ts"],
      testResults: {
        passed: true,
        command: "bun test test/e2e",
        exitCode: 0,
      },
    });

    const markdown = formatHandoffMarkdown(payload);
    const parsed = parseHandoffMarkdown(markdown);
    const validation = validateHandoffReport(parsed);

    expect(validation.valid).toBe(true);
    expect(parsed.agentId).toBe("worker_e2e_1");
    expect(parsed.taskId).toBe("E2E-SNAP-1");
    expect(parsed.modifiedFiles).toContain("src/core/fsm.ts");
  });
});
