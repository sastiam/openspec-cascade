/**
 * Antigravity CLI engine for the cascade: one `agy -p ... --output-format stream-json` process per session.
 *
 * Consumes stream-json NDJSON events emitted by `agy`:
 * - `init`: captures conversation_id.
 * - `step_update`: captures live text deltas and tool invocations.
 * - `result`: captures final response, execution status, and token usage.
 */

import { CONSTANTS } from "./config";
import type {
  EngineAdapter,
  EngineHooks,
  EngineOutcome,
  EngineSessionOptions,
} from "./engine";

export const ANTIGRAVITY_DEFAULT_MODEL = CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL;
const SESSION_TIMEOUT_MS = CONSTANTS.ANTIGRAVITY_SESSION_TIMEOUT_MS;
const RATE_LIMIT_SLEEP_MS = CONSTANTS.RATE_LIMIT_SLEEP_MS;
const RATE_LIMIT = /rate.?limit|\b429\b|quota|usage limit|too many requests|resource_exhausted/i;
// Waiting or retrying never fixes these: stop the cascade
const UNRECOVERABLE = /unauthorized|authentication failed|invalid credential|"status":\s*(401|403)\b|model not found|no such file or directory.*agy/i;

export type AntigravityOutcome = EngineOutcome;

export type Hooks = EngineHooks;

export type AntigravityTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};

export type SessionState = {
  sessionId?: string;
  texts: string[];
  tokens: AntigravityTokenUsage;
  costUsd: number;
  error?: string;
  resultReceived?: boolean;
};

/** Selects the Antigravity model name or falls back to the default. */
export function antigravityModelArg(model: string | undefined): string {
  return model?.trim() ? model.trim() : ANTIGRAVITY_DEFAULT_MODEL;
}

/** Formats reasoning effort argument if provided and not 'none'. */
export function antigravityEffortArg(effort: string | undefined): string | undefined {
  if (!effort || effort === "none") return undefined;
  return effort;
}

/** Builds argv for spawning `agy`. */
export function buildAntigravityArgs(options: {
  prompt: string;
  model: string;
  effort?: string;
  resume?: string;
}): string[] {
  const argv = [
    "agy",
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
    "--model",
    options.model,
  ];
  if (options.effort) {
    argv.push("--effort", options.effort);
  }
  if (options.resume) {
    argv.push("--conversation", options.resume);
  }
  return argv;
}

/** Estimates USD cost from Gemini token usage. */
export function estimateCostUsd(model: string, usage: AntigravityTokenUsage): number {
  if (model.includes("flash")) {
    const inputCost = (usage.inputTokens / CONSTANTS.TOKEN_PRICE_BASE) * CONSTANTS.GEMINI_FLASH_INPUT_COST;
    const outputCost = (usage.outputTokens / CONSTANTS.TOKEN_PRICE_BASE) * CONSTANTS.GEMINI_FLASH_OUTPUT_COST;
    return inputCost + outputCost;
  }
  if (model.includes("argon") || model.includes("pro")) {
    const inputCost = (usage.inputTokens / CONSTANTS.TOKEN_PRICE_BASE) * CONSTANTS.GEMINI_PRO_INPUT_COST;
    const outputCost = (usage.outputTokens / CONSTANTS.TOKEN_PRICE_BASE) * CONSTANTS.GEMINI_PRO_OUTPUT_COST;
    return inputCost + outputCost;
  }
  return 0;
}

function updateUsage(state: SessionState, raw: Record<string, any>) {
  state.tokens = {
    inputTokens: raw.input_tokens ?? state.tokens.inputTokens,
    outputTokens: raw.output_tokens ?? state.tokens.outputTokens,
    thinkingTokens: raw.thinking_tokens ?? state.tokens.thinkingTokens,
    cacheReadTokens: raw.cache_read_tokens ?? state.tokens.cacheReadTokens,
    totalTokens: raw.total_tokens ?? state.tokens.totalTokens,
  };
}

/** Folds one JSON line from `agy -p ... --output-format stream-json` into the session state. */
export function reduceAntigravityEvent(
  state: SessionState,
  line: string,
  hooks: Pick<Hooks, "onTool" | "onText">,
): void {
  let event: Record<string, any>;
  try {
    event = JSON.parse(line);
  } catch {
    return; // non-JSON noise (banners, warnings)
  }

  if (event.conversation_id && !state.sessionId) {
    state.sessionId = event.conversation_id;
  }

  if (event.event === "init") {
    state.sessionId ??= event.conversation_id;
    return;
  }

  if (event.event === "step_update" && event.step_update) {
    const update = event.step_update;
    state.sessionId ??= update.conversation_id;

    if (update.step_type === "tool" && update.state === "ACTIVE") {
      const toolName = update.tool_name ?? update.tool_info?.name ?? "tool";
      const toolInput = update.tool_info?.parameters ?? update.tool_info?.input;
      hooks.onTool(toolName, toolInput);
    } else if (update.step_type === "agent_response" && typeof update.text_delta === "string" && update.text_delta) {
      state.texts.push(update.text_delta);
      hooks.onText(update.text_delta);
    }

    if (update.usage) {
      updateUsage(state, update.usage);
    }
    return;
  }

  if (event.event === "result" && event.result) {
    const res = event.result;
    state.sessionId ??= res.conversation_id;
    state.resultReceived = true;

    if (res.status && res.status !== "SUCCESS") {
      state.error = res.error ?? res.response ?? `Result status: ${res.status}`;
    }
    if (typeof res.response === "string" && res.response) {
      if (state.texts.length === 0) {
        state.texts.push(res.response);
      }
    }
    if (res.usage) {
      updateUsage(state, res.usage);
    }
    return;
  }

  if (event.type === "error" || event.error) {
    state.error = typeof event.error === "string" ? event.error : JSON.stringify(event.error ?? event);
  }
}

export function classifyFailure(failure: string): "fatal" | "paused" | "error" {
  if (UNRECOVERABLE.test(failure)) return "fatal";
  return RATE_LIMIT.test(failure) ? "paused" : "error";
}

export async function runAntigravitySession(options: {
  prompt: string;
  cwd: string;
  resume?: string;
  model: string;
  effort?: string;
  hooks: Hooks;
  timeoutMs?: number;
}): Promise<AntigravityOutcome> {
  const argv = buildAntigravityArgs({
    prompt: options.prompt,
    model: options.model,
    effort: options.effort,
    resume: options.resume,
  });

  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutMs ?? SESSION_TIMEOUT_MS,
  });

  const state: SessionState = {
    sessionId: options.resume,
    texts: [],
    tokens: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, totalTokens: 0 },
    costUsd: 0,
  };

  const stderr = new Response(proc.stderr).text();
  let buffer = "";
  for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
    buffer += new TextDecoder().decode(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) reduceAntigravityEvent(state, line, options.hooks);
  }
  if (buffer) reduceAntigravityEvent(state, buffer, options.hooks);

  state.costUsd = estimateCostUsd(options.model, state.tokens);

  const code = await proc.exited;
  const errText = (await stderr).trim();
  options.hooks.log("antigravity_exit", {
    code,
    tokens: state.tokens,
    cost: state.costUsd,
    error: state.error,
    stderr: errText.slice(-CONSTANTS.STDERR_TAIL_MAX_LENGTH),
  });

  const failure = state.error ?? (code !== CONSTANTS.EXIT_CODE_SUCCESS ? `exit ${code}: ${errText.slice(-CONSTANTS.ERROR_DETAIL_MAX_LENGTH)}` : undefined);
  const kind = failure ? classifyFailure(failure) : undefined;
  if (kind === "fatal") return { kind, reason: `Antigravity: ${failure}`, costUsd: state.costUsd };
  if (kind === "paused") {
    return { kind, sessionId: state.sessionId, resumeAt: Date.now() + RATE_LIMIT_SLEEP_MS, costUsd: state.costUsd };
  }
  if (kind === "error") return { kind, sessionId: state.sessionId, reason: failure!, costUsd: state.costUsd };

  const result = state.texts.join("").trim();
  return { kind: "done", sessionId: state.sessionId, result, costUsd: state.costUsd };
}

/**
 * Adapter implementing EngineAdapter for Antigravity CLI runner.
 */
export class AntigravityAdapter implements EngineAdapter {
  readonly name = "antigravity" as const;

  getDefaultModel(): string {
    return antigravityModelArg(undefined);
  }

  supportsPlanMeters(): boolean {
    return false;
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    const model = antigravityModelArg(options.model);
    const effort = antigravityEffortArg(options.effort);
    return runAntigravitySession({
      prompt: options.prompt,
      cwd: options.cwd,
      resume: options.resume,
      model,
      effort,
      hooks: options.hooks,
      timeoutMs: options.config?.engineSessionTimeoutMs,
    });
  }
}

export const antigravityAdapter: AntigravityAdapter = new AntigravityAdapter();
