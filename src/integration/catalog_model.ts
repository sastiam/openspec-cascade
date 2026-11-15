/**
 * Catalog primitives (constants, item model, task-body parsing, catalog JSON readers) shared by the generator, drift detector and schema validator.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ProjectV2Item } from "./github_project";
import { CatalogGeneratorError } from "./errors";

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
