/**
 * Anthropic Claude Provider Adapter (PAL).
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 4 and OpenSpec change
 * proposal `looper-pal-claude-adapter`.
 *
 * Adheres to `ProviderAdapter` (`IPalProvider`) interface, integrating Claude Sonnet 3.7
 * with prompt caching, extended thinking blocks, atomic tool reconciliation,
 * and canonical PAL telemetry.
 */

import { randomUUID } from "node:crypto";
import {
  repairJsonArguments,
  toClaudePayload,
  fromClaudeResponse,
} from "../normalizer";
import {
  PAL_ERROR_KINDS,
  PAL_FINISH_REASONS,
  PAL_PROVIDER_NAMES,
  PAL_ROLES,
  PalError,
  createPalMessage,
  createTextBlock,
  createThoughtBlock,
  createToolCallBlock,
  type ClaudeContentBlock,
  type ClaudeTurnMessage,
  type IPalProvider,
  type PalContentBlock,
  type PalFinishReason,
  type PalMessage,
  type PalOutcome,
  type PalPromptCachingOptions,
  type PalProviderCapabilities,
  type PalProviderName,
  type PalRateLimitInfo,
  type PalSessionOptions,
  type PalStreamEvent,
  type PalSystemPromptPart,
  type PalThinkingOptions,
  type PalTokenUsage,
  type PalToolChoice,
  type ProviderAdapter,
} from "../types";

/**
 * Central constants ensuring zero magic numbers across ClaudeAdapter operations.
 */
export const CLAUDE_ADAPTER_CONSTANTS = {
  // Model defaults
  DEFAULT_MODEL: "claude-3-7-sonnet-20250219",

  // Context & Token Limits
  MAX_CONTEXT_TOKENS: 200_000,
  MAX_OUTPUT_TOKENS: 64_000,
  MAX_OUTPUT_TOKENS_EXTENDED: 128_000,
  DEFAULT_MAX_TOKENS: 4_096,
  DEFAULT_THINKING_BUDGET_TOKENS: 2_048,
  MIN_THINKING_BUDGET_TOKENS: 1_024,
  MAX_THINKING_BUDGET_TOKENS: 64_000,
  DEFAULT_COMPLETION_HEADROOM_TOKENS: 2_048,
  ZERO_TOKENS: 0,
  TEMPERATURE_THINKING: 1.0,

  // Prompt Caching Limits & Betas
  MAX_CACHE_BREAKPOINTS: 4,
  PROMPT_CACHING_BETA: "prompt-caching-2024-07-31",
  OUTPUT_128K_BETA: "output-128k-2025-02-19",
  DEFAULT_BETAS: ["prompt-caching-2024-07-31", "output-128k-2025-02-19"],

  // Network & Endpoint Defaults
  DEFAULT_BASE_URL: "https://api.anthropic.com",
  MESSAGES_ENDPOINT: "/v1/messages",
  DEFAULT_TIMEOUT_MS: 60_000,
  MS_PER_SECOND: 1_000,
  RATE_LIMIT_RESET_FALLBACK_MS: 60_000,

  // Anthropic API Protocol Headers & Versions
  ANTHROPIC_VERSION: "2023-06-01",
  ANTHROPIC_BETAS: "prompt-caching-2024-07-31,output-128k-2025-02-19",
  HEADER_CONTENT_TYPE: "application/json",
  HEADER_API_KEY_NAME: "x-api-key",
  HEADER_ANTHROPIC_VERSION: "anthropic-version",
  HEADER_ANTHROPIC_BETA: "anthropic-beta",

  // Initial Telemetry Limits
  INITIAL_REQUESTS_LIMIT: 1_000,
  INITIAL_REQUESTS_REMAINING: 1_000,
  INITIAL_TOKENS_LIMIT: 100_000,
  INITIAL_TOKENS_REMAINING: 100_000,
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

  // SSE Parsing Literals
  SSE_DATA_PREFIX: "data: ",
  SSE_EVENT_PREFIX: "event: ",
  SSE_COMMENT_PREFIX: ":",
  SSE_DONE_SIGNAL: "[DONE]",
  DEFAULT_BLOCK_INDEX: 0,
  TEXT_DECODER_ENCODING: "utf-8",
  FALLBACK_TOOL_NAME: "unknown_tool",
} as const;

/**
 * Options for configuring ClaudeAdapter.
 */
export interface ClaudeAdapterOptions {
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  enablePromptCaching?: boolean;
  betas?: string[];
  defaultThinking?: PalThinkingOptions;
  defaultThinkingBudget?: number;
}

/**
 * Safe type guard checking if an unknown value is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Formats comma-delimited Anthropic beta header containing prompt caching and requested betas.
 */
export function formatPromptCachingBetaHeader(
  betas: readonly string[] | string[],
  enablePromptCaching: boolean
): string | undefined {
  const betaSet = new Set<string>();
  for (const beta of betas) {
    if (beta === CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA) {
      if (enablePromptCaching) {
        betaSet.add(beta);
      }
    } else {
      betaSet.add(beta);
    }
  }
  if (enablePromptCaching) {
    betaSet.add(CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA);
  }

  if (betaSet.size === CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
    return undefined;
  }
  return Array.from(betaSet).join(",");
}

/**
 * Strips ephemeral cache_control breakpoints from messages when prompt caching is disabled.
 */
export function stripCacheControlFromMessages(
  messages: ClaudeTurnMessage[]
): ClaudeTurnMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return msg;
    }
    const strippedContent = msg.content.map((block) => {
      if ("cache_control" in block && block.cache_control !== undefined) {
        const { cache_control: _omitted, ...rest } = block;
        return rest;
      }
      return block;
    });
    return {
      role: msg.role,
      content: strippedContent as ClaudeContentBlock[],
    };
  });
}

/**
 * Counts total ephemeral cache_control breakpoints across system, messages, and tools.
 */
export function countCacheBreakpoints(payload: Record<string, unknown>): number {
  let count = CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS;

  // Check system
  if (Array.isArray(payload.system)) {
    for (const part of payload.system) {
      if (isRecord(part) && isRecord(part.cache_control)) {
        count += 1;
      }
    }
  }

  // Check messages
  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      if (isRecord(msg) && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (isRecord(block) && isRecord(block.cache_control)) {
            count += 1;
          }
        }
      }
    }
  }

  // Check tools
  if (Array.isArray(payload.tools)) {
    for (const tool of payload.tools) {
      if (isRecord(tool) && isRecord(tool.cache_control)) {
        count += 1;
      }
    }
  }

  return count;
}

/**
 * Validates that extended thinking budget adheres to Anthropic constraints.
 */
export function validateThinkingBudget(budgetTokens: number): void {
  if (budgetTokens < CLAUDE_ADAPTER_CONSTANTS.MIN_THINKING_BUDGET_TOKENS) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      `Extended thinking budget (${budgetTokens} tokens) must be at least ${CLAUDE_ADAPTER_CONSTANTS.MIN_THINKING_BUDGET_TOKENS} tokens`,
      false
    );
  }
  if (budgetTokens > CLAUDE_ADAPTER_CONSTANTS.MAX_THINKING_BUDGET_TOKENS) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      `Extended thinking budget (${budgetTokens} tokens) exceeds maximum allowed limit (${CLAUDE_ADAPTER_CONSTANTS.MAX_THINKING_BUDGET_TOKENS} tokens)`,
      false
    );
  }
}

/**
 * Formats canonical PAL tool choice into Anthropic tool_choice schema.
 */
export function formatClaudeToolChoice(
  choice?: PalToolChoice
): Record<string, unknown> | undefined {
  if (!choice || choice === "auto") {
    return { type: "auto" };
  }
  if (choice === "none") {
    return undefined;
  }
  if (choice === "required") {
    return { type: "any" };
  }
  if (typeof choice === "object" && choice.type === "tool") {
    return { type: "tool", name: choice.toolName };
  }
  return undefined;
}

/**
 * Maps Anthropic stop reasons to canonical PalFinishReason.
 */
export function mapClaudeStopReason(stopReason: unknown): PalFinishReason {
  if (typeof stopReason !== "string") {
    return PAL_FINISH_REASONS.STOP;
  }

  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return PAL_FINISH_REASONS.STOP;
    case "max_tokens":
      return PAL_FINISH_REASONS.LENGTH;
    case "tool_use":
      return PAL_FINISH_REASONS.TOOL_CALLS;
    case "content_filter":
      return PAL_FINISH_REASONS.CONTENT_FILTER;
    default:
      return PAL_FINISH_REASONS.STOP;
  }
}

/**
 * Extracts and accumulates token telemetry from Anthropic API usage payload.
 *
 * Invariant: When extended thinking is configured, thinking tokens are
 * accumulated separately from completion tokens.
 */
export function calculateClaudeTokenUsage(rawUsage: unknown): PalTokenUsage {
  if (!isRecord(rawUsage)) {
    return {
      promptTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    };
  }

  const promptTokens =
    typeof rawUsage.input_tokens === "number"
      ? rawUsage.input_tokens
      : CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS;

  const rawOutputTokens =
    typeof rawUsage.output_tokens === "number"
      ? rawUsage.output_tokens
      : CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS;

  // Thinking tokens may be provided as thinking_tokens or inside output_tokens_details
  let thinkingTokens: number | undefined;
  if (typeof rawUsage.thinking_tokens === "number") {
    thinkingTokens = rawUsage.thinking_tokens;
  } else if (
    isRecord(rawUsage.output_tokens_details) &&
    typeof rawUsage.output_tokens_details.thinking_tokens === "number"
  ) {
    thinkingTokens = rawUsage.output_tokens_details.thinking_tokens;
  }

  let completionTokens: number;
  if (typeof rawUsage.completion_tokens === "number") {
    completionTokens = rawUsage.completion_tokens;
  } else if (
    thinkingTokens !== undefined &&
    thinkingTokens > CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS
  ) {
    // Anthropic bundles thinking tokens inside output_tokens, so separate them
    completionTokens = Math.max(
      CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      rawOutputTokens - thinkingTokens
    );
  } else {
    completionTokens = rawOutputTokens;
  }

  const cachedPromptTokens =
    typeof rawUsage.cache_read_input_tokens === "number"
      ? rawUsage.cache_read_input_tokens
      : undefined;

  const cacheCreationInputTokens =
    typeof rawUsage.cache_creation_input_tokens === "number"
      ? rawUsage.cache_creation_input_tokens
      : undefined;

  const totalTokens =
    typeof rawUsage.total_tokens === "number"
      ? rawUsage.total_tokens
      : promptTokens +
        completionTokens +
        (thinkingTokens ?? CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
    ...(cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens }
      : {}),
    ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
  };
}

/**
 * Parses Anthropic rate limit response headers.
 */
export function parseClaudeRateLimitHeaders(
  headers: Headers
): Partial<PalRateLimitInfo> {
  const result: Partial<PalRateLimitInfo> = {};

  const reqLimit = headers.get("anthropic-ratelimit-requests-limit");
  if (reqLimit) {
    const val = Number(reqLimit);
    if (!isNaN(val)) result.requestsLimit = val;
  }

  const reqRemaining = headers.get("anthropic-ratelimit-requests-remaining");
  if (reqRemaining) {
    const val = Number(reqRemaining);
    if (!isNaN(val)) result.requestsRemaining = val;
  }

  const tokLimit = headers.get("anthropic-ratelimit-tokens-limit");
  if (tokLimit) {
    const val = Number(tokLimit);
    if (!isNaN(val)) result.tokensLimit = val;
  }

  const tokRemaining = headers.get("anthropic-ratelimit-tokens-remaining");
  if (tokRemaining) {
    const val = Number(tokRemaining);
    if (!isNaN(val)) result.tokensRemaining = val;
  }

  const reqReset = headers.get("anthropic-ratelimit-requests-reset");
  if (reqReset) {
    const parsedDate = Date.parse(reqReset);
    if (!isNaN(parsedDate)) {
      result.resetsAt = parsedDate;
    } else {
      const parsedSec = Number(reqReset);
      if (!isNaN(parsedSec)) {
        result.resetsAt =
          Date.now() + parsedSec * CLAUDE_ADAPTER_CONSTANTS.MS_PER_SECOND;
      }
    }
  }

  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const parsedSec = Number(retryAfter);
    if (!isNaN(parsedSec)) {
      result.resetsAt =
        Date.now() + parsedSec * CLAUDE_ADAPTER_CONSTANTS.MS_PER_SECOND;
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
 * Maps Anthropic HTTP error responses into standardized PalError instances.
 */
export function parseClaudeError(
  status: number,
  data: unknown,
  headers?: Headers
): PalError {
  let message = `Anthropic API request failed with status ${status}`;
  let errorType = "";

  if (isRecord(data) && isRecord(data.error)) {
    if (typeof data.error.message === "string") {
      message = data.error.message;
    }
    if (typeof data.error.type === "string") {
      errorType = data.error.type;
    }
  }

  let resetsAt: number | undefined;
  if (headers) {
    const parsedRateLimit = parseClaudeRateLimitHeaders(headers);
    resetsAt = parsedRateLimit.resetsAt;
  }

  if (
    status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_TOO_MANY_REQUESTS ||
    errorType === "rate_limit_error"
  ) {
    return new PalError(
      PAL_ERROR_KINDS.RATE_LIMIT,
      message,
      true,
      resetsAt ??
        Date.now() + CLAUDE_ADAPTER_CONSTANTS.RATE_LIMIT_RESET_FALLBACK_MS,
      data
    );
  }

  if (
    status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_OVERLOADED ||
    status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_SERVICE_UNAVAILABLE ||
    status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_BAD_GATEWAY ||
    status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_GATEWAY_TIMEOUT ||
    errorType === "overloaded_error"
  ) {
    return new PalError(
      PAL_ERROR_KINDS.OVERLOADED,
      message,
      true,
      undefined,
      data
    );
  }

  if (
    status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_UNAUTHORIZED ||
    status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_FORBIDDEN ||
    errorType === "authentication_error" ||
    errorType === "permission_error"
  ) {
    return new PalError(
      PAL_ERROR_KINDS.AUTH_FAILURE,
      message,
      false,
      undefined,
      data
    );
  }

  if (status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_REQUEST_TIMEOUT) {
    return new PalError(PAL_ERROR_KINDS.TIMEOUT, message, true, undefined, data);
  }

  if (status === CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_BAD_REQUEST) {
    const lower = message.toLowerCase();
    if (
      lower.includes("prompt is too long") ||
      lower.includes("context_length_exceeded") ||
      lower.includes("maximum context length") ||
      lower.includes("prompt exceeds")
    ) {
      return new PalError(
        PAL_ERROR_KINDS.CONTEXT_EXCEEDED,
        message,
        false,
        undefined,
        data
      );
    }
    return new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      message,
      false,
      undefined,
      data
    );
  }

  return new PalError(
    PAL_ERROR_KINDS.INVALID_REQUEST,
    message,
    false,
    undefined,
    data
  );
}

/**
 * Anthropic Claude Provider Adapter.
 *
 * Implements `ProviderAdapter` (`IPalProvider`) interface, integrating Claude Sonnet 3.7
 * with prompt caching, extended thinking blocks, atomic tool reconciliation,
 * and canonical PAL telemetry.
 */
export class ClaudeAdapter implements ProviderAdapter {
  readonly providerName: PalProviderName = PAL_PROVIDER_NAMES.CLAUDE;
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly enablePromptCaching: boolean;
  private readonly configuredBetas: string[];
  private readonly defaultThinking?: PalThinkingOptions;

  private rateLimitState: PalRateLimitInfo = {
    requestsRemaining: CLAUDE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_REMAINING,
    requestsLimit: CLAUDE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_LIMIT,
    tokensRemaining: CLAUDE_ADAPTER_CONSTANTS.INITIAL_TOKENS_REMAINING,
    tokensLimit: CLAUDE_ADAPTER_CONSTANTS.INITIAL_TOKENS_LIMIT,
    resetsAt: CLAUDE_ADAPTER_CONSTANTS.INITIAL_RESETS_AT,
  };

  constructor(options?: ClaudeAdapterOptions) {
    this.modelName =
      options?.modelName ?? CLAUDE_ADAPTER_CONSTANTS.DEFAULT_MODEL;
    this.apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.baseUrl =
      options?.baseUrl ??
      process.env.ANTHROPIC_BASE_URL ??
      CLAUDE_ADAPTER_CONSTANTS.DEFAULT_BASE_URL;
    this.timeoutMs =
      options?.timeoutMs ?? CLAUDE_ADAPTER_CONSTANTS.DEFAULT_TIMEOUT_MS;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.defaultHeaders = options?.defaultHeaders ?? {};
    this.enablePromptCaching = options?.enablePromptCaching ?? true;
    this.configuredBetas = options?.betas
      ? [...options.betas]
      : [...CLAUDE_ADAPTER_CONSTANTS.DEFAULT_BETAS];
    this.defaultThinking = options?.defaultThinking;
  }

  /**
   * Returns whether prompt caching is enabled by default on this adapter instance.
   */
  isPromptCachingEnabled(): boolean {
    return this.enablePromptCaching;
  }

  /**
   * Retrieves configured default extended thinking options if set.
   */
  getDefaultThinking(): PalThinkingOptions | undefined {
    return this.defaultThinking ? { ...this.defaultThinking } : undefined;
  }

  /**
   * Resolves active thinking options merging session options with adapter defaults.
   */
  resolveThinkingOptions(
    sessionThinking?: PalThinkingOptions
  ): PalThinkingOptions | undefined {
    if (sessionThinking !== undefined) {
      return sessionThinking;
    }
    return this.defaultThinking;
  }

  /**
   * Resolves and validates extended thinking budget.
   * Enforces Anthropic requirements: budget_tokens >= 1024 and within maximum limits.
   */
  resolveThinkingBudget(thinking?: PalThinkingOptions): number | undefined {
    if (!thinking?.enabled) {
      return undefined;
    }
    const budget =
      thinking.budgetTokens ??
      CLAUDE_ADAPTER_CONSTANTS.DEFAULT_THINKING_BUDGET_TOKENS;
    validateThinkingBudget(budget);
    return budget;
  }

  /**
   * Determines active prompt caching and extended capability beta header string.
   */
  getAnthropicBetaHeader(sessionPromptCaching?: boolean): string | undefined {
    const isCaching =
      sessionPromptCaching !== undefined
        ? sessionPromptCaching
        : this.enablePromptCaching;
    return formatPromptCachingBetaHeader(this.configuredBetas, isCaching);
  }

  /**
   * Prepares standard Anthropic API request headers including prompt caching beta.
   */
  buildHeaders(sessionOptions?: PalSessionOptions): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": CLAUDE_ADAPTER_CONSTANTS.HEADER_CONTENT_TYPE,
      [CLAUDE_ADAPTER_CONSTANTS.HEADER_ANTHROPIC_VERSION]:
        CLAUDE_ADAPTER_CONSTANTS.ANTHROPIC_VERSION,
      ...this.defaultHeaders,
    };

    const sessionPromptCaching =
      typeof sessionOptions?.promptCaching === "boolean"
        ? sessionOptions.promptCaching
        : typeof sessionOptions?.promptCaching === "object"
        ? sessionOptions.promptCaching.enabled
        : undefined;

    const betaHeader = this.getAnthropicBetaHeader(sessionPromptCaching);
    if (betaHeader) {
      headers[CLAUDE_ADAPTER_CONSTANTS.HEADER_ANTHROPIC_BETA] = betaHeader;
    }

    if (this.apiKey) {
      headers[CLAUDE_ADAPTER_CONSTANTS.HEADER_API_KEY_NAME] = this.apiKey;
    }

    return headers;
  }

  /**
   * Retrieves static and negotiated provider capabilities.
   */
  getCapabilities(): PalProviderCapabilities {
    return {
      providerName: this.providerName,
      modelName: this.modelName,
      maxContextTokens: CLAUDE_ADAPTER_CONSTANTS.MAX_CONTEXT_TOKENS,
      maxOutputTokens: CLAUDE_ADAPTER_CONSTANTS.MAX_OUTPUT_TOKENS,
      supportsNativeTools: true,
      supportsStreaming: true,
      supportsExtendedThinking: true,
      supportsPromptCaching: true,
    };
  }

  /**
   * Retrieves current rate limiting window telemetry.
   */
  getRateLimitState(): PalRateLimitInfo {
    return { ...this.rateLimitState };
  }

  /**
   * Builds the Anthropic Messages API wire request payload.
   */
  buildTurnPayload(
    options: PalSessionOptions,
    stream: boolean = false
  ): Record<string, unknown> {
    const claudePayload = toClaudePayload(options.messages);

    const isCachingEnabled =
      typeof options.promptCaching === "boolean"
        ? options.promptCaching
        : typeof options.promptCaching === "object"
        ? options.promptCaching.enabled ?? this.enablePromptCaching
        : this.enablePromptCaching;

    // Merge system prompt from options with any system messages normalized from conversation
    const systemParts: Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral" };
    }> = [];

    if (Array.isArray(claudePayload.system)) {
      for (const part of claudePayload.system) {
        systemParts.push({
          type: "text",
          text: part.text,
          ...(isCachingEnabled && part.cache_control
            ? { cache_control: part.cache_control }
            : {}),
        });
      }
    } else if (typeof claudePayload.system === "string") {
      systemParts.push({ type: "text", text: claudePayload.system });
    }

    if (typeof options.systemPrompt === "string") {
      systemParts.push({ type: "text", text: options.systemPrompt });
    } else if (Array.isArray(options.systemPrompt)) {
      for (const part of options.systemPrompt) {
        systemParts.push({
          type: "text",
          text: part.text,
          ...(isCachingEnabled && part.cacheControl
            ? { cache_control: { type: part.cacheControl.type } }
            : {}),
        });
      }
    }

    // Extended thinking configuration
    const activeThinking = this.resolveThinkingOptions(options.thinking);
    const thinkingBudget = this.resolveThinkingBudget(activeThinking);
    const isThinkingEnabled = thinkingBudget !== undefined;

    // Anthropic API requires max_tokens to be strictly greater than thinking.budget_tokens
    let maxTokens: number;
    if (isThinkingEnabled && thinkingBudget !== undefined) {
      if (options.maxTokens !== undefined && options.maxTokens > thinkingBudget) {
        maxTokens = options.maxTokens;
      } else {
        maxTokens =
          thinkingBudget +
          CLAUDE_ADAPTER_CONSTANTS.DEFAULT_COMPLETION_HEADROOM_TOKENS;
      }
    } else {
      maxTokens =
        options.maxTokens ?? CLAUDE_ADAPTER_CONSTANTS.DEFAULT_MAX_TOKENS;
    }

    const payload: Record<string, unknown> = {
      model: this.modelName,
      messages: isCachingEnabled
        ? claudePayload.messages
        : stripCacheControlFromMessages(claudePayload.messages),
      max_tokens: maxTokens,
    };

    if (systemParts.length > 0) {
      payload.system = systemParts;
    }

    if (stream) {
      payload.stream = true;
    }

    if (isThinkingEnabled && thinkingBudget !== undefined) {
      payload.thinking = {
        type: "enabled",
        budget_tokens: thinkingBudget,
      };
      // When thinking is enabled, Anthropic requires temperature to be omitted or set to 1.0
      payload.temperature = CLAUDE_ADAPTER_CONSTANTS.TEMPERATURE_THINKING;
    } else if (options.temperature !== undefined) {
      payload.temperature = options.temperature;
    }

    // Tools definition mapping
    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        ...(isCachingEnabled && tool.cacheControl
          ? { cache_control: { type: tool.cacheControl.type } }
          : {}),
      }));

      const toolChoice = formatClaudeToolChoice(options.toolChoice);
      if (toolChoice) {
        payload.tool_choice = toolChoice;
      }
    }

    // Validate prompt cache breakpoints count does not exceed limit
    const cacheBreakpointsCount = countCacheBreakpoints(payload);
    if (cacheBreakpointsCount > CLAUDE_ADAPTER_CONSTANTS.MAX_CACHE_BREAKPOINTS) {
      throw new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        `Anthropic allows a maximum of ${CLAUDE_ADAPTER_CONSTANTS.MAX_CACHE_BREAKPOINTS} cache_control breakpoints per request, but found ${cacheBreakpointsCount}`,
        false
      );
    }

    return payload;
  }

  /**
   * Updates internal rate limit tracking state from response headers.
   */
  private updateRateLimitState(headers: Headers): void {
    const parsed = parseClaudeRateLimitHeaders(headers);
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
    const payload = this.buildTurnPayload(options, false);
    const endpoint = `${this.baseUrl}${CLAUDE_ADAPTER_CONSTANTS.MESSAGES_ENDPOINT}`;
    const headers = this.buildHeaders(options);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    // Link optional abort signal
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
          `Anthropic API request timed out after ${this.timeoutMs}ms`,
          true,
          undefined,
          err
        );
      }
      throw new PalError(
        PAL_ERROR_KINDS.OVERLOADED,
        `Network failure connecting to Anthropic API: ${String(err)}`,
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
        `Failed to parse Anthropic JSON response: ${String(err)}`,
        false,
        undefined,
        err
      );
    }

    if (!response.ok) {
      throw parseClaudeError(response.status, responseData, response.headers);
    }

    if (!isRecord(responseData)) {
      throw new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        "Anthropic API returned non-object response payload",
        false
      );
    }

    const message: PalMessage = fromClaudeResponse(responseData);
    const finishReason = mapClaudeStopReason(responseData.stop_reason);
    const usage = calculateClaudeTokenUsage(responseData.usage);

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
    const payload = this.buildTurnPayload(options, true);
    const endpoint = `${this.baseUrl}${CLAUDE_ADAPTER_CONSTANTS.MESSAGES_ENDPOINT}`;
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
          `Failed to initiate Anthropic streaming connection: ${String(err)}`,
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
        errorData = undefined;
      }
      yield {
        type: "error",
        error: parseClaudeError(response.status, errorData, response.headers),
      };
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        error: new PalError(
          PAL_ERROR_KINDS.INVALID_REQUEST,
          "Anthropic streaming response body is null",
          false
        ),
      };
      return;
    }

    const parser = new ClaudeStreamChunkParser();
    try {
      for await (const event of parser.parse(response.body)) {
        yield event;
      }
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
          `Error reading stream from Anthropic API: ${String(err)}`,
          true,
          undefined,
          err
        ),
      };
    }
  }
}

/**
 * Active content block representation tracked by the streaming chunk parser.
 */
export interface ActiveContentBlock {
  index: number;
  type: "text" | "thinking" | "redacted_thinking" | "tool_use" | "unknown";
  text?: string;
  thinking?: string;
  signature?: string;
  toolId?: string;
  toolName?: string;
  argumentsBuffer?: string;
  arguments?: Record<string, unknown>;
  completed?: boolean;
}

/**
 * Options for configuring ClaudeStreamChunkParser behavior.
 */
export interface ClaudeStreamChunkParserOptions {
  onEvent?: (event: PalStreamEvent) => void;
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
  source: ReadableStream<T> | AsyncIterable<T> | Iterable<T>
): AsyncIterable<T> {
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
 * Streaming chunk parser for Anthropic Claude content blocks and SSE messages.
 *
 * Implements incremental chunk decoding, multi-line SSE buffer management,
 * text/thinking block delta aggregation, cryptographic signature capture,
 * tool invocation parsing with JSON repair, token telemetry accumulation,
 * and canonical PAL event emission.
 */
export class ClaudeStreamChunkParser {
  private lineBuffer: string = "";
  private readonly decoder: TextDecoder = new TextDecoder(
    CLAUDE_ADAPTER_CONSTANTS.TEXT_DECODER_ENCODING
  );
  private readonly onEvent?: (event: PalStreamEvent) => void;

  private accumulatedUsage: PalTokenUsage = {
    promptTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    completionTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    totalTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
  };
  private finishReason: PalFinishReason = PAL_FINISH_REASONS.STOP;
  private messageId?: string;
  private model?: string;
  private isDone: boolean = false;

  private readonly contentBlocks: Map<number, ActiveContentBlock> = new Map();

  constructor(options?: ClaudeStreamChunkParserOptions) {
    this.onEvent = options?.onEvent;
  }

  /**
   * Resets parser state for reuse on a fresh stream.
   */
  reset(): void {
    this.lineBuffer = "";
    this.contentBlocks.clear();
    this.accumulatedUsage = {
      promptTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS,
    };
    this.finishReason = PAL_FINISH_REASONS.STOP;
    this.messageId = undefined;
    this.model = undefined;
    this.isDone = false;
  }

  /**
   * Returns current accumulated token usage telemetry.
   */
  getUsage(): PalTokenUsage {
    return { ...this.accumulatedUsage };
  }

  /**
   * Returns current finish reason.
   */
  getFinishReason(): PalFinishReason {
    return this.finishReason;
  }

  /**
   * Returns message ID captured from message_start if available.
   */
  getMessageId(): string | undefined {
    return this.messageId;
  }

  /**
   * Returns model name captured from message_start if available.
   */
  getModel(): string | undefined {
    return this.model;
  }

  /**
   * Returns whether the stream has completed.
   */
  isCompleted(): boolean {
    return this.isDone;
  }

  /**
   * Returns all tracked content blocks sorted by index.
   */
  getContentBlocks(): ActiveContentBlock[] {
    return Array.from(this.contentBlocks.entries())
      .sort(([a], [b]) => a - b)
      .map(([_, block]) => ({ ...block }));
  }

  /**
   * Feeds a binary or string chunk into the parser and emits all parsed events.
   */
  feed(chunk: Uint8Array | string): PalStreamEvent[] {
    if (this.isDone) {
      return [];
    }

    if (chunk instanceof Uint8Array) {
      this.lineBuffer += this.decoder.decode(chunk, { stream: true });
    } else if (typeof chunk === "string") {
      this.lineBuffer += chunk;
    }

    const events: PalStreamEvent[] = [];
    const lines = this.lineBuffer.split("\n");
    // Preserve partial trailing line in buffer
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const lineEvents = this.feedLine(line);
      for (const ev of lineEvents) {
        events.push(ev);
        this.onEvent?.(ev);
      }
    }

    return events;
  }

  /**
   * Parses an individual SSE line and returns resulting events.
   */
  feedLine(line: string): PalStreamEvent[] {
    let rawLine = line;
    if (rawLine.endsWith("\r")) {
      rawLine = rawLine.slice(0, -1);
    }

    const trimmed = rawLine.trim();
    if (
      trimmed.length === CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS ||
      trimmed.startsWith(CLAUDE_ADAPTER_CONSTANTS.SSE_COMMENT_PREFIX) ||
      trimmed.startsWith(CLAUDE_ADAPTER_CONSTANTS.SSE_EVENT_PREFIX)
    ) {
      return [];
    }

    if (trimmed.startsWith(CLAUDE_ADAPTER_CONSTANTS.SSE_DATA_PREFIX)) {
      const dataStr = trimmed
        .slice(CLAUDE_ADAPTER_CONSTANTS.SSE_DATA_PREFIX.length)
        .trim();

      if (dataStr === CLAUDE_ADAPTER_CONSTANTS.SSE_DONE_SIGNAL) {
        return [];
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        return [];
      }

      if (!isRecord(parsed)) {
        return [];
      }

      return this.feedWireEvent(parsed);
    }

    return [];
  }

  /**
   * Processes a structured Anthropic wire event payload.
   */
  feedWireEvent(eventObj: Record<string, unknown>): PalStreamEvent[] {
    const eventType = typeof eventObj.type === "string" ? eventObj.type : "";

    switch (eventType) {
      case "message_start":
        return this.handleMessageStart(eventObj);
      case "content_block_start":
        return this.handleContentBlockStart(eventObj);
      case "content_block_delta":
        return this.handleContentBlockDelta(eventObj);
      case "content_block_stop":
        return this.handleContentBlockStop(eventObj);
      case "message_delta":
        return this.handleMessageDelta(eventObj);
      case "message_stop":
        return this.handleMessageStop();
      case "error":
        return this.handleError(eventObj);
      case "ping":
      default:
        return [];
    }
  }

  private handleMessageStart(
    eventObj: Record<string, unknown>
  ): PalStreamEvent[] {
    if (isRecord(eventObj.message)) {
      if (typeof eventObj.message.id === "string") {
        this.messageId = eventObj.message.id;
      }
      if (typeof eventObj.message.model === "string") {
        this.model = eventObj.message.model;
      }
      if (isRecord(eventObj.message.usage)) {
        this.accumulatedUsage = calculateClaudeTokenUsage(
          eventObj.message.usage
        );
      }
    }
    return [];
  }

  private handleContentBlockStart(
    eventObj: Record<string, unknown>
  ): PalStreamEvent[] {
    const events: PalStreamEvent[] = [];
    const index =
      typeof eventObj.index === "number"
        ? eventObj.index
        : CLAUDE_ADAPTER_CONSTANTS.DEFAULT_BLOCK_INDEX;

    if (!isRecord(eventObj.content_block)) {
      return events;
    }

    const block = eventObj.content_block;
    const blockType = typeof block.type === "string" ? block.type : "unknown";

    if (blockType === "text") {
      const text = typeof block.text === "string" ? block.text : "";
      this.contentBlocks.set(index, {
        index,
        type: "text",
        text,
      });
      if (text.length > CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
        events.push({ type: "text_delta", text });
      }
    } else if (blockType === "thinking") {
      const thinking = typeof block.thinking === "string" ? block.thinking : "";
      this.contentBlocks.set(index, {
        index,
        type: "thinking",
        thinking,
      });
      if (thinking.length > CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
        events.push({ type: "thought_delta", thought: thinking });
      }
    } else if (blockType === "redacted_thinking") {
      this.contentBlocks.set(index, {
        index,
        type: "redacted_thinking",
        text: typeof block.data === "string" ? block.data : "",
      });
    } else if (blockType === "tool_use") {
      const id = typeof block.id === "string" ? block.id : randomUUID();
      const name =
        typeof block.name === "string"
          ? block.name
          : CLAUDE_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME;
      this.contentBlocks.set(index, {
        index,
        type: "tool_use",
        toolId: id,
        toolName: name,
        argumentsBuffer: "",
      });
    }

    return events;
  }

  private handleContentBlockDelta(
    eventObj: Record<string, unknown>
  ): PalStreamEvent[] {
    const events: PalStreamEvent[] = [];
    const index =
      typeof eventObj.index === "number"
        ? eventObj.index
        : CLAUDE_ADAPTER_CONSTANTS.DEFAULT_BLOCK_INDEX;

    if (!isRecord(eventObj.delta)) {
      return events;
    }

    const delta = eventObj.delta;
    const deltaType = typeof delta.type === "string" ? delta.type : "";

    let block = this.contentBlocks.get(index);
    if (!block) {
      block = {
        index,
        type:
          deltaType === "thinking_delta" || deltaType === "signature_delta"
            ? "thinking"
            : deltaType === "input_json_delta"
            ? "tool_use"
            : "text",
      };
      this.contentBlocks.set(index, block);
    }

    if (deltaType === "text_delta" && typeof delta.text === "string") {
      block.text = (block.text ?? "") + delta.text;
      events.push({ type: "text_delta", text: delta.text });
    } else if (
      deltaType === "thinking_delta" &&
      typeof delta.thinking === "string"
    ) {
      block.thinking = (block.thinking ?? "") + delta.thinking;
      events.push({ type: "thought_delta", thought: delta.thinking });
    } else if (
      deltaType === "signature_delta" &&
      typeof delta.signature === "string"
    ) {
      block.signature = (block.signature ?? "") + delta.signature;
      events.push({
        type: "thought_delta",
        thought: "",
        signature: delta.signature,
      });
    } else if (
      deltaType === "input_json_delta" &&
      typeof delta.partial_json === "string"
    ) {
      block.argumentsBuffer = (block.argumentsBuffer ?? "") + delta.partial_json;
      events.push({
        type: "tool_call_delta",
        id: block.toolId ?? randomUUID(),
        name: block.toolName,
        argumentsDelta: delta.partial_json,
      });
    }

    return events;
  }

  private handleContentBlockStop(
    eventObj: Record<string, unknown>
  ): PalStreamEvent[] {
    const events: PalStreamEvent[] = [];
    const index =
      typeof eventObj.index === "number"
        ? eventObj.index
        : CLAUDE_ADAPTER_CONSTANTS.DEFAULT_BLOCK_INDEX;

    const block = this.contentBlocks.get(index);
    if (block) {
      block.completed = true;
      if (block.type === "tool_use") {
        const rawArgs = block.argumentsBuffer ?? "";
        const parsedArgs = repairJsonArguments(rawArgs);
        block.arguments = parsedArgs;
        events.push({
          type: "tool_call_end",
          id: block.toolId ?? randomUUID(),
          name: block.toolName ?? CLAUDE_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME,
          arguments: parsedArgs,
        });
      }
    }

    return events;
  }

  private handleMessageDelta(
    eventObj: Record<string, unknown>
  ): PalStreamEvent[] {
    if (isRecord(eventObj.delta) && eventObj.delta.stop_reason) {
      this.finishReason = mapClaudeStopReason(eventObj.delta.stop_reason);
    }

    if (isRecord(eventObj.usage)) {
      const deltaUsage = calculateClaudeTokenUsage(eventObj.usage);
      const promptTokens =
        deltaUsage.promptTokens || this.accumulatedUsage.promptTokens;
      const completionTokens =
        deltaUsage.completionTokens || this.accumulatedUsage.completionTokens;
      const thinkingTokens =
        deltaUsage.thinkingTokens ?? this.accumulatedUsage.thinkingTokens;

      this.accumulatedUsage = {
        promptTokens,
        completionTokens,
        ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
        cachedPromptTokens:
          deltaUsage.cachedPromptTokens ??
          this.accumulatedUsage.cachedPromptTokens,
        cacheCreationInputTokens:
          deltaUsage.cacheCreationInputTokens ??
          this.accumulatedUsage.cacheCreationInputTokens,
        totalTokens:
          promptTokens +
          completionTokens +
          (thinkingTokens ?? CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS),
      };
    }

    return [];
  }

  private handleMessageStop(): PalStreamEvent[] {
    const events: PalStreamEvent[] = [];

    // Finalize any tool calls that were started but never encountered content_block_stop
    for (const [_, block] of this.contentBlocks) {
      if (block.type === "tool_use" && !block.completed) {
        block.completed = true;
        const parsedArgs = repairJsonArguments(block.argumentsBuffer ?? "");
        block.arguments = parsedArgs;
        events.push({
          type: "tool_call_end",
          id: block.toolId ?? randomUUID(),
          name: block.toolName ?? CLAUDE_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME,
          arguments: parsedArgs,
        });
      }
    }

    events.push({
      type: "turn_complete",
      finishReason: this.finishReason,
      usage: this.accumulatedUsage,
    });

    this.isDone = true;
    return events;
  }

  private handleError(eventObj: Record<string, unknown>): PalStreamEvent[] {
    this.isDone = true;
    const palError = parseClaudeError(
      CLAUDE_ADAPTER_CONSTANTS.HTTP_STATUS_BAD_REQUEST,
      eventObj
    );
    return [{ type: "error", error: palError }];
  }

  /**
   * Flushes any remaining partial buffer, processing trailing lines and finalizing state.
   */
  flush(): PalStreamEvent[] {
    const events: PalStreamEvent[] = [];

    if (this.lineBuffer.trim().length > CLAUDE_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      const trailingEvents = this.feedLine(this.lineBuffer);
      for (const ev of trailingEvents) {
        events.push(ev);
        this.onEvent?.(ev);
      }
      this.lineBuffer = "";
    }

    if (!this.isDone) {
      const stopEvents = this.handleMessageStop();
      for (const ev of stopEvents) {
        events.push(ev);
        this.onEvent?.(ev);
      }
    }

    return events;
  }

  /**
   * Asynchronously parses chunks from an input stream into PalStreamEvents.
   */
  async *parse(
    stream:
      | AsyncIterable<Uint8Array | string>
      | Iterable<Uint8Array | string>
      | ReadableStream<Uint8Array>
  ): AsyncIterable<PalStreamEvent> {
    for await (const chunk of toAsyncIterable(stream)) {
      const events = this.feed(chunk);
      for (const ev of events) {
        yield ev;
      }
    }

    const flushedEvents = this.flush();
    for (const ev of flushedEvents) {
      yield ev;
    }
  }

  /**
   * Assembles a canonical PalMessage from all streamed content blocks.
   */
  toMessage(id?: string): PalMessage {
    const blocks: PalContentBlock[] = [];
    const sortedEntries = Array.from(this.contentBlocks.entries()).sort(
      ([a], [b]) => a - b
    );

    for (const [_, block] of sortedEntries) {
      if (block.type === "text" && block.text !== undefined) {
        blocks.push(createTextBlock(block.text));
      } else if (block.type === "thinking" && block.thinking !== undefined) {
        blocks.push(
          createThoughtBlock(block.thinking, {
            signature: block.signature,
          })
        );
      } else if (block.type === "tool_use" && block.toolId && block.toolName) {
        const parsedArgs =
          block.arguments ?? repairJsonArguments(block.argumentsBuffer ?? "");
        blocks.push(
          createToolCallBlock(
            block.toolId,
            block.toolName,
            parsedArgs,
            block.argumentsBuffer
          )
        );
      }
    }

    return createPalMessage({
      id: id ?? this.messageId ?? randomUUID(),
      role: PAL_ROLES.ASSISTANT,
      content: blocks,
    });
  }
}

/**
 * Standalone generator parsing chunks from any ReadableStream, AsyncIterable, or Iterable into PalStreamEvents.
 */
export async function* parseClaudeStream(
  stream:
    | AsyncIterable<Uint8Array | string>
    | Iterable<Uint8Array | string>
    | ReadableStream<Uint8Array>,
  options?: ClaudeStreamChunkParserOptions
): AsyncIterable<PalStreamEvent> {
  const parser = new ClaudeStreamChunkParser(options);
  yield* parser.parse(stream);
}

/**
 * Parses a single chunk or array of chunks synchronously into PalStreamEvents.
 */
export function parseClaudeStreamChunk(
  chunk: Uint8Array | string,
  parser?: ClaudeStreamChunkParser
): PalStreamEvent[] {
  const p = parser ?? new ClaudeStreamChunkParser();
  return p.feed(chunk);
}

/**
 * Functional factory creating a canonical ClaudeAdapter instance.
 */
export function createClaudeAdapter(
  options?: ClaudeAdapterOptions
): ClaudeAdapter {
  return new ClaudeAdapter(options);
}

/**
 * Default singleton ClaudeAdapter instance.
 */
export const claudePalAdapter: ClaudeAdapter = new ClaudeAdapter();
