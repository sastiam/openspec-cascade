#!/usr/bin/env bun
/**
 * OpenSpec cascade runner.
 *
 * Runs OpenSpec changes in order, one agent session per unchecked task, verifying
 * completion deterministically before committing. Defers configuration loading until
 * CLI execution so importing cascade.ts as a library produces zero side effects.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeToolInput, oneLine } from "./antigravity";
import {
  BudgetExceededError,
  type CascadeConfig,
  ConfigValidationError,
  CONSTANTS,
  enforceSessionBudget,
  evaluateProtectedBranchGuard,
  EXIT_CODE_CONSTANTS,
  formatHelp,
  FULL_VERIFY,
  isKeepAliveEnabled,
  loadConfig,
  parseCliArgs,
  ProtectedBranchError,
  redactSensitiveData,
  resolveEngine,
  RUNTIME_CONSTANTS,
  VERIFY_CONSTANTS,
} from "./config";
import {
  discoverArchifyTargets,
  syncDiagrams,
  type ArchifyTarget,
  type DiagramStepResult,
  type DiagramSyncOptions,
  type DiagramSyncResult,
} from "./diagrams";
import {
  getEngineAdapter,
  type EngineOutcome,
  type UsageMeter,
} from "./engine";
import {
  isNuxtProject,
  resolvePackageCommands,
  startKeepAlive,
  tryDetectPackageManager,
  type KeepAliveController,
} from "./platform";
import {
  formatVerificationFeedback,
  runVerificationPhase,
  type VerificationFailure,
  type VerificationResult,
} from "./qa";
import {
  captureGitState,
  Fatal,
  rollbackWorkingTree,
  RollbackStateBuffer,
  TaskFailureError,
  type CaptureGitStateOptions,
  type GitWorkingTreeState,
  type RollbackBufferOptions,
  type RollbackOptions,
  type RollbackResult,
} from "./resilience";
import {
  discoverDirectives,
  discoverSkills,
  formatDirectivesPrompt,
  formatSkillsPrompt,
} from "./skills";

export {
  captureGitState,
  describeToolInput,
  discoverArchifyTargets,
  Fatal,
  formatVerificationFeedback,
  isKeepAliveEnabled,
  oneLine,
  resolveEngine,
  rollbackWorkingTree,
  RollbackStateBuffer,
  runVerificationPhase,
  syncDiagrams,
  TaskFailureError,
  type ArchifyTarget,
  type CaptureGitStateOptions,
  type DiagramStepResult,
  type DiagramSyncOptions,
  type DiagramSyncResult,
  type GitWorkingTreeState,
  type RollbackBufferOptions,
  type RollbackOptions,
  type RollbackResult,
  type VerificationFailure,
  type VerificationResult,
};

export type Task = { id: string; done: boolean; text: string; section: string; line: number };
type SessionOutcome = EngineOutcome;

export interface VerifyCommandsOptions {
  repoRoot?: string;
  config?: CascadeConfig;
}

interface CascadeRuntimeContext {
  config: CascadeConfig;
  logFile: string;
  logDirReady: boolean;
  totalCostUsd: number;
  announcedModel?: string;
}

let keepAliveController: KeepAliveController | undefined;

/**
 * Returns the active keep-alive controller for the current CLI run, if started.
 */
export function getKeepAliveController(): KeepAliveController | undefined {
  return keepAliveController;
}

function createRuntimeContext(config: CascadeConfig): CascadeRuntimeContext {
  return {
    config,
    logFile: join(config.logDir, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`),
    logDirReady: false,
    totalCostUsd: 0,
  };
}

function logEvent(ctx: CascadeRuntimeContext, event: string, data: Record<string, unknown> = {}): void {
  if (ctx.config.dryRun) return;
  if (!ctx.logDirReady) {
    mkdirSync(ctx.config.logDir, { recursive: true });
    ctx.logDirReady = true;
  }
  const rawPayload = { t: new Date().toISOString(), event, ...data };
  const payload = ctx.config.telemetry.redactSecrets
    ? redactSensitiveData(rawPayload, ctx.config.telemetry.maxRedactionDepth)
    : rawPayload;
  appendFileSync(ctx.logFile, JSON.stringify(payload) + "\n");
}

function say(ctx: CascadeRuntimeContext, message: string): void {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  logEvent(ctx, "say", { message });
}

function progress(message: string): void {
  console.log(`[${new Date().toLocaleTimeString()}]     ${message}`);
}

async function sh(
  ctx: CascadeRuntimeContext,
  cmd: string | string[],
  timeoutMs: number = ctx.config.commandTimeoutMs,
): Promise<{ code: number; output: string }> {
  const argv = typeof cmd === "string" ? ["sh", "-c", cmd] : cmd;
  const proc = Bun.spawn(argv, { cwd: ctx.config.repo, stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output: (out + err).trim() };
}

/**
 * Parses OpenSpec tasks.md markdown into structured task entries with section metadata.
 */
export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = [];
  let section = "";
  let current: Task | undefined;
  for (const [index, line] of markdown.split("\n").entries()) {
    const heading = line.match(/^#{2,}\s+(.*)$/);
    if (heading) {
      section = heading[1]!.trim();
      current = undefined;
      continue;
    }
    const item = line.match(/^- \[([ xX])\] (?:\*\*)?([A-Z]*\d+(?:\.\d+)*)(?:\*\*)?:?\s+(.*)$/);
    if (item) {
      current = { id: item[2]!, done: item[1] !== " ", text: item[3]!, section, line: index };
      tasks.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`;
    } else {
      current = undefined;
    }
  }
  return tasks;
}

function readTasks(tasksPath: string): Task[] {
  return parseTasks(readFileSync(tasksPath, "utf8"));
}

function markDone(tasksPath: string, id: string): void {
  const task = readTasks(tasksPath).find((t) => t.id === id);
  if (!task || task.done) return;
  const lines = readFileSync(tasksPath, "utf8").split("\n");
  lines[task.line] = lines[task.line]!.replace("- [ ]", "- [x]");
  writeFileSync(tasksPath, lines.join("\n"));
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
  if (!/\bVerify:/.test(task.text) && !isFull && !gated) return [];

  const pm = options?.repoRoot ? tryDetectPackageManager(options.repoRoot) : null;
  const cmds = pm ? resolvePackageCommands(pm) : undefined;
  const useNuxt = options?.repoRoot ? isNuxtProject(options.repoRoot) : true;
  const fallbackDefaultVerify = options?.config?.defaultVerify ?? (cmds ? [cmds.test, cmds.lint] : CONSTANTS.DEFAULT_VERIFY);
  const fallbackFullVerify =
    options?.config?.fullVerify ??
    (cmds && !useNuxt ? [cmds.typecheck, cmds.lint, cmds.test, cmds.build] : FULL_VERIFY);

  const commands = new Set<string>();
  const pmCommandPattern = /^(?:(?:bunx?|npm|pnpm|yarn)\s+|tsc\s+--noEmit$)/;

  for (const [, span] of task.text.matchAll(/`([^`]+)`/g)) {
    const command = span!.trim();
    if (!pmCommandPattern.test(command)) continue;
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

  const prose = task.text.replace(/`[^`]*`/g, " ");
  if (/\blint\b/i.test(prose)) commands.add(cmds ? cmds.lint : "bun run lint");
  if (/\bbuild\b/i.test(prose)) commands.add(cmds ? cmds.build : "bun run build");
  if (/\bboth\s+`?(?:bunx\s+)?tsc\b/i.test(task.text)) {
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

async function readUsage(ctx: CascadeRuntimeContext): Promise<UsageMeter[] | null> {
  const adapter = getEngineAdapter(ctx.config.engine);
  if (!adapter.supportsPlanMeters() || !adapter.readUsage) return null;
  try {
    return await adapter.readUsage(ctx.config.repo);
  } catch (error) {
    logEvent(ctx, "usage_read_failed", { error: String(error) });
    return null;
  }
}

function blockingMeters(ctx: CascadeRuntimeContext, meters: UsageMeter[]): UsageMeter[] {
  return meters.filter((m) => m.percent >= ctx.config.usageLimitPercent);
}

async function sleepUntil(ctx: CascadeRuntimeContext, epochMs: number, reason: string): Promise<void> {
  const ms = Math.max(ctx.config.minPauseMs, epochMs - Date.now());
  say(
    ctx,
    `Pausing ${Math.round(ms / CONSTANTS.MS_PER_MINUTE)} min (${reason}); resuming around ${new Date(Date.now() + ms).toLocaleString()}`,
  );
  await Bun.sleep(ms);
}

async function waitForUsageHeadroom(ctx: CascadeRuntimeContext): Promise<void> {
  const adapter = getEngineAdapter(ctx.config.engine);
  if (!adapter.supportsPlanMeters()) return;
  for (;;) {
    const meters = await readUsage(ctx);
    if (!meters) return;
    const blocking = blockingMeters(ctx, meters);
    if (!blocking.length) return;
    const resets = blocking.map((m) => m.resetsAt).filter((r): r is number => r !== null);
    const until = resets.length ? Math.max(...resets) + ctx.config.resetMarginMs : Date.now() + ctx.config.unknownResetSleepMs;
    await sleepUntil(ctx, until, blocking.map((m) => `${m.kind} ${m.percent}%`).join(", "));
  }
}

async function runSession(ctx: CascadeRuntimeContext, prompt: string, resume?: string): Promise<SessionOutcome> {
  const adapter = getEngineAdapter(ctx.config.engine);
  const defaultModel = adapter.getDefaultModel(ctx.config.effort ?? CONSTANTS.DEFAULT_EFFORT);
  const model = ctx.config.model ?? defaultModel;
  const displayModel =
    ctx.config.effort && ctx.config.effort !== "none" ? `${model} (effort: ${ctx.config.effort})` : model;

  if (ctx.config.engine !== "claude" && displayModel !== ctx.announcedModel) {
    ctx.announcedModel = displayModel;
    say(ctx, `  model: ${displayModel} (${ctx.config.engine})`);
  }

  const outcome = await adapter.runSession({
    prompt,
    cwd: ctx.config.repo,
    resume,
    model: ctx.config.model,
    effort: ctx.config.effort,
    config: ctx.config,
    hooks: {
      onTool: (name, input) => {
        const detail = describeToolInput(input);
        logEvent(ctx, "tool", { name, detail });
        progress(`🔧 ${name}${detail ? ` ${detail}` : ""}`);
      },
      onText: (text) => {
        logEvent(ctx, "text", { text: text.slice(0, CONSTANTS.LOG_TEXT_MAX_LENGTH) });
        progress(`💬 ${oneLine(text)}`);
      },
      onModel: (reportedModel) => {
        if (reportedModel !== ctx.announcedModel) {
          ctx.announcedModel = reportedModel;
          say(ctx, `  model: ${reportedModel}`);
          logEvent(ctx, "model", { model: reportedModel });
        }
      },
      log: (event, data) => logEvent(ctx, event, data),
    },
  });

  enforceSessionBudget(outcome.costUsd, ctx.config.maxBudgetPerSessionUsd, "session");
  ctx.totalCostUsd += outcome.costUsd;
  const turnsInfo = outcome.turns !== undefined ? `${outcome.turns} turns, ` : "";
  const label = outcome.subtype ?? outcome.kind;
  say(
    ctx,
    `  session ${label}: ${turnsInfo}$${outcome.costUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)} (cascade total $${ctx.totalCostUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)})`,
  );
  return outcome;
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

async function commitChanges(ctx: CascadeRuntimeContext, message: string): Promise<void> {
  const excludes = ctx.config.neverCommit.map((p) => `:!${p}`);
  await sh(ctx, ["git", "add", "-A", "--", ".", ...excludes]);
  if ((await sh(ctx, ["git", "diff", "--cached", "--quiet"])).code === CONSTANTS.EXIT_CODE_SUCCESS) {
    say(ctx, "  nothing to commit");
    return;
  }
  const { code, output } = await sh(ctx, ["git", "commit", "-m", message]);
  if (code !== CONSTANTS.EXIT_CODE_SUCCESS) {
    throw new Fatal(`git commit failed:\n${output.slice(-CONSTANTS.COMMIT_ERROR_OUTPUT_MAX_LENGTH)}`);
  }
  const sha = (await sh(ctx, ["git", "rev-parse", "--short", "HEAD"])).output;
  say(ctx, `  committed ${sha} ${message}`);
  logEvent(ctx, "commit", { sha, message });
}

async function runTask(
  ctx: CascadeRuntimeContext,
  change: string,
  tasksPath: string,
  task: Task,
  sectionCommit: boolean,
): Promise<void> {
  const verify = verifyCommands(task, ctx.config.fullGate, { repoRoot: ctx.config.repo, config: ctx.config });
  const commitType = commitTypeOf(task);
  let prompt = taskPrompt(change, task, verify, sectionCommit, ctx.config.repo);
  let sessionId: string | undefined;
  let subject: string | undefined;
  let header: string | undefined;
  let attempts = 0;

  const rollbackBuffer = new RollbackStateBuffer({
    cwd: ctx.config.repo,
    excludes: ctx.config.neverCommit,
    timeoutMs: ctx.config.commandTimeoutMs,
    hooks: {
      say: (msg) => say(ctx, msg),
      log: (ev, d) => logEvent(ctx, ev, d),
    },
  });
  await rollbackBuffer.snapshot();

  while (attempts < ctx.config.maxAttemptsPerTask) {
    enforceSessionBudget(ctx.totalCostUsd, ctx.config.maxTotalBudgetUsd, "total");
    await waitForUsageHeadroom(ctx);

    const outcome = await runSession(ctx, prompt, sessionId);
    if (outcome.kind === "fatal") throw new Fatal(outcome.reason);
    sessionId = outcome.sessionId ?? sessionId;

    if (outcome.kind === "paused") {
      await sleepUntil(ctx, outcome.resumeAt, "plan usage limit");
      prompt = `You were paused for plan usage limits. Continue task ${task.id} from the current working tree (inspect git diff first).`;
      continue;
    }
    attempts++;

    if (outcome.kind === "error") {
      say(ctx, `  session ended with ${outcome.reason} (attempt ${attempts}/${ctx.config.maxAttemptsPerTask})`);
      prompt = `The previous session stopped with "${outcome.reason}". Continue task ${task.id} from the current working tree.`;
      continue;
    }

    subject ??= outcome.result.match(/^COMMIT_SUBJECT:\s*(.+)$/m)?.[1]?.trim();
    header ??= outcome.result.match(/^COMMIT_MESSAGE:\s*(.+)$/m)?.[1]?.trim();
    const blocked = blockedReason(outcome.result);
    if (blocked) throw new Fatal(`Task ${task.id} needs a human decision: ${blocked}`);

    if (verify.length) {
      const verification = await runVerificationPhase({
        commands: verify,
        cwd: ctx.config.repo,
        taskId: task.id,
        attempt: attempts,
        maxAttempts: ctx.config.maxAttemptsPerTask,
        timeoutMs: ctx.config.commandTimeoutMs,
        hooks: {
          say: (msg) => say(ctx, msg),
          log: (ev, d) => logEvent(ctx, ev, d),
        },
      });
      if (!verification.success) {
        say(ctx, `  checks failed (attempt ${attempts}/${ctx.config.maxAttemptsPerTask})`);
        prompt = verification.feedbackPrompt!;
        continue;
      }
      markDone(tasksPath, task.id);
    } else if (!readTasks(tasksPath).find((t) => t.id === task.id)?.done) {
      prompt = `Task ${task.id} is still unchecked in tasks.md. Finish it and mark it, or reply with "BLOCKED: <reason>".`;
      continue;
    }

    if (commitType) {
      const description = subject ?? task.section.replace(/^\d+\.\s*/, "");
      await commitChanges(ctx, `${commitType}: ${description}`.slice(0, CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH));
    } else if (sectionCommit) {
      const fallback = `chore(${change}): ${task.section.replace(/^\d+\.\s*/, "").toLowerCase()}`;
      await commitChanges(
        ctx,
        (header && CONSTANTS.CONVENTIONAL_HEADER_REGEX.test(header) ? header : fallback).slice(
          0,
          CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH,
        ),
      );
    }
    return;
  }

  if (ctx.config.rollbackOnFailure) {
    say(ctx, `  ⚠️ Task ${task.id} failed after ${attempts} attempts; executing git rollback buffer...`);
    const rollbackRes = await rollbackBuffer.rollback();
    if (rollbackRes.success) {
      say(ctx, `  ✅ Working tree rolled back to clean baseline (${rollbackRes.targetRef})`);
    } else {
      say(ctx, `  ❌ Working tree rollback failed: ${rollbackRes.error}`);
    }
  }

  throw new TaskFailureError(task.id, change, attempts, ctx.logFile);
}

async function runChange(ctx: CascadeRuntimeContext, change: string): Promise<string[]> {
  const tasksPath = join(ctx.config.repo, "openspec", "changes", change, "tasks.md");
  if (!existsSync(tasksPath)) throw new Fatal(`${tasksPath} not found; create the change with /opsx:propose first`);
  const skipped = new Set<string>();
  const perSection = commitsPerSection(readTasks(tasksPath));
  say(ctx, `=== ${change} === (${perSection ? "one commit per section" : "commit at tasks that name a type"})`);

  for (;;) {
    const task = readTasks(tasksPath).find((t) => !t.done && !skipped.has(t.id));
    if (!task) {
      if (ctx.config.autoDiagrams) {
        say(ctx, `🔄 Synchronizing diagrams for completed change: ${change}...`);
        const diagResult = await syncDiagrams({
          cwd: ctx.config.repo,
          graphifyCommand: ctx.config.graphifyCommand,
          archifyBin: ctx.config.archifyBin,
          archifyAction: ctx.config.archifyAction,
          archifyQuality: ctx.config.archifyQuality,
          timeoutMs: CONSTANTS.DIAGRAM_SYNC_TIMEOUT_MS,
          hooks: {
            say: (msg) => say(ctx, msg),
            log: (ev, d) => logEvent(ctx, ev, d),
          },
        });
        if (diagResult.success) {
          say(ctx, `✅ Diagrams synchronized for ${change}`);
        } else {
          say(ctx, `⚠️ Diagram synchronization encountered warnings or failures for ${change}`);
        }
      }
      return [...skipped];
    }
    if (CONSTANTS.HUMAN_TASK_REGEX.test(task.text)) {
      skipped.add(task.id);
      say(ctx, `  skipping ${task.id} (human task): ${task.text.slice(0, CONSTANTS.TASK_SUMMARY_MAX_LENGTH)}`);
      continue;
    }
    say(ctx, `▶ ${change} ${task.id}: ${task.text.slice(0, CONSTANTS.TASK_SUMMARY_MAX_LENGTH)}`);
    logEvent(ctx, "task_start", { change, id: task.id });
    try {
      await runTask(ctx, change, tasksPath, task, perSection && isLastOfSection(readTasks(tasksPath), task));
    } catch (error) {
      if (error instanceof TaskFailureError && ctx.config.resilient) {
        skipped.add(task.id);
        say(
          ctx,
          `  ⚠️ Resilient 24/7 mode: task ${task.id} failed after ${error.attempts} attempts and was rolled back; continuing.`,
        );
        logEvent(ctx, "task_failure_resilient", {
          change,
          taskId: task.id,
          attempts: error.attempts,
          error: error.message,
        });
        continue;
      }
      throw error;
    }
  }
}

async function preflight(ctx: CascadeRuntimeContext): Promise<void> {
  if (!ctx.config.changes.length) throw new Fatal("Pass --changes a,b,c in cascade order");
  const branch = (await sh(ctx, ["git", "branch", "--show-current"])).output;
  const branchGuard = evaluateProtectedBranchGuard({
    branch,
    protectedBranches: ctx.config.protectedBranches,
    dryRun: ctx.config.dryRun,
  });
  if (!branchGuard.allowed) {
    throw new ProtectedBranchError(branch, branchGuard.warning);
  }
  if (branchGuard.warning) {
    say(ctx, `warning: ${branchGuard.warning}`);
  }
  const dirty = (await sh(ctx, ["git", "status", "--porcelain", "--untracked-files=all"])).output
    .split("\n")
    .filter((l) => l && !ctx.config.neverCommit.some((p) => l.slice(CONSTANTS.GIT_STATUS_PREFIX_LENGTH).startsWith(p)));
  if (dirty.length) {
    const warning = `Working tree is dirty (these files would land in the first commit):\n${dirty.join("\n")}`;
    if (!ctx.config.allowDirty && !ctx.config.dryRun) throw new Fatal(`${warning}\nClean it or pass --allow-dirty.`);
    say(ctx, warning);
  }
  const keepAliveStatus = keepAliveController ? `keepAlive=${keepAliveController.mechanism} ` : "";
  say(
    ctx,
    `engine=${ctx.config.engine} ${keepAliveStatus}repo=${ctx.config.repo} branch=${branch} changes=${ctx.config.changes.join(" → ")} log=${ctx.config.dryRun ? "disabled (dry-run)" : ctx.logFile}`,
  );
}

function printPlan(ctx: CascadeRuntimeContext): void {
  for (const change of ctx.config.changes) {
    const tasksPath = join(ctx.config.repo, "openspec", "changes", change, "tasks.md");
    if (!existsSync(tasksPath)) {
      console.log(`\n${change}: MISSING (create it with /opsx:propose)`);
      continue;
    }
    const tasks = readTasks(tasksPath);
    const pending = tasks.filter((t) => !t.done);
    const perSection = commitsPerSection(tasks);
    console.log(`\n${change}: ${pending.length} pending${perSection ? " (one commit per section)" : ""}`);
    for (const task of pending) {
      const verify = verifyCommands(task, ctx.config.fullGate, { repoRoot: ctx.config.repo, config: ctx.config });
      const flags = [
        CONSTANTS.HUMAN_TASK_REGEX.test(task.text) ? "HUMAN-SKIP" : "",
        commitTypeOf(task) ? `commit=${commitTypeOf(task)}` : perSection && isLastOfSection(tasks, task) ? "commit=agent" : "",
        verify.length ? `verify=[${verify.join(" | ")}]` : "",
      ].filter(Boolean);
      console.log(`  ${task.id} ${flags.join(" ")}`);
    }
  }
}

async function executeCascade(ctx: CascadeRuntimeContext): Promise<void> {
  keepAliveController = startKeepAlive({ enabled: ctx.config.keepAlive });
  logEvent(ctx, "keep_alive", { active: keepAliveController.active, mechanism: keepAliveController.mechanism });
  try {
    await preflight(ctx);
    if (ctx.config.dryRun) {
      printPlan(ctx);
      const meters = await readUsage(ctx);
      console.log("\nusage:", meters ?? "unavailable (API key or token without user:profile scope)");
      return;
    }
    const report: string[] = [];
    for (const change of ctx.config.changes) {
      const skipped = await runChange(ctx, change);
      report.push(`${change}: done${skipped.length ? `, human tasks pending: ${skipped.join(", ")}` : ""}`);
    }
    say(
      ctx,
      `Cascade finished. Estimated cost $${ctx.totalCostUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)}\n${report.join("\n")}`,
    );
  } finally {
    keepAliveController.stop();
  }
}

function isFatalFailClosedError(error: unknown): boolean {
  return (
    error instanceof ConfigValidationError ||
    error instanceof BudgetExceededError ||
    error instanceof ProtectedBranchError ||
    error instanceof Fatal
  );
}

/**
 * Executes the cascade CLI with explicit argv and env, returning a deterministic process exit code.
 */
export async function runCli(
  argv: string[] = process.argv.slice(CONSTANTS.ARGV_START_INDEX),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<number> {
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.options.help) {
      console.log(formatHelp());
      return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
    }
    const cfg = loadConfig(argv, env);
    const ctx = createRuntimeContext(cfg);
    await executeCascade(ctx);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
  } catch (error) {
    keepAliveController?.stop();
    const message = error instanceof Error ? error.message : String(error);
    if (isFatalFailClosedError(error)) {
      console.error(`STOPPED: ${message}`);
      return EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
    }
    const detail = error instanceof Error && error.stack ? error.stack : message;
    console.error(`CRASHED: ${detail}`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
  }
}

/**
 * Primary CLI entrypoint delegating to runCli and exiting with its return code.
 */
export async function main(
  argv: string[] = process.argv.slice(CONSTANTS.ARGV_START_INDEX),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<void> {
  const exitCode = await runCli(argv, env);
  if (exitCode !== EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS) {
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  void main();
}
