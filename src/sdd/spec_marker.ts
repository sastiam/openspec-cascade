/**
 * Review/drift marker for OpenSpec changes: a front-matter block with a status and a hash of the
 * change artifacts, so a review goes stale when proposal, design, tasks or specs change after it.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SPEC_GATE_CONSTANTS as C } from "../config/constants";

export type SpecStage = (typeof C.STAGES)[number];
export type SpecStatus = (typeof C.STATUSES)[number];

export interface SpecMarker {
  readonly stage: SpecStage;
  readonly status: SpecStatus;
  readonly hash: string;
}

export type StageFailure = "missing" | "malformed" | "open" | "stale";

export interface StageEvaluation {
  readonly ok: boolean;
  readonly reason?: StageFailure;
}

function normalize(content: string): string {
  return content.replace(C.CRLF, "\n").replace(C.TASK_CHECKBOX, C.TASK_CHECKBOX_OPEN);
}

function specFiles(changeDir: string): string[] {
  const specsDir = join(changeDir, C.SPECS_DIR);
  if (!existsSync(specsDir)) return [];
  return readdirSync(specsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(C.SPECS_DIR, entry.name, C.SPEC_FILE_NAME))
    .filter((relative) => existsSync(join(changeDir, relative)));
}

/**
 * Hashes proposal, design, tasks and delta specs of a change. Task checkboxes and CRLF are normalized.
 */
export function computeChangeHash(changeDir: string): string {
  const relatives = [...C.HASHED_TOP_LEVEL_FILES, ...specFiles(changeDir)].filter((relative) => existsSync(join(changeDir, relative)));
  const hash = createHash(C.HASH_ALGORITHM);
  for (const relative of [...relatives].sort()) {
    hash.update(relative).update("\n").update(normalize(readFileSync(join(changeDir, relative), "utf8"))).update("\n");
  }
  return hash.digest(C.HASH_ENCODING);
}

/**
 * Reads the leading front-matter block; returns undefined when it is absent or invalid.
 */
export function parseMarker(markdown: string): SpecMarker | undefined {
  const lines = markdown.replace(C.CRLF, "\n").split("\n");
  if (lines[0] !== C.FRONT_MATTER_FENCE) return undefined;
  const end = lines.indexOf(C.FRONT_MATTER_FENCE, 1);
  if (end === -1) return undefined;
  const values = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(":");
    if (separator !== -1) values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const stage = values.get(C.KEY_STAGE);
  const status = values.get(C.KEY_STATUS);
  const hash = values.get(C.KEY_HASH);
  const isStage = (C.STAGES as readonly string[]).includes(stage ?? "");
  const isStatus = (C.STATUSES as readonly string[]).includes(status ?? "");
  if (!isStage || !isStatus || !hash) return undefined;
  return { stage: stage as SpecStage, status: status as SpecStatus, hash };
}

/**
 * Renders the front-matter block written by `spec-gate stamp`.
 */
export function renderMarker(marker: SpecMarker): string {
  const fence = C.FRONT_MATTER_FENCE;
  return `${fence}\n${C.KEY_STAGE}: ${marker.stage}\n${C.KEY_STATUS}: ${marker.status}\n${C.KEY_HASH}: ${marker.hash}\n${fence}\n`;
}

/**
 * Decides whether a stage's report exists, is resolved and still matches the change artifacts.
 */
export function evaluateStage(changeDir: string, stage: SpecStage): StageEvaluation {
  const reportPath = join(changeDir, C.FILE_BY_STAGE[stage]);
  if (!existsSync(reportPath)) return { ok: false, reason: "missing" };
  const marker = parseMarker(readFileSync(reportPath, "utf8"));
  if (marker === undefined || marker.stage !== stage) return { ok: false, reason: "malformed" };
  if (marker.status !== "resolved") return { ok: false, reason: "open" };
  if (marker.hash !== computeChangeHash(changeDir)) return { ok: false, reason: "stale" };
  return { ok: true };
}
