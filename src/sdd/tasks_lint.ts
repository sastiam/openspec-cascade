/**
 * Static checks on an OpenSpec `tasks.md`: fenced code blocks, unchecked tasks without a `Verify:` line, and
 * unchecked tasks that ask for a human action (`manual-step`, ignoring text in backticks).
 * Also checks `manual.md`: every step needs an indented `Check:` line and no step may carry a checkbox,
 * and lists its steps as `{step, check}` pairs.
 *
 * Pure: it takes the markdown text and returns findings; reading files and deciding which changes to lint is the caller's job.
 */
import { FORMAT_CONSTANTS, TASKS_LINT_CONSTANTS as C } from "../config/constants";

export interface TaskFinding {
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

export interface ManualStep {
  readonly step: string;
  readonly check: string;
}

interface Fence {
  readonly char: string;
  readonly length: number;
}

interface PendingTask {
  readonly line: number;
  verified: boolean;
  readonly lines: string[];
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
    if (task === undefined) return;
    if (!task.verified) {
      findings.push({ line: task.line, rule: C.RULE_MISSING_VERIFY, message: C.MESSAGE_MISSING_VERIFY });
    }
    const raw = task.lines.join(" ");
    if (!FORMAT_CONSTANTS.HUMAN_TASK_REGEX.test(raw)) {
      const visible = raw.replace(C.CODE_SPAN, " ");
      if (C.MANUAL_STEP_PATTERNS.some((pattern) => pattern.test(visible))) {
        findings.push({ line: task.line, rule: C.RULE_MANUAL_STEP, message: C.MESSAGE_MANUAL_STEP });
      }
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
      task = { line, verified: false, lines: [text.trim()] };
    } else if (task !== undefined) {
      if (C.BLANK_LINE.test(text) || !C.INDENTED_LINE.test(text)) flushTask();
      else {
        if (opened === undefined) task.lines.push(text.trim());
        if (C.VERIFY_LINE.test(text)) task.verified = true;
      }
    }
  }
  flushTask();
  return findings.sort((a, b) => a.line - b.line);
}

interface PendingStep {
  readonly line: number;
  readonly text: string;
  check: string | undefined;
}

function scanManual(markdown: string): PendingStep[] {
  const steps: PendingStep[] = [];
  let fence: Fence | undefined;
  let step: PendingStep | undefined;
  for (const [index, text] of normalizeLines(markdown).entries()) {
    if (fence !== undefined) {
      if (closesFence(text, fence)) fence = undefined;
      continue;
    }
    const opened = openingFence(text);
    if (opened !== undefined) {
      fence = opened;
      if (step !== undefined && !C.INDENTED_LINE.test(text)) step = undefined;
      continue;
    }
    if (C.MANUAL_STEP_ITEM.test(text)) {
      step = { line: index + C.LINE_NUMBER_BASE, text, check: undefined };
      steps.push(step);
    } else if (step !== undefined) {
      if (C.BLANK_LINE.test(text) || !C.INDENTED_LINE.test(text)) step = undefined;
      else if (step.check === undefined && C.CHECK_LINE.test(text)) step.check = text;
    }
  }
  return steps;
}

/**
 * Returns the findings of a `manual.md`, sorted by 1-based line: steps with a checkbox and steps without a `Check:` line.
 */
export function lintManual(markdown: string): TaskFinding[] {
  const findings: TaskFinding[] = [];
  for (const step of scanManual(markdown)) {
    if (C.MANUAL_CHECKBOX.test(step.text)) {
      findings.push({ line: step.line, rule: C.RULE_MANUAL_CHECKBOX, message: C.MESSAGE_MANUAL_CHECKBOX });
    }
    if (step.check === undefined) {
      findings.push({ line: step.line, rule: C.RULE_MISSING_CHECK, message: C.MESSAGE_MISSING_CHECK });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Returns the steps of a `manual.md` in file order: the text after the list marker and any checkbox, and the text after `Check:` (empty when the step has none).
 */
export function parseManualSteps(markdown: string): ManualStep[] {
  return scanManual(markdown).map((step) => ({
    step: step.text.replace(C.MANUAL_STEP_ITEM, "").replace(C.CHECKBOX_PREFIX, "").trim(),
    check: (step.check ?? "").replace(C.CHECK_PREFIX, "").trim(),
  }));
}

/**
 * Renders a finding as `<change>: <file>:<line>: <rule> <message>`, the line the CLI and the preflight both print.
 */
export function formatFinding(change: string, finding: TaskFinding, fileName: string = C.FILE_NAME): string {
  return `${change}: ${fileName}:${finding.line}: ${finding.rule} ${finding.message}`;
}
