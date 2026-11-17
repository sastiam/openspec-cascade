/**
 * `lint-tasks` subcommand: lints the `tasks.md` of OpenSpec changes (code blocks, unchecked tasks without `Verify:`, manual steps)
 * and, when it exists, their `manual.md` (steps without `Check:`, checkboxes). `manual.md` findings follow the `tasks.md` findings of the same change.
 *
 * Exit codes: 0 every change is clean, 1 at least one finding, 2 invalid input (including a missing tasks.md).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT_CODE_CONSTANTS, TASKS_LINT_CONSTANTS as C } from "../config/constants";
import { formatFinding, lintManual, lintTasks } from "../sdd/tasks_lint";
import { changeDirOf, CliUsageError, consoleOutput, parseChangeNames, type CliOutput } from "./change_args";

const OPTIONS = {
  repo: { type: "string" },
  changes: { type: "string", multiple: true },
} as const;

interface LintTasksOptions {
  readonly repo?: string;
  readonly changes?: string[];
}

function parseOptions(argv: readonly string[]): LintTasksOptions {
  try {
    const { values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false });
    return values as LintTasksOptions;
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
}

function lintChange(repo: string, change: string): string[] {
  const tasksPath = join(changeDirOf(repo, change), C.FILE_NAME);
  if (!existsSync(tasksPath)) throw new CliUsageError(`${change}: ${C.FILE_NAME} not found`);
  const tasksFindings = lintTasks(readFileSync(tasksPath, "utf8")).map((finding) => formatFinding(change, finding));
  const manualPath = join(changeDirOf(repo, change), C.MANUAL_FILE_NAME);
  if (!existsSync(manualPath)) return tasksFindings;
  const manualFindings = lintManual(readFileSync(manualPath, "utf8")).map((finding) =>
    formatFinding(change, finding, C.MANUAL_FILE_NAME),
  );
  return [...tasksFindings, ...manualFindings];
}

/**
 * Runs `lint-tasks --changes <a,b> [--repo <path>]`. Returns the exit code; never throws.
 */
export function runLintTasks(argv: readonly string[], output: CliOutput = consoleOutput): number {
  try {
    const options = parseOptions(argv);
    const names = parseChangeNames(options.changes);
    const repo = resolve(options.repo ?? process.cwd());
    const findings = names.flatMap((change) => lintChange(repo, change));
    for (const finding of findings) output.error(finding);
    if (findings.length > 0) return EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
    output.info(`${C.OK_PREFIX} (${names.join(",")})`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`${C.USAGE_PREFIX}: ${message}`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
  }
}
