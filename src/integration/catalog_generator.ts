/**
 * Local Task Catalog Generator and Bidirectional Synchronization Engine.
 *
 * Implements LOOPER-INT-003 as part of the Provider-Agnostic Multi-Agent Looper
 * specification defined in `projects/agnostic_looper/SPECIFICATION.md` Section 6.4 & 6.5
 * and OpenSpec change `looper-integration-catalog-sync` Task 1.1.
 *
 * Generates and maintains structured local task catalogues in machine-readable JSON
 * (`tasks_catalog.json`) and human-readable Markdown (`tasks_catalog.md`) formats,
 * normalizing ProjectV2 items, extracting mandatory Spanish task sections, computing
 * workstream executive summaries, and providing atomic disk persistence.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { GitHubProjectService, ProjectV2Item } from "./github_project";
import {
  type CatalogValidationReport,
  type MandatorySectionName,
  SCHEMA_VALIDATOR_CONSTANTS,
  type SectionCoverageSummary,
  type SectionValidationDetail,
  SchemaValidationError,
  TaskSchemaValidator,
  type TaskValidationOptions,
  type TaskValidationResult,
  assert100PercentCompliance,
  assertTask100PercentCompliance,
  validateCatalogSchema,
  validateTaskSchema,
} from "./schema_validator";
import {
  type CatalogDriftReport,
  CatalogDriftDetector,
  CatalogDriftError,
  DRIFT_CONSTANTS,
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
} from "./drift_detector";

export * from "./schema_validator";
export * from "./drift_detector";

/**
 * Constants ensuring zero magic numbers across task catalog generation and synchronization.
 */
export const CATALOG_CONSTANTS = {
  DEFAULT_CATALOG_DIR: "projects/agnostic_looper",
  DEFAULT_JSON_FILE: "tasks_catalog.json",
  DEFAULT_MARKDOWN_FILE: "tasks_catalog.md",

  DEFAULT_PROJECT_TITLE: "Spec Cascade Project #4",
  DEFAULT_PROJECT_URL: "https://github.com/users/sastiam/projects/4",
  DEFAULT_PROJECT_NODE_ID: "PVT_kwHOA0KY4s4Boie_",

  DEFAULT_JSON_INDENT: 2,
  DEFAULT_ENCODING: "utf-8" as BufferEncoding,
  SWAP_SUFFIX: ".swap",

  DEFAULT_STATUS: "Backlog",
  DEFAULT_PRIORITY: "P1",
  DEFAULT_SIZE: "M",

  PRIORITY_P0: "P0",
  PRIORITY_P1: "P1",

  STREAM_1_INDEX: 1,
  STREAM_2_INDEX: 2,
  STREAM_3_INDEX: 3,
  STREAM_4_INDEX: 4,
  STREAM_DEFAULT_INDEX: 99,

  TOTAL_LABEL: "Total",
  FALLBACK_VALUE: "-",
  UNKNOWN_TASK_KEY: "UNKNOWN",
  FALLBACK_WORKSTREAM: "General",

  LINE_SEPARATOR: "\n",
  SECTION_DIVIDER: "\n---\n",
  MARKDOWN_LINE_BREAK: "  ",

  TABLE_HEADER_WORKSTREAM: "Workstream",
  TABLE_HEADER_TASKS: "Tareas",
  TABLE_HEADER_P0: "Prioridad P0",
  TABLE_HEADER_P1: "Prioridad P1",

  TABLE_HEADER_KEY: "Clave",
  TABLE_HEADER_TITLE: "Título",
  TABLE_HEADER_PRIORITY: "Prioridad",
  TABLE_HEADER_SIZE: "Tamaño",
  TABLE_HEADER_STATUS: "Estado",
  TABLE_HEADER_ITEM_ID: "ID de Item en GitHub Project #4",

  SECTION_1_TITLE: "## 1. Resumen Ejecutivo por Workstream",
  SECTION_2_TITLE: "## 2. Matriz General de Tareas en GitHub Project #4",
  SECTION_3_TITLE: "## 3. Desglose Detallado de Tareas con Secciones Obligatorias",
  DOCUMENT_TITLE: "# Catálogo de Tareas — Agnostic Multi-Agent Looper",

  LABEL_TARGET_PROJECT: "Target Project",
  LABEL_PROJECT_NODE_ID: "Project Node ID",
  LABEL_TOTAL_TASKS: "Total Tareas",
  LABEL_GENERATION_DATE: "Fecha de Generación",
  LABEL_CLAVE: "Clave",
  LABEL_WORKSTREAM: "Workstream",
  LABEL_PRIORITY: "Prioridad",
  LABEL_SIZE: "Tamaño",
  LABEL_STATUS: "Estado",
  LABEL_ITEM_NODE_ID: "Item Node ID",
  LABEL_URL: "URL",
  LABEL_VIEW_IN_PROJECT: "Ver en GitHub Project #4",

  SECTION_NAME_PROPOSITO: "Propósito de la tarea",
  SECTION_NAME_QUE_SE_ESPERA: "Qué se espera lograr",
  SECTION_NAME_GOAL: "Goal de la tarea",
  SECTION_NAME_CRITERIOS: "Criterios de completitud / Definition of Done",

  MANDATORY_SECTIONS: [
    "Propósito de la tarea",
    "Qué se espera lograr",
    "Goal de la tarea",
    "Criterios de completitud / Definition of Done",
  ] as const,

  TASK_KEY_REGEX: /\[(LOOPER-[A-Z]+-\d+)\]/i,
  SECTION_1_REGEX: /(?:#{1,6}|\*{1,2}|^)\s*(?:1\.?\s*)?Prop[oó]sito de la tarea/i,
  SECTION_2_REGEX: /(?:#{1,6}|\*{1,2}|^)\s*(?:2\.?\s*)?Qu[eé] se espera lograr/i,
  SECTION_3_REGEX: /(?:#{1,6}|\*{1,2}|^)\s*(?:3\.?\s*)?Goal de la tarea/i,
  SECTION_4_REGEX: /(?:#{1,6}|\*{1,2}|^)\s*(?:4\.?\s*)?(?:Criterios de completitud(?:\s*\/\s*Definition of Done)?|Definition of Done)/i,
  CHECKBOX_REGEX: /^\s*-\s*\[([ xX])\]\s*(.*)$/,
  BULLET_REGEX: /^\s*[-*]\s*(.*)$/,
} as const;

/**
 * Standard Workstream Definitions for the Agnostic Multi-Agent Looper.
 */
export const WORKSTREAM_DEFINITIONS = [
  {
    index: CATALOG_CONSTANTS.STREAM_1_INDEX,
    prefix: "LOOPER-CORE",
    name: "Core Looper Engine & FSM Lifecycle",
    streamTitle: "Stream 1: Core Looper Engine & FSM Lifecycle",
  },
  {
    index: CATALOG_CONSTANTS.STREAM_2_INDEX,
    prefix: "LOOPER-PAL",
    name: "Provider Abstraction Layer (PAL) & Normalizers",
    streamTitle: "Stream 2: Provider Abstraction Layer (PAL) & Normalizers",
  },
  {
    index: CATALOG_CONSTANTS.STREAM_3_INDEX,
    prefix: "LOOPER-GATE",
    name: "Objective 4-Tier Verification Harness & Rollback Buffer",
    streamTitle: "Stream 3: Objective 4-Tier Verification Harness & Rollback Buffer",
  },
  {
    index: CATALOG_CONSTANTS.STREAM_4_INDEX,
    prefix: "LOOPER-INT",
    name: "CLI, State Persistence & GitHub Project #4 Integration",
    streamTitle: "Stream 4: CLI, State Persistence & GitHub Project #4 Integration",
  },
] as const;

import {
  type CatalogGeneratorErrorCode,
  CatalogGeneratorError,
} from "./errors";

export {
  type CatalogGeneratorErrorCode,
  CatalogGeneratorError,
};

/**
 * Mandatory 4 Spanish sections parsed from a task's markdown body.
 */
export interface CatalogTaskSection {
  proposito: string;
  queSeEsperaLograr: string;
  goal: string;
  criteriosCompletitud: string[];
}

/**
 * Machine-readable task record matching `tasks_catalog.json`.
 */
export interface CatalogTaskItem {
  task_key: string;
  taskId: string;
  project_item_id: string;
  githubProjectItemId: string;
  title: string;
  workstream: string;
  stream: string;
  status: string;
  priority: string;
  size: string;
  sections_present: string[];
  url: string;
  githubUrl: string;
  sections: CatalogTaskSection;
  body: string;
  rawFields?: Record<string, unknown>;
}

/**
 * Summary statistics for a single workstream in the executive summary table.
 */
export interface WorkstreamSummary {
  streamTitle: string;
  workstream: string;
  totalTasks: number;
  priorityP0: number;
  priorityP1: number;
  otherPriority?: number;
}

/**
 * Project and execution metadata embedded in the catalog header.
 */
export interface CatalogMetadata {
  targetProjectTitle: string;
  targetProjectUrl: string;
  projectNodeId: string;
  totalTasks: number;
  generatedAt: string;
}

/**
 * Options configuring catalog generation and file writing.
 */
export interface CatalogGeneratorOptions {
  outputDir?: string;
  jsonFilename?: string;
  markdownFilename?: string;
  projectTitle?: string;
  projectUrl?: string;
  projectNodeId?: string;
  atomicWrite?: boolean;
  workstreamOverrides?: Record<string, string>;
  validateSchema?: boolean;
  validationOptions?: TaskValidationOptions;
  driftOptions?: DriftDetectionOptions;
}

/**
 * Output payload returned when a catalog generation cycle completes.
 */
export interface CatalogGenerationResult {
  items: CatalogTaskItem[];
  jsonPath: string;
  markdownPath: string;
  jsonContent: string;
  markdownContent: string;
  summary: WorkstreamSummary[];
  totalTasks: number;
  generatedAt: string;
}

/**
 * Extracts canonical task key (e.g. `LOOPER-CORE-001`) from title string.
 */
export function extractTaskKey(title: string): string {
  if (!title) return CATALOG_CONSTANTS.UNKNOWN_TASK_KEY;
  const match = title.match(CATALOG_CONSTANTS.TASK_KEY_REGEX);
  const matchedGroup = match?.[1];
  return matchedGroup ? matchedGroup.toUpperCase() : CATALOG_CONSTANTS.UNKNOWN_TASK_KEY;
}

/**
 * Resolves standard workstream metadata from task key prefix.
 */
export function resolveWorkstream(
  taskKey: string,
  overrides?: Record<string, string>
): { name: string; streamTitle: string; index: number } {
  if (overrides && taskKey in overrides) {
    const customName = overrides[taskKey];
    if (customName) {
      return {
        name: customName,
        streamTitle: customName,
        index: CATALOG_CONSTANTS.STREAM_DEFAULT_INDEX,
      };
    }
  }

  const upperKey = (taskKey || "").toUpperCase();
  for (const def of WORKSTREAM_DEFINITIONS) {
    if (upperKey.includes(def.prefix)) {
      return {
        name: def.name,
        streamTitle: def.streamTitle,
        index: def.index,
      };
    }
  }

  return {
    name: CATALOG_CONSTANTS.FALLBACK_WORKSTREAM,
    streamTitle: CATALOG_CONSTANTS.FALLBACK_WORKSTREAM,
    index: CATALOG_CONSTANTS.STREAM_DEFAULT_INDEX,
  };
}

/**
 * Parses markdown body to extract the 4 mandatory Spanish task sections.
 */
export function parseTaskBodySections(body: string): {
  sections: CatalogTaskSection;
  sectionsPresent: string[];
} {
  const sections: CatalogTaskSection = {
    proposito: "",
    queSeEsperaLograr: "",
    goal: "",
    criteriosCompletitud: [],
  };
  const sectionsPresent: string[] = [];

  if (!body || typeof body !== "string") {
    return { sections, sectionsPresent };
  }

  const lines = body.split(CATALOG_CONSTANTS.LINE_SEPARATOR);
  type SectionKey = "proposito" | "queSeEsperaLograr" | "goal" | "criterios";
  let activeSection: SectionKey | null = null;

  const sectionBuffers: Record<SectionKey, string[]> = {
    proposito: [],
    queSeEsperaLograr: [],
    goal: [],
    criterios: [],
  };

  for (const line of lines) {
    if (CATALOG_CONSTANTS.SECTION_1_REGEX.test(line)) {
      activeSection = "proposito";
      if (!sectionsPresent.includes(CATALOG_CONSTANTS.SECTION_NAME_PROPOSITO)) {
        sectionsPresent.push(CATALOG_CONSTANTS.SECTION_NAME_PROPOSITO);
      }
      continue;
    }

    if (CATALOG_CONSTANTS.SECTION_2_REGEX.test(line)) {
      activeSection = "queSeEsperaLograr";
      if (!sectionsPresent.includes(CATALOG_CONSTANTS.SECTION_NAME_QUE_SE_ESPERA)) {
        sectionsPresent.push(CATALOG_CONSTANTS.SECTION_NAME_QUE_SE_ESPERA);
      }
      continue;
    }

    if (CATALOG_CONSTANTS.SECTION_3_REGEX.test(line)) {
      activeSection = "goal";
      if (!sectionsPresent.includes(CATALOG_CONSTANTS.SECTION_NAME_GOAL)) {
        sectionsPresent.push(CATALOG_CONSTANTS.SECTION_NAME_GOAL);
      }
      continue;
    }

    if (CATALOG_CONSTANTS.SECTION_4_REGEX.test(line)) {
      activeSection = "criterios";
      if (!sectionsPresent.includes(CATALOG_CONSTANTS.SECTION_NAME_CRITERIOS)) {
        sectionsPresent.push(CATALOG_CONSTANTS.SECTION_NAME_CRITERIOS);
      }
      continue;
    }

    if (activeSection) {
      sectionBuffers[activeSection].push(line);
    }
  }

  sections.proposito = sectionBuffers.proposito.join(CATALOG_CONSTANTS.LINE_SEPARATOR).trim();
  sections.queSeEsperaLograr = sectionBuffers.queSeEsperaLograr.join(CATALOG_CONSTANTS.LINE_SEPARATOR).trim();
  sections.goal = sectionBuffers.goal.join(CATALOG_CONSTANTS.LINE_SEPARATOR).trim();

  sections.criteriosCompletitud = sectionBuffers.criterios
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const cbMatch = l.match(CATALOG_CONSTANTS.CHECKBOX_REGEX);
      if (cbMatch?.[2]) return cbMatch[2].trim();
      const bulletMatch = l.match(CATALOG_CONSTANTS.BULLET_REGEX);
      if (bulletMatch?.[1]) return bulletMatch[1].trim();
      return l;
    });

  return { sections, sectionsPresent };
}

/**
 * Synthesizes a standardized markdown body from structured sections.
 */
export function buildBodyFromSections(sections: CatalogTaskSection): string {
  const parts: string[] = [];

  parts.push(`## 1. ${CATALOG_CONSTANTS.SECTION_NAME_PROPOSITO}`);
  parts.push(sections.proposito || "");
  parts.push("");

  parts.push(`## 2. ${CATALOG_CONSTANTS.SECTION_NAME_QUE_SE_ESPERA}`);
  parts.push(sections.queSeEsperaLograr || "");
  parts.push("");

  parts.push(`## 3. ${CATALOG_CONSTANTS.SECTION_NAME_GOAL}`);
  parts.push(sections.goal || "");
  parts.push("");

  parts.push(`## 4. ${CATALOG_CONSTANTS.SECTION_NAME_CRITERIOS}`);
  if (sections.criteriosCompletitud && sections.criteriosCompletitud.length > 0) {
    for (const c of sections.criteriosCompletitud) {
      parts.push(`- [ ] ${c}`);
    }
  } else {
    parts.push(`- [ ] Completeness verified against specification`);
  }

  return parts.join(CATALOG_CONSTANTS.LINE_SEPARATOR);
}

/**
 * Normalizes a raw ProjectV2 item or partial catalog record into a strongly-typed `CatalogTaskItem`.
 */
export function normalizeCatalogItem(
  item: ProjectV2Item | Partial<CatalogTaskItem>,
  defaultProjectUrl: string = CATALOG_CONSTANTS.DEFAULT_PROJECT_URL,
  overrides?: Record<string, string>
): CatalogTaskItem {
  if (!item || typeof item !== "object") {
    throw new CatalogGeneratorError("Cannot normalize null or non-object item", "INVALID_ARGUMENT");
  }

  const rawItem = item as Record<string, unknown>;
  const content = (rawItem["content"] && typeof rawItem["content"] === "object"
    ? rawItem["content"]
    : null) as Record<string, unknown> | null;

  const title = (content?.["title"] ?? rawItem["title"] ?? "") as string;
  const explicitKey = (rawItem["task_key"] ?? rawItem["taskId"]) as string | undefined;
  const taskKey = explicitKey && explicitKey.trim().length > 0 ? explicitKey.trim() : extractTaskKey(title);

  const resolvedWs = resolveWorkstream(taskKey, overrides);
  const workstream = ((rawItem["workstream"] ?? rawItem["stream"]) as string | undefined) || resolvedWs.name;

  const rawBody = (content?.["body"] ?? rawItem["body"] ?? "") as string;
  const rawSections = rawItem["sections"] as Partial<CatalogTaskSection> | undefined;

  let finalSections: CatalogTaskSection;
  let finalSectionsPresent: string[];

  if (rawSections && (rawSections.proposito || rawSections.goal || rawSections.queSeEsperaLograr || rawSections.criteriosCompletitud)) {
    finalSections = {
      proposito: rawSections.proposito || "",
      queSeEsperaLograr: rawSections.queSeEsperaLograr || "",
      goal: rawSections.goal || "",
      criteriosCompletitud: Array.isArray(rawSections.criteriosCompletitud) ? rawSections.criteriosCompletitud : [],
    };
    finalSectionsPresent = Array.isArray(rawItem["sections_present"])
      ? (rawItem["sections_present"] as string[])
      : [...CATALOG_CONSTANTS.MANDATORY_SECTIONS];
  } else {
    const parsed = parseTaskBodySections(rawBody);
    finalSections = parsed.sections;
    finalSectionsPresent = parsed.sectionsPresent;
  }

  const finalBody = rawBody && rawBody.trim().length > 0 ? rawBody.trim() : buildBodyFromSections(finalSections);

  const itemId = String(rawItem["project_item_id"] ?? rawItem["githubProjectItemId"] ?? rawItem["id"] ?? "");
  const status = String(rawItem["status"] ?? CATALOG_CONSTANTS.DEFAULT_STATUS);
  const priority = String(rawItem["priority"] ?? CATALOG_CONSTANTS.DEFAULT_PRIORITY);
  const size = String(rawItem["size"] ?? CATALOG_CONSTANTS.DEFAULT_SIZE);

  const explicitUrl = (content?.["url"] ?? rawItem["url"] ?? rawItem["githubUrl"]) as string | undefined;
  const url =
    explicitUrl && explicitUrl.trim().length > 0 && explicitUrl !== CATALOG_CONSTANTS.DEFAULT_PROJECT_URL
      ? explicitUrl.trim()
      : defaultProjectUrl;

  return {
    task_key: taskKey,
    taskId: taskKey,
    project_item_id: itemId,
    githubProjectItemId: itemId,
    title,
    workstream,
    stream: workstream,
    status,
    priority,
    size,
    sections_present: finalSectionsPresent,
    url,
    githubUrl: url,
    sections: finalSections,
    body: finalBody,
    rawFields: (rawItem["rawFields"] as Record<string, unknown> | undefined) ?? undefined,
  };
}

/**
 * Computes workstream summaries across catalog items.
 */
export function computeWorkstreamSummaries(items: CatalogTaskItem[]): WorkstreamSummary[] {
  const summaries: WorkstreamSummary[] = [];

  for (const def of WORKSTREAM_DEFINITIONS) {
    const streamItems = items.filter((it) => it.workstream === def.name || it.stream === def.name);
    const p0Count = streamItems.filter((it) => it.priority === CATALOG_CONSTANTS.PRIORITY_P0).length;
    const p1Count = streamItems.filter((it) => it.priority === CATALOG_CONSTANTS.PRIORITY_P1).length;
    const otherCount = streamItems.length - p0Count - p1Count;

    summaries.push({
      streamTitle: def.streamTitle,
      workstream: def.name,
      totalTasks: streamItems.length,
      priorityP0: p0Count,
      priorityP1: p1Count,
      otherPriority: otherCount > 0 ? otherCount : undefined,
    });
  }

  const standardNames = new Set<string>(WORKSTREAM_DEFINITIONS.map((d) => d.name));
  const customStreams = new Set<string>();
  for (const it of items) {
    if (!standardNames.has(it.workstream)) {
      customStreams.add(it.workstream);
    }
  }

  for (const customName of customStreams) {
    const customItems = items.filter((it) => it.workstream === customName);
    const p0Count = customItems.filter((it) => it.priority === CATALOG_CONSTANTS.PRIORITY_P0).length;
    const p1Count = customItems.filter((it) => it.priority === CATALOG_CONSTANTS.PRIORITY_P1).length;

    summaries.push({
      streamTitle: customName,
      workstream: customName,
      totalTasks: customItems.length,
      priorityP0: p0Count,
      priorityP1: p1Count,
    });
  }

  return summaries;
}

/**
 * Sorts catalog task items deterministically by workstream index and task key.
 */
export function sortCatalogItems(items: CatalogTaskItem[]): CatalogTaskItem[] {
  const streamRank: Record<string, number> = {};
  for (const def of WORKSTREAM_DEFINITIONS) {
    streamRank[def.name] = def.index;
  }

  return [...items].sort((a, b) => {
    const rankA = streamRank[a.workstream] ?? CATALOG_CONSTANTS.STREAM_DEFAULT_INDEX;
    const rankB = streamRank[b.workstream] ?? CATALOG_CONSTANTS.STREAM_DEFAULT_INDEX;
    if (rankA !== rankB) return rankA - rankB;
    return a.task_key.localeCompare(b.task_key);
  });
}

/**
 * Serializes catalog task items to standard JSON string.
 */
export function formatCatalogJson(
  items: (ProjectV2Item | CatalogTaskItem)[],
  indent: number = CATALOG_CONSTANTS.DEFAULT_JSON_INDENT
): string {
  const normalized = items.map((it) => normalizeCatalogItem(it));
  return JSON.stringify(normalized, null, indent);
}

/**
 * Formats catalog task items into human-readable Markdown format matching `tasks_catalog.md`.
 */
export function formatCatalogMarkdown(
  items: (ProjectV2Item | CatalogTaskItem)[],
  metadata?: Partial<CatalogMetadata>
): string {
  const targetTitle = metadata?.targetProjectTitle || CATALOG_CONSTANTS.DEFAULT_PROJECT_TITLE;
  const targetUrl = metadata?.targetProjectUrl || CATALOG_CONSTANTS.DEFAULT_PROJECT_URL;
  const nodeId = metadata?.projectNodeId || CATALOG_CONSTANTS.DEFAULT_PROJECT_NODE_ID;
  const totalCount = items.length;
  const genDate = metadata?.generatedAt || new Date().toISOString();

  const normalized = items.map((it) => normalizeCatalogItem(it, targetUrl));
  const summaries = computeWorkstreamSummaries(normalized);

  const lines: string[] = [];

  // Header & Metadata
  lines.push(`${CATALOG_CONSTANTS.DOCUMENT_TITLE}\n`);
  lines.push(`**${CATALOG_CONSTANTS.LABEL_TARGET_PROJECT}**: [${targetTitle}](${targetUrl})${CATALOG_CONSTANTS.MARKDOWN_LINE_BREAK}`);
  lines.push(`**${CATALOG_CONSTANTS.LABEL_PROJECT_NODE_ID}**: \`${nodeId}\`${CATALOG_CONSTANTS.MARKDOWN_LINE_BREAK}`);
  lines.push(`**${CATALOG_CONSTANTS.LABEL_TOTAL_TASKS}**: ${totalCount}${CATALOG_CONSTANTS.MARKDOWN_LINE_BREAK}`);
  lines.push(`**${CATALOG_CONSTANTS.LABEL_GENERATION_DATE}**: ${genDate}${CATALOG_CONSTANTS.MARKDOWN_LINE_BREAK}\n`);
  lines.push("---");
  lines.push("");

  // Section 1: Executive Summary Table
  lines.push(`${CATALOG_CONSTANTS.SECTION_1_TITLE}\n`);
  lines.push(
    `| ${CATALOG_CONSTANTS.TABLE_HEADER_WORKSTREAM} | ${CATALOG_CONSTANTS.TABLE_HEADER_TASKS} | ${CATALOG_CONSTANTS.TABLE_HEADER_P0} | ${CATALOG_CONSTANTS.TABLE_HEADER_P1} |`
  );
  lines.push("| :--- | :---: | :---: | :---: |");

  let totalTasksSum = 0;
  let totalP0Sum = 0;
  let totalP1Sum = 0;

  for (const s of summaries) {
    lines.push(`| ${s.streamTitle} | ${s.totalTasks} | ${s.priorityP0} | ${s.priorityP1} |`);
    totalTasksSum += s.totalTasks;
    totalP0Sum += s.priorityP0;
    totalP1Sum += s.priorityP1;
  }
  lines.push(`| **${CATALOG_CONSTANTS.TOTAL_LABEL}** | **${totalTasksSum}** | **${totalP0Sum}** | **${totalP1Sum}** |\n`);
  lines.push("---");
  lines.push("");

  // Section 2: General Tasks Matrix Table
  lines.push(`${CATALOG_CONSTANTS.SECTION_2_TITLE}\n`);
  lines.push(
    `| ${CATALOG_CONSTANTS.TABLE_HEADER_KEY} | ${CATALOG_CONSTANTS.TABLE_HEADER_TITLE} | ${CATALOG_CONSTANTS.TABLE_HEADER_WORKSTREAM} | ${CATALOG_CONSTANTS.TABLE_HEADER_PRIORITY} | ${CATALOG_CONSTANTS.TABLE_HEADER_SIZE} | ${CATALOG_CONSTANTS.TABLE_HEADER_STATUS} | ${CATALOG_CONSTANTS.TABLE_HEADER_ITEM_ID} |`
  );
  lines.push("| :--- | :--- | :--- | :---: | :---: | :---: | :--- |");

  for (const it of normalized) {
    const formattedPriority = it.priority
      ? it.priority.startsWith("**")
        ? it.priority
        : `**${it.priority}**`
      : CATALOG_CONSTANTS.FALLBACK_VALUE;
    const formattedSize = it.size || CATALOG_CONSTANTS.FALLBACK_VALUE;
    const formattedStatus = it.status || CATALOG_CONSTANTS.FALLBACK_VALUE;
    const formattedItemLink = it.project_item_id
      ? `[\`${it.project_item_id}\`](${it.url})`
      : CATALOG_CONSTANTS.FALLBACK_VALUE;

    lines.push(
      `| \`${it.task_key}\` | ${it.title} | ${it.workstream} | ${formattedPriority} | ${formattedSize} | ${formattedStatus} | ${formattedItemLink} |`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Section 3: Detailed Breakdown
  lines.push(`${CATALOG_CONSTANTS.SECTION_3_TITLE}\n`);

  for (const it of normalized) {
    lines.push(`### ${it.title}\n`);
    lines.push(`- **${CATALOG_CONSTANTS.LABEL_CLAVE}**: \`${it.task_key}\``);
    lines.push(`- **${CATALOG_CONSTANTS.LABEL_WORKSTREAM}**: ${it.workstream}`);
    lines.push(
      `- **${CATALOG_CONSTANTS.LABEL_PRIORITY}**: ${it.priority} | **${CATALOG_CONSTANTS.LABEL_SIZE}**: ${it.size} | **${CATALOG_CONSTANTS.LABEL_STATUS}**: ${it.status}`
    );
    lines.push(`- **${CATALOG_CONSTANTS.LABEL_ITEM_NODE_ID}**: \`${it.project_item_id}\``);
    lines.push(`- **${CATALOG_CONSTANTS.LABEL_URL}**: [${CATALOG_CONSTANTS.LABEL_VIEW_IN_PROJECT}](${it.url})\n`);
    lines.push(it.body.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join(CATALOG_CONSTANTS.LINE_SEPARATOR) + CATALOG_CONSTANTS.LINE_SEPARATOR;
}

/**
 * Writes data atomically to disk by staging via a swap file and renaming.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = CATALOG_CONSTANTS.DEFAULT_ENCODING
): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const swapPath = `${filePath}${CATALOG_CONSTANTS.SWAP_SUFFIX}.${randomUUID()}`;
  try {
    await writeFile(swapPath, content, { encoding });
    await rename(swapPath, filePath);
  } catch (err) {
    try {
      if (existsSync(swapPath)) {
        await unlink(swapPath);
      }
    } catch {
      // Ignore swap unlink failure
    }
    try {
      await writeFile(filePath, content, { encoding });
    } catch (writeErr) {
      throw new CatalogGeneratorError(
        `Failed to write file: ${filePath}`,
        "FILE_WRITE_ERROR",
        writeErr
      );
    }
  }
}

/**
 * Reads and parses `tasks_catalog.json` asynchronously.
 */
export async function readCatalogJson(
  filePath = resolve(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR, CATALOG_CONSTANTS.DEFAULT_JSON_FILE)
): Promise<CatalogTaskItem[]> {
  try {
    const raw = await readFile(filePath, { encoding: CATALOG_CONSTANTS.DEFAULT_ENCODING });
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new CatalogGeneratorError(`Catalog root must be an array: ${filePath}`, "PARSE_ERROR");
    }
    return parsed.map((item) => normalizeCatalogItem(item));
  } catch (err) {
    if (err instanceof CatalogGeneratorError) throw err;
    throw new CatalogGeneratorError(`Failed to read catalog at: ${filePath}`, "FILE_READ_ERROR", err);
  }
}

/**
 * Reads and parses `tasks_catalog.json` synchronously.
 */
export function readCatalogJsonSync(
  filePath = resolve(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR, CATALOG_CONSTANTS.DEFAULT_JSON_FILE)
): CatalogTaskItem[] {
  try {
    const raw = readFileSync(filePath, { encoding: CATALOG_CONSTANTS.DEFAULT_ENCODING });
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new CatalogGeneratorError(`Catalog root must be an array: ${filePath}`, "PARSE_ERROR");
    }
    return parsed.map((item) => normalizeCatalogItem(item));
  } catch (err) {
    if (err instanceof CatalogGeneratorError) throw err;
    throw new CatalogGeneratorError(`Failed to read catalog at: ${filePath}`, "FILE_READ_ERROR", err);
  }
}

/**
 * Writes catalog items to JSON file.
 */
export async function writeCatalogJson(
  filePath: string,
  items: (ProjectV2Item | CatalogTaskItem)[],
  indent: number = CATALOG_CONSTANTS.DEFAULT_JSON_INDENT
): Promise<void> {
  const jsonContent = formatCatalogJson(items, indent);
  await atomicWriteFile(filePath, jsonContent);
}

/**
 * Writes catalog items to Markdown file.
 */
export async function writeCatalogMarkdown(
  filePath: string,
  items: (ProjectV2Item | CatalogTaskItem)[],
  metadata?: Partial<CatalogMetadata>
): Promise<void> {
  const markdownContent = formatCatalogMarkdown(items, metadata);
  await atomicWriteFile(filePath, markdownContent);
}

/**
 * Writes both `tasks_catalog.json` and `tasks_catalog.md` simultaneously.
 */
export async function generateCatalogFiles(
  items: (ProjectV2Item | CatalogTaskItem)[],
  options: CatalogGeneratorOptions = {}
): Promise<CatalogGenerationResult> {
  const outputDir = options.outputDir || CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR;
  const jsonFilename = options.jsonFilename || CATALOG_CONSTANTS.DEFAULT_JSON_FILE;
  const markdownFilename = options.markdownFilename || CATALOG_CONSTANTS.DEFAULT_MARKDOWN_FILE;

  const jsonPath = resolve(outputDir, jsonFilename);
  const markdownPath = resolve(outputDir, markdownFilename);

  const normalized = items.map((it) =>
    normalizeCatalogItem(it, options.projectUrl || CATALOG_CONSTANTS.DEFAULT_PROJECT_URL, options.workstreamOverrides)
  );
  const sorted = sortCatalogItems(normalized);

  if (options.validateSchema) {
    assert100PercentCompliance(sorted, options.validationOptions);
  }

  const generatedAt = new Date().toISOString();
  const metadata: CatalogMetadata = {
    targetProjectTitle: options.projectTitle || CATALOG_CONSTANTS.DEFAULT_PROJECT_TITLE,
    targetProjectUrl: options.projectUrl || CATALOG_CONSTANTS.DEFAULT_PROJECT_URL,
    projectNodeId: options.projectNodeId || CATALOG_CONSTANTS.DEFAULT_PROJECT_NODE_ID,
    totalTasks: sorted.length,
    generatedAt,
  };

  const jsonContent = formatCatalogJson(sorted);
  const markdownContent = formatCatalogMarkdown(sorted, metadata);

  await atomicWriteFile(jsonPath, jsonContent);
  await atomicWriteFile(markdownPath, markdownContent);

  const summary = computeWorkstreamSummaries(sorted);

  return {
    items: sorted,
    jsonPath,
    markdownPath,
    jsonContent,
    markdownContent,
    summary,
    totalTasks: sorted.length,
    generatedAt,
  };
}

/**
 * Unified Task Catalog Generator and Synchronization Service.
 */
export class TaskCatalogGenerator {
  private readonly options: CatalogGeneratorOptions;
  readonly validator: TaskSchemaValidator;
  readonly driftDetector: CatalogDriftDetector;

  constructor(options: CatalogGeneratorOptions = {}) {
    this.options = { ...options };
    this.validator = new TaskSchemaValidator(options.validationOptions);
    this.driftDetector = new CatalogDriftDetector(options.driftOptions);
  }

  getOptions(): CatalogGeneratorOptions {
    return { ...this.options };
  }

  validateTask(
    item: CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem> | string,
    options?: TaskValidationOptions
  ): TaskValidationResult {
    return this.validator.validateTask(item, options);
  }

  assertTask(
    item: CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem> | string,
    options?: TaskValidationOptions
  ): TaskValidationResult {
    return this.validator.assertTask(item, options);
  }

  async validateCatalog(
    items?: (ProjectV2Item | CatalogTaskItem)[],
    options?: TaskValidationOptions
  ): Promise<CatalogValidationReport> {
    const targetItems = items || (await this.loadCatalog());
    return this.validator.validateCatalog(targetItems, options);
  }

  validateCatalogSync(
    items?: (ProjectV2Item | CatalogTaskItem)[],
    options?: TaskValidationOptions
  ): CatalogValidationReport {
    const targetItems = items || this.loadCatalogSync();
    return this.validator.validateCatalog(targetItems, options);
  }

  async assert100PercentCompliance(
    items?: (ProjectV2Item | CatalogTaskItem)[],
    options?: TaskValidationOptions
  ): Promise<CatalogValidationReport> {
    const targetItems = items || (await this.loadCatalog());
    return this.validator.assert100PercentCompliance(targetItems, options);
  }

  assert100PercentComplianceSync(
    items?: (ProjectV2Item | CatalogTaskItem)[],
    options?: TaskValidationOptions
  ): CatalogValidationReport {
    const targetItems = items || this.loadCatalogSync();
    return this.validator.assert100PercentCompliance(targetItems, options);
  }

  normalizeItem(item: ProjectV2Item | Partial<CatalogTaskItem>): CatalogTaskItem {
    return normalizeCatalogItem(
      item,
      this.options.projectUrl || CATALOG_CONSTANTS.DEFAULT_PROJECT_URL,
      this.options.workstreamOverrides
    );
  }

  normalizeItems(items: (ProjectV2Item | Partial<CatalogTaskItem>)[]): CatalogTaskItem[] {
    return items.map((it) => this.normalizeItem(it));
  }

  formatJson(items: (ProjectV2Item | CatalogTaskItem)[], indent?: number): string {
    return formatCatalogJson(items, indent);
  }

  formatMarkdown(items: (ProjectV2Item | CatalogTaskItem)[], metadata?: Partial<CatalogMetadata>): string {
    const mergedMetadata: Partial<CatalogMetadata> = {
      targetProjectTitle: this.options.projectTitle || CATALOG_CONSTANTS.DEFAULT_PROJECT_TITLE,
      targetProjectUrl: this.options.projectUrl || CATALOG_CONSTANTS.DEFAULT_PROJECT_URL,
      projectNodeId: this.options.projectNodeId || CATALOG_CONSTANTS.DEFAULT_PROJECT_NODE_ID,
      ...metadata,
    };
    return formatCatalogMarkdown(items, mergedMetadata);
  }

  async generate(items: (ProjectV2Item | CatalogTaskItem)[]): Promise<CatalogGenerationResult> {
    return generateCatalogFiles(items, this.options);
  }

  async generateFromProject(projectService: GitHubProjectService): Promise<CatalogGenerationResult> {
    if (!projectService) {
      throw new CatalogGeneratorError("projectService is required", "INVALID_ARGUMENT");
    }

    try {
      const items = await projectService.getAllItems();
      return this.generate(items);
    } catch (err) {
      throw new CatalogGeneratorError(
        "Failed to fetch items from GitHubProjectService",
        "PROJECT_FETCH_ERROR",
        err
      );
    }
  }

  async loadCatalog(filePath?: string): Promise<CatalogTaskItem[]> {
    const targetPath =
      filePath ||
      resolve(
        this.options.outputDir || CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
        this.options.jsonFilename || CATALOG_CONSTANTS.DEFAULT_JSON_FILE
      );
    return readCatalogJson(targetPath);
  }

  loadCatalogSync(filePath?: string): CatalogTaskItem[] {
    const targetPath =
      filePath ||
      resolve(
        this.options.outputDir || CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
        this.options.jsonFilename || CATALOG_CONSTANTS.DEFAULT_JSON_FILE
      );
    return readCatalogJsonSync(targetPath);
  }

  async updateTaskState(
    taskKeyOrId: string,
    updates: Partial<CatalogTaskItem>
  ): Promise<CatalogGenerationResult> {
    if (!taskKeyOrId || typeof taskKeyOrId !== "string") {
      throw new CatalogGeneratorError("taskKeyOrId must be a non-empty string", "INVALID_ARGUMENT");
    }

    let existingItems: CatalogTaskItem[] = [];
    try {
      existingItems = await this.loadCatalog();
    } catch (e) {
      throw new CatalogGeneratorError(
        `Cannot update task state: could not load catalog`,
        "FILE_READ_ERROR",
        e
      );
    }

    const needle = taskKeyOrId.trim().toUpperCase();
    const targetIndex = existingItems.findIndex(
      (it) =>
        it.task_key.toUpperCase() === needle ||
        it.taskId.toUpperCase() === needle ||
        it.project_item_id.toUpperCase() === needle ||
        it.githubProjectItemId.toUpperCase() === needle
    );

    if (targetIndex === -1) {
      throw new CatalogGeneratorError(`Task '${taskKeyOrId}' not found in catalog`, "INVALID_ARGUMENT");
    }

    const currentItem = existingItems[targetIndex];
    if (!currentItem) {
      throw new CatalogGeneratorError(`Task item at index ${targetIndex} is undefined`, "UNKNOWN_ERROR");
    }

    const mergedRaw = {
      ...currentItem,
      ...updates,
      sections: {
        ...currentItem.sections,
        ...(updates.sections || {}),
      },
    };

    const updatedItem = this.normalizeItem(mergedRaw);
    existingItems[targetIndex] = updatedItem;

    return this.generate(existingItems);
  }

  async syncItems(
    remoteItems: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[]
  ): Promise<CatalogGenerationResult> {
    const normalizedRemote = this.normalizeItems(remoteItems);

    let localItems: CatalogTaskItem[] = [];
    try {
      localItems = await this.loadCatalog();
    } catch {
      localItems = [];
    }

    const itemMap = new Map<string, CatalogTaskItem>();
    for (const local of localItems) {
      itemMap.set(local.task_key.toUpperCase(), local);
    }

    for (const remote of normalizedRemote) {
      const key = remote.task_key.toUpperCase();
      const existing = itemMap.get(key);
      if (existing) {
        itemMap.set(key, {
          ...existing,
          ...remote,
          sections: {
            ...existing.sections,
            ...remote.sections,
          },
        });
      } else {
        itemMap.set(key, remote);
      }
    }

    const merged = Array.from(itemMap.values());
    return this.generate(merged);
  }

  async detectDrift(
    remoteItems: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): Promise<CatalogDriftReport> {
    const localItems = await this.loadCatalog();
    return this.driftDetector.detectDrift(localItems, remoteItems, options);
  }

  detectDriftSync(
    remoteItems: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): CatalogDriftReport {
    const localItems = this.loadCatalogSync();
    return this.driftDetector.detectDriftSync(localItems, remoteItems, options);
  }

  async detectDriftFromProject(
    projectService: GitHubProjectService,
    options?: DriftDetectionOptions
  ): Promise<CatalogDriftReport> {
    if (!projectService) {
      throw new CatalogGeneratorError("projectService is required", "INVALID_ARGUMENT");
    }

    try {
      const remoteItems = await projectService.getAllItems();
      return this.detectDrift(remoteItems, options);
    } catch (err) {
      if (err instanceof CatalogGeneratorError) throw err;
      throw new CatalogGeneratorError(
        "Failed to fetch remote items from GitHubProjectService for drift detection",
        "PROJECT_FETCH_ERROR",
        err
      );
    }
  }

  async assertNoDrift(
    remoteItems: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): Promise<CatalogDriftReport> {
    const localItems = await this.loadCatalog();
    return this.driftDetector.assertNoDrift(localItems, remoteItems, options);
  }

  assertNoDriftSync(
    remoteItems: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): CatalogDriftReport {
    const localItems = this.loadCatalogSync();
    return this.driftDetector.assertNoDrift(localItems, remoteItems, options);
  }

  async syncWithDriftAlerting(
    remoteItems: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): Promise<{ driftReport: CatalogDriftReport; generationResult: CatalogGenerationResult }> {
    const driftReport = await this.detectDrift(remoteItems, options);
    const generationResult = await this.syncItems(remoteItems);
    return {
      driftReport,
      generationResult,
    };
  }
}

/**
 * CLI Entrypoint when invoked directly via `bun src/integration/catalog_generator.ts`.
 */
if (import.meta.main) {
  try {
    const defaultJsonPath = resolve(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR, CATALOG_CONSTANTS.DEFAULT_JSON_FILE);
    if (!existsSync(defaultJsonPath)) {
      console.error(`Catalog file not found at ${defaultJsonPath}`);
      process.exit(1);
    }

    const items = readCatalogJsonSync(defaultJsonPath);
    console.log(`Loaded ${items.length} tasks from ${defaultJsonPath}`);

    const generator = new TaskCatalogGenerator();
    const result = await generator.generate(items);

    console.log(`Successfully regenerated tasks catalog:`);
    console.log(`  JSON:     ${result.jsonPath} (${result.jsonContent.length} bytes)`);
    console.log(`  Markdown: ${result.markdownPath} (${result.markdownContent.length} bytes)`);
    console.log(`  Total Tasks: ${result.totalTasks}`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to run catalog generator:", err);
    process.exit(1);
  }
}
