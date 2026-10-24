/**
 * Provider Abstraction Layer (PAL) Bi-directional Message Normalizer.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 4.3, 4.4, and 4.5.
 *
 * Provides bidirectional translation between canonical PAL messages and vendor-specific
 * payload schemas (Anthropic Claude, Google Gemini, OpenAI / OpenCode), strictly enforcing
 * the turn-folding invariant, preserving cryptographic signatures in thinking blocks, and
 * resolving tool call and response block format discrepancies across providers.
 */

import { randomUUID } from "node:crypto";
import {
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ERROR_KINDS,
  PAL_IMAGE_MIME_TYPES,
  PAL_ROLES,
  PalError,
  createImageBlock,
  createPalMessage,
  createTextBlock,
  createThoughtBlock,
  createToolCallBlock,
  createToolResultBlock,
  isPalImageContent,
  isPalTextContent,
  isPalThoughtContent,
  isPalToolCallContent,
  isPalToolResultContent,
  type ClaudeContentBlock,
  type ClaudeToolResultBlock,
  type ClaudeToolResultImagePart,
  type ClaudeToolUseBlock,
  type ClaudeTurnMessage,
  type ClaudeTurnPayload,
  type GeminiFunctionCallPart,
  type GeminiFunctionResponsePart,
  type GeminiPart,
  type GeminiTurnContent,
  type GeminiTurnPayload,
  type OpenAiToolCall,
  type OpenAiTurnMessage,
  type OpenAiTurnPayload,
  type PalContentBlock,
  type PalImageMimeType,
  type PalMessage,
  type PalRole,
  type PalToolCallContent,
  type PalToolResultContent,
  type PalTurnNormalizer,
} from "./types";

/**
 * Standard synthetic prompt for prepending when conversational history begins with an assistant turn.
 */
export const SYNTHETIC_USER_PROMPT = "Begin session";

/**
 * Synthetic tool failure error message when tool results are missing or unhandled.
 */
export const SYNTHETIC_TOOL_ERROR_MESSAGE =
  "Error: Tool execution aborted, timed out, or unhandled by runner.";

/**
 * Permissive regex for ReAct fallback tool call parsing.
 * Matches whitespace-tolerant <tool_call>...</tool_call> tags.
 */
export const TOOL_CALL_REGEX = /<tool_call[\s\S]*?>([\s\S]*?)<\/tool_call>/gi;

/**
 * Provider-specific role literals avoiding magic strings.
 */
export const PROVIDER_ROLES = {
  CLAUDE_USER: "user",
  CLAUDE_ASSISTANT: "assistant",
  GEMINI_USER: "user",
  GEMINI_MODEL: "model",
  OPENAI_SYSTEM: "system",
  OPENAI_USER: "user",
  OPENAI_ASSISTANT: "assistant",
  OPENAI_TOOL: "tool",
} as const;

export const DEFAULT_IMAGE_MIME_TYPE: PalImageMimeType = PAL_IMAGE_MIME_TYPES.PNG;

/**
 * Safe type guard to check if an unknown value is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Safe type guard to validate known image MIME types.
 */
function isSupportedImageMimeType(value: unknown): value is PalImageMimeType {
  return (
    typeof value === "string" &&
    Object.values(PAL_IMAGE_MIME_TYPES).includes(value as PalImageMimeType)
  );
}

/**
 * Repairs commonly observed LLM malformed JSON argument payloads.
 *
 * Resolves:
 * - Markdown code fences (```json ... ``` or ``` ... ```)
 * - Trailing commas in objects and arrays
 * - Unescaped quotes / boundaries
 * - Single-quoted keys and string literals
 * - Surrounding conversational commentary
 */
export function repairJsonArguments(raw: string): Record<string, unknown> {
  if (!raw || typeof raw !== "string") {
    return {};
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {};
  }

  // 1. Direct parse attempt
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      return parsed;
    }
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    // Continue through heuristics
  }

  let cleaned = trimmed;

  // 2. Strip markdown fences
  const fenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const fenceMatch = cleaned.match(fenceRegex);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  // Try parsing after fence stripping
  try {
    const parsed = JSON.parse(cleaned);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Continue
  }

  // 3. Remove trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  try {
    const parsed = JSON.parse(cleaned);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Continue
  }

  // 4. Handle single quotes for keys/strings: {'key': 'val'} -> {"key": "val"}
  try {
    const singleQuotesNormalized = cleaned.replace(
      /'([^'\\]*(?:\\.[^'\\]*)*)'/g,
      '"$1"'
    );
    const parsed = JSON.parse(singleQuotesNormalized);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Continue
  }

  // 5. Extract JSON object substring between first '{' and last '}'
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const bracketed = cleaned.substring(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(bracketed);
      if (isRecord(parsed)) return parsed;
    } catch {
      try {
        const noTrailing = bracketed.replace(/,\s*([}\]])/g, "$1");
        const parsed = JSON.parse(noTrailing);
        if (isRecord(parsed)) return parsed;
      } catch {
        // Fallback
      }
    }
  }

  return {};
}

/**
 * Extracted ReAct tool calls result.
 */
export interface ExtractedReActCalls {
  toolCalls: PalToolCallContent[];
  cleanText: string;
}

/**
 * Parses ReAct-style <tool_call>...</tool_call> tags from conversational text.
 */
export function extractReActToolCalls(text: string): ExtractedReActCalls {
  if (!text || typeof text !== "string") {
    return { toolCalls: [], cleanText: "" };
  }

  const toolCalls: PalToolCallContent[] = [];
  const regex = new RegExp(TOOL_CALL_REGEX.source, TOOL_CALL_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawPayload = (match[1] ?? "").trim();
    if (!rawPayload) continue;

    const parsed = repairJsonArguments(rawPayload);
    const name =
      typeof parsed.name === "string"
        ? parsed.name
        : typeof parsed.tool === "string"
          ? parsed.tool
          : typeof parsed.call === "string"
            ? parsed.call
            : "";

    if (name.length > 0) {
      let args: Record<string, unknown> = {};
      if (isRecord(parsed.arguments)) {
        args = parsed.arguments;
      } else if (isRecord(parsed.parameters)) {
        args = parsed.parameters;
      } else if (isRecord(parsed.args)) {
        args = parsed.args;
      } else {
        const { name: _n, tool: _t, call: _c, ...rest } = parsed;
        args = rest;
      }

      toolCalls.push(createToolCallBlock(randomUUID(), name, args, rawPayload));
    }
  }

  const cleanText = text.replace(regex, "").trim();
  return { toolCalls, cleanText };
}

/**
 * Normalizes a canonical PalToolCallContent block into an Anthropic Claude tool_use block.
 */
export function normalizeToolCallToClaude(call: PalToolCallContent): ClaudeToolUseBlock {
  return {
    type: "tool_use",
    id: call.id,
    name: call.name,
    input: call.arguments,
  };
}

/**
 * Normalizes an Anthropic Claude tool_use block into a canonical PalToolCallContent block.
 */
export function normalizeToolCallFromClaude(block: unknown): PalToolCallContent {
  if (!isRecord(block)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid Claude tool_use block: expected an object",
      false
    );
  }

  const callId = typeof block.id === "string" && block.id.length > 0 ? block.id : randomUUID();
  const name = typeof block.name === "string" ? block.name : "";
  let args: Record<string, unknown> = {};
  let rawArgs: string | undefined;

  if (isRecord(block.input)) {
    args = block.input;
    rawArgs = JSON.stringify(block.input);
  } else if (typeof block.input === "string") {
    rawArgs = block.input;
    args = repairJsonArguments(block.input);
  }

  return createToolCallBlock(callId, name, args, rawArgs);
}

/**
 * Normalizes a canonical PalToolResultContent block into an Anthropic Claude tool_result block.
 */
export function normalizeToolResultToClaude(result: PalToolResultContent): ClaudeToolResultBlock {
  let formattedContent: string | Array<{ type: "text"; text: string } | ClaudeToolResultImagePart>;

  if (typeof result.content === "string") {
    formattedContent = result.content;
  } else if (Array.isArray(result.content)) {
    const parts: Array<{ type: "text"; text: string } | ClaudeToolResultImagePart> = [];
    for (const item of result.content) {
      if (isPalTextContent(item)) {
        parts.push({ type: "text", text: item.text });
      } else if (isPalImageContent(item)) {
        parts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: item.mimeType,
            data: item.data,
          },
        });
      } else {
        parts.push({ type: "text", text: JSON.stringify(item) });
      }
    }
    formattedContent = parts.length > 0 ? parts : "";
  } else {
    formattedContent = String(result.content);
  }

  return {
    type: "tool_result",
    tool_use_id: result.toolCallId,
    content: formattedContent,
    ...(result.isError ? { is_error: true } : {}),
  };
}

/**
 * Normalizes an Anthropic Claude tool_result block into a canonical PalToolResultContent block.
 */
export function normalizeToolResultFromClaude(block: unknown): PalToolResultContent {
  if (!isRecord(block)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid Claude tool_result block: expected an object",
      false
    );
  }

  const toolCallId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
  const toolName =
    typeof block.name === "string"
      ? block.name
      : typeof block.tool_name === "string"
        ? block.tool_name
        : "";
  const isError = Boolean(block.is_error);

  let contentVal: string | PalContentBlock[] = "";
  if (typeof block.content === "string") {
    contentVal = block.content;
  } else if (Array.isArray(block.content)) {
    const blocks: PalContentBlock[] = [];
    for (const item of block.content) {
      if (!isRecord(item)) continue;
      if (item.type === "text" && typeof item.text === "string") {
        blocks.push(createTextBlock(item.text));
      } else if (item.type === "image" && isRecord(item.source)) {
        const mediaType = isSupportedImageMimeType(item.source.media_type)
          ? (item.source.media_type as PalImageMimeType)
          : DEFAULT_IMAGE_MIME_TYPE;
        const data = typeof item.source.data === "string" ? item.source.data : "";
        blocks.push(createImageBlock(mediaType, data));
      }
    }
    contentVal = blocks.length > 0 ? blocks : "";
  }

  return createToolResultBlock(toolCallId, toolName, contentVal, isError);
}

/**
 * Normalizes a canonical PalToolCallContent block into a Google Gemini functionCall part.
 */
export function normalizeToolCallToGemini(call: PalToolCallContent): GeminiFunctionCallPart {
  return {
    functionCall: {
      name: call.name,
      args: call.arguments,
      id: call.id,
    },
  };
}

/**
 * Normalizes a Google Gemini functionCall part into a canonical PalToolCallContent block.
 */
export function normalizeToolCallFromGemini(
  part: unknown,
  fallbackId?: string
): PalToolCallContent {
  if (!isRecord(part)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid Gemini functionCall part: expected an object",
      false
    );
  }

  const fnCall = isRecord(part.functionCall) ? part.functionCall : part;
  const name = typeof fnCall.name === "string" ? fnCall.name : "";
  const id =
    typeof fnCall.id === "string" && fnCall.id.length > 0
      ? fnCall.id
      : fallbackId ?? randomUUID();

  let args: Record<string, unknown> = {};
  let rawArgs: string | undefined;

  if (isRecord(fnCall.args)) {
    args = fnCall.args;
    rawArgs = JSON.stringify(fnCall.args);
  } else if (typeof fnCall.args === "string") {
    rawArgs = fnCall.args;
    args = repairJsonArguments(fnCall.args);
  }

  return createToolCallBlock(id, name, args, rawArgs);
}

/**
 * Normalizes a canonical PalToolResultContent block into a Google Gemini functionResponse part.
 */
export function normalizeToolResultToGemini(
  result: PalToolResultContent,
  fallbackToolName?: string
): GeminiFunctionResponsePart {
  const name =
    result.toolName && result.toolName.length > 0
      ? result.toolName
      : (fallbackToolName ?? "");
  return {
    functionResponse: {
      name,
      response: formatGeminiResponse(result.content, result.isError),
      ...(result.toolCallId ? { id: result.toolCallId } : {}),
    },
  };
}

/**
 * Normalizes a Google Gemini functionResponse part into a canonical PalToolResultContent block.
 */
export function normalizeToolResultFromGemini(
  part: unknown,
  fallbackToolCallId?: string
): PalToolResultContent {
  if (!isRecord(part)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid Gemini functionResponse part: expected an object",
      false
    );
  }

  const fnResp = isRecord(part.functionResponse) ? part.functionResponse : part;
  const name = typeof fnResp.name === "string" ? fnResp.name : "";
  const toolCallId =
    typeof fnResp.id === "string" && fnResp.id.length > 0
      ? fnResp.id
      : fallbackToolCallId ?? "";

  const resp = isRecord(fnResp.response) ? fnResp.response : {};
  let responseText: string;
  let isErr = false;

  if (typeof resp.error === "string") {
    responseText = resp.error;
    isErr = true;
  } else if (resp.error !== undefined && resp.error !== null) {
    responseText =
      typeof resp.error === "object" ? JSON.stringify(resp.error) : String(resp.error);
    isErr = true;
  } else if (typeof resp.output === "string") {
    responseText = resp.output;
  } else if (resp.output !== undefined && resp.output !== null) {
    responseText =
      typeof resp.output === "object" ? JSON.stringify(resp.output) : String(resp.output);
  } else {
    responseText = JSON.stringify(resp);
  }

  if (resp.isError === true) {
    isErr = true;
  }

  return createToolResultBlock(toolCallId, name, responseText, isErr);
}

/**
 * Normalizes a canonical PalToolCallContent block into an OpenAI / OpenCode tool_calls entry.
 */
export function normalizeToolCallToOpenAi(call: PalToolCallContent): OpenAiToolCall {
  return {
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: call.rawArguments ?? JSON.stringify(call.arguments),
    },
  };
}

/**
 * Normalizes an OpenAI / OpenCode tool_calls entry into a canonical PalToolCallContent block.
 */
export function normalizeToolCallFromOpenAi(call: unknown): PalToolCallContent {
  if (!isRecord(call)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid OpenAI tool call: expected an object",
      false
    );
  }

  const id = typeof call.id === "string" && call.id.length > 0 ? call.id : randomUUID();
  const fn = isRecord(call.function) ? call.function : {};
  const name = typeof fn.name === "string" ? fn.name : "";
  const rawArgs = typeof fn.arguments === "string" ? fn.arguments : "";
  const parsedArgs = repairJsonArguments(rawArgs);

  return createToolCallBlock(id, name, parsedArgs, rawArgs);
}

/**
 * Normalizes a canonical PalToolResultContent block into an OpenAI / OpenCode tool message.
 */
export function normalizeToolResultToOpenAi(result: PalToolResultContent): OpenAiTurnMessage {
  let contentStr: string;
  if (typeof result.content === "string") {
    contentStr = result.content;
  } else if (Array.isArray(result.content)) {
    contentStr = result.content
      .map((c) => (isPalTextContent(c) ? c.text : JSON.stringify(c)))
      .join("\n");
  } else {
    contentStr = JSON.stringify(result.content);
  }

  return {
    role: PROVIDER_ROLES.OPENAI_TOOL,
    tool_call_id: result.toolCallId,
    name: result.toolName && result.toolName.length > 0 ? result.toolName : undefined,
    content: contentStr,
  };
}

/**
 * Normalizes an OpenAI / OpenCode tool message into a canonical PalToolResultContent block.
 */
export function normalizeToolResultFromOpenAi(msg: unknown): PalToolResultContent {
  if (!isRecord(msg)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid OpenAI tool message: expected an object",
      false
    );
  }

  const toolCallId = typeof msg.tool_call_id === "string" ? msg.tool_call_id : "";
  const name = typeof msg.name === "string" ? msg.name : "";
  let content = "";

  if (typeof msg.content === "string") {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = msg.content
      .filter(isRecord)
      .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
      .join("\n");
  }

  return createToolResultBlock(toolCallId, name, content, false);
}

/**
 * Implements Section 4.3.1 Turn-Folding Invariant (Claude & Gemini Alternation Enforcement).
 *
 * Rules:
 * 1. Scans the canonical message sequence.
 * 2. Any contiguous sequence of messages where role === "user" or role === "tool" is folded into a single unified user turn.
 * 3. Content blocks from all messages in the run are preserved in sequential order within the single turn.
 * 4. Any contiguous sequence of assistant messages is merged into a single assistant turn with aggregated content blocks.
 * 5. If the first conversational message in the history is an assistant turn, a synthetic empty user initialization message ("Begin session") is prepended.
 *
 * Leading system messages are preserved at the beginning of the returned array.
 */
export function normalizeTurns(messages: PalMessage[]): PalMessage[] {
  if (messages.length === 0) {
    return [];
  }

  // 1. Separate leading system messages
  const systemMessages: PalMessage[] = [];
  let startIndex = 0;
  while (startIndex < messages.length) {
    const msg = messages[startIndex];
    if (!msg || msg.role !== PAL_ROLES.SYSTEM) {
      break;
    }
    systemMessages.push(msg);
    startIndex++;
  }

  if (startIndex >= messages.length) {
    return [...systemMessages];
  }

  // 2. Scan and fold conversational messages
  const conversationalMessages = messages.slice(startIndex);
  const folded: PalMessage[] = [];
  let currentGroupRole: "user" | "assistant" | null = null;
  let currentBlocks: PalContentBlock[] = [];
  let firstMessageInGroup: PalMessage | null = null;
  let aggregatedMetadata: Record<string, unknown> = {};

  const flushCurrentGroup = (): void => {
    if (currentGroupRole !== null && firstMessageInGroup !== null) {
      folded.push(
        createPalMessage({
          id: firstMessageInGroup.id,
          role: currentGroupRole === "user" ? PAL_ROLES.USER : PAL_ROLES.ASSISTANT,
          content: [...currentBlocks],
          name: firstMessageInGroup.name,
          timestamp: firstMessageInGroup.timestamp,
          metadata: Object.keys(aggregatedMetadata).length > 0 ? aggregatedMetadata : undefined,
        })
      );
      currentGroupRole = null;
      currentBlocks = [];
      firstMessageInGroup = null;
      aggregatedMetadata = {};
    }
  };

  for (const msg of conversationalMessages) {
    // Trailing/interspersed system messages are gathered into systemMessages
    if (msg.role === PAL_ROLES.SYSTEM) {
      systemMessages.push(msg);
      continue;
    }

    const targetRole: "user" | "assistant" =
      msg.role === PAL_ROLES.USER || msg.role === PAL_ROLES.TOOL ? "user" : "assistant";

    if (currentGroupRole === null) {
      currentGroupRole = targetRole;
      firstMessageInGroup = msg;
      currentBlocks = [...msg.content];
      aggregatedMetadata = { ...(msg.metadata ?? {}) };
    } else if (currentGroupRole === targetRole) {
      currentBlocks.push(...msg.content);
      if (msg.metadata) {
        aggregatedMetadata = { ...aggregatedMetadata, ...msg.metadata };
      }
    } else {
      flushCurrentGroup();
      currentGroupRole = targetRole;
      firstMessageInGroup = msg;
      currentBlocks = [...msg.content];
      aggregatedMetadata = { ...(msg.metadata ?? {}) };
    }
  }

  flushCurrentGroup();

  // 3. Rule 5: Prepend synthetic user message if conversational history starts with an assistant turn
  const firstFolded = folded[0];
  if (firstFolded && firstFolded.role === PAL_ROLES.ASSISTANT) {
    const syntheticUserMessage = createPalMessage({
      role: PAL_ROLES.USER,
      content: [createTextBlock(SYNTHETIC_USER_PROMPT)],
      metadata: { synthetic: true },
    });
    folded.unshift(syntheticUserMessage);
  }

  return [...systemMessages, ...folded];
}

/**
 * Implements Section 4.3.3 Gemini Protobuf Struct Invariant.
 *
 * Maps tool response content to a structured Record<string, unknown> preventing
 * google.protobuf.Struct INVALID_ARGUMENT rejections.
 */
export function formatGeminiResponse(
  content: string | PalContentBlock[],
  isError: boolean
): Record<string, unknown> {
  if (typeof content === "string") {
    return isError ? { error: content } : { output: content };
  }
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (isPalTextContent(c) ? c.text : JSON.stringify(c)))
      .join("\n");
    return isError ? { error: text } : { output: text };
  }
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>;
    if (isError && !("error" in obj)) {
      return { error: obj };
    }
    return obj;
  }
  return isError ? { error: String(content) } : { output: String(content) };
}

/**
 * Implements Section 4.3.2 Atomic Tool Batch Resolution Invariant.
 *
 * Ensures every tool invocation generated by the assistant turn has a matching tool result,
 * synthesizing error outcomes for any dropped or unhandled calls.
 */
export function reconcileToolBatch(
  modelToolCalls: PalToolCallContent[],
  userToolResults: PalToolResultContent[]
): PalToolResultContent[] {
  const resultMap = new Map<string, PalToolResultContent>();
  for (const res of userToolResults) {
    resultMap.set(res.toolCallId, res);
  }

  const reconciled: PalToolResultContent[] = [];
  const matchedIds = new Set<string>();

  for (const call of modelToolCalls) {
    const existing = resultMap.get(call.id);
    if (existing) {
      const resolvedName =
        existing.toolName && existing.toolName.length > 0 ? existing.toolName : call.name;
      reconciled.push({
        ...existing,
        toolName: resolvedName,
      });
      matchedIds.add(call.id);
    } else {
      reconciled.push(
        createToolResultBlock(
          call.id,
          call.name,
          SYNTHETIC_TOOL_ERROR_MESSAGE,
          true
        )
      );
    }
  }

  // Preserve any remaining user results that did not match a model call
  for (const res of userToolResults) {
    if (!matchedIds.has(res.toolCallId)) {
      reconciled.push(res);
    }
  }

  return reconciled;
}

/**
 * Normalizes canonical PAL messages into an Anthropic Messages API payload.
 *
 * Enforces:
 * - System prompts placed in top-level `system` parameter with ephemeral cacheControl preserved.
 * - Strict turn alternation via turn folding.
 * - Extended thinking blocks with intact cryptographic signatures.
 * - Tool use blocks in assistant turns and tool result blocks in user turns.
 * - Atomic tool batch reconciliation preventing orphaned calls and HTTP 400 errors.
 */
export function toClaudePayload(messages: PalMessage[]): ClaudeTurnPayload {
  // Extract system prompt parts
  const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [];
  for (const msg of messages) {
    if (msg.role === PAL_ROLES.SYSTEM) {
      for (const block of msg.content) {
        if (isPalTextContent(block)) {
          systemBlocks.push({
            type: "text",
            text: block.text,
            ...(block.cacheControl ? { cache_control: block.cacheControl } : {}),
          });
        }
      }
    }
  }

  // Turn-fold conversational turns
  const nonSystemMessages = messages.filter((m) => m.role !== PAL_ROLES.SYSTEM);
  const normalized = normalizeTurns(nonSystemMessages);

  const claudeMessages: ClaudeTurnMessage[] = [];
  let pendingModelToolCalls: PalToolCallContent[] = [];

  for (const msg of normalized) {
    const isUser = msg.role === PAL_ROLES.USER;
    const claudeRole: "user" | "assistant" = isUser
      ? PROVIDER_ROLES.CLAUDE_USER
      : PROVIDER_ROLES.CLAUDE_ASSISTANT;
    const contentBlocks: ClaudeContentBlock[] = [];

    if (!isUser) {
      for (const block of msg.content) {
        switch (block.type) {
          case PAL_CONTENT_BLOCK_TYPES.TEXT: {
            contentBlocks.push({
              type: "text",
              text: block.text,
              ...(block.cacheControl ? { cache_control: block.cacheControl } : {}),
            });
            break;
          }
          case PAL_CONTENT_BLOCK_TYPES.THOUGHT: {
            if (block.redacted) {
              contentBlocks.push({
                type: "redacted_thinking",
                data: block.text,
              });
            } else {
              contentBlocks.push({
                type: "thinking",
                thinking: block.text,
                ...(block.signature !== undefined ? { signature: block.signature } : {}),
              });
            }
            break;
          }
          case PAL_CONTENT_BLOCK_TYPES.TOOL_CALL: {
            contentBlocks.push(normalizeToolCallToClaude(block));
            break;
          }
        }
      }

      pendingModelToolCalls = msg.content.filter(isPalToolCallContent);
    } else {
      const existingResults = msg.content.filter(isPalToolResultContent);
      const otherBlocks = msg.content.filter((b) => !isPalToolResultContent(b));

      let effectiveResults: PalToolResultContent[];
      if (pendingModelToolCalls.length > 0) {
        effectiveResults = reconcileToolBatch(pendingModelToolCalls, existingResults);
        pendingModelToolCalls = [];
      } else {
        effectiveResults = existingResults;
      }

      for (const res of effectiveResults) {
        contentBlocks.push(normalizeToolResultToClaude(res));
      }

      for (const block of otherBlocks) {
        switch (block.type) {
          case PAL_CONTENT_BLOCK_TYPES.TEXT: {
            contentBlocks.push({
              type: "text",
              text: block.text,
              ...(block.cacheControl ? { cache_control: block.cacheControl } : {}),
            });
            break;
          }
          case PAL_CONTENT_BLOCK_TYPES.IMAGE: {
            contentBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: block.mimeType,
                data: block.data,
              },
            });
            break;
          }
        }
      }
    }

    // Anthropic API forbids empty content array in turns
    if (contentBlocks.length === 0) {
      contentBlocks.push({
        type: "text",
        text: "",
      });
    }

    claudeMessages.push({
      role: claudeRole,
      content: contentBlocks,
    });
  }

  const payload: ClaudeTurnPayload = {
    messages: claudeMessages,
  };

  if (systemBlocks.length > 0) {
    payload.system = systemBlocks;
  }

  return payload;
}

/**
 * Parses an Anthropic Messages API response into a canonical PalMessage.
 */
export function fromClaudeResponse(response: unknown): PalMessage {
  if (!isRecord(response)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid Claude response payload: expected an object",
      false
    );
  }

  const rawMessage = isRecord(response.message) ? response.message : response;
  const id = typeof rawMessage.id === "string" ? rawMessage.id : randomUUID();
  const rawRole = typeof rawMessage.role === "string" ? rawMessage.role : PAL_ROLES.ASSISTANT;
  const role: PalRole = rawRole === "user" ? PAL_ROLES.USER : PAL_ROLES.ASSISTANT;

  const contentBlocks: PalContentBlock[] = [];

  if (typeof rawMessage.content === "string") {
    contentBlocks.push(createTextBlock(rawMessage.content));
  } else if (Array.isArray(rawMessage.content)) {
    for (const item of rawMessage.content) {
      if (!isRecord(item)) continue;
      const type = typeof item.type === "string" ? item.type : "";

      switch (type) {
        case "text": {
          const text = typeof item.text === "string" ? item.text : "";
          const cacheControl =
            isRecord(item.cache_control) && item.cache_control.type === "ephemeral"
              ? { type: "ephemeral" as const }
              : undefined;
          contentBlocks.push(createTextBlock(text, cacheControl));
          break;
        }
        case "thinking": {
          const thinking = typeof item.thinking === "string" ? item.thinking : "";
          const signature = typeof item.signature === "string" ? item.signature : undefined;
          contentBlocks.push(createThoughtBlock(thinking, { signature }));
          break;
        }
        case "redacted_thinking": {
          const data = typeof item.data === "string" ? item.data : "";
          contentBlocks.push(createThoughtBlock(data, { redacted: true }));
          break;
        }
        case "tool_use": {
          contentBlocks.push(normalizeToolCallFromClaude(item));
          break;
        }
        case "tool_result": {
          contentBlocks.push(normalizeToolResultFromClaude(item));
          break;
        }
        case "image": {
          const source = isRecord(item.source) ? item.source : {};
          const mediaType = isSupportedImageMimeType(source.media_type)
            ? (source.media_type as PalImageMimeType)
            : DEFAULT_IMAGE_MIME_TYPE;
          const data = typeof source.data === "string" ? source.data : "";
          contentBlocks.push(createImageBlock(mediaType, data));
          break;
        }
      }
    }
  }

  const metadata: Record<string, unknown> = {};
  if (rawMessage.model) metadata.model = rawMessage.model;
  if (rawMessage.stop_reason) metadata.stop_reason = rawMessage.stop_reason;
  if (rawMessage.usage) metadata.usage = rawMessage.usage;

  return createPalMessage({
    id,
    role,
    content: contentBlocks,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });
}

/**
 * Normalizes canonical PAL messages into a Google Gemini GenerateContent payload.
 *
 * Enforces:
 * - Top-level systemInstruction with text parts.
 * - Strict turn alternation (user <-> model).
 * - Function call and response mapping with Protobuf Struct wrapping.
 * - Strict FIFO ordering of functionResponse parts matching preceding model functionCall parts.
 * - Atomic tool batch reconciliation preventing orphaned function calls.
 * - Thought stripping to prevent token inflation on models that do not accept historical reasoning.
 */
export function toGeminiPayload(messages: PalMessage[]): GeminiTurnPayload {
  // 1. Extract system messages
  const systemParts: Array<{ text: string }> = [];
  for (const msg of messages) {
    if (msg.role === PAL_ROLES.SYSTEM) {
      for (const block of msg.content) {
        if (isPalTextContent(block)) {
          systemParts.push({ text: block.text });
        }
      }
    }
  }

  // 2. Turn-fold conversational turns
  const nonSystemMessages = messages.filter((m) => m.role !== PAL_ROLES.SYSTEM);
  const normalized = normalizeTurns(nonSystemMessages);

  const contents: GeminiTurnContent[] = [];
  let pendingModelToolCalls: PalToolCallContent[] = [];

  for (const msg of normalized) {
    const isUser = msg.role === PAL_ROLES.USER;
    const role: "user" | "model" = isUser
      ? PROVIDER_ROLES.GEMINI_USER
      : PROVIDER_ROLES.GEMINI_MODEL;
    const parts: GeminiPart[] = [];

    if (!isUser) {
      for (const block of msg.content) {
        switch (block.type) {
          case PAL_CONTENT_BLOCK_TYPES.TEXT: {
            parts.push({ text: block.text });
            break;
          }
          case PAL_CONTENT_BLOCK_TYPES.TOOL_CALL: {
            parts.push(normalizeToolCallToGemini(block));
            break;
          }
        }
      }
      pendingModelToolCalls = msg.content.filter(isPalToolCallContent);
    } else {
      const existingResults = msg.content.filter(isPalToolResultContent);
      const otherBlocks = msg.content.filter((b) => !isPalToolResultContent(b));

      let effectiveResults: PalToolResultContent[];
      if (pendingModelToolCalls.length > 0) {
        effectiveResults = reconcileToolBatch(pendingModelToolCalls, existingResults);
        pendingModelToolCalls = [];
      } else {
        effectiveResults = existingResults;
      }

      for (const res of effectiveResults) {
        parts.push(normalizeToolResultToGemini(res));
      }

      for (const block of otherBlocks) {
        switch (block.type) {
          case PAL_CONTENT_BLOCK_TYPES.TEXT: {
            parts.push({ text: block.text });
            break;
          }
          case PAL_CONTENT_BLOCK_TYPES.IMAGE: {
            parts.push({
              inlineData: {
                mimeType: block.mimeType,
                data: block.data,
              },
            });
            break;
          }
        }
      }
    }

    if (parts.length === 0) {
      parts.push({ text: "" });
    }

    contents.push({ role, parts });
  }

  const payload: GeminiTurnPayload = {
    contents,
  };

  if (systemParts.length > 0) {
    payload.systemInstruction = { parts: systemParts };
  }

  return payload;
}

/**
 * Parses a Google Gemini GenerateContent response into a canonical PalMessage.
 */
export function fromGeminiResponse(response: unknown): PalMessage {
  if (!isRecord(response)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid Gemini response payload: expected an object",
      false
    );
  }

  let contentObj: Record<string, unknown> | null = null;
  const metadata: Record<string, unknown> = {};

  const candidates = response.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const candidate = candidates[0];
    if (isRecord(candidate)) {
      if (isRecord(candidate.content)) {
        contentObj = candidate.content;
      }
      if (candidate.finishReason) {
        metadata.finishReason = candidate.finishReason;
      }
    }
  } else if (isRecord(response.content)) {
    contentObj = response.content;
  } else if (Array.isArray(response.parts)) {
    contentObj = { parts: response.parts, role: PROVIDER_ROLES.GEMINI_MODEL };
  }

  if (isRecord(response.usageMetadata)) {
    metadata.usageMetadata = response.usageMetadata;
  }

  const parts = contentObj && Array.isArray(contentObj.parts) ? contentObj.parts : [];
  const contentBlocks: PalContentBlock[] = [];

  for (const part of parts) {
    if (!isRecord(part)) continue;

    if (typeof part.thought === "string") {
      contentBlocks.push(createThoughtBlock(part.thought));
    } else if (part.thought === true && typeof part.text === "string") {
      contentBlocks.push(createThoughtBlock(part.text));
    } else if (typeof part.text === "string") {
      contentBlocks.push(createTextBlock(part.text));
    }

    if (isRecord(part.functionCall)) {
      contentBlocks.push(normalizeToolCallFromGemini(part));
    }

    if (isRecord(part.functionResponse)) {
      contentBlocks.push(normalizeToolResultFromGemini(part));
    }

    if (isRecord(part.inlineData)) {
      const mimeType = isSupportedImageMimeType(part.inlineData.mimeType)
        ? (part.inlineData.mimeType as PalImageMimeType)
        : DEFAULT_IMAGE_MIME_TYPE;
      const data = typeof part.inlineData.data === "string" ? part.inlineData.data : "";
      contentBlocks.push(createImageBlock(mimeType, data));
    }
  }

  return createPalMessage({
    id: randomUUID(),
    role: PAL_ROLES.ASSISTANT,
    content: contentBlocks,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });
}

/**
 * Normalizes canonical PAL messages into an OpenAI / OpenCode Chat Completion payload.
 *
 * Enforces:
 * - System messages placed in messages array with role: "system".
 * - Tool calls embedded in assistant messages with serialized JSON arguments.
 * - Tool results emitted as discrete messages with role: "tool" and tool_call_id.
 * - Atomic tool batch reconciliation ensuring every assistant tool call is paired.
 * - Multimodal user messages with data URL image formatting.
 */
export function toOpenAiPayload(messages: PalMessage[]): OpenAiTurnPayload {
  const openAiMessages: OpenAiTurnMessage[] = [];
  let pendingModelToolCalls: PalToolCallContent[] = [];

  for (const msg of messages) {
    if (msg.role === PAL_ROLES.SYSTEM) {
      const textParts: string[] = [];
      for (const block of msg.content) {
        if (isPalTextContent(block)) {
          textParts.push(block.text);
        }
      }
      openAiMessages.push({
        role: PROVIDER_ROLES.OPENAI_SYSTEM,
        content: textParts.join("\n"),
        ...(msg.name ? { name: msg.name } : {}),
      });
      continue;
    }

    if (msg.role === PAL_ROLES.TOOL) {
      const toolResults = msg.content.filter(isPalToolResultContent);
      let effectiveResults: PalToolResultContent[];
      if (pendingModelToolCalls.length > 0) {
        effectiveResults = reconcileToolBatch(pendingModelToolCalls, toolResults);
        pendingModelToolCalls = [];
      } else {
        effectiveResults = toolResults;
      }

      for (const res of effectiveResults) {
        openAiMessages.push(normalizeToolResultToOpenAi(res));
      }
      continue;
    }

    if (msg.role === PAL_ROLES.USER) {
      const toolResultBlocks = msg.content.filter(isPalToolResultContent);
      const userBlocks = msg.content.filter((b) => !isPalToolResultContent(b));

      let effectiveResults: PalToolResultContent[];
      if (pendingModelToolCalls.length > 0) {
        effectiveResults = reconcileToolBatch(pendingModelToolCalls, toolResultBlocks);
        pendingModelToolCalls = [];
      } else {
        effectiveResults = toolResultBlocks;
      }

      // Emit preceding tool result messages
      for (const tr of effectiveResults) {
        openAiMessages.push(normalizeToolResultToOpenAi(tr));
      }

      // Emit user message content
      if (userBlocks.length > 0) {
        const hasImages = userBlocks.some(isPalImageContent);
        if (hasImages) {
          const parts: Array<{
            type: "text" | "image_url";
            text?: string;
            image_url?: { url: string };
          }> = [];
          for (const b of userBlocks) {
            if (isPalTextContent(b)) {
              parts.push({ type: "text", text: b.text });
            } else if (isPalImageContent(b)) {
              parts.push({
                type: "image_url",
                image_url: { url: `data:${b.mimeType};base64,${b.data}` },
              });
            }
          }
          openAiMessages.push({
            role: PROVIDER_ROLES.OPENAI_USER,
            content: parts,
            ...(msg.name ? { name: msg.name } : {}),
          });
        } else {
          const text = userBlocks
            .filter(isPalTextContent)
            .map((b) => b.text)
            .join("\n");
          openAiMessages.push({
            role: PROVIDER_ROLES.OPENAI_USER,
            content: text,
            ...(msg.name ? { name: msg.name } : {}),
          });
        }
      }
      continue;
    }

    if (msg.role === PAL_ROLES.ASSISTANT) {
      const textParts: string[] = [];
      const toolCalls: OpenAiToolCall[] = [];
      const assistantCalls = msg.content.filter(isPalToolCallContent);

      for (const block of msg.content) {
        if (isPalTextContent(block)) {
          textParts.push(block.text);
        } else if (isPalToolCallContent(block)) {
          toolCalls.push(normalizeToolCallToOpenAi(block));
        }
      }

      pendingModelToolCalls = assistantCalls;

      const textContent = textParts.join("\n");
      const openAiMsg: OpenAiTurnMessage = {
        role: PROVIDER_ROLES.OPENAI_ASSISTANT,
        content: textContent.length > 0 ? textContent : toolCalls.length > 0 ? null : "",
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        ...(msg.name ? { name: msg.name } : {}),
      };

      openAiMessages.push(openAiMsg);
    }
  }

  return { messages: openAiMessages };
}

/**
 * Parses an OpenAI / OpenCode Chat Completion response into a canonical PalMessage.
 *
 * Supports:
 * - Discrete tool messages with role: "tool".
 * - Explicit `reasoning_content` delta field (DeepSeek / OpenCode / OpenAI o-series).
 * - `<think>...</think>` regex extraction from raw content strings.
 * - Standard tool call arrays with JSON argument auto-repair.
 * - ReAct fallback `<tool_call>...</tool_call>` extraction when models lack native function calling.
 */
export function fromOpenAiResponse(response: unknown): PalMessage {
  if (!isRecord(response)) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Invalid OpenAI response payload: expected an object",
      false
    );
  }

  let rawMessage: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};

  const choices = response.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    if (isRecord(choice)) {
      if (isRecord(choice.message)) {
        rawMessage = choice.message;
      }
      if (choice.finish_reason) {
        metadata.finish_reason = choice.finish_reason;
      }
    }
  } else if (isRecord(response.message)) {
    rawMessage = response.message;
  } else {
    rawMessage = response;
  }

  if (response.id && typeof response.id === "string") {
    metadata.id = response.id;
  }
  if (response.model) {
    metadata.model = response.model;
  }
  if (response.usage) {
    metadata.usage = response.usage;
  }

  const id = typeof response.id === "string" ? response.id : randomUUID();
  const rawRole = typeof rawMessage.role === "string" ? rawMessage.role : PAL_ROLES.ASSISTANT;

  // Handle incoming tool message directly
  if (rawRole === PAL_ROLES.TOOL) {
    return createPalMessage({
      id,
      role: PAL_ROLES.TOOL,
      content: [normalizeToolResultFromOpenAi(rawMessage)],
      name: typeof rawMessage.name === "string" ? rawMessage.name : undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  }

  const role: PalRole = rawRole === "user" ? PAL_ROLES.USER : PAL_ROLES.ASSISTANT;
  const contentBlocks: PalContentBlock[] = [];

  // 1. Check reasoning_content (DeepSeek / OpenCode / OpenAI o-series)
  if (
    typeof rawMessage.reasoning_content === "string" &&
    rawMessage.reasoning_content.length > 0
  ) {
    contentBlocks.push(createThoughtBlock(rawMessage.reasoning_content));
  }

  // 2. Check native tool_calls
  if (Array.isArray(rawMessage.tool_calls) && rawMessage.tool_calls.length > 0) {
    for (const call of rawMessage.tool_calls) {
      if (!isRecord(call)) continue;
      contentBlocks.push(normalizeToolCallFromOpenAi(call));
    }
  }

  // 3. Check content (handle <think>...</think> and ReAct <tool_call>...</tool_call> fallback)
  if (typeof rawMessage.content === "string") {
    const rawContent = rawMessage.content;
    const thinkRegex = /^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/;
    const thinkMatch = rawContent.match(thinkRegex);

    let textToProcess = rawContent;
    if (thinkMatch) {
      const thinkText = (thinkMatch[1] ?? "").trim();
      const afterText = (thinkMatch[2] ?? "").trim();
      if (
        thinkText.length > 0 &&
        !contentBlocks.some((b) => b.type === PAL_CONTENT_BLOCK_TYPES.THOUGHT)
      ) {
        contentBlocks.push(createThoughtBlock(thinkText));
      }
      textToProcess = afterText;
    }

    const hasNativeToolCalls = contentBlocks.some(isPalToolCallContent);
    if (!hasNativeToolCalls && textToProcess.includes("<tool_call")) {
      const { toolCalls: extractedCalls, cleanText } = extractReActToolCalls(textToProcess);
      for (const tc of extractedCalls) {
        contentBlocks.push(tc);
      }
      if (cleanText.length > 0) {
        contentBlocks.push(createTextBlock(cleanText));
      }
    } else if (textToProcess.length > 0) {
      contentBlocks.push(createTextBlock(textToProcess));
    }
  } else if (Array.isArray(rawMessage.content)) {
    for (const item of rawMessage.content) {
      if (!isRecord(item)) continue;
      if (item.type === "text" && typeof item.text === "string") {
        contentBlocks.push(createTextBlock(item.text));
      }
    }
  }

  return createPalMessage({
    id,
    role,
    content: contentBlocks,
    name: typeof rawMessage.name === "string" ? rawMessage.name : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });
}

/**
 * Standard implementation of the PalTurnNormalizer interface.
 */
export class PalNormalizer implements PalTurnNormalizer {
  toClaude(messages: PalMessage[]): ClaudeTurnPayload {
    return toClaudePayload(messages);
  }

  fromClaude(response: unknown): PalMessage {
    return fromClaudeResponse(response);
  }

  toGemini(messages: PalMessage[]): GeminiTurnPayload {
    return toGeminiPayload(messages);
  }

  fromGemini(response: unknown): PalMessage {
    return fromGeminiResponse(response);
  }

  toOpenAi(messages: PalMessage[]): OpenAiTurnPayload {
    return toOpenAiPayload(messages);
  }

  fromOpenAi(response: unknown): PalMessage {
    return fromOpenAiResponse(response);
  }

  reconcileToolBatch(
    modelToolCalls: PalToolCallContent[],
    userToolResults: PalToolResultContent[]
  ): PalToolResultContent[] {
    return reconcileToolBatch(modelToolCalls, userToolResults);
  }

  repairJsonArguments(raw: string): Record<string, unknown> {
    return repairJsonArguments(raw);
  }

  extractReActToolCalls(text: string): ExtractedReActCalls {
    return extractReActToolCalls(text);
  }
}

/**
 * Singleton instance of the PalNormalizer.
 */
export const palNormalizer: PalTurnNormalizer = new PalNormalizer();
