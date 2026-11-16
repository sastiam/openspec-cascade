/**
 * `spec-gate` subcommand: checks and stamps the EGM review/drift reports of OpenSpec changes.
 *
 * Exit codes: 0 every change passes, 1 at least one change is missing/open/stale/malformed, 2 invalid input.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT_CODE_CONSTANTS, HARDENING_CONSTANTS, SPEC_GATE_CONSTANTS as C } from "../config/constants";
import { computeChangeHash, evaluateStage, renderMarker, stripMarker, type SpecStage, type SpecStatus } from "../sdd/spec_marker";

/**
 * Output sink of the subcommand; structurally identical to `CliOutput` in `commands.ts`, declared here to avoid an import cycle.
 */
export interface SpecGateOutput {
  info(message: string): void;
  error(message: string): void;
}

class SpecGateUsageError extends Error {}

const consoleOutput: SpecGateOutput = { info: (message) => console.log(message), error: (message) => console.error(message) };

const OPTIONS = {
  repo: { type: "string" },
  stage: { type: "string" },
  changes: { type: "string" },
  change: { type: "string" },
  status: { type: "string" },
} as const;

function parseOptions(argv: readonly string[]): Record<keyof typeof OPTIONS, string | undefined> {
  try {
    const { values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false });
    return values as Record<keyof typeof OPTIONS, string | undefined>;
  } catch (error) {
    throw new SpecGateUsageError(error instanceof Error ? error.message : String(error));
  }
}

function parseStage(value: string | undefined): SpecStage {
  if (!(C.STAGES as readonly string[]).includes(value ?? "")) {
    throw new SpecGateUsageError(`--stage must be one of ${C.STAGES.join(", ")}`);
  }
  return value as SpecStage;
}

function parseStatus(value: string | undefined): SpecStatus {
  if (!(C.STATUSES as readonly string[]).includes(value ?? "")) {
    throw new SpecGateUsageError(`--status must be one of ${C.STATUSES.join(", ")}`);
  }
  return value as SpecStatus;
}

function validChangeName(name: string): string {
  if (!HARDENING_CONSTANTS.CHANGE_ID_PATTERN.test(name)) throw new SpecGateUsageError(`invalid change name: ${name}`);
  return name;
}

function changeDirOf(repo: string, change: string): string {
  return join(repo, C.OPENSPEC_DIR, C.CHANGES_DIR, change);
}

function runCheck(options: ReturnType<typeof parseOptions>, output: SpecGateOutput): number {
  const stage = parseStage(options.stage);
  const names = (options.changes ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "").map(validChangeName);
  if (names.length === 0) throw new SpecGateUsageError("--changes is required");
  const repo = resolve(options.repo ?? process.cwd());
  const failures = names.flatMap((change) => {
    const result = evaluateStage(changeDirOf(repo, change), stage);
    return result.ok ? [] : [`${change}: ${stage} ${result.reason} (${C.FILE_BY_STAGE[stage]})`];
  });
  for (const failure of failures) output.error(failure);
  if (failures.length > 0) return EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
  output.info(`spec-gate ${stage}: ok (${names.join(", ")})`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function runStamp(options: ReturnType<typeof parseOptions>, output: SpecGateOutput): number {
  const stage = parseStage(options.stage);
  const status = parseStatus(options.status);
  if (options.change === undefined) throw new SpecGateUsageError("--change is required");
  const change = validChangeName(options.change);
  const repo = resolve(options.repo ?? process.cwd());
  const changeDir = changeDirOf(repo, change);
  const reportPath = join(changeDir, C.FILE_BY_STAGE[stage]);
  if (!existsSync(reportPath)) throw new SpecGateUsageError(`${C.FILE_BY_STAGE[stage]} does not exist for ${change}; run the ${stage} first`);
  const marker = renderMarker({ stage, status, hash: computeChangeHash(changeDir) });
  writeFileSync(reportPath, `${marker}${stripMarker(readFileSync(reportPath, "utf8"))}`);
  output.info(`spec-gate ${stage}: stamped ${change} as ${status}`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

/**
 * Runs `spec-gate check|stamp`. Returns the exit code; never throws.
 */
export function runSpecGate(argv: readonly string[], output: SpecGateOutput = consoleOutput): number {
  try {
    const [action, ...rest] = argv;
    const options = parseOptions(rest);
    if (action === C.ACTION_CHECK) return runCheck(options, output);
    if (action === C.ACTION_STAMP) return runStamp(options, output);
    throw new SpecGateUsageError(`first argument must be ${C.ACTION_CHECK} or ${C.ACTION_STAMP}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`USAGE: cascade spec-gate: ${message}`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
  }
}
