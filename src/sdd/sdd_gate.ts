/**
 * PreToolUse SDD Gate enforcement for openspec-cascade.
 *
 * Intercepts tool execution to guarantee Spec-Driven Development discipline:
 * production source code cannot be edited unless an active, valid OpenSpec change exists.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, normalize, resolve } from "node:path";
import { CONSTANTS } from "../../config";

export interface SddGateInput {
  toolName: string;
  filePath?: string;
  repoRoot?: string;
}

export interface SddGateResult {
  allowed: boolean;
  reason?: string;
  activeChangeId?: string | null;
}

/**
 * Determines whether a file path qualifies as production source code.
 *
 * Exempts tests, documentation, specifications, and hidden configuration folders.
 */
export function isProductionSourceFile(filePath: string): boolean {
  if (!filePath) {
    return false;
  }

  const normalized = ("/" + normalize(filePath).replace(/\\/g, "/")).toLowerCase();

  const isProductionExt = CONSTANTS.SDD_PRODUCTION_EXTENSIONS.some((ext) =>
    normalized.endsWith(ext)
  );
  if (!isProductionExt) {
    return false;
  }

  const isExemptSegment = CONSTANTS.SDD_EXEMPT_PATH_SEGMENTS.some((segment) =>
    normalized.includes(segment)
  );
  if (isExemptSegment) {
    return false;
  }

  const fileName = basename(normalized);
  const isExemptPrefix = CONSTANTS.SDD_EXEMPT_NAME_PREFIXES.some((prefix) =>
    fileName.startsWith(prefix)
  );
  if (isExemptPrefix) {
    return false;
  }

  const isExemptSuffix = CONSTANTS.SDD_EXEMPT_NAME_SUFFIXES.some((suffix) =>
    fileName.includes(suffix)
  );
  if (isExemptSuffix) {
    return false;
  }

  return true;
}

/**
 * Checks whether a tool requires SDD gate authorization.
 */
export function isGatedTool(toolName: string): boolean {
  return (CONSTANTS.SDD_GATED_TOOLS as readonly string[]).includes(toolName);
}

/**
 * Discovers the active OpenSpec change with pending tasks in the repository.
 * Returns the change ID or null if no active change exists.
 */
export async function findActiveOpenSpecChange(
  repoRoot: string = process.cwd()
): Promise<string | null> {
  const changesDir = join(resolve(repoRoot), "openspec", "changes");

  try {
    const entries = await readdir(changesDir, { withFileTypes: true });
    const changeDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    for (const changeId of changeDirs) {
      const tasksPath = join(changesDir, changeId, "tasks.md");
      try {
        const stats = await stat(tasksPath);
        if (!stats.isFile()) {
          continue;
        }

        const content = await readFile(tasksPath, "utf-8");
        const hasUncheckedTasks = content
          .split("\n")
          .some((line) => line.trim().startsWith("- [ ]"));

        if (hasUncheckedTasks) {
          return changeId;
        }
      } catch {
        // File does not exist or cannot be read; continue checking other changes
      }
    }
  } catch {
    // openspec/changes directory does not exist
    return null;
  }

  return null;
}

/**
 * Evaluates the PreToolUse SDD Gate for an intended tool invocation.
 */
export async function evaluateSddGate(
  input: SddGateInput
): Promise<SddGateResult> {
  if (process.env.CASCADE_SDD_GATE_DISABLED === "1") {
    return { allowed: true };
  }

  if (!isGatedTool(input.toolName)) {
    return { allowed: true };
  }

  if (!input.filePath || !isProductionSourceFile(input.filePath)) {
    return { allowed: true };
  }

  const repoRoot = input.repoRoot ?? process.cwd();
  const activeChange = await findActiveOpenSpecChange(repoRoot);

  if (activeChange) {
    return {
      allowed: true,
      activeChangeId: activeChange,
    };
  }

  return {
    allowed: false,
    activeChangeId: null,
    reason:
      "SDD Gate Block: Attempted modification of production source without an active OpenSpec change. " +
      "Spec before code: create or activate a validated change under openspec/changes/ with pending tasks in tasks.md before editing code. " +
      "(Tests, docs, and specifications are exempt; set CASCADE_SDD_GATE_DISABLED=1 to bypass).",
  };
}
