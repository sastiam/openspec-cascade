/**
 * Persistent filesystem memory hierarchy and atomic state storage module.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper memory architecture
 * in `.agents/teamwork/` with directory scaffolding, atomic state serialization
 * via swap files, protected section guard for BRIEFING.md, and agent workspace isolation.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";

/**
 * Storage configuration constants ensuring zero magic numbers.
 */
export const STORAGE_CONSTANTS = {
  DEFAULT_BASE_DIR: ".agents/teamwork",
  DIR_SENTINEL: "sentinel",
  DIR_BRIEFING: "briefing",
  DIR_STATE: "state",
  DEFAULT_JSON_INDENT: 2,
  FILE_BRIEFING: "BRIEFING.md",
  FILE_PROGRESS: "progress.md",
  FILE_DISPATCH: "DISPATCH.md",
  FILE_HANDOFF: "handoff.md",
  FILE_PROJECT: "PROJECT.md",
  SWAP_PREFIX: ".swap",
  JSON_EXTENSION: ".json",
  DEFAULT_ENCODING: "utf-8" as BufferEncoding,
  STALE_HEARTBEAT_THRESHOLD_MS: 300_000,
  DEFAULT_WATCHDOG_CHECK_INTERVAL_MS: 30_000,
  WATCHDOG_EVENT_STALENESS: "STALENESS",
  WATCHDOG_EVENT_RECOVERY: "RECOVERY",
  HEARTBEAT_TIMESTAMP_PREFIX: "Last visited:",
  MIN_EPOCH_TIMESTAMP_DIGITS: 10,
  PROTECTED_SECTION_MARKER: "🔒",
  MAX_BRIEFING_LINES: 100,
  DEFAULT_PROTECTED_SECTION_HEADERS: [
    "## 🔒 My Identity",
    "## 🔒 Key Constraints",
  ] as const,
} as const;

/**
 * Standard error codes for storage operations.
 */
export const STORAGE_ERROR_CODES = {
  WRITE_FAILED: "STORAGE_WRITE_FAILED",
  READ_FAILED: "STORAGE_READ_FAILED",
  SERIALIZATION_FAILED: "STORAGE_SERIALIZATION_FAILED",
  DESERIALIZATION_FAILED: "STORAGE_DESERIALIZATION_FAILED",
  SCAFFOLD_FAILED: "STORAGE_SCAFFOLD_FAILED",
  FILE_NOT_FOUND: "STORAGE_FILE_NOT_FOUND",
  INVALID_PATH: "STORAGE_INVALID_PATH",
  PROTECTED_SECTION_VIOLATION: "STORAGE_PROTECTED_SECTION_VIOLATION",
  HEARTBEAT_PARSE_FAILED: "STORAGE_HEARTBEAT_PARSE_FAILED",
  WATCHDOG_ERROR: "STORAGE_WATCHDOG_ERROR",
} as const;

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[keyof typeof STORAGE_ERROR_CODES];

/**
 * Custom error class for storage and filesystem operations.
 */
export class StorageError extends Error {
  public readonly code: StorageErrorCode;
  public readonly targetPath?: string;

  constructor(message: string, code: StorageErrorCode, targetPath?: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "StorageError";
    this.code = code;
    this.targetPath = targetPath;
  }
}

/**
 * Types of violations detected by the protected section guard.
 */
export const PROTECTED_VIOLATION_TYPES = {
  DELETED: "DELETED",
  MODIFIED: "MODIFIED",
  TRUNCATED: "TRUNCATED",
  LOCK_REMOVED: "LOCK_REMOVED",
  MISSING_REQUIRED: "MISSING_REQUIRED",
  MAX_LINES_EXCEEDED: "MAX_LINES_EXCEEDED",
} as const;

export type ProtectedViolationType =
  (typeof PROTECTED_VIOLATION_TYPES)[keyof typeof PROTECTED_VIOLATION_TYPES];

/**
 * Individual violation reported by the protected section guard.
 */
export interface ProtectedSectionViolation {
  sectionTitle: string;
  type: ProtectedViolationType;
  message: string;
  expected?: string;
  actual?: string;
}

/**
 * Detailed result of running the protected section guard validation.
 */
export interface ProtectedSectionValidationResult {
  isValid: boolean;
  violations: ProtectedSectionViolation[];
}

/**
 * Representation of a parsed markdown section.
 */
export interface MarkdownSection {
  level: number;
  heading: string;
  title: string;
  content: string;
  raw: string;
  isProtected: boolean;
  startLine: number;
  endLine: number;
}

/**
 * Configuration options for the protected section guard.
 */
export interface ProtectedSectionGuardOptions {
  allowAppend?: boolean;
  protectedMarkers?: readonly string[];
  protectedHeaders?: readonly string[];
  requiredHeaders?: readonly string[];
  enforceMaxLines?: boolean;
  maxLines?: number;
}

/**
 * Custom error thrown when a protected section contract is violated.
 */
export class ProtectedSectionError extends StorageError {
  public readonly violations: readonly ProtectedSectionViolation[];

  constructor(
    message: string,
    violations: readonly ProtectedSectionViolation[],
    targetPath?: string
  ) {
    super(message, STORAGE_ERROR_CODES.PROTECTED_SECTION_VIOLATION, targetPath);
    this.name = "ProtectedSectionError";
    this.violations = violations;
  }
}

/**
 * Options for memory storage initialization.
 */
export interface MemoryStorageOptions {
  baseDir?: string;
  repoRoot?: string;
}

/**
 * Options for atomic file writes.
 */
export interface WriteAtomicOptions {
  encoding?: BufferEncoding;
  mode?: number;
  guardProtectedSections?: boolean;
  guardOptions?: ProtectedSectionGuardOptions;
}

/**
 * Options for atomic briefing writes.
 */
export interface WriteBriefingOptions extends WriteAtomicOptions {
  autoMergeProtected?: boolean;
}

/**
 * Options for atomic state serialization.
 */
export interface WriteStateOptions extends WriteAtomicOptions {
  indent?: number;
}

/**
 * Result of directory scaffolding initialization.
 */
export interface StorageScaffoldResult {
  baseDir: string;
  sentinelDir: string;
  briefingDir: string;
  stateDir: string;
  createdDirectories: string[];
}

/**
 * Workspace information for a scaffolded agent.
 */
export interface AgentWorkspaceInfo {
  agentId: string;
  workspaceDir: string;
  briefingPath: string;
  progressPath: string;
  dispatchPath: string;
  handoffPath: string;
}

/**
 * Options for agent workspace scaffolding.
 */
export interface ScaffoldAgentOptions {
  role?: string;
  initialBriefing?: string;
  initialDispatch?: string;
  initialProgress?: string;
}

/**
 * Heartbeat health status of an agent.
 */
export type HeartbeatStatus = "healthy" | "stale" | "missing";

/**
 * Underlying reason for a heartbeat staleness detection.
 */
export type StalenessReason = "heartbeat_expired" | "heartbeat_missing";

/**
 * Event triggered when an agent exceeds the heartbeat SLA threshold.
 */
export interface HeartbeatStalenessEvent {
  type: typeof STORAGE_CONSTANTS.WATCHDOG_EVENT_STALENESS;
  agentId: string;
  progressPath: string;
  lastHeartbeat: Date | null;
  elapsedMs: number;
  thresholdMs: number;
  detectedAt: Date;
  reason: StalenessReason;
}

/**
 * Event triggered when an agent recovers after being in a stale state.
 */
export interface HeartbeatRecoveryEvent {
  type: typeof STORAGE_CONSTANTS.WATCHDOG_EVENT_RECOVERY;
  agentId: string;
  recoveredAt: Date;
}

/**
 * Result of inspecting an agent's heartbeat.
 */
export interface HeartbeatInspectionResult {
  agentId: string;
  status: HeartbeatStatus;
  progressPath: string;
  lastHeartbeat: Date | null;
  elapsedMs: number;
  thresholdMs: number;
  isStale: boolean;
  reason?: StalenessReason;
}

/**
 * Options for inspecting an individual agent heartbeat.
 */
export interface InspectAgentHeartbeatOptions {
  baseDir?: string;
  progressPath?: string;
  thresholdMs?: number;
  nowMs?: number;
  registeredAt?: number;
}

/**
 * Options for registering a subagent to be monitored by the watchdog.
 */
export interface AgentRegistrationOptions {
  registeredAt?: Date | number;
  thresholdMs?: number;
}

/**
 * Configuration options for the HeartbeatWatchdog timer.
 */
export interface HeartbeatWatchdogOptions {
  baseDir?: string;
  thresholdMs?: number;
  checkIntervalMs?: number;
  nowFn?: () => number;
  unrefTimer?: boolean;
  scanWorkspaces?: boolean;
  onStale?: (event: HeartbeatStalenessEvent) => void | Promise<void>;
  onRecovery?: (agentId: string) => void | Promise<void>;
}

/**
 * Normalizes a markdown heading title for canonical matching across variations.
 */
export function normalizeSectionTitle(heading: string): string {
  return heading
    .replace(/^#+\s*/, "")
    .replace(/[🔒\u{1F512}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Determines whether a markdown heading represents a protected section.
 */
export function isSectionProtected(
  heading: string,
  options?: ProtectedSectionGuardOptions
): boolean {
  if (!heading || heading.trim().length === 0) {
    return false;
  }

  const markers = options?.protectedMarkers ?? [STORAGE_CONSTANTS.PROTECTED_SECTION_MARKER];
  for (const m of markers) {
    if (heading.includes(m)) {
      return true;
    }
  }

  const customProtectedHeaders = options?.protectedHeaders;
  if (customProtectedHeaders && customProtectedHeaders.length > 0) {
    const normalizedHeading = normalizeSectionTitle(heading);
    for (const h of customProtectedHeaders) {
      if (normalizedHeading === normalizeSectionTitle(h)) {
        return true;
      }
    }
  }

  const defaultHeaders = STORAGE_CONSTANTS.DEFAULT_PROTECTED_SECTION_HEADERS;
  const normalizedHeading = normalizeSectionTitle(heading);
  for (const h of defaultHeaders) {
    if (normalizedHeading === normalizeSectionTitle(h)) {
      return true;
    }
  }

  return false;
}

/**
 * Parses markdown text into structured sections, respecting code blocks and header hierarchies.
 */
export function parseMarkdownSections(
  content: string,
  options?: ProtectedSectionGuardOptions
): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  const sections: MarkdownSection[] = [];

  let inCodeBlock = false;
  let currentHeading: string | null = null;
  let currentTitle = "";
  let currentLevel = 0;
  let currentLines: string[] = [];
  let currentStartLine = 1;

  const flushSection = (endLine: number) => {
    if (currentHeading !== null || currentLines.length > 0) {
      const sectionContent = currentLines.join("\n");
      const heading = currentHeading ?? "";
      const raw = heading
        ? sectionContent.length > 0
          ? `${heading}\n${sectionContent}`
          : heading
        : sectionContent;
      const isProtected = isSectionProtected(heading, options);

      sections.push({
        level: currentLevel,
        heading,
        title: currentTitle,
        content: sectionContent,
        raw,
        isProtected,
        startLine: currentStartLine,
        endLine,
      });
    }
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch && headingMatch[1] !== undefined && headingMatch[2] !== undefined) {
        flushSection(lineNumber - 1);

        currentLevel = headingMatch[1].length;
        currentHeading = line;
        currentTitle = headingMatch[2].trim();
        currentStartLine = lineNumber;
        continue;
      }
    }

    currentLines.push(line);
  }

  flushSection(lines.length);
  return sections;
}

/**
 * Extracts non-empty, trailing-whitespace-trimmed lines from section body.
 */
function extractSignificantLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

/**
 * Validates that all protected sections in existingContent are preserved in newContent.
 * Supports append-only semantics by default.
 */
export function validateProtectedSections(
  existingContent: string,
  newContent: string,
  options?: ProtectedSectionGuardOptions
): ProtectedSectionValidationResult {
  const violations: ProtectedSectionViolation[] = [];
  const allowAppend = options?.allowAppend ?? true;

  const existingSections = parseMarkdownSections(existingContent, options);
  const newSections = parseMarkdownSections(newContent, options);

  const existingProtected = existingSections.filter((s) => s.isProtected);
  const newSectionsMap = new Map<string, MarkdownSection>();

  for (const s of newSections) {
    const key = normalizeSectionTitle(s.heading || s.title);
    if (key) {
      newSectionsMap.set(key, s);
    }
  }

  for (const exp of existingProtected) {
    const key = normalizeSectionTitle(exp.heading || exp.title);
    const matchedNewSection = newSectionsMap.get(key);

    if (!matchedNewSection) {
      violations.push({
        sectionTitle: exp.heading,
        type: PROTECTED_VIOLATION_TYPES.DELETED,
        message: `Protected section "${exp.heading}" was deleted or omitted.`,
        expected: exp.raw,
      });
      continue;
    }

    const marker = STORAGE_CONSTANTS.PROTECTED_SECTION_MARKER;
    if (exp.heading.includes(marker) && !matchedNewSection.heading.includes(marker)) {
      violations.push({
        sectionTitle: exp.heading,
        type: PROTECTED_VIOLATION_TYPES.LOCK_REMOVED,
        message: `Protected section "${exp.heading}" had its protection lock marker (${marker}) removed.`,
        expected: exp.heading,
        actual: matchedNewSection.heading,
      });
    }

    const existingLines = extractSignificantLines(exp.content);
    const newLines = extractSignificantLines(matchedNewSection.content);

    if (existingLines.length > 0) {
      if (newLines.length < existingLines.length) {
        violations.push({
          sectionTitle: exp.heading,
          type: PROTECTED_VIOLATION_TYPES.TRUNCATED,
          message: `Protected section "${exp.heading}" content was truncated (expected >= ${existingLines.length} lines, found ${newLines.length}).`,
          expected: exp.content,
          actual: matchedNewSection.content,
        });
        continue;
      }

      let modified = false;
      for (let i = 0; i < existingLines.length; i++) {
        const expectedLine = existingLines[i];
        const actualLine = newLines[i];
        if (expectedLine !== actualLine) {
          violations.push({
            sectionTitle: exp.heading,
            type: PROTECTED_VIOLATION_TYPES.MODIFIED,
            message: `Protected section "${exp.heading}" line ${i + 1} was overwritten: expected "${expectedLine ?? ""}", got "${actualLine ?? ""}".`,
            expected: expectedLine,
            actual: actualLine,
          });
          modified = true;
          break;
        }
      }

      if (modified) {
        continue;
      }

      if (newLines.length > existingLines.length && !allowAppend) {
        violations.push({
          sectionTitle: exp.heading,
          type: PROTECTED_VIOLATION_TYPES.MODIFIED,
          message: `Protected section "${exp.heading}" does not permit append modifications when allowAppend is disabled.`,
          expected: exp.content,
          actual: matchedNewSection.content,
        });
      }
    }
  }

  if (options?.requiredHeaders && options.requiredHeaders.length > 0) {
    for (const req of options.requiredHeaders) {
      const reqKey = normalizeSectionTitle(req);
      if (!newSectionsMap.has(reqKey)) {
        violations.push({
          sectionTitle: req,
          type: PROTECTED_VIOLATION_TYPES.MISSING_REQUIRED,
          message: `Required protected section "${req}" is missing.`,
          expected: req,
        });
      }
    }
  }

  if (options?.enforceMaxLines) {
    const limit = options.maxLines ?? STORAGE_CONSTANTS.MAX_BRIEFING_LINES;
    const totalLines = newContent.split(/\r?\n/).length;
    if (totalLines > limit) {
      violations.push({
        sectionTitle: "BRIEFING.md",
        type: PROTECTED_VIOLATION_TYPES.MAX_LINES_EXCEEDED,
        message: `Content exceeds maximum allowed briefing lines (${totalLines} > ${limit}).`,
        expected: `<= ${limit}`,
        actual: `${totalLines}`,
      });
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

/**
 * Asserts that all protected sections in existingContent are preserved in newContent.
 * Throws ProtectedSectionError if any violation is detected.
 */
export function assertProtectedSectionsPreserved(
  existingContent: string,
  newContent: string,
  targetPath?: string,
  options?: ProtectedSectionGuardOptions
): void {
  const result = validateProtectedSections(existingContent, newContent, options);
  if (!result.isValid) {
    const errorDetails = result.violations.map((v) => `[${v.type}] ${v.message}`).join("; ");
    throw new ProtectedSectionError(
      `Protected section guard violation in "${targetPath ?? STORAGE_CONSTANTS.FILE_BRIEFING}": ${errorDetails}`,
      result.violations,
      targetPath
    );
  }
}

/**
 * Merges protected sections from existingContent into newContent, restoring any deleted
 * or corrupted protected sections while keeping valid modifications to other sections.
 */
export function mergeProtectedSections(
  existingContent: string,
  newContent: string,
  options?: ProtectedSectionGuardOptions
): string {
  const existingSections = parseMarkdownSections(existingContent, options);
  const newSections = parseMarkdownSections(newContent, options);
  const existingProtected = existingSections.filter((s) => s.isProtected);

  if (existingProtected.length === 0) {
    return newContent;
  }

  const result: MarkdownSection[] = [...newSections];
  const allowAppend = options?.allowAppend ?? true;

  // First, reconcile protected sections already present in newContent
  for (const exp of existingProtected) {
    const key = normalizeSectionTitle(exp.heading || exp.title);
    const matchIndex = result.findIndex(
      (s) => normalizeSectionTitle(s.heading || s.title) === key
    );

    if (matchIndex !== -1) {
      const target = result[matchIndex];
      if (!target) {
        continue;
      }

      if (allowAppend) {
        const existingLines = extractSignificantLines(exp.content);
        const targetLines = extractSignificantLines(target.content);
        const startsWithExisting =
          targetLines.length >= existingLines.length &&
          existingLines.every((l, i) => l === targetLines[i]);

        if (!startsWithExisting) {
          result[matchIndex] = { ...exp };
        }
      } else {
        result[matchIndex] = { ...exp };
      }
    }
  }

  // Second, reinsert any protected sections that were deleted in newContent
  for (const exp of existingProtected) {
    const key = normalizeSectionTitle(exp.heading || exp.title);
    const exists = result.some(
      (s) => normalizeSectionTitle(s.heading || s.title) === key
    );

    if (!exists) {
      const expIdx = existingSections.indexOf(exp);
      let insertIndex = result.length;

      for (let prev = expIdx - 1; prev >= 0; prev--) {
        const prevSection = existingSections[prev];
        if (!prevSection) {
          continue;
        }
        const prevKey = normalizeSectionTitle(prevSection.heading || prevSection.title);
        const foundIndex = result.findIndex(
          (s) => normalizeSectionTitle(s.heading || s.title) === prevKey
        );
        if (foundIndex !== -1) {
          insertIndex = foundIndex + 1;
          break;
        }
      }

      result.splice(insertIndex, 0, { ...exp });
    }
  }

  return (
    result
      .map((s) => {
        if (!s.heading) {
          return s.content.trimEnd();
        }
        return s.content.trim().length > 0
          ? `${s.heading}\n${s.content.trimEnd()}`
          : s.heading;
      })
      .filter((block) => block.length > 0)
      .join("\n\n") + "\n"
  );
}

/**
 * Writes content to a file atomically via a temporary swap file.
 * Creates parent directories recursively if they do not exist.
 * Enforces protected section preservation on BRIEFING.md by default.
 */
export async function writeAtomic(
  targetPath: string,
  content: string | Uint8Array,
  options?: WriteAtomicOptions
): Promise<void> {
  const normalizedPath = normalize(resolve(targetPath));
  const isBriefing = normalizedPath.endsWith(STORAGE_CONSTANTS.FILE_BRIEFING);
  const shouldGuard = options?.guardProtectedSections ?? isBriefing;

  if (shouldGuard && (await fileExists(normalizedPath))) {
    const existingContent = await readAtomic(normalizedPath);
    const newContentStr =
      typeof content === "string"
        ? content
        : new TextDecoder().decode(content);

    assertProtectedSectionsPreserved(
      existingContent,
      newContentStr,
      normalizedPath,
      options?.guardOptions
    );
  }

  const targetDir = dirname(normalizedPath);

  try {
    await mkdir(targetDir, { recursive: true });
  } catch (error) {
    throw new StorageError(
      `Failed to create directory "${targetDir}": ${error instanceof Error ? error.message : String(error)}`,
      STORAGE_ERROR_CODES.WRITE_FAILED,
      targetDir,
      error
    );
  }

  const swapPath = `${normalizedPath}.${STORAGE_CONSTANTS.SWAP_PREFIX}.${randomUUID()}`;

  try {
    await writeFile(swapPath, content, {
      encoding: options?.encoding ?? STORAGE_CONSTANTS.DEFAULT_ENCODING,
      mode: options?.mode,
    });
    await rename(swapPath, normalizedPath);
  } catch (error) {
    try {
      if (existsSync(swapPath)) {
        await unlink(swapPath);
      }
    } catch {
      // Ignore cleanup error on failed swap removal
    }
    throw new StorageError(
      `Failed to write atomically to "${normalizedPath}": ${error instanceof Error ? error.message : String(error)}`,
      STORAGE_ERROR_CODES.WRITE_FAILED,
      normalizedPath,
      error
    );
  }
}

/**
 * Writes content specifically to BRIEFING.md atomically with protected section guard.
 * Optionally auto-merges and restores protected sections if requested.
 */
export async function writeBriefingAtomic(
  targetPath: string,
  content: string,
  options?: WriteBriefingOptions
): Promise<void> {
  const normalizedPath = normalize(resolve(targetPath));
  let finalContent = content;

  if (await fileExists(normalizedPath)) {
    const existingContent = await readAtomic(normalizedPath);
    if (options?.autoMergeProtected) {
      finalContent = mergeProtectedSections(existingContent, content, options?.guardOptions);
    } else {
      assertProtectedSectionsPreserved(
        existingContent,
        content,
        normalizedPath,
        options?.guardOptions
      );
    }
  }

  await writeAtomic(normalizedPath, finalContent, {
    ...options,
    guardProtectedSections: false,
  });
}

/**
 * Reads a file's content atomically with error classification.
 */
export async function readAtomic(
  targetPath: string,
  encoding: BufferEncoding = STORAGE_CONSTANTS.DEFAULT_ENCODING
): Promise<string> {
  const normalizedPath = normalize(resolve(targetPath));
  try {
    return await readFile(normalizedPath, encoding);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new StorageError(
        `File not found at "${normalizedPath}"`,
        STORAGE_ERROR_CODES.FILE_NOT_FOUND,
        normalizedPath,
        error
      );
    }
    throw new StorageError(
      `Failed to read file at "${normalizedPath}": ${err.message}`,
      STORAGE_ERROR_CODES.READ_FAILED,
      normalizedPath,
      error
    );
  }
}

/**
 * Checks whether a file exists at the specified path.
 */
export async function fileExists(targetPath: string): Promise<boolean> {
  const normalizedPath = normalize(resolve(targetPath));
  try {
    await stat(normalizedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scaffolds an array of directories recursively.
 */
export async function scaffoldDirectories(directories: readonly string[] | string[]): Promise<string[]> {
  const created: string[] = [];
  for (const dir of directories) {
    const normalizedDir = normalize(resolve(dir));
    try {
      await mkdir(normalizedDir, { recursive: true });
      created.push(normalizedDir);
    } catch (error) {
      throw new StorageError(
        `Failed to scaffold directory "${normalizedDir}": ${error instanceof Error ? error.message : String(error)}`,
        STORAGE_ERROR_CODES.SCAFFOLD_FAILED,
        normalizedDir,
        error
      );
    }
  }
  return created;
}

/**
 * Parses the last heartbeat timestamp from progress content.
 * Falls back to the file modification time if available when content has no valid timestamp.
 */
export function parseHeartbeatTimestamp(
  content: string,
  fallbackMtimeMs?: number
): Date | null {
  if (!content || content.trim().length === 0) {
    if (fallbackMtimeMs !== undefined && fallbackMtimeMs > 0) {
      return new Date(fallbackMtimeMs);
    }
    return null;
  }

  const matches = content.matchAll(
    /(?:^|\r?\n)\s*(?:[-*]\s*)?Last visited:\s*([^\r\n]+)/gi
  );

  let latestDate: Date | null = null;
  let latestTime = 0;

  for (const match of matches) {
    const rawVal = match[1];
    if (!rawVal) {
      continue;
    }

    const cleaned = rawVal.replace(/^\[\s*|\s*\]$/g, "").trim();
    if (cleaned.length === 0) {
      continue;
    }

    let parsedDate: Date | null = null;

    if (
      /^\d+$/.test(cleaned) &&
      cleaned.length >= STORAGE_CONSTANTS.MIN_EPOCH_TIMESTAMP_DIGITS
    ) {
      const epoch = Number(cleaned);
      if (!Number.isNaN(epoch) && epoch > 0) {
        parsedDate = new Date(epoch);
      }
    } else {
      const parsedEpoch = Date.parse(cleaned);
      if (!Number.isNaN(parsedEpoch)) {
        parsedDate = new Date(parsedEpoch);
      }
    }

    if (parsedDate !== null && !Number.isNaN(parsedDate.getTime())) {
      const time = parsedDate.getTime();
      if (time > latestTime) {
        latestTime = time;
        latestDate = parsedDate;
      }
    }
  }

  if (latestDate !== null) {
    return latestDate;
  }

  if (fallbackMtimeMs !== undefined && fallbackMtimeMs > 0) {
    return new Date(fallbackMtimeMs);
  }

  return null;
}

/**
 * Formats progress content with an updated heartbeat timestamp line.
 * Replaces existing "Last visited:" line or inserts one after the first heading.
 */
export function formatHeartbeatContent(
  existingContent: string | null,
  timestamp: Date
): string {
  const iso = timestamp.toISOString();
  const heartbeatLine = `${STORAGE_CONSTANTS.HEARTBEAT_TIMESTAMP_PREFIX} ${iso}`;

  if (!existingContent || existingContent.trim().length === 0) {
    return `# Progress Log\n\n${heartbeatLine}\n`;
  }

  const heartbeatRegex = /^(\s*(?:[-*]\s*)?Last visited:\s*)([^\r\n]+)/m;
  if (heartbeatRegex.test(existingContent)) {
    return existingContent.replace(heartbeatRegex, `$1${iso}`);
  }

  const firstHeadingRegex = /^(#{1,6}\s+[^\r\n]+)/m;
  const headingMatch = existingContent.match(firstHeadingRegex);
  if (headingMatch && headingMatch[0] !== undefined) {
    const headingIndex = existingContent.indexOf(headingMatch[0]);
    const insertPos = headingIndex + headingMatch[0].length;
    return `${existingContent.slice(0, insertPos)}\n\n${heartbeatLine}${existingContent.slice(insertPos)}`;
  }

  return `${heartbeatLine}\n\n${existingContent}`;
}

/**
 * Atomically updates the heartbeat timestamp in an agent's progress.md file.
 */
export async function touchAgentHeartbeat(
  progressPath: string,
  timestamp: Date | number = new Date()
): Promise<Date> {
  const normalizedPath = normalize(resolve(progressPath));
  const tsDate = typeof timestamp === "number" ? new Date(timestamp) : timestamp;

  let existingContent: string | null = null;
  if (await fileExists(normalizedPath)) {
    try {
      existingContent = await readAtomic(normalizedPath);
    } catch {
      existingContent = null;
    }
  }

  const updatedContent = formatHeartbeatContent(existingContent, tsDate);
  await writeAtomic(normalizedPath, updatedContent, { guardProtectedSections: false });
  return tsDate;
}

/**
 * Reads and parses the last heartbeat timestamp from an agent's progress.md file.
 */
export async function readAgentHeartbeat(
  progressPath: string
): Promise<Date | null> {
  const normalizedPath = normalize(resolve(progressPath));
  if (!(await fileExists(normalizedPath))) {
    return null;
  }
  const content = await readAtomic(normalizedPath);
  let fileMtimeMs: number | undefined;
  try {
    const s = await stat(normalizedPath);
    fileMtimeMs = s.mtimeMs;
  } catch {
    fileMtimeMs = undefined;
  }
  return parseHeartbeatTimestamp(content, fileMtimeMs);
}

/**
 * Inspects an agent's heartbeat timestamp against the staleness SLA threshold.
 */
export async function inspectAgentHeartbeat(
  agentId: string,
  options?: InspectAgentHeartbeatOptions
): Promise<HeartbeatInspectionResult> {
  const thresholdMs =
    options?.thresholdMs ?? STORAGE_CONSTANTS.STALE_HEARTBEAT_THRESHOLD_MS;
  const nowMs = options?.nowMs ?? Date.now();

  let progressPath: string;
  if (options?.progressPath) {
    progressPath = normalize(resolve(options.progressPath));
  } else if (options?.baseDir) {
    progressPath = normalize(
      resolve(options.baseDir, agentId, STORAGE_CONSTANTS.FILE_PROGRESS)
    );
  } else {
    progressPath = normalize(
      resolve(
        process.cwd(),
        STORAGE_CONSTANTS.DEFAULT_BASE_DIR,
        agentId,
        STORAGE_CONSTANTS.FILE_PROGRESS
      )
    );
  }

  const workspaceDir = dirname(progressPath);

  if (await fileExists(progressPath)) {
    let content = "";
    let fileMtimeMs = 0;
    try {
      content = await readAtomic(progressPath);
      const fileStat = await stat(progressPath);
      fileMtimeMs = fileStat.mtimeMs;
    } catch {
      // Ignore transient read error
    }

    const lastHeartbeat = parseHeartbeatTimestamp(content, fileMtimeMs);

    if (lastHeartbeat !== null) {
      const elapsedMs = Math.max(0, nowMs - lastHeartbeat.getTime());
      const isStale = elapsedMs > thresholdMs;
      return {
        agentId,
        status: isStale ? "stale" : "healthy",
        progressPath,
        lastHeartbeat,
        elapsedMs,
        thresholdMs,
        isStale,
        reason: isStale ? "heartbeat_expired" : undefined,
      };
    }

    const elapsedMs =
      fileMtimeMs > 0 ? Math.max(0, nowMs - fileMtimeMs) : thresholdMs + 1;
    const isStale = elapsedMs > thresholdMs;
    return {
      agentId,
      status: isStale ? "stale" : "healthy",
      progressPath,
      lastHeartbeat: fileMtimeMs > 0 ? new Date(fileMtimeMs) : null,
      elapsedMs,
      thresholdMs,
      isStale,
      reason: isStale ? "heartbeat_expired" : undefined,
    };
  }

  let dirMtimeMs = 0;
  let dirExists = false;
  try {
    const dirStat = await stat(workspaceDir);
    dirExists = true;
    dirMtimeMs = dirStat.mtimeMs;
  } catch {
    dirExists = false;
  }

  if (dirExists && dirMtimeMs > 0) {
    const elapsedMs = Math.max(0, nowMs - dirMtimeMs);
    const isStale = elapsedMs > thresholdMs;
    return {
      agentId,
      status: isStale ? "stale" : "healthy",
      progressPath,
      lastHeartbeat: null,
      elapsedMs,
      thresholdMs,
      isStale,
      reason: isStale ? "heartbeat_missing" : undefined,
    };
  }

  if (options?.registeredAt !== undefined && options.registeredAt > 0) {
    const elapsedMs = Math.max(0, nowMs - options.registeredAt);
    const isStale = elapsedMs > thresholdMs;
    return {
      agentId,
      status: isStale ? "missing" : "healthy",
      progressPath,
      lastHeartbeat: null,
      elapsedMs,
      thresholdMs,
      isStale,
      reason: isStale ? "heartbeat_missing" : undefined,
    };
  }

  return {
    agentId,
    status: "missing",
    progressPath,
    lastHeartbeat: null,
    elapsedMs: thresholdMs + 1,
    thresholdMs,
    isStale: true,
    reason: "heartbeat_missing",
  };
}

/**
 * Heartbeat watchdog timer detecting stalled subagents exceeding the SLA threshold (default 5 minutes).
 *
 * Emits "staleness" and "stale" events when an agent exceeds the SLA without touching progress.md,
 * and emits "recovery" when a previously stalled agent touches heartbeat again.
 */
export class HeartbeatWatchdog extends EventEmitter {
  private readonly baseDir?: string;
  private readonly thresholdMs: number;
  private readonly checkIntervalMs: number;
  private readonly nowFn: () => number;
  private readonly unrefTimer: boolean;
  private readonly scanWorkspaces: boolean;
  private readonly onStaleCallback?: (
    event: HeartbeatStalenessEvent
  ) => void | Promise<void>;
  private readonly onRecoveryCallback?: (agentId: string) => void | Promise<void>;

  private timer: ReturnType<typeof setInterval> | null = null;
  private isChecking: boolean = false;
  private readonly registeredAgents: Map<string, AgentRegistrationOptions> =
    new Map();
  private readonly staleAgentIds: Set<string> = new Set();
  private readonly triggeredEvents: HeartbeatStalenessEvent[] = [];

  constructor(options?: HeartbeatWatchdogOptions) {
    super();
    this.baseDir = options?.baseDir
      ? normalize(resolve(options.baseDir))
      : undefined;
    this.thresholdMs =
      options?.thresholdMs ?? STORAGE_CONSTANTS.STALE_HEARTBEAT_THRESHOLD_MS;
    this.checkIntervalMs =
      options?.checkIntervalMs ??
      STORAGE_CONSTANTS.DEFAULT_WATCHDOG_CHECK_INTERVAL_MS;
    this.nowFn = options?.nowFn ?? (() => Date.now());
    this.unrefTimer = options?.unrefTimer ?? true;
    this.scanWorkspaces =
      options?.scanWorkspaces ?? this.baseDir !== undefined;
    this.onStaleCallback = options?.onStale;
    this.onRecoveryCallback = options?.onRecovery;
  }

  public getBaseDir(): string | undefined {
    return this.baseDir;
  }

  public getThresholdMs(): number {
    return this.thresholdMs;
  }

  public getCheckIntervalMs(): number {
    return this.checkIntervalMs;
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }

  public registerAgent(
    agentId: string,
    options?: AgentRegistrationOptions
  ): this {
    this.registeredAgents.set(agentId, {
      registeredAt: options?.registeredAt ?? Date.now(),
      thresholdMs: options?.thresholdMs,
    });
    return this;
  }

  public unregisterAgent(agentId: string): boolean {
    this.staleAgentIds.delete(agentId);
    return this.registeredAgents.delete(agentId);
  }

  public isAgentRegistered(agentId: string): boolean {
    return this.registeredAgents.has(agentId);
  }

  public getRegisteredAgents(): string[] {
    return Array.from(this.registeredAgents.keys());
  }

  public getStaleAgents(): string[] {
    return Array.from(this.staleAgentIds);
  }

  public isAgentStale(agentId: string): boolean {
    return this.staleAgentIds.has(agentId);
  }

  public getTriggeredEvents(): readonly HeartbeatStalenessEvent[] {
    return this.triggeredEvents;
  }

  public clearTriggeredEvents(): void {
    this.triggeredEvents.length = 0;
  }

  public onStaleness(
    listener: (event: HeartbeatStalenessEvent) => void
  ): this {
    this.on("staleness", listener);
    return this;
  }

  public onRecovery(
    listener: (event: HeartbeatRecoveryEvent) => void
  ): this {
    this.on("recovery", listener);
    return this;
  }

  public onCheck(
    listener: (results: HeartbeatInspectionResult[]) => void
  ): this {
    this.on("check", listener);
    return this;
  }

  public async discoverAgents(): Promise<string[]> {
    const agents = new Set<string>(this.registeredAgents.keys());

    if (this.scanWorkspaces && this.baseDir && existsSync(this.baseDir)) {
      try {
        const entries = await readdir(this.baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const dirName = entry.name;
          if (
            dirName.startsWith(".") ||
            dirName.startsWith(STORAGE_CONSTANTS.SWAP_PREFIX)
          ) {
            continue;
          }
          if (
            dirName === STORAGE_CONSTANTS.DIR_SENTINEL ||
            dirName === STORAGE_CONSTANTS.DIR_BRIEFING ||
            dirName === STORAGE_CONSTANTS.DIR_STATE
          ) {
            continue;
          }
          agents.add(dirName);
        }
      } catch (error) {
        throw new StorageError(
          `Failed to discover agents in "${this.baseDir}": ${error instanceof Error ? error.message : String(error)}`,
          STORAGE_ERROR_CODES.READ_FAILED,
          this.baseDir,
          error
        );
      }
    }

    return Array.from(agents);
  }

  public async checkAgent(
    agentId: string,
    nowMs?: number
  ): Promise<HeartbeatInspectionResult> {
    const currentTimeMs = nowMs ?? this.nowFn();
    const registration = this.registeredAgents.get(agentId);
    const thresholdMs = registration?.thresholdMs ?? this.thresholdMs;

    const registeredAtMs =
      registration?.registeredAt instanceof Date
        ? registration.registeredAt.getTime()
        : registration?.registeredAt;

    const result = await inspectAgentHeartbeat(agentId, {
      baseDir: this.baseDir,
      thresholdMs,
      nowMs: currentTimeMs,
      registeredAt: registeredAtMs,
    });

    if (result.isStale) {
      if (!this.staleAgentIds.has(agentId)) {
        this.staleAgentIds.add(agentId);

        const stalenessEvent: HeartbeatStalenessEvent = {
          type: STORAGE_CONSTANTS.WATCHDOG_EVENT_STALENESS,
          agentId,
          progressPath: result.progressPath,
          lastHeartbeat: result.lastHeartbeat,
          elapsedMs: result.elapsedMs,
          thresholdMs: result.thresholdMs,
          detectedAt: new Date(currentTimeMs),
          reason: result.reason ?? "heartbeat_expired",
        };

        this.triggeredEvents.push(stalenessEvent);
        this.emit("staleness", stalenessEvent);
        this.emit("stale", stalenessEvent);

        if (this.onStaleCallback) {
          try {
            await this.onStaleCallback(stalenessEvent);
          } catch {
            // Callback failure does not interrupt watchdog execution
          }
        }
      }
    } else {
      if (this.staleAgentIds.has(agentId)) {
        this.staleAgentIds.delete(agentId);

        const recoveryEvent: HeartbeatRecoveryEvent = {
          type: STORAGE_CONSTANTS.WATCHDOG_EVENT_RECOVERY,
          agentId,
          recoveredAt: new Date(currentTimeMs),
        };

        this.emit("recovery", recoveryEvent);
        this.emit("recovered", agentId);

        if (this.onRecoveryCallback) {
          try {
            await this.onRecoveryCallback(agentId);
          } catch {
            // Callback failure does not interrupt watchdog execution
          }
        }
      }
    }

    return result;
  }

  public async checkAll(
    nowMs?: number
  ): Promise<HeartbeatInspectionResult[]> {
    if (this.isChecking) {
      return [];
    }
    this.isChecking = true;
    try {
      const currentTimeMs = nowMs ?? this.nowFn();
      const agentIds = await this.discoverAgents();
      const results: HeartbeatInspectionResult[] = [];

      for (const agentId of agentIds) {
        const result = await this.checkAgent(agentId, currentTimeMs);
        results.push(result);
      }

      this.emit("check", results);
      return results;
    } finally {
      this.isChecking = false;
    }
  }

  public async checkOnce(
    nowMs?: number
  ): Promise<HeartbeatStalenessEvent[]> {
    const beforeCount = this.triggeredEvents.length;
    await this.checkAll(nowMs);
    return this.triggeredEvents.slice(beforeCount);
  }

  public start(): this {
    if (this.timer !== null) {
      return this;
    }

    this.timer = setInterval(() => {
      void this.checkAll().catch(() => {
        // Suppress unhandled rejection in background interval
      });
    }, this.checkIntervalMs);

    if (this.unrefTimer && typeof this.timer?.unref === "function") {
      this.timer.unref();
    }

    return this;
  }

  public stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  public dispose(): void {
    this.stop();
    this.removeAllListeners();
    this.registeredAgents.clear();
    this.staleAgentIds.clear();
  }
}

/**
 * Factory helper to instantiate a HeartbeatWatchdog.
 */
export function createHeartbeatWatchdog(
  options?: HeartbeatWatchdogOptions
): HeartbeatWatchdog {
  return new HeartbeatWatchdog(options);
}

/**
 * Memory storage manager providing persistent FS hierarchy, atomic writes,
 * and protected section guards for agent memory.
 */
export class MemoryStorage {
  private readonly baseDir: string;
  private readonly sentinelDir: string;
  private readonly briefingDir: string;
  private readonly stateDir: string;

  constructor(options?: MemoryStorageOptions) {
    if (options?.baseDir) {
      this.baseDir = normalize(resolve(options.baseDir));
    } else if (options?.repoRoot) {
      this.baseDir = normalize(resolve(options.repoRoot, STORAGE_CONSTANTS.DEFAULT_BASE_DIR));
    } else {
      this.baseDir = normalize(resolve(process.cwd(), STORAGE_CONSTANTS.DEFAULT_BASE_DIR));
    }

    this.sentinelDir = join(this.baseDir, STORAGE_CONSTANTS.DIR_SENTINEL);
    this.briefingDir = join(this.baseDir, STORAGE_CONSTANTS.DIR_BRIEFING);
    this.stateDir = join(this.baseDir, STORAGE_CONSTANTS.DIR_STATE);
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public getSentinelDir(): string {
    return this.sentinelDir;
  }

  public getBriefingDir(): string {
    return this.briefingDir;
  }

  public getStateDir(): string {
    return this.stateDir;
  }

  public getAgentDir(agentId: string): string {
    return join(this.baseDir, agentId);
  }

  /**
   * Resolves the canonical path to an agent's BRIEFING.md.
   */
  public getBriefingPath(agentIdOrPath: string): string {
    const normalized = normalize(agentIdOrPath);
    if (normalized.endsWith(STORAGE_CONSTANTS.FILE_BRIEFING)) {
      return resolve(normalized);
    }
    return join(this.getAgentDir(agentIdOrPath), STORAGE_CONSTANTS.FILE_BRIEFING);
  }

  /**
   * Reads the BRIEFING.md content for an agent.
   */
  public async readBriefing(agentIdOrPath: string): Promise<string> {
    const briefingPath = this.getBriefingPath(agentIdOrPath);
    return await this.readAtomic(briefingPath);
  }

  /**
   * Writes content to BRIEFING.md protected by the protected section guard.
   * Prevents accidental overwrite or deletion of protected sections (e.g. ## 🔒 My Identity).
   */
  public async writeBriefing(
    agentIdOrPath: string,
    content: string,
    options?: WriteBriefingOptions
  ): Promise<void> {
    const briefingPath = this.getBriefingPath(agentIdOrPath);
    await writeBriefingAtomic(briefingPath, content, options);
  }

  /**
   * Validates proposed briefing content against the existing file without writing.
   */
  public async validateBriefing(
    agentIdOrPath: string,
    content: string,
    options?: ProtectedSectionGuardOptions
  ): Promise<ProtectedSectionValidationResult> {
    const briefingPath = this.getBriefingPath(agentIdOrPath);
    if (!(await fileExists(briefingPath))) {
      return { isValid: true, violations: [] };
    }
    const existingContent = await this.readAtomic(briefingPath);
    return validateProtectedSections(existingContent, content, options);
  }

  /**
   * Initializes the base directory hierarchy: sentinel, briefing, and state directories.
   */
  public async initializeScaffolding(): Promise<StorageScaffoldResult> {
    const dirsToCreate = [this.baseDir, this.sentinelDir, this.briefingDir, this.stateDir];
    const createdDirectories = await scaffoldDirectories(dirsToCreate);

    return {
      baseDir: this.baseDir,
      sentinelDir: this.sentinelDir,
      briefingDir: this.briefingDir,
      stateDir: this.stateDir,
      createdDirectories,
    };
  }

  /**
   * Scaffolds an isolated workspace for a subagent with canonical file templates.
   */
  public async scaffoldAgentWorkspace(
    agentId: string,
    options?: ScaffoldAgentOptions
  ): Promise<AgentWorkspaceInfo> {
    const workspaceDir = this.getAgentDir(agentId);
    await scaffoldDirectories([workspaceDir]);

    const briefingPath = join(workspaceDir, STORAGE_CONSTANTS.FILE_BRIEFING);
    const progressPath = join(workspaceDir, STORAGE_CONSTANTS.FILE_PROGRESS);
    const dispatchPath = join(workspaceDir, STORAGE_CONSTANTS.FILE_DISPATCH);
    const handoffPath = join(workspaceDir, STORAGE_CONSTANTS.FILE_HANDOFF);

    if (options?.initialBriefing !== undefined) {
      await this.writeAtomic(briefingPath, options.initialBriefing);
    }
    if (options?.initialDispatch !== undefined) {
      await this.writeAtomic(dispatchPath, options.initialDispatch);
    }
    if (options?.initialProgress !== undefined) {
      await this.writeAtomic(progressPath, options.initialProgress);
    }

    return {
      agentId,
      workspaceDir,
      briefingPath,
      progressPath,
      handoffPath,
      dispatchPath,
    };
  }

  /**
   * Writes content atomically to a path within or relative to the storage system.
   */
  public async writeAtomic(
    targetPath: string,
    content: string | Uint8Array,
    options?: WriteAtomicOptions
  ): Promise<void> {
    await writeAtomic(targetPath, content, options);
  }

  /**
   * Reads content atomically from a file.
   */
  public async readAtomic(
    targetPath: string,
    encoding: BufferEncoding = STORAGE_CONSTANTS.DEFAULT_ENCODING
  ): Promise<string> {
    return await readAtomic(targetPath, encoding);
  }

  /**
   * Checks whether a file exists at the specified path.
   */
  public async fileExists(targetPath: string): Promise<boolean> {
    return await fileExists(targetPath);
  }

  /**
   * Serializes state data to a JSON file atomically inside the state directory.
   */
  public async writeStateAtomic<T>(
    stateName: string,
    data: T,
    options?: WriteStateOptions
  ): Promise<void> {
    const fileName = stateName.endsWith(STORAGE_CONSTANTS.JSON_EXTENSION)
      ? stateName
      : `${stateName}${STORAGE_CONSTANTS.JSON_EXTENSION}`;
    const targetPath = join(this.stateDir, fileName);

    let serialized: string;
    try {
      const indent = options?.indent ?? STORAGE_CONSTANTS.DEFAULT_JSON_INDENT;
      serialized = JSON.stringify(data, null, indent);
    } catch (error) {
      throw new StorageError(
        `Failed to serialize state "${stateName}": ${error instanceof Error ? error.message : String(error)}`,
        STORAGE_ERROR_CODES.SERIALIZATION_FAILED,
        targetPath,
        error
      );
    }

    await this.writeAtomic(targetPath, serialized, options);
  }

  /**
   * Reads and deserializes a JSON state file from the state directory.
   * Returns null if the file does not exist.
   */
  public async readState<T>(stateName: string): Promise<T | null> {
    const fileName = stateName.endsWith(STORAGE_CONSTANTS.JSON_EXTENSION)
      ? stateName
      : `${stateName}${STORAGE_CONSTANTS.JSON_EXTENSION}`;
    const targetPath = join(this.stateDir, fileName);

    let content: string;
    try {
      content = await readFile(targetPath, STORAGE_CONSTANTS.DEFAULT_ENCODING);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return null;
      }
      throw new StorageError(
        `Failed to read state "${stateName}": ${err.message}`,
        STORAGE_ERROR_CODES.READ_FAILED,
        targetPath,
        error
      );
    }

    try {
      return JSON.parse(content) as T;
    } catch (error) {
      throw new StorageError(
        `Failed to parse state JSON "${stateName}": ${error instanceof Error ? error.message : String(error)}`,
        STORAGE_ERROR_CODES.DESERIALIZATION_FAILED,
        targetPath,
        error
      );
    }
  }

  /**
   * Checks whether a state file exists in the state directory.
   */
  public async stateExists(stateName: string): Promise<boolean> {
    const fileName = stateName.endsWith(STORAGE_CONSTANTS.JSON_EXTENSION)
      ? stateName
      : `${stateName}${STORAGE_CONSTANTS.JSON_EXTENSION}`;
    const targetPath = join(this.stateDir, fileName);
    return await fileExists(targetPath);
  }

  /**
   * Deletes a state file from the state directory.
   * Returns true if deleted, false if file did not exist.
   */
  public async deleteState(stateName: string): Promise<boolean> {
    const fileName = stateName.endsWith(STORAGE_CONSTANTS.JSON_EXTENSION)
      ? stateName
      : `${stateName}${STORAGE_CONSTANTS.JSON_EXTENSION}`;
    const targetPath = join(this.stateDir, fileName);
    try {
      await unlink(targetPath);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return false;
      }
      throw new StorageError(
        `Failed to delete state "${stateName}": ${err.message}`,
        STORAGE_ERROR_CODES.WRITE_FAILED,
        targetPath,
        error
      );
    }
  }

  /**
   * Lists all state file names present in the state directory.
   */
  public async listStates(): Promise<string[]> {
    try {
      if (!existsSync(this.stateDir)) {
        return [];
      }
      const files = await readdir(this.stateDir);
      return files.filter((f) => f.endsWith(STORAGE_CONSTANTS.JSON_EXTENSION));
    } catch (error) {
      throw new StorageError(
        `Failed to list states: ${error instanceof Error ? error.message : String(error)}`,
        STORAGE_ERROR_CODES.READ_FAILED,
        this.stateDir,
        error
      );
    }
  }

  /**
   * Resolves the canonical path to an agent's progress.md.
   */
  public getProgressPath(agentIdOrPath: string): string {
    const normalized = normalize(agentIdOrPath);
    if (normalized.endsWith(STORAGE_CONSTANTS.FILE_PROGRESS)) {
      return resolve(normalized);
    }
    return join(this.getAgentDir(agentIdOrPath), STORAGE_CONSTANTS.FILE_PROGRESS);
  }

  /**
   * Touches the heartbeat for an agent in its progress.md file.
   */
  public async touchHeartbeat(
    agentIdOrPath: string,
    timestamp: Date | number = new Date()
  ): Promise<Date> {
    const progressPath = this.getProgressPath(agentIdOrPath);
    return await touchAgentHeartbeat(progressPath, timestamp);
  }

  /**
   * Reads the current heartbeat timestamp from an agent's progress.md file.
   */
  public async getHeartbeat(agentIdOrPath: string): Promise<Date | null> {
    const progressPath = this.getProgressPath(agentIdOrPath);
    return await readAgentHeartbeat(progressPath);
  }

  /**
   * Checks the heartbeat status of a single agent against the SLA threshold.
   */
  public async checkHeartbeat(
    agentId: string,
    options?: { thresholdMs?: number; nowMs?: number }
  ): Promise<HeartbeatInspectionResult> {
    return await inspectAgentHeartbeat(agentId, {
      baseDir: this.baseDir,
      thresholdMs: options?.thresholdMs,
      nowMs: options?.nowMs,
    });
  }

  /**
   * Checks heartbeat status across all agents in the base directory.
   */
  public async checkAllHeartbeats(
    options?: { thresholdMs?: number; nowMs?: number }
  ): Promise<HeartbeatInspectionResult[]> {
    const watchdog = this.createWatchdog({
      thresholdMs: options?.thresholdMs,
      nowFn: options?.nowMs !== undefined ? () => options.nowMs! : undefined,
    });
    return await watchdog.checkAll(options?.nowMs);
  }

  /**
   * Creates a HeartbeatWatchdog configured for this memory storage hierarchy.
   */
  public createWatchdog(
    options?: Partial<HeartbeatWatchdogOptions>
  ): HeartbeatWatchdog {
    return new HeartbeatWatchdog({
      baseDir: this.baseDir,
      ...options,
    });
  }
}

/**
 * Factory helper to instantiate MemoryStorage.
 */
export function createMemoryStorage(options?: MemoryStorageOptions): MemoryStorage {
  return new MemoryStorage(options);
}
