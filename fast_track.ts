/**
 * Docs-only verification fast-track for openspec-cascade v1.
 *
 * Detects which files a task touched and lets `runTask` skip heavy checks (typecheck, test, build)
 * when every touched file is documentation. Any doubt means "run everything".
 */
import { posix } from "node:path";
import { CONSTANTS } from "./config";
import { defaultCommandRunner, type CommandRunner } from "./qa";

const NUL = "\0";

/** Tracked changes (staged + unstaged) against HEAD. `--no-renames` makes a rename count both paths. */
const GIT_DIFF_COMMAND = "git diff --name-only -z --no-renames HEAD";
/** Untracked files, already expanded to files and honouring .gitignore. */
const GIT_UNTRACKED_COMMAND = "git ls-files --others --exclude-standard -z";

/**
 * Splits NUL separated git output into paths. No per-line trimming: paths may contain spaces.
 */
export function parseNulList(output: string): string[] {
  return output.split(NUL).filter((entry) => entry.length > 0);
}

/**
 * Lists files changed in the working tree since HEAD plus untracked files.
 * Returns `undefined` when git cannot answer, so callers fall back to running every check.
 */
export async function detectAffectedFiles(
  cwd: string,
  runner: CommandRunner = defaultCommandRunner,
): Promise<string[] | undefined> {
  try {
    const diff = await runner(GIT_DIFF_COMMAND, cwd, CONSTANTS.COMMAND_TIMEOUT_MS);
    if (diff.code !== CONSTANTS.EXIT_CODE_SUCCESS) return undefined;
    const untracked = await runner(GIT_UNTRACKED_COMMAND, cwd, CONSTANTS.COMMAND_TIMEOUT_MS);
    if (untracked.code !== CONSTANTS.EXIT_CODE_SUCCESS) return undefined;
    return [...parseNulList(diff.stdout), ...parseNulList(untracked.stdout)];
  } catch {
    return undefined;
  }
}

export type CheckKind = "typecheck" | "test" | "build" | "lint" | "other";

const DOC_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".mdx", ".txt", ".rst"]);
/** Extension-less documentation files, matched by lower-cased name prefix. */
const DOC_NAME_PREFIXES: readonly string[] = ["readme", "license", "changelog"];

/** Keyword tokens per check kind, in priority order. Matching is by whole token, never by substring. */
const CHECK_TOKENS: ReadonlyArray<readonly [Exclude<CheckKind, "other">, ReadonlySet<string>]> = [
  ["typecheck", new Set(["tsc", "typecheck"])],
  ["test", new Set(["test", "tests", "jest", "vitest", "mocha", "playwright", "cypress"])],
  ["lint", new Set(["lint", "eslint", "biome"])],
  ["build", new Set(["build"])],
];

/** Kinds that a docs-only change cannot affect; lint and unknown commands still run. */
const SKIPPABLE_KINDS: ReadonlySet<CheckKind> = new Set(["typecheck", "test", "build"]);

const TOKEN_SEPARATOR = /[^a-z0-9]+/;

function isDocFile(path: string): boolean {
  const base = posix.basename(path).toLowerCase();
  const ext = posix.extname(base);
  if (DOC_EXTENSIONS.has(ext)) return true;
  return ext === "" && DOC_NAME_PREFIXES.some((prefix) => base.startsWith(prefix));
}

/**
 * True only when there is at least one file and every one of them is documentation.
 */
export function isDocsOnly(files: readonly string[] | undefined): boolean {
  if (!files || files.length === 0) return false;
  return files.every(isDocFile);
}

/**
 * Classifies a verification command by whole-word tokens (`latest` is not `test`).
 */
export function classifyCheck(command: string): CheckKind {
  const tokens = new Set(command.toLowerCase().split(TOKEN_SEPARATOR).filter(Boolean));
  for (const [kind, keywords] of CHECK_TOKENS) {
    for (const token of tokens) {
      if (keywords.has(token)) return kind;
    }
  }
  return "other";
}

/**
 * Splits commands into those to run and those safe to skip. Skips only for docs-only changes
 * and never when `forceFull` is set.
 */
export function selectChecks(
  commands: readonly string[],
  files: readonly string[] | undefined,
  opts: { forceFull: boolean },
): { run: string[]; skipped: string[] } {
  if (opts.forceFull || !isDocsOnly(files)) return { run: [...commands], skipped: [] };
  const run: string[] = [];
  const skipped: string[] = [];
  for (const command of commands) {
    (SKIPPABLE_KINDS.has(classifyCheck(command)) ? skipped : run).push(command);
  }
  return { run, skipped };
}

export interface SelectVerifyChecksOptions {
  cwd: string;
  /** True for "full verification" tasks and `fullGate`: never skip anything. */
  forceFull: boolean;
  runner?: CommandRunner;
  say?: (message: string) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Entry point for `runTask`: returns the verification commands that must actually run.
 * Reports through `say`/`log` only when something was skipped.
 */
export async function selectVerifyChecks(
  commands: readonly string[],
  opts: SelectVerifyChecksOptions,
): Promise<string[]> {
  if (opts.forceFull || commands.length === 0) return [...commands];
  const files = await detectAffectedFiles(opts.cwd, opts.runner);
  const { run, skipped } = selectChecks(commands, files, { forceFull: opts.forceFull });
  if (skipped.length > 0) {
    opts.say?.(`  fast-track: docs-only change, skipping ${skipped.join(", ")}`);
    opts.log?.("fast_track", { skipped, files });
  }
  return run;
}
