/**
 * Google Gemini & Antigravity Provider Adapter (PAL).
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 4 and OpenSpec change
 * proposal `looper-pal-gemini-adapter`.
 *
 * Adheres to `ProviderAdapter` (`IPalProvider`) interface, integrating Google Gemini
 * and the Antigravity CLI with 2M token context, extended thinking support,
 * streaming NDJSON/SSE handling, and Protobuf Struct parameter resolution.
 */

import { randomUUID } from "node:crypto";
import {
  formatGeminiResponse,
  fromGeminiResponse,
  toGeminiPayload,
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
  type PalToolCallContent,
  type PalToolChoice,
  type PalToolDefinition,
  type ProviderAdapter,
} from "../types";

/**
 * Central constants ensuring zero magic numbers across GeminiAdapter operations.
 */
export const GEMINI_ADAPTER_CONSTANTS = {
  // Model defaults
  DEFAULT_MODEL: "gemini-2.5-pro",
  FALLBACK_MODEL: "gemini-2.0-flash",

  // Context & Token Limits
  MAX_CONTEXT_TOKENS: 2_000_000,
  MAX_OUTPUT_TOKENS: 65_536,
  DEFAULT_MAX_OUTPUT_TOKENS: 8_192,
  DEFAULT_THINKING_BUDGET_TOKENS: 2_048,
  MIN_THINKING_BUDGET_TOKENS: 0,
  MAX_THINKING_BUDGET_TOKENS: 32_768,
  ZERO_TOKENS: 0,

  // Network & Endpoint Defaults
  DEFAULT_BASE_URL: "https://generativelanguage.googleapis.com",
  DEFAULT_API_VERSION: "v1beta",
  GENERATE_CONTENT_ACTION: "generateContent",
  STREAM_GENERATE_CONTENT_ACTION: "streamGenerateContent",
  SSE_QUERY_PARAM: "alt=sse",
  DEFAULT_TIMEOUT_MS: 60_000,
  MS_PER_SECOND: 1_000,
  RATE_LIMIT_RESET_FALLBACK_MS: 60_000,

  // HTTP & API Headers
  HEADER_CONTENT_TYPE: "application/json",
  HEADER_API_KEY_NAME: "x-goog-api-key",

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
  SSE_EVENT_PREFIX: "event: ",
  SSE_COMMENT_PREFIX: ":",
  SSE_DONE_SIGNAL: "[DONE]",
  TEXT_DECODER_ENCODING: "utf-8",
  FALLBACK_TOOL_NAME: "unknown_tool",

  // Formatting & Truncation Bounds
  ONE_LINE_MAX_LENGTH: 140,
  TOOL_INPUT_MAX_LENGTH: 100,

  // NDJSON Wire Event Types & Constants
  NDJSON_EVENT_INIT: "init",
  NDJSON_EVENT_STEP_UPDATE: "step_update",
  NDJSON_EVENT_RESULT: "result",
  NDJSON_EVENT_ERROR: "error",
  NDJSON_EVENT_PROGRESS: "progress",
  NDJSON_STEP_TYPE_TOOL: "tool",
  NDJSON_STEP_TYPE_AGENT_RESPONSE: "agent_response",
  NDJSON_STATUS_SUCCESS: "SUCCESS",
  NDJSON_STATE_ACTIVE: "ACTIVE",
  PROTOBUF_NULL_VALUE_CASE: "nullValue",
  PROTOBUF_VALUE_CASE: "value",

  // CLI & Subprocessing Defaults
  CLI_BIN: "agy",
  CLI_FLAG_PROMPT: "-p",
  CLI_FLAG_OUTPUT_FORMAT: "--output-format",
  CLI_OUTPUT_FORMAT_STREAM_JSON: "stream-json",
  CLI_FLAG_DANGEROUSLY_SKIP_PERMISSIONS: "--dangerously-skip-permissions",
  CLI_FLAG_MODEL: "--model",
  CLI_FLAG_EFFORT: "--effort",
  CLI_FLAG_CONVERSATION: "--conversation",
  DEFAULT_CLI_TIMEOUT_MS: 2_700_000,
  CLI_STDERR_TAIL_MAX_LENGTH: 400,
  CLI_ERROR_DETAIL_MAX_LENGTH: 200,
  RATE_LIMIT_SLEEP_MS: 30_000,
  EXIT_CODE_SUCCESS: 0,

  // Gemini Cost Calculation Rates (per 1M tokens)
  TOKEN_PRICE_BASE: 1_000_000,
  GEMINI_FLASH_INPUT_COST: 0.15,
  GEMINI_FLASH_OUTPUT_COST: 0.60,
  GEMINI_PRO_INPUT_COST: 1.25,
  GEMINI_PRO_OUTPUT_COST: 5.00,
} as const;

/**
 * Execution mode for GeminiAdapter: direct REST API or Antigravity CLI subprocess.
 */
export type GeminiExecutionMode = "api" | "cli";

/**
 * Abstract interface for spawned Antigravity CLI subprocess.
 */
export interface AntigravitySpawnedProcess {
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
 * Factory signature for spawning an Antigravity subprocess.
 */
export type AntigravitySubprocessSpawnFn = (
  argv: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    timeout?: number;
    stdout: "pipe";
    stderr: "pipe";
  }
) => AntigravitySpawnedProcess;

/**
 * Options for configuring GeminiAdapter.
 */
export interface GeminiAdapterOptions {
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  defaultThinking?: PalThinkingOptions;
  dangerouslySkipPermissions?: boolean;
  providerName?: PalProviderName;
  executionMode?: GeminiExecutionMode;
  cwd?: string;
  spawnFn?: AntigravitySubprocessSpawnFn;
}

/**
 * Safe type guard checking if an unknown value is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates extended thinking budget against Gemini bounds.
 */
export function validateThinkingBudget(budgetTokens: number): void {
  if (
    !Number.isInteger(budgetTokens) ||
    budgetTokens < GEMINI_ADAPTER_CONSTANTS.MIN_THINKING_BUDGET_TOKENS
  ) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      `Gemini thinking budget must be an integer >= ${GEMINI_ADAPTER_CONSTANTS.MIN_THINKING_BUDGET_TOKENS}, got ${budgetTokens}`,
      false
    );
  }
  if (budgetTokens > GEMINI_ADAPTER_CONSTANTS.MAX_THINKING_BUDGET_TOKENS) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      `Gemini thinking budget cannot exceed ${GEMINI_ADAPTER_CONSTANTS.MAX_THINKING_BUDGET_TOKENS}, got ${budgetTokens}`,
      false
    );
  }
}

/**
 * Formats canonical PalToolDefinition array to Gemini functionDeclarations tools payload.
 */
export function formatGeminiTools(
  tools?: PalToolDefinition[]
): Array<{ functionDeclarations: Array<Record<string, unknown>> }> | undefined {
  if (!tools || tools.length === GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
    return undefined;
  }
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

/**
 * Formats canonical PalToolChoice to Gemini toolConfig payload.
 */
export function formatGeminiToolChoice(
  choice?: PalToolChoice
): Record<string, unknown> | undefined {
  if (!choice || choice === "auto") {
    return {
      functionCallingConfig: {
        mode: "AUTO",
      },
    };
  }
  if (choice === "none") {
    return {
      functionCallingConfig: {
        mode: "NONE",
      },
    };
  }
  if (choice === "required") {
    return {
      functionCallingConfig: {
        mode: "ANY",
      },
    };
  }
  if (typeof choice === "object" && choice.type === "tool") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [choice.toolName],
      },
    };
  }
  return undefined;
}

/**
 * Maps Gemini finishReason string to canonical PalFinishReason.
 */
export function mapGeminiFinishReason(
  finishReason: unknown,
  hasToolCalls: boolean = false
): PalFinishReason {
  if (typeof finishReason !== "string") {
    return hasToolCalls
      ? PAL_FINISH_REASONS.TOOL_CALLS
      : PAL_FINISH_REASONS.STOP;
  }

  switch (finishReason.toUpperCase()) {
    case "STOP":
      return hasToolCalls
        ? PAL_FINISH_REASONS.TOOL_CALLS
        : PAL_FINISH_REASONS.STOP;
    case "MAX_TOKENS":
      return PAL_FINISH_REASONS.LENGTH;
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return PAL_FINISH_REASONS.CONTENT_FILTER;
    case "MALFORMED_FUNCTION_CALL":
    case "OTHER":
      return PAL_FINISH_REASONS.ERROR;
    default:
      return hasToolCalls
        ? PAL_FINISH_REASONS.TOOL_CALLS
        : PAL_FINISH_REASONS.STOP;
  }
}

/**
 * Calculates canonical PalTokenUsage from Gemini usageMetadata.
 */
export function calculateGeminiTokenUsage(
  usageMetadata?: unknown
): PalTokenUsage {
  if (!isRecord(usageMetadata)) {
    return {
      promptTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
    };
  }

  const promptTokens =
    typeof usageMetadata.promptTokenCount === "number"
      ? usageMetadata.promptTokenCount
      : GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS;

  const completionTokens =
    typeof usageMetadata.candidatesTokenCount === "number"
      ? usageMetadata.candidatesTokenCount
      : GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS;

  const totalTokens =
    typeof usageMetadata.totalTokenCount === "number"
      ? usageMetadata.totalTokenCount
      : promptTokens + completionTokens;

  const cachedPromptTokens =
    typeof usageMetadata.cachedContentTokenCount === "number"
      ? usageMetadata.cachedContentTokenCount
      : undefined;

  let thinkingTokens: number | undefined;
  if (Array.isArray(usageMetadata.candidatesTokensDetails)) {
    for (const detail of usageMetadata.candidatesTokensDetails) {
      if (
        isRecord(detail) &&
        detail.modality === "THINKING" &&
        typeof detail.tokenCount === "number"
      ) {
        thinkingTokens =
          (thinkingTokens ?? GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) +
          detail.tokenCount;
      }
    }
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
    ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
  };
}

/**
 * Parses Google Gemini rate limit response headers.
 */
export function parseGeminiRateLimitHeaders(
  headers?: Headers
): Partial<PalRateLimitInfo> {
  if (!headers) {
    return {};
  }

  const result: Partial<PalRateLimitInfo> = {};

  const reqLimit = headers.get("x-ratelimit-limit-requests");
  if (reqLimit) {
    const val = Number(reqLimit);
    if (!Number.isNaN(val)) result.requestsLimit = val;
  }

  const reqRemaining = headers.get("x-ratelimit-remaining-requests");
  if (reqRemaining) {
    const val = Number(reqRemaining);
    if (!Number.isNaN(val)) result.requestsRemaining = val;
  }

  const tokLimit = headers.get("x-ratelimit-limit-tokens");
  if (tokLimit) {
    const val = Number(tokLimit);
    if (!Number.isNaN(val)) result.tokensLimit = val;
  }

  const tokRemaining = headers.get("x-ratelimit-remaining-tokens");
  if (tokRemaining) {
    const val = Number(tokRemaining);
    if (!Number.isNaN(val)) result.tokensRemaining = val;
  }

  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const parsedSec = Number(retryAfter);
    if (!Number.isNaN(parsedSec)) {
      result.resetsAt =
        Date.now() + parsedSec * GEMINI_ADAPTER_CONSTANTS.MS_PER_SECOND;
    } else {
      const parsedDate = Date.parse(retryAfter);
      if (!Number.isNaN(parsedDate)) {
        result.resetsAt = parsedDate;
      }
    }
  }

  return result;
}

/**
 * Parses Gemini API error response and maps to canonical PalError.
 */
export function parseGeminiError(
  status: number,
  data: unknown,
  headers?: Headers
): PalError {
  let message = `Gemini API error (HTTP ${status})`;
  let statusText: string | undefined;

  if (isRecord(data)) {
    if (isRecord(data.error)) {
      if (typeof data.error.message === "string") {
        message = data.error.message;
      }
      if (typeof data.error.status === "string") {
        statusText = data.error.status;
      }
    } else if (typeof data.message === "string") {
      message = data.message;
    }
  }

  const rateLimitInfo = parseGeminiRateLimitHeaders(headers);
  const resetsAt =
    rateLimitInfo.resetsAt ??
    (status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_TOO_MANY_REQUESTS
      ? Date.now() + GEMINI_ADAPTER_CONSTANTS.RATE_LIMIT_RESET_FALLBACK_MS
      : undefined);

  if (
    status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_TOO_MANY_REQUESTS ||
    statusText === "RESOURCE_EXHAUSTED" ||
    /resource_exhausted|quota|rate\s*limit/i.test(message)
  ) {
    return new PalError(
      PAL_ERROR_KINDS.RATE_LIMIT,
      message,
      true,
      resetsAt,
      data
    );
  }

  if (
    status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_SERVICE_UNAVAILABLE ||
    status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_OVERLOADED ||
    statusText === "UNAVAILABLE"
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
    status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_UNAUTHORIZED ||
    status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_FORBIDDEN ||
    statusText === "UNAUTHENTICATED" ||
    statusText === "PERMISSION_DENIED"
  ) {
    return new PalError(
      PAL_ERROR_KINDS.AUTH_FAILURE,
      message,
      false,
      undefined,
      data
    );
  }

  if (
    status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_REQUEST_TIMEOUT ||
    status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_GATEWAY_TIMEOUT
  ) {
    return new PalError(
      PAL_ERROR_KINDS.TIMEOUT,
      message,
      true,
      undefined,
      data
    );
  }

  if (status === GEMINI_ADAPTER_CONSTANTS.HTTP_STATUS_BAD_REQUEST) {
    if (
      /context\s*length|token\s*limit|maximum\s*context/i.test(message) ||
      statusText === "OUT_OF_RANGE"
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
 * Type representing google.protobuf.NullValue.
 */
export type ProtobufNullValue = 0 | "NULL_VALUE" | null;

/**
 * Type representing google.protobuf.Value.
 */
export type ProtobufValue =
  | { nullValue: ProtobufNullValue }
  | { numberValue: number }
  | { stringValue: string }
  | { boolValue: boolean }
  | { structValue: ProtobufStruct }
  | { listValue: { values: ProtobufValue[] } };

/**
 * Type representing google.protobuf.Struct.
 */
export interface ProtobufStruct {
  fields: Record<string, ProtobufValue>;
}

/**
 * Type guard checking if an unknown value conforms to a google.protobuf.Struct.
 */
export function isProtobufStruct(value: unknown): value is ProtobufStruct {
  if (!isRecord(value)) return false;
  return "fields" in value && isRecord(value.fields);
}

/**
 * Type guard checking if an unknown value conforms to a google.protobuf.Value.
 */
export function isProtobufValue(value: unknown): value is ProtobufValue {
  if (!isRecord(value)) return false;
  return (
    "stringValue" in value ||
    "numberValue" in value ||
    "boolValue" in value ||
    "nullValue" in value ||
    "listValue" in value ||
    "structValue" in value
  );
}

/**
 * Recursively converts a Google Protobuf Struct or Value representation to standard JSON.
 *
 * Implements Scenario: Tool parameters arrive as protobuf structs -> The adapter serializes
 * them into standard JSON structures.
 */
export function convertProtobufStructToJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(convertProtobufStructToJson);
  }

  const record = value as Record<string, unknown>;

  // Check protobufjs / @bufbuild/protobuf style { kind: { case: "...", value: "..." } }
  if (isRecord(record.kind) && typeof record.kind.case === "string") {
    if (record.kind.case === GEMINI_ADAPTER_CONSTANTS.PROTOBUF_NULL_VALUE_CASE) {
      return null;
    }
    if (GEMINI_ADAPTER_CONSTANTS.PROTOBUF_VALUE_CASE in record.kind) {
      return convertProtobufStructToJson(record.kind.value);
    }
  }

  // Check if this is a google.protobuf.Value
  if ("stringValue" in record && typeof record.stringValue === "string") {
    return record.stringValue;
  }
  if ("numberValue" in record && typeof record.numberValue === "number") {
    return record.numberValue;
  }
  if ("boolValue" in record && typeof record.boolValue === "boolean") {
    return record.boolValue;
  }
  if ("nullValue" in record) {
    return null;
  }
  if ("listValue" in record) {
    if (
      isRecord(record.listValue) &&
      Array.isArray(record.listValue.values)
    ) {
      return record.listValue.values.map(convertProtobufStructToJson);
    }
    if (Array.isArray(record.listValue)) {
      return record.listValue.map(convertProtobufStructToJson);
    }
  }
  if ("structValue" in record && isRecord(record.structValue)) {
    return convertProtobufStructToJson(record.structValue);
  }

  // Check if this is a google.protobuf.Struct with `fields`
  if ("fields" in record && isRecord(record.fields)) {
    const result: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(record.fields)) {
      result[key] = convertProtobufStructToJson(fieldValue);
    }
    return result;
  }

  // Plain object: recurse on properties
  const result: Record<string, unknown> = {};
  for (const [key, propValue] of Object.entries(record)) {
    result[key] = convertProtobufStructToJson(propValue);
  }
  return result;
}

/**
 * Recursively converts a standard JSON value into a Google Protobuf Value representation.
 */
export function convertJsonToProtobufValue(value: unknown): ProtobufValue {
  if (value === null || value === undefined) {
    return { nullValue: 0 };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "number") {
    return { numberValue: value };
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  if (Array.isArray(value)) {
    return {
      listValue: {
        values: value.map(convertJsonToProtobufValue),
      },
    };
  }
  if (isRecord(value)) {
    return {
      structValue: convertJsonToProtobufStruct(value),
    };
  }
  return { stringValue: String(value) };
}

/**
 * Converts a standard JSON record/object into a Google Protobuf Struct representation with `fields`.
 */
export function convertJsonToProtobufStruct(
  record: Record<string, unknown>
): ProtobufStruct {
  const fields: Record<string, ProtobufValue> = {};
  for (const [key, val] of Object.entries(record)) {
    fields[key] = convertJsonToProtobufValue(val);
  }
  return { fields };
}

/**
 * Flattens whitespace and truncates string to max characters with ellipsis.
 */
export function oneLine(
  text: string,
  max: number = GEMINI_ADAPTER_CONSTANTS.ONE_LINE_MAX_LENGTH
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max
    ? `${flat.slice(GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS, max - 1)}…`
    : flat;
}

/**
 * Formats tool input payload into a concise single-line description for progress display and logs.
 * Supports path, cmd, command, CommandLine, args, file_path, Path, pattern, url, query, and description.
 */
export function describeToolInput(
  input: unknown,
  max: number = GEMINI_ADAPTER_CONSTANTS.TOOL_INPUT_MAX_LENGTH
): string {
  if (!input) return "";
  if (typeof input === "string") {
    return oneLine(input, max);
  }
  if (Array.isArray(input)) {
    return oneLine(input.map(String).join(" "), max);
  }
  if (typeof input !== "object") return "";

  const fields = input as Record<string, unknown>;

  // Check command / cmd / CommandLine along with optional args
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
    return oneLine(full, max);
  }

  if (argsStr) {
    return oneLine(argsStr, max);
  }

  // Check path / file_path / Path
  const path = fields.path ?? fields.file_path ?? fields.Path;
  if (typeof path === "string" && path.trim()) {
    return oneLine(path.trim(), max);
  }

  // Check pattern, url, query, description
  const value =
    fields.pattern ?? fields.url ?? fields.query ?? fields.description;
  return typeof value === "string" ? oneLine(value, max) : "";
}

/**
 * Normalizes and enriches tool parameter payload from `toolInfo`
 * (handling parameters, input, args, or direct properties),
 * converting any nested Protobuf Struct structures and populating common fields (path, cmd, args).
 */
export function formatToolInput(
  toolInfo: unknown
): Record<string, unknown> | undefined {
  if (!toolInfo || typeof toolInfo !== "object") return undefined;
  const info = toolInfo as Record<string, unknown>;
  const raw = info.parameters ?? info.input ?? info.args ?? toolInfo;
  if (!raw || typeof raw !== "object") return undefined;

  const converted = convertProtobufStructToJson(raw);
  if (!converted || typeof converted !== "object") return undefined;

  const params = converted as Record<string, unknown>;
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

// Re-export Protobuf Struct-compliant response formatter
export { formatGeminiResponse };

/**
 * State accumulated across streaming NDJSON events.
 */
export interface GeminiNdjsonReducerState {
  conversationId?: string;
  texts: string[];
  thoughts: string[];
  toolCalls: PalToolCallContent[];
  contentBlocks: PalContentBlock[];
  usage: PalTokenUsage;
  finishReason: PalFinishReason;
  hasToolCalls: boolean;
  isCompleted: boolean;
  turnCompleteEmitted: boolean;
  error?: string;
}

/**
 * Factory creating initial clean state for NDJSON reducer.
 */
export function createInitialNdjsonReducerState(
  initialSessionId?: string
): GeminiNdjsonReducerState {
  return {
    conversationId: initialSessionId,
    texts: [],
    thoughts: [],
    toolCalls: [],
    contentBlocks: [],
    usage: {
      promptTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
    },
    finishReason: PAL_FINISH_REASONS.STOP,
    hasToolCalls: false,
    isCompleted: false,
    turnCompleteEmitted: false,
  };
}

/**
 * Helper appending or concatenating text / thought blocks preserving order.
 */
function appendContentBlock(
  blocks: PalContentBlock[],
  type: typeof PAL_CONTENT_BLOCK_TYPES.TEXT | typeof PAL_CONTENT_BLOCK_TYPES.THOUGHT,
  content: string
): void {
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock && lastBlock.type === type) {
    lastBlock.text += content;
  } else if (type === PAL_CONTENT_BLOCK_TYPES.TEXT) {
    blocks.push(createTextBlock(content));
  } else {
    blocks.push(createThoughtBlock(content));
  }
}

/**
 * Helper extracting and accumulating token counts into reducer state.
 */
function accumulateNdjsonTokenUsage(
  state: GeminiNdjsonReducerState,
  rawTokens: Record<string, unknown>
): void {
  const inputTokens =
    typeof rawTokens.input_tokens === "number"
      ? rawTokens.input_tokens
      : typeof rawTokens.inputTokens === "number"
      ? rawTokens.inputTokens
      : typeof rawTokens.prompt_tokens === "number"
      ? rawTokens.prompt_tokens
      : typeof rawTokens.promptTokens === "number"
      ? rawTokens.promptTokens
      : state.usage.promptTokens;

  const outputTokens =
    typeof rawTokens.output_tokens === "number"
      ? rawTokens.output_tokens
      : typeof rawTokens.outputTokens === "number"
      ? rawTokens.outputTokens
      : typeof rawTokens.completion_tokens === "number"
      ? rawTokens.completion_tokens
      : typeof rawTokens.completionTokens === "number"
      ? rawTokens.completionTokens
      : state.usage.completionTokens;

  const thinkingTokens =
    typeof rawTokens.thinking_tokens === "number"
      ? rawTokens.thinking_tokens
      : typeof rawTokens.thinkingTokens === "number"
      ? rawTokens.thinkingTokens
      : state.usage.thinkingTokens;

  const cachedPromptTokens =
    typeof rawTokens.cache_read_tokens === "number"
      ? rawTokens.cache_read_tokens
      : typeof rawTokens.cacheReadTokens === "number"
      ? rawTokens.cacheReadTokens
      : state.usage.cachedPromptTokens;

  const totalTokens =
    typeof rawTokens.total_tokens === "number"
      ? rawTokens.total_tokens
      : typeof rawTokens.totalTokens === "number"
      ? rawTokens.totalTokens
      : inputTokens + outputTokens;

  state.usage = {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens,
    ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
  };
}

/**
 * Folds a single parsed NDJSON event or JSON line into the reducer state,
 * updating state properties and returning emitted PalStreamEvent objects.
 *
 * Implements tolerant parsing for Antigravity CLI and Gemini streaming NDJSON lines,
 * extracting live text/thought deltas, enriched tool parameters, token usage, and completion signals.
 */
export function reduceGeminiNdjsonEvent(
  state: GeminiNdjsonReducerState,
  lineOrParsed: string | Record<string, unknown>,
  onEvent?: (event: PalStreamEvent) => void
): PalStreamEvent[] {
  let parsed: unknown;

  if (typeof lineOrParsed === "string") {
    const trimmed = lineOrParsed.trim();
    if (trimmed.length === GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      return [];
    }
    // Ignore SSE comments or banner/comment lines
    if (
      trimmed.startsWith(GEMINI_ADAPTER_CONSTANTS.SSE_COMMENT_PREFIX) ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("//")
    ) {
      return [];
    }

    let payloadStr = trimmed;
    if (trimmed.startsWith(GEMINI_ADAPTER_CONSTANTS.SSE_DATA_PREFIX)) {
      payloadStr = trimmed
        .slice(GEMINI_ADAPTER_CONSTANTS.SSE_DATA_PREFIX.length)
        .trim();
    }

    if (payloadStr === GEMINI_ADAPTER_CONSTANTS.SSE_DONE_SIGNAL) {
      state.isCompleted = true;
      if (!state.turnCompleteEmitted) {
        state.turnCompleteEmitted = true;
        const completeEvent: PalStreamEvent = {
          type: "turn_complete",
          finishReason: state.hasToolCalls
            ? PAL_FINISH_REASONS.TOOL_CALLS
            : state.finishReason,
          usage: { ...state.usage },
        };
        onEvent?.(completeEvent);
        return [completeEvent];
      }
      return [];
    }

    try {
      parsed = JSON.parse(payloadStr);
    } catch {
      // Tolerant parser ignores malformed non-JSON lines / CLI banners
      return [];
    }
  } else {
    parsed = lineOrParsed;
  }

  if (!isRecord(parsed)) {
    return [];
  }

  const events: PalStreamEvent[] = [];
  const emit = (ev: PalStreamEvent): void => {
    events.push(ev);
    onEvent?.(ev);
  };

  // Determine event type from `event` or `type` property
  const eventName =
    typeof parsed.event === "string"
      ? parsed.event
      : typeof parsed.type === "string"
      ? parsed.type
      : undefined;

  // Capture conversation_id if present at root
  if (
    typeof parsed.conversation_id === "string" &&
    parsed.conversation_id.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
  ) {
    state.conversationId = parsed.conversation_id;
  }

  // 1. Init event
  if (eventName === GEMINI_ADAPTER_CONSTANTS.NDJSON_EVENT_INIT) {
    if (
      typeof parsed.conversation_id === "string" &&
      parsed.conversation_id.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
    ) {
      state.conversationId = parsed.conversation_id;
    }
    return events;
  }

  // 2. Step Update event (supports step_update object or delta object)
  if (
    eventName === GEMINI_ADAPTER_CONSTANTS.NDJSON_EVENT_STEP_UPDATE ||
    "step_update" in parsed ||
    "delta" in parsed
  ) {
    const rawUpdate = parsed.step_update ?? parsed.delta ?? parsed;
    if (isRecord(rawUpdate)) {
      if (
        typeof rawUpdate.conversation_id === "string" &&
        rawUpdate.conversation_id.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
      ) {
        state.conversationId = rawUpdate.conversation_id;
      }

      // Update telemetry / usage if present
      if (isRecord(rawUpdate.usage) || isRecord(rawUpdate.tokens)) {
        accumulateNdjsonTokenUsage(
          state,
          (rawUpdate.usage ?? rawUpdate.tokens) as Record<string, unknown>
        );
      }

      // Format A: step_type === "agent_response"
      if (
        rawUpdate.step_type ===
        GEMINI_ADAPTER_CONSTANTS.NDJSON_STEP_TYPE_AGENT_RESPONSE
      ) {
        if (
          typeof rawUpdate.text_delta === "string" &&
          rawUpdate.text_delta.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
        ) {
          const text = rawUpdate.text_delta;
          state.texts.push(text);
          appendContentBlock(state.contentBlocks, PAL_CONTENT_BLOCK_TYPES.TEXT, text);
          emit({ type: "text_delta", text });
        }
        if (
          typeof rawUpdate.thought_delta === "string" &&
          rawUpdate.thought_delta.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
        ) {
          const thought = rawUpdate.thought_delta;
          state.thoughts.push(thought);
          appendContentBlock(
            state.contentBlocks,
            PAL_CONTENT_BLOCK_TYPES.THOUGHT,
            thought
          );
          emit({ type: "thought_delta", thought });
        }
      }

      // Format B: delta with direct text / thought
      if (
        typeof rawUpdate.text === "string" &&
        rawUpdate.text.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
      ) {
        const text = rawUpdate.text;
        state.texts.push(text);
        appendContentBlock(state.contentBlocks, PAL_CONTENT_BLOCK_TYPES.TEXT, text);
        emit({ type: "text_delta", text });
      }
      if (
        typeof rawUpdate.thought === "string" &&
        rawUpdate.thought.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
      ) {
        const thought = rawUpdate.thought;
        state.thoughts.push(thought);
        appendContentBlock(
          state.contentBlocks,
          PAL_CONTENT_BLOCK_TYPES.THOUGHT,
          thought
        );
        emit({ type: "thought_delta", thought });
      }

      // Tool Invocations: Form A (step_type === "tool" or has tool_info / tool_name)
      if (
        rawUpdate.step_type === GEMINI_ADAPTER_CONSTANTS.NDJSON_STEP_TYPE_TOOL ||
        rawUpdate.tool_name !== undefined ||
        rawUpdate.tool_info !== undefined
      ) {
        state.hasToolCalls = true;
        const toolName =
          typeof rawUpdate.tool_name === "string"
            ? rawUpdate.tool_name
            : isRecord(rawUpdate.tool_info) &&
              typeof rawUpdate.tool_info.name === "string"
            ? rawUpdate.tool_info.name
            : GEMINI_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME;
        const toolId =
          typeof rawUpdate.tool_call_id === "string"
            ? rawUpdate.tool_call_id
            : typeof rawUpdate.id === "string"
            ? rawUpdate.id
            : randomUUID();

        const rawArgs =
          isRecord(rawUpdate.tool_info) &&
          (rawUpdate.tool_info.parameters ??
            rawUpdate.tool_info.input ??
            rawUpdate.tool_info.args) !== undefined
            ? rawUpdate.tool_info.parameters ??
              rawUpdate.tool_info.input ??
              rawUpdate.tool_info.args
            : rawUpdate.parameters ??
              rawUpdate.args ??
              rawUpdate.input ??
              rawUpdate.tool_info ??
              {};

        const jsonArgs = convertProtobufStructToJson(rawArgs);
        const enrichedArgs =
          formatToolInput(jsonArgs) ?? (isRecord(jsonArgs) ? jsonArgs : {});
        const argsDelta = JSON.stringify(enrichedArgs);

        emit({
          type: "tool_call_delta",
          id: toolId,
          name: toolName,
          argumentsDelta: argsDelta,
        });
        emit({
          type: "tool_call_end",
          id: toolId,
          name: toolName,
          arguments: enrichedArgs,
        });

        const toolBlock = createToolCallBlock(toolId, toolName, enrichedArgs);
        state.toolCalls.push(toolBlock);
        state.contentBlocks.push(toolBlock);
      }

      // Tool Invocations: Form B (array of tool_calls)
      if (Array.isArray(rawUpdate.tool_calls)) {
        for (const tc of rawUpdate.tool_calls) {
          if (isRecord(tc)) {
            state.hasToolCalls = true;
            const toolId =
              typeof tc.id === "string" &&
              tc.id.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
                ? tc.id
                : randomUUID();
            const toolName =
              typeof tc.name === "string" &&
              tc.name.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
                ? tc.name
                : GEMINI_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME;

            const rawArgs = tc.args ?? tc.parameters ?? tc.input ?? {};
            const jsonArgs = convertProtobufStructToJson(rawArgs);
            const enrichedArgs =
              formatToolInput(jsonArgs) ?? (isRecord(jsonArgs) ? jsonArgs : {});
            const argsDelta = JSON.stringify(enrichedArgs);

            emit({
              type: "tool_call_delta",
              id: toolId,
              name: toolName,
              argumentsDelta: argsDelta,
            });
            emit({
              type: "tool_call_end",
              id: toolId,
              name: toolName,
              arguments: enrichedArgs,
            });

            const toolBlock = createToolCallBlock(
              toolId,
              toolName,
              enrichedArgs
            );
            state.toolCalls.push(toolBlock);
            state.contentBlocks.push(toolBlock);
          }
        }
      }
    }
    return events;
  }

  // 3. Progress event
  if (eventName === GEMINI_ADAPTER_CONSTANTS.NDJSON_EVENT_PROGRESS) {
    if (isRecord(parsed.input) || isRecord(parsed.parameters)) {
      const converted = convertProtobufStructToJson(
        parsed.input ?? parsed.parameters
      );
      if (isRecord(converted)) {
        formatToolInput(converted);
      }
    }
    return events;
  }

  // 4. Result event
  if (
    eventName === GEMINI_ADAPTER_CONSTANTS.NDJSON_EVENT_RESULT ||
    "result" in parsed
  ) {
    const rawResult = parsed.result ?? parsed;
    if (isRecord(rawResult)) {
      if (
        typeof rawResult.conversation_id === "string" &&
        rawResult.conversation_id.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
      ) {
        state.conversationId = rawResult.conversation_id;
      }

      if (isRecord(rawResult.usage) || isRecord(rawResult.tokens)) {
        accumulateNdjsonTokenUsage(
          state,
          (rawResult.usage ?? rawResult.tokens) as Record<string, unknown>
        );
      }

      const status =
        typeof rawResult.status === "string"
          ? rawResult.status
          : GEMINI_ADAPTER_CONSTANTS.NDJSON_STATUS_SUCCESS;

      if (status !== GEMINI_ADAPTER_CONSTANTS.NDJSON_STATUS_SUCCESS) {
        state.error =
          typeof rawResult.error === "string"
            ? rawResult.error
            : typeof rawResult.response === "string"
            ? rawResult.response
            : `Result status: ${status}`;
        state.finishReason = PAL_FINISH_REASONS.ERROR;
      } else {
        state.finishReason = state.hasToolCalls
          ? PAL_FINISH_REASONS.TOOL_CALLS
          : PAL_FINISH_REASONS.STOP;
      }

      // If text response is provided in result and state.texts is empty
      if (
        typeof rawResult.response === "string" &&
        rawResult.response.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
      ) {
        if (state.texts.length === GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
          const text = rawResult.response;
          state.texts.push(text);
          appendContentBlock(state.contentBlocks, PAL_CONTENT_BLOCK_TYPES.TEXT, text);
          emit({ type: "text_delta", text });
        }
      }

      state.isCompleted = true;
      if (!state.turnCompleteEmitted) {
        state.turnCompleteEmitted = true;
        emit({
          type: "turn_complete",
          finishReason: state.finishReason,
          usage: { ...state.usage },
        });
      }
    }
    return events;
  }

  // 5. Error event
  if (
    eventName === GEMINI_ADAPTER_CONSTANTS.NDJSON_EVENT_ERROR ||
    parsed.error !== undefined
  ) {
    const errPayload = parsed.error ?? parsed;
    state.error =
      typeof errPayload === "string" ? errPayload : JSON.stringify(errPayload);
    state.finishReason = PAL_FINISH_REASONS.ERROR;
    state.isCompleted = true;
    if (!state.turnCompleteEmitted) {
      state.turnCompleteEmitted = true;
      emit({
        type: "turn_complete",
        finishReason: PAL_FINISH_REASONS.ERROR,
        usage: { ...state.usage },
      });
    }
    return events;
  }

  return events;
}

/**
 * Functional alias for reduceGeminiNdjsonEvent.
 */
export const reduceNdjsonEvent = reduceGeminiNdjsonEvent;

/**
 * Converts accumulated NDJSON reducer state into a canonical PalMessage.
 */
export function ndjsonStateToPalMessage(
  state: GeminiNdjsonReducerState,
  id?: string
): PalMessage {
  return createPalMessage({
    id: id ?? randomUUID(),
    role: PAL_ROLES.ASSISTANT,
    content: [...state.contentBlocks],
  });
}

/**
 * Options for configuring GeminiNdjsonStreamReducer.
 */
export interface GeminiNdjsonStreamReducerOptions {
  initialSessionId?: string;
  onEvent?: (event: PalStreamEvent) => void;
}

/**
 * Streaming NDJSON reducer folding stream-json chunks into state and emitting PalStreamEvents.
 */
export class GeminiNdjsonStreamReducer {
  private state: GeminiNdjsonReducerState;
  private lineBuffer: string = "";
  private readonly decoder: TextDecoder = new TextDecoder(
    GEMINI_ADAPTER_CONSTANTS.TEXT_DECODER_ENCODING
  );
  private readonly onEvent?: (event: PalStreamEvent) => void;

  constructor(options?: GeminiNdjsonStreamReducerOptions) {
    this.onEvent = options?.onEvent;
    this.state = createInitialNdjsonReducerState(options?.initialSessionId);
  }

  /**
   * Retrieves a snapshot copy of the current reducer state.
   */
  getState(): GeminiNdjsonReducerState {
    return {
      ...this.state,
      texts: [...this.state.texts],
      thoughts: [...this.state.thoughts],
      toolCalls: [...this.state.toolCalls],
      contentBlocks: [...this.state.contentBlocks],
      usage: { ...this.state.usage },
    };
  }

  /**
   * Retrieves current conversation ID if captured.
   */
  getConversationId(): string | undefined {
    return this.state.conversationId;
  }

  /**
   * Retrieves accumulated token usage telemetry.
   */
  getUsage(): PalTokenUsage {
    return { ...this.state.usage };
  }

  /**
   * Retrieves current finish reason.
   */
  getFinishReason(): PalFinishReason {
    return this.state.finishReason;
  }

  /**
   * Checks whether the stream has reached completion.
   */
  isCompleted(): boolean {
    return this.state.isCompleted;
  }

  /**
   * Resets the reducer state.
   */
  reset(initialSessionId?: string): void {
    this.lineBuffer = "";
    this.state = createInitialNdjsonReducerState(initialSessionId);
  }

  /**
   * Feeds a binary chunk or string slice into the reducer.
   */
  feed(chunk: Uint8Array | string): PalStreamEvent[] {
    if (this.state.isCompleted && this.state.turnCompleteEmitted) {
      return [];
    }

    if (chunk instanceof Uint8Array) {
      this.lineBuffer += this.decoder.decode(chunk, { stream: true });
    } else if (typeof chunk === "string") {
      this.lineBuffer += chunk;
    }

    const events: PalStreamEvent[] = [];
    const lines = this.lineBuffer.split("\n");
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const lineEvents = this.feedLine(line);
      events.push(...lineEvents);
    }

    return events;
  }

  /**
   * Folds an individual line into the reducer.
   */
  feedLine(line: string): PalStreamEvent[] {
    return reduceGeminiNdjsonEvent(this.state, line, this.onEvent);
  }

  /**
   * Flushes remaining buffer and yields final turn_complete event if needed.
   */
  flush(): PalStreamEvent[] {
    const events: PalStreamEvent[] = [];
    if (this.lineBuffer.trim().length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      const lineEvents = this.feedLine(this.lineBuffer);
      events.push(...lineEvents);
      this.lineBuffer = "";
    }

    if (!this.state.turnCompleteEmitted) {
      this.state.turnCompleteEmitted = true;
      this.state.isCompleted = true;
      const completeEvent: PalStreamEvent = {
        type: "turn_complete",
        finishReason: this.state.hasToolCalls
          ? PAL_FINISH_REASONS.TOOL_CALLS
          : this.state.finishReason,
        usage: { ...this.state.usage },
      };
      events.push(completeEvent);
      this.onEvent?.(completeEvent);
    }

    return events;
  }

  /**
   * Assembles a canonical PalMessage from accumulated content blocks.
   */
  toMessage(id?: string): PalMessage {
    return ndjsonStateToPalMessage(this.state, id);
  }

  /**
   * Asynchronous generator reducing an input stream into PalStreamEvents.
   */
  async *reduceStream(
    source:
      | ReadableStream<Uint8Array | string>
      | AsyncIterable<Uint8Array | string>
      | Iterable<Uint8Array | string>
  ): AsyncIterable<PalStreamEvent> {
    this.reset();
    for await (const chunk of toAsyncIterable(source)) {
      const events = this.feed(chunk);
      for (const ev of events) {
        yield ev;
      }
    }
    const trailingEvents = this.flush();
    for (const ev of trailingEvents) {
      yield ev;
    }
  }
}

/**
 * Functional generator reducing any stream of NDJSON chunks into PalStreamEvents.
 */
export async function* reduceNdjsonStream(
  stream:
    | AsyncIterable<Uint8Array | string>
    | Iterable<Uint8Array | string>
    | ReadableStream<Uint8Array | string>,
  options?: GeminiNdjsonStreamReducerOptions
): AsyncIterable<PalStreamEvent> {
  const reducer = new GeminiNdjsonStreamReducer(options);
  yield* reducer.reduceStream(stream);
}

/**
 * Type guard for ReadableStream.
 */
function isReadableStream(
  value: unknown
): value is ReadableStream<Uint8Array | string> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as ReadableStream<Uint8Array | string>).getReader ===
      "function"
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
 * Options for configuring Antigravity CLI invocation arguments.
 */
export interface AntigravityCliArgsOptions {
  prompt: string;
  model?: string;
  effort?: string;
  conversationId?: string;
  resume?: string;
  dangerouslySkipPermissions?: boolean;
}

/**
 * Selects the Antigravity model name or falls back to the default Gemini model.
 */
export function antigravityModelArg(model: string | undefined): string {
  return model?.trim() ? model.trim() : GEMINI_ADAPTER_CONSTANTS.DEFAULT_MODEL;
}

/**
 * Formats reasoning effort argument if provided and not 'none'.
 */
export function antigravityEffortArg(
  effort: string | undefined
): string | undefined {
  if (!effort || effort === "none") return undefined;
  return effort;
}

/**
 * Regular expressions classifying Antigravity CLI failure modes.
 */
export const ANTIGRAVITY_RATE_LIMIT_REGEX =
  /rate.?limit|\b429\b|quota|usage limit|too many requests|resource_exhausted/i;
export const ANTIGRAVITY_UNRECOVERABLE_REGEX =
  /unauthorized|authentication failed|invalid credential|"status":\s*(401|403)\b|model not found|no such file or directory.*agy/i;

/**
 * Classifies failure messages from Antigravity subprocessing.
 */
export function classifyAntigravityFailure(
  failure: string
): "fatal" | "paused" | "error" {
  if (ANTIGRAVITY_UNRECOVERABLE_REGEX.test(failure)) return "fatal";
  return ANTIGRAVITY_RATE_LIMIT_REGEX.test(failure) ? "paused" : "error";
}

export const classifyFailure = classifyAntigravityFailure;

/**
 * Estimates USD cost from Gemini / Antigravity token usage.
 */
export function estimateGeminiCostUsd(
  model: string,
  usage: PalTokenUsage | { inputTokens: number; outputTokens: number }
): number {
  const inputTokens =
    "promptTokens" in usage ? usage.promptTokens : usage.inputTokens;
  const outputTokens =
    "completionTokens" in usage ? usage.completionTokens : usage.outputTokens;

  const modelLower = model.toLowerCase();
  if (modelLower.includes("flash")) {
    const inputCost =
      (inputTokens / GEMINI_ADAPTER_CONSTANTS.TOKEN_PRICE_BASE) *
      GEMINI_ADAPTER_CONSTANTS.GEMINI_FLASH_INPUT_COST;
    const outputCost =
      (outputTokens / GEMINI_ADAPTER_CONSTANTS.TOKEN_PRICE_BASE) *
      GEMINI_ADAPTER_CONSTANTS.GEMINI_FLASH_OUTPUT_COST;
    return inputCost + outputCost;
  }
  if (modelLower.includes("argon") || modelLower.includes("pro")) {
    const inputCost =
      (inputTokens / GEMINI_ADAPTER_CONSTANTS.TOKEN_PRICE_BASE) *
      GEMINI_ADAPTER_CONSTANTS.GEMINI_PRO_INPUT_COST;
    const outputCost =
      (outputTokens / GEMINI_ADAPTER_CONSTANTS.TOKEN_PRICE_BASE) *
      GEMINI_ADAPTER_CONSTANTS.GEMINI_PRO_OUTPUT_COST;
    return inputCost + outputCost;
  }
  return 0;
}

export const estimateCostUsd = estimateGeminiCostUsd;

/**
 * Builds argv argument list for spawning `agy` Antigravity CLI subprocess.
 * Defaults to including `--dangerously-skip-permissions` unless explicitly disabled.
 */
export function buildAntigravityCliArgs(
  options: AntigravityCliArgsOptions
): string[] {
  const model = antigravityModelArg(options.model);
  const effort = antigravityEffortArg(options.effort);
  const conversation = options.conversationId ?? options.resume;

  const argv: string[] = [
    GEMINI_ADAPTER_CONSTANTS.CLI_BIN,
    GEMINI_ADAPTER_CONSTANTS.CLI_FLAG_PROMPT,
    options.prompt,
    GEMINI_ADAPTER_CONSTANTS.CLI_FLAG_OUTPUT_FORMAT,
    GEMINI_ADAPTER_CONSTANTS.CLI_OUTPUT_FORMAT_STREAM_JSON,
  ];

  if (options.dangerouslySkipPermissions !== false) {
    argv.push(GEMINI_ADAPTER_CONSTANTS.CLI_FLAG_DANGEROUSLY_SKIP_PERMISSIONS);
  }

  argv.push(GEMINI_ADAPTER_CONSTANTS.CLI_FLAG_MODEL, model);

  if (effort) {
    argv.push(GEMINI_ADAPTER_CONSTANTS.CLI_FLAG_EFFORT, effort);
  }

  if (conversation) {
    argv.push(GEMINI_ADAPTER_CONSTANTS.CLI_FLAG_CONVERSATION, conversation);
  }

  return argv;
}

export const buildAntigravityArgs = buildAntigravityCliArgs;

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
      GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
  ) {
    parts.push(sessionOptions.systemPrompt.trim());
  } else if (Array.isArray(sessionOptions.systemPrompt)) {
    const sysTexts = sessionOptions.systemPrompt
      .map((p) => p.text?.trim())
      .filter((t): t is string => Boolean(t));
    if (sysTexts.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      parts.push(sysTexts.join("\n\n"));
    }
  }

  const messageTexts: string[] = [];
  for (const message of sessionOptions.messages) {
    const textBlocks = message.content
      .filter(isPalTextContent)
      .map((b) => b.text.trim())
      .filter((t) => t.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS);

    if (textBlocks.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
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

  if (messageTexts.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
    parts.push(messageTexts.join("\n\n"));
  }

  return parts.join("\n\n").trim();
}

/**
 * Options for running Antigravity CLI subprocess.
 */
export interface AntigravitySubprocessOptions {
  prompt?: string;
  sessionOptions?: PalSessionOptions;
  cwd?: string;
  model?: string;
  effort?: string;
  conversationId?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  dangerouslySkipPermissions?: boolean;
  env?: Record<string, string | undefined>;
  spawnFn?: AntigravitySubprocessSpawnFn;
  onTool?: (name: string, input?: Record<string, unknown>) => void;
  onText?: (delta: string) => void;
}

/**
 * Streams events from an Antigravity CLI subprocess (`agy`) using NDJSON reducer.
 */
export async function* streamAntigravitySubprocess(
  options: AntigravitySubprocessOptions,
  defaults?: {
    modelName?: string;
    dangerouslySkipPermissions?: boolean;
    timeoutMs?: number;
    spawnFn?: AntigravitySubprocessSpawnFn;
    cwd?: string;
  }
): AsyncIterable<PalStreamEvent> {
  let prompt = options.prompt;
  let conversationId = options.conversationId;
  let abortSignal = options.abortSignal;
  const timeoutMs =
    options.timeoutMs ??
    defaults?.timeoutMs ??
    GEMINI_ADAPTER_CONSTANTS.DEFAULT_CLI_TIMEOUT_MS;

  if (options.sessionOptions) {
    if (!prompt) {
      prompt = formatSessionPromptForCli(options.sessionOptions);
    }
    conversationId ??= options.sessionOptions.sessionId;
    abortSignal ??= options.sessionOptions.abortSignal;
  }
  if (!prompt) {
    prompt = "";
  }

  const defaultSkip = defaults?.dangerouslySkipPermissions ?? false;
  const dangerouslySkipPermissions =
    options.dangerouslySkipPermissions !== undefined
      ? options.dangerouslySkipPermissions
      : (defaultSkip || true);

  const argv = buildAntigravityCliArgs({
    prompt,
    model: options.model ?? defaults?.modelName,
    effort: options.effort,
    conversationId,
    dangerouslySkipPermissions,
  });

  const spawnFn =
    options.spawnFn ??
    defaults?.spawnFn ??
    (typeof Bun !== "undefined" && typeof Bun.spawn === "function"
      ? (Bun.spawn as unknown as AntigravitySubprocessSpawnFn)
      : undefined);

  if (!spawnFn) {
    yield {
      type: "error",
      error: new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        "No subprocess spawn function available (Bun.spawn is undefined and no custom spawnFn was provided)",
        false
      ),
    };
    return;
  }

  const cwd = options.cwd ?? defaults?.cwd ?? process.cwd();
  let proc: AntigravitySpawnedProcess;
  try {
    proc = spawnFn(argv, {
      cwd,
      env: options.env ?? (process.env as Record<string, string | undefined>),
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
  } catch (spawnErr: unknown) {
    yield {
      type: "error",
      error: new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        `Failed to spawn Antigravity CLI process: ${String(spawnErr)}`,
        false,
        undefined,
        spawnErr
      ),
    };
    return;
  }

  let wasAborted = false;
  const abortHandler = () => {
    wasAborted = true;
    try {
      if (typeof proc.kill === "function") {
        proc.kill("SIGTERM");
      }
    } catch {
      // Ignore termination signals
    }
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      abortHandler();
    } else {
      abortSignal.addEventListener("abort", abortHandler);
    }
  }

  let stderrText = "";
  const stderrPromise = (async () => {
    if (!proc.stderr) return "";
    try {
      let acc = "";
      for await (const chunk of toAsyncIterable<Uint8Array | string>(
        proc.stderr as any
      )) {
        acc +=
          typeof chunk === "string"
            ? chunk
            : new TextDecoder().decode(chunk);
      }
      return acc;
    } catch {
      return "";
    }
  })();

  const reducer = new GeminiNdjsonStreamReducer({
    initialSessionId: conversationId,
    onEvent: (ev) => {
      if (ev.type === "text_delta") options.onText?.(ev.text);
      if (ev.type === "tool_call_end") options.onTool?.(ev.name, ev.arguments);
    },
  });

  try {
    if (proc.stdout) {
      for await (const chunk of toAsyncIterable<Uint8Array | string>(
        proc.stdout as any
      )) {
        if (wasAborted) break;
        const events = reducer.feed(chunk);
        for (const ev of events) {
          yield ev;
        }
      }
    }

    if (!wasAborted) {
      const trailingEvents = reducer.flush();
      for (const ev of trailingEvents) {
        yield ev;
      }
    }
  } catch (streamErr: unknown) {
    if (!wasAborted) {
      yield {
        type: "error",
        error: new PalError(
          PAL_ERROR_KINDS.OVERLOADED,
          `Error reading stdout from Antigravity CLI process: ${String(streamErr)}`,
          true,
          undefined,
          streamErr
        ),
      };
    }
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener("abort", abortHandler);
    }
  }

  stderrText = await stderrPromise;
  let exitCode: number | undefined;
  try {
    exitCode = await proc.exited;
  } catch {
    exitCode = undefined;
  }

  if (wasAborted) {
    yield {
      type: "error",
      error: new PalError(
        PAL_ERROR_KINDS.TIMEOUT,
        `Antigravity CLI process aborted or timed out after ${timeoutMs}ms`,
        true
      ),
    };
    return;
  }

  if (
    exitCode !== undefined &&
    exitCode !== GEMINI_ADAPTER_CONSTANTS.EXIT_CODE_SUCCESS
  ) {
    const state = reducer.getState();
    const failureReason =
      state.error ??
      (stderrText.trim().length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
        ? stderrText
            .trim()
            .slice(-GEMINI_ADAPTER_CONSTANTS.CLI_ERROR_DETAIL_MAX_LENGTH)
        : `Exit code ${exitCode}`);

    const failureCategory = classifyAntigravityFailure(failureReason);
    let errorKind: PalErrorKind;
    let retryable = false;

    if (failureCategory === "fatal") {
      errorKind = PAL_ERROR_KINDS.AUTH_FAILURE;
      retryable = false;
    } else if (failureCategory === "paused") {
      errorKind = PAL_ERROR_KINDS.RATE_LIMIT;
      retryable = true;
    } else {
      errorKind = PAL_ERROR_KINDS.TOOL_ERROR;
      retryable = false;
    }

    yield {
      type: "error",
      error: new PalError(
        errorKind,
        `Antigravity CLI exited with code ${exitCode}: ${failureReason}`,
        retryable,
        undefined,
        { exitCode, stderr: stderrText }
      ),
    };
  }
}

/**
 * Runs Antigravity CLI subprocess to completion and resolves canonical PalOutcome.
 */
export async function runAntigravitySubprocess(
  options: AntigravitySubprocessOptions,
  defaults?: {
    modelName?: string;
    dangerouslySkipPermissions?: boolean;
    timeoutMs?: number;
    spawnFn?: AntigravitySubprocessSpawnFn;
    cwd?: string;
  }
): Promise<PalOutcome> {
  const contentBlocks: PalContentBlock[] = [];
  let finishReason: PalFinishReason = PAL_FINISH_REASONS.STOP;
  let usage: PalTokenUsage = {
    promptTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
    completionTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
    totalTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
  };
  const conversationId: string | undefined =
    options.conversationId ?? options.sessionOptions?.sessionId;
  let errorEvent: PalError | undefined;

  for await (const event of streamAntigravitySubprocess(options, defaults)) {
    if (event.type === "text_delta") {
      const last = contentBlocks[contentBlocks.length - 1];
      if (last && last.type === PAL_CONTENT_BLOCK_TYPES.TEXT) {
        last.text += event.text;
      } else {
        contentBlocks.push(createTextBlock(event.text));
      }
    } else if (event.type === "thought_delta") {
      const last = contentBlocks[contentBlocks.length - 1];
      if (last && last.type === PAL_CONTENT_BLOCK_TYPES.THOUGHT) {
        last.text += event.thought;
      } else {
        contentBlocks.push(
          createThoughtBlock(event.thought, { signature: event.signature })
        );
      }
    } else if (event.type === "tool_call_end") {
      contentBlocks.push(
        createToolCallBlock(event.id, event.name, event.arguments)
      );
    } else if (event.type === "turn_complete") {
      finishReason = event.finishReason;
      usage = event.usage;
    } else if (event.type === "error") {
      errorEvent = event.error;
    }
  }

  if (errorEvent) {
    throw errorEvent;
  }

  const message = createPalMessage({
    id: conversationId,
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
 * Google Gemini Provider Adapter.
 *
 * Implements `ProviderAdapter` (`IPalProvider`) interface, integrating Gemini models
 * with 2M token context, extended thinking support, streaming NDJSON/SSE handling,
 * and canonical PAL telemetry.
 */
export class GeminiAdapter implements ProviderAdapter {
  readonly providerName: PalProviderName;
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultThinking?: PalThinkingOptions;
  private readonly dangerouslySkipPermissions: boolean;
  private executionMode: GeminiExecutionMode;
  private readonly cwd?: string;
  private readonly spawnFn?: AntigravitySubprocessSpawnFn;

  private rateLimitState: PalRateLimitInfo = {
    requestsRemaining: GEMINI_ADAPTER_CONSTANTS.INITIAL_REQUESTS_REMAINING,
    requestsLimit: GEMINI_ADAPTER_CONSTANTS.INITIAL_REQUESTS_LIMIT,
    tokensRemaining: GEMINI_ADAPTER_CONSTANTS.INITIAL_TOKENS_REMAINING,
    tokensLimit: GEMINI_ADAPTER_CONSTANTS.INITIAL_TOKENS_LIMIT,
    resetsAt: GEMINI_ADAPTER_CONSTANTS.INITIAL_RESETS_AT,
  };

  constructor(options?: GeminiAdapterOptions) {
    this.providerName =
      options?.providerName ?? PAL_PROVIDER_NAMES.ANTIGRAVITY;
    this.modelName =
      options?.modelName ?? GEMINI_ADAPTER_CONSTANTS.DEFAULT_MODEL;
    this.apiKey =
      options?.apiKey ??
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      "";
    this.baseUrl =
      options?.baseUrl ??
      process.env.GEMINI_BASE_URL ??
      process.env.GOOGLE_BASE_URL ??
      GEMINI_ADAPTER_CONSTANTS.DEFAULT_BASE_URL;
    this.apiVersion =
      options?.apiVersion ??
      process.env.GEMINI_API_VERSION ??
      GEMINI_ADAPTER_CONSTANTS.DEFAULT_API_VERSION;
    this.timeoutMs =
      options?.timeoutMs ?? GEMINI_ADAPTER_CONSTANTS.DEFAULT_TIMEOUT_MS;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.defaultHeaders = options?.defaultHeaders ?? {};
    this.defaultThinking = options?.defaultThinking;
    this.dangerouslySkipPermissions =
      options?.dangerouslySkipPermissions ?? false;
    this.executionMode = options?.executionMode ?? "api";
    this.cwd = options?.cwd;
    this.spawnFn = options?.spawnFn;
  }

  /**
   * Retrieves active execution mode ("api" or "cli").
   */
  getExecutionMode(): GeminiExecutionMode {
    return this.executionMode;
  }

  /**
   * Configures active execution mode ("api" or "cli").
   */
  setExecutionMode(mode: GeminiExecutionMode): void {
    this.executionMode = mode;
  }

  /**
   * Returns whether CLI subprocessing mode is active.
   */
  isCliMode(): boolean {
    return this.executionMode === "cli";
  }

  /**
   * Builds argv argument list for Antigravity CLI using adapter's defaults.
   */
  buildCliArgs(options: AntigravityCliArgsOptions): string[] {
    const dangerouslySkip =
      options.dangerouslySkipPermissions !== undefined
        ? options.dangerouslySkipPermissions
        : (this.dangerouslySkipPermissions || this.executionMode === "cli");

    return buildAntigravityCliArgs({
      ...options,
      model: options.model ?? this.modelName,
      dangerouslySkipPermissions: dangerouslySkip,
    });
  }

  /**
   * Executes a turn via Antigravity CLI subprocess (`agy`).
   */
  async executeSubprocessTurn(
    options: AntigravitySubprocessOptions
  ): Promise<PalOutcome> {
    const outcome = await runAntigravitySubprocess(options, {
      modelName: this.modelName,
      dangerouslySkipPermissions:
        this.dangerouslySkipPermissions || this.executionMode === "cli",
      timeoutMs: this.timeoutMs,
      spawnFn: this.spawnFn,
      cwd: this.cwd,
    });
    return {
      ...outcome,
      rateLimitInfo: this.getRateLimitState(),
    };
  }

  /**
   * Streams a turn via Antigravity CLI subprocess (`agy`).
   */
  async *streamSubprocessTurn(
    options: AntigravitySubprocessOptions
  ): AsyncIterable<PalStreamEvent> {
    yield* streamAntigravitySubprocess(options, {
      modelName: this.modelName,
      dangerouslySkipPermissions:
        this.dangerouslySkipPermissions || this.executionMode === "cli",
      timeoutMs: this.timeoutMs,
      spawnFn: this.spawnFn,
      cwd: this.cwd,
    });
  }

  /**
   * Retrieves whether dangerouslySkipPermissions is set for Antigravity subprocessing.
   */
  isDangerouslySkipPermissions(): boolean {
    return this.dangerouslySkipPermissions;
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
   */
  resolveThinkingBudget(thinking?: PalThinkingOptions): number | undefined {
    if (!thinking?.enabled) {
      return undefined;
    }
    const budget =
      thinking.budgetTokens ??
      GEMINI_ADAPTER_CONSTANTS.DEFAULT_THINKING_BUDGET_TOKENS;
    validateThinkingBudget(budget);
    return budget;
  }

  /**
   * Prepares standard Gemini API request headers.
   */
  buildHeaders(_sessionOptions?: PalSessionOptions): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": GEMINI_ADAPTER_CONSTANTS.HEADER_CONTENT_TYPE,
      ...this.defaultHeaders,
    };

    if (this.apiKey) {
      headers[GEMINI_ADAPTER_CONSTANTS.HEADER_API_KEY_NAME] = this.apiKey;
    }

    return headers;
  }

  /**
   * Builds the REST endpoint URL for Gemini generateContent or streamGenerateContent.
   */
  buildEndpointUrl(stream: boolean = false): string {
    const action = stream
      ? `${GEMINI_ADAPTER_CONSTANTS.STREAM_GENERATE_CONTENT_ACTION}?${GEMINI_ADAPTER_CONSTANTS.SSE_QUERY_PARAM}`
      : GEMINI_ADAPTER_CONSTANTS.GENERATE_CONTENT_ACTION;
    return `${this.baseUrl}/${this.apiVersion}/models/${encodeURIComponent(this.modelName)}:${action}`;
  }

  /**
   * Retrieves static and negotiated provider capabilities.
   */
  getCapabilities(): PalProviderCapabilities {
    return {
      providerName: this.providerName,
      modelName: this.modelName,
      maxContextTokens: GEMINI_ADAPTER_CONSTANTS.MAX_CONTEXT_TOKENS,
      maxOutputTokens: GEMINI_ADAPTER_CONSTANTS.MAX_OUTPUT_TOKENS,
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
   * Builds the Gemini generateContent wire request payload.
   */
  buildTurnPayload(options: PalSessionOptions): Record<string, unknown> {
    const geminiTurnPayload = toGeminiPayload(options.messages);
    const contents = [...geminiTurnPayload.contents];

    if (contents.length === GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      contents.push({
        role: "user",
        parts: [{ text: "" }],
      });
    }

    const payload: Record<string, unknown> = {
      contents,
    };

    // System instruction handling: merge any explicit sessionPrompt
    const systemParts: Array<{ text: string }> = [];
    if (geminiTurnPayload.systemInstruction?.parts) {
      systemParts.push(...geminiTurnPayload.systemInstruction.parts);
    }
    if (
      typeof options.systemPrompt === "string" &&
      options.systemPrompt.trim().length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
    ) {
      systemParts.push({ text: options.systemPrompt });
    } else if (Array.isArray(options.systemPrompt)) {
      for (const part of options.systemPrompt) {
        if (
          typeof part.text === "string" &&
          part.text.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
        ) {
          systemParts.push({ text: part.text });
        }
      }
    }

    if (systemParts.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      payload.systemInstruction = { parts: systemParts };
    }

    // Generation configuration (temperature, maxOutputTokens, thinkingConfig)
    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }

    const activeThinking = this.resolveThinkingOptions(options.thinking);
    const thinkingBudget = this.resolveThinkingBudget(activeThinking);
    if (thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = {
        thinkingBudget,
      };
    }

    if (
      Object.keys(generationConfig).length >
      GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
    ) {
      payload.generationConfig = generationConfig;
    }

    // Tools definition mapping
    const formattedTools = formatGeminiTools(options.tools);
    if (formattedTools) {
      payload.tools = formattedTools;
      const formattedToolChoice = formatGeminiToolChoice(options.toolChoice);
      if (formattedToolChoice) {
        payload.toolConfig = formattedToolChoice;
      }
    }

    return payload;
  }

  /**
   * Updates internal rate limit tracking state from response headers.
   */
  private updateRateLimitState(headers: Headers): void {
    const parsed = parseGeminiRateLimitHeaders(headers);
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
      return this.executeSubprocessTurn({
        sessionOptions: options,
        abortSignal: options.abortSignal,
      });
    }

    const payload = this.buildTurnPayload(options);
    const endpoint = this.buildEndpointUrl(false);
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
          `Gemini API request timed out after ${this.timeoutMs}ms`,
          true,
          undefined,
          err
        );
      }
      throw new PalError(
        PAL_ERROR_KINDS.OVERLOADED,
        `Network failure connecting to Gemini API: ${String(err)}`,
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
        `Failed to parse Gemini JSON response: ${String(err)}`,
        false,
        undefined,
        err
      );
    }

    if (!response.ok) {
      throw parseGeminiError(response.status, responseData, response.headers);
    }

    if (!isRecord(responseData)) {
      throw new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        "Gemini API returned non-object response payload",
        false
      );
    }

    const message: PalMessage = fromGeminiResponse(responseData);

    const hasToolCalls = message.content.some(
      (b) => b.type === PAL_CONTENT_BLOCK_TYPES.TOOL_CALL
    );

    let rawFinishReason: unknown;
    if (
      Array.isArray(responseData.candidates) &&
      responseData.candidates.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS &&
      isRecord(responseData.candidates[GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS])
    ) {
      rawFinishReason =
        responseData.candidates[GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS]
          .finishReason;
    }

    const finishReason = mapGeminiFinishReason(rawFinishReason, hasToolCalls);
    const usage = calculateGeminiTokenUsage(responseData.usageMetadata);

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
      yield* this.streamSubprocessTurn({
        sessionOptions: options,
        abortSignal: options.abortSignal,
      });
      return;
    }

    const payload = this.buildTurnPayload(options);
    const endpoint = this.buildEndpointUrl(true);
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
          `Failed to initiate Gemini streaming connection: ${String(err)}`,
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
        error: parseGeminiError(response.status, errorData, response.headers),
      };
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        error: new PalError(
          PAL_ERROR_KINDS.INVALID_REQUEST,
          "Gemini streaming response body is null",
          false
        ),
      };
      return;
    }

    const parser = new GeminiStreamChunkParser();
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
          `Error reading stream from Gemini API: ${String(err)}`,
          true,
          undefined,
          err
        ),
      };
    }
  }
}

/**
 * Options for GeminiStreamChunkParser.
 */
export interface GeminiStreamChunkParserOptions {
  onEvent?: (event: PalStreamEvent) => void;
}

/**
 * Streaming parser processing Gemini SSE chunks and Antigravity NDJSON streams.
 */
export class GeminiStreamChunkParser {
  private lineBuffer: string = "";
  private readonly decoder: TextDecoder = new TextDecoder(
    GEMINI_ADAPTER_CONSTANTS.TEXT_DECODER_ENCODING
  );
  private readonly onEvent?: (event: PalStreamEvent) => void;
  private ndjsonState: GeminiNdjsonReducerState = createInitialNdjsonReducerState();
  private accumulatedUsage: PalTokenUsage = {
    promptTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
    completionTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
    totalTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
  };
  private finishReason: PalFinishReason = PAL_FINISH_REASONS.STOP;
  private hasToolCalls: boolean = false;
  private isDone: boolean = false;
  private turnCompleteEmitted: boolean = false;
  private readonly contentBlocks: PalContentBlock[] = [];

  constructor(options?: GeminiStreamChunkParserOptions) {
    this.onEvent = options?.onEvent;
  }

  /**
   * Resets parser state for a fresh stream.
   */
  reset(): void {
    this.lineBuffer = "";
    this.contentBlocks.length = GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS;
    this.accumulatedUsage = {
      promptTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS,
    };
    this.finishReason = PAL_FINISH_REASONS.STOP;
    this.hasToolCalls = false;
    this.isDone = false;
    this.turnCompleteEmitted = false;
    this.ndjsonState = createInitialNdjsonReducerState();
  }

  /**
   * Retrieves accumulated token usage telemetry.
   */
  getAccumulatedUsage(): PalTokenUsage {
    return { ...this.accumulatedUsage };
  }

  /**
   * Retrieves current finish reason.
   */
  getFinishReason(): PalFinishReason {
    return this.finishReason;
  }

  /**
   * Returns whether the stream has completed.
   */
  isCompleted(): boolean {
    return this.isDone;
  }

  /**
   * Returns all accumulated content blocks.
   */
  getContentBlocks(): PalContentBlock[] {
    return [...this.contentBlocks];
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
   * Parses an individual line from SSE or NDJSON stream.
   */
  feedLine(line: string): PalStreamEvent[] {
    const trimmed = line.trim();
    if (trimmed.length === GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS) {
      return [];
    }

    if (trimmed.startsWith(GEMINI_ADAPTER_CONSTANTS.SSE_COMMENT_PREFIX)) {
      return [];
    }

    let payloadStr = trimmed;
    if (trimmed.startsWith(GEMINI_ADAPTER_CONSTANTS.SSE_DATA_PREFIX)) {
      payloadStr = trimmed
        .slice(GEMINI_ADAPTER_CONSTANTS.SSE_DATA_PREFIX.length)
        .trim();
    }

    if (payloadStr === GEMINI_ADAPTER_CONSTANTS.SSE_DONE_SIGNAL) {
      this.isDone = true;
      if (!this.turnCompleteEmitted) {
        this.turnCompleteEmitted = true;
        return [
          {
            type: "turn_complete",
            finishReason: this.hasToolCalls
              ? PAL_FINISH_REASONS.TOOL_CALLS
              : this.finishReason,
            usage: this.accumulatedUsage,
          },
        ];
      }
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadStr);
    } catch {
      return [];
    }

    return this.processParsedJson(parsed);
  }

  private processParsedJson(parsed: unknown): PalStreamEvent[] {
    if (!isRecord(parsed)) {
      return [];
    }

    // 1. Antigravity CLI / Gemini NDJSON event support via reducer
    if (
      typeof parsed.event === "string" ||
      typeof parsed.type === "string" ||
      "step_update" in parsed ||
      "delta" in parsed ||
      "result" in parsed
    ) {
      const ndjsonEvents = reduceGeminiNdjsonEvent(this.ndjsonState, parsed);
      this.accumulatedUsage = { ...this.ndjsonState.usage };
      this.finishReason = this.ndjsonState.finishReason;
      this.hasToolCalls = this.ndjsonState.hasToolCalls;
      this.isDone = this.ndjsonState.isCompleted;
      this.turnCompleteEmitted = this.ndjsonState.turnCompleteEmitted;
      this.contentBlocks.length = GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS;
      this.contentBlocks.push(...this.ndjsonState.contentBlocks);
      return ndjsonEvents;
    }

    const events: PalStreamEvent[] = [];

    // 2. Google Gemini GenerateContent response / chunk
    if (isRecord(parsed.usageMetadata)) {
      const deltaUsage = calculateGeminiTokenUsage(parsed.usageMetadata);
      this.accumulatedUsage = {
        promptTokens:
          deltaUsage.promptTokens || this.accumulatedUsage.promptTokens,
        completionTokens:
          deltaUsage.completionTokens || this.accumulatedUsage.completionTokens,
        totalTokens:
          deltaUsage.totalTokens || this.accumulatedUsage.totalTokens,
        cachedPromptTokens:
          deltaUsage.cachedPromptTokens ??
          this.accumulatedUsage.cachedPromptTokens,
        thinkingTokens:
          deltaUsage.thinkingTokens ?? this.accumulatedUsage.thinkingTokens,
      };
    }

    if (
      Array.isArray(parsed.candidates) &&
      parsed.candidates.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
    ) {
      for (const candidate of parsed.candidates) {
        if (!isRecord(candidate)) continue;

        if (typeof candidate.finishReason === "string") {
          this.finishReason = mapGeminiFinishReason(
            candidate.finishReason,
            this.hasToolCalls
          );
        }

        if (
          isRecord(candidate.content) &&
          Array.isArray(candidate.content.parts)
        ) {
          for (const part of candidate.content.parts) {
            if (!isRecord(part)) continue;

            if (
              typeof part.thought === "string" &&
              part.thought.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
            ) {
              events.push({ type: "thought_delta", thought: part.thought });
              this.appendThoughtBlock(part.thought);
            } else if (
              part.thought === true &&
              typeof part.text === "string" &&
              part.text.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
            ) {
              events.push({ type: "thought_delta", thought: part.text });
              this.appendThoughtBlock(part.text);
            } else if (
              typeof part.text === "string" &&
              part.text.length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
            ) {
              events.push({ type: "text_delta", text: part.text });
              this.appendTextBlock(part.text);
            }

            if (isRecord(part.functionCall)) {
              this.hasToolCalls = true;
              const name =
                typeof part.functionCall.name === "string"
                  ? part.functionCall.name
                  : GEMINI_ADAPTER_CONSTANTS.FALLBACK_TOOL_NAME;
              const id =
                typeof part.functionCall.id === "string" &&
                part.functionCall.id.length >
                  GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
                  ? part.functionCall.id
                  : randomUUID();

              const convertedArgs = convertProtobufStructToJson(
                part.functionCall.args
              );
              const argsObj = isRecord(convertedArgs) ? convertedArgs : {};
              const argsDelta = JSON.stringify(argsObj);

              events.push({
                type: "tool_call_delta",
                id,
                name,
                argumentsDelta: argsDelta,
              });
              events.push({
                type: "tool_call_end",
                id,
                name,
                arguments: argsObj,
              });
              this.contentBlocks.push(createToolCallBlock(id, name, argsObj));
            }
          }
        }
      }
    }

    return events;
  }

  private appendTextBlock(text: string): void {
    const lastBlock =
      this.contentBlocks[
        this.contentBlocks.length - 1
      ];
    if (lastBlock && lastBlock.type === PAL_CONTENT_BLOCK_TYPES.TEXT) {
      lastBlock.text += text;
    } else {
      this.contentBlocks.push(createTextBlock(text));
    }
  }

  private appendThoughtBlock(thought: string): void {
    const lastBlock =
      this.contentBlocks[
        this.contentBlocks.length - 1
      ];
    if (lastBlock && lastBlock.type === PAL_CONTENT_BLOCK_TYPES.THOUGHT) {
      lastBlock.text += thought;
    } else {
      this.contentBlocks.push(createThoughtBlock(thought));
    }
  }

  /**
   * Flushes any remaining lines in buffer and completes the stream.
   */
  flush(): PalStreamEvent[] {
    const events: PalStreamEvent[] = [];
    if (
      this.lineBuffer.trim().length > GEMINI_ADAPTER_CONSTANTS.ZERO_TOKENS
    ) {
      const lineEvents = this.feedLine(this.lineBuffer);
      for (const ev of lineEvents) {
        events.push(ev);
        this.onEvent?.(ev);
      }
      this.lineBuffer = "";
    }

    if (!this.turnCompleteEmitted) {
      this.turnCompleteEmitted = true;
      this.isDone = true;
      const completeEvent: PalStreamEvent = {
        type: "turn_complete",
        finishReason: this.hasToolCalls
          ? PAL_FINISH_REASONS.TOOL_CALLS
          : this.finishReason,
        usage: this.accumulatedUsage,
      };
      events.push(completeEvent);
      this.onEvent?.(completeEvent);
    }

    return events;
  }

  /**
   * Assembles a canonical PalMessage from all streamed content blocks.
   */
  toMessage(id?: string): PalMessage {
    return createPalMessage({
      id: id ?? randomUUID(),
      role: PAL_ROLES.ASSISTANT,
      content: [...this.contentBlocks],
    });
  }

  /**
   * Parses chunks from an input stream into an async iterable of PalStreamEvents.
   */
  async *parse(
    source:
      | ReadableStream<Uint8Array | string>
      | AsyncIterable<Uint8Array | string>
      | Iterable<Uint8Array | string>
  ): AsyncIterable<PalStreamEvent> {
    this.reset();
    for await (const chunk of toAsyncIterable(source)) {
      const events = this.feed(chunk);
      for (const ev of events) {
        yield ev;
      }
    }
    const trailingEvents = this.flush();
    for (const ev of trailingEvents) {
      yield ev;
    }
  }
}

/**
 * Feeds a chunk into the provided Gemini parser instance.
 */
export function parseGeminiStreamChunk(
  chunk: Uint8Array | string,
  parser: GeminiStreamChunkParser
): PalStreamEvent[] {
  return parser.feed(chunk);
}

/**
 * Standalone generator parsing chunks from any ReadableStream, AsyncIterable, or Iterable into PalStreamEvents.
 */
export async function* parseGeminiStream(
  stream:
    | AsyncIterable<Uint8Array | string>
    | Iterable<Uint8Array | string>
    | ReadableStream<Uint8Array | string>,
  options?: GeminiStreamChunkParserOptions
): AsyncIterable<PalStreamEvent> {
  const parser = new GeminiStreamChunkParser(options);
  yield* parser.parse(stream);
}

/**
 * Factory function creating a configured GeminiAdapter.
 */
export function createGeminiAdapter(
  options?: GeminiAdapterOptions
): GeminiAdapter {
  return new GeminiAdapter(options);
}

/**
 * Default singleton instance of GeminiAdapter.
 */
export const geminiPalAdapter: GeminiAdapter = createGeminiAdapter();

/**
 * Aliases adhering to Provider Abstraction Layer naming conventions.
 */
export {
  GeminiAdapter as AntigravityAdapter,
  GeminiAdapter as AntigravityPalAdapter,
};
