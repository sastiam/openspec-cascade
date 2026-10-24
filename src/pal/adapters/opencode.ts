/**
 * OpenCode & Local LLM Provider Adapter (PAL).
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 4 and OpenSpec change
 * proposal `looper-pal-opencode-adapter`.
 *
 * Adheres to `ProviderAdapter` (`IPalProvider`) interface, integrating OpenCode,
 * Ollama, vLLM, and OpenAI-compatible endpoints with local streaming SSE,
 * DeepSeek reasoning/thinking deltas, JSON auto-repair, and OpenCode CLI subprocessing.
 */

import { randomUUID } from "node:crypto";
import {
  extractReActToolCalls,
  formatReActToolInstructions,
  fromOpenAiResponse,
  isReActStreamTruncated,
  repairJsonArguments,
  repairTruncatedJson,
  stitchTruncatedToolCall,
  toOpenAiPayload,
  RECONTINUATION_PROMPT,
} from "../normalizer";
import {
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ERROR_KINDS,
  PAL_FINISH_REASONS,
  PAL_PROVIDER_NAMES,
  PAL_ROLES,
  PalError,
  createPalMessage,
  createTextBlock,
  createThoughtBlock,
  createToolCallBlock,
  isPalTextContent,
  isPalToolCallContent,
  type IPalProvider,
  type PalContentBlock,
  type PalErrorKind,
  type PalFinishReason,
  type PalMessage,
  type PalOutcome,
  type PalProviderCapabilities,
  type PalProviderName,
  type PalRateLimitInfo,
  type PalSessionOptions,
  type PalStreamEvent,
  type PalThinkingOptions,
  type PalTokenUsage,
  type PalToolChoice,
  type PalToolCallContent,
  type PalToolDefinition,
  type PalToolExecutionContext,
  type PalToolParametersSchema,
  type PalToolResultContent,
  type ProviderAdapter,
} from "../types";
import {
  MCP_BRIDGE_CONSTANTS,
  type McpContent,
  type McpTextContent,
  type McpImageContent,
  type McpResourceContent,
  type McpToolSchema,
  type McpCallToolResult,
  type McpServerConfig,
  type IMcpClient,
  type McpBridgeOptions,
  type ValidationResult,
  type PalToolDispatcherOptions,
  InMemoryMcpClient,
  McpToolBridge,
  PalToolDispatcher,
  createInMemoryMcpClient,
  createMcpToolBridge,
  createPalToolDispatcher,
  defaultPalToolDispatcher,
  mcpToolToPalTool,
  palToolToMcpTool,
  batchMcpToolsToPalTools,
  batchPalToolsToMcpTools,
  validateToolArguments,
  formatMcpCallToolResult,
} from "../mcp";

/**
 * Central constants ensuring zero magic numbers across OpenCodeAdapter operations.
 */
export const OPENCODE_ADAPTER_CONSTANTS = {
  // Model defaults
  DEFAULT_MODEL: "opencode/deepseek-v4.1-flash",
  FALLBACK_MODEL: "deepseek-coder",

  // Context & Token Limits
  MAX_CONTEXT_TOKENS: 128_000,
  MAX_OUTPUT_TOKENS: 8_192,
  DEFAULT_MAX_OUTPUT_TOKENS: 4_096,
  DEFAULT_TEMPERATURE: 0.7,
  ZERO_TOKENS: 0,

  // Network & Endpoint Defaults
  DEFAULT_BASE_URL: "http://localhost:11434/v1",
  CHAT_COMPLETIONS_ENDPOINT: "/chat/completions",
  DEFAULT_TIMEOUT_MS: 60_000,
  MS_PER_SECOND: 1_000,
  RATE_LIMIT_RESET_FALLBACK_MS: 60_000,

  // HTTP & API Headers
  HEADER_CONTENT_TYPE: "application/json",
  HEADER_AUTHORIZATION: "authorization",
  BEARER_PREFIX: "Bearer ",

  // Initial Telemetry Limits
  INITIAL_REQUESTS_LIMIT: 1_000,
  INITIAL_REQUESTS_REMAINING: 1_000,
  INITIAL_TOKENS_LIMIT: 1_000_000,
  INITIAL_TOKENS_REMAINING: 1_000_000,
  INITIAL_RESETS_AT: 0,

  // HTTP Status Codes
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_FORBIDDEN: 403,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_REQUEST_TIMEOUT: 408,
  HTTP_STATUS_TOO_MANY_REQUESTS: 429,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_BAD_GATEWAY: 502,
  HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
  HTTP_STATUS_GATEWAY_TIMEOUT: 504,
  HTTP_STATUS_OVERLOADED: 529,

  // SSE & Streaming Literals
  SSE_DATA_PREFIX: "data: ",
  SSE_COMMENT_PREFIX: ":",
  SSE_DONE_SIGNAL: "[DONE]",
  TEXT_DECODER_ENCODING: "utf-8",
  FALLBACK_TOOL_NAME: "unknown_tool",
  THINK_START_TAG: "<think>",
  THINK_END_TAG: "</think>",
  THINK_START_TAG_LEN: 7,
  THINK_END_TAG_LEN: 8,
  UUID_SLICE_LENGTH: 8,

  // CLI & Subprocessing Defaults
  CLI_BIN: "opencode",
  CLI_FLAG_RUN: "run",
  CLI_FLAG_FORMAT: "--format",
  CLI_FORMAT_JSON: "json",
  CLI_FLAG_AUTO: "--auto",
  CLI_FLAG_MODEL: "--model",
  CLI_FLAG_SESSION: "--session",
  CLI_FLAG_TITLE: "--title",
  CLI_DEFAULT_TITLE: "openspec-cascade",
  DEFAULT_CLI_TIMEOUT_MS: 2_700_000,
  STDERR_TAIL_MAX_LENGTH: 400,
  ERROR_DETAIL_MAX_LENGTH: 200,
  RATE_LIMIT_SLEEP_MS: 30_000,
  EXIT_CODE_SUCCESS: 0,
} as const;

/**
 * Execution mode for OpenCodeAdapter: OpenAI-compatible REST API or OpenCode CLI subprocess.
 */
export type OpenCodeExecutionMode = "api" | "cli";

/**
 * Abstract interface for spawned OpenCode CLI subprocess.
 */
export interface OpenCodeSpawnedProcess {
  stdout:
    | ReadableStream<Uint8Array | string>
    | AsyncIterable<Uint8Array | string>
    | NodeJS.ReadableStream
    | null;
  stderr?:
    | ReadableStream<Uint8Array | string>
    | AsyncIterable<Uint8Array | string>
    | NodeJS.ReadableStream
    | null;
  exited: Promise<number>;
  kill?(signal?: number | string): void;
}

/**
 * Factory signature for spawning an OpenCode subprocess.
 */
export type OpenCodeSubprocessSpawnFn = (
  argv: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    timeout?: number;
    stdout: "pipe";
    stderr: "pipe";
  }
) => OpenCodeSpawnedProcess;

/**
 * Options for configuring OpenCodeAdapter.
 */
export interface OpenCodeAdapterOptions {
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  defaultThinking?: PalThinkingOptions;
  executionMode?: OpenCodeExecutionMode;
  cwd?: string;
  spawnFn?: OpenCodeSubprocessSpawnFn;
  deniedBash?: string[];
  maxContextTokens?: number;
  maxOutputTokens?: number;
  supportsNativeTools?: boolean;
  supportsExtendedThinking?: boolean;
  toolDispatcher?: PalToolDispatcher;
  mcpBridge?: McpToolBridge;
}

/**
 * Safe type guard checking if an unknown value is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Helper checking if an unknown value is a ReadableStream.
 */
function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as { getReader: unknown }).getReader === "function"
  );
}

/**
 * Normalizes a ReadableStream, AsyncIterable, or Iterable into a uniform AsyncIterable.
 */
export async function* toAsyncIterable<T>(
  source: ReadableStream<T> | AsyncIterable<T> | Iterable<T> | null | undefined
): AsyncIterable<T> {
  if (!source) {
    return;
  }
  if (isReadableStream(source)) {
    const reader = source.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          yield value as T;
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else if (
    typeof source === "object" &&
    source !== null &&
    Symbol.asyncIterator in source &&
    typeof (source as AsyncIterable<T>)[Symbol.asyncIterator] === "function"
  ) {
    for await (const item of source as AsyncIterable<T>) {
      yield item;
    }
  } else if (
    typeof source === "object" &&
    source !== null &&
    Symbol.iterator in source &&
    typeof (source as Iterable<T>)[Symbol.iterator] === "function"
  ) {
    for (const item of source as Iterable<T>) {
      yield item;
    }
  }
}

/**
 * Formats OpenCode model arg preserving variant reasoning effort.
 * e.g. `provider/model#variant`.
 */
export function openCodeModelArg(
  model: string | undefined,
  effort: string | undefined
): string {
  const base = model ?? OPENCODE_ADAPTER_CONSTANTS.DEFAULT_MODEL;
  return base.includes("#") || !effort || effort === "none"
    ? base
    : `${base}#${effort}`;
}

/**
 * Converts Claude-style deny rules ("Bash(git push *)") to OpenCode bash permission patterns.
 */
export function openCodePermission(deniedBash: string[] | readonly string[]): {
  edit: string;
  webfetch: string;
  bash: Record<string, string>;
} {
  const bash: Record<string, string> = { "*": "allow" };
  for (const rule of deniedBash) {
    const pattern = rule.match(/^Bash\((.+)\)$/)?.[1];
    if (pattern) bash[pattern] = "deny";
  }
  return { edit: "allow", webfetch: "allow", bash };
}

const RATE_LIMIT_REGEX =
  /rate.?limit|\b429\b|quota|usage limit|too many requests/i;
const UNRECOVERABLE_REGEX =
  /provider\.auth|invalid credential|"status":\s*(401|403)\b|unauthorized|model not found/i;

/**
 * Classifies failure messages from OpenCode CLI into fatal, paused, or error.
 */
export function classifyOpenCodeFailure(
  failure: string
): "fatal" | "paused" | "error" {
  if (UNRECOVERABLE_REGEX.test(failure)) return "fatal";
  return RATE_LIMIT_REGEX.test(failure) ? "paused" : "error";
}

/**
 * Formats canonical session prompt for CLI subprocessing from PalSessionOptions.
 */
export function formatSessionPromptForCli(
  sessionOptions: PalSessionOptions
): string {
  const parts: string[] = [];

  if (
    typeof sessionOptions.systemPrompt === "string" &&
    sessionOptions.systemPrompt.trim().length >
      OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS
  ) {
    parts.push(sessionOptions.systemPrompt.trim());
  } else if (Array.isArray(sessionOptions.systemPrompt)) {
    const sysTexts = sessionOptions.systemPrompt
      .map((p) => p.text?.trim())
      .filter((t): t is string => Boolean(t));
    if (sysTexts.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      parts.push(sysTexts.join("\n\n"));
    }
  }

  const messageTexts: string[] = [];
  for (const message of sessionOptions.messages) {
    const textBlocks = message.content
      .filter(isPalTextContent)
      .map((b) => b.text.trim())
      .filter((t) => t.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS);

    if (textBlocks.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      if (
        sessionOptions.messages.length === 1 &&
        message.role === PAL_ROLES.USER
      ) {
        messageTexts.push(textBlocks.join("\n\n"));
      } else {
        messageTexts.push(`[${message.role}]: ${textBlocks.join("\n\n")}`);
      }
    }
  }

  if (messageTexts.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
    parts.push(messageTexts.join("\n\n"));
  }

  return parts.join("\n\n").trim();
}

/**
 * Builds CLI argument array for running opencode run.
 */
export function buildOpenCodeCliArgs(options: {
  model: string;
  prompt: string;
  session?: string;
  title?: string;
}): string[] {
  const argv = [
    OPENCODE_ADAPTER_CONSTANTS.CLI_BIN,
    OPENCODE_ADAPTER_CONSTANTS.CLI_FLAG_RUN,
    OPENCODE_ADAPTER_CONSTANTS.CLI_FLAG_FORMAT,
    OPENCODE_ADAPTER_CONSTANTS.CLI_FORMAT_JSON,
    OPENCODE_ADAPTER_CONSTANTS.CLI_FLAG_AUTO,
    OPENCODE_ADAPTER_CONSTANTS.CLI_FLAG_MODEL,
    options.model,
    OPENCODE_ADAPTER_CONSTANTS.CLI_FLAG_TITLE,
    options.title ?? OPENCODE_ADAPTER_CONSTANTS.CLI_DEFAULT_TITLE,
  ];
  if (options.session) {
    argv.push(OPENCODE_ADAPTER_CONSTANTS.CLI_FLAG_SESSION, options.session);
  }
  argv.push(options.prompt);
  return argv;
}

/**
 * OpenAi function tool payload definition.
 */
export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: PalToolParametersSchema;
  };
}

/**
 * Formats canonical PAL tool definitions into OpenAI function tool schema.
 */
export function formatOpenAiTools(
  tools?: PalToolDefinition[]
): OpenAiToolDefinition[] | undefined {
  if (!tools || tools.length === OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Formats canonical PAL tool choice into OpenAI tool_choice schema.
 */
export function formatOpenAiToolChoice(
  choice?: PalToolChoice
):
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } }
  | undefined {
  if (choice === undefined) {
    return undefined;
  }
  if (choice === "auto") {
    return "auto";
  }
  if (choice === "none") {
    return "none";
  }
  if (choice === "required") {
    return "required";
  }
  if (typeof choice === "object" && choice.type === "tool") {
    return {
      type: "function",
      function: {
        name: choice.toolName,
      },
    };
  }
  return undefined;
}

/**
 * Maps OpenAI finish_reason string to canonical PalFinishReason.
 */
export function mapOpenAiFinishReason(
  finishReason: unknown,
  hasToolCalls: boolean = false
): PalFinishReason {
  if (hasToolCalls) {
    return PAL_FINISH_REASONS.TOOL_CALLS;
  }
  if (typeof finishReason !== "string") {
    return PAL_FINISH_REASONS.STOP;
  }

  switch (finishReason) {
    case "stop":
      return PAL_FINISH_REASONS.STOP;
    case "length":
      return PAL_FINISH_REASONS.LENGTH;
    case "tool_calls":
    case "function_call":
      return PAL_FINISH_REASONS.TOOL_CALLS;
    case "content_filter":
      return PAL_FINISH_REASONS.CONTENT_FILTER;
    default:
      return PAL_FINISH_REASONS.STOP;
  }
}

/**
 * Extracts and accumulates token usage telemetry from OpenAI response usage object.
 */
export function calculateOpenAiTokenUsage(rawUsage: unknown): PalTokenUsage {
  if (!isRecord(rawUsage)) {
    return {
      promptTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    };
  }

  const promptTokens =
    typeof rawUsage.prompt_tokens === "number"
      ? rawUsage.prompt_tokens
      : OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS;

  const rawCompletionTokens =
    typeof rawUsage.completion_tokens === "number"
      ? rawUsage.completion_tokens
      : OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS;

  let thinkingTokens: number | undefined;
  if (
    isRecord(rawUsage.completion_tokens_details) &&
    typeof rawUsage.completion_tokens_details.reasoning_tokens === "number"
  ) {
    thinkingTokens = rawUsage.completion_tokens_details.reasoning_tokens;
  } else if (typeof rawUsage.reasoning_tokens === "number") {
    thinkingTokens = rawUsage.reasoning_tokens;
  }

  const cachedPromptTokens =
    isRecord(rawUsage.prompt_tokens_details) &&
    typeof rawUsage.prompt_tokens_details.cached_tokens === "number"
      ? rawUsage.prompt_tokens_details.cached_tokens
      : undefined;

  const totalTokens =
    typeof rawUsage.total_tokens === "number"
      ? rawUsage.total_tokens
      : promptTokens + rawCompletionTokens;

  return {
    promptTokens,
    completionTokens: rawCompletionTokens,
    totalTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
    ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
  };
}

/**
 * Parses OpenAI / OpenCode rate limit response headers.
 */
export function parseOpenAiRateLimitHeaders(
  headers: Headers
): Partial<PalRateLimitInfo> {
  const result: Partial<PalRateLimitInfo> = {};

  const reqLimit = headers.get("x-ratelimit-limit-requests");
  if (reqLimit) {
    const val = Number(reqLimit);
    if (!isNaN(val)) result.requestsLimit = val;
  }

  const reqRemaining = headers.get("x-ratelimit-remaining-requests");
  if (reqRemaining) {
    const val = Number(reqRemaining);
    if (!isNaN(val)) result.requestsRemaining = val;
  }

  const tokLimit = headers.get("x-ratelimit-limit-tokens");
  if (tokLimit) {
    const val = Number(tokLimit);
    if (!isNaN(val)) result.tokensLimit = val;
  }

  const tokRemaining = headers.get("x-ratelimit-remaining-tokens");
  if (tokRemaining) {
    const val = Number(tokRemaining);
    if (!isNaN(val)) result.tokensRemaining = val;
  }

  const resetReq = headers.get("x-ratelimit-reset-requests");
  if (resetReq) {
    const parsedSec = parseFloat(resetReq);
    if (!isNaN(parsedSec)) {
      result.resetsAt =
        Date.now() + parsedSec * OPENCODE_ADAPTER_CONSTANTS.MS_PER_SECOND;
    }
  }

  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const parsedSec = Number(retryAfter);
    if (!isNaN(parsedSec)) {
      result.resetsAt =
        Date.now() + parsedSec * OPENCODE_ADAPTER_CONSTANTS.MS_PER_SECOND;
    } else {
      const parsedDate = Date.parse(retryAfter);
      if (!isNaN(parsedDate)) {
        result.resetsAt = parsedDate;
      }
    }
  }

  return result;
}

/**
 * Maps OpenAI / OpenCode HTTP error responses into standardized PalError instances.
 */
export function parseOpenAiError(
  status: number,
  data: unknown,
  headers?: Headers
): PalError {
  let message = `OpenCode/OpenAI API request failed with status ${status}`;
  let errorKind: PalErrorKind = PAL_ERROR_KINDS.INVALID_REQUEST;
  let retryable = false;

  if (isRecord(data)) {
    if (isRecord(data.error) && typeof data.error.message === "string") {
      message = data.error.message;
    } else if (typeof data.message === "string") {
      message = data.message;
    } else if (typeof data.error === "string") {
      message = data.error;
    }
  }

  if (status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_TOO_MANY_REQUESTS) {
    errorKind = PAL_ERROR_KINDS.RATE_LIMIT;
    retryable = true;
  } else if (
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_INTERNAL_SERVER_ERROR ||
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_BAD_GATEWAY ||
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_SERVICE_UNAVAILABLE ||
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_GATEWAY_TIMEOUT ||
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_OVERLOADED
  ) {
    errorKind = PAL_ERROR_KINDS.OVERLOADED;
    retryable = true;
  } else if (
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_UNAUTHORIZED ||
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_FORBIDDEN
  ) {
    errorKind = PAL_ERROR_KINDS.AUTH_FAILURE;
    retryable = false;
  } else if (
    status === OPENCODE_ADAPTER_CONSTANTS.HTTP_STATUS_REQUEST_TIMEOUT
  ) {
    errorKind = PAL_ERROR_KINDS.TIMEOUT;
    retryable = true;
  } else {
    if (RATE_LIMIT_REGEX.test(message)) {
      errorKind = PAL_ERROR_KINDS.RATE_LIMIT;
      retryable = true;
    } else if (/context length|maximum context|token limit/i.test(message)) {
      errorKind = PAL_ERROR_KINDS.CONTEXT_EXCEEDED;
      retryable = false;
    } else if (
      /unauthorized|forbidden|invalid api key|invalid credential/i.test(message)
    ) {
      errorKind = PAL_ERROR_KINDS.AUTH_FAILURE;
      retryable = false;
    }
  }

  let resetsAt: number | undefined;
  if (headers) {
    const rateLimitInfo = parseOpenAiRateLimitHeaders(headers);
    resetsAt = rateLimitInfo.resetsAt;
  }

  return new PalError(errorKind, message, retryable, resetsAt, data);
}

/**
 * Active in-flight tool call tracking structure during SSE streaming.
 */
interface ActiveStreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Parser for OpenAI-compatible Server-Sent Events (SSE) streaming chunks.
 */
export class OpenCodeStreamChunkParser {
  private lineBuffer: string = "";
  private readonly decoder: TextDecoder = new TextDecoder(
    OPENCODE_ADAPTER_CONSTANTS.TEXT_DECODER_ENCODING
  );
  private readonly activeToolCalls: Map<number, ActiveStreamingToolCall> =
    new Map();
  private accumulatedUsage: PalTokenUsage = {
    promptTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    completionTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    totalTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
  };
  private finishReason: PalFinishReason = PAL_FINISH_REASONS.STOP;
  private hasToolCalls: boolean = false;
  private isDone: boolean = false;
  private inThinkingBlock: boolean = false;
  private accumulatedContent: string = "";

  /**
   * Feeds a raw binary or string chunk into the SSE stream parser.
   */
  feed(chunk: Uint8Array | string): PalStreamEvent[] {
    if (this.isDone) {
      return [];
    }

    const events: PalStreamEvent[] = [];
    const text =
      typeof chunk === "string"
        ? chunk
        : this.decoder.decode(chunk, { stream: true });
    this.lineBuffer += text;

    const lines = this.lineBuffer.split("\n");
    this.lineBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (
        line.length === OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS ||
        line.startsWith(OPENCODE_ADAPTER_CONSTANTS.SSE_COMMENT_PREFIX)
      ) {
        continue;
      }

      if (line.startsWith(OPENCODE_ADAPTER_CONSTANTS.SSE_DATA_PREFIX)) {
        const payload = line
          .slice(OPENCODE_ADAPTER_CONSTANTS.SSE_DATA_PREFIX.length)
          .trim();

        if (payload === OPENCODE_ADAPTER_CONSTANTS.SSE_DONE_SIGNAL) {
          const finalEvents = this.finalizeStream();
          for (const ev of finalEvents) {
            events.push(ev);
          }
          continue;
        }

        let chunkData: Record<string, unknown>;
        try {
          chunkData = JSON.parse(payload);
        } catch {
          continue;
        }

        if (!isRecord(chunkData)) {
          continue;
        }

        if (isRecord(chunkData.usage)) {
          this.accumulatedUsage = calculateOpenAiTokenUsage(chunkData.usage);
        }

        if (Array.isArray(chunkData.choices) && chunkData.choices.length > 0) {
          const choice = chunkData.choices[0];
          if (isRecord(choice)) {
            if (choice.finish_reason) {
              this.finishReason = mapOpenAiFinishReason(
                choice.finish_reason,
                this.hasToolCalls
              );
            }

            const delta = choice.delta;
            if (isRecord(delta)) {
              // 1. Thinking / Reasoning content (DeepSeek / OpenCode / OpenAI o-series)
              if (
                typeof delta.reasoning_content === "string" &&
                delta.reasoning_content.length > 0
              ) {
                events.push({
                  type: "thought_delta",
                  thought: delta.reasoning_content,
                });
              } else if (
                typeof delta.reasoning === "string" &&
                delta.reasoning.length > 0
              ) {
                events.push({
                  type: "thought_delta",
                  thought: delta.reasoning,
                });
              }

              // 2. Regular content delta & inline <think> tags
              if (
                typeof delta.content === "string" &&
                delta.content.length > 0
              ) {
                this.accumulatedContent += delta.content;
                const contentText = delta.content;

                if (
                  contentText.includes(
                    OPENCODE_ADAPTER_CONSTANTS.THINK_START_TAG
                  )
                ) {
                  this.inThinkingBlock = true;
                  const startIdx = contentText.indexOf(
                    OPENCODE_ADAPTER_CONSTANTS.THINK_START_TAG
                  );
                  const before = contentText.slice(0, startIdx);
                  if (before.length > 0) {
                    events.push({ type: "text_delta", text: before });
                  }
                  const after = contentText.slice(
                    startIdx + OPENCODE_ADAPTER_CONSTANTS.THINK_START_TAG_LEN
                  );
                  if (
                    after.includes(OPENCODE_ADAPTER_CONSTANTS.THINK_END_TAG)
                  ) {
                    this.inThinkingBlock = false;
                    const endIdx = after.indexOf(
                      OPENCODE_ADAPTER_CONSTANTS.THINK_END_TAG
                    );
                    const thought = after.slice(0, endIdx);
                    const remainingText = after.slice(
                      endIdx + OPENCODE_ADAPTER_CONSTANTS.THINK_END_TAG_LEN
                    );
                    if (thought.length > 0) {
                      events.push({ type: "thought_delta", thought });
                    }
                    if (remainingText.length > 0) {
                      events.push({
                        type: "text_delta",
                        text: remainingText,
                      });
                    }
                  } else if (after.length > 0) {
                    events.push({ type: "thought_delta", thought: after });
                  }
                } else if (this.inThinkingBlock) {
                  if (
                    contentText.includes(OPENCODE_ADAPTER_CONSTANTS.THINK_END_TAG)
                  ) {
                    this.inThinkingBlock = false;
                    const endIdx = contentText.indexOf(
                      OPENCODE_ADAPTER_CONSTANTS.THINK_END_TAG
                    );
                    const thought = contentText.slice(0, endIdx);
                    const remainingText = contentText.slice(
                      endIdx + OPENCODE_ADAPTER_CONSTANTS.THINK_END_TAG_LEN
                    );
                    if (thought.length > 0) {
                      events.push({ type: "thought_delta", thought });
                    }
                    if (remainingText.length > 0) {
                      events.push({
                        type: "text_delta",
                        text: remainingText,
                      });
                    }
                  } else {
                    events.push({
                      type: "thought_delta",
                      thought: contentText,
                    });
                  }
                } else {
                  events.push({ type: "text_delta", text: contentText });
                }
              }

              // 3. Tool calls delta
              if (
                Array.isArray(delta.tool_calls) &&
                delta.tool_calls.length > 0
              ) {
                this.hasToolCalls = true;
                for (const tc of delta.tool_calls) {
                  if (!isRecord(tc)) continue;
                  const idx =
                    typeof tc.index === "number"
                      ? tc.index
                      : OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS;
                  let active = this.activeToolCalls.get(idx);
                  if (!active) {
                    active = {
                      id:
                        typeof tc.id === "string"
                          ? tc.id
                          : `call_${idx}_${randomUUID().slice(
                              OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
                              OPENCODE_ADAPTER_CONSTANTS.UUID_SLICE_LENGTH
                            )}`,
                      name:
                        isRecord(tc.function) &&
                        typeof tc.function.name === "string"
                          ? tc.function.name
                          : "",
                      arguments: "",
                    };
                    this.activeToolCalls.set(idx, active);
                  } else {
                    if (typeof tc.id === "string" && tc.id) {
                      active.id = tc.id;
                    }
                    if (
                      isRecord(tc.function) &&
                      typeof tc.function.name === "string" &&
                      tc.function.name
                    ) {
                      active.name = tc.function.name;
                    }
                  }

                  if (
                    isRecord(tc.function) &&
                    typeof tc.function.arguments === "string"
                  ) {
                    active.arguments += tc.function.arguments;
                    events.push({
                      type: "tool_call_delta",
                      id: active.id,
                      name: active.name,
                      argumentsDelta: tc.function.arguments,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    return events;
  }

  /**
   * Finalizes the stream and emits completed tool calls and turn completion.
   */
  private finalizeStream(): PalStreamEvent[] {
    if (this.isDone) {
      return [];
    }
    this.isDone = true;
    const events: PalStreamEvent[] = [];

    // Finalize native tool calls
    for (const active of this.activeToolCalls.values()) {
      events.push({
        type: "tool_call_end",
        id: active.id,
        name: active.name || OPENCODE_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME,
        arguments: repairJsonArguments(active.arguments),
      });
    }
    this.activeToolCalls.clear();

    // ReAct fallback if no native tool calls were emitted
    if (!this.hasToolCalls) {
      const { toolCalls } = extractReActToolCalls(this.accumulatedContent);
      for (const tc of toolCalls) {
        events.push({
          type: "tool_call_end",
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
      if (toolCalls.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
        this.finishReason = PAL_FINISH_REASONS.TOOL_CALLS;
      }
    }

    events.push({
      type: "turn_complete",
      finishReason: this.finishReason,
      usage: this.accumulatedUsage,
    });

    return events;
  }

  /**
   * Flushes any remaining lines in buffer.
   */
  flush(): PalStreamEvent[] {
    if (this.isDone) {
      return [];
    }
    if (this.lineBuffer.trim().length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      const leftover = this.lineBuffer;
      this.lineBuffer = "";
      const events = this.feed(`${leftover}\n`);
      return [...events, ...this.finalizeStream()];
    }
    return this.finalizeStream();
  }
}

/**
 * Parses an SSE stream into canonical PalStreamEvent instances.
 */
export async function* parseOpenAiStream(
  source: AsyncIterable<Uint8Array | string>
): AsyncIterable<PalStreamEvent> {
  const parser = new OpenCodeStreamChunkParser();
  for await (const chunk of source) {
    const events = parser.feed(chunk);
    for (const ev of events) {
      yield ev;
    }
  }
  const flushEvents = parser.flush();
  for (const ev of flushEvents) {
    yield ev;
  }
}

/**
 * Default subprocess spawn implementation using Bun.spawn if available.
 */
function defaultBunSpawn(
  argv: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    timeout?: number;
    stdout: "pipe";
    stderr: "pipe";
  }
): OpenCodeSpawnedProcess {
  if (typeof Bun !== "undefined" && typeof Bun.spawn === "function") {
    return Bun.spawn(argv, options) as unknown as OpenCodeSpawnedProcess;
  }
  throw new Error("Bun.spawn is not available in current runtime environment");
}

/**
 * Options for running OpenCode CLI subprocess.
 */
export interface OpenCodeSubprocessOptions {
  prompt?: string;
  sessionOptions?: PalSessionOptions;
  cwd?: string;
  model?: string;
  sessionId?: string;
  deniedBash?: string[];
  timeoutMs?: number;
  spawnFn?: OpenCodeSubprocessSpawnFn;
  hooks?: {
    onText?: (text: string) => void;
    onTool?: (tool: string, input: unknown) => void;
    log?: (event: string, data: unknown) => void;
  };
  abortSignal?: AbortSignal;
}

/**
 * Runs OpenCode CLI subprocess and streams execution events in real-time.
 */
export async function* streamOpenCodeSubprocess(
  options: OpenCodeSubprocessOptions
): AsyncIterable<PalStreamEvent> {
  const prompt =
    options.prompt ??
    (options.sessionOptions
      ? formatSessionPromptForCli(options.sessionOptions)
      : "");
  const cwd = options.cwd ?? process.cwd();
  const model = options.model ?? OPENCODE_ADAPTER_CONSTANTS.DEFAULT_MODEL;
  const timeoutMs =
    options.timeoutMs ?? OPENCODE_ADAPTER_CONSTANTS.DEFAULT_CLI_TIMEOUT_MS;
  const deniedBash = options.deniedBash ?? [];

  const argv = buildOpenCodeCliArgs({
    model,
    prompt,
    session: options.sessionId,
  });

  const env = {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      permission: openCodePermission(deniedBash),
    }),
  };

  const spawnFn = options.spawnFn ?? defaultBunSpawn;
  const proc = spawnFn(argv, {
    cwd,
    env,
    timeout: timeoutMs,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (options.abortSignal) {
    options.abortSignal.addEventListener("abort", () => {
      if (proc.kill) proc.kill();
    });
  }

  const decoder = new TextDecoder(
    OPENCODE_ADAPTER_CONSTANTS.TEXT_DECODER_ENCODING
  );
  let buffer = "";
  const sessionTexts = new Map<string, string>();
  let procError: string | undefined;

  if (proc.stdout) {
    for await (const chunk of toAsyncIterable<Uint8Array | string>(
      proc.stdout
    )) {
      const text =
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === "error" || event.error) {
          procError =
            typeof event.error === "string"
              ? event.error
              : JSON.stringify(event.error ?? event);
        }

        const part = (
          event.part ??
          (isRecord(event.properties) ? event.properties.part : undefined)
        ) as Record<string, unknown> | undefined;
        if (!part) continue;

        if (
          part.type === "text" &&
          typeof part.text === "string" &&
          part.text.trim()
        ) {
          const partId =
            typeof part.id === "string" ? part.id : randomUUID();
          if (!sessionTexts.has(partId)) {
            sessionTexts.set(partId, part.text);
            yield { type: "text_delta", text: part.text };
            if (options.hooks?.onText) options.hooks.onText(part.text);
          }
        } else if (part.type === "tool") {
          const state = isRecord(part.state) ? part.state : undefined;
          const status =
            state && typeof state.status === "string" ? state.status : "";
          const toolName =
            typeof part.tool === "string"
              ? part.tool
              : OPENCODE_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME;
          const input = state ? state.input : {};
          const callId =
            typeof part.id === "string" ? part.id : randomUUID();

          if (["completed", "error"].includes(status)) {
            const parsedArgs = isRecord(input)
              ? input
              : typeof input === "string"
                ? repairJsonArguments(input)
                : {};
            yield {
              type: "tool_call_delta",
              id: callId,
              name: toolName,
              argumentsDelta:
                typeof input === "string" ? input : JSON.stringify(input),
            };
            yield {
              type: "tool_call_end",
              id: callId,
              name: toolName,
              arguments: parsedArgs,
            };
            if (options.hooks?.onTool) options.hooks.onTool(toolName, input);
          }
        }
      }
    }
  }

  const exitCode = await proc.exited;

  let stderrText = "";
  if (proc.stderr) {
    for await (const chunk of toAsyncIterable<Uint8Array | string>(
      proc.stderr
    )) {
      stderrText +=
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
    }
  }

  const failure =
    procError ??
    (exitCode !== OPENCODE_ADAPTER_CONSTANTS.EXIT_CODE_SUCCESS
      ? `exit ${exitCode}: ${stderrText.slice(-OPENCODE_ADAPTER_CONSTANTS.ERROR_DETAIL_MAX_LENGTH)}`
      : undefined);

  if (failure) {
    const kind = classifyOpenCodeFailure(failure);
    const palErrorKind =
      kind === "fatal"
        ? PAL_ERROR_KINDS.AUTH_FAILURE
        : kind === "paused"
          ? PAL_ERROR_KINDS.RATE_LIMIT
          : PAL_ERROR_KINDS.OVERLOADED;
    const retryable = kind !== "fatal";
    yield {
      type: "error",
      error: new PalError(palErrorKind, `OpenCode CLI: ${failure}`, retryable),
    };
    return;
  }

  yield {
    type: "turn_complete",
    finishReason: PAL_FINISH_REASONS.STOP,
    usage: {
      promptTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    },
  };
}

/**
 * Runs OpenCode CLI subprocess to completion and returns canonical PalOutcome.
 */
export async function runOpenCodeSubprocess(
  options: OpenCodeSubprocessOptions
): Promise<PalOutcome> {
  const contentBlocks: PalContentBlock[] = [];
  let textAccumulator = "";
  let finishReason: PalFinishReason = PAL_FINISH_REASONS.STOP;
  let usage: PalTokenUsage = {
    promptTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    completionTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    totalTokens: OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS,
  };

  for await (const event of streamOpenCodeSubprocess(options)) {
    if (event.type === "error") {
      throw event.error;
    }
    if (event.type === "text_delta") {
      textAccumulator += event.text;
    } else if (event.type === "tool_call_end") {
      contentBlocks.push(
        createToolCallBlock(event.id, event.name, event.arguments)
      );
    } else if (event.type === "turn_complete") {
      finishReason = event.finishReason;
      usage = event.usage;
    }
  }

  if (textAccumulator.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
    contentBlocks.unshift(createTextBlock(textAccumulator));
  }

  const message = createPalMessage({
    role: PAL_ROLES.ASSISTANT,
    content: contentBlocks,
  });

  return {
    message,
    finishReason,
    usage,
  };
}

/**
 * OpenCode Provider Adapter.
 *
 * Implements `ProviderAdapter` (`IPalProvider`) interface, integrating OpenCode,
 * Ollama, vLLM, and OpenAI-compatible models with local streaming SSE,
 * DeepSeek reasoning/thinking deltas, JSON auto-repair, and canonical PAL telemetry.
 */
export class OpenCodeAdapter implements ProviderAdapter {
  readonly providerName: PalProviderName = PAL_PROVIDER_NAMES.OPENCODE;
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultThinking?: PalThinkingOptions;
  private executionMode: OpenCodeExecutionMode;
  private readonly cwd?: string;
  private readonly spawnFn?: OpenCodeSubprocessSpawnFn;
  private readonly deniedBash: string[];
  private readonly maxContextTokens: number;
  private readonly maxOutputTokens: number;
  private readonly supportsNativeTools: boolean;
  private readonly supportsExtendedThinking: boolean;
  private toolDispatcher?: PalToolDispatcher;
  private mcpBridge?: McpToolBridge;

  private rateLimitState: PalRateLimitInfo = {
    requestsRemaining: OPENCODE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_REMAINING,
    requestsLimit: OPENCODE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_LIMIT,
    tokensRemaining: OPENCODE_ADAPTER_CONSTANTS.INITIAL_TOKENS_REMAINING,
    tokensLimit: OPENCODE_ADAPTER_CONSTANTS.INITIAL_TOKENS_LIMIT,
    resetsAt: OPENCODE_ADAPTER_CONSTANTS.INITIAL_RESETS_AT,
  };

  constructor(options?: OpenCodeAdapterOptions) {
    this.modelName =
      options?.modelName ?? OPENCODE_ADAPTER_CONSTANTS.DEFAULT_MODEL;
    this.apiKey =
      options?.apiKey ??
      process.env.OPENCODE_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "";
    this.baseUrl =
      options?.baseUrl ??
      process.env.OPENCODE_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      process.env.OLLAMA_BASE_URL ??
      OPENCODE_ADAPTER_CONSTANTS.DEFAULT_BASE_URL;
    this.timeoutMs =
      options?.timeoutMs ?? OPENCODE_ADAPTER_CONSTANTS.DEFAULT_TIMEOUT_MS;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.defaultHeaders = options?.defaultHeaders ?? {};
    this.defaultThinking = options?.defaultThinking;
    this.executionMode = options?.executionMode ?? "api";
    this.cwd = options?.cwd;
    this.spawnFn = options?.spawnFn;
    this.deniedBash = options?.deniedBash ? [...options.deniedBash] : [];
    this.maxContextTokens =
      options?.maxContextTokens ??
      OPENCODE_ADAPTER_CONSTANTS.MAX_CONTEXT_TOKENS;
    this.maxOutputTokens =
      options?.maxOutputTokens ?? OPENCODE_ADAPTER_CONSTANTS.MAX_OUTPUT_TOKENS;
    this.supportsNativeTools = options?.supportsNativeTools ?? true;
    this.supportsExtendedThinking = options?.supportsExtendedThinking ?? true;
    this.toolDispatcher = options?.toolDispatcher;
    this.mcpBridge = options?.mcpBridge;
  }

  /**
   * Retrieves active model name.
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Retrieves configured base URL.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Retrieves configured timeout in milliseconds.
   */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * Retrieves active execution mode ("api" or "cli").
   */
  getExecutionMode(): OpenCodeExecutionMode {
    return this.executionMode;
  }

  /**
   * Updates execution mode at runtime.
   */
  setExecutionMode(mode: OpenCodeExecutionMode): void {
    this.executionMode = mode;
  }

  /**
   * Returns true if configured to execute via OpenCode CLI subprocess.
   */
  isCliMode(): boolean {
    return this.executionMode === "cli";
  }

  /**
   * Retrieves configured default extended thinking options if set.
   */
  getDefaultThinking(): PalThinkingOptions | undefined {
    return this.defaultThinking ? { ...this.defaultThinking } : undefined;
  }

  /**
   * Retrieves configured PalToolDispatcher if available.
   */
  getToolDispatcher(): PalToolDispatcher | undefined {
    return this.toolDispatcher;
  }

  /**
   * Sets or updates the active PalToolDispatcher.
   */
  setToolDispatcher(dispatcher: PalToolDispatcher): void {
    this.toolDispatcher = dispatcher;
  }

  /**
   * Retrieves configured McpToolBridge if available.
   */
  getMcpBridge(): McpToolBridge | undefined {
    return this.mcpBridge;
  }

  /**
   * Sets or updates the active McpToolBridge.
   */
  setMcpBridge(bridge: McpToolBridge): void {
    this.mcpBridge = bridge;
  }

  /**
   * Registers an MCP server client with the adapter's tool dispatcher.
   */
  async registerMcpServer(
    client: IMcpClient,
    options?: McpBridgeOptions
  ): Promise<PalToolDefinition[]> {
    if (!this.toolDispatcher) {
      this.toolDispatcher = createPalToolDispatcher();
    }
    return this.toolDispatcher.registerMcpServer(client, options);
  }

  /**
   * Dispatches tool calls using the adapter's tool dispatcher.
   */
  async dispatchToolCalls(
    calls: PalToolCallContent[],
    context: PalToolExecutionContext,
    options?: { sequential?: boolean; stopOnError?: boolean }
  ): Promise<PalToolResultContent[]> {
    const dispatcher = this.toolDispatcher ?? defaultPalToolDispatcher;
    return dispatcher.dispatchBatch(calls, context, options);
  }

  /**
   * Static and negotiated capabilities of OpenCode provider.
   */
  getCapabilities(): PalProviderCapabilities {
    return {
      providerName: PAL_PROVIDER_NAMES.OPENCODE,
      modelName: this.modelName,
      maxContextTokens: this.maxContextTokens,
      maxOutputTokens: this.maxOutputTokens,
      supportsNativeTools: this.supportsNativeTools,
      supportsStreaming: true,
      supportsExtendedThinking: this.supportsExtendedThinking,
      supportsPromptCaching: false,
    };
  }

  /**
   * Current rate limit telemetry.
   */
  getRateLimitState(): PalRateLimitInfo {
    return { ...this.rateLimitState };
  }

  /**
   * Builds request headers for OpenAI-compatible HTTP requests.
   */
  buildHeaders(_options?: PalSessionOptions): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": OPENCODE_ADAPTER_CONSTANTS.HEADER_CONTENT_TYPE,
      ...this.defaultHeaders,
    };

    if (this.apiKey.trim().length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      headers[
        OPENCODE_ADAPTER_CONSTANTS.HEADER_AUTHORIZATION
      ] = `${OPENCODE_ADAPTER_CONSTANTS.BEARER_PREFIX}${this.apiKey.trim()}`;
    }

    return headers;
  }

  /**
   * Builds endpoint URL for chat completions.
   */
  buildEndpointUrl(): string {
    const trimmedBase = this.baseUrl.replace(/\/+$/, "");
    if (
      trimmedBase.endsWith(
        OPENCODE_ADAPTER_CONSTANTS.CHAT_COMPLETIONS_ENDPOINT
      )
    ) {
      return trimmedBase;
    }
    return `${trimmedBase}${OPENCODE_ADAPTER_CONSTANTS.CHAT_COMPLETIONS_ENDPOINT}`;
  }

  /**
   * Builds request payload for OpenAI-compatible chat completions.
   */
  buildTurnPayload(
    options: PalSessionOptions,
    isStream: boolean
  ): Record<string, unknown> {
    const basePayload = toOpenAiPayload(options.messages);

    // If options.systemPrompt is provided and not already in messages:
    if (options.systemPrompt !== undefined) {
      let systemText = "";
      if (typeof options.systemPrompt === "string") {
        systemText = options.systemPrompt;
      } else if (Array.isArray(options.systemPrompt)) {
        systemText = options.systemPrompt.map((p) => p.text).join("\n");
      }

      if (
        systemText.trim().length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS
      ) {
        const hasSystemMsg = basePayload.messages.some(
          (m) => m.role === PAL_ROLES.SYSTEM
        );
        if (!hasSystemMsg) {
          basePayload.messages.unshift({
            role: PAL_ROLES.SYSTEM,
            content: systemText,
          });
        }
      }
    }

    const payload: Record<string, unknown> = {
      model: this.modelName,
      messages: basePayload.messages,
      stream: isStream,
    };

    if (isStream) {
      payload.stream_options = { include_usage: true };
    }

    if (options.temperature !== undefined) {
      payload.temperature = options.temperature;
    } else {
      payload.temperature = OPENCODE_ADAPTER_CONSTANTS.DEFAULT_TEMPERATURE;
    }

    if (options.maxTokens !== undefined) {
      payload.max_tokens = options.maxTokens;
    } else {
      payload.max_tokens =
        OPENCODE_ADAPTER_CONSTANTS.DEFAULT_MAX_OUTPUT_TOKENS;
    }

    if (
      options.tools &&
      options.tools.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS
    ) {
      if (this.supportsNativeTools) {
        const formattedTools = formatOpenAiTools(options.tools);
        if (formattedTools) {
          payload.tools = formattedTools;
        }

        if (options.toolChoice) {
          const formattedChoice = formatOpenAiToolChoice(options.toolChoice);
          if (formattedChoice) {
            payload.tool_choice = formattedChoice;
          }
        }
      } else {
        const reactInstructions = formatReActToolInstructions(options.tools);
        const sysMsgIndex = (
          basePayload.messages as Array<{ role: string; content: string }>
        ).findIndex((m) => m.role === PAL_ROLES.SYSTEM);

        if (sysMsgIndex >= OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
          const existing = (
            basePayload.messages as Array<{ role: string; content: string }>
          )[sysMsgIndex];
          if (existing) {
            existing.content = `${existing.content}\n\n${reactInstructions}`;
          }
        } else {
          basePayload.messages.unshift({
            role: PAL_ROLES.SYSTEM,
            content: reactInstructions,
          });
        }
      }
    }

    return payload;
  }

  /**
   * Updates internal rate limit tracking state from response headers.
   */
  private updateRateLimitState(headers: Headers): void {
    const parsed = parseOpenAiRateLimitHeaders(headers);
    this.rateLimitState = {
      requestsRemaining:
        parsed.requestsRemaining ?? this.rateLimitState.requestsRemaining,
      requestsLimit: parsed.requestsLimit ?? this.rateLimitState.requestsLimit,
      tokensRemaining:
        parsed.tokensRemaining ?? this.rateLimitState.tokensRemaining,
      tokensLimit: parsed.tokensLimit ?? this.rateLimitState.tokensLimit,
      resetsAt: parsed.resetsAt ?? this.rateLimitState.resetsAt,
    };
  }

  /**
   * Executes a single turn synchronously to completion.
   */
  async executeTurn(options: PalSessionOptions): Promise<PalOutcome> {
    if (this.isCliMode()) {
      return runOpenCodeSubprocess({
        sessionOptions: options,
        cwd: this.cwd,
        model: this.modelName,
        sessionId: options.sessionId,
        deniedBash: this.deniedBash,
        timeoutMs: this.timeoutMs,
        spawnFn: this.spawnFn,
        abortSignal: options.abortSignal,
      });
    }

    const payload = this.buildTurnPayload(options, false);
    const endpoint = this.buildEndpointUrl();
    const headers = this.buildHeaders(options);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (
        (err instanceof Error && err.name === "AbortError") ||
        controller.signal.aborted
      ) {
        throw new PalError(
          PAL_ERROR_KINDS.TIMEOUT,
          `OpenCode/OpenAI API request timed out after ${this.timeoutMs}ms`,
          true,
          undefined,
          err
        );
      }
      throw new PalError(
        PAL_ERROR_KINDS.OVERLOADED,
        `Network failure connecting to OpenCode/OpenAI API: ${String(err)}`,
        true,
        undefined,
        err
      );
    } finally {
      clearTimeout(timeoutId);
    }

    this.updateRateLimitState(response.headers);

    let responseData: unknown;
    try {
      responseData = await response.json();
    } catch (err: unknown) {
      throw new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        `Failed to parse OpenCode/OpenAI JSON response: ${String(err)}`,
        false,
        undefined,
        err
      );
    }

    if (!response.ok) {
      throw parseOpenAiError(response.status, responseData, response.headers);
    }

    if (!isRecord(responseData)) {
      throw new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        "OpenCode/OpenAI API returned non-object response payload",
        false
      );
    }

    const message: PalMessage = fromOpenAiResponse(responseData);
    let finishReason: PalFinishReason = PAL_FINISH_REASONS.STOP;
    if (
      Array.isArray(responseData.choices) &&
      responseData.choices.length > OPENCODE_ADAPTER_CONSTANTS.ZERO_TOKENS &&
      isRecord(responseData.choices[0])
    ) {
      const hasToolCalls = message.content.some(isPalToolCallContent);
      finishReason = mapOpenAiFinishReason(
        responseData.choices[0].finish_reason,
        hasToolCalls
      );
    }

    const usage: PalTokenUsage = calculateOpenAiTokenUsage(
      responseData.usage
    );

    return {
      message,
      finishReason,
      usage,
      rateLimitInfo: this.getRateLimitState(),
    };
  }

  /**
   * Streams turn tokens, thinking blocks, and tool call deltas in real-time.
   */
  async *streamTurn(
    options: PalSessionOptions
  ): AsyncIterable<PalStreamEvent> {
    if (this.isCliMode()) {
      yield* streamOpenCodeSubprocess({
        sessionOptions: options,
        cwd: this.cwd,
        model: this.modelName,
        sessionId: options.sessionId,
        deniedBash: this.deniedBash,
        timeoutMs: this.timeoutMs,
        spawnFn: this.spawnFn,
        abortSignal: options.abortSignal,
      });
      return;
    }

    const payload = this.buildTurnPayload(options, true);
    const endpoint = this.buildEndpointUrl();
    const headers = this.buildHeaders(options);

    const controller = new AbortController();
    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const isAborted =
        (err instanceof Error && err.name === "AbortError") ||
        controller.signal.aborted;
      const errorKind = isAborted
        ? PAL_ERROR_KINDS.TIMEOUT
        : PAL_ERROR_KINDS.OVERLOADED;
      yield {
        type: "error",
        error: new PalError(
          errorKind,
          `OpenCode stream request failed: ${String(err)}`,
          true,
          undefined,
          err
        ),
      };
      return;
    }

    this.updateRateLimitState(response.headers);

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }
      yield {
        type: "error",
        error: parseOpenAiError(response.status, errorData, response.headers),
      };
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        error: new PalError(
          PAL_ERROR_KINDS.INVALID_REQUEST,
          "OpenCode streaming response has no readable body",
          false
        ),
      };
      return;
    }

    const stream = toAsyncIterable<Uint8Array | string>(response.body);
    yield* parseOpenAiStream(stream);
  }
}

/**
 * Singleton instance of OpenCodeAdapter configured with defaults.
 */
export const openCodePalAdapter = new OpenCodeAdapter();

/**
 * Factory function creating an OpenCodeAdapter instance.
 */
export function createOpenCodeAdapter(
  options?: OpenCodeAdapterOptions
): OpenCodeAdapter {
  return new OpenCodeAdapter(options);
}

export {
  formatReActToolInstructions,
  isReActStreamTruncated,
  repairTruncatedJson,
  stitchTruncatedToolCall,
  RECONTINUATION_PROMPT,
  MCP_BRIDGE_CONSTANTS,
  type McpContent,
  type McpTextContent,
  type McpImageContent,
  type McpResourceContent,
  type McpToolSchema,
  type McpCallToolResult,
  type McpServerConfig,
  type IMcpClient,
  type McpBridgeOptions,
  type ValidationResult,
  type PalToolDispatcherOptions,
  InMemoryMcpClient,
  McpToolBridge,
  PalToolDispatcher,
  createInMemoryMcpClient,
  createMcpToolBridge,
  createPalToolDispatcher,
  defaultPalToolDispatcher,
  mcpToolToPalTool,
  palToolToMcpTool,
  batchMcpToolsToPalTools,
  batchPalToolsToMcpTools,
  validateToolArguments,
  formatMcpCallToolResult,
};
