/**
 * Catalog Drift Detection and Alerting Engine.
 *
 * Implements LOOPER-INT-003 as part of the Provider-Agnostic Multi-Agent Looper
 * specification defined in `projects/agnostic_looper/SPECIFICATION.md` Section 6.4 & 6.5
 * and OpenSpec change `looper-integration-catalog-sync` Task 1.3.
 *
 * Discovers and alerts on discrepancies between remote GitHub Project #4 items and local
 * repository state (`tasks_catalog.json` / `tasks_catalog.md`). Detects added, removed,
 * and modified tasks across status, priority, size, title, URL, body, mandatory sections,
 * and definition of done checkboxes.
 */

import { randomUUID } from "node:crypto";
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
  readCatalogJson,
  readCatalogJsonSync,
} from "./catalog_generator";
import {
  type CatalogGeneratorErrorCode,
  CatalogGeneratorError,
} from "./errors";
import type { GitHubProjectService, ProjectV2Item } from "./github_project";

/**
 * Constants governing catalog drift detection, threshold evaluation, and alerting.
 */
export const DRIFT_CONSTANTS = {
  SEVERITY_INFO: "INFO" as const,
  SEVERITY_WARNING: "WARNING" as const,
  SEVERITY_ERROR: "ERROR" as const,
  SEVERITY_CRITICAL: "CRITICAL" as const,

  SEVERITY_RANK: {
    INFO: 1,
    WARNING: 2,
    ERROR: 3,
    CRITICAL: 4,
  } as const,

  TYPE_ITEM_ADDED: "ITEM_ADDED" as const,
  TYPE_ITEM_REMOVED: "ITEM_REMOVED" as const,
  TYPE_FIELD_MODIFIED: "FIELD_MODIFIED" as const,
  TYPE_SECTIONS_MODIFIED: "SECTIONS_MODIFIED" as const,
  TYPE_CHECKLIST_MODIFIED: "CHECKLIST_MODIFIED" as const,

  FIELD_STATUS: "status" as const,
  FIELD_PRIORITY: "priority" as const,
  FIELD_SIZE: "size" as const,
  FIELD_TITLE: "title" as const,
  FIELD_URL: "url" as const,
  FIELD_WORKSTREAM: "workstream" as const,
  FIELD_BODY: "body" as const,
  FIELD_SECTIONS: "sections" as const,
  FIELD_CHECKLIST: "checklist" as const,

  DEFAULT_FIELDS_TO_COMPARE: [
    "status",
    "priority",
    "size",
    "title",
    "url",
    "workstream",
    "sections",
    "checklist",
  ] as const,

  DEFAULT_SEVERITY_MAPPING: {
    ITEM_ADDED: "WARNING" as const,
    ITEM_REMOVED: "CRITICAL" as const,
    status: "WARNING" as const,
    priority: "ERROR" as const,
    size: "WARNING" as const,
    title: "WARNING" as const,
    url: "INFO" as const,
    workstream: "WARNING" as const,
    body: "INFO" as const,
    sections: "WARNING" as const,
    checklist: "WARNING" as const,
  } as const,

  ERROR_CODE_DRIFT: "CATALOG_DRIFT_DETECTED" as const,

  ALERT_SINK_MEMORY: "memory" as const,
  ALERT_SINK_CONSOLE: "console" as const,
  ALERT_SINK_ALL: "all" as const,

  DEFAULT_MAX_ALLOWED_DRIFT: 0,
  DEFAULT_IGNORE_WHITESPACE: true,
  ZERO_COUNT: 0,
  SINGLE_COUNT: 1,

  FALLBACK_VALUE_NONE: "(none)",
  FALLBACK_UNKNOWN_KEY: "UNKNOWN",

  ALERT_EMOJIS: {
    INFO: "ℹ️",
    WARNING: "⚠️",
    ERROR: "🚨",
    CRITICAL: "🔥",
  } as const,

  ALERT_PREFIX: "[DRIFT ALERT]",
  REPORT_TITLE: "# Catalog Drift Detection & Synchronization Alert Report",
} as const;

export type DriftSeverity =
  | typeof DRIFT_CONSTANTS.SEVERITY_INFO
  | typeof DRIFT_CONSTANTS.SEVERITY_WARNING
  | typeof DRIFT_CONSTANTS.SEVERITY_ERROR
  | typeof DRIFT_CONSTANTS.SEVERITY_CRITICAL;

export type DriftType =
  | typeof DRIFT_CONSTANTS.TYPE_ITEM_ADDED
  | typeof DRIFT_CONSTANTS.TYPE_ITEM_REMOVED
  | typeof DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED
  | typeof DRIFT_CONSTANTS.TYPE_SECTIONS_MODIFIED
  | typeof DRIFT_CONSTANTS.TYPE_CHECKLIST_MODIFIED;

/**
 * Granular difference description for an individual field or section.
 */
export interface FieldDriftDetail {
  field: string;
  driftType: DriftType;
  severity: DriftSeverity;
  localValue: unknown;
  remoteValue: unknown;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Verification verdict and difference breakdown for a single task.
 */
export interface TaskDriftResult {
  taskKey: string;
  itemId: string;
  title: string;
  hasDrift: boolean;
  driftTypes: DriftType[];
  maxSeverity: DriftSeverity;
  diffs: FieldDriftDetail[];
  localItem?: CatalogTaskItem;
  remoteItem?: CatalogTaskItem;
}

/**
 * Structured alert payload dispatched when drift is detected.
 */
export interface DriftAlert {
  id: string;
  timestamp: string;
  severity: DriftSeverity;
  taskKey: string;
  driftType: DriftType;
  field?: string;
  message: string;
  localValue?: unknown;
  remoteValue?: unknown;
}

export type DriftAlertHandler = (alert: DriftAlert) => void | Promise<void>;

/**
 * Summary metrics aggregated across the drift audit.
 */
export interface DriftSummaryStats {
  totalLocalTasks: number;
  totalRemoteTasks: number;
  totalTasksAudited: number;
  tasksInSyncCount: number;
  tasksWithDriftCount: number;
  addedInRemoteCount: number;
  removedInRemoteCount: number;
  modifiedCount: number;
  totalFieldDiffsCount: number;
  alertsCountBySeverity: Record<DriftSeverity, number>;
}

/**
 * Comprehensive audit report detailing state divergence between remote and local tasks.
 */
export interface CatalogDriftReport {
  timestamp: string;
  hasDrift: boolean;
  stats: DriftSummaryStats;
  taskDrifts: TaskDriftResult[];
  driftedTaskKeys: string[];
  alerts: DriftAlert[];
  formattedSummary: string;
  formattedMarkdown: string;
}

/**
 * Checkbox status extracted from Section 4 DoD items.
 */
export interface TaskChecklistState {
  total: number;
  checkedCount: number;
  uncheckedCount: number;
  items: Array<{ text: string; checked: boolean }>;
}

/**
 * Configuration options customizing drift detection behavior and alerting.
 */
export interface DriftDetectionOptions {
  failOnDrift?: boolean;
  maxAllowedDrift?: number;
  fieldsToCompare?: readonly string[];
  ignoredFields?: readonly string[];
  ignoreWhitespace?: boolean;
  minSeverityToAlert?: DriftSeverity;
  onAlert?: DriftAlertHandler;
  alertSink?: typeof DRIFT_CONSTANTS.ALERT_SINK_MEMORY | typeof DRIFT_CONSTANTS.ALERT_SINK_CONSOLE | typeof DRIFT_CONSTANTS.ALERT_SINK_ALL;
  customSeverityMapping?: Partial<Record<string, DriftSeverity>>;
  projectUrl?: string;
  workstreamOverrides?: Record<string, string>;
}

/**
 * Domain error raised when catalog drift assertion fails.
 */
export class CatalogDriftError extends CatalogGeneratorError {
  readonly report: CatalogDriftReport;

  constructor(message: string, report: CatalogDriftReport, cause?: unknown) {
    super(message, DRIFT_CONSTANTS.ERROR_CODE_DRIFT, cause);
    this.name = "CatalogDriftError";
    this.report = report;
  }
}

/**
 * Normalizes text for whitespace-invariant comparison.
 */
export function normalizeTextForComparison(text: string | undefined | null): string {
  if (text === undefined || text === null) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/**
 * Extracts checklist items and their checked state from a task body or section.
 */
export function extractTaskChecklist(bodyOrCriterios: string | string[]): TaskChecklistState {
  const items: Array<{ text: string; checked: boolean }> = [];

  if (Array.isArray(bodyOrCriterios)) {
    for (const line of bodyOrCriterios) {
      if (!line || typeof line !== "string") continue;
      const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        const isChecked = match[1].toLowerCase() === "x";
        items.push({ text: match[2].trim(), checked: isChecked });
      } else {
        items.push({ text: line.trim(), checked: false });
      }
    }
  } else if (typeof bodyOrCriterios === "string") {
    const lines = bodyOrCriterios.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        const isChecked = match[1].toLowerCase() === "x";
        items.push({ text: match[2].trim(), checked: isChecked });
      }
    }
  }

  const checkedCount = items.filter((it) => it.checked).length;
  const uncheckedCount = items.length - checkedCount;

  return {
    total: items.length,
    checkedCount,
    uncheckedCount,
    items,
  };
}

/**
 * Resolves severity level for a drift type or field name.
 */
export function resolveDriftSeverity(
  keyOrField: string,
  options?: DriftDetectionOptions
): DriftSeverity {
  if (options?.customSeverityMapping && keyOrField in options.customSeverityMapping) {
    const custom = options.customSeverityMapping[keyOrField];
    if (custom) return custom;
  }

  const defaults = DRIFT_CONSTANTS.DEFAULT_SEVERITY_MAPPING;
  if (keyOrField in defaults) {
    return defaults[keyOrField as keyof typeof defaults];
  }

  return DRIFT_CONSTANTS.SEVERITY_WARNING;
}

/**
 * Determines whether a severity meets or exceeds the minimum alert severity threshold.
 */
export function isSeverityEligible(
  severity: DriftSeverity,
  minSeverity: DriftSeverity = DRIFT_CONSTANTS.SEVERITY_INFO
): boolean {
  const ranks = DRIFT_CONSTANTS.SEVERITY_RANK;
  return (ranks[severity] ?? 0) >= (ranks[minSeverity] ?? 0);
}

/**
 * Computes the highest severity across a list of diffs.
 */
export function computeMaxSeverity(diffs: FieldDriftDetail[]): DriftSeverity {
  let highest: DriftSeverity = DRIFT_CONSTANTS.SEVERITY_INFO;
  const ranks = DRIFT_CONSTANTS.SEVERITY_RANK;

  for (const diff of diffs) {
    if ((ranks[diff.severity] ?? 0) > (ranks[highest] ?? 0)) {
      highest = diff.severity;
    }
  }

  return highest;
}

/**
 * Compares two normalized task items and identifies field-level drift.
 */
export function compareTaskItems(
  localItem: CatalogTaskItem,
  remoteItem: CatalogTaskItem,
  options: DriftDetectionOptions = {}
): TaskDriftResult {
  const diffs: FieldDriftDetail[] = [];
  const driftTypesSet = new Set<DriftType>();

  const fieldsToCompare = options.fieldsToCompare || DRIFT_CONSTANTS.DEFAULT_FIELDS_TO_COMPARE;
  const ignoredFields = new Set(options.ignoredFields || []);
  const ignoreWhitespace = options.ignoreWhitespace ?? DRIFT_CONSTANTS.DEFAULT_IGNORE_WHITESPACE;

  const isFieldAudited = (f: string) => fieldsToCompare.includes(f) && !ignoredFields.has(f);

  // 1. Status comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_STATUS)) {
    if (localItem.status !== remoteItem.status) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_STATUS,
        driftType: DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_STATUS, options),
        localValue: localItem.status,
        remoteValue: remoteItem.status,
        message: `Status diverges: local is '${localItem.status}', remote is '${remoteItem.status}'`,
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED);
    }
  }

  // 2. Priority comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_PRIORITY)) {
    if (localItem.priority !== remoteItem.priority) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_PRIORITY,
        driftType: DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_PRIORITY, options),
        localValue: localItem.priority,
        remoteValue: remoteItem.priority,
        message: `Priority diverges: local is '${localItem.priority}', remote is '${remoteItem.priority}'`,
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED);
    }
  }

  // 3. Size comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_SIZE)) {
    if (localItem.size !== remoteItem.size) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_SIZE,
        driftType: DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_SIZE, options),
        localValue: localItem.size,
        remoteValue: remoteItem.size,
        message: `Size diverges: local is '${localItem.size}', remote is '${remoteItem.size}'`,
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED);
    }
  }

  // 4. Title comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_TITLE)) {
    const localTitle = ignoreWhitespace ? localItem.title.trim() : localItem.title;
    const remoteTitle = ignoreWhitespace ? remoteItem.title.trim() : remoteItem.title;
    if (localTitle !== remoteTitle) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_TITLE,
        driftType: DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_TITLE, options),
        localValue: localItem.title,
        remoteValue: remoteItem.title,
        message: `Title diverges: local '${localItem.title}' != remote '${remoteItem.title}'`,
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED);
    }
  }

  // 5. Workstream comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_WORKSTREAM)) {
    if (localItem.workstream !== remoteItem.workstream) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_WORKSTREAM,
        driftType: DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_WORKSTREAM, options),
        localValue: localItem.workstream,
        remoteValue: remoteItem.workstream,
        message: `Workstream diverges: local '${localItem.workstream}' != remote '${remoteItem.workstream}'`,
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED);
    }
  }

  // 6. URL comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_URL)) {
    const localUrl = localItem.url?.trim() || "";
    const remoteUrl = remoteItem.url?.trim() || "";
    if (localUrl !== remoteUrl) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_URL,
        driftType: DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_URL, options),
        localValue: localItem.url,
        remoteValue: remoteItem.url,
        message: `URL diverges: local '${localItem.url}' != remote '${remoteItem.url}'`,
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED);
    }
  }

  // 7. Mandatory Spanish Sections comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_SECTIONS)) {
    const sectionKeys: Array<keyof Omit<CatalogTaskSection, "criteriosCompletitud">> = [
      "proposito",
      "queSeEsperaLograr",
      "goal",
    ];

    for (const key of sectionKeys) {
      const localSec = ignoreWhitespace
        ? normalizeTextForComparison(localItem.sections?.[key])
        : localItem.sections?.[key] || "";
      const remoteSec = ignoreWhitespace
        ? normalizeTextForComparison(remoteItem.sections?.[key])
        : remoteItem.sections?.[key] || "";

      if (localSec !== remoteSec) {
        diffs.push({
          field: `sections.${key}`,
          driftType: DRIFT_CONSTANTS.TYPE_SECTIONS_MODIFIED,
          severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_SECTIONS, options),
          localValue: localItem.sections?.[key] || "",
          remoteValue: remoteItem.sections?.[key] || "",
          message: `Section '${key}' diverges between local and remote`,
        });
        driftTypesSet.add(DRIFT_CONSTANTS.TYPE_SECTIONS_MODIFIED);
      }
    }
  }

  // 8. Definition of Done Checklist comparison
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_CHECKLIST)) {
    const localChecklist = extractTaskChecklist(localItem.body || localItem.sections?.criteriosCompletitud || []);
    const remoteChecklist = extractTaskChecklist(remoteItem.body || remoteItem.sections?.criteriosCompletitud || []);

    const countDiverges = localChecklist.total !== remoteChecklist.total;
    const checkedDiverges = localChecklist.checkedCount !== remoteChecklist.checkedCount;

    if (countDiverges || checkedDiverges) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_CHECKLIST,
        driftType: DRIFT_CONSTANTS.TYPE_CHECKLIST_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_CHECKLIST, options),
        localValue: { total: localChecklist.total, checked: localChecklist.checkedCount },
        remoteValue: { total: remoteChecklist.total, checked: remoteChecklist.checkedCount },
        message: `Checklist diverges: local has ${localChecklist.checkedCount}/${localChecklist.total} checked, remote has ${remoteChecklist.checkedCount}/${remoteChecklist.total} checked`,
        details: {
          localChecklist,
          remoteChecklist,
        },
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_CHECKLIST_MODIFIED);
    }
  }

  // 9. Raw Body comparison (if explicitly requested)
  if (isFieldAudited(DRIFT_CONSTANTS.FIELD_BODY)) {
    const localBody = ignoreWhitespace
      ? normalizeTextForComparison(localItem.body)
      : localItem.body || "";
    const remoteBody = ignoreWhitespace
      ? normalizeTextForComparison(remoteItem.body)
      : remoteItem.body || "";

    if (localBody !== remoteBody) {
      diffs.push({
        field: DRIFT_CONSTANTS.FIELD_BODY,
        driftType: DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED,
        severity: resolveDriftSeverity(DRIFT_CONSTANTS.FIELD_BODY, options),
        localValue: localItem.body,
        remoteValue: remoteItem.body,
        message: `Task markdown body text diverges between local and remote`,
      });
      driftTypesSet.add(DRIFT_CONSTANTS.TYPE_FIELD_MODIFIED);
    }
  }

  const hasDrift = diffs.length > DRIFT_CONSTANTS.ZERO_COUNT;
  const maxSeverity = computeMaxSeverity(diffs);

  return {
    taskKey: localItem.task_key,
    itemId: localItem.project_item_id || remoteItem.project_item_id,
    title: localItem.title || remoteItem.title,
    hasDrift,
    driftTypes: Array.from(driftTypesSet),
    maxSeverity,
    diffs,
    localItem,
    remoteItem,
  };
}

/**
 * Formats a single alert into a terminal-friendly message.
 */
export function formatAlertMessage(alert: DriftAlert): string {
  const emoji = DRIFT_CONSTANTS.ALERT_EMOJIS[alert.severity] || "⚠️";
  const fieldPart = alert.field ? ` [${alert.field}]` : "";
  return `${emoji} ${DRIFT_CONSTANTS.ALERT_PREFIX} [${alert.severity}] ${alert.taskKey}${fieldPart}: ${alert.message}`;
}

/**
 * Formats a markdown table report of all detected drifts.
 */
export function formatDriftMarkdownReport(
  stats: DriftSummaryStats,
  taskDrifts: TaskDriftResult[],
  alerts: DriftAlert[],
  timestamp: string
): string {
  const lines: string[] = [];
  lines.push(DRIFT_CONSTANTS.REPORT_TITLE);
  lines.push(`**Generated At:** \`${timestamp}\`  `);
  lines.push(
    `**Status:** ${
      stats.tasksWithDriftCount === DRIFT_CONSTANTS.ZERO_COUNT
        ? "✅ **In Sync (Zero Drift)**"
        : `⚠️ **Diverged (${stats.tasksWithDriftCount} task(s) drifted)**`
    }\n`
  );

  lines.push("## 1. Executive Summary Statistics");
  lines.push("| Metric | Count |");
  lines.push("|---|---|");
  lines.push(`| Total Local Tasks | ${stats.totalLocalTasks} |`);
  lines.push(`| Total Remote Tasks | ${stats.totalRemoteTasks} |`);
  lines.push(`| Tasks Perfectly In Sync | ${stats.tasksInSyncCount} |`);
  lines.push(`| Tasks with Drift | ${stats.tasksWithDriftCount} |`);
  lines.push(`| Remote Tasks Missing Locally (Added) | ${stats.addedInRemoteCount} |`);
  lines.push(`| Local Tasks Missing in Remote (Removed) | ${stats.removedInRemoteCount} |`);
  lines.push(`| Tasks with Modified Properties | ${stats.modifiedCount} |`);
  lines.push(`| Total Field-Level Discrepancies | ${stats.totalFieldDiffsCount} |`);
  lines.push(
    `| Alerts by Severity | Critical: ${stats.alertsCountBySeverity.CRITICAL}, Error: ${stats.alertsCountBySeverity.ERROR}, Warning: ${stats.alertsCountBySeverity.WARNING}, Info: ${stats.alertsCountBySeverity.INFO} |\n`
  );

  if (alerts.length > DRIFT_CONSTANTS.ZERO_COUNT) {
    lines.push("## 2. Active Drift Alerts");
    lines.push("| Severity | Task Key | Type | Field | Alert Message |");
    lines.push("|---|---|---|---|---|");
    for (const alert of alerts) {
      const emoji = DRIFT_CONSTANTS.ALERT_EMOJIS[alert.severity] || "⚠️";
      const fieldStr = alert.field || "-";
      lines.push(
        `| ${emoji} \`${alert.severity}\` | \`${alert.taskKey}\` | \`${alert.driftType}\` | \`${fieldStr}\` | ${alert.message.replace(/\|/g, "\\|")} |`
      );
    }
    lines.push("");
  }

  if (stats.tasksWithDriftCount > DRIFT_CONSTANTS.ZERO_COUNT) {
    lines.push("## 3. Granular Task Discrepancy Breakdown");
    for (const td of taskDrifts) {
      if (!td.hasDrift) continue;
      const emoji = DRIFT_CONSTANTS.ALERT_EMOJIS[td.maxSeverity] || "⚠️";
      lines.push(`### ${emoji} ${td.taskKey}: ${td.title}`);
      lines.push(`- **Item ID:** \`${td.itemId || "(none)"}\``);
      lines.push(`- **Highest Severity:** \`${td.maxSeverity}\``);
      lines.push(`- **Drift Types:** ${td.driftTypes.map((t) => `\`${t}\``).join(", ")}`);
      lines.push("\n| Field | Severity | Local State | Remote State | Discrepancy Detail |");
      lines.push("|---|---|---|---|---|");

      for (const diff of td.diffs) {
        const localStr = typeof diff.localValue === "object" ? JSON.stringify(diff.localValue) : String(diff.localValue ?? "-");
        const remoteStr = typeof diff.remoteValue === "object" ? JSON.stringify(diff.remoteValue) : String(diff.remoteValue ?? "-");
        lines.push(
          `| \`${diff.field}\` | \`${diff.severity}\` | ${localStr.replace(/\|/g, "\\|")} | ${remoteStr.replace(/\|/g, "\\|")} | ${diff.message.replace(/\|/g, "\\|")} |`
        );
      }
      lines.push("");
    }
  } else {
    lines.push("## 3. Discrepancy Breakdown\nNo discrepancies found between remote GitHub Project #4 and local catalog.\n");
  }

  return lines.join("\n");
}

/**
 * Formats a terminal-friendly summary of the drift audit.
 */
export function formatDriftSummary(stats: DriftSummaryStats, driftedKeys: string[]): string {
  if (stats.tasksWithDriftCount === DRIFT_CONSTANTS.ZERO_COUNT) {
    return `[DRIFT AUDIT] ✅ All ${stats.totalTasksAudited} tasks are 100% in sync between remote GitHub Project #4 and local repository.`;
  }

  return (
    `[DRIFT AUDIT] ⚠️ Drift detected in ${stats.tasksWithDriftCount}/${stats.totalTasksAudited} tasks. ` +
    `Added: ${stats.addedInRemoteCount}, Removed: ${stats.removedInRemoteCount}, Modified: ${stats.modifiedCount}. ` +
    `Drifted Keys: [${driftedKeys.join(", ")}]. ` +
    `Alerts: ${stats.alertsCountBySeverity.CRITICAL} Critical, ${stats.alertsCountBySeverity.ERROR} Error, ${stats.alertsCountBySeverity.WARNING} Warning.`
  );
}

/**
 * Dispatches drift alerts to registered handler and/or console sinks.
 */
export async function dispatchDriftAlerts(
  alerts: DriftAlert[],
  options: DriftDetectionOptions = {}
): Promise<void> {
  const minSeverity = options.minSeverityToAlert || DRIFT_CONSTANTS.SEVERITY_INFO;
  const alertSink = options.alertSink || DRIFT_CONSTANTS.ALERT_SINK_ALL;

  for (const alert of alerts) {
    if (!isSeverityEligible(alert.severity, minSeverity)) {
      continue;
    }

    if (options.onAlert) {
      try {
        await options.onAlert(alert);
      } catch (err) {
        console.error(`Error in custom drift alert handler for ${alert.taskKey}:`, err);
      }
    }

    if (alertSink === DRIFT_CONSTANTS.ALERT_SINK_CONSOLE || alertSink === DRIFT_CONSTANTS.ALERT_SINK_ALL) {
      const formatted = formatAlertMessage(alert);
      if (
        alert.severity === DRIFT_CONSTANTS.SEVERITY_CRITICAL ||
        alert.severity === DRIFT_CONSTANTS.SEVERITY_ERROR
      ) {
        console.error(formatted);
      } else if (alert.severity === DRIFT_CONSTANTS.SEVERITY_WARNING) {
        console.warn(formatted);
      } else {
        console.info(formatted);
      }
    }
  }
}

/**
 * Core engine comparing local catalog tasks against remote GitHub Project #4 items.
 */
export function detectCatalogDrift(
  localInput: (CatalogTaskItem | Partial<CatalogTaskItem>)[],
  remoteInput: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
  options: DriftDetectionOptions = {}
): CatalogDriftReport {
  const timestamp = new Date().toISOString();
  const defaultUrl = options.projectUrl || CATALOG_CONSTANTS.DEFAULT_PROJECT_URL;

  // 1. Normalize both datasets into canonical CatalogTaskItem format
  const normalizedLocal = localInput.map((item) =>
    normalizeCatalogItem(item, defaultUrl, options.workstreamOverrides)
  );
  const normalizedRemote = remoteInput.map((item) =>
    normalizeCatalogItem(item, defaultUrl, options.workstreamOverrides)
  );

  // 2. Index local tasks by task_key and project_item_id
  const localByKey = new Map<string, CatalogTaskItem>();
  const localById = new Map<string, CatalogTaskItem>();

  for (const item of normalizedLocal) {
    if (item.task_key && item.task_key !== DRIFT_CONSTANTS.FALLBACK_UNKNOWN_KEY) {
      localByKey.set(item.task_key.toUpperCase(), item);
    }
    if (item.project_item_id) {
      localById.set(item.project_item_id, item);
    }
  }

  // 3. Index remote tasks by task_key and project_item_id
  const remoteByKey = new Map<string, CatalogTaskItem>();
  const remoteById = new Map<string, CatalogTaskItem>();

  for (const item of normalizedRemote) {
    if (item.task_key && item.task_key !== DRIFT_CONSTANTS.FALLBACK_UNKNOWN_KEY) {
      remoteByKey.set(item.task_key.toUpperCase(), item);
    }
    if (item.project_item_id) {
      remoteById.set(item.project_item_id, item);
    }
  }

  const allAuditedKeys = new Set<string>();
  for (const k of localByKey.keys()) allAuditedKeys.add(k);
  for (const k of remoteByKey.keys()) allAuditedKeys.add(k);

  // Also include items without canonical key but with ID
  for (const id of localById.keys()) {
    const it = localById.get(id);
    if (it && (!it.task_key || it.task_key === DRIFT_CONSTANTS.FALLBACK_UNKNOWN_KEY)) {
      allAuditedKeys.add(`ID:${id}`);
    }
  }
  for (const id of remoteById.keys()) {
    const it = remoteById.get(id);
    if (it && (!it.task_key || it.task_key === DRIFT_CONSTANTS.FALLBACK_UNKNOWN_KEY)) {
      allAuditedKeys.add(`ID:${id}`);
    }
  }

  const taskDrifts: TaskDriftResult[] = [];
  const alerts: DriftAlert[] = [];
  const driftedTaskKeys: string[] = [];

  let addedInRemoteCount = 0;
  let removedInRemoteCount = 0;
  let modifiedCount = 0;
  let tasksInSyncCount = 0;
  let totalFieldDiffsCount = 0;

  const alertsCountBySeverity: Record<DriftSeverity, number> = {
    INFO: 0,
    WARNING: 0,
    ERROR: 0,
    CRITICAL: 0,
  };

  const recordAlert = (
    severity: DriftSeverity,
    taskKey: string,
    driftType: DriftType,
    message: string,
    field?: string,
    localValue?: unknown,
    remoteValue?: unknown
  ) => {
    alertsCountBySeverity[severity]++;
    alerts.push({
      id: randomUUID(),
      timestamp,
      severity,
      taskKey,
      driftType,
      field,
      message,
      localValue,
      remoteValue,
    });
  };

  for (const key of allAuditedKeys) {
    const isIdKey = key.startsWith("ID:");
    const actualId = isIdKey ? key.slice("ID:".length) : undefined;

    const localItem = isIdKey ? localById.get(actualId!) : localByKey.get(key);
    const remoteItem = isIdKey ? remoteById.get(actualId!) : remoteByKey.get(key);

    const taskKey = localItem?.task_key || remoteItem?.task_key || key;
    const itemId = localItem?.project_item_id || remoteItem?.project_item_id || "";
    const title = localItem?.title || remoteItem?.title || "(Untitled)";

    // Case A: Missing locally (Task added in remote GitHub Project)
    if (!localItem && remoteItem) {
      addedInRemoteCount++;
      driftedTaskKeys.push(taskKey);

      const severity = resolveDriftSeverity(DRIFT_CONSTANTS.TYPE_ITEM_ADDED, options);
      const diff: FieldDriftDetail = {
        field: "membership",
        driftType: DRIFT_CONSTANTS.TYPE_ITEM_ADDED,
        severity,
        localValue: undefined,
        remoteValue: remoteItem,
        message: `Task exists in remote GitHub Project #4 but is missing in local repository catalog`,
      };

      recordAlert(
        severity,
        taskKey,
        DRIFT_CONSTANTS.TYPE_ITEM_ADDED,
        diff.message,
        "membership",
        undefined,
        remoteItem.title
      );

      taskDrifts.push({
        taskKey,
        itemId,
        title,
        hasDrift: true,
        driftTypes: [DRIFT_CONSTANTS.TYPE_ITEM_ADDED],
        maxSeverity: severity,
        diffs: [diff],
        localItem: undefined,
        remoteItem,
      });
      totalFieldDiffsCount++;
      continue;
    }

    // Case B: Missing remotely (Task deleted or removed from GitHub Project)
    if (localItem && !remoteItem) {
      removedInRemoteCount++;
      driftedTaskKeys.push(taskKey);

      const severity = resolveDriftSeverity(DRIFT_CONSTANTS.TYPE_ITEM_REMOVED, options);
      const diff: FieldDriftDetail = {
        field: "membership",
        driftType: DRIFT_CONSTANTS.TYPE_ITEM_REMOVED,
        severity,
        localValue: localItem,
        remoteValue: undefined,
        message: `Task exists in local repository catalog but is missing from remote GitHub Project #4`,
      };

      recordAlert(
        severity,
        taskKey,
        DRIFT_CONSTANTS.TYPE_ITEM_REMOVED,
        diff.message,
        "membership",
        localItem.title,
        undefined
      );

      taskDrifts.push({
        taskKey,
        itemId,
        title,
        hasDrift: true,
        driftTypes: [DRIFT_CONSTANTS.TYPE_ITEM_REMOVED],
        maxSeverity: severity,
        diffs: [diff],
        localItem,
        remoteItem: undefined,
      });
      totalFieldDiffsCount++;
      continue;
    }

    // Case C: Both exist -> compare properties
    if (localItem && remoteItem) {
      const result = compareTaskItems(localItem, remoteItem, options);

      if (result.hasDrift) {
        modifiedCount++;
        driftedTaskKeys.push(taskKey);
        totalFieldDiffsCount += result.diffs.length;

        for (const diff of result.diffs) {
          recordAlert(
            diff.severity,
            taskKey,
            diff.driftType,
            diff.message,
            diff.field,
            diff.localValue,
            diff.remoteValue
          );
        }

        taskDrifts.push(result);
      } else {
        tasksInSyncCount++;
        taskDrifts.push(result);
      }
    }
  }

  const tasksWithDriftCount = addedInRemoteCount + removedInRemoteCount + modifiedCount;
  const hasDrift = tasksWithDriftCount > DRIFT_CONSTANTS.ZERO_COUNT;

  const stats: DriftSummaryStats = {
    totalLocalTasks: normalizedLocal.length,
    totalRemoteTasks: normalizedRemote.length,
    totalTasksAudited: allAuditedKeys.size,
    tasksInSyncCount,
    tasksWithDriftCount,
    addedInRemoteCount,
    removedInRemoteCount,
    modifiedCount,
    totalFieldDiffsCount,
    alertsCountBySeverity,
  };

  const formattedSummary = formatDriftSummary(stats, driftedTaskKeys);
  const formattedMarkdown = formatDriftMarkdownReport(stats, taskDrifts, alerts, timestamp);

  return {
    timestamp,
    hasDrift,
    stats,
    taskDrifts,
    driftedTaskKeys,
    alerts,
    formattedSummary,
    formattedMarkdown,
  };
}

/**
 * Asserts that zero drift exists between local tasks and remote GitHub Project #4.
 *
 * @throws {CatalogDriftError} if drift count exceeds maxAllowedDrift (default 0).
 */
export function assertNoDrift(
  localInput: (CatalogTaskItem | Partial<CatalogTaskItem>)[],
  remoteInput: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
  options: DriftDetectionOptions = {}
): CatalogDriftReport {
  const report = detectCatalogDrift(localInput, remoteInput, options);
  const maxAllowed = options.maxAllowedDrift ?? DRIFT_CONSTANTS.DEFAULT_MAX_ALLOWED_DRIFT;

  if (report.stats.tasksWithDriftCount > maxAllowed) {
    const errorMsg =
      `Catalog drift assertion failed: ${report.stats.tasksWithDriftCount} task(s) diverged ` +
      `between remote GitHub Project #4 and local repository state. ` +
      `Drifted task keys: [${report.driftedTaskKeys.join(", ")}]. ` +
      `Max allowed drift is ${maxAllowed}.`;

    throw new CatalogDriftError(errorMsg, report);
  }

  return report;
}

/**
 * High-Level Catalog Drift Detector Service.
 */
export class CatalogDriftDetector {
  private readonly defaultOptions: DriftDetectionOptions;

  constructor(defaultOptions: DriftDetectionOptions = {}) {
    this.defaultOptions = { ...defaultOptions };
  }

  getDefaultOptions(): DriftDetectionOptions {
    return { ...this.defaultOptions };
  }

  /**
   * Compares provided local and remote datasets and dispatches alerts.
   */
  async detectDrift(
    localInput: (CatalogTaskItem | Partial<CatalogTaskItem>)[],
    remoteInput: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): Promise<CatalogDriftReport> {
    const mergedOptions: DriftDetectionOptions = { ...this.defaultOptions, ...options };
    const report = detectCatalogDrift(localInput, remoteInput, mergedOptions);
    await dispatchDriftAlerts(report.alerts, mergedOptions);
    return report;
  }

  /**
   * Synchronous drift detection without async alert dispatch.
   */
  detectDriftSync(
    localInput: (CatalogTaskItem | Partial<CatalogTaskItem>)[],
    remoteInput: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): CatalogDriftReport {
    const mergedOptions: DriftDetectionOptions = { ...this.defaultOptions, ...options };
    return detectCatalogDrift(localInput, remoteInput, mergedOptions);
  }

  /**
   * Loads local catalog from disk file and compares with remote items.
   */
  async detectDriftFromFiles(
    localCatalogPath: string,
    remoteInput: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): Promise<CatalogDriftReport> {
    if (!localCatalogPath || !existsSync(localCatalogPath)) {
      throw new CatalogGeneratorError(
        `Local catalog file not found at '${localCatalogPath}'`,
        "FILE_READ_ERROR"
      );
    }

    let localTasks: CatalogTaskItem[];
    try {
      localTasks = await readCatalogJson(localCatalogPath);
    } catch (err) {
      throw new CatalogGeneratorError(
        `Failed to parse local catalog at '${localCatalogPath}'`,
        "FILE_READ_ERROR",
        err
      );
    }

    return this.detectDrift(localTasks, remoteInput, options);
  }

  /**
   * Fetches remote items live from GitHubProjectService and compares against local file.
   */
  async detectDriftFromProject(
    projectService: GitHubProjectService,
    localCatalogPath: string = resolve(
      CATALOG_CONSTANTS.DEFAULT_CATALOG_DIR,
      CATALOG_CONSTANTS.DEFAULT_JSON_FILE
    ),
    options?: DriftDetectionOptions
  ): Promise<CatalogDriftReport> {
    if (!projectService) {
      throw new CatalogGeneratorError("projectService is required", "INVALID_ARGUMENT");
    }

    let remoteItems: ProjectV2Item[];
    try {
      remoteItems = await projectService.getAllItems();
    } catch (err) {
      throw new CatalogGeneratorError(
        "Failed to fetch remote items from GitHubProjectService",
        "PROJECT_FETCH_ERROR",
        err
      );
    }

    return this.detectDriftFromFiles(localCatalogPath, remoteItems, options);
  }

  /**
   * Asserts zero drift and throws CatalogDriftError if divergence exceeds threshold.
   */
  assertNoDrift(
    localInput: (CatalogTaskItem | Partial<CatalogTaskItem>)[],
    remoteInput: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): CatalogDriftReport {
    const mergedOptions: DriftDetectionOptions = { ...this.defaultOptions, ...options };
    return assertNoDrift(localInput, remoteInput, mergedOptions);
  }

  /**
   * Asserts zero drift between local catalog file and remote items.
   */
  assertNoDriftFromFiles(
    localCatalogPath: string,
    remoteInput: (ProjectV2Item | CatalogTaskItem | Partial<CatalogTaskItem>)[],
    options?: DriftDetectionOptions
  ): CatalogDriftReport {
    if (!localCatalogPath || !existsSync(localCatalogPath)) {
      throw new CatalogGeneratorError(
        `Local catalog file not found at '${localCatalogPath}'`,
        "FILE_READ_ERROR"
      );
    }

    const localTasks = readCatalogJsonSync(localCatalogPath);
    return this.assertNoDrift(localTasks, remoteInput, options);
  }

  formatMarkdown(report: CatalogDriftReport): string {
    return report.formattedMarkdown;
  }

  formatSummary(report: CatalogDriftReport): string {
    return report.formattedSummary;
  }
}
