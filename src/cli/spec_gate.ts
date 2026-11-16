/**
 * `spec-gate` subcommand: checks and stamps the EGM review/drift reports of OpenSpec changes.
 *
 * Exit codes: 0 every change passes, 1 at least one change is missing/open/stale/malformed, 2 invalid input.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT_CODE_CONSTANTS, SPEC_GATE_CONSTANTS as C } from "../config/constants";
import { computeChangeHash, evaluateStage, renderMarker, stripMarker, type SpecStage, type SpecStatus } from "../sdd/spec_marker";
import { changeDirOf, CliUsageError, consoleOutput, parseChangeNames, validChangeName, type CliOutput } from "./change_args";

/**
 * Output sink of the subcommand.
 */
export type SpecGateOutput = CliOutput;

const OPTIONS = {
  repo: { type: "string" },
  stage: { type: "string" },
  changes: { type: "string", multiple: true },
  change: { type: "string" },
  status: { type: "string" },
} as const;

interface SpecGateOptions {
  readonly repo?: string;
  readonly stage?: string;
  readonly changes?: string[];
  readonly change?: string;
  readonly status?: string;
}

function parseOptions(argv: readonly string[]): SpecGateOptions {
  try {
    const { values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false });
    return values as SpecGateOptions;
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
}

function parseStage(value: string | undefined): SpecStage {
  if (!(C.STAGES as readonly string[]).includes(value ?? "")) {
    throw new CliUsageError(`--stage must be one of ${C.STAGES.join(", ")}`);
  }
  return value as SpecStage;
}

function parseStatus(value: string | undefined): SpecStatus {
  if (!(C.STATUSES as readonly string[]).includes(value ?? "")) {
    throw new CliUsageError(`--status must be one of ${C.STATUSES.join(", ")}`);
  }
  return value as SpecStatus;
}

type FolderFailure = { readonly reason: string; readonly path: string };

function folderFailureOf(repo: string, change: string): FolderFailure | undefined {
  let folderExists = false;
  try {
    folderExists = statSync(changeDirOf(repo, change)).isDirectory();
  } catch {
    folderExists = false;
  }
  if (folderExists) return undefined;
  const archiveRoot = join(C.OPENSPEC_DIR, C.CHANGES_DIR, C.ARCHIVE_DIR);
  let entries: string[] = [];
  try {
    entries = readdirSync(join(repo, archiveRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    entries = [];
  }
  const archived = entries
    .filter((name) => {
      const prefix = C.ARCHIVE_DATE_PREFIX.exec(name);
      return prefix !== null && name.slice(prefix[0].length) === change;
    })
    .sort()
    .at(-1);
  if (archived !== undefined) return { reason: C.REASON_ARCHIVED, path: join(archiveRoot, archived) };
  return { reason: C.REASON_NO_CHANGE_FOLDER, path: join(C.OPENSPEC_DIR, C.CHANGES_DIR, change) };
}

function runCheck(options: SpecGateOptions, output: SpecGateOutput): number {
  const stage = parseStage(options.stage);
  const names = parseChangeNames(options.changes);
  const repo = resolve(options.repo ?? process.cwd());
  const failures = names.flatMap((change) => {
    const folderFailure = folderFailureOf(repo, change);
    if (folderFailure !== undefined) return [`${change}: ${stage} ${folderFailure.reason} (${folderFailure.path})`];
    const result = evaluateStage(changeDirOf(repo, change), stage);
    return result.ok ? [] : [`${change}: ${stage} ${result.reason} (${C.FILE_BY_STAGE[stage]})`];
  });
  for (const failure of failures) output.error(failure);
  if (failures.length > 0) return EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
  output.info(`spec-gate ${stage}: ok (${names.join(", ")})`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function runStamp(options: SpecGateOptions, output: SpecGateOutput): number {
  const stage = parseStage(options.stage);
  const status = parseStatus(options.status);
  if (options.change === undefined) throw new CliUsageError("--change is required");
  const change = validChangeName(options.change);
  const repo = resolve(options.repo ?? process.cwd());
  const changeDir = changeDirOf(repo, change);
  const reportPath = join(changeDir, C.FILE_BY_STAGE[stage]);
  if (!existsSync(reportPath)) throw new CliUsageError(`${C.FILE_BY_STAGE[stage]} does not exist for ${change}; run the ${stage} first`);
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
    throw new CliUsageError(`first argument must be ${C.ACTION_CHECK} or ${C.ACTION_STAMP}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`USAGE: cascade spec-gate: ${message}`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
  }
}
