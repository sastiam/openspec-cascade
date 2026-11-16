/**
 * Docs-only verification fast-track for openspec-cascade v1.
 *
 * Detects which files a task touched and lets `runTask` skip heavy checks (typecheck, test, build)
 * when every touched file is documentation. Any doubt means "run everything".
 */
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
