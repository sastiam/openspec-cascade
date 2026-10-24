#!/usr/bin/env bun
/**
 * OpenSpec cascade runner.
 *
 * Runs OpenSpec changes in order. Each unchecked task gets its own agent session; "Verify" tasks are
 * checked by running their commands here (the agent's word is not the oracle); tasks that name a
 * commit type ("Commit `refactor(app)`") are committed by this script. Before every session, and
 * whenever the stream reports a rate limit, plan usage is read from `/usage`; at USAGE_LIMIT_PERCENT
 * the runner sleeps until the blocking meters reset.
 *
 * Usage:
 *   bun run cascade.ts --repo <path> --changes a,b,c [--allow-dirty] [--dry-run] [--no-keep-alive]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONSTANTS,
  FULL_VERIFY,
  isKeepAliveEnabled,
  loadConfig,
  resolveEngine,
  type CascadeConfig,
} from "./config";
import {
  getEngineAdapter,
  type EngineAdapter,
  type EngineHooks,
  type EngineOutcome,
  type UsageMeter,
} from "./engine";
import { startKeepAlive, type KeepAliveController } from "./platform";
import {
  formatVerificationFeedback,
  runVerificationPhase,
  type VerificationFailure,
  type VerificationResult,
} from "./qa";
import {
  discoverArchifyTargets,
  syncDiagrams,
  type ArchifyTarget,
  type DiagramStepResult,
  type DiagramSyncOptions,
  type DiagramSyncResult,
} from "./diagrams";
import {
  discoverDirectives,
  discoverSkills,
  formatDirectivesPrompt,
  formatSkillsPrompt,
} from "./skills";
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

export {
  captureGitState,
  discoverArchifyTargets,
  Fatal,
  formatVerificationFeedback,
  isKeepAliveEnabled,
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

export const config: CascadeConfig = loadConfig();

export type Task = { id: string; done: boolean; text: string; section: string; line: number };
type SessionOutcome = EngineOutcome;

let keepAliveController: KeepAliveController | undefined;

export function getKeepAliveController(): KeepAliveController | undefined {
  return keepAliveController;
}

const repo = config.repo;
const engine = config.engine;
const changes = config.changes;
const logDir = join(import.meta.dir, "logs");
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`);
let totalCostUsd = 0;
let announcedModel: string | undefined;

function log(event: string, data: Record<string, unknown> = {}) {
  appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), event, ...data }) + "\n");
}

function say(message: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  log("say", { message });
}

function oneLine(text: string, max: number = CONSTANTS.ONE_LINE_MAX_LENGTH) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Agent activity line; kept out of the log file because "tool"/"text" events already record it. */
function progress(message: string) {
  console.log(`[${new Date().toLocaleTimeString()}]     ${message}`);
}

function describeToolInput(input: unknown) {
  if (!input || typeof input !== "object") return "";
  const fields = input as Record<string, unknown>;
  const value = fields.command ?? fields.file_path ?? fields.pattern ?? fields.url ?? fields.query ?? fields.description;
  return typeof value === "string" ? oneLine(value, CONSTANTS.TOOL_INPUT_MAX_LENGTH) : "";
}

async function sh(cmd: string | string[], timeoutMs = config.commandTimeoutMs) {
  const argv = typeof cmd === "string" ? ["sh", "-c", cmd] : cmd;
  const proc = Bun.spawn(argv, { cwd: repo, stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output: (out + err).trim() };
}

// ---------- tasks.md ----------

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
    // Accepts both "- [ ] 2.1 Text" and "- [ ] **T001**: Text"
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

function readTasks(tasksPath: string) {
  return parseTasks(readFileSync(tasksPath, "utf8"));
}

function markDone(tasksPath: string, id: string) {
  const task = readTasks(tasksPath).find((t) => t.id === id);
  if (!task || task.done) return;
  const lines = readFileSync(tasksPath, "utf8").split("\n");
  lines[task.line] = lines[task.line]!.replace("- [ ]", "- [x]");
  writeFileSync(tasksPath, lines.join("\n"));
}

/**
 * Commands to run for a verification task ("…. Verify: …", "Run full verification …"): explicit `bun …`
 * code spans plus the shorthand keywords tasks use. "Verify X is complete" (no colon) is a normal task.
 * With `fullGate`, tasks that commit always include FULL_VERIFY.
 */
export function verifyCommands(task: Task, fullGate = false): string[] {
  const isFull = /\bfull verification\b/i.test(task.text);
  const gated = fullGate && commitTypeOf(task) !== undefined;
  if (!/\bVerify:/.test(task.text) && !isFull && !gated) return [];
  const commands = new Set<string>();
  for (const [, span] of task.text.matchAll(/`([^`]+)`/g)) {
    const command = span!.trim();
    if (!/^bunx? /.test(command)) continue;
    // `bun audit` exits non-zero while ANY advisory remains (some have no fix); the agent checks the named packages
    if (/^bun audit\b/.test(command)) continue;
    if (/^bunx tsc --noEmit$/.test(command)) {
      commands.add(CONSTANTS.TSC_SERVER);
      commands.add(CONSTANTS.TSC_APP);
      continue;
    }
    // "`bun run db:generate` produces no new migration" is an assertion, not just a command
    commands.add(command === "bun run db:generate" ? CONSTANTS.NO_NEW_MIGRATION : command);
  }
  if (gated) FULL_VERIFY.forEach((c) => commands.add(c));
  if (isFull && !commands.size) FULL_VERIFY.forEach((c) => commands.add(c));
  const prose = task.text.replace(/`[^`]*`/g, " ");
  if (/\blint\b/i.test(prose)) commands.add("bun run lint");
  if (/\bbuild\b/i.test(prose)) commands.add("bun run build");
  if (/\bboth\s+`?(?:bunx\s+)?tsc\b/i.test(task.text)) {
    commands.add(CONSTANTS.TSC_SERVER);
    commands.add(CONSTANTS.TSC_APP);
  }
  if (/\bE2E\b/.test(prose)) commands.add("bun run test:e2e");
  const list = commands.size ? [...commands] : [...CONSTANTS.DEFAULT_VERIFY];
  return list.some((c) => c.includes("tsc")) ? ["bunx nuxi prepare", ...list] : list;
}

/** Commit type named by the task ("Commit `refactor(app)`", "(`docs` commit)"); ignores code spans that aren't types. */
/**
 * The reason in a "BLOCKED: <reason>" line, or undefined. Some models (DeepSeek via OpenCode) always emit the
 * line with an empty reason such as "none", which must not stop the cascade.
 */
export function blockedReason(result: string): string | undefined {
  // Tolerates markdown around the marker: "**BLOCKED:** none.", "BLOCKED: `none`"
  const reason = result.match(/^\**BLOCKED:?\**:?\s*(.+)$/m)?.[1]?.replace(/^[*`\s]+|[*`.\s]+$/g, "");
  if (!reason || /^(none|n\/?a|no|nothing|null|false|-+|not blocked)$/i.test(reason)) return undefined;
  return reason;
}

export function commitTypeOf(task: Task): string | undefined {
  for (const match of task.text.matchAll(/\bCommit `([^`]+)`|`([^`]+)` commit\b/gi)) {
    const type = (match[1] ?? match[2])!.trim();
    if (CONSTANTS.CONVENTIONAL_TYPE_REGEX.test(type)) return type;
  }
  return undefined;
}

/**
 * Changes whose tasks never name a commit type commit once per section (after its last task), with a
 * header the agent proposes. Committing every task floods history with checkbox-only commits.
 */
export function commitsPerSection(tasks: Task[]): boolean {
  return !tasks.some((t) => commitTypeOf(t));
}

export function isLastOfSection(tasks: Task[], task: Task): boolean {
  return tasks.filter((t) => t.section === task.section).at(-1)?.id === task.id;
}

// ---------- usage guard ----------

function toEpochMs(value: number) {
  return value < CONSTANTS.EPOCH_MS_THRESHOLD ? value * CONSTANTS.MS_PER_SECOND : value;
}

/** Reads plan meters from the structured `/usage` report; null when the session can't provide one (e.g. API key). */
async function readUsage(): Promise<UsageMeter[] | null> {
  const adapter = getEngineAdapter(engine);
  if (!adapter.supportsPlanMeters() || !adapter.readUsage) return null;
  try {
    return await adapter.readUsage(repo);
  } catch (error) {
    log("usage_read_failed", { error: String(error) });
    return null;
  }
}

function blockingMeters(meters: UsageMeter[]) {
  return meters.filter((m) => m.percent >= config.usageLimitPercent);
}

async function sleepUntil(epochMs: number, reason: string) {
  const ms = Math.max(config.minPauseMs, epochMs - Date.now());
  say(`Pausing ${Math.round(ms / CONSTANTS.MS_PER_MINUTE)} min (${reason}); resuming around ${new Date(Date.now() + ms).toLocaleString()}`);
  await Bun.sleep(ms);
}

/** Blocks until every plan meter is under the limit. Returns immediately when usage is unreadable. */
async function waitForUsageHeadroom() {
  const adapter = getEngineAdapter(engine);
  if (!adapter.supportsPlanMeters()) return;
  for (;;) {
    const meters = await readUsage();
    if (!meters) return;
    const blocking = blockingMeters(meters);
    if (!blocking.length) return;
    const resets = blocking.map((m) => m.resetsAt).filter((r): r is number => r !== null);
    const until = resets.length ? Math.max(...resets) + config.resetMarginMs : Date.now() + config.unknownResetSleepMs;
    await sleepUntil(until, blocking.map((m) => `${m.kind} ${m.percent}%`).join(", "));
  }
}

// ---------- agent sessions ----------

async function runSession(prompt: string, resume?: string): Promise<SessionOutcome> {
  const adapter = getEngineAdapter(engine);
  const defaultModel = adapter.getDefaultModel(config.effort ?? CONSTANTS.DEFAULT_EFFORT);
  const model = config.model ?? defaultModel;
  const displayModel = config.effort && config.effort !== "none" ? `${model} (effort: ${config.effort})` : model;

  if (engine !== "claude" && displayModel !== announcedModel) {
    announcedModel = displayModel;
    say(`  model: ${displayModel} (${engine})`);
  }

  const outcome = await adapter.runSession({
    prompt,
    cwd: repo,
    resume,
    model: config.model,
    effort: config.effort,
    config,
    hooks: {
      onTool: (name, input) => {
        const detail = describeToolInput(input);
        log("tool", { name, detail });
        progress(`🔧 ${name}${detail ? ` ${detail}` : ""}`);
      },
      onText: (text) => {
        log("text", { text: text.slice(0, CONSTANTS.LOG_TEXT_MAX_LENGTH) });
        progress(`💬 ${oneLine(text)}`);
      },
      onModel: (reportedModel) => {
        if (reportedModel !== announcedModel) {
          announcedModel = reportedModel;
          say(`  model: ${reportedModel}`);
          log("model", { model: reportedModel });
        }
      },
      log,
    },
  });

  totalCostUsd += outcome.costUsd;
  const turnsInfo = outcome.turns !== undefined ? `${outcome.turns} turns, ` : "";
  const label = outcome.subtype ?? outcome.kind;
  say(`  session ${label}: ${turnsInfo}$${outcome.costUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)} (cascade total $${totalCostUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)})`);
  return outcome;
}

export function taskPrompt(
  change: string,
  task: Task,
  verify: string[],
  sectionCommit: boolean,
  repoRoot: string = repo,
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
      : `- End your final reply with a line "COMMIT_SUBJECT: <imperative summary of ALL changes in section "${task.section}", max 60 chars>".`,
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

export async function runChecks(commands: string[]): Promise<string[]> {
  const result = await runVerificationPhase({
    commands,
    cwd: repo,
    timeoutMs: config.commandTimeoutMs,
    hooks: { say, log },
  });
  return result.failures.map(
    (f) => `$ ${f.command} (exit ${f.exitCode})\n${f.output.slice(-CONSTANTS.CHECK_FAILURE_OUTPUT_MAX_LENGTH)}`,
  );
}

async function commit(message: string) {
  const excludes = config.neverCommit.map((p) => `:!${p}`);
  await sh(["git", "add", "-A", "--", ".", ...excludes]);
  if ((await sh(["git", "diff", "--cached", "--quiet"])).code === CONSTANTS.EXIT_CODE_SUCCESS) {
    say("  nothing to commit");
    return;
  }
  const { code, output } = await sh(["git", "commit", "-m", message]);
  if (code !== CONSTANTS.EXIT_CODE_SUCCESS) throw new Fatal(`git commit failed:\n${output.slice(-CONSTANTS.COMMIT_ERROR_OUTPUT_MAX_LENGTH)}`);
  const sha = (await sh(["git", "rev-parse", "--short", "HEAD"])).output;
  say(`  committed ${sha} ${message}`);
  log("commit", { sha, message });
}

async function runTask(change: string, tasksPath: string, task: Task, sectionCommit: boolean) {
  const verify = verifyCommands(task, config.fullGate);
  const commitType = commitTypeOf(task);
  let prompt = taskPrompt(change, task, verify, sectionCommit);
  let sessionId: string | undefined;
  // The first successful session describes the task; retry sessions only describe their fix.
  let subject: string | undefined;
  let header: string | undefined;
  let attempts = 0;

  const rollbackBuffer = new RollbackStateBuffer({
    cwd: repo,
    excludes: config.neverCommit,
    timeoutMs: config.commandTimeoutMs,
    hooks: { say, log },
  });
  await rollbackBuffer.snapshot();

  while (attempts < config.maxAttemptsPerTask) {
    if (totalCostUsd >= config.maxTotalBudgetUsd) throw new Fatal(`Total budget of $${config.maxTotalBudgetUsd} reached`);
    await waitForUsageHeadroom();

    const outcome = await runSession(prompt, sessionId);
    if (outcome.kind === "fatal") throw new Fatal(outcome.reason);
    sessionId = outcome.sessionId ?? sessionId;

    if (outcome.kind === "paused") {
      // A usage pause is not a failed attempt.
      await sleepUntil(outcome.resumeAt, "plan usage limit");
      prompt = `You were paused for plan usage limits. Continue task ${task.id} from the current working tree (inspect git diff first).`;
      continue;
    }
    attempts++;

    if (outcome.kind === "error") {
      say(`  session ended with ${outcome.reason} (attempt ${attempts}/${config.maxAttemptsPerTask})`);
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
        cwd: repo,
        taskId: task.id,
        attempt: attempts,
        maxAttempts: config.maxAttemptsPerTask,
        timeoutMs: config.commandTimeoutMs,
        hooks: { say, log },
      });
      if (!verification.success) {
        say(`  checks failed (attempt ${attempts}/${config.maxAttemptsPerTask})`);
        prompt = verification.feedbackPrompt!;
        continue;
      }
      markDone(tasksPath, task.id); // the checks are the oracle
    } else if (!readTasks(tasksPath).find((t) => t.id === task.id)?.done) {
      prompt = `Task ${task.id} is still unchecked in tasks.md. Finish it and mark it, or reply with "BLOCKED: <reason>".`;
      continue;
    }

    if (commitType) {
      const description = subject ?? task.section.replace(/^\d+\.\s*/, "");
      await commit(`${commitType}: ${description}`.slice(0, CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH));
    } else if (sectionCommit) {
      const fallback = `chore(${change}): ${task.section.replace(/^\d+\.\s*/, "").toLowerCase()}`;
      await commit((header && CONSTANTS.CONVENTIONAL_HEADER_REGEX.test(header) ? header : fallback).slice(0, CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH));
    }
    return;
  }

  if (config.rollbackOnFailure) {
    say(`  ⚠️ Task ${task.id} failed after ${attempts} attempts; executing git rollback buffer...`);
    const rollbackRes = await rollbackBuffer.rollback();
    if (rollbackRes.success) {
      say(`  ✅ Working tree rolled back to clean baseline (${rollbackRes.targetRef})`);
    } else {
      say(`  ❌ Working tree rollback failed: ${rollbackRes.error}`);
    }
  }

  throw new TaskFailureError(task.id, change, attempts, logFile);
}

async function runChange(change: string) {
  const tasksPath = join(repo, "openspec", "changes", change, "tasks.md");
  if (!existsSync(tasksPath)) throw new Fatal(`${tasksPath} not found; create the change with /opsx:propose first`);
  const skipped = new Set<string>();
  const perSection = commitsPerSection(readTasks(tasksPath));
  say(`=== ${change} === (${perSection ? "one commit per section" : "commit at tasks that name a type"})`);

  for (;;) {
    const task = readTasks(tasksPath).find((t) => !t.done && !skipped.has(t.id));
    if (!task) {
      if (config.autoDiagrams) {
        say(`🔄 Synchronizing diagrams for completed change: ${change}...`);
        const diagResult = await syncDiagrams({
          cwd: repo,
          graphifyCommand: config.graphifyCommand,
          archifyBin: config.archifyBin,
          archifyAction: config.archifyAction,
          archifyQuality: config.archifyQuality,
          timeoutMs: CONSTANTS.DIAGRAM_SYNC_TIMEOUT_MS,
          hooks: { say, log },
        });
        if (diagResult.success) {
          say(`✅ Diagrams synchronized for ${change}`);
        } else {
          say(`⚠️ Diagram synchronization encountered warnings or failures for ${change}`);
        }
      }
      return [...skipped];
    }
    if (CONSTANTS.HUMAN_TASK_REGEX.test(task.text)) {
      skipped.add(task.id);
      say(`  skipping ${task.id} (human task): ${task.text.slice(0, CONSTANTS.TASK_SUMMARY_MAX_LENGTH)}`);
      continue;
    }
    say(`▶ ${change} ${task.id}: ${task.text.slice(0, CONSTANTS.TASK_SUMMARY_MAX_LENGTH)}`);
    log("task_start", { change, id: task.id });
    try {
      await runTask(change, tasksPath, task, perSection && isLastOfSection(readTasks(tasksPath), task));
    } catch (error) {
      if (error instanceof TaskFailureError && config.resilient) {
        skipped.add(task.id);
        say(`  ⚠️ Resilient 24/7 mode: task ${task.id} failed after ${error.attempts} attempts and was rolled back; continuing.`);
        log("task_failure_resilient", { change, taskId: task.id, attempts: error.attempts, error: error.message });
        continue;
      }
      throw error;
    }
  }
}

// ---------- entry point ----------

async function preflight() {
  if (!changes.length) throw new Fatal("Pass --changes a,b,c in cascade order");
  const branch = (await sh(["git", "branch", "--show-current"])).output;
  if (config.protectedBranches.includes(branch)) throw new Fatal(`Refusing to run on protected branch "${branch}"`);
  const dirty = (await sh(["git", "status", "--porcelain"])).output
    .split("\n")
    .filter((l) => l && !config.neverCommit.some((p) => l.slice(CONSTANTS.GIT_STATUS_PREFIX_LENGTH).startsWith(p)));
  if (dirty.length) {
    const warning = `Working tree is dirty (these files would land in the first commit):\n${dirty.join("\n")}`;
    if (!config.allowDirty && !config.dryRun) throw new Fatal(`${warning}\nClean it or pass --allow-dirty.`);
    say(warning);
  }
  const keepAliveStatus = keepAliveController ? `keepAlive=${keepAliveController.mechanism} ` : "";
  say(`engine=${engine} ${keepAliveStatus}repo=${repo} branch=${branch} changes=${changes.join(" → ")} log=${logFile}`);
}

function printPlan() {
  for (const change of changes) {
    const tasksPath = join(repo, "openspec", "changes", change, "tasks.md");
    if (!existsSync(tasksPath)) {
      console.log(`\n${change}: MISSING (create it with /opsx:propose)`);
      continue;
    }
    const tasks = readTasks(tasksPath);
    const pending = tasks.filter((t) => !t.done);
    const perSection = commitsPerSection(tasks);
    console.log(`\n${change}: ${pending.length} pending${perSection ? " (one commit per section)" : ""}`);
    for (const task of pending) {
      const flags = [
        CONSTANTS.HUMAN_TASK_REGEX.test(task.text) ? "HUMAN-SKIP" : "",
        commitTypeOf(task) ? `commit=${commitTypeOf(task)}` : perSection && isLastOfSection(tasks, task) ? "commit=agent" : "",
        verifyCommands(task, config.fullGate).length ? `verify=[${verifyCommands(task, config.fullGate).join(" | ")}]` : "",
      ].filter(Boolean);
      console.log(`  ${task.id} ${flags.join(" ")}`);
    }
  }
}

async function main() {
  keepAliveController = startKeepAlive({ enabled: config.keepAlive });
  log("keep_alive", { active: keepAliveController.active, mechanism: keepAliveController.mechanism });
  try {
    await preflight();
    if (config.dryRun) {
      printPlan();
      const meters = await readUsage();
      console.log("\nusage:", meters ?? "unavailable (API key or token without user:profile scope)");
      return;
    }
    const report: string[] = [];
    for (const change of changes) {
      const skipped = await runChange(change);
      report.push(`${change}: done${skipped.length ? `, human tasks pending: ${skipped.join(", ")}` : ""}`);
    }
    say(`Cascade finished. Estimated cost $${totalCostUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)}\n${report.join("\n")}`);
  } finally {
    keepAliveController.stop();
  }
}

if (import.meta.main) main().catch((error) => {
  keepAliveController?.stop();
  say(error instanceof Fatal ? `STOPPED: ${error.message}` : `CRASHED: ${error?.stack ?? error}`);
  process.exit(error instanceof Fatal ? CONSTANTS.EXIT_CODE_FATAL : CONSTANTS.EXIT_CODE_ERROR);
});
