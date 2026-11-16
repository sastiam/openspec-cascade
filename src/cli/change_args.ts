/**
 * Argument helpers shared by the subcommands that take OpenSpec change names (`spec-gate`, `lint-tasks`).
 */
import { join } from "node:path";
import { HARDENING_CONSTANTS, SPEC_GATE_CONSTANTS as C } from "../config/constants";

/**
 * Output sink of a subcommand.
 */
export interface CliOutput {
  info(message: string): void;
  error(message: string): void;
}

/**
 * Invalid input from the user; subcommands turn it into the usage exit code.
 */
export class CliUsageError extends Error {}

export const consoleOutput: CliOutput = { info: (message) => console.log(message), error: (message) => console.error(message) };

const CHANGE_NAME_SEPARATOR = ",";

export function validChangeName(name: string): string {
  if (!HARDENING_CONSTANTS.CHANGE_ID_PATTERN.test(name)) throw new CliUsageError(`invalid change name: ${name}`);
  return name;
}

export function changeDirOf(repo: string, change: string): string {
  return join(repo, C.OPENSPEC_DIR, C.CHANGES_DIR, change);
}

/**
 * Parses repeated and comma separated `--changes` values into validated names, without duplicates.
 */
export function parseChangeNames(values: readonly string[] | undefined): string[] {
  const names = (values ?? [])
    .flatMap((value) => value.split(CHANGE_NAME_SEPARATOR))
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .map(validChangeName);
  if (names.length === 0) throw new CliUsageError("--changes is required");
  return [...new Set(names)];
}
