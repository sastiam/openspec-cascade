/**
 * OpenSpec task parsing, verification-command derivation and prompt construction.
 *
 * Pure helpers shared by `CascadeFacade` and re-exported by the `cascade.ts` CLI adapter.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CONSTANTS, FULL_VERIFY, RUNTIME_CONSTANTS, VERIFY_CONSTANTS, type CascadeConfig } from "../../config";
import { HARDENING_CONSTANTS, TASKS_LINT_CONSTANTS } from "../config/constants";
import { normalizeLines } from "../sdd/tasks_lint";
import { isNuxtProject, resolvePackageCommands, tryDetectPackageManager } from "../../platform";
import { runVerificationPhase } from "../../qa";
import { discoverDirectives, discoverSkills, formatDirectivesPrompt, formatSkillsPrompt } from "../../skills";

export type Task = {
  id: string;
  done: boolean;
  text: string;
  section: string;
  line: number;
  verifyStart?: number | null;
};

function inlineVerifyStart(text: string): number | null {
  const visible = text.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
  const index = visible.search(/\bVerify:/);
  return index === -1 ? null : index;
}

const BACKTICK_SPAN = /`([^`]+)`/g;
const PM_COMMAND_PATTERN = /^(?:(?:bunx?|npm|pnpm|yarn)\s+|tsc\s+--noEmit$)/;

export interface VerifyCommandsOptions {
  repoRoot?: string;
  config?: CascadeConfig;
}

/**
 * Parses OpenSpec tasks.md markdown into structured task entries with section metadata.
 */
export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = [];
  let section = "";
  let current: Task | undefined;
  let hasContinuationMarker = false;
  for (const [index, line] of normalizeLines(markdown).entries()) {
    const heading = line.match(/^#{2,}\s+(.*)$/);
    if (heading) {
      section = heading[1]!.trim();
      current = undefined;
      continue;
    }
    const item = line.match(/^- \[([ xX])\] (?:\*\*)?([A-Z]*\d+(?:\.\d+)*)(?:\*\*)?:?\s+(.*)$/);
    if (item) {
      const text = item[3]!;
      current = { id: item[2]!, done: item[1] !== " ", text, section, line: index, verifyStart: inlineVerifyStart(text) };
      hasContinuationMarker = false;
      tasks.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      const start = current.text.length + 1;
      current.text += ` ${line.trim()}`;
      if (!hasContinuationMarker && TASKS_LINT_CONSTANTS.VERIFY_LINE.test(line)) {
        current.verifyStart = start;
        hasContinuationMarker = true;
      }
    } else {
      current = undefined;
    }
  }
  return tasks;
}

/**
 * Returns the Verify segment of a task: the text from its Verify marker to the end, or undefined without a marker.
 */
export function verifySegment(task: Task): string | undefined {
  const start = task.verifyStart === undefined ? inlineVerifyStart(task.text) : task.verifyStart;
  return start === null ? undefined : task.text.slice(start);
}

/**
 * Returns the backticked package-manager commands written before the Verify marker, as written.
 */
export function ignoredCommands(task: Task): string[] {
  const start = task.verifyStart === undefined ? inlineVerifyStart(task.text) : task.verifyStart;
  if (start === null) return [];
  const ignored = new Set<string>();
  for (const [, span] of task.text.slice(0, start).matchAll(BACKTICK_SPAN)) {
    const command = span!.trim();
    if (PM_COMMAND_PATTERN.test(command)) ignored.add(command);
  }
  return [...ignored];
}

/**
 * Reads and parses a tasks.md file.
 */
export function readTasks(tasksPath: string): Task[] {
  return parseTasks(readFileSync(tasksPath, "utf8"));
}

/**
 * Marks a task as done in tasks.md, preserving every other line.
 */
export function markDone(tasksPath: string, id: string): void {
  const task = readTasks(tasksPath).find((t) => t.id === id);
  if (!task || task.done) return;
  const lines = readFileSync(tasksPath, "utf8").split("\n");
  lines[task.line] = lines[task.line]!.replace("- [ ]", "- [x]");
  writeFileSync(tasksPath, lines.join("\n"));
}

/**
 * Task-provided verify commands must be single commands: no chaining, piping, redirection or substitution.
 */
export function isSafeVerifyCommand(command: string): boolean {
  return !HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN.test(command);
}

/**
 * Extracts verification commands for a task, adapting to the repository's detected package manager
 * and only expanding Nuxt .nuxt/ tsconfig programs when Nuxt is present or unconfigured.
 */
export function verifyCommands(
  task: Task,
  fullGate = false,
  options?: VerifyCommandsOptions,
): string[] {
  const isFull = /\bfull verification\b/i.test(task.text);
  const gated = fullGate && commitTypeOf(task) !== undefined;
  const segment = verifySegment(task);
  if (segment === undefined && !isFull && !gated) return [];
  const source = segment ?? task.text;

  const pm = options?.repoRoot ? tryDetectPackageManager(options.repoRoot) : null;
  const cmds = pm ? resolvePackageCommands(pm) : undefined;
  const useNuxt = options?.repoRoot ? isNuxtProject(options.repoRoot) : true;
  const fallbackDefaultVerify = options?.config?.defaultVerify ?? (cmds ? [cmds.test, cmds.lint] : CONSTANTS.DEFAULT_VERIFY);
  const fallbackFullVerify =
    options?.config?.fullVerify ??
    (cmds && !useNuxt ? [cmds.typecheck, cmds.lint, cmds.test, cmds.build] : FULL_VERIFY);

  const commands = new Set<string>();

  for (const [, span] of source.matchAll(BACKTICK_SPAN)) {
    const command = span!.trim();
    if (!PM_COMMAND_PATTERN.test(command)) continue;
    if (!isSafeVerifyCommand(command)) continue;
    if (/^bun audit\b/.test(command)) continue;
    if (/^(?:bunx\s+)?tsc --noEmit$/.test(command)) {
      if (useNuxt) {
        commands.add(CONSTANTS.TSC_SERVER);
        commands.add(CONSTANTS.TSC_APP);
      } else {
        commands.add(cmds ? cmds.typecheck : command);
      }
      continue;
    }
    commands.add(command === "bun run db:generate" ? CONSTANTS.NO_NEW_MIGRATION : command);
  }

  if (gated) fallbackFullVerify.forEach((c) => commands.add(c));
  if (isFull && !commands.size) fallbackFullVerify.forEach((c) => commands.add(c));

  const prose = source.replace(/`[^`]*`/g, " ");
  if (/\blint\b/i.test(prose)) commands.add(cmds ? cmds.lint : "bun run lint");
  if (/\bbuild\b/i.test(prose)) commands.add(cmds ? cmds.build : "bun run build");
  if (/\bboth\s+`?(?:bunx\s+)?tsc\b/i.test(source)) {
    if (useNuxt) {
      commands.add(CONSTANTS.TSC_SERVER);
      commands.add(CONSTANTS.TSC_APP);
    } else if (cmds) {
      commands.add(cmds.typecheck);
    }
  }
  if (/\bE2E\b/.test(prose)) commands.add(cmds ? cmds.run("test:e2e") : "bun run test:e2e");

  const list = commands.size ? [...commands] : [...fallbackDefaultVerify];
  return useNuxt && list.some((c) => c.includes("tsc")) ? [VERIFY_CONSTANTS.NUXT_PREPARE_CMD, ...list] : list;
}

/**
 * Returns the task's own checks followed by the project-wide `alwaysVerify` commands, de-duplicated, as written.
 */
export function taskChecks(task: Task, config: CascadeConfig): string[] {
  const own = verifyCommands(task, config.fullGate, { repoRoot: config.repo, config });
  return [...new Set([...own, ...config.alwaysVerify])];
}

/**
 * Extracts a genuine BLOCKED reason while ignoring empty sentinel responses like "none".
 */
export function blockedReason(result: string): string | undefined {
  const reason = result.match(/^\**BLOCKED:?\**:?\s*(.+)$/m)?.[1]?.replace(/^[*`\s]+|[*`.\s]+$/g, "");
  if (!reason || /^(none|n\/?a|no|nothing|null|false|-+|not blocked)$/i.test(reason)) return undefined;
  return reason;
}

/**
 * Extracts the conventional commit type declared in a task line, if any.
 */
export function commitTypeOf(task: Task): string | undefined {
  for (const match of task.text.matchAll(/\bCommit `([^`]+)`|`([^`]+)` commit\b/gi)) {
    const type = (match[1] ?? match[2])!.trim();
    if (CONSTANTS.CONVENTIONAL_TYPE_REGEX.test(type)) return type;
  }
  return undefined;
}

/**
 * Returns true when no task declares an explicit commit type, enabling section-end commits.
 */
export function commitsPerSection(tasks: Task[]): boolean {
  return !tasks.some((t) => commitTypeOf(t));
}

/**
 * Returns true if the given task is the final task within its markdown section.
 */
export function isLastOfSection(tasks: Task[], task: Task): boolean {
  return tasks.filter((t) => t.section === task.section).at(-1)?.id === task.id;
}

/**
 * Builds the execution prompt for an isolated task session, injecting skills and project directives.
 */
export function taskPrompt(
  change: string,
  task: Task,
  verify: string[],
  sectionCommit: boolean,
  repoRoot: string = process.cwd(),
): string {
  const parts = [
    `You are executing the OpenSpec change "${change}" in this repository, one task per session.`,
    `Read openspec/changes/${change}/proposal.md, design.md, tasks.md and specs/ before editing anything.`,
    "",
    `Implement ONLY task ${task.id} (section "${task.section}"):`,
    task.text,
    "",
    "Rules:",
    "- Do not work on any other task, and do not change other checkboxes.",
    "- Do not commit, push, switch branches, stash or reset; the harness owns git.",
    "- Never run `bun run db:push` or apply migrations.",
    verify.length
      ? `- This is a verification task. The harness will run: ${verify.map((c) => `\`${c}\``).join(", ")}. Run them yourself and fix whatever fails before finishing.`
      : "- Run the focused checks that prove this task works before finishing.",
    `- When the task is done, change its checkbox in openspec/changes/${change}/tasks.md from "- [ ]" to "- [x]".`,
    '- ONLY if the task cannot be completed without a human decision, leave it unchecked and end with a line "BLOCKED: <reason>". Otherwise never write a BLOCKED line, not even "BLOCKED: none".',
    sectionCommit
      ? `- This task closes section "${task.section}". End your final reply with a line "COMMIT_MESSAGE: <type>(<scope>): <summary of ALL changes in this section>" using Conventional Commits.`
      : `- End your final reply with a line "COMMIT_SUBJECT: <imperative summary of ALL changes in section "${task.section}", max ${RUNTIME_CONSTANTS.COMMIT_SUBJECT_MAX_LENGTH} chars>".`,
  ];

  const skills = discoverSkills(repoRoot);
  const skillsCatalog = formatSkillsPrompt(skills);
  if (skillsCatalog) {
    parts.push("", skillsCatalog);
  }

  const directives = discoverDirectives(repoRoot);
  const directivesPrompt = formatDirectivesPrompt(directives);
  if (directivesPrompt) {
    parts.push("", directivesPrompt);
  }

  return parts.join("\n");
}

/**
 * Runs verification commands in the specified repository directory and returns formatted failures.
 */
export async function runChecks(
  commands: string[],
  cwd: string = process.cwd(),
  timeoutMs: number = CONSTANTS.COMMAND_TIMEOUT_MS,
): Promise<string[]> {
  const result = await runVerificationPhase({
    commands,
    cwd,
    timeoutMs,
  });
  return result.failures.map(
    (f) => `$ ${f.command} (exit ${f.exitCode})\n${f.output.slice(-CONSTANTS.CHECK_FAILURE_OUTPUT_MAX_LENGTH)}`,
  );
}
