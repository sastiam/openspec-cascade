/**
 * Antigravity CLI engine for the cascade: one `agy -p ... --output-format stream-json` process per session.
 *
 * Consumes stream-json NDJSON events emitted by `agy`:
 * - `init`: captures conversation_id.
 * - `step_update`: captures live text deltas and tool invocations.
 * - `result`: captures final response, execution status, and token usage.
 */

import { CONSTANTS } from "./config";
import { classifyEngineFailure, toCliSessionOutcome, type EngineFailureKind, type EngineFailurePatterns } from "./src/pal/shared";
import { getDefaultSpawner } from "./src/runtime/spawner";
import { forEachStreamLine } from "./src/runtime/streams";
import type { ISpawner } from "./src/runtime/types";
import type {
  EngineAdapter,
  EngineHooks,
  EngineOutcome,
  EngineSessionOptions,
} from "./src/engine/contract";

export const ANTIGRAVITY_DEFAULT_MODEL = CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL;
const SESSION_TIMEOUT_MS = CONSTANTS.ANTIGRAVITY_SESSION_TIMEOUT_MS;
const RATE_LIMIT_SLEEP_MS = CONSTANTS.RATE_LIMIT_SLEEP_MS;
const RATE_LIMIT = /rate.?limit|\b429\b|quota|usage limit|too many requests|resource_exhausted/i;
/** Waiting or retrying never fixes auth/model/missing-binary errors; stop the cascade immediately. */
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

interface RawAntigravityUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

interface RawAntigravityStepUpdate {
  conversation_id?: string;
  step_type?: string;
  state?: string;
  tool_name?: string;
  tool_info?: { name?: string };
  text_delta?: string;
  usage?: RawAntigravityUsage;
}

interface RawAntigravityResult {
  conversation_id?: string;
  status?: string;
  error?: string;
  response?: string;
  usage?: RawAntigravityUsage;
}

interface RawAntigravityEvent {
  conversation_id?: string;
  event?: string;
  type?: string;
  error?: unknown;
  step_update?: RawAntigravityStepUpdate;
  result?: RawAntigravityResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function updateUsage(state: SessionState, raw: RawAntigravityUsage): void {
  state.tokens = {
    inputTokens: typeof raw.input_tokens === "number" ? raw.input_tokens : state.tokens.inputTokens,
    outputTokens: typeof raw.output_tokens === "number" ? raw.output_tokens : state.tokens.outputTokens,
    thinkingTokens: typeof raw.thinking_tokens === "number" ? raw.thinking_tokens : state.tokens.thinkingTokens,
    cacheReadTokens: typeof raw.cache_read_tokens === "number" ? raw.cache_read_tokens : state.tokens.cacheReadTokens,
    totalTokens: typeof raw.total_tokens === "number" ? raw.total_tokens : state.tokens.totalTokens,
  };
}

/** Flattens whitespace and truncates string to max characters with ellipsis. */
export function oneLine(text: string, max: number = CONSTANTS.ONE_LINE_MAX_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function extractCommandDescription(fields: Record<string, unknown>): string | undefined {
  const cmd = fields.cmd ?? fields.command ?? fields.CommandLine;
  const args = fields.args;
  let argsStr: string | undefined;
  if (Array.isArray(args)) {
    argsStr = args.map(String).join(" ");
  } else if (typeof args === "string" && args.trim()) {
    argsStr = args.trim();
  }

  if (typeof cmd === "string" && cmd.trim()) {
    const full = argsStr ? `${cmd.trim()} ${argsStr}` : cmd.trim();
    return oneLine(full, CONSTANTS.TOOL_INPUT_MAX_LENGTH);
  }
  if (argsStr) {
    return oneLine(argsStr, CONSTANTS.TOOL_INPUT_MAX_LENGTH);
  }
  return undefined;
}

function extractPathDescription(fields: Record<string, unknown>): string | undefined {
  const path = fields.path ?? fields.file_path ?? fields.Path;
  if (typeof path === "string" && path.trim()) {
    return oneLine(path.trim(), CONSTANTS.TOOL_INPUT_MAX_LENGTH);
  }
  return undefined;
}

function extractFallbackDescription(fields: Record<string, unknown>): string {
  const value = fields.pattern ?? fields.url ?? fields.query ?? fields.description;
  return typeof value === "string" ? oneLine(value, CONSTANTS.TOOL_INPUT_MAX_LENGTH) : "";
}

/**
 * Formats tool input payload into a concise single-line description for progress display and logs.
 * Supports path, cmd, command, CommandLine, args, file_path, Path, pattern, url, query, and description.
 */
export function describeToolInput(input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") {
    return oneLine(input, CONSTANTS.TOOL_INPUT_MAX_LENGTH);
  }
  if (Array.isArray(input)) {
    return oneLine(input.map(String).join(" "), CONSTANTS.TOOL_INPUT_MAX_LENGTH);
  }
  if (!isRecord(input)) return "";

  return (
    extractCommandDescription(input) ??
    extractPathDescription(input) ??
    extractFallbackDescription(input)
  );
}

/**
 * Normalizes and enriches tool parameter payload from `tool_info`
 * (handling parameters, input, args, or direct properties),
 * populating common fields such as `path`, `cmd`, and `args`.
 */
export function formatToolInput(toolInfo: unknown): Record<string, unknown> | undefined {
  if (!toolInfo || typeof toolInfo !== "object") return undefined;
  const info = toolInfo as Record<string, unknown>;
  const raw = info.parameters ?? info.input ?? info.args ?? toolInfo;
  if (!raw || typeof raw !== "object") return undefined;

  const params = raw as Record<string, unknown>;
  const enriched: Record<string, unknown> = { ...params };

  const path = params.path ?? params.Path ?? params.file_path ?? info.path;
  if (path !== undefined) {
    enriched.path = path;
  }

  const cmd = params.cmd ?? params.command ?? params.CommandLine ?? info.cmd;
  if (cmd !== undefined) {
    enriched.cmd = cmd;
  }

  const args = params.args ?? info.args;
  if (args !== undefined) {
    enriched.args = args;
  }

  return enriched;
}

/** Folds one JSON line from `agy -p ... --output-format stream-json` into the session state. */
export function reduceAntigravityEvent(
  state: SessionState,
  line: string,
  hooks: Pick<Hooks, "onTool" | "onText">,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const event = parsed as RawAntigravityEvent;

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
      const toolInput = formatToolInput(update.tool_info ?? update);
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

const FAILURE_PATTERNS: EngineFailurePatterns = { rateLimit: RATE_LIMIT, unrecoverable: UNRECOVERABLE };

export function classifyFailure(failure: string): EngineFailureKind {
  return classifyEngineFailure(failure, FAILURE_PATTERNS);
}

export async function runAntigravitySession(options: {
  prompt: string;
  cwd: string;
  resume?: string;
  model: string;
  effort?: string;
  hooks: Hooks;
  timeoutMs?: number;
  spawner?: ISpawner;
}): Promise<AntigravityOutcome> {
  const argv = buildAntigravityArgs({
    prompt: options.prompt,
    model: options.model,
    effort: options.effort,
    resume: options.resume,
  });

  const proc = (options.spawner ?? getDefaultSpawner()).spawn(argv, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? SESSION_TIMEOUT_MS,
  });

  const state: SessionState = {
    sessionId: options.resume,
    texts: [],
    tokens: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, totalTokens: 0 },
    costUsd: 0,
  };

  const stderr = new Response(proc.stderr).text();
  await forEachStreamLine(proc.stdout, (line) => reduceAntigravityEvent(state, line, options.hooks));

  state.costUsd = estimateCostUsd(options.model, state.tokens);

  const code = await proc.exitCode;
  const errText = (await stderr).trim();
  options.hooks.log("antigravity_exit", {
    code,
    tokens: state.tokens,
    cost: state.costUsd,
    error: state.error,
    stderr: errText.slice(-CONSTANTS.STDERR_TAIL_MAX_LENGTH),
  });

  const failure = state.error ?? (code !== CONSTANTS.EXIT_CODE_SUCCESS ? `exit ${code}: ${errText.slice(-CONSTANTS.ERROR_DETAIL_MAX_LENGTH)}` : undefined);
  return toCliSessionOutcome({
    engineLabel: "Antigravity",
    failure,
    patterns: FAILURE_PATTERNS,
    sessionId: state.sessionId,
    costUsd: state.costUsd,
    result: state.texts.join("").trim(),
    rateLimitSleepMs: RATE_LIMIT_SLEEP_MS,
  });
}

/**
 * Adapter implementing EngineAdapter for Antigravity CLI runner.
 */
export interface AntigravityAdapterOptions {
  readonly spawner?: ISpawner;
}

export class AntigravityAdapter implements EngineAdapter {
  readonly name = "antigravity" as const;
  private readonly spawner?: ISpawner;

  constructor(options: AntigravityAdapterOptions = {}) {
    this.spawner = options.spawner;
  }

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
      spawner: this.spawner,
    });
  }
}

export const antigravityAdapter: AntigravityAdapter = new AntigravityAdapter();
