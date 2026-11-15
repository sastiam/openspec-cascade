import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArchifyCommand, discoverArchifyTargets, syncDiagrams } from "../../../diagrams";
import { TaskCatalogGenerator } from "../../../src/integration/catalog_generator";
import { detectCatalogDrift } from "../../../src/integration/drift_detector";
import type { ProjectV2Item } from "../../../src/integration/github_project";
import { validateCatalogSchema, validateTaskSchema } from "../../../src/integration/schema_validator";
import { createMemoryStorage } from "../../../src/storage/memory";
import { SelfImprover } from "../../../src/core/self_improver";
import { runCascadeCli } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import { cleanupTempDir, createTempGitRepo } from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

function makeCompliantProjectItem(
  key: string,
  title: string,
  status: string,
): ProjectV2Item {
  return {
    id: `PVTI_${key}`,
    type: "ISSUE",
    status,
    priority: "P0",
    size: "M",
    content: {
      __typename: "Issue",
      id: `ISSUE_${key}`,
      number: 1,
      title: `[${key}] ${title}`,
      body: [
        "## 1. Propósito de la tarea",
        `Implementar ${title} de manera determinista.`,
        "",
        "## 2. Qué se espera lograr",
        `Modulo ${key} operativo y probado.`,
        "",
        "## 3. Goal de la tarea",
        `Completar ${key} sin stubs.`,
        "",
        "## 4. Criterios de completitud / Definition of Done",
        `- [ ] Verificar ${key} con bun test`,
        "",
      ].join("\n"),
      url: `https://github.com/sastiam/openspec-cascade/issues/${key}`,
    },
  };
}

describe("Tier 1 Features: F17–F20 Telemetry, Catalog Integration, Diagrams & Memory", () => {
  test("schema_validator, TaskCatalogGenerator, and drift_detector generate and verify catalogs", async () => {
    const outDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(outDir));

    const item1 = makeCompliantProjectItem("LOOPER-CORE-001", "DAG Scheduler", "Backlog");
    const item2 = makeCompliantProjectItem("LOOPER-GATE-001", "Gate0 Runner", "In progress");

    const singleValidation = validateTaskSchema(item1);
    expect(singleValidation.valid).toBe(true);
    expect(singleValidation.coveragePercentage).toBe(100);

    const generator = new TaskCatalogGenerator({
      outputDir: outDir,
      validateSchema: true,
    });
    const generated = await generator.generate([item1, item2]);
    expect(generated.totalTasks).toBe(2);
    expect(existsSync(generated.jsonPath)).toBe(true);
    expect(existsSync(generated.markdownPath)).toBe(true);

    const catalogReport = validateCatalogSchema(generated.items);
    expect(catalogReport.allCompliant).toBe(true);
    expect(catalogReport.complianceRate).toBe(100);

    const noDrift = detectCatalogDrift(generated.items, [item1, item2]);
    expect(noDrift.hasDrift).toBe(false);

    const updatedItem2 = makeCompliantProjectItem("LOOPER-GATE-001", "Gate0 Runner", "Done");
    const withDrift = detectCatalogDrift(generated.items, [item1, updatedItem2]);
    expect(withDrift.hasDrift).toBe(true);
    expect(withDrift.stats.modifiedCount).toBe(1);
  });

  test("diagrams discovers Archify targets, builds commands, and syncs via injected runner", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(sandbox));

    try {
      const archDir = join(sandbox, ".archify", "system-arch");
      mkdirSync(archDir, { recursive: true });

      writeFileSync(
        join(archDir, "candidate.json"),
        JSON.stringify({
          diagram_type: "flowchart",
          meta: {
            quality_profile: "showcase",
            output: "system-arch.svg",
          },
        }),
        "utf8",
      );

      const targets = discoverArchifyTargets(sandbox);
      expect(targets.length).toBe(1);
      expect(targets[0]?.name).toBe("system-arch");

      const cmd = buildArchifyCommand({
        bin: "/usr/local/bin/archify",
        action: "deliver",
        target: targets[0]!,
      });
      expect(cmd).toContain("/usr/local/bin/archify deliver flowchart");
      expect(cmd).toContain("--json");

      const executedCommands: string[] = [];
      const syncResult = await syncDiagrams({
        cwd: sandbox,
        archifyBin: "/usr/local/bin/archify",
        runner: async (command) => {
          executedCommands.push(command);
          return { code: 0, stdout: "ok", stderr: "", output: "ok" };
        },
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.graphify?.success).toBe(true);
      expect(syncResult.archify.length).toBe(1);
      expect(syncResult.archify[0]?.target).toBe("system-arch");
      expect(executedCommands.length).toBe(2);
    } finally {
      cleanupTempDir(sandbox);
    }
  });

  test("MemoryStorage initializes teamwork layout and performs atomic state persistence", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(baseDir));

    const storage = createMemoryStorage({ baseDir });
    await storage.initializeScaffolding();

    expect(existsSync(storage.getSentinelDir())).toBe(true);
    expect(existsSync(storage.getBriefingDir())).toBe(true);
    expect(existsSync(storage.getStateDir())).toBe(true);

    await storage.writeStateAtomic("e2e_run", { runId: "e2e-1", status: "ok" });
    const parsed = await storage.readState<{ runId: string; status: string }>("e2e_run");
    expect(parsed).not.toBeNull();
    expect(parsed?.runId).toBe("e2e-1");
    expect(parsed?.status).toBe("ok");
  });
  test(
    "cascade CLI doctor diagnoses a real repository and drift compares real catalog snapshots",
    async () => {
      const fixture = await createTempGitRepo({ branch: "feat/e2e-doctor" });
      cleanups.push(fixture.cleanup);
      mkdirSync(join(fixture.repoDir, "openspec"), { recursive: true });
      const doctor = await runCascadeCli({ args: ["doctor", "--repo", fixture.repoDir], homeDir: fixture.homeDir });
      expect(doctor.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(doctor.stdout).toContain("git: inside a work tree");
      const generator = new TaskCatalogGenerator();
      const item = (status: string): Record<string, unknown> => ({
        task_key: "E2E-001",
        taskId: "E2E-001",
        project_item_id: "item-1",
        githubProjectItemId: "item-1",
        title: "E2E-001: drift",
        workstream: "core",
        stream: "core",
        status,
        priority: "P1",
        size: "S",
        sections_present: [],
        url: "https://example.invalid/1",
        githubUrl: "https://example.invalid/1",
        sections: {},
        body: "",
      });
      const local = join(fixture.homeDir, "local.json");
      const remote = join(fixture.homeDir, "remote.json");
      writeFileSync(local, generator.formatJson(generator.normalizeItems([item("Todo")])));
      writeFileSync(remote, generator.formatJson(generator.normalizeItems([item("Done")])));
      const drift = await runCascadeCli({ args: ["drift", "--catalog", local, "--remote-json", remote], homeDir: fixture.homeDir });
      expect(drift.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_ERROR);
      const review = await runCascadeCli({ args: ["review"], homeDir: fixture.homeDir });
      expect(review.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(review.stderr).toContain("--base is required");
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test("SelfImprover persists redacted telemetry and derives directives from real history", () => {
    const dir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(dir));
    const improver = new SelfImprover({ rootDir: dir });
    for (const line of [3, 17]) {
      improver.recordOutcome({ source: "gate", outcome: "EVT_G0_RETRY", failureTrace: `src/x.ts(${line},2): error TS2304: Cannot find name 'y' token=ghp_abcdefghijklmnopqrstuvwxyz0123456789` });
    }
    const history = improver.loadHistory();
    expect(history).toHaveLength(2);
    expect(JSON.stringify(history)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(improver.deriveDirectives(history)[0]?.occurrences).toBe(2);
  });
});
