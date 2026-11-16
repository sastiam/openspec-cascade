/**
 * Static checks on an OpenSpec `tasks.md`: fenced code blocks, and unchecked tasks without a `Verify:` line.
 *
 * Pure: it takes the markdown text and returns findings; reading files and deciding which changes to lint is the caller's job.
 */
import { TASKS_LINT_CONSTANTS as C } from "../config/constants";

export interface TaskFinding {
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

interface Fence {
  readonly char: string;
  readonly length: number;
}

interface PendingTask {
  readonly line: number;
  verified: boolean;
}

/**
 * Strips a leading BOM and splits on LF, CRLF and CR, so the lint and the task parser see the same lines.
 */
export function normalizeLines(markdown: string): string[] {
  return markdown.replace(C.BOM, "").split(C.LINE_BREAK);
}

function openingFence(text: string): Fence | undefined {
  const match = C.FENCE_OPENER.exec(text);
  if (match === null) return undefined;
  const run = match[1] ?? "";
  const info = match[2] ?? "";
  const char = run.charAt(0);
  if (char === C.BACKTICK && info.includes(C.BACKTICK)) return undefined;
  return { char, length: run.length };
}

function closesFence(text: string, fence: Fence): boolean {
  const run = C.FENCE_CLOSER.exec(text)?.[1];
  return run !== undefined && run.charAt(0) === fence.char && run.length >= fence.length;
}

/**
 * Returns the findings of a `tasks.md`, sorted by 1-based line.
 */
export function lintTasks(markdown: string): TaskFinding[] {
  const findings: TaskFinding[] = [];
  let fence: Fence | undefined;
  let task: PendingTask | undefined;

  const flushTask = (): void => {
    if (task !== undefined && !task.verified) {
      findings.push({ line: task.line, rule: C.RULE_MISSING_VERIFY, message: C.MESSAGE_MISSING_VERIFY });
    }
    task = undefined;
  };

  for (const [index, text] of normalizeLines(markdown).entries()) {
    const line = index + C.LINE_NUMBER_BASE;
    if (fence !== undefined) {
      if (closesFence(text, fence)) fence = undefined;
      continue;
    }
    const opened = openingFence(text);
    if (opened !== undefined) {
      findings.push({ line, rule: C.RULE_NO_CODE_BLOCK, message: C.MESSAGE_NO_CODE_BLOCK });
      fence = opened;
    }
    if (C.UNCHECKED_TASK.test(text)) {
      flushTask();
      task = { line, verified: false };
    } else if (task !== undefined) {
      if (C.BLANK_LINE.test(text) || !C.INDENTED_LINE.test(text)) flushTask();
      else if (C.VERIFY_LINE.test(text)) task.verified = true;
    }
  }
  flushTask();
  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Renders a finding as `<change>: tasks.md:<line>: <rule> <message>`, the line the CLI and the preflight both print.
 */
export function formatFinding(change: string, finding: TaskFinding): string {
  return `${change}: ${C.FILE_NAME}:${finding.line}: ${finding.rule} ${finding.message}`;
}
