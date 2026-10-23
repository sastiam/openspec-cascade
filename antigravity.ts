/**
 * Antigravity CLI engine for the cascade: one `agy -p ... --output-format stream-json` process per session.
 *
 * Consumes stream-json NDJSON events emitted by `agy`:
 * - `init`: captures conversation_id.
 * - `step_update`: captures live text deltas and tool invocations.
 * - `result`: captures final response, execution status, and token usage.
 */

export const ANTIGRAVITY_DEFAULT_MODEL = "gemini-3.8-flash-high";
const SESSION_TIMEOUT_MS = 45 * 60_000;
const RATE_LIMIT_SLEEP_MS = 30 * 60_000;
const RATE_LIMIT = /rate.?limit|\b429\b|quota|usage limit|too many requests|resource_exhausted/i;
// Waiting or retrying never fixes these: stop the cascade
const UNRECOVERABLE = /unauthorized|authentication failed|invalid credential|"status":\s*(401|403)\b|model not found|no such file or directory.*agy/i;

export type AntigravityOutcome =
  | { kind: "done"; sessionId?: string; result: string; costUsd: number }
  | { kind: "paused"; sessionId?: string; resumeAt: number; costUsd: number }
  | { kind: "error"; sessionId?: string; reason: string; costUsd: number }
  | { kind: "fatal"; reason: string; costUsd: number };

export type Hooks = {
  onTool: (name: string, input: unknown) => void;
  onText: (text: string) => void;
  log: (event: string, data: Record<string, unknown>) => void;
};

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
    const inputCost = (usage.inputTokens / 1_000_000) * 0.15;
    const outputCost = (usage.outputTokens / 1_000_000) * 0.60;
    return inputCost + outputCost;
  }
  if (model.includes("argon") || model.includes("pro")) {
    const inputCost = (usage.inputTokens / 1_000_000) * 1.25;
    const outputCost = (usage.outputTokens / 1_000_000) * 5.00;
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
) {
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
    timeout: SESSION_TIMEOUT_MS,
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
    stderr: errText.slice(-500),
  });

  const failure = state.error ?? (code !== 0 ? `exit ${code}: ${errText.slice(-300)}` : undefined);
  const kind = failure ? classifyFailure(failure) : undefined;
  if (kind === "fatal") return { kind, reason: `Antigravity: ${failure}`, costUsd: state.costUsd };
  if (kind === "paused") {
    return { kind, sessionId: state.sessionId, resumeAt: Date.now() + RATE_LIMIT_SLEEP_MS, costUsd: state.costUsd };
  }
  if (kind === "error") return { kind, sessionId: state.sessionId, reason: failure!, costUsd: state.costUsd };

  const result = state.texts.join("").trim();
  return { kind: "done", sessionId: state.sessionId, result, costUsd: state.costUsd };
}
