/**
 * Unit Test Suite for Task Catalog Generator and Synchronization Engine.
 *
 * Implements LOOPER-INT-003 as part of the Provider-Agnostic Multi-Agent Looper
 * specification defined in `projects/agnostic_looper/SPECIFICATION.md` Section 6.4 & 6.5
 * and OpenSpec change `looper-integration-catalog-sync` Task 1.1.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CATALOG_CONSTANTS,
  CatalogGeneratorError,
  type CatalogMetadata,
  type CatalogTaskItem,
  type CatalogTaskSection,
  type CatalogValidationReport,
  SCHEMA_VALIDATOR_CONSTANTS,
  SchemaValidationError,
  TaskCatalogGenerator,
  TaskSchemaValidator,
  type TaskValidationOptions,
  type TaskValidationResult,
  WORKSTREAM_DEFINITIONS,
  assert100PercentCompliance,
  assertTask100PercentCompliance,
  atomicWriteFile,
  buildBodyFromSections,
  computeWorkstreamSummaries,
  extractTaskKey,
  formatCatalogJson,
  formatCatalogMarkdown,
  generateCatalogFiles,
  normalizeCatalogItem,
  parseTaskBodySections,
  readCatalogJson,
  readCatalogJsonSync,
  resolveWorkstream,
  sortCatalogItems,
  validateCatalogSchema,
  validateTaskSchema,
  writeCatalogJson,
  writeCatalogMarkdown,
  DRIFT_CONSTANTS,
  CatalogDriftError,
  CatalogDriftDetector,
  type CatalogDriftReport,
  type DriftAlert,
  type DriftAlertHandler,
  type DriftDetectionOptions,
  type DriftSeverity,
  type DriftSummaryStats,
  type DriftType,
  type FieldDriftDetail,
  type TaskChecklistState,
  type TaskDriftResult,
  assertNoDrift,
  compareTaskItems,
  detectCatalogDrift,
  dispatchDriftAlerts,
  extractTaskChecklist,
  formatAlertMessage,
  formatDriftMarkdownReport,
  formatDriftSummary,
  isSeverityEligible,
  normalizeTextForComparison,
  resolveDriftSeverity,
} from "../../src/integration/catalog_generator";
import type { GitHubProjectService, ProjectV2Item } from "../../src/integration/github_project";

describe("TaskCatalogGenerator (Task 1.1)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "catalog-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Constants, Workstream Definitions, and Error Hierarchy", () => {
    it("exposes expected default constants without magic numbers", () => {
      expect(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR).toBe("projects/agnostic_looper");
      expect(CATALOG_CONSTANTS.DEFAULT_JSON_FILE).toBe("tasks_catalog.json");
      expect(CATALOG_CONSTANTS.DEFAULT_MARKDOWN_FILE).toBe("tasks_catalog.md");
      expect(CATALOG_CONSTANTS.DEFAULT_PROJECT_TITLE).toBe("Spec Cascade Project #4");
      expect(CATALOG_CONSTANTS.DEFAULT_PROJECT_URL).toBe("https://github.com/users/sastiam/projects/4");
      expect(CATALOG_CONSTANTS.DEFAULT_PROJECT_NODE_ID).toBe("PVT_kwHOA0KY4s4Boie_");
      expect(CATALOG_CONSTANTS.DEFAULT_JSON_INDENT).toBe(2);
      expect(CATALOG_CONSTANTS.DEFAULT_STATUS).toBe("Backlog");
      expect(CATALOG_CONSTANTS.DEFAULT_PRIORITY).toBe("P1");
      expect(CATALOG_CONSTANTS.DEFAULT_SIZE).toBe("M");
      expect(CATALOG_CONSTANTS.PRIORITY_P0).toBe("P0");
      expect(CATALOG_CONSTANTS.PRIORITY_P1).toBe("P1");
      expect(CATALOG_CONSTANTS.MANDATORY_SECTIONS.length).toBe(4);
    });

    it("defines the 4 canonical workstreams with strictly ordered indices", () => {
      expect(WORKSTREAM_DEFINITIONS.length).toBe(4);
      expect(WORKSTREAM_DEFINITIONS[0]?.prefix).toBe("LOOPER-CORE");
      expect(WORKSTREAM_DEFINITIONS[0]?.index).toBe(1);
      expect(WORKSTREAM_DEFINITIONS[1]?.prefix).toBe("LOOPER-PAL");
      expect(WORKSTREAM_DEFINITIONS[1]?.index).toBe(2);
      expect(WORKSTREAM_DEFINITIONS[2]?.prefix).toBe("LOOPER-GATE");
      expect(WORKSTREAM_DEFINITIONS[2]?.index).toBe(3);
      expect(WORKSTREAM_DEFINITIONS[3]?.prefix).toBe("LOOPER-INT");
      expect(WORKSTREAM_DEFINITIONS[3]?.index).toBe(4);
    });

    it("instantiates CatalogGeneratorError with code and optional cause", () => {
      const causeErr = new Error("Disk full");
      const err = new CatalogGeneratorError("Failed to write", "FILE_WRITE_ERROR", causeErr);
      expect(err.name).toBe("CatalogGeneratorError");
      expect(err.message).toBe("Failed to write");
      expect(err.code).toBe("FILE_WRITE_ERROR");
      expect(err.cause).toBe(causeErr);
      expect(err instanceof Error).toBe(true);
    });
  });

  describe("Task Key Extraction and Workstream Resolution", () => {
    it("extracts task keys from titles correctly", () => {
      expect(
        extractTaskKey("[LOOPER-CORE-001] Máquina de Estados Finita (FSM) del Motor Central")
      ).toBe("LOOPER-CORE-001");
      expect(
        extractTaskKey("[LOOPER-PAL-002] Adaptador Claude")
      ).toBe("LOOPER-PAL-002");
      expect(
        extractTaskKey("[looper-gate-003] Adversarial Challenger")
      ).toBe("LOOPER-GATE-003");
      expect(
        extractTaskKey("[LOOPER-INT-004] Structural Verification Harness")
      ).toBe("LOOPER-INT-004");
    });

    it("returns UNKNOWN for missing, empty, or unkeyed titles", () => {
      expect(extractTaskKey("")).toBe("UNKNOWN");
      expect(extractTaskKey("Random Issue Without Task Key")).toBe("UNKNOWN");
    });

    it("resolves workstreams by task key prefix", () => {
      const core = resolveWorkstream("LOOPER-CORE-001");
      expect(core.name).toBe("Core Looper Engine & FSM Lifecycle");
      expect(core.streamTitle).toBe("Stream 1: Core Looper Engine & FSM Lifecycle");
      expect(core.index).toBe(1);

      const pal = resolveWorkstream("LOOPER-PAL-002");
      expect(pal.name).toBe("Provider Abstraction Layer (PAL) & Normalizers");
      expect(pal.streamTitle).toBe("Stream 2: Provider Abstraction Layer (PAL) & Normalizers");
      expect(pal.index).toBe(2);

      const gate = resolveWorkstream("LOOPER-GATE-003");
      expect(gate.name).toBe("Objective 4-Tier Verification Harness & Rollback Buffer");
      expect(gate.index).toBe(3);

      const int = resolveWorkstream("LOOPER-INT-004");
      expect(int.name).toBe("CLI, State Persistence & GitHub Project #4 Integration");
      expect(int.index).toBe(4);
    });

    it("supports custom overrides and falls back to General workstream for unknown keys", () => {
      const custom = resolveWorkstream("LOOPER-CUSTOM-001", {
        "LOOPER-CUSTOM-001": "Custom Stream",
      });
      expect(custom.name).toBe("Custom Stream");

      const unknown = resolveWorkstream("OTHER-TASK-999");
      expect(unknown.name).toBe("General");
      expect(unknown.index).toBe(CATALOG_CONSTANTS.STREAM_DEFAULT_INDEX);
    });
  });

  describe("Mandatory Spanish Sections Parsing and Body Synthesis", () => {
    const sampleBody = `## 1. Propósito de la tarea
Establecer el núcleo de orquestación determinista y control de ciclo de vida.

## 2. Qué se espera lograr
- Implementación de la FSM completa con estados canónicos.
- Bus de eventos interno fuertemente tipado.

## 3. Goal de la tarea
Construir y verificar src/engine/fsm.ts con cobertura exhaustiva.

## 4. Criterios de completitud / Definition of Done
- [ ] Módulo src/engine/fsm.ts implementado sin uso de any.
- [ ] Definición exhaustiva de la matriz de transición.
- [x] Suite de pruebas en Bun pasando con 100% de aserciones.`;

    it("extracts all 4 mandatory Spanish sections and marks them present", () => {
      const { sections, sectionsPresent } = parseTaskBodySections(sampleBody);
      expect(sectionsPresent).toEqual([
        "Propósito de la tarea",
        "Qué se espera lograr",
        "Goal de la tarea",
        "Criterios de completitud / Definition of Done",
      ]);
      expect(sections.proposito).toBe(
        "Establecer el núcleo de orquestación determinista y control de ciclo de vida."
      );
      expect(sections.queSeEsperaLograr).toContain("Implementación de la FSM");
      expect(sections.goal).toBe("Construir y verificar src/engine/fsm.ts con cobertura exhaustiva.");
      expect(sections.criteriosCompletitud).toEqual([
        "Módulo src/engine/fsm.ts implementado sin uso de any.",
        "Definición exhaustiva de la matriz de transición.",
        "Suite de pruebas en Bun pasando con 100% de aserciones.",
      ]);
    });

    it("tolerates accent variations and header level differences", () => {
      const altBody = `# 1. Proposito de la tarea
Proposito sin acento.

### 2. Que se espera lograr
Objetivo alcanzable.

**3. Goal de la tarea**
Meta clara.

## 4. Definition of Done
- Primer criterio
- Segundo criterio`;

      const { sections, sectionsPresent } = parseTaskBodySections(altBody);
      expect(sectionsPresent.length).toBe(4);
      expect(sections.proposito).toBe("Proposito sin acento.");
      expect(sections.queSeEsperaLograr).toBe("Objetivo alcanzable.");
      expect(sections.goal).toBe("Meta clara.");
      expect(sections.criteriosCompletitud).toEqual(["Primer criterio", "Segundo criterio"]);
    });

    it("synthesizes valid markdown body from structured sections", () => {
      const structured: CatalogTaskSection = {
        proposito: "Proposito estructurado",
        queSeEsperaLograr: "Logro planificado",
        goal: "Meta alcanzable",
        criteriosCompletitud: ["Criterio 1", "Criterio 2"],
      };

      const body = buildBodyFromSections(structured);
      expect(body).toContain("## 1. Propósito de la tarea\nProposito estructurado");
      expect(body).toContain("## 2. Qué se espera lograr\nLogro planificado");
      expect(body).toContain("## 3. Goal de la tarea\nMeta alcanzable");
      expect(body).toContain("## 4. Criterios de completitud / Definition of Done\n- [ ] Criterio 1\n- [ ] Criterio 2");

      const roundtrip = parseTaskBodySections(body);
      expect(roundtrip.sections.proposito).toBe(structured.proposito);
      expect(roundtrip.sections.criteriosCompletitud).toEqual(structured.criteriosCompletitud);
    });

    it("handles empty or non-string body gracefully", () => {
      const empty = parseTaskBodySections("");
      expect(empty.sections.proposito).toBe("");
      expect(empty.sections.criteriosCompletitud).toEqual([]);
      expect(empty.sectionsPresent).toEqual([]);
    });
  });

  describe("Item Normalization", () => {
    it("normalizes a ProjectV2Item from GraphQL response", () => {
      const rawItem: ProjectV2Item = {
        id: "PVTI_12345",
        type: "DRAFT_ISSUE",
        status: "Backlog",
        priority: "P0",
        size: "L",
        content: {
          __typename: "DraftIssue",
          title: "[LOOPER-CORE-001] Test Title",
          body: `## 1. Propósito de la tarea\nProp test\n\n## 2. Qué se espera lograr\nLogro test\n\n## 3. Goal de la tarea\nGoal test\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] Crit 1`,
        },
      };

      const normalized = normalizeCatalogItem(rawItem);
      expect(normalized.task_key).toBe("LOOPER-CORE-001");
      expect(normalized.taskId).toBe("LOOPER-CORE-001");
      expect(normalized.project_item_id).toBe("PVTI_12345");
      expect(normalized.githubProjectItemId).toBe("PVTI_12345");
      expect(normalized.title).toBe("[LOOPER-CORE-001] Test Title");
      expect(normalized.workstream).toBe("Core Looper Engine & FSM Lifecycle");
      expect(normalized.stream).toBe("Core Looper Engine & FSM Lifecycle");
      expect(normalized.status).toBe("Backlog");
      expect(normalized.priority).toBe("P0");
      expect(normalized.size).toBe("L");
      expect(normalized.sections.proposito).toBe("Prop test");
      expect(normalized.sections.criteriosCompletitud).toEqual(["Crit 1"]);
      expect(normalized.url).toBe(CATALOG_CONSTANTS.DEFAULT_PROJECT_URL);
    });

    it("preserves pre-existing sections when provided in raw item", () => {
      const prePopulated: Partial<CatalogTaskItem> = {
        task_key: "LOOPER-PAL-001",
        title: "[LOOPER-PAL-001] Canonical Model",
        sections: {
          proposito: "Existing proposito",
          queSeEsperaLograr: "Existing que se espera",
          goal: "Existing goal",
          criteriosCompletitud: ["Existing crit 1"],
        },
      };

      const normalized = normalizeCatalogItem(prePopulated);
      expect(normalized.sections.proposito).toBe("Existing proposito");
      expect(normalized.sections.criteriosCompletitud).toEqual(["Existing crit 1"]);
      expect(normalized.body).toContain("Existing proposito");
    });

    it("throws INVALID_ARGUMENT for non-object item", () => {
      expect(() => normalizeCatalogItem(null as unknown as ProjectV2Item)).toThrow(
        CatalogGeneratorError
      );
    });
  });

  describe("Formatting and Serialization", () => {
    const createSampleItems = (): CatalogTaskItem[] => [
      normalizeCatalogItem({
        id: "PVTI_001",
        title: "[LOOPER-CORE-001] Core Task 1",
        priority: "P0",
        size: "L",
        status: "Backlog",
        body: `## 1. Propósito de la tarea\nP1\n\n## 2. Qué se espera lograr\nQ1\n\n## 3. Goal de la tarea\nG1\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] C1`,
      }),
      normalizeCatalogItem({
        id: "PVTI_002",
        title: "[LOOPER-CORE-002] Core Task 2",
        priority: "P1",
        size: "M",
        status: "In progress",
        body: `## 1. Propósito de la tarea\nP2\n\n## 2. Qué se espera lograr\nQ2\n\n## 3. Goal de la tarea\nG2\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] C2`,
      }),
      normalizeCatalogItem({
        id: "PVTI_003",
        title: "[LOOPER-PAL-001] PAL Task 1",
        priority: "P0",
        size: "L",
        status: "Backlog",
        body: `## 1. Propósito de la tarea\nP3\n\n## 2. Qué se espera lograr\nQ3\n\n## 3. Goal de la tarea\nG3\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] C3`,
      }),
    ];

    it("formats valid JSON parsable into expected objects", () => {
      const items = createSampleItems();
      const jsonStr = formatCatalogJson(items);
      const parsed = JSON.parse(jsonStr);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      expect(parsed[0].task_key).toBe("LOOPER-CORE-001");
      expect(parsed[0].priority).toBe("P0");
      expect(parsed[0].sections.proposito).toBe("P1");
    });

    it("formats markdown containing all 3 required sections", () => {
      const items = createSampleItems();
      const metadata: CatalogMetadata = {
        targetProjectTitle: "Test Project",
        targetProjectUrl: "https://github.com/users/test/projects/1",
        projectNodeId: "PVT_TEST",
        totalTasks: items.length,
        generatedAt: "2026-10-24T12:00:00.000Z",
      };

      const md = formatCatalogMarkdown(items, metadata);

      // Header checks
      expect(md).toContain("# Catálogo de Tareas — Agnostic Multi-Agent Looper");
      expect(md).toContain("[Test Project](https://github.com/users/test/projects/1)");
      expect(md).toContain("`PVT_TEST`");
      expect(md).toContain("**Total Tareas**: 3");

      // Section 1 checks
      expect(md).toContain("## 1. Resumen Ejecutivo por Workstream");
      expect(md).toContain("| Stream 1: Core Looper Engine & FSM Lifecycle | 2 | 1 | 1 |");
      expect(md).toContain("| Stream 2: Provider Abstraction Layer (PAL) & Normalizers | 1 | 1 | 0 |");
      expect(md).toContain("| **Total** | **3** | **2** | **1** |");

      // Section 2 checks
      expect(md).toContain("## 2. Matriz General de Tareas en GitHub Project #4");
      expect(md).toContain("| `LOOPER-CORE-001` | [LOOPER-CORE-001] Core Task 1 | Core Looper Engine & FSM Lifecycle | **P0** | L | Backlog | [`PVTI_001`](https://github.com/users/test/projects/1) |");

      // Section 3 checks
      expect(md).toContain("## 3. Desglose Detallado de Tareas con Secciones Obligatorias");
      expect(md).toContain("### [LOOPER-CORE-001] Core Task 1");
      expect(md).toContain("- **Clave**: `LOOPER-CORE-001`");
      expect(md).toContain("- **Item Node ID**: `PVTI_001`");
      expect(md).toContain("## 1. Propósito de la tarea\nP1");
    });

    it("computes accurate workstream summaries", () => {
      const items = createSampleItems();
      const summaries = computeWorkstreamSummaries(items);

      const coreSummary = summaries.find((s) => s.streamTitle.includes("Core Looper"));
      expect(coreSummary?.totalTasks).toBe(2);
      expect(coreSummary?.priorityP0).toBe(1);
      expect(coreSummary?.priorityP1).toBe(1);

      const palSummary = summaries.find((s) => s.streamTitle.includes("PAL"));
      expect(palSummary?.totalTasks).toBe(1);
      expect(palSummary?.priorityP0).toBe(1);
      expect(palSummary?.priorityP1).toBe(0);
    });

    it("sorts items by workstream index and task key", () => {
      const unsorted: CatalogTaskItem[] = [
        normalizeCatalogItem({ id: "1", title: "[LOOPER-INT-001] Int Task" }),
        normalizeCatalogItem({ id: "2", title: "[LOOPER-CORE-002] Core Task 2" }),
        normalizeCatalogItem({ id: "3", title: "[LOOPER-CORE-001] Core Task 1" }),
      ];

      const sorted = sortCatalogItems(unsorted);
      expect(sorted[0]?.task_key).toBe("LOOPER-CORE-001");
      expect(sorted[1]?.task_key).toBe("LOOPER-CORE-002");
      expect(sorted[2]?.task_key).toBe("LOOPER-INT-001");
    });
  });

  describe("File I/O and Persistence", () => {
    it("writes and reads atomic catalog files", async () => {
      const filePath = join(tempDir, "test.txt");
      await atomicWriteFile(filePath, "Atomic Content");

      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe("Atomic Content");
    });

    it("generates both tasks_catalog.json and tasks_catalog.md in target directory", async () => {
      const items = [
        normalizeCatalogItem({
          id: "PVTI_TEST_1",
          title: "[LOOPER-CORE-001] Sample Core Task",
          status: "Backlog",
          priority: "P0",
          size: "L",
          body: `## 1. Propósito de la tarea\nProp\n\n## 2. Qué se espera lograr\nLogro\n\n## 3. Goal de la tarea\nGoal\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] Crit 1`,
        }),
      ];

      const result = await generateCatalogFiles(items, {
        outputDir: tempDir,
        jsonFilename: "tasks_catalog.json",
        markdownFilename: "tasks_catalog.md",
      });

      expect(existsSync(result.jsonPath)).toBe(true);
      expect(existsSync(result.markdownPath)).toBe(true);
      expect(result.totalTasks).toBe(1);

      const readBackAsync = await readCatalogJson(result.jsonPath);
      expect(readBackAsync.length).toBe(1);
      expect(readBackAsync[0]?.task_key).toBe("LOOPER-CORE-001");

      const readBackSync = readCatalogJsonSync(result.jsonPath);
      expect(readBackSync.length).toBe(1);
      expect(readBackSync[0]?.project_item_id).toBe("PVTI_TEST_1");
    });

    it("writes standalone json and markdown files using helpers", async () => {
      const items = [
        normalizeCatalogItem({ id: "PVTI_X", title: "[LOOPER-PAL-001] PAL Item" }),
      ];
      const jsonPath = join(tempDir, "custom.json");
      const mdPath = join(tempDir, "custom.md");

      await writeCatalogJson(jsonPath, items);
      await writeCatalogMarkdown(mdPath, items);

      expect(existsSync(jsonPath)).toBe(true);
      expect(existsSync(mdPath)).toBe(true);
    });

    it("throws FILE_READ_ERROR when reading non-existent file", async () => {
      expect(readCatalogJson(join(tempDir, "missing.json"))).rejects.toThrow(
        CatalogGeneratorError
      );
      expect(() => readCatalogJsonSync(join(tempDir, "missing.json"))).toThrow(
        CatalogGeneratorError
      );
    });
  });

  describe("TaskCatalogGenerator Service Operations", () => {
    it("instantiates with custom options and provides getOptions()", () => {
      const generator = new TaskCatalogGenerator({
        outputDir: tempDir,
        projectTitle: "Custom Project",
      });
      const opts = generator.getOptions();
      expect(opts.outputDir).toBe(tempDir);
      expect(opts.projectTitle).toBe("Custom Project");
    });

    it("generates catalog via TaskCatalogGenerator.generate", async () => {
      const generator = new TaskCatalogGenerator({ outputDir: tempDir });
      const items = [
        normalizeCatalogItem({ id: "PVTI_GEN", title: "[LOOPER-CORE-001] Generator Task" }),
      ];

      const result = await generator.generate(items);
      expect(result.items.length).toBe(1);
      expect(existsSync(result.jsonPath)).toBe(true);
      expect(existsSync(result.markdownPath)).toBe(true);
    });

    it("updates single task state and synchronizes both files", async () => {
      const generator = new TaskCatalogGenerator({ outputDir: tempDir });
      const items = [
        normalizeCatalogItem({
          id: "PVTI_UPDATE_1",
          title: "[LOOPER-CORE-001] Update Task",
          status: "Backlog",
          priority: "P0",
          size: "M",
          body: `## 1. Propósito de la tarea\nP\n\n## 2. Qué se espera lograr\nQ\n\n## 3. Goal de la tarea\nG\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] C`,
        }),
      ];
      await generator.generate(items);

      const updateResult = await generator.updateTaskState("LOOPER-CORE-001", {
        status: "Done",
        priority: "P1",
      });

      expect(updateResult.items[0]?.status).toBe("Done");
      expect(updateResult.items[0]?.priority).toBe("P1");

      const reloaded = await generator.loadCatalog();
      expect(reloaded[0]?.status).toBe("Done");
      expect(reloaded[0]?.priority).toBe("P1");
    });

    it("throws INVALID_ARGUMENT when updating non-existent task", async () => {
      const generator = new TaskCatalogGenerator({ outputDir: tempDir });
      await generator.generate([
        normalizeCatalogItem({ id: "1", title: "[LOOPER-CORE-001] Core 1" }),
      ]);

      expect(
        generator.updateTaskState("LOOPER-NONEXISTENT", { status: "Done" })
      ).rejects.toThrow("Task 'LOOPER-NONEXISTENT' not found in catalog");
    });

    it("merges remote items cleanly with syncItems", async () => {
      const generator = new TaskCatalogGenerator({ outputDir: tempDir });
      await generator.generate([
        normalizeCatalogItem({
          id: "PVTI_1",
          title: "[LOOPER-CORE-001] Initial Core 1",
          status: "Backlog",
        }),
      ]);

      const remoteItems: ProjectV2Item[] = [
        {
          id: "PVTI_1",
          type: "DRAFT_ISSUE",
          status: "In progress",
          priority: "P0",
          content: {
            __typename: "DraftIssue",
            title: "[LOOPER-CORE-001] Updated Core 1",
            body: `## 1. Propósito de la tarea\nP\n\n## 2. Qué se espera lograr\nQ\n\n## 3. Goal de la tarea\nG\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] C`,
          },
        },
        {
          id: "PVTI_2",
          type: "DRAFT_ISSUE",
          status: "Backlog",
          priority: "P1",
          content: {
            __typename: "DraftIssue",
            title: "[LOOPER-CORE-002] New Core 2",
            body: `## 1. Propósito de la tarea\nP\n\n## 2. Qué se espera lograr\nQ\n\n## 3. Goal de la tarea\nG\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] C`,
          },
        },
      ];

      const syncResult = await generator.syncItems(remoteItems);
      expect(syncResult.totalTasks).toBe(2);

      const task1 = syncResult.items.find((it) => it.task_key === "LOOPER-CORE-001");
      expect(task1?.status).toBe("In progress");

      const task2 = syncResult.items.find((it) => it.task_key === "LOOPER-CORE-002");
      expect(task2?.status).toBe("Backlog");
    });

    it("fetches items from GitHubProjectService in generateFromProject", async () => {
      const generator = new TaskCatalogGenerator({ outputDir: tempDir });

      const mockItems: ProjectV2Item[] = [
        {
          id: "PVTI_SERVICE_1",
          type: "DRAFT_ISSUE",
          status: "Backlog",
          priority: "P0",
          content: {
            __typename: "DraftIssue",
            title: "[LOOPER-GATE-001] Gate QA",
            body: `## 1. Propósito de la tarea\nP\n\n## 2. Qué se espera lograr\nQ\n\n## 3. Goal de la tarea\nG\n\n## 4. Criterios de completitud / Definition of Done\n- [ ] C`,
          },
        },
      ];

      const mockService = {
        getAllItems: async () => mockItems,
      } as unknown as GitHubProjectService;

      const result = await generator.generateFromProject(mockService);
      expect(result.totalTasks).toBe(1);
      expect(result.items[0]?.task_key).toBe("LOOPER-GATE-001");
    });

    it("throws PROJECT_FETCH_ERROR when GitHubProjectService fails", async () => {
      const generator = new TaskCatalogGenerator({ outputDir: tempDir });

      const failingService = {
        getAllItems: async () => {
          throw new Error("Network timeout");
        },
      } as unknown as GitHubProjectService;

      expect(generator.generateFromProject(failingService)).rejects.toThrow(
        CatalogGeneratorError
      );
    });
  });

  describe("Real Catalog Verification against projects/agnostic_looper/", () => {
    it("loads existing catalog tasks and asserts all 16 items match canonical structure", () => {
      const realCatalogPath = join(
        process.cwd(),
        CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
        CATALOG_CONSTANTS.DEFAULT_JSON_FILE
      );

      const items = readCatalogJsonSync(realCatalogPath);
      expect(items.length).toBe(16);

      for (const item of items) {
        expect(item.task_key).toMatch(/^LOOPER-(CORE|PAL|GATE|INT)-\d{3}$/);
        expect(item.taskId).toBe(item.task_key);
        expect(item.project_item_id).toMatch(/^PVTI_/);
        expect(item.title).toContain(item.task_key);
        expect(item.sections_present.length).toBe(4);
        expect(item.sections.proposito.length).toBeGreaterThan(0);
        expect(item.sections.queSeEsperaLograr.length).toBeGreaterThan(0);
        expect(item.sections.goal.length).toBeGreaterThan(0);
        expect(item.sections.criteriosCompletitud.length).toBeGreaterThan(0);
      }
    });

    it("verifies executive summary math matches 16 total tasks with 9 P0 and 7 P1", () => {
      const realCatalogPath = join(
        process.cwd(),
        CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
        CATALOG_CONSTANTS.DEFAULT_JSON_FILE
      );

      const items = readCatalogJsonSync(realCatalogPath);
      const summaries = computeWorkstreamSummaries(items);

      const totalP0 = summaries.reduce((acc, s) => acc + s.priorityP0, 0);
      const totalP1 = summaries.reduce((acc, s) => acc + s.priorityP1, 0);
      const totalTasks = summaries.reduce((acc, s) => acc + s.totalTasks, 0);

      expect(totalTasks).toBe(16);
      expect(totalP0).toBe(9);
      expect(totalP1).toBe(7);
    });
  });
});

describe("TaskSchemaValidator (Task 1.2)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "validator-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const validBody = `## 1. Propósito de la tarea
Establecer el núcleo de orquestación determinista y control de ciclo de vida.

## 2. Qué se espera lograr
- Implementación de la FSM completa con estados canónicos.
- Bus de eventos interno fuertemente tipado.

## 3. Goal de la tarea
Construir y verificar src/engine/fsm.ts con cobertura exhaustiva.

## 4. Criterios de completitud / Definition of Done
- [ ] Módulo src/engine/fsm.ts implementado sin uso de any.
- [x] Suite de pruebas en Bun pasando con 100% de aserciones.`;

    const createCompliantTask = (key = "LOOPER-CORE-001"): CatalogTaskItem =>
      normalizeCatalogItem({
        id: "PVTI_TEST_100",
        title: `[${key}] Canonical Compliant Task`,
        priority: "P0",
        size: "M",
        status: "Backlog",
        body: validBody,
      });

    describe("Constants and Error Hierarchy", () => {
      it("exposes expected schema validator constants with zero magic numbers", () => {
        expect(SCHEMA_VALIDATOR_CONSTANTS.TOTAL_MANDATORY_SECTIONS).toBe(4);
        expect(SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE).toBe(100);
        expect(SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT).toBe(0);
        expect(SCHEMA_VALIDATOR_CONSTANTS.MIN_REQUIRED_CHECKBOXES).toBe(1);
        expect(SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS.length).toBe(4);
        expect(SCHEMA_VALIDATOR_CONSTANTS.ALLOWED_STATUSES).toEqual(["Backlog", "In progress", "Done"]);
        expect(SCHEMA_VALIDATOR_CONSTANTS.ALLOWED_PRIORITIES).toEqual(["P0", "P1"]);
        expect(SCHEMA_VALIDATOR_CONSTANTS.ERROR_CODE_SCHEMA_VALIDATION).toBe("SCHEMA_VALIDATION_ERROR");
      });

      it("instantiates SchemaValidationError inheriting from CatalogGeneratorError", () => {
        const err = new SchemaValidationError("Validation failed");
        expect(err.name).toBe("SchemaValidationError");
        expect(err.code).toBe("SCHEMA_VALIDATION_ERROR");
        expect(err instanceof CatalogGeneratorError).toBe(true);
        expect(err instanceof Error).toBe(true);
      });
    });

    describe("Single Task Schema Validation (validateTaskSchema)", () => {
      it("validates a fully compliant task asserting 100% section coverage", () => {
        const item = createCompliantTask();
        const res = validateTaskSchema(item);

        expect(res.valid).toBe(true);
        expect(res.isFullyCompliant).toBe(true);
        expect(res.taskKey).toBe("LOOPER-CORE-001");
        expect(res.sectionsPresentCount).toBe(4);
        expect(res.sectionsTotalCount).toBe(4);
        expect(res.coveragePercentage).toBe(100);
        expect(res.missingSections).toEqual([]);
        expect(res.emptySections).toEqual([]);
        expect(res.hasCheckboxes).toBe(true);
        expect(res.checkboxCount).toBeGreaterThanOrEqual(1);
        expect(res.errors).toEqual([]);

        for (const sec of SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS) {
          expect(res.sectionDetails[sec]?.present).toBe(true);
          expect(res.sectionDetails[sec]?.nonEmpty).toBe(true);
          expect(res.sectionDetails[sec]?.contentLength).toBeGreaterThan(0);
        }
      });

      it("detects missing Section 1: 'Propósito de la tarea'", () => {
        const incompleteBody = `## 2. Qué se espera lograr
Logro esperado.

## 3. Goal de la tarea
Meta clara.

## 4. Criterios de completitud / Definition of Done
- [ ] Criterio de prueba.`;

        const item = normalizeCatalogItem({
          id: "PVTI_MISSING_1",
          title: "[LOOPER-CORE-002] Missing Section 1",
          body: incompleteBody,
        });

        const res = validateTaskSchema(item);
        expect(res.valid).toBe(false);
        expect(res.isFullyCompliant).toBe(false);
        expect(res.sectionsPresentCount).toBe(3);
        expect(res.coveragePercentage).toBe(75);
        expect(res.missingSections).toEqual(["Propósito de la tarea"]);
        expect(res.errors.some((e) => e.includes("Propósito de la tarea"))).toBe(true);
      });

      it("detects missing Section 2: 'Qué se espera lograr'", () => {
        const incompleteBody = `## 1. Propósito de la tarea
Proposito válido.

## 3. Goal de la tarea
Meta clara.

## 4. Criterios de completitud / Definition of Done
- [ ] Criterio de prueba.`;

        const item = normalizeCatalogItem({
          id: "PVTI_MISSING_2",
          title: "[LOOPER-CORE-003] Missing Section 2",
          body: incompleteBody,
        });

        const res = validateTaskSchema(item);
        expect(res.valid).toBe(false);
        expect(res.missingSections).toEqual(["Qué se espera lograr"]);
      });

      it("detects missing Section 3: 'Goal de la tarea'", () => {
        const incompleteBody = `## 1. Propósito de la tarea
Proposito válido.

## 2. Qué se espera lograr
Logro esperado.

## 4. Criterios de completitud / Definition of Done
- [ ] Criterio de prueba.`;

        const item = normalizeCatalogItem({
          id: "PVTI_MISSING_3",
          title: "[LOOPER-CORE-004] Missing Section 3",
          body: incompleteBody,
        });

        const res = validateTaskSchema(item);
        expect(res.valid).toBe(false);
        expect(res.missingSections).toEqual(["Goal de la tarea"]);
      });

      it("detects missing Section 4: 'Criterios de completitud / Definition of Done'", () => {
        const incompleteBody = `## 1. Propósito de la tarea
Proposito válido.

## 2. Qué se espera lograr
Logro esperado.

## 3. Goal de la tarea
Meta clara.`;

        const item = normalizeCatalogItem({
          id: "PVTI_MISSING_4",
          title: "[LOOPER-CORE-005] Missing Section 4",
          body: incompleteBody,
        });

        const res = validateTaskSchema(item);
        expect(res.valid).toBe(false);
        expect(res.missingSections).toEqual(["Criterios de completitud / Definition of Done"]);
      });

      it("detects 0% coverage when all 4 mandatory sections are missing", () => {
        const emptyBodyItem = normalizeCatalogItem({
          id: "PVTI_EMPTY",
          title: "[LOOPER-PAL-001] Totally Empty Task",
          body: "Just some unformatted random description without headings.",
        });

        const res = validateTaskSchema(emptyBodyItem);
        expect(res.valid).toBe(false);
        expect(res.sectionsPresentCount).toBe(0);
        expect(res.coveragePercentage).toBe(0);
        expect(res.missingSections.length).toBe(4);
      });

      it("detects present but empty sections when requireNonEmptySections is enabled", () => {
        const emptySectionBody = `## 1. Propósito de la tarea
   

## 2. Qué se espera lograr
Contenido válido.

## 3. Goal de la tarea
Meta válida.

## 4. Criterios de completitud / Definition of Done
- [ ] Criterio 1`;

        const item = normalizeCatalogItem({
          id: "PVTI_EMPTY_SEC",
          title: "[LOOPER-GATE-001] Empty Section Task",
          body: emptySectionBody,
        });

        const res = validateTaskSchema(item, { requireNonEmptySections: true });
        expect(res.valid).toBe(false);
        expect(res.emptySections).toEqual(["Propósito de la tarea"]);
        expect(res.errors.some((e) => e.includes("present but empty"))).toBe(true);
      });

      it("validates interactive checkboxes in Section 4 and fails when absent", () => {
        const noCheckboxBody = `## 1. Propósito de la tarea
Propósito válido.

## 2. Qué se espera lograr
Logro válido.

## 3. Goal de la tarea
Meta válida.

## 4. Criterios de completitud / Definition of Done
Plain bullet point without any checkbox brackets.
Another plain line.`;

        const item = normalizeCatalogItem({
          id: "PVTI_NO_CB",
          title: "[LOOPER-INT-001] No Checkbox Task",
          body: noCheckboxBody,
        });

        const res = validateTaskSchema(item, { requireCheckboxes: true });
        expect(res.valid).toBe(false);
        expect(res.hasCheckboxes).toBe(false);
        expect(res.errors.some((e) => e.includes("checkbox"))).toBe(true);
      });

      it("accepts both checked (- [x], - [X]) and unchecked (- [ ]) checkboxes", () => {
        const checkedBody = `## 1. Propósito de la tarea
Propósito.

## 2. Qué se espera lograr
Logro.

## 3. Goal de la tarea
Meta.

## 4. Criterios de completitud / Definition of Done
- [x] Primer criterio completado
- [X] Segundo criterio completado`;

        const res = validateTaskSchema(checkedBody);
        expect(res.hasCheckboxes).toBe(true);
        expect(res.checkboxCount).toBeGreaterThanOrEqual(1);
      });

      it("validates canonical task key format [LOOPER-<STREAM>-<NUM>]", () => {
        const nonCanonical = normalizeCatalogItem({
          id: "PVTI_NON_CANONICAL",
          title: "Task Without Any Bracketed Canonical Key",
          body: validBody,
        });

        const res = validateTaskSchema(nonCanonical, { requireCanonicalTaskKey: true });
        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes("canonical format"))).toBe(true);
      });

      it("enforces allowed status and priority sets when specified", () => {
        const item = createCompliantTask();
        item.status = "UnknownStatus";
        item.priority = "P9";

        const res = validateTaskSchema(item, {
          allowedStatuses: ["Backlog", "In progress", "Done"],
          allowedPriorities: ["P0", "P1"],
        });

        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes("status is not in allowed status set"))).toBe(true);
        expect(res.errors.some((e) => e.includes("priority is not in allowed priority set"))).toBe(true);
      });

      it("validates raw markdown body strings directly", () => {
        const res = validateTaskSchema(validBody);
        expect(res.sectionsPresentCount).toBe(4);
        expect(res.coveragePercentage).toBe(100);
        expect(res.hasCheckboxes).toBe(true);
      });
    });

    describe("Single Task Assertion (assertTask100PercentCompliance)", () => {
      it("succeeds silently and returns result for a compliant task", () => {
        const item = createCompliantTask("LOOPER-CORE-001");
        const res = assertTask100PercentCompliance(item);
        expect(res.valid).toBe(true);
        expect(res.coveragePercentage).toBe(100);
      });

      it("throws SchemaValidationError with rich diagnostics for a non-compliant task", () => {
        const invalidItem = normalizeCatalogItem({
          id: "PVTI_FAIL",
          title: "[LOOPER-CORE-999] Incomplete Task",
          body: "## 1. Propósito de la tarea\nSolo una sección.",
        });

        expect(() => assertTask100PercentCompliance(invalidItem)).toThrow(SchemaValidationError);

        try {
          assertTask100PercentCompliance(invalidItem);
        } catch (e) {
          const err = e as SchemaValidationError;
          expect(err.taskResult).toBeDefined();
          expect(err.taskResult?.missingSections.length).toBe(3);
          expect(err.message).toContain("failed 100% schema validation");
        }
      });
    });

    describe("Catalog Schema Validation (validateCatalogSchema)", () => {
      it("validates an all-compliant catalog asserting 100% global compliance rate", () => {
        const items = [
          createCompliantTask("LOOPER-CORE-001"),
          createCompliantTask("LOOPER-PAL-001"),
          createCompliantTask("LOOPER-GATE-001"),
          createCompliantTask("LOOPER-INT-001"),
        ];

        const report = validateCatalogSchema(items);
        expect(report.totalTasks).toBe(4);
        expect(report.passedTasks).toBe(4);
        expect(report.failedTasks).toBe(0);
        expect(report.complianceRate).toBe(100);
        expect(report.allCompliant).toBe(true);
        expect(report.failedTaskKeys).toEqual([]);
        expect(report.errors).toEqual([]);

        for (const sec of SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS) {
          expect(report.sectionSummaries[sec]?.presenceRate).toBe(100);
          expect(report.sectionSummaries[sec]?.nonEmptyRate).toBe(100);
          expect(report.sectionSummaries[sec]?.presentCount).toBe(4);
        }
      });

      it("computes accurate compliance rate when some catalog tasks fail", () => {
        const items = [
          createCompliantTask("LOOPER-CORE-001"),
          createCompliantTask("LOOPER-PAL-001"),
          createCompliantTask("LOOPER-GATE-001"),
          normalizeCatalogItem({
            id: "PVTI_BAD",
            title: "[LOOPER-INT-001] Bad Task",
            body: "No sections present here.",
          }),
        ];

        const report = validateCatalogSchema(items);
        expect(report.totalTasks).toBe(4);
        expect(report.passedTasks).toBe(3);
        expect(report.failedTasks).toBe(1);
        expect(report.complianceRate).toBe(75);
        expect(report.allCompliant).toBe(false);
        expect(report.failedTaskKeys).toEqual(["LOOPER-INT-001"]);
        expect(report.errors.length).toBe(1);
        expect(report.sectionSummaries["Propósito de la tarea"]?.presenceRate).toBe(75);
      });

      it("handles empty catalogs cleanly based on allowEmptyCatalog setting", () => {
        const emptyReportStrict = validateCatalogSchema([]);
        expect(emptyReportStrict.allCompliant).toBe(false);
        expect(emptyReportStrict.complianceRate).toBe(0);
        expect(emptyReportStrict.errors.length).toBeGreaterThan(0);

        const emptyReportPermissive = validateCatalogSchema([], { allowEmptyCatalog: true });
        expect(emptyReportPermissive.allCompliant).toBe(true);
        expect(emptyReportPermissive.complianceRate).toBe(100);
        expect(emptyReportPermissive.errors).toEqual([]);
      });
    });

    describe("Catalog 100% Compliance Assertion (assert100PercentCompliance)", () => {
      it("succeeds and returns report when catalog achieves 100% compliance", () => {
        const items = [
          createCompliantTask("LOOPER-CORE-001"),
          createCompliantTask("LOOPER-CORE-002"),
        ];

        const report = assert100PercentCompliance(items);
        expect(report.allCompliant).toBe(true);
        expect(report.complianceRate).toBe(100);
      });

      it("throws SchemaValidationError with failing task keys when compliance is below 100%", () => {
        const items = [
          createCompliantTask("LOOPER-CORE-001"),
          normalizeCatalogItem({
            id: "PVTI_NONCOMPLIANT",
            title: "[LOOPER-GATE-002] Incomplete",
            body: "## 1. Propósito de la tarea\nMissing remaining sections.",
          }),
        ];

        expect(() => assert100PercentCompliance(items)).toThrow(SchemaValidationError);

        try {
          assert100PercentCompliance(items);
        } catch (e) {
          const err = e as SchemaValidationError;
          expect(err.report).toBeDefined();
          expect(err.report?.complianceRate).toBe(50);
          expect(err.report?.failedTaskKeys).toContain("LOOPER-GATE-002");
          expect(err.message).toContain("compliance rate is below 100%");
        }
      });
    });

    describe("TaskSchemaValidator Class and File Operations", () => {
      it("instantiates TaskSchemaValidator and validates tasks and catalogs", () => {
        const validator = new TaskSchemaValidator({ requireNonEmptySections: true });
        const opts = validator.getOptions();
        expect(opts.requireNonEmptySections).toBe(true);

        const taskResult = validator.validateTask(createCompliantTask());
        expect(taskResult.valid).toBe(true);

        const catalogResult = validator.validateCatalog([createCompliantTask()]);
        expect(catalogResult.allCompliant).toBe(true);
      });

      it("audits existing projects/agnostic_looper/tasks_catalog.json file directly", async () => {
        const validator = new TaskSchemaValidator();
        const reportAsync = await validator.validateFile();
        expect(reportAsync.totalTasks).toBe(16);
        expect(reportAsync.allCompliant).toBe(true);
        expect(reportAsync.complianceRate).toBe(100);

        const reportSync = validator.validateFileSync();
        expect(reportSync.totalTasks).toBe(16);
        expect(reportSync.allCompliant).toBe(true);
        expect(reportSync.complianceRate).toBe(100);
      });

      it("asserts 100% compliance on real catalog file without throwing", async () => {
        const validator = new TaskSchemaValidator();
        const report = await validator.assertFile100PercentCompliance();
        expect(report.allCompliant).toBe(true);
        expect(report.passedTasks).toBe(16);

        const reportSync = validator.assertFileSync100PercentCompliance();
        expect(reportSync.allCompliant).toBe(true);
        expect(reportSync.passedTasks).toBe(16);
      });

      it("throws SchemaValidationError when asserting compliance on non-compliant file", async () => {
        const invalidFilePath = join(tempDir, "invalid_catalog.json");
        const invalidItems = [
          {
            task_key: "LOOPER-FAIL-001",
            title: "Missing all sections",
            body: "No markdown headings here.",
          },
        ];
        await atomicWriteFile(invalidFilePath, JSON.stringify(invalidItems));

        const validator = new TaskSchemaValidator();
        expect(validator.assertFile100PercentCompliance(invalidFilePath)).rejects.toThrow(
          SchemaValidationError
        );
        expect(() => validator.assertFileSync100PercentCompliance(invalidFilePath)).toThrow(
          SchemaValidationError
        );
      });

      it("throws FILE_READ_ERROR when auditing non-existent file", async () => {
        const validator = new TaskSchemaValidator();
        const missingPath = join(tempDir, "does_not_exist.json");
        expect(validator.validateFile(missingPath)).rejects.toThrow(CatalogGeneratorError);
        expect(() => validator.validateFileSync(missingPath)).toThrow(CatalogGeneratorError);
      });
    });

    describe("TaskCatalogGenerator Integration with Schema Validator", () => {
      it("exposes integrated validator on TaskCatalogGenerator instance", () => {
        const generator = new TaskCatalogGenerator({ outputDir: tempDir });
        expect(generator.validator).toBeDefined();
        expect(generator.validator instanceof TaskSchemaValidator).toBe(true);
      });

      it("executes validateCatalog and assert100PercentCompliance through generator methods", async () => {
        const generator = new TaskCatalogGenerator({ outputDir: tempDir });
        const items = [createCompliantTask("LOOPER-CORE-001")];
        await generator.generate(items);

        const validateResult = await generator.validateCatalog();
        expect(validateResult.allCompliant).toBe(true);
        expect(validateResult.complianceRate).toBe(100);

        const syncResult = generator.validateCatalogSync();
        expect(syncResult.allCompliant).toBe(true);

        const assertResult = await generator.assert100PercentCompliance();
        expect(assertResult.allCompliant).toBe(true);

        const assertSyncResult = generator.assert100PercentComplianceSync();
        expect(assertSyncResult.allCompliant).toBe(true);
      });

      it("validates schema before file generation when validateSchema is enabled", async () => {
        const nonCompliantItems = [
          normalizeCatalogItem({
            id: "PVTI_NONCOMPLIANT",
            title: "[LOOPER-CORE-001] Missing Sections Task",
            body: "Incomplete body.",
          }),
        ];

        expect(
          generateCatalogFiles(nonCompliantItems, {
            outputDir: tempDir,
            validateSchema: true,
          })
        ).rejects.toThrow(SchemaValidationError);
      });

      it("generates catalog successfully when validateSchema is true and items are compliant", async () => {
        const compliantItems = [createCompliantTask("LOOPER-CORE-001")];
        const result = await generateCatalogFiles(compliantItems, {
          outputDir: tempDir,
          validateSchema: true,
        });

        expect(existsSync(result.jsonPath)).toBe(true);
        expect(existsSync(result.markdownPath)).toBe(true);
        expect(result.totalTasks).toBe(1);
      });
    });

    describe("Live Verification of projects/agnostic_looper/tasks_catalog.json (100% Presence)", () => {
      it("asserts 100% presence of all 4 mandatory sections across all 16 tasks in local repository", () => {
        const realCatalogPath = join(
          process.cwd(),
          CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
          CATALOG_CONSTANTS.DEFAULT_JSON_FILE
        );

        const items = readCatalogJsonSync(realCatalogPath);
        expect(items.length).toBe(16);

        const report = assert100PercentCompliance(items);
        expect(report.totalTasks).toBe(16);
        expect(report.passedTasks).toBe(16);
        expect(report.failedTasks).toBe(0);
        expect(report.complianceRate).toBe(100);
        expect(report.allCompliant).toBe(true);

        for (const sec of SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS) {
          const summary = report.sectionSummaries[sec];
          expect(summary?.presentCount).toBe(16);
          expect(summary?.nonEmptyCount).toBe(16);
          expect(summary?.presenceRate).toBe(100);
          expect(summary?.nonEmptyRate).toBe(100);
        }

        for (const task of report.taskResults) {
          expect(task.valid).toBe(true);
          expect(task.isFullyCompliant).toBe(true);
          expect(task.sectionsPresentCount).toBe(4);
          expect(task.coveragePercentage).toBe(100);
          expect(task.missingSections).toEqual([]);
          expect(task.emptySections).toEqual([]);
          expect(task.hasCheckboxes).toBe(true);
          expect(task.checkboxCount).toBeGreaterThanOrEqual(1);
        }
      });
    });
  });

  describe("CatalogDriftDetector (Task 1.3)", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "drift-test-"));
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    const compliantBody = [
      "## 1. Propósito de la tarea",
      "Definir e implementar el motor de sincronización de catálogo.",
      "",
      "## 2. Qué se espera lograr",
      "- Catálogo JSON y Markdown sincronizados.",
      "",
      "## 3. Goal de la tarea",
      "Proveer una implementación desacoplada y robusta.",
      "",
      "## 4. Criterios de completitud / Definition of Done",
      "- [ ] Implementar catalog_generator.ts",
      "- [ ] Ejecutar pruebas unitarias",
    ].join("\n");

    const sampleLocalTask: CatalogTaskItem = {
      task_key: "LOOPER-INT-003",
      taskId: "LOOPER-INT-003",
      project_item_id: "PVTI_item123",
      githubProjectItemId: "PVTI_item123",
      title: "[LOOPER-INT-003] Local Catalog Generator and Synchronizer",
      workstream: "CLI, State Persistence & GitHub Project #4 Integration",
      stream: "CLI, State Persistence & GitHub Project #4 Integration",
      status: "Backlog",
      priority: "P1",
      size: "M",
      sections_present: [...SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS],
      url: "https://github.com/users/sastiam/projects/4",
      githubUrl: "https://github.com/users/sastiam/projects/4",
      sections: {
        proposito: "Definir e implementar el motor de sincronización de catálogo.",
        queSeEsperaLograr: "- Catálogo JSON y Markdown sincronizados.",
        goal: "Proveer una implementación desacoplada y robusta.",
        criteriosCompletitud: [
          "Implementar catalog_generator.ts",
          "Ejecutar pruebas unitarias",
        ],
      },
      body: compliantBody,
    };

    describe("Constants, Severity Mappings, and Error Hierarchy", () => {
      it("exposes expected drift constants with zero magic numbers", () => {
        expect(DRIFT_CONSTANTS.SEVERITY_INFO).toBe("INFO");
        expect(DRIFT_CONSTANTS.SEVERITY_WARNING).toBe("WARNING");
        expect(DRIFT_CONSTANTS.SEVERITY_ERROR).toBe("ERROR");
        expect(DRIFT_CONSTANTS.SEVERITY_CRITICAL).toBe("CRITICAL");

        expect(DRIFT_CONSTANTS.SEVERITY_RANK.INFO).toBe(1);
        expect(DRIFT_CONSTANTS.SEVERITY_RANK.WARNING).toBe(2);
        expect(DRIFT_CONSTANTS.SEVERITY_RANK.ERROR).toBe(3);
        expect(DRIFT_CONSTANTS.SEVERITY_RANK.CRITICAL).toBe(4);

        expect(DRIFT_CONSTANTS.TYPE_ITEM_ADDED).toBe("ITEM_ADDED");
        expect(DRIFT_CONSTANTS.TYPE_ITEM_REMOVED).toBe("ITEM_REMOVED");
        expect(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED).toBe("FIELD_MODIFIED");
        expect(DRIFT_CONSTANTS.TYPE_SECTIONS_MODIFIED).toBe("SECTIONS_MODIFIED");
        expect(DRIFT_CONSTANTS.TYPE_CHECKLIST_MODIFIED).toBe("CHECKLIST_MODIFIED");

        expect(DRIFT_CONSTANTS.ERROR_CODE_DRIFT).toBe("CATALOG_DRIFT_DETECTED");
        expect(DRIFT_CONSTANTS.DEFAULT_MAX_ALLOWED_DRIFT).toBe(0);
        expect(DRIFT_CONSTANTS.DEFAULT_IGNORE_WHITESPACE).toBe(true);
      });

      it("instantiates CatalogDriftError inheriting from CatalogGeneratorError with rich report", () => {
        const dummyReport: CatalogDriftReport = {
          timestamp: new Date().toISOString(),
          hasDrift: true,
          stats: {
            totalLocalTasks: 1,
            totalRemoteTasks: 1,
            totalTasksAudited: 1,
            tasksInSyncCount: 0,
            tasksWithDriftCount: 1,
            addedInRemoteCount: 0,
            removedInRemoteCount: 0,
            modifiedCount: 1,
            totalFieldDiffsCount: 1,
            alertsCountBySeverity: { INFO: 0, WARNING: 1, ERROR: 0, CRITICAL: 0 },
          },
          taskDrifts: [],
          driftedTaskKeys: ["LOOPER-INT-003"],
          alerts: [],
          formattedSummary: "Drift detected",
          formattedMarkdown: "# Drift Report",
        };

        const cause = new Error("Underlying reason");
        const err = new CatalogDriftError("Drift assertion failed", dummyReport, cause);

        expect(err.name).toBe("CatalogDriftError");
        expect(err.code).toBe("CATALOG_DRIFT_DETECTED");
        expect(err.message).toBe("Drift assertion failed");
        expect(err.report).toBe(dummyReport);
        expect(err.cause).toBe(cause);
        expect(err instanceof CatalogGeneratorError).toBe(true);
        expect(err instanceof Error).toBe(true);
      });
    });

    describe("Normalization and Checklist Extraction Helpers", () => {
      it("normalizes text for whitespace-invariant comparison", () => {
        expect(normalizeTextForComparison(undefined)).toBe("");
        expect(normalizeTextForComparison("  Hello  \r\n World \n\n")).toBe("Hello\nWorld");
        expect(normalizeTextForComparison("Identical")).toBe("Identical");
      });

      it("extracts checklist items and counts checked/unchecked states", () => {
        const markdown = [
          "- [ ] Item 1 pending",
          "- [x] Item 2 completed",
          "- [X] Item 3 also completed",
          "- Normal bullet not checkbox",
        ].join("\n");

        const state = extractTaskChecklist(markdown);
        expect(state.total).toBe(3);
        expect(state.checkedCount).toBe(2);
        expect(state.uncheckedCount).toBe(1);
        expect(state.items[0]?.checked).toBe(false);
        expect(state.items[0]?.text).toBe("Item 1 pending");
        expect(state.items[1]?.checked).toBe(true);
        expect(state.items[2]?.checked).toBe(true);
      });

      it("handles array inputs in extractTaskChecklist", () => {
        const criteria = [
          "- [x] Gate verified",
          "- [ ] Documentation completed",
        ];
        const state = extractTaskChecklist(criteria);
        expect(state.total).toBe(2);
        expect(state.checkedCount).toBe(1);
        expect(state.uncheckedCount).toBe(1);
      });
    });

    describe("Severity Resolution and Filtering", () => {
      it("resolves default severities based on field and event type", () => {
        expect(resolveDriftSeverity(DRIFT_CONSTANTS.TYPE_ITEM_REMOVED)).toBe("CRITICAL");
        expect(resolveDriftSeverity(DRIFT_CONSTANTS.TYPE_ITEM_ADDED)).toBe("WARNING");
        expect(resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_PRIORITY)).toBe("ERROR");
        expect(resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_STATUS)).toBe("WARNING");
        expect(resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_URL)).toBe("INFO");
      });

      it("honors customSeverityMapping overrides", () => {
        const severity = resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_STATUS, {
          customSeverityMapping: { status: "CRITICAL" },
        });
        expect(severity).toBe("CRITICAL");
      });

      it("evaluates severity eligibility against minimum alert threshold", () => {
        expect(isSeverityEligible("INFO", "INFO")).toBe(true);
        expect(isSeverityEligible("INFO", "WARNING")).toBe(false);
        expect(isSeverityEligible("WARNING", "WARNING")).toBe(true);
        expect(isSeverityEligible("ERROR", "WARNING")).toBe(true);
        expect(isSeverityEligible("CRITICAL", "ERROR")).toBe(true);
      });
    });

    describe("Single Task Item Comparison (compareTaskItems)", () => {
      it("reports zero drift for identical task items", () => {
        const remoteItem = { ...sampleLocalTask };
        const result = compareTaskItems(sampleLocalTask, remoteItem);

        expect(result.hasDrift).toBe(false);
        expect(result.diffs.length).toBe(0);
        expect(result.driftTypes).toEqual([]);
        expect(result.maxSeverity).toBe("INFO");
      });

      it("detects status mismatch between local and remote", () => {
        const remoteItem: CatalogTaskItem = {
          ...sampleLocalTask,
          status: "In progress",
        };
        const result = compareTaskItems(sampleLocalTask, remoteItem);

        expect(result.hasDrift).toBe(true);
        expect(result.driftTypes).toContain("FIELD_MODIFIED");
        expect(result.maxSeverity).toBe("WARNING");
        const statusDiff = result.diffs.find((d) => d.field === "status");
        expect(statusDiff).toBeDefined();
        expect(statusDiff?.localValue).toBe("Backlog");
        expect(statusDiff?.remoteValue).toBe("In progress");
        expect(statusDiff?.severity).toBe("WARNING");
      });

      it("detects priority mismatch with ERROR severity", () => {
        const remoteItem: CatalogTaskItem = {
          ...sampleLocalTask,
          priority: "P0",
        };
        const result = compareTaskItems(sampleLocalTask, remoteItem);

        expect(result.hasDrift).toBe(true);
        expect(result.maxSeverity).toBe("ERROR");
        const priorityDiff = result.diffs.find((d) => d.field === "priority");
        expect(priorityDiff).toBeDefined();
        expect(priorityDiff?.localValue).toBe("P1");
        expect(priorityDiff?.remoteValue).toBe("P0");
        expect(priorityDiff?.severity).toBe("ERROR");
      });

      it("detects size and title mismatches", () => {
        const remoteItem: CatalogTaskItem = {
          ...sampleLocalTask,
          size: "L",
          title: "[LOOPER-INT-003] Modified Title",
        };
        const result = compareTaskItems(sampleLocalTask, remoteItem);

        expect(result.hasDrift).toBe(true);
        const sizeDiff = result.diffs.find((d) => d.field === "size");
        const titleDiff = result.diffs.find((d) => d.field === "title");
        expect(sizeDiff?.remoteValue).toBe("L");
        expect(titleDiff?.remoteValue).toBe("[LOOPER-INT-003] Modified Title");
      });

      it("detects mandatory section content modification", () => {
        const remoteItem: CatalogTaskItem = {
          ...sampleLocalTask,
          sections: {
            ...sampleLocalTask.sections,
            goal: "Updated goal for task 1.3",
          },
        };
        const result = compareTaskItems(sampleLocalTask, remoteItem);

        expect(result.hasDrift).toBe(true);
        expect(result.driftTypes).toContain("SECTIONS_MODIFIED");
        const goalDiff = result.diffs.find((d) => d.field === "sections.goal");
        expect(goalDiff).toBeDefined();
        expect(goalDiff?.localValue).toBe("Proveer una implementación desacoplada y robusta.");
        expect(goalDiff?.remoteValue).toBe("Updated goal for task 1.3");
      });

      it("detects DoD checklist checkbox state modification", () => {
        const remoteBody = sampleLocalTask.body.replace(
          "- [ ] Implementar catalog_generator.ts",
          "- [x] Implementar catalog_generator.ts"
        );
        const remoteItem: CatalogTaskItem = {
          ...sampleLocalTask,
          body: remoteBody,
        };
        const result = compareTaskItems(sampleLocalTask, remoteItem);

        expect(result.hasDrift).toBe(true);
        expect(result.driftTypes).toContain("CHECKLIST_MODIFIED");
        const checklistDiff = result.diffs.find((d) => d.field === "checklist");
        expect(checklistDiff).toBeDefined();
        const localChecklist = checklistDiff?.localValue as
          | { total: number; checked: number }
          | undefined;
        const remoteChecklist = checklistDiff?.remoteValue as
          | { total: number; checked: number }
          | undefined;
        expect(localChecklist?.checked).toBe(0);
        expect(remoteChecklist?.checked).toBe(1);
      });

      it("ignores whitespace differences when ignoreWhitespace is true", () => {
        const remoteItem: CatalogTaskItem = {
          ...sampleLocalTask,
          title: "  [LOOPER-INT-003] Local Catalog Generator and Synchronizer  ",
          sections: {
            ...sampleLocalTask.sections,
            goal: "Proveer una implementación desacoplada y robusta.   \n\n",
          },
        };
        const result = compareTaskItems(sampleLocalTask, remoteItem, { ignoreWhitespace: true });
        expect(result.hasDrift).toBe(false);
      });

      it("respects ignoredFields configuration", () => {
        const remoteItem: CatalogTaskItem = {
          ...sampleLocalTask,
          status: "Done",
          size: "XL",
        };
        const result = compareTaskItems(sampleLocalTask, remoteItem, {
          ignoredFields: ["status", "size"],
        });
        expect(result.hasDrift).toBe(false);
      });
    });

    describe("Catalog Drift Detection (detectCatalogDrift)", () => {
      it("reports zero drift across matching catalog sets", () => {
        const localTasks = [sampleLocalTask];
        const remoteTasks = [{ ...sampleLocalTask }];

        const report = detectCatalogDrift(localTasks, remoteTasks);
        expect(report.hasDrift).toBe(false);
        expect(report.stats.tasksInSyncCount).toBe(1);
        expect(report.stats.tasksWithDriftCount).toBe(0);
        expect(report.stats.totalFieldDiffsCount).toBe(0);
        expect(report.alerts.length).toBe(0);
        expect(report.driftedTaskKeys).toEqual([]);
        expect(report.formattedSummary).toContain("100% in sync");
      });

      it("detects added items in remote GitHub Project (missing locally)", () => {
        const localTasks: CatalogTaskItem[] = [];
        const remoteTasks = [{ ...sampleLocalTask }];

        const report = detectCatalogDrift(localTasks, remoteTasks);
        expect(report.hasDrift).toBe(true);
        expect(report.stats.addedInRemoteCount).toBe(1);
        expect(report.stats.tasksWithDriftCount).toBe(1);
        expect(report.driftedTaskKeys).toContain("LOOPER-INT-003");

        const alert = report.alerts.find((a) => a.driftType === "ITEM_ADDED");
        expect(alert).toBeDefined();
        expect(alert?.taskKey).toBe("LOOPER-INT-003");
        expect(alert?.severity).toBe("WARNING");
        expect(alert?.message).toContain("missing in local repository");
      });

      it("detects removed items in remote GitHub Project (missing remotely)", () => {
        const localTasks = [sampleLocalTask];
        const remoteTasks: CatalogTaskItem[] = [];

        const report = detectCatalogDrift(localTasks, remoteTasks);
        expect(report.hasDrift).toBe(true);
        expect(report.stats.removedInRemoteCount).toBe(1);
        expect(report.stats.tasksWithDriftCount).toBe(1);
        expect(report.driftedTaskKeys).toContain("LOOPER-INT-003");

        const alert = report.alerts.find((a) => a.driftType === "ITEM_REMOVED");
        expect(alert).toBeDefined();
        expect(alert?.taskKey).toBe("LOOPER-INT-003");
        expect(alert?.severity).toBe("CRITICAL");
        expect(alert?.message).toContain("missing from remote GitHub Project #4");
      });

      it("matches tasks case-insensitively and through fallback project_item_id", () => {
        const local = { ...sampleLocalTask, task_key: "looper-int-003" };
        const remote = { ...sampleLocalTask, task_key: "LOOPER-INT-003" };

        const report = detectCatalogDrift([local], [remote]);
        expect(report.hasDrift).toBe(false);
      });

      it("generates markdown report with tables, summary, and alerts", () => {
        const localTasks = [sampleLocalTask];
        const remoteTasks = [
          {
            ...sampleLocalTask,
            status: "Done",
            priority: "P0",
          },
        ];

        const report = detectCatalogDrift(localTasks, remoteTasks);
        expect(report.hasDrift).toBe(true);
        expect(report.formattedMarkdown).toContain(DRIFT_CONSTANTS.REPORT_TITLE);
        expect(report.formattedMarkdown).toContain("Executive Summary Statistics");
        expect(report.formattedMarkdown).toContain("Active Drift Alerts");
        expect(report.formattedMarkdown).toContain("LOOPER-INT-003");
        expect(report.formattedMarkdown).toContain("Done");
      });
    });

    describe("Alert Dispatch and Handler Integration", () => {
      it("formats alert messages with emojis and prefixes", () => {
        const alert: DriftAlert = {
          id: "alert-1",
          timestamp: new Date().toISOString(),
          severity: "WARNING",
          taskKey: "LOOPER-CORE-001",
          driftType: "FIELD_MODIFIED",
          field: "status",
          message: "Status changed to In progress",
        };

        const msg = formatAlertMessage(alert);
        expect(msg).toContain("⚠️");
        expect(msg).toContain("[DRIFT ALERT]");
        expect(msg).toContain("[WARNING]");
        expect(msg).toContain("LOOPER-CORE-001 [status]");
      });

      it("dispatches alerts to custom onAlert handler", async () => {
        const receivedAlerts: DriftAlert[] = [];
        const onAlert: DriftAlertHandler = (alert) => {
          receivedAlerts.push(alert);
        };

        const localTasks = [sampleLocalTask];
        const remoteTasks = [{ ...sampleLocalTask, status: "In progress" }];

        const report = detectCatalogDrift(localTasks, remoteTasks);
        await dispatchDriftAlerts(report.alerts, { onAlert, alertSink: "memory" });

        expect(receivedAlerts.length).toBe(1);
        expect(receivedAlerts[0]?.taskKey).toBe("LOOPER-INT-003");
        expect(receivedAlerts[0]?.field).toBe("status");
      });

      it("filters alert dispatch by minSeverityToAlert threshold", async () => {
        const alerts: DriftAlert[] = [
          {
            id: "1",
            timestamp: new Date().toISOString(),
            severity: "INFO",
            taskKey: "T1",
            driftType: "FIELD_MODIFIED",
            message: "Info message",
          },
          {
            id: "2",
            timestamp: new Date().toISOString(),
            severity: "ERROR",
            taskKey: "T2",
            driftType: "FIELD_MODIFIED",
            message: "Error message",
          },
        ];

        const dispatched: DriftAlert[] = [];
        await dispatchDriftAlerts(alerts, {
          minSeverityToAlert: "ERROR",
          alertSink: "memory",
          onAlert: (a) => {
            dispatched.push(a);
          },
        });

        expect(dispatched.length).toBe(1);
        expect(dispatched[0]?.taskKey).toBe("T2");
      });
    });

    describe("Assertion Primitives (assertNoDrift)", () => {
      it("succeeds silently when there is zero drift", () => {
        const report = assertNoDrift([sampleLocalTask], [{ ...sampleLocalTask }]);
        expect(report.hasDrift).toBe(false);
      });

      it("throws CatalogDriftError when drift occurs", () => {
        expect(() => {
          assertNoDrift(
            [sampleLocalTask],
            [{ ...sampleLocalTask, status: "Done" }]
          );
        }).toThrow(CatalogDriftError);
      });

      it("attaches rich report and lists drifted keys on CatalogDriftError", () => {
        try {
          assertNoDrift(
            [sampleLocalTask],
            [{ ...sampleLocalTask, status: "Done" }]
          );
          expect(true).toBe(false); // should not reach
        } catch (e: unknown) {
          expect(e instanceof CatalogDriftError).toBe(true);
          if (e instanceof CatalogDriftError) {
            expect(e.code).toBe("CATALOG_DRIFT_DETECTED");
            expect(e.report).toBeDefined();
            expect(e.report.driftedTaskKeys).toContain("LOOPER-INT-003");
          }
        }
      });

      it("tolerates drift within maxAllowedDrift threshold", () => {
        const report = assertNoDrift(
          [sampleLocalTask],
          [{ ...sampleLocalTask, status: "In progress" }],
          { maxAllowedDrift: 1 }
        );
        expect(report.hasDrift).toBe(true);
      });
    });

    describe("CatalogDriftDetector Class Operations", () => {
      it("instantiates with custom options and provides getDefaultOptions()", () => {
        const detector = new CatalogDriftDetector({
          maxAllowedDrift: 2,
          ignoreWhitespace: false,
        });
        const opts = detector.getDefaultOptions();
        expect(opts.maxAllowedDrift).toBe(2);
        expect(opts.ignoreWhitespace).toBe(false);
      });

      it("executes detectDrift async with alert dispatch", async () => {
        const alertsCaptured: DriftAlert[] = [];
        const detector = new CatalogDriftDetector({
          onAlert: (a) => {
            alertsCaptured.push(a);
          },
          alertSink: "memory",
        });

        const report = await detector.detectDrift(
          [sampleLocalTask],
          [{ ...sampleLocalTask, priority: "P0" }]
        );

        expect(report.hasDrift).toBe(true);
        expect(alertsCaptured.length).toBe(1);
        expect(alertsCaptured[0]?.severity).toBe("ERROR");
      });

      it("executes detectDriftSync synchronously", () => {
        const detector = new CatalogDriftDetector();
        const report = detector.detectDriftSync(
          [sampleLocalTask],
          [{ ...sampleLocalTask, size: "S" }]
        );
        expect(report.hasDrift).toBe(true);
      });

      it("detects drift from files and asserts zero drift from files", async () => {
        const jsonPath = join(tempDir, "test_catalog.json");
        await writeCatalogJson(jsonPath, [sampleLocalTask]);

        const detector = new CatalogDriftDetector({ alertSink: "memory" });
        const report = await detector.detectDriftFromFiles(jsonPath, [{ ...sampleLocalTask }]);
        expect(report.hasDrift).toBe(false);

        const syncReport = detector.assertNoDriftFromFiles(jsonPath, [{ ...sampleLocalTask }]);
        expect(syncReport.hasDrift).toBe(false);
      });

      it("throws FILE_READ_ERROR when local catalog file does not exist", async () => {
        const detector = new CatalogDriftDetector();
        try {
          await detector.detectDriftFromFiles(join(tempDir, "non_existent.json"), []);
          expect(true).toBe(false);
        } catch (err: unknown) {
          expect(err instanceof CatalogGeneratorError).toBe(true);
          if (err instanceof CatalogGeneratorError) {
            expect(err.code).toBe("FILE_READ_ERROR");
          }
        }
      });

      it("fetches remote items from GitHubProjectService and detects drift", async () => {
        const jsonPath = join(tempDir, "test_catalog.json");
        await writeCatalogJson(jsonPath, [sampleLocalTask]);

        const mockItem: ProjectV2Item = {
          id: "PVTI_item123",
          type: "DRAFT_ISSUE",
          status: "In progress",
          priority: "P1",
          size: "M",
          content: {
            __typename: "DraftIssue",
            id: "DI_1",
            title: "[LOOPER-INT-003] Local Catalog Generator and Synchronizer",
            body: compliantBody,
          },
        };

        const mockService: Partial<GitHubProjectService> = {
          getAllItems: async () => [mockItem],
        };

        const detector = new CatalogDriftDetector({ alertSink: "memory" });
        const report = await detector.detectDriftFromProject(
          mockService as GitHubProjectService,
          jsonPath
        );

        expect(report.hasDrift).toBe(true);
        expect(report.stats.modifiedCount).toBe(1);
        expect(report.driftedTaskKeys).toContain("LOOPER-INT-003");
      });

      it("throws PROJECT_FETCH_ERROR when GitHubProjectService fails", async () => {
        const mockService: Partial<GitHubProjectService> = {
          getAllItems: async () => {
            throw new Error("Network offline");
          },
        };

        const detector = new CatalogDriftDetector();
        try {
          await detector.detectDriftFromProject(mockService as GitHubProjectService);
          expect(true).toBe(false);
        } catch (err: unknown) {
          expect(err instanceof CatalogGeneratorError).toBe(true);
          if (err instanceof CatalogGeneratorError) {
            expect(err.code).toBe("PROJECT_FETCH_ERROR");
          }
        }
      });
    });

    describe("TaskCatalogGenerator Integration with Drift Detector", () => {
      it("exposes integrated driftDetector on TaskCatalogGenerator", () => {
        const generator = new TaskCatalogGenerator();
        expect(generator.driftDetector).toBeDefined();
        expect(generator.driftDetector instanceof CatalogDriftDetector).toBe(true);
      });

      it("executes detectDrift and assertNoDrift via TaskCatalogGenerator instance", async () => {
        const generator = new TaskCatalogGenerator({
          outputDir: tempDir,
          driftOptions: {
            alertSink: "memory",
          },
        });

        // Generate baseline
        await generator.generate([sampleLocalTask]);

        // Same items -> zero drift
        const reportSync = generator.detectDriftSync([{ ...sampleLocalTask }]);
        expect(reportSync.hasDrift).toBe(false);

        const reportAsync = await generator.detectDrift([{ ...sampleLocalTask }]);
        expect(reportAsync.hasDrift).toBe(false);

        const assertedReport = generator.assertNoDriftSync([{ ...sampleLocalTask }]);
        expect(assertedReport.hasDrift).toBe(false);

        // Diverged items -> throws CatalogDriftError
        expect(() => {
          generator.assertNoDriftSync([{ ...sampleLocalTask, status: "Done" }]);
        }).toThrow(CatalogDriftError);
      });

      it("synchronizes items while alerting on drift with syncWithDriftAlerting", async () => {
        const capturedAlerts: DriftAlert[] = [];
        const generator = new TaskCatalogGenerator({
          outputDir: tempDir,
          driftOptions: {
            onAlert: (a) => {
              capturedAlerts.push(a);
            },
            alertSink: "memory",
          },
        });

        await generator.generate([sampleLocalTask]);

        // Remote has updated status to "In progress"
        const remoteUpdated = [{ ...sampleLocalTask, status: "In progress" }];
        const result = await generator.syncWithDriftAlerting(remoteUpdated);

        expect(result.driftReport.hasDrift).toBe(true);
        expect(result.driftReport.stats.modifiedCount).toBe(1);
        expect(capturedAlerts.length).toBe(1);
        expect(result.generationResult.totalTasks).toBe(1);

        // Now local catalog has been reconciled to "In progress"
        const localTasks = await generator.loadCatalog();
        expect(localTasks[0]?.status).toBe("In progress");

        // Subsequent check against remoteUpdated shows 0 drift
        const subsequentReport = await generator.detectDrift(remoteUpdated);
        expect(subsequentReport.hasDrift).toBe(false);
      });
    });

    describe("Live Verification against projects/agnostic_looper/tasks_catalog.json", () => {
      it("confirms real repository catalog has zero self-drift", () => {
        const realCatalogPath = join(
          process.cwd(),
          CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
          CATALOG_CONSTANTS.DEFAULT_JSON_FILE
        );

        const items = readCatalogJsonSync(realCatalogPath);
        expect(items.length).toBe(16);

        const report = assertNoDrift(items, items);
        expect(report.hasDrift).toBe(false);
        expect(report.stats.tasksInSyncCount).toBe(16);
        expect(report.stats.tasksWithDriftCount).toBe(0);
        expect(report.alerts.length).toBe(0);
        expect(report.stats.totalFieldDiffsCount).toBe(0);
      });

      it("detects drift when simulating a modified remote state against real catalog", () => {
        const realCatalogPath = join(
          process.cwd(),
          CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
          CATALOG_CONSTANTS.DEFAULT_JSON_FILE
        );

        const localItems = readCatalogJsonSync(realCatalogPath);
        const remoteItems = localItems.map((item) => {
          if (item.task_key === "LOOPER-INT-003") {
            return {
              ...item,
              status: "Done",
              priority: "P0",
            };
          }
          return { ...item };
        });

        const report = detectCatalogDrift(localItems, remoteItems);
        expect(report.hasDrift).toBe(true);
        expect(report.stats.tasksWithDriftCount).toBe(1);
        expect(report.stats.tasksInSyncCount).toBe(15);
        expect(report.driftedTaskKeys).toEqual(["LOOPER-INT-003"]);

        const statusAlert = report.alerts.find((a) => a.field === "status");
        const priorityAlert = report.alerts.find((a) => a.field === "priority");

        expect(statusAlert).toBeDefined();
        expect(statusAlert?.severity).toBe("WARNING");
        expect(priorityAlert).toBeDefined();
        expect(priorityAlert?.severity).toBe("ERROR");
      });
    });
  });

describe("Catalog Synchronization & Verification Suite (Task 1.4)", () => {
  let tempDir: string;

  const EXPECTED_INITIAL_TASKS = 4;
  const EXPECTED_RECONCILED_TASKS = 5;
  const EXPECTED_CANONICAL_TASKS = 16;
  const EXPECTED_CANONICAL_WORKSTREAMS = 4;
  const EXPECTED_TASKS_PER_STREAM = 4;
  const EXPECTED_CANONICAL_P0 = 9;
  const EXPECTED_CANONICAL_P1 = 7;
  const MAX_DRIFT_TOLERANCE = 1;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "catalog-sync-suite-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const compliantTaskBody = (key: string, name: string): string => `## 1. Propósito de la tarea
Garantizar la correcta ejecución y auditoría de la tarea ${key}.

## 2. Qué se espera lograr
- Implementación completa de los componentes de ${name}.
- Pruebas unitarias exhaustivas con bun test.

## 3. Goal de la tarea
Verificar la sincronización bidireccional y cumplimiento de esquema para ${key}.

## 4. Criterios de completitud / Definition of Done
- [ ] Implementación de código y pruebas asociadas
- [x] Verificación autónoma con bun test y bunx tsc --noEmit`;

  const makeTestItem = (
    key: string,
    streamName: string,
    options?: Partial<CatalogTaskItem>
  ): CatalogTaskItem =>
    normalizeCatalogItem({
      id: `PVTI_${key.replace(/-/g, "_")}`,
      title: `[${key}] ${streamName}`,
      status: options?.status ?? "Backlog",
      priority: options?.priority ?? "P1",
      size: options?.size ?? "M",
      body: compliantTaskBody(key, streamName),
      ...options,
    });

  describe("End-to-End Multi-Workstream Synchronization Lifecycle", () => {
    it("executes full lifecycle across all 4 canonical workstreams with 100% schema compliance", async () => {
      const initialTasks: CatalogTaskItem[] = [
        makeTestItem("LOOPER-CORE-001", "Core Looper Engine & FSM Lifecycle", { priority: "P0" }),
        makeTestItem("LOOPER-PAL-001", "Provider Abstraction Layer & Normalizers"),
        makeTestItem("LOOPER-GATE-001", "Mechanical QA & Structural Verification", { priority: "P0" }),
        makeTestItem("LOOPER-INT-001", "GitHub Project #4 Integration Service"),
      ];

      const generator = new TaskCatalogGenerator({
        outputDir: tempDir,
        validateSchema: true,
      });

      const generationResult = await generator.generate(initialTasks);
      expect(generationResult.totalTasks).toBe(EXPECTED_INITIAL_TASKS);
      expect(existsSync(generationResult.jsonPath)).toBe(true);
      expect(existsSync(generationResult.markdownPath)).toBe(true);

      const loadedTasks = await generator.loadCatalog();
      expect(loadedTasks.length).toBe(EXPECTED_INITIAL_TASKS);

      const complianceReport = generator.assert100PercentComplianceSync(loadedTasks);
      expect(complianceReport.allCompliant).toBe(true);
      expect(complianceReport.complianceRate).toBe(SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE);
      expect(complianceReport.passedTasks).toBe(EXPECTED_INITIAL_TASKS);

      const mdContent = readFileSync(generationResult.markdownPath, "utf-8");
      expect(mdContent).toContain(CATALOG_CONSTANTS.DOCUMENT_TITLE);
      expect(mdContent).toContain("Stream 1: Core Looper Engine & FSM Lifecycle");
      expect(mdContent).toContain("Stream 2: Provider Abstraction Layer (PAL) & Normalizers");
      expect(mdContent).toContain("Stream 3: Objective 4-Tier Verification Harness & Rollback Buffer");
      expect(mdContent).toContain("Stream 4: CLI, State Persistence & GitHub Project #4 Integration");

      const driftReport = generator.assertNoDriftSync(loadedTasks);
      expect(driftReport.hasDrift).toBe(false);
      expect(driftReport.stats.tasksInSyncCount).toBe(EXPECTED_INITIAL_TASKS);
    });

    it("detects multi-field drift across workstreams, captures alerts, and reconciles local files", async () => {
      const initialTasks: CatalogTaskItem[] = [
        makeTestItem("LOOPER-CORE-001", "Core Looper Engine & FSM Lifecycle", { status: "Backlog" }),
        makeTestItem("LOOPER-PAL-001", "Provider Abstraction Layer", { priority: "P1" }),
        makeTestItem("LOOPER-GATE-001", "Verification Gates"),
        makeTestItem("LOOPER-INT-001", "GitHub Integration"),
      ];

      const capturedAlerts: DriftAlert[] = [];
      const generator = new TaskCatalogGenerator({
        outputDir: tempDir,
        validateSchema: true,
        driftOptions: {
          onAlert: (alert) => {
            capturedAlerts.push(alert);
          },
          alertSink: "memory",
        },
      });

      await generator.generate(initialTasks);

      const toggledGateBody = compliantTaskBody("LOOPER-GATE-001", "Verification Gates").replace(
        "- [ ] Implementación de código y pruebas asociadas",
        "- [x] Implementación de código y pruebas asociadas"
      );

      const remoteTasks: CatalogTaskItem[] = [
        { ...initialTasks[0]!, status: "In progress" },
        { ...initialTasks[1]!, priority: "P0" },
        { ...initialTasks[2]!, body: toggledGateBody },
        { ...initialTasks[3]! },
        makeTestItem("LOOPER-INT-002", "Drift Detector Engine", { priority: "P0", status: "Backlog" }),
      ];

      const preSyncDrift = await generator.detectDrift(remoteTasks);
      expect(preSyncDrift.hasDrift).toBe(true);
      expect(preSyncDrift.stats.tasksWithDriftCount).toBe(4);
      expect(preSyncDrift.stats.modifiedCount).toBe(3);
      expect(preSyncDrift.stats.addedInRemoteCount).toBe(1);
      expect(preSyncDrift.stats.removedInRemoteCount).toBe(0);
      expect(preSyncDrift.driftedTaskKeys).toContain("LOOPER-CORE-001");
      expect(preSyncDrift.driftedTaskKeys).toContain("LOOPER-PAL-001");
      expect(preSyncDrift.driftedTaskKeys).toContain("LOOPER-GATE-001");
      expect(preSyncDrift.driftedTaskKeys).toContain("LOOPER-INT-002");

      const syncResult = await generator.syncWithDriftAlerting(remoteTasks);
      expect(syncResult.driftReport.hasDrift).toBe(true);
      expect(syncResult.generationResult.totalTasks).toBe(EXPECTED_RECONCILED_TASKS);

      const priorityAlert = capturedAlerts.find((a) => a.field === "priority");
      expect(priorityAlert).toBeDefined();
      expect(priorityAlert?.severity).toBe("ERROR");
      expect(priorityAlert?.taskKey).toBe("LOOPER-PAL-001");

      const statusAlert = capturedAlerts.find((a) => a.field === "status");
      expect(statusAlert).toBeDefined();
      expect(statusAlert?.severity).toBe("WARNING");
      expect(statusAlert?.taskKey).toBe("LOOPER-CORE-001");

      const addedAlert = capturedAlerts.find((a) => a.driftType === "ITEM_ADDED");
      expect(addedAlert).toBeDefined();
      expect(addedAlert?.severity).toBe("WARNING");
      expect(addedAlert?.taskKey).toBe("LOOPER-INT-002");

      const checklistAlert = capturedAlerts.find((a) => a.field === "checklist");
      expect(checklistAlert).toBeDefined();
      expect(checklistAlert?.severity).toBe("WARNING");
      expect(checklistAlert?.taskKey).toBe("LOOPER-GATE-001");

      const reconciledTasks = await generator.loadCatalog();
      expect(reconciledTasks.length).toBe(EXPECTED_RECONCILED_TASKS);

      const coreTask = reconciledTasks.find((t) => t.task_key === "LOOPER-CORE-001");
      expect(coreTask?.status).toBe("In progress");

      const palTask = reconciledTasks.find((t) => t.task_key === "LOOPER-PAL-001");
      expect(palTask?.priority).toBe("P0");

      const int2Task = reconciledTasks.find((t) => t.task_key === "LOOPER-INT-002");
      expect(int2Task).toBeDefined();

      const postSyncDrift = generator.assertNoDriftSync(remoteTasks);
      expect(postSyncDrift.hasDrift).toBe(false);
      expect(postSyncDrift.stats.tasksInSyncCount).toBe(EXPECTED_RECONCILED_TASKS);

      const postSyncCompliance = generator.assert100PercentComplianceSync(reconciledTasks);
      expect(postSyncCompliance.allCompliant).toBe(true);
      expect(postSyncCompliance.passedTasks).toBe(EXPECTED_RECONCILED_TASKS);
    });
  });

  describe("Spec Scenario: A task state changes in Project #4", () => {
    it("synchronizes tasks_catalog.json and tasks_catalog.md when a task state changes in Project #4", async () => {
      const initialTask = makeTestItem("LOOPER-INT-003", "Local Catalog Generator and Synchronizer", {
        status: "Backlog",
        priority: "P1",
      });

      const generator = new TaskCatalogGenerator({
        outputDir: tempDir,
        validateSchema: true,
      });

      await generator.generate([initialTask]);

      const jsonPath = join(tempDir, CATALOG_CONSTANTS.DEFAULT_JSON_FILE);
      const mdPath = join(tempDir, CATALOG_CONSTANTS.DEFAULT_MARKDOWN_FILE);

      const initialJson = JSON.parse(readFileSync(jsonPath, "utf-8")) as CatalogTaskItem[];
      expect(initialJson[0]?.status).toBe("Backlog");
      const initialMd = readFileSync(mdPath, "utf-8");
      expect(initialMd).toContain("Backlog");

      // WHEN A task state changes in Project #4
      const updateResult = await generator.updateTaskState("LOOPER-INT-003", { status: "Done" });
      const updatedItem = updateResult.items.find((it) => it.task_key === "LOOPER-INT-003");
      expect(updatedItem?.status).toBe("Done");

      // THEN The generator synchronizes tasks_catalog.json and tasks_catalog.md
      const updatedJson = JSON.parse(readFileSync(jsonPath, "utf-8")) as CatalogTaskItem[];
      expect(updatedJson[0]?.status).toBe("Done");

      const updatedMd = readFileSync(mdPath, "utf-8");
      expect(updatedMd).toContain("Done");
      expect(updatedMd).toContain("`LOOPER-INT-003`");

      const compliance = generator.assert100PercentComplianceSync(updatedJson);
      expect(compliance.allCompliant).toBe(true);
    });

    it("preserves task body, sections, and metadata integrity when only status changes", async () => {
      const initialTask = makeTestItem("LOOPER-INT-003", "Local Catalog Generator and Synchronizer", {
        status: "In progress",
      });

      const generator = new TaskCatalogGenerator({ outputDir: tempDir });
      await generator.generate([initialTask]);

      await generator.updateTaskState("LOOPER-INT-003", { status: "Done" });

      const loadedTasks = await generator.loadCatalog();
      const updated = loadedTasks[0]!;

      expect(updated.status).toBe("Done");
      expect(updated.sections.proposito).toBe("Garantizar la correcta ejecución y auditoría de la tarea LOOPER-INT-003.");
      expect(updated.sections.queSeEsperaLograr).toContain("Implementación completa");
      expect(updated.sections.goal).toBe("Verificar la sincronización bidireccional y cumplimiento de esquema para LOOPER-INT-003.");
      expect(updated.sections.criteriosCompletitud.join("\n")).toContain("bun test");
    });
  });

  describe("Schema Validation Enforcement & Non-Compliant Item Rejection", () => {
    it("rejects non-compliant items when validateSchema option is enabled", async () => {
      const nonCompliantTask = normalizeCatalogItem({
        id: "PVTI_INVALID",
        title: "[LOOPER-CORE-999] Malformed Task Missing DoD",
        status: "Backlog",
        priority: "P1",
        size: "M",
        body: `## 1. Propósito de la tarea\nProposito\n\n## 2. Qué se espera lograr\nLogro\n\n## 3. Goal de la tarea\nGoal`,
      });

      const generator = new TaskCatalogGenerator({
        outputDir: tempDir,
        validateSchema: true,
      });

      try {
        await generator.generate([nonCompliantTask]);
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err instanceof SchemaValidationError).toBe(true);
        if (err instanceof SchemaValidationError) {
          expect(err.code).toBe(SCHEMA_VALIDATOR_CONSTANTS.ERROR_CODE_SCHEMA_VALIDATION);
          expect(err.report?.failedTasks).toBe(1);
          expect(err.report?.allCompliant).toBe(false);
        }
      }

      const jsonPath = join(tempDir, CATALOG_CONSTANTS.DEFAULT_JSON_FILE);
      expect(existsSync(jsonPath)).toBe(false);
    });

    it("allows non-compliant items when validateSchema is false and provides diagnostic reports", async () => {
      const nonCompliantTask = normalizeCatalogItem({
        id: "PVTI_PERMISSIVE",
        title: "[LOOPER-CORE-998] Permissive Non Compliant",
        status: "Backlog",
        priority: "P1",
        size: "M",
        body: `Unstructured description without Spanish headers`,
      });

      const generator = new TaskCatalogGenerator({
        outputDir: tempDir,
        validateSchema: false,
      });

      const result = await generator.generate([nonCompliantTask]);
      expect(result.totalTasks).toBe(1);
      expect(existsSync(result.jsonPath)).toBe(true);

      const report = await generator.validateCatalog();
      expect(report.allCompliant).toBe(false);
      expect(report.complianceRate).toBe(SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT);
      expect(report.taskResults[0]?.missingSections.length).toBe(SCHEMA_VALIDATOR_CONSTANTS.TOTAL_MANDATORY_SECTIONS);
    });
  });

  describe("Resilience, Edge Cases, and Atomic Rollback", () => {
    it("handles empty catalog initialization cleanly", async () => {
      const generator = new TaskCatalogGenerator({ outputDir: tempDir });
      const result = await generator.generate([]);

      expect(result.totalTasks).toBe(0);
      expect(result.items).toEqual([]);

      const jsonTasks = await generator.loadCatalog();
      expect(jsonTasks).toEqual([]);

      const mdContent = readFileSync(result.markdownPath, "utf-8");
      expect(mdContent).toContain(CATALOG_CONSTANTS.DOCUMENT_TITLE);

      const driftReport = generator.assertNoDriftSync([]);
      expect(driftReport.hasDrift).toBe(false);
      expect(driftReport.stats.totalTasksAudited).toBe(0);
    });

    it("tolerates minor drift when maxAllowedDrift threshold is configured", () => {
      const item1 = makeTestItem("LOOPER-CORE-001", "Core FSM");
      const item2 = makeTestItem("LOOPER-PAL-001", "PAL Claude");

      const detector = new CatalogDriftDetector({
        maxAllowedDrift: MAX_DRIFT_TOLERANCE,
        failOnDrift: true,
      });

      // 1 item modified <= MAX_DRIFT_TOLERANCE (1) -> does not throw
      const toleratedReport = detector.assertNoDrift(
        [item1, item2],
        [{ ...item1, status: "In progress" }, item2]
      );
      expect(toleratedReport.hasDrift).toBe(true);
      expect(toleratedReport.stats.tasksWithDriftCount).toBe(1);

      // 2 items modified > MAX_DRIFT_TOLERANCE (1) -> throws CatalogDriftError
      expect(() => {
        detector.assertNoDrift(
          [item1, item2],
          [{ ...item1, status: "In progress" }, { ...item2, status: "Done" }]
        );
      }).toThrow(CatalogDriftError);
    });

    it("handles atomic write to nested subdirectory and cleans temp files", async () => {
      const nestedDir = join(tempDir, "deep", "nested", "catalog");
      const generator = new TaskCatalogGenerator({ outputDir: nestedDir });
      const sample = makeTestItem("LOOPER-INT-001", "Integration Service");

      const result = await generator.generate([sample]);
      expect(existsSync(result.jsonPath)).toBe(true);
      expect(existsSync(result.markdownPath)).toBe(true);

      const items = await generator.loadCatalog();
      expect(items.length).toBe(1);
      expect(items[0]?.task_key).toBe("LOOPER-INT-001");
    });
  });

  describe("Canonical Repository Catalog Integrity Verification", () => {
    it("audits existing projects/agnostic_looper catalog: 16 tasks, 100% compliance, zero drift", async () => {
      const realCatalogJsonPath = join(
        process.cwd(),
        CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
        CATALOG_CONSTANTS.DEFAULT_JSON_FILE
      );
      const realCatalogMdPath = join(
        process.cwd(),
        CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
        CATALOG_CONSTANTS.DEFAULT_MARKDOWN_FILE
      );

      expect(existsSync(realCatalogJsonPath)).toBe(true);
      expect(existsSync(realCatalogMdPath)).toBe(true);

      const validator = new TaskSchemaValidator();
      const compliance = await validator.assertFile100PercentCompliance(realCatalogJsonPath);

      expect(compliance.totalTasks).toBe(EXPECTED_CANONICAL_TASKS);
      expect(compliance.passedTasks).toBe(EXPECTED_CANONICAL_TASKS);
      expect(compliance.failedTasks).toBe(0);
      expect(compliance.allCompliant).toBe(true);
      expect(compliance.complianceRate).toBe(SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE);

      const items = readCatalogJsonSync(realCatalogJsonPath);
      expect(items.length).toBe(EXPECTED_CANONICAL_TASKS);

      const summaries = computeWorkstreamSummaries(items);
      expect(summaries.length).toBe(EXPECTED_CANONICAL_WORKSTREAMS);

      const coreSummary = summaries.find((s) => s.workstream === WORKSTREAM_DEFINITIONS[0]?.name);
      const palSummary = summaries.find((s) => s.workstream === WORKSTREAM_DEFINITIONS[1]?.name);
      const gateSummary = summaries.find((s) => s.workstream === WORKSTREAM_DEFINITIONS[2]?.name);
      const intSummary = summaries.find((s) => s.workstream === WORKSTREAM_DEFINITIONS[3]?.name);

      expect(coreSummary?.totalTasks).toBe(EXPECTED_TASKS_PER_STREAM);
      expect(palSummary?.totalTasks).toBe(EXPECTED_TASKS_PER_STREAM);
      expect(gateSummary?.totalTasks).toBe(EXPECTED_TASKS_PER_STREAM);
      expect(intSummary?.totalTasks).toBe(EXPECTED_TASKS_PER_STREAM);

      const totalP0 = summaries.reduce((acc, s) => acc + s.priorityP0, 0);
      const totalP1 = summaries.reduce((acc, s) => acc + s.priorityP1, 0);
      expect(totalP0).toBe(EXPECTED_CANONICAL_P0);
      expect(totalP1).toBe(EXPECTED_CANONICAL_P1);

      const driftReport = assertNoDrift(items, items);
      expect(driftReport.hasDrift).toBe(false);
      expect(driftReport.stats.tasksInSyncCount).toBe(EXPECTED_CANONICAL_TASKS);
      expect(driftReport.stats.tasksWithDriftCount).toBe(0);

      const mdContent = readFileSync(realCatalogMdPath, "utf-8");
      expect(mdContent).toContain(CATALOG_CONSTANTS.DOCUMENT_TITLE);
      expect(mdContent).toContain(WORKSTREAM_DEFINITIONS[0]!.streamTitle);
      expect(mdContent).toContain(WORKSTREAM_DEFINITIONS[1]!.streamTitle);
      expect(mdContent).toContain(WORKSTREAM_DEFINITIONS[2]!.streamTitle);
      expect(mdContent).toContain(WORKSTREAM_DEFINITIONS[3]!.streamTitle);
      expect(mdContent).toContain("LOOPER-CORE-001");
      expect(mdContent).toContain("LOOPER-PAL-001");
      expect(mdContent).toContain("LOOPER-GATE-001");
      expect(mdContent).toContain("LOOPER-INT-001");
    });
  });
});
