/**
 * Claude Agent SDK engine adapter for the cascade.
 *
 * Implements EngineAdapter using @anthropic-ai/claude-agent-sdk.
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { CONSTANTS } from "./config";
import type {
  EngineAdapter,
  EngineOutcome,
  EngineSessionOptions,
  UsageMeter,
} from "./engine";

export function toEpochMs(value: number): number {
  return value < CONSTANTS.EPOCH_MS_THRESHOLD ? value * CONSTANTS.MS_PER_SECOND : value;
}

export function claudeAgentOptions(
  options: EngineSessionOptions,
  abortController: AbortController,
): Options {
  const config = options.config;
  const effort =
    options.effort ??
    config?.effort ??
    CONSTANTS.DEFAULT_EFFORT;

  return {
    cwd: options.cwd,
    resume: options.resume,
    abortController,
    settingSources: [
      ...(options.settingSources ?? config?.settingSources ?? CONSTANTS.SETTING_SOURCES),
    ] as Options["settingSources"],
    permissionMode: "dontAsk",
    allowedTools: [
      ...(options.allowedTools ?? config?.allowedTools ?? CONSTANTS.ALLOWED_TOOLS),
    ] as Options["allowedTools"],
    disallowedTools: [
      ...(options.deniedBash ?? config?.deniedBash ?? CONSTANTS.DENIED_BASH),
    ],
    maxTurns: options.maxTurns ?? config?.maxTurnsPerSession ?? CONSTANTS.MAX_TURNS_PER_SESSION,
    maxBudgetUsd: options.maxBudgetUsd ?? config?.maxBudgetPerSessionUsd ?? CONSTANTS.MAX_BUDGET_PER_SESSION_USD,
    effort: effort === "none" ? undefined : (effort as Options["effort"]),
    model: options.model ?? config?.model,
  };
}

export async function readClaudeUsage(cwd: string): Promise<UsageMeter[] | null> {
  try {
    for await (const message of query({
      prompt: "/usage",
      options: { cwd, settingSources: [], maxTurns: 1 },
    })) {
      if (message.type !== "assistant" || !message.usage_report) continue;
      const limits = message.usage_report.rate_limits?.limits;
      if (!limits) return null;
      return limits.map((l) => ({
        kind: l.kind,
        percent: l.percent,
        resetsAt: l.resets_at ? Date.parse(l.resets_at) : null,
      }));
    }
  } catch {
    return null;
  }
  return null;
}

export async function runClaudeSession(options: EngineSessionOptions): Promise<EngineOutcome> {
  const abortController = new AbortController();
  let sessionId = options.resume;
  let pausedUntil: number | undefined;
  let fatal: string | undefined;
  let result: { subtype: string; text?: string } | undefined;
  let costUsd = 0;
  let turns: number | undefined;

  const pause = (until: number) => {
    pausedUntil = until;
    abortController.abort();
  };

  const agentOpts = claudeAgentOptions(options, abortController);
  const resetMarginMs = options.config?.resetMarginMs ?? CONSTANTS.RESET_MARGIN_MS;
  const unknownResetSleepMs = options.config?.unknownResetSleepMs ?? CONSTANTS.UNKNOWN_RESET_SLEEP_MS;
  const usageLimitPercent = options.config?.usageLimitPercent ?? CONSTANTS.USAGE_LIMIT_PERCENT;

  try {
    for await (const message of query({ prompt: options.prompt, options: agentOpts })) {
      if ("session_id" in message && message.session_id) sessionId = message.session_id;
      if (message.type === "system" && message.subtype === "init" && message.model) {
        options.hooks.onModel?.(message.model);
        options.hooks.log("model", { model: message.model });
      }

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            options.hooks.onTool(block.name, block.input);
          }
          if (block.type === "text" && block.text.trim()) {
            options.hooks.onText(block.text);
          }
        }
      } else if (message.type === "rate_limit_event") {
        const info = message.rate_limit_info;
        options.hooks.log("rate_limit_event", info);
        const resetAt = info.resetsAt
          ? toEpochMs(info.resetsAt) + resetMarginMs
          : Date.now() + unknownResetSleepMs;
        if (info.errorCode === "credits_required") {
          fatal = "Plan usage exhausted and usage credits are required; waiting will not help.";
          abortController.abort();
        } else if (info.status === "rejected") {
          pause(resetAt);
        } else if (info.status === "allowed_warning") {
          const meters = await readClaudeUsage(options.cwd);
          const blocking = meters ? meters.filter((m) => m.percent >= usageLimitPercent) : [];
          if (blocking.length) {
            const resets = blocking.map((m) => m.resetsAt).filter((r): r is number => r !== null);
            pause(resets.length ? Math.max(...resets) + resetMarginMs : resetAt);
          }
        }
      } else if (message.type === "result") {
        costUsd = message.total_cost_usd ?? 0;
        turns = message.num_turns;
        result = { subtype: message.subtype, text: message.subtype === "success" ? message.result : undefined };
        options.hooks.log("result", { subtype: message.subtype, cost: costUsd, turns });
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted && !result) {
      return { kind: "error", sessionId, reason: String(error), costUsd, turns };
    }
  }

  if (fatal) return { kind: "fatal", reason: fatal, costUsd, turns };
  if (pausedUntil) return { kind: "paused", sessionId, resumeAt: pausedUntil, costUsd, turns };
  if (result?.subtype === "success") {
    return { kind: "done", sessionId, result: result.text ?? "", costUsd, turns, subtype: result.subtype };
  }
  return { kind: "error", sessionId, reason: result?.subtype ?? "unknown", costUsd, turns, subtype: result?.subtype };
}

export class ClaudeAdapter implements EngineAdapter {
  readonly name = "claude" as const;

  getDefaultModel(): string {
    return CONSTANTS.DEFAULT_CLAUDE_MODEL;
  }

  supportsPlanMeters(): boolean {
    return true;
  }

  async readUsage(cwd: string): Promise<UsageMeter[] | null> {
    return readClaudeUsage(cwd);
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    return runClaudeSession(options);
  }
}

export const claudeAdapter: ClaudeAdapter = new ClaudeAdapter();
