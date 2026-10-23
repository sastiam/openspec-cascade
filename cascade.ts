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
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { antigravityEffortArg, antigravityModelArg, runAntigravitySession } from "./antigravity";
import { openCodeModelArg, runOpenCodeSession } from "./opencode";
import { normalizePlatformPath, startKeepAlive, type KeepAliveController } from "./platform";

const USAGE_LIMIT_PERCENT = 95;
const RESET_MARGIN_MS = 2 * 60_000;
const UNKNOWN_RESET_SLEEP_MS = 30 * 60_000;
const MAX_ATTEMPTS_PER_TASK = 3;
const MAX_TURNS_PER_SESSION = 60;
const MAX_BUDGET_PER_SESSION_USD = 10;
const MAX_TOTAL_BUDGET_USD = 150;
const PROTECTED_BRANCHES = ["stable", "main", "master"];
const NEVER_COMMIT = [".atl", ".claude/settings.local.json"];
const HUMAN_TASK = /\bopen the PRs?\b|\bdecide the delivery\b|\bgit push\b/i;
const DEFAULT_VERIFY = ["bun test", "bun run lint"];
const TSC_SERVER = "bunx tsc --noEmit -p .nuxt/tsconfig.server.json";
const TSC_APP = "bunx tsc --noEmit -p .nuxt/tsconfig.app.json";
const FULL_VERIFY = ["bun test", "bun run lint", TSC_SERVER, TSC_APP, "bun run build", "bun run test:e2e"];
const NO_NEW_MIGRATION =
  'bun run db:generate || exit 1; if git status --porcelain --untracked-files=all | grep -q "migrations/"; then echo "db:generate produced a new migration"; exit 1; fi';
const CONVENTIONAL_TYPE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?$/;
const CONVENTIONAL_HEADER = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/;

/** Commands no engine may run; the harness owns git and migrations. */
const DENIED_BASH = [
  "Bash(git commit)", "Bash(git commit *)",
  "Bash(git push)", "Bash(git push *)",
  "Bash(git reset *)", "Bash(git checkout *)", "Bash(git switch *)",
  "Bash(git stash *)", "Bash(git rebase *)", "Bash(git clean *)",
  "Bash(bun run db:push)", "Bash(bun run db:push *)", "Bash(bun run db:migrate *)",
];

class Fatal extends Error {}

type Task = { id: string; done: boolean; text: string; section: string; line: number };
type UsageMeter = { kind: string; percent: number; resetsAt: number | null };
type SessionOutcome =
  | { kind: "done"; sessionId?: string; result: string }
  | { kind: "paused"; sessionId?: string; resumeAt: number }
  | { kind: "error"; sessionId?: string; reason: string }
  | { kind: "fatal"; reason: string };

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    changes: { type: "string" },
    "allow-dirty": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    // Every task that commits also runs FULL_VERIFY; use for dependency/toolchain changes.
    "full-gate": { type: "boolean", default: false },
    engine: { type: "string", default: "claude" },
    "no-keep-alive": { type: "boolean", default: false },
    "keep-alive": { type: "boolean" },
  },
});

export function isKeepAliveEnabled(options: { "no-keep-alive"?: boolean; "keep-alive"?: boolean }): boolean {
  if (options["no-keep-alive"]) return false;
  if (options["keep-alive"] === false) return false;
  return true;
}

export function resolveEngine(engineArg: string | undefined): "claude" | "opencode" | "antigravity" {
  const raw = (engineArg ?? "claude").toLowerCase();
  if (raw === "antigravity" || raw === "agy") return "antigravity";
  if (raw === "opencode") return "opencode";
  if (raw === "claude") return "claude";
  throw new Error(`--engine must be "claude", "opencode", or "antigravity" (or "agy"), got "${engineArg}"`);
}

let keepAliveController: KeepAliveController | undefined;

export function getKeepAliveController(): KeepAliveController | undefined {
  return keepAliveController;
}

const repo = normalizePlatformPath(args.repo ?? process.cwd());
const engine = resolveEngine(args.engine);
const changes = (args.changes ?? "").split(",").map((c) => c.trim()).filter(Boolean);
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

function oneLine(text: string, max = 140) {
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
  return typeof value === "string" ? oneLine(value, 100) : "";
}

async function sh(cmd: string | string[], timeoutMs = 30 * 60_000) {
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
      commands.add(TSC_SERVER);
      commands.add(TSC_APP);
      continue;
    }
    // "`bun run db:generate` produces no new migration" is an assertion, not just a command
    commands.add(command === "bun run db:generate" ? NO_NEW_MIGRATION : command);
  }
  if (gated) FULL_VERIFY.forEach((c) => commands.add(c));
  if (isFull && !commands.size) FULL_VERIFY.forEach((c) => commands.add(c));
  const prose = task.text.replace(/`[^`]*`/g, " ");
  if (/\blint\b/i.test(prose)) commands.add("bun run lint");
  if (/\bbuild\b/i.test(prose)) commands.add("bun run build");
  if (/\bboth\s+`?(?:bunx\s+)?tsc\b/i.test(task.text)) {
    commands.add(TSC_SERVER);
    commands.add(TSC_APP);
  }
  if (/\bE2E\b/.test(prose)) commands.add("bun run test:e2e");
  const list = commands.size ? [...commands] : DEFAULT_VERIFY;
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
    if (CONVENTIONAL_TYPE.test(type)) return type;
  }
  return undefined;
}

/**
 * Changes whose tasks never name a commit type commit once per section (after its last task), with a
 * header the agent proposes. Committing every task floods history with checkbox-only commits.
 */
export function commitsPerSection(tasks: Task[]) {
  return !tasks.some((t) => commitTypeOf(t));
}

export function isLastOfSection(tasks: Task[], task: Task) {
  return tasks.filter((t) => t.section === task.section).at(-1)?.id === task.id;
}

// ---------- usage guard ----------

function toEpochMs(value: number) {
  return value < 1e12 ? value * 1000 : value;
}

/** Reads plan meters from the structured `/usage` report; null when the session can't provide one (e.g. API key). */
async function readUsage(): Promise<UsageMeter[] | null> {
  if (engine !== "claude") return null; // OpenCode exposes no plan meters; rate-limit errors pause instead
  try {
    for await (const message of query({ prompt: "/usage", options: { cwd: repo, settingSources: [], maxTurns: 1 } })) {
      if (message.type !== "assistant" || !message.usage_report) continue;
      const limits = message.usage_report.rate_limits?.limits;
      if (!limits) return null;
      return limits.map((l) => ({ kind: l.kind, percent: l.percent, resetsAt: l.resets_at ? Date.parse(l.resets_at) : null }));
    }
  } catch (error) {
    log("usage_read_failed", { error: String(error) });
  }
  return null;
}

function blockingMeters(meters: UsageMeter[]) {
  return meters.filter((m) => m.percent >= USAGE_LIMIT_PERCENT);
}

async function sleepUntil(epochMs: number, reason: string) {
  const ms = Math.max(60_000, epochMs - Date.now());
  say(`Pausing ${Math.round(ms / 60_000)} min (${reason}); resuming around ${new Date(Date.now() + ms).toLocaleString()}`);
  await Bun.sleep(ms);
}

/** Blocks until every plan meter is under the limit. Returns immediately when usage is unreadable. */
async function waitForUsageHeadroom() {
  for (;;) {
    const meters = await readUsage();
    if (!meters) return;
    const blocking = blockingMeters(meters);
    if (!blocking.length) return;
    const resets = blocking.map((m) => m.resetsAt).filter((r): r is number => r !== null);
    const until = resets.length ? Math.max(...resets) + RESET_MARGIN_MS : Date.now() + UNKNOWN_RESET_SLEEP_MS;
    await sleepUntil(until, blocking.map((m) => `${m.kind} ${m.percent}%`).join(", "));
  }
}

// ---------- agent sessions ----------

function agentOptions(abortController: AbortController, resume?: string): Options {
  return {
    cwd: repo,
    resume,
    abortController,
    // Project CLAUDE.md, skills and settings only; user-level orchestration rules stay out of the loop.
    settingSources: ["project"],
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch", "TaskCreate", "TaskUpdate"],
    disallowedTools: DENIED_BASH,
    maxTurns: MAX_TURNS_PER_SESSION,
    maxBudgetUsd: MAX_BUDGET_PER_SESSION_USD,
    // CASCADE_EFFORT=none omits it for models without effort support
    effort: process.env.CASCADE_EFFORT === "none" ? undefined : ((process.env.CASCADE_EFFORT ?? "high") as Options["effort"]),
    model: process.env.CASCADE_MODEL,
  };
}

async function runSession(prompt: string, resume?: string): Promise<SessionOutcome> {
  if (engine === "antigravity") return runAntigravity(prompt, resume);
  return engine === "opencode" ? runOpenCode(prompt, resume) : runClaude(prompt, resume);
}

async function runAntigravity(prompt: string, resume?: string): Promise<SessionOutcome> {
  const model = antigravityModelArg(process.env.CASCADE_MODEL);
  const effort = antigravityEffortArg(process.env.CASCADE_EFFORT ?? "high");
  const displayModel = effort ? `${model} (effort: ${effort})` : model;
  if (displayModel !== announcedModel) {
    announcedModel = displayModel;
    say(`  model: ${displayModel} (antigravity)`);
  }
  const outcome = await runAntigravitySession({
    prompt,
    cwd: repo,
    resume,
    model,
    effort,
    hooks: {
      onTool: (name, input) => {
        const detail = describeToolInput(input);
        log("tool", { name, detail });
        progress(`🔧 ${name}${detail ? ` ${detail}` : ""}`);
      },
      onText: (text) => {
        log("text", { text: text.slice(0, 500) });
        progress(`💬 ${oneLine(text)}`);
      },
      log,
    },
  });
  totalCostUsd += outcome.costUsd;
  say(`  session ${outcome.kind}: $${outcome.costUsd.toFixed(2)} (cascade total $${totalCostUsd.toFixed(2)})`);
  return outcome;
}

async function runOpenCode(prompt: string, resume?: string): Promise<SessionOutcome> {
  const model = openCodeModelArg(process.env.CASCADE_MODEL, process.env.CASCADE_EFFORT ?? "high");
  if (model !== announcedModel) {
    announcedModel = model;
    say(`  model: ${model} (opencode)`);
  }
  const outcome = await runOpenCodeSession({
    prompt,
    cwd: repo,
    resume,
    model,
    deniedBash: DENIED_BASH,
    hooks: {
      onTool: (name, input) => {
        const detail = describeToolInput(input);
        log("tool", { name, detail });
        progress(`🔧 ${name}${detail ? ` ${detail}` : ""}`);
      },
      onText: (text) => {
        log("text", { text: text.slice(0, 500) });
        progress(`💬 ${oneLine(text)}`);
      },
      log,
    },
  });
  totalCostUsd += outcome.costUsd;
  say(`  session ${outcome.kind}: $${outcome.costUsd.toFixed(2)} (cascade total $${totalCostUsd.toFixed(2)})`);
  return outcome;
}

async function runClaude(prompt: string, resume?: string): Promise<SessionOutcome> {
  const abortController = new AbortController();
  let sessionId = resume;
  let pausedUntil: number | undefined;
  let fatal: string | undefined;
  let result: { subtype: string; text?: string } | undefined;

  const pause = (until: number) => {
    pausedUntil = until;
    abortController.abort();
  };

  try {
    for await (const message of query({ prompt, options: agentOptions(abortController, resume) })) {
      if ("session_id" in message && message.session_id) sessionId = message.session_id;
      if (message.type === "system" && message.subtype === "init" && message.model !== announcedModel) {
        announcedModel = message.model;
        say(`  model: ${message.model}`);
        log("model", { model: message.model });
      }

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            const detail = describeToolInput(block.input);
            log("tool", { name: block.name, detail });
            progress(`🔧 ${block.name}${detail ? ` ${detail}` : ""}`);
          }
          if (block.type === "text" && block.text.trim()) {
            log("text", { text: block.text.slice(0, 500) });
            progress(`💬 ${oneLine(block.text)}`);
          }
        }
      } else if (message.type === "rate_limit_event") {
        const info = message.rate_limit_info;
        log("rate_limit_event", info);
        const resetAt = info.resetsAt ? toEpochMs(info.resetsAt) + RESET_MARGIN_MS : Date.now() + UNKNOWN_RESET_SLEEP_MS;
        if (info.errorCode === "credits_required") {
          fatal = "Plan usage exhausted and usage credits are required; waiting will not help.";
          abortController.abort();
        } else if (info.status === "rejected") {
          pause(resetAt);
        } else if (info.status === "allowed_warning") {
          const meters = await readUsage();
          const blocking = meters ? blockingMeters(meters) : [];
          if (blocking.length) {
            const resets = blocking.map((m) => m.resetsAt).filter((r): r is number => r !== null);
            pause(resets.length ? Math.max(...resets) + RESET_MARGIN_MS : resetAt);
          }
        }
      } else if (message.type === "result") {
        totalCostUsd += message.total_cost_usd ?? 0;
        result = { subtype: message.subtype, text: message.subtype === "success" ? message.result : undefined };
        log("result", { subtype: message.subtype, cost: message.total_cost_usd, turns: message.num_turns });
        say(
          `  session ${message.subtype}: ${message.num_turns} turns, $${(message.total_cost_usd ?? 0).toFixed(2)} ` +
            `(cascade total $${totalCostUsd.toFixed(2)})`,
        );
      }
    }
  } catch (error) {
    // query() throws after yielding an error result, and on abort; both are classified below.
    if (!abortController.signal.aborted && !result) return { kind: "error", sessionId, reason: String(error) };
  }

  if (fatal) return { kind: "fatal", reason: fatal };
  if (pausedUntil) return { kind: "paused", sessionId, resumeAt: pausedUntil };
  if (result?.subtype === "success") return { kind: "done", sessionId, result: result.text ?? "" };
  return { kind: "error", sessionId, reason: result?.subtype ?? "unknown" };
}

function taskPrompt(change: string, task: Task, verify: string[], sectionCommit: boolean) {
  return [
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
  ].join("\n");
}

async function runChecks(commands: string[]) {
  const failures: string[] = [];
  for (const command of commands) {
    say(`  check: ${command}`);
    const { code, output } = await sh(command);
    log("check", { command, code });
    say(`  ${code === 0 ? "✅" : "❌"} ${command}`);
    if (code !== 0) {
      console.log(output.split("\n").slice(-15).join("\n"));
      failures.push(`$ ${command} (exit ${code})\n${output.slice(-3000)}`);
      break; // later checks usually fail for the same reason; keep feedback focused
    }
  }
  return failures;
}

async function commit(message: string) {
  const excludes = NEVER_COMMIT.map((p) => `:!${p}`);
  await sh(["git", "add", "-A", "--", ".", ...excludes]);
  if ((await sh(["git", "diff", "--cached", "--quiet"])).code === 0) {
    say("  nothing to commit");
    return;
  }
  const { code, output } = await sh(["git", "commit", "-m", message]);
  if (code !== 0) throw new Fatal(`git commit failed:\n${output.slice(-2000)}`);
  const sha = (await sh(["git", "rev-parse", "--short", "HEAD"])).output;
  say(`  committed ${sha} ${message}`);
  log("commit", { sha, message });
}

async function runTask(change: string, tasksPath: string, task: Task, sectionCommit: boolean) {
  const verify = verifyCommands(task, args["full-gate"]);
  const commitType = commitTypeOf(task);
  let prompt = taskPrompt(change, task, verify, sectionCommit);
  let sessionId: string | undefined;
  // The first successful session describes the task; retry sessions only describe their fix.
  let subject: string | undefined;
  let header: string | undefined;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS_PER_TASK) {
    if (totalCostUsd >= MAX_TOTAL_BUDGET_USD) throw new Fatal(`Total budget of $${MAX_TOTAL_BUDGET_USD} reached`);
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
      say(`  session ended with ${outcome.reason} (attempt ${attempts}/${MAX_ATTEMPTS_PER_TASK})`);
      prompt = `The previous session stopped with "${outcome.reason}". Continue task ${task.id} from the current working tree.`;
      continue;
    }

    subject ??= outcome.result.match(/^COMMIT_SUBJECT:\s*(.+)$/m)?.[1]?.trim();
    header ??= outcome.result.match(/^COMMIT_MESSAGE:\s*(.+)$/m)?.[1]?.trim();
    const blocked = blockedReason(outcome.result);
    if (blocked) throw new Fatal(`Task ${task.id} needs a human decision: ${blocked}`);

    if (verify.length) {
      const failures = await runChecks(verify);
      if (failures.length) {
        say(`  checks failed (attempt ${attempts}/${MAX_ATTEMPTS_PER_TASK})`);
        prompt = `Task ${task.id} is not done; this check fails:\n\n${failures.join("\n\n")}\n\nFix it and finish the task.`;
        continue;
      }
      markDone(tasksPath, task.id); // the checks are the oracle
    } else if (!readTasks(tasksPath).find((t) => t.id === task.id)?.done) {
      prompt = `Task ${task.id} is still unchecked in tasks.md. Finish it and mark it, or reply with "BLOCKED: <reason>".`;
      continue;
    }

    if (commitType) {
      const description = subject ?? task.section.replace(/^\d+\.\s*/, "");
      await commit(`${commitType}: ${description}`.slice(0, 100));
    } else if (sectionCommit) {
      const fallback = `chore(${change}): ${task.section.replace(/^\d+\.\s*/, "").toLowerCase()}`;
      await commit((header && CONVENTIONAL_HEADER.test(header) ? header : fallback).slice(0, 100));
    }
    return;
  }
  throw new Fatal(`Task ${task.id} of ${change} failed after ${MAX_ATTEMPTS_PER_TASK} attempts; see ${logFile}`);
}

async function runChange(change: string) {
  const tasksPath = join(repo, "openspec", "changes", change, "tasks.md");
  if (!existsSync(tasksPath)) throw new Fatal(`${tasksPath} not found; create the change with /opsx:propose first`);
  const skipped = new Set<string>();
  const perSection = commitsPerSection(readTasks(tasksPath));
  say(`=== ${change} === (${perSection ? "one commit per section" : "commit at tasks that name a type"})`);

  for (;;) {
    const task = readTasks(tasksPath).find((t) => !t.done && !skipped.has(t.id));
    if (!task) return [...skipped];
    if (HUMAN_TASK.test(task.text)) {
      skipped.add(task.id);
      say(`  skipping ${task.id} (human task): ${task.text.slice(0, 80)}`);
      continue;
    }
    say(`▶ ${change} ${task.id}: ${task.text.slice(0, 100)}`);
    log("task_start", { change, id: task.id });
    await runTask(change, tasksPath, task, perSection && isLastOfSection(readTasks(tasksPath), task));
  }
}

// ---------- entry point ----------

async function preflight() {
  if (!changes.length) throw new Fatal("Pass --changes a,b,c in cascade order");
  const branch = (await sh(["git", "branch", "--show-current"])).output;
  if (PROTECTED_BRANCHES.includes(branch)) throw new Fatal(`Refusing to run on protected branch "${branch}"`);
  const dirty = (await sh(["git", "status", "--porcelain"])).output
    .split("\n")
    .filter((l) => l && !NEVER_COMMIT.some((p) => l.slice(3).startsWith(p)));
  if (dirty.length) {
    const warning = `Working tree is dirty (these files would land in the first commit):\n${dirty.join("\n")}`;
    if (!args["allow-dirty"] && !args["dry-run"]) throw new Fatal(`${warning}\nClean it or pass --allow-dirty.`);
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
        HUMAN_TASK.test(task.text) ? "HUMAN-SKIP" : "",
        commitTypeOf(task) ? `commit=${commitTypeOf(task)}` : perSection && isLastOfSection(tasks, task) ? "commit=agent" : "",
        verifyCommands(task, args["full-gate"]).length ? `verify=[${verifyCommands(task, args["full-gate"]).join(" | ")}]` : "",
      ].filter(Boolean);
      console.log(`  ${task.id} ${flags.join(" ")}`);
    }
  }
}

async function main() {
  const keepAliveEnabled = isKeepAliveEnabled(args);
  keepAliveController = startKeepAlive({ enabled: keepAliveEnabled });
  log("keep_alive", { active: keepAliveController.active, mechanism: keepAliveController.mechanism });
  try {
    await preflight();
    if (args["dry-run"]) {
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
    say(`Cascade finished. Estimated cost $${totalCostUsd.toFixed(2)}\n${report.join("\n")}`);
  } finally {
    keepAliveController.stop();
  }
}

if (import.meta.main) main().catch((error) => {
  keepAliveController?.stop();
  say(error instanceof Fatal ? `STOPPED: ${error.message}` : `CRASHED: ${error?.stack ?? error}`);
  process.exit(error instanceof Fatal ? 2 : 1);
});
