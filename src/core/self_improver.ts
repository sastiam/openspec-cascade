/**
 * Self-improving loop: persists redacted run telemetry and turns recurring failure
 * signatures into a bounded set of remediation directives for `HarnessInjector`.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { GREPTILE_CONSTANTS, SELF_IMPROVER_CONSTANTS, TELEMETRY_CONSTANTS } from "../config/constants";
import { redactSensitiveData } from "../config/guardrails";
import type { RemediationDirective } from "./harness_injector";

export type FailureCategory =
  | (typeof SELF_IMPROVER_CONSTANTS.CATEGORY_PATTERNS)[number][0]
  | typeof SELF_IMPROVER_CONSTANTS.UNKNOWN_CATEGORY;

export interface RunTelemetry {
  readonly timestamp: string;
  readonly change?: string;
  readonly taskId?: string;
  readonly engine?: string;
  readonly source: "session" | "gate" | "escalation";
  readonly outcome: string;
  readonly failureTrace?: string;
  readonly costUsd?: number;
  readonly latencyMs?: number;
  readonly attempt?: number;
}

export interface SelfImproverOptions {
  readonly dir?: string;
  readonly rootDir?: string;
  readonly now?: () => number;
  readonly minOccurrences?: number;
  readonly maxDirectives?: number;
}

const PATH_PATTERN = /(?:[a-z]:)?(?:[./~\\]|\b[\w-]+\/)[\w./\\-]*\.[a-z]{1,5}\b/gi;
const HEX_PATTERN = /\b[0-9a-f]{7,64}\b/gi;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/g;
const QUOTED_PATTERN = /(["'`])(?:(?!\1).){1,120}\1/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Classifies a failure trace into a remediation category.
 */
export function categorizeFailure(trace: string): FailureCategory {
  for (const [category, pattern] of SELF_IMPROVER_CONSTANTS.CATEGORY_PATTERNS) {
    if (pattern.test(trace)) return category;
  }
  return SELF_IMPROVER_CONSTANTS.UNKNOWN_CATEGORY;
}

/**
 * Normalizes volatile parts of a trace (paths, hashes, numbers, quoted literals) so recurrences collide.
 */
export function normalizeFailureTrace(trace: string): string {
  return trace
    .toLowerCase()
    .replace(QUOTED_PATTERN, "<str>")
    .replace(PATH_PATTERN, "<path>")
    .replace(HEX_PATTERN, "<hex>")
    .replace(NUMBER_PATTERN, "<n>")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()
    .slice(0, SELF_IMPROVER_CONSTANTS.SIGNATURE_MAX_CHARS);
}

/**
 * Stable SHA-256 signature of a normalized trace.
 */
export function failureSignature(trace: string): string {
  return createHash(GREPTILE_CONSTANTS.HASH_ALGORITHM).update(normalizeFailureTrace(trace)).digest("hex");
}

function isRunTelemetry(value: unknown): value is RunTelemetry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.timestamp === "string" && typeof record.source === "string" && typeof record.outcome === "string";
}

export class SelfImprover {
  readonly dir: string;
  private readonly now: () => number;
  private readonly minOccurrences: number;
  private readonly maxDirectives: number;

  constructor(options: SelfImproverOptions = {}) {
    const dir = options.dir ?? TELEMETRY_CONSTANTS.DEFAULT_TELEMETRY_DIR;
    this.dir = isAbsolute(dir) ? dir : join(options.rootDir ?? process.cwd(), dir);
    this.now = options.now ?? Date.now;
    this.minOccurrences = options.minOccurrences ?? SELF_IMPROVER_CONSTANTS.MIN_OCCURRENCES;
    this.maxDirectives = options.maxDirectives ?? SELF_IMPROVER_CONSTANTS.MAX_DIRECTIVES;
  }

  /**
   * Appends a redacted telemetry record to today's JSONL file.
   */
  recordOutcome(telemetry: Omit<RunTelemetry, "timestamp"> & { readonly timestamp?: string }): RunTelemetry {
    const timestamp = telemetry.timestamp ?? new Date(this.now()).toISOString();
    const record = redactSensitiveData({ ...telemetry, timestamp });
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(
      join(this.dir, `${timestamp.slice(0, SELF_IMPROVER_CONSTANTS.DATE_KEY_LENGTH)}${SELF_IMPROVER_CONSTANTS.FILE_EXTENSION}`),
      `${JSON.stringify(record)}\n`,
    );
    return record;
  }

  /**
   * Reads every telemetry record (oldest file first), skipping malformed lines.
   */
  loadHistory(): RunTelemetry[] {
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((file) => file.endsWith(SELF_IMPROVER_CONSTANTS.FILE_EXTENSION)).sort();
    } catch {
      return [];
    }
    return files.flatMap((file) =>
      readFileSync(join(this.dir, file), "utf8")
        .split("\n")
        .flatMap((line): RunTelemetry[] => {
          if (!line.trim()) return [];
          try {
            const parsed: unknown = JSON.parse(line);
            return isRunTelemetry(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        }),
    );
  }

  /**
   * Derives at most `maxDirectives` directives from signatures seen at least `minOccurrences` times.
   */
  deriveDirectives(history: readonly RunTelemetry[] = this.loadHistory()): RemediationDirective[] {
    const groups = new Map<string, { count: number; lastIndex: number; example: string }>();
    history.forEach((record, index) => {
      if (!record.failureTrace) return;
      const signature = failureSignature(record.failureTrace);
      const group = groups.get(signature);
      groups.set(signature, {
        count: (group?.count ?? 0) + 1,
        lastIndex: index,
        example: record.failureTrace,
      });
    });
    return [...groups.entries()]
      .filter(([, group]) => group.count >= this.minOccurrences)
      .sort(([leftSignature, left], [rightSignature, right]) => right.count - left.count || right.lastIndex - left.lastIndex || leftSignature.localeCompare(rightSignature))
      .slice(0, this.maxDirectives)
      .map(([signature, group]) => {
        const category = categorizeFailure(group.example);
        const example = group.example.replace(WHITESPACE_PATTERN, " ").trim().slice(0, SELF_IMPROVER_CONSTANTS.EXAMPLE_MAX_CHARS);
        return {
          id: `${SELF_IMPROVER_CONSTANTS.DIRECTIVE_ID_PREFIX}${signature.slice(0, SELF_IMPROVER_CONSTANTS.DIRECTIVE_ID_LENGTH)}`,
          signature,
          directive: `${SELF_IMPROVER_CONSTANTS.DIRECTIVE_TEMPLATES[category]} Recurring ${category}: "${example}"`,
          occurrences: group.count,
        };
      });
  }
}
