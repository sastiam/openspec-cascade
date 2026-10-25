/**
 * Task Schema Validator and 100% Mandatory Section Compliance Engine.
 *
 * Implements LOOPER-INT-003 and LOOPER-INT-004 as part of the Provider-Agnostic Multi-Agent
 * Looper specification defined in `projects/agnostic_looper/SPECIFICATION.md` Section 6.4 & 6.5
 * and OpenSpec change `looper-integration-catalog-sync` Task 1.2.
 *
 * Programmatically asserts 100% presence and structural validity of mandatory Spanish task
 * sections across individual tasks and complete project catalogs.
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CATALOG_CONSTANTS,
  type CatalogTaskItem,
  type CatalogTaskSection,
  extractTaskKey,
  normalizeCatalogItem,
  parseTaskBodySections,
} from "./catalog_generator";
import { CatalogGeneratorError } from "./errors";
import type { ProjectV2Item } from "./github_project";

/**
 * Constants governing task schema validation and 100% section presence assertion.
 */
export const SCHEMA_VALIDATOR_CONSTANTS = {
  TOTAL_MANDATORY_SECTIONS: 4,
  PERFECT_COMPLIANCE_PERCENTAGE: 100,
  ZERO_PERCENT: 0,
  MIN_REQUIRED_CHECKBOXES: 1,
  DEFAULT_FLOAT_PRECISION: 2,
  EMPTY_STRING_LENGTH: 0,

  SECTION_KEY_PROPOSITO: "proposito",
  SECTION_KEY_QUE_SE_ESPERA: "queSeEsperaLograr",
  SECTION_KEY_GOAL: "goal",
  SECTION_KEY_CRITERIOS: "criteriosCompletitud",

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

  SECTION_REGEX_MAP: {
    "Propósito de la tarea": /(?:#{1,6}|\*{1,2}|^)\s*(?:1\.?\s*)?Prop[oó]sito de la tarea/i,
    "Qué se espera lograr": /(?:#{1,6}|\*{1,2}|^)\s*(?:2\.?\s*)?Qu[eé] se espera lograr/i,
    "Goal de la tarea": /(?:#{1,6}|\*{1,2}|^)\s*(?:3\.?\s*)?Goal de la tarea/i,
    "Criterios de completitud / Definition of Done": /(?:#{1,6}|\*{1,2}|^)\s*(?:4\.?\s*)?(?:Criterios de completitud(?:\s*\/\s*Definition of Done)?|Definition of Done)/i,
  } as const,

  CHECKBOX_PATTERN: /^\s*[-*]\s*\[([ xX])\]\s*.+/m,
  GLOBAL_CHECKBOX_REGEX: /^\s*[-*]\s*\[([ xX])\]\s*.+/gm,
  TASK_KEY_PATTERN: /^LOOPER-[A-Z]+-\d+$/i,

  ALLOWED_STATUSES: ["Backlog", "In progress", "Done"] as const,
  ALLOWED_PRIORITIES: ["P0", "P1"] as const,

  ERROR_CODE_SCHEMA_VALIDATION: "SCHEMA_VALIDATION_ERROR" as const,

  MSG_EMPTY_CATALOG: "Catalog is empty or contains zero tasks",
  MSG_MISSING_SECTION: "Missing mandatory section",
  MSG_EMPTY_SECTION: "Mandatory section is present but empty",
  MSG_MISSING_CHECKBOXES: "Section 4 must contain at least one verifiable checkbox (- [ ])",
  MSG_INVALID_TASK_KEY: "Task key must match canonical format LOOPER-<STREAM>-<NUM>",
  MSG_INVALID_STATUS: "Task status is not in allowed status set",
  MSG_INVALID_PRIORITY: "Task priority is not in allowed priority set",
  MSG_COMPLIANCE_BELOW_100: "Catalog failed schema validation: compliance rate is below 100%",
} as const;

export type MandatorySectionName = (typeof SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS)[number];

/**
 * Configuration options customizing task schema validation.
 */
export interface TaskValidationOptions {
  requireNonEmptySections?: boolean;
  requireCheckboxes?: boolean;
  minCheckboxesCount?: number;
  requireCanonicalTaskKey?: boolean;
  allowedStatuses?: readonly string[];
  allowedPriorities?: readonly string[];
  allowEmptyCatalog?: boolean;
}

/**
 * Detailed validation verdict for a single mandatory task section.
 */
export interface SectionValidationDetail {
  name: MandatorySectionName;
  present: boolean;
  nonEmpty: boolean;
  contentLength: number;
  error?: string;
}

/**
 * Comprehensive validation result for an individual task.
 */
export interface TaskValidationResult {
  taskKey: string;
  title: string;
  valid: boolean;
  isFullyCompliant: boolean;
  sectionsPresentCount: number;
  sectionsTotalCount: number;
  coveragePercentage: number;
  sectionDetails: Record<MandatorySectionName, SectionValidationDetail>;
  missingSections: MandatorySectionName[];
  emptySections: MandatorySectionName[];
  checkboxCount: number;
  hasCheckboxes: boolean;
  status?: string;
  priority?: string;
  size?: string;
  errors: string[];
}

/**
 * Workstream-wide or catalog-wide summary for a single mandatory section.
 */
export interface SectionCoverageSummary {
  sectionName: MandatorySectionName;
  presentCount: number;
  nonEmptyCount: number;
  totalTasks: number;
  presenceRate: number;
  nonEmptyRate: number;
}

/**
 * Global audit report across an entire task catalog.
 */
export interface CatalogValidationReport {
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  complianceRate: number;
  allCompliant: boolean;
  sectionSummaries: Record<MandatorySectionName, SectionCoverageSummary>;
  taskResults: TaskValidationResult[];
  failedTaskKeys: string[];
  errors: string[];
}

/**
 * Domain error raised when 100% schema compliance assertion fails.
 */
export class SchemaValidationError extends CatalogGeneratorError {
  readonly report?: CatalogValidationReport;
  readonly taskResult?: TaskValidationResult;

  constructor(
    message: string,
    options?: {
      report?: CatalogValidationReport;
      taskResult?: TaskValidationResult;
      cause?: unknown;
    }
  ) {
    super(message, SCHEMA_VALIDATOR_CONSTANTS.ERROR_CODE_SCHEMA_VALIDATION, options?.cause);
    this.name = "SchemaValidationError";
    this.report = options?.report;
    this.taskResult = options?.taskResult;
  }
}

/**
 * Helper inspecting whether a markdown section has non-whitespace characters.
 */
function isSectionNonEmpty(content: string | string[] | undefined): boolean {
  if (content === undefined || content === null) {
    return false;
  }
  if (Array.isArray(content)) {
    return content.some((item) => typeof item === "string" && item.trim().length > SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH);
  }
  if (typeof content === "string") {
    return content.trim().length > SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH;
  }
  return false;
}

/**
 * Calculates string or list character length for validation telemetry.
 */
function getSectionLength(content: string | string[] | undefined): number {
  if (content === undefined || content === null) {
    return SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH;
  }
  if (Array.isArray(content)) {
    return content.reduce((sum, line) => sum + (typeof line === "string" ? line.trim().length : 0), 0);
  }
  if (typeof content === "string") {
    return content.trim().length;
  }
  return SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH;
}

/**
 * Validates an individual task item or raw markdown body against the mandatory 4 Spanish sections schema.
 */
export function validateTaskSchema(
  item: CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem> | string,
  options: TaskValidationOptions = {}
): TaskValidationResult {
  const requireNonEmpty = options.requireNonEmptySections ?? true;
  const requireCheckboxes = options.requireCheckboxes ?? true;
  const minCheckboxes = options.minCheckboxesCount ?? SCHEMA_VALIDATOR_CONSTANTS.MIN_REQUIRED_CHECKBOXES;
  const requireCanonicalKey = options.requireCanonicalTaskKey ?? true;

  let normalized: CatalogTaskItem;
  if (typeof item === "string") {
    const parsedSections = parseTaskBodySections(item);
    const key = extractTaskKey(item);
    normalized = normalizeCatalogItem({
      task_key: key,
      title: key !== CATALOG_CONSTANTS.UNKNOWN_TASK_KEY ? `[${key}] Markdown Task` : "Markdown Task",
      body: item,
      sections: parsedSections.sections,
      sections_present: parsedSections.sectionsPresent,
    });
  } else {
    normalized = normalizeCatalogItem(item);
  }

  const errors: string[] = [];
  const missingSections: MandatorySectionName[] = [];
  const emptySections: MandatorySectionName[] = [];

  const sectionDetails: Record<MandatorySectionName, SectionValidationDetail> = {
    "Propósito de la tarea": {
      name: "Propósito de la tarea",
      present: false,
      nonEmpty: false,
      contentLength: SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH,
    },
    "Qué se espera lograr": {
      name: "Qué se espera lograr",
      present: false,
      nonEmpty: false,
      contentLength: SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH,
    },
    "Goal de la tarea": {
      name: "Goal de la tarea",
      present: false,
      nonEmpty: false,
      contentLength: SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH,
    },
    "Criterios de completitud / Definition of Done": {
      name: "Criterios de completitud / Definition of Done",
      present: false,
      nonEmpty: false,
      contentLength: SCHEMA_VALIDATOR_CONSTANTS.EMPTY_STRING_LENGTH,
    },
  };

  const sectionContentMap: Record<MandatorySectionName, string | string[]> = {
    "Propósito de la tarea": normalized.sections.proposito,
    "Qué se espera lograr": normalized.sections.queSeEsperaLograr,
    "Goal de la tarea": normalized.sections.goal,
    "Criterios de completitud / Definition of Done": normalized.sections.criteriosCompletitud,
  };

  let sectionsPresentCount = 0;

  for (const sectionName of SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS) {
    const regex = SCHEMA_VALIDATOR_CONSTANTS.SECTION_REGEX_MAP[sectionName];
    const presentInMetadata = normalized.sections_present.includes(sectionName);
    const presentInBody = regex.test(normalized.body);
    const isPresent = presentInMetadata || presentInBody;

    const content = sectionContentMap[sectionName];
    const hasContent = isSectionNonEmpty(content);
    const length = getSectionLength(content);

    const detail: SectionValidationDetail = {
      name: sectionName,
      present: isPresent,
      nonEmpty: hasContent,
      contentLength: length,
    };

    if (isPresent) {
      sectionsPresentCount++;
    } else {
      missingSections.push(sectionName);
      const errMsg = `${SCHEMA_VALIDATOR_CONSTANTS.MSG_MISSING_SECTION}: '${sectionName}'`;
      detail.error = errMsg;
      errors.push(errMsg);
    }

    if (isPresent && requireNonEmpty && !hasContent) {
      emptySections.push(sectionName);
      const errMsg = `${SCHEMA_VALIDATOR_CONSTANTS.MSG_EMPTY_SECTION}: '${sectionName}'`;
      detail.error = errMsg;
      errors.push(errMsg);
    }

    sectionDetails[sectionName] = detail;
  }

  // Interactive Checkbox Validation
  const checkboxMatches = normalized.body.match(SCHEMA_VALIDATOR_CONSTANTS.GLOBAL_CHECKBOX_REGEX);
  const checkboxCount = checkboxMatches ? checkboxMatches.length : 0;
  const hasCheckboxes = checkboxCount >= minCheckboxes;

  if (requireCheckboxes && !hasCheckboxes) {
    errors.push(SCHEMA_VALIDATOR_CONSTANTS.MSG_MISSING_CHECKBOXES);
  }

  // Canonical Task Key Validation
  if (requireCanonicalKey) {
    const isCanonical = SCHEMA_VALIDATOR_CONSTANTS.TASK_KEY_PATTERN.test(normalized.task_key);
    if (!isCanonical) {
      errors.push(
        `${SCHEMA_VALIDATOR_CONSTANTS.MSG_INVALID_TASK_KEY} (received: '${normalized.task_key}')`
      );
    }
  }

  // Allowed Status Validation
  if (options.allowedStatuses && options.allowedStatuses.length > 0) {
    if (!options.allowedStatuses.includes(normalized.status)) {
      errors.push(
        `${SCHEMA_VALIDATOR_CONSTANTS.MSG_INVALID_STATUS} '${normalized.status}'. Allowed: ${options.allowedStatuses.join(", ")}`
      );
    }
  }

  // Allowed Priority Validation
  if (options.allowedPriorities && options.allowedPriorities.length > 0) {
    if (!options.allowedPriorities.includes(normalized.priority)) {
      errors.push(
        `${SCHEMA_VALIDATOR_CONSTANTS.MSG_INVALID_PRIORITY} '${normalized.priority}'. Allowed: ${options.allowedPriorities.join(", ")}`
      );
    }
  }

  const coveragePercentage =
    (sectionsPresentCount / SCHEMA_VALIDATOR_CONSTANTS.TOTAL_MANDATORY_SECTIONS) *
    SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE;

  const isFullyCompliant =
    sectionsPresentCount === SCHEMA_VALIDATOR_CONSTANTS.TOTAL_MANDATORY_SECTIONS &&
    emptySections.length === 0 &&
    (!requireCheckboxes || hasCheckboxes);

  const valid = errors.length === 0;

  return {
    taskKey: normalized.task_key,
    title: normalized.title,
    valid,
    isFullyCompliant,
    sectionsPresentCount,
    sectionsTotalCount: SCHEMA_VALIDATOR_CONSTANTS.TOTAL_MANDATORY_SECTIONS,
    coveragePercentage,
    sectionDetails,
    missingSections,
    emptySections,
    checkboxCount,
    hasCheckboxes,
    status: normalized.status,
    priority: normalized.priority,
    size: normalized.size,
    errors,
  };
}

/**
 * Asserts an individual task satisfies 100% of mandatory schema requirements, throwing SchemaValidationError on failure.
 */
export function assertTask100PercentCompliance(
  item: CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem> | string,
  options: TaskValidationOptions = {}
): TaskValidationResult {
  const result = validateTaskSchema(item, options);
  if (!result.valid || !result.isFullyCompliant) {
    const message = `Task [${result.taskKey}] failed 100% schema validation: ${result.errors.join("; ")}`;
    throw new SchemaValidationError(message, { taskResult: result });
  }
  return result;
}

/**
 * Validates a catalog of tasks, asserting section presence and computing compliance metrics.
 */
export function validateCatalogSchema(
  items: (CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem>)[],
  options: TaskValidationOptions = {}
): CatalogValidationReport {
  const totalTasks = items ? items.length : 0;
  const allowEmpty = options.allowEmptyCatalog ?? false;

  const sectionSummaries: Record<MandatorySectionName, SectionCoverageSummary> = {
    "Propósito de la tarea": {
      sectionName: "Propósito de la tarea",
      presentCount: 0,
      nonEmptyCount: 0,
      totalTasks,
      presenceRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
      nonEmptyRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
    },
    "Qué se espera lograr": {
      sectionName: "Qué se espera lograr",
      presentCount: 0,
      nonEmptyCount: 0,
      totalTasks,
      presenceRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
      nonEmptyRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
    },
    "Goal de la tarea": {
      sectionName: "Goal de la tarea",
      presentCount: 0,
      nonEmptyCount: 0,
      totalTasks,
      presenceRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
      nonEmptyRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
    },
    "Criterios de completitud / Definition of Done": {
      sectionName: "Criterios de completitud / Definition of Done",
      presentCount: 0,
      nonEmptyCount: 0,
      totalTasks,
      presenceRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
      nonEmptyRate: SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
    },
  };

  if (totalTasks === 0) {
    const errors = allowEmpty ? [] : [SCHEMA_VALIDATOR_CONSTANTS.MSG_EMPTY_CATALOG];
    return {
      totalTasks: 0,
      passedTasks: 0,
      failedTasks: 0,
      complianceRate: allowEmpty
        ? SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE
        : SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT,
      allCompliant: allowEmpty,
      sectionSummaries,
      taskResults: [],
      failedTaskKeys: [],
      errors,
    };
  }

  const taskResults: TaskValidationResult[] = [];
  const failedTaskKeys: string[] = [];
  const errors: string[] = [];
  let passedTasks = 0;
  let failedTasks = 0;

  for (const rawItem of items) {
    const result = validateTaskSchema(rawItem, options);
    taskResults.push(result);

    if (result.valid && result.isFullyCompliant) {
      passedTasks++;
    } else {
      failedTasks++;
      failedTaskKeys.push(result.taskKey);
      errors.push(`[${result.taskKey}]: ${result.errors.join("; ")}`);
    }

    // Accumulate section statistics
    for (const sectionName of SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS) {
      const detail = result.sectionDetails[sectionName];
      if (detail?.present) {
        sectionSummaries[sectionName].presentCount++;
      }
      if (detail?.nonEmpty) {
        sectionSummaries[sectionName].nonEmptyCount++;
      }
    }
  }

  // Compute coverage rates per section
  for (const sectionName of SCHEMA_VALIDATOR_CONSTANTS.MANDATORY_SECTIONS) {
    const summary = sectionSummaries[sectionName];
    summary.totalTasks = totalTasks;
    summary.presenceRate =
      totalTasks > 0
        ? (summary.presentCount / totalTasks) * SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE
        : SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT;
    summary.nonEmptyRate =
      totalTasks > 0
        ? (summary.nonEmptyCount / totalTasks) * SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE
        : SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT;
  }

  const complianceRate =
    totalTasks > 0
      ? (passedTasks / totalTasks) * SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE
      : SCHEMA_VALIDATOR_CONSTANTS.ZERO_PERCENT;

  const allCompliant =
    failedTasks === 0 &&
    passedTasks === totalTasks &&
    complianceRate === SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE;

  return {
    totalTasks,
    passedTasks,
    failedTasks,
    complianceRate,
    allCompliant,
    sectionSummaries,
    taskResults,
    failedTaskKeys,
    errors,
  };
}

/**
 * Asserts 100% presence and compliance of mandatory task sections across all items in a catalog.
 * Throws SchemaValidationError if compliance is less than 100%.
 */
export function assert100PercentCompliance(
  items: (CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem>)[],
  options: TaskValidationOptions = {}
): CatalogValidationReport {
  const report = validateCatalogSchema(items, options);
  if (!report.allCompliant || report.complianceRate < SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE) {
    const formattedRate = report.complianceRate.toFixed(SCHEMA_VALIDATOR_CONSTANTS.DEFAULT_FLOAT_PRECISION);
    const message = `${SCHEMA_VALIDATOR_CONSTANTS.MSG_COMPLIANCE_BELOW_100} (${formattedRate}% < 100%). Failed tasks (${report.failedTasks}/${report.totalTasks}): [${report.failedTaskKeys.join(", ")}]. Errors: ${report.errors.join(" | ")}`;
    throw new SchemaValidationError(message, { report });
  }
  return report;
}

/**
 * Schema Validator Service for tasks and task catalogs.
 */
export class TaskSchemaValidator {
  private readonly defaultOptions: TaskValidationOptions;

  constructor(defaultOptions: TaskValidationOptions = {}) {
    this.defaultOptions = { ...defaultOptions };
  }

  getOptions(): TaskValidationOptions {
    return { ...this.defaultOptions };
  }

  validateTask(
    item: CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem> | string,
    options?: TaskValidationOptions
  ): TaskValidationResult {
    return validateTaskSchema(item, { ...this.defaultOptions, ...options });
  }

  assertTask(
    item: CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem> | string,
    options?: TaskValidationOptions
  ): TaskValidationResult {
    return assertTask100PercentCompliance(item, { ...this.defaultOptions, ...options });
  }

  validateCatalog(
    items: (CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem>)[],
    options?: TaskValidationOptions
  ): CatalogValidationReport {
    return validateCatalogSchema(items, { ...this.defaultOptions, ...options });
  }

  assert100PercentCompliance(
    items: (CatalogTaskItem | ProjectV2Item | Partial<CatalogTaskItem>)[],
    options?: TaskValidationOptions
  ): CatalogValidationReport {
    return assert100PercentCompliance(items, { ...this.defaultOptions, ...options });
  }

  async validateFile(
    filePath = resolve(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR, CATALOG_CONSTANTS.DEFAULT_JSON_FILE),
    options?: TaskValidationOptions
  ): Promise<CatalogValidationReport> {
    try {
      const raw = await readFile(filePath, { encoding: CATALOG_CONSTANTS.DEFAULT_ENCODING });
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new CatalogGeneratorError(`Catalog root must be an array: ${filePath}`, "PARSE_ERROR");
      }
      return this.validateCatalog(parsed, options);
    } catch (err) {
      if (err instanceof CatalogGeneratorError) throw err;
      throw new CatalogGeneratorError(`Failed to read catalog at: ${filePath}`, "FILE_READ_ERROR", err);
    }
  }

  validateFileSync(
    filePath = resolve(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR, CATALOG_CONSTANTS.DEFAULT_JSON_FILE),
    options?: TaskValidationOptions
  ): CatalogValidationReport {
    try {
      if (!existsSync(filePath)) {
        throw new CatalogGeneratorError(`Catalog file not found: ${filePath}`, "FILE_READ_ERROR");
      }
      const raw = readFileSync(filePath, { encoding: CATALOG_CONSTANTS.DEFAULT_ENCODING });
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new CatalogGeneratorError(`Catalog root must be an array: ${filePath}`, "PARSE_ERROR");
      }
      return this.validateCatalog(parsed, options);
    } catch (err) {
      if (err instanceof CatalogGeneratorError) throw err;
      throw new CatalogGeneratorError(`Failed to read catalog at: ${filePath}`, "FILE_READ_ERROR", err);
    }
  }

  async assertFile100PercentCompliance(
    filePath = resolve(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR, CATALOG_CONSTANTS.DEFAULT_JSON_FILE),
    options?: TaskValidationOptions
  ): Promise<CatalogValidationReport> {
    const report = await this.validateFile(filePath, options);
    if (!report.allCompliant || report.complianceRate < SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE) {
      const formattedRate = report.complianceRate.toFixed(SCHEMA_VALIDATOR_CONSTANTS.DEFAULT_FLOAT_PRECISION);
      const message = `File '${filePath}' failed 100% schema validation: compliance is ${formattedRate}%. Failed tasks: [${report.failedTaskKeys.join(", ")}]`;
      throw new SchemaValidationError(message, { report });
    }
    return report;
  }

  assertFileSync100PercentCompliance(
    filePath = resolve(CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR, CATALOG_CONSTANTS.DEFAULT_JSON_FILE),
    options?: TaskValidationOptions
  ): CatalogValidationReport {
    const report = this.validateFileSync(filePath, options);
    if (!report.allCompliant || report.complianceRate < SCHEMA_VALIDATOR_CONSTANTS.PERFECT_COMPLIANCE_PERCENTAGE) {
      const formattedRate = report.complianceRate.toFixed(SCHEMA_VALIDATOR_CONSTANTS.DEFAULT_FLOAT_PRECISION);
      const message = `File '${filePath}' failed 100% schema validation: compliance is ${formattedRate}%. Failed tasks: [${report.failedTaskKeys.join(", ")}]`;
      throw new SchemaValidationError(message, { report });
    }
    return report;
  }
}
