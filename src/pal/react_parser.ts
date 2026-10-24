import { randomUUID } from "node:crypto";
import {
  type PalContentBlock,
  type PalToolCallContent,
  type PalToolDefinition,
  createToolCallBlock,
  isPalToolCallContent,
} from "./types";

/**
 * Centralized constants for ReAct text fallback parser and JSON auto-repair.
 * Follows zero-magic-numbers architecture rule.
 */
export const REACT_PARSER_CONSTANTS = {
  ZERO: 0,
  SINGLE_CHAR_OFFSET: 1,
  NOT_FOUND_INDEX: -1,
  EMPTY_STRING: "",
  FALLBACK_TOOL_NAME: "unknown_tool",
  DEFAULT_RECONTINUATION_PROMPT:
    "[SYSTEM] Your previous JSON tool call was truncated by token limits. Output ONLY the remainder of the JSON starting from the truncation point, ending with </tool_call>.",
  MAX_SCAN_LOOKAHEAD: 100,
  JSON_INDENT_SPACES: 2,
} as const;

/**
 * Permissive regex matching <tool_call>...</tool_call> tags.
 */
export const TOOL_CALL_TAG_REGEX =
  /<tool_call[\s\S]*?>([\s\S]*?)<\/tool_call>/gi;

/**
 * Standard alias for backward compatibility.
 */
export const TOOL_CALL_REGEX = TOOL_CALL_TAG_REGEX;

/**
 * Regex matching unclosed <tool_call> tags at the end of text (stream truncation).
 */
export const UNCLOSED_TOOL_CALL_TAG_REGEX =
  /<tool_call[\s\S]*?>([\s\S]*?)$/i;

/**
 * Regex matching markdown code blocks that may contain JSON tool calls.
 */
export const MARKDOWN_TOOL_BLOCK_REGEX =
  /```(?:json|tool_call|tool)?\s*\n?([\s\S]*?)\n?```/gi;

/**
 * Regex matching classic ReAct Action / Action Input patterns.
 */
export const REACT_ACTION_REGEX =
  /(?:Action|Tool):\s*([a-zA-Z0-9_\-./]+)\s*\n+(?:Action Input|Parameters|Args|Arguments):\s*([\s\S]*?)(?=(?:\n\s*(?:Action|Tool):|\n\s*Observation:|$))/gi;

/**
 * Safe type guard checking if an unknown value is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Result returned by ReAct tool call extraction.
 */
export interface ExtractedReActCalls {
  toolCalls: PalToolCallContent[];
  cleanText: string;
  isTruncated?: boolean;
  unclosedFragment?: string;
}

/**
 * Detection details for truncated stream buffers.
 */
export interface TruncatedStreamDetection {
  isTruncated: boolean;
  partialTag?: string;
  tagContent?: string;
}

/**
 * Normalizes unescaped control characters and internal double quotes within string values.
 *
 * Local models generating code (e.g. `write_to_file`) frequently produce:
 * - Nested double quotes: `{"content": "console.log("hello world");"}`
 * - Raw literal newlines inside strings: `{"code": "line 1\nline 2"}`
 */
export function normalizeUnescapedStringValues(jsonStr: string): string {
  if (!jsonStr || typeof jsonStr !== "string") {
    return REACT_PARSER_CONSTANTS.EMPTY_STRING;
  }

  let result = "";
  let i = REACT_PARSER_CONSTANTS.ZERO;
  const n = jsonStr.length;

  let inString = false;
  let isKey = false;
  let afterColon = false;
  let isEscaped = false;

  while (i < n) {
    const char = jsonStr[i];
    if (char === undefined) {
      break;
    }

    if (isEscaped) {
      result += char;
      isEscaped = false;
      i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
      continue;
    }

    if (char === "\\") {
      result += char;
      isEscaped = true;
      i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        // Entering a string literal
        inString = true;
        isKey = !afterColon;
        result += char;
        i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
      } else {
        // Inside string literal: determine if closing quote or unescaped internal quote
        if (isKey) {
          const remainder = jsonStr.slice(i + REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET);
          if (/^\s*:/.test(remainder)) {
            inString = false;
            isKey = false;
            result += char;
            i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
          } else {
            result += '\\"';
            i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
          }
        } else {
          const remainder = jsonStr.slice(i + REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET);
          let isTrueClose = false;

          if (
            /^\s*[}\]]/.test(remainder) ||
            remainder.trim().length === REACT_PARSER_CONSTANTS.ZERO
          ) {
            isTrueClose = true;
          } else if (/^\s*,\s*"[^"]*"\s*:/.test(remainder)) {
            // Next is an object property: "key":
            isTrueClose = true;
          } else if (/^\s*,\s*[}\]]/.test(remainder)) {
            // Trailing comma before closing brace or bracket
            isTrueClose = true;
          }

          if (isTrueClose) {
            inString = false;
            afterColon = false;
            result += char;
            i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
          } else {
            // Unescaped internal double quote in string value
            result += '\\"';
            i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
          }
        }
      }
      continue;
    }

    if (inString) {
      if (char === "\n") {
        result += "\\n";
        i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
        continue;
      }
      if (char === "\r") {
        result += "\\r";
        i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
        continue;
      }
      if (char === "\t") {
        result += "\\t";
        i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
        continue;
      }
      result += char;
      i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
      continue;
    }

    if (char === ":") {
      afterColon = true;
    } else if (char === "{" || char === "[" || char === ",") {
      afterColon = false;
    }

    result += char;
    i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET;
  }

  return result;
}

/**
 * Repairs truncated JSON payloads by closing open string quotes, object braces, and array brackets.
 */
export function repairTruncatedJson(raw: string): string {
  if (!raw || typeof raw !== "string") {
    return "{}";
  }

  let cleaned = raw.trim();
  if (cleaned.length === REACT_PARSER_CONSTANTS.ZERO) {
    return "{}";
  }

  // Strip leading code fence if present
  cleaned = cleaned.replace(/^```(?:json|tool_call|tool)?\s*/i, "");
  // Strip trailing unclosed fence or partial fence
  cleaned = cleaned.replace(/\s*```$/, "");

  let inString = false;
  let isEscaped = false;
  const stack: string[] = [];
  let lastNonWhitespaceChar = "";
  let afterColonInObject = false;

  for (let i = REACT_PARSER_CONSTANTS.ZERO; i < cleaned.length; i += REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET) {
    const char = cleaned[i];
    if (char === undefined) {
      break;
    }

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      lastNonWhitespaceChar = '"';
      continue;
    }

    if (!inString) {
      if (!/\s/.test(char)) {
        lastNonWhitespaceChar = char;
      }
      if (char === "{") {
        stack.push("}");
        afterColonInObject = false;
      } else if (char === "[") {
        stack.push("]");
        afterColonInObject = false;
      } else if (char === ":") {
        afterColonInObject = true;
      } else if (char === ",") {
        afterColonInObject = false;
      } else if (char === "}" || char === "]") {
        if (
          stack.length > REACT_PARSER_CONSTANTS.ZERO &&
          stack[stack.length - REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET] === char
        ) {
          stack.pop();
        }
        afterColonInObject = false;
      }
    }
  }

  let repaired = cleaned;
  if (inString) {
    if (repaired.endsWith("\\")) {
      repaired = repaired.slice(
        REACT_PARSER_CONSTANTS.ZERO,
        repaired.length - REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET
      );
    }
    repaired += '"';
    lastNonWhitespaceChar = '"';
  }

  // Remove any trailing commas
  repaired = repaired.replace(/,\s*$/, "");

  // If ending in a dangling colon e.g. "key":
  if (/:\s*$/.test(repaired)) {
    repaired += " null";
  } else if (
    stack.length > REACT_PARSER_CONSTANTS.ZERO &&
    stack[stack.length - REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET] === "}" &&
    !afterColonInObject &&
    lastNonWhitespaceChar === '"'
  ) {
    // In an object, closed a key string, but no colon was emitted yet
    repaired += ": null";
  }

  while (stack.length > REACT_PARSER_CONSTANTS.ZERO) {
    const closingChar = stack.pop();
    if (closingChar) {
      repaired += closingChar;
    }
  }

  return repaired;
}

/**
 * Repairs commonly observed LLM malformed JSON argument payloads.
 *
 * Resolves:
 * - Markdown code fences (```json ... ``` or ``` ... ```)
 * - Trailing commas in objects and arrays
 * - Unescaped nested quotes within string values
 * - Raw literal newlines/control characters
 * - Single-quoted keys and string literals
 * - Unquoted object keys
 * - Python literals (True, False, None)
 * - Truncated JSON structures
 * - Surrounding conversational commentary
 */
export function repairJsonArguments(raw: string): Record<string, unknown> {
  if (!raw || typeof raw !== "string") {
    return {};
  }

  const trimmed = raw.trim();
  if (trimmed.length === REACT_PARSER_CONSTANTS.ZERO) {
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
  const fenceRegex = /^```(?:json|tool_call|tool)?\s*\n?([\s\S]*?)\n?```$/i;
  const fenceMatch = cleaned.match(fenceRegex);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned
      .replace(/^```[a-zA-Z0-9_\-]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

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

  // 4. Handle Python / JS constants: True -> true, False -> false, None -> null
  cleaned = cleaned
    .replace(/:\s*True\b/g, ": true")
    .replace(/:\s*False\b/g, ": false")
    .replace(/:\s*None\b/g, ": null")
    .replace(/:\s*undefined\b/g, ": null");

  try {
    const parsed = JSON.parse(cleaned);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Continue
  }

  // 5. Handle single quotes for keys/strings: {'key': 'val'} -> {"key": "val"}
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

  // 6. Handle unquoted keys: {key: "val"} -> {"key": "val"}
  try {
    const unquotedKeysNormalized = cleaned.replace(
      /([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g,
      '$1"$2":'
    );
    const parsed = JSON.parse(unquotedKeysNormalized);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Continue
  }

  // 7. Normalize unescaped quotes & control characters in string values
  try {
    const unescapedNormalized = normalizeUnescapedStringValues(cleaned);
    const parsed = JSON.parse(unescapedNormalized);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Continue
  }

  // 8. Attempt truncated JSON repair
  try {
    const repairedTruncated = repairTruncatedJson(cleaned);
    const normalizedTruncated = normalizeUnescapedStringValues(repairedTruncated);
    const parsed = JSON.parse(normalizedTruncated);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Continue
  }

  // 9. Extract JSON object substring between first '{' and last '}'
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (
    firstBrace !== REACT_PARSER_CONSTANTS.NOT_FOUND_INDEX &&
    lastBrace !== REACT_PARSER_CONSTANTS.NOT_FOUND_INDEX &&
    lastBrace > firstBrace
  ) {
    const bracketed = cleaned.substring(
      firstBrace,
      lastBrace + REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET
    );

    try {
      const parsed = JSON.parse(bracketed);
      if (isRecord(parsed)) return parsed;
    } catch {
      try {
        const noTrailing = bracketed.replace(/,\s*([}\]])/g, "$1");
        const normalized = normalizeUnescapedStringValues(noTrailing);
        const parsed = JSON.parse(normalized);
        if (isRecord(parsed)) return parsed;
      } catch {
        try {
          const repaired = repairTruncatedJson(bracketed);
          const parsed = JSON.parse(repaired);
          if (isRecord(parsed)) return parsed;
        } catch {
          // Fallback
        }
      }
    }
  }

  return {};
}

/**
 * Helper to inspect parsed JSON object and construct a canonical PalToolCallContent block.
 */
function createToolCallFromRecord(
  parsed: Record<string, unknown>,
  rawPayload: string
): PalToolCallContent | null {
  const name =
    typeof parsed.name === "string" && parsed.name.trim().length > REACT_PARSER_CONSTANTS.ZERO
      ? parsed.name.trim()
      : typeof parsed.tool === "string" && parsed.tool.trim().length > REACT_PARSER_CONSTANTS.ZERO
        ? parsed.tool.trim()
        : typeof parsed.call === "string" && parsed.call.trim().length > REACT_PARSER_CONSTANTS.ZERO
          ? parsed.call.trim()
          : typeof parsed.function === "string" && parsed.function.trim().length > REACT_PARSER_CONSTANTS.ZERO
            ? parsed.function.trim()
            : typeof parsed.action === "string" && parsed.action.trim().length > REACT_PARSER_CONSTANTS.ZERO
              ? parsed.action.trim()
              : "";

  if (!name) {
    return null;
  }

  let args: Record<string, unknown> = {};
  if (isRecord(parsed.arguments)) {
    args = parsed.arguments;
  } else if (isRecord(parsed.parameters)) {
    args = parsed.parameters;
  } else if (isRecord(parsed.args)) {
    args = parsed.args;
  } else if (isRecord(parsed.input)) {
    args = parsed.input;
  } else if (isRecord(parsed.action_input)) {
    args = parsed.action_input;
  } else if (typeof parsed.action_input === "string") {
    const repairedInput = repairJsonArguments(parsed.action_input);
    args =
      Object.keys(repairedInput).length > REACT_PARSER_CONSTANTS.ZERO
        ? repairedInput
        : { input: parsed.action_input };
  } else {
    const {
      name: _n,
      tool: _t,
      call: _c,
      function: _f,
      action: _a,
      ...rest
    } = parsed;
    args = rest;
  }

  const callId =
    typeof parsed.id === "string" && parsed.id.trim().length > REACT_PARSER_CONSTANTS.ZERO
      ? parsed.id.trim()
      : randomUUID();

  return createToolCallBlock(callId, name, args, rawPayload);
}

/**
 * Checks whether an object record represents a tool call structure.
 */
function isToolCallStructure(record: Record<string, unknown>): boolean {
  if (typeof record.name === "string" && record.name.length > REACT_PARSER_CONSTANTS.ZERO) {
    return (
      record.arguments !== undefined ||
      record.parameters !== undefined ||
      record.args !== undefined ||
      record.input !== undefined ||
      record.type === "function" ||
      record.call_id !== undefined ||
      record.id !== undefined
    );
  }

  return (
    typeof record.tool === "string" ||
    typeof record.call === "string" ||
    typeof record.function === "string" ||
    typeof record.action === "string"
  );
}

/**
 * Parses ReAct-style tool calls from conversational text.
 *
 * Supports:
 * - `<tool_call>...</tool_call>` tags
 * - Unclosed `<tool_call>...` tags resulting from stream truncation
 * - Raw markdown code blocks for tool calls (```json ... ```, ```tool_call ... ```)
 * - Classic ReAct patterns (`Action: ...\nAction Input: ...`)
 * - Direct JSON tool call payloads
 */
export function extractReActToolCalls(text: string): ExtractedReActCalls {
  if (!text || typeof text !== "string") {
    return {
      toolCalls: [],
      cleanText: REACT_PARSER_CONSTANTS.EMPTY_STRING,
      isTruncated: false,
    };
  }

  const toolCalls: PalToolCallContent[] = [];
  let workingText = text;
  let isTruncated = false;
  let unclosedFragment: string | undefined;

  // 1. Extract closed <tool_call>...</tool_call> tags
  const closedTagRegex = new RegExp(TOOL_CALL_TAG_REGEX.source, TOOL_CALL_TAG_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = closedTagRegex.exec(text)) !== null) {
    const rawPayload = (match[1] ?? REACT_PARSER_CONSTANTS.EMPTY_STRING).trim();
    if (rawPayload.length === REACT_PARSER_CONSTANTS.ZERO) continue;

    const parsed = repairJsonArguments(rawPayload);
    const call = createToolCallFromRecord(parsed, rawPayload);
    if (call) {
      toolCalls.push(call);
    }
  }

  if (toolCalls.length > REACT_PARSER_CONSTANTS.ZERO) {
    workingText = workingText.replace(closedTagRegex, REACT_PARSER_CONSTANTS.EMPTY_STRING);
  }

  // 2. Check for unclosed <tool_call> tag at the end (stream truncation)
  const unclosedMatch = workingText.match(UNCLOSED_TOOL_CALL_TAG_REGEX);
  if (unclosedMatch && unclosedMatch[1] !== undefined) {
    const unclosedPayload = unclosedMatch[1].trim();
    isTruncated = true;
    unclosedFragment = unclosedPayload;

    if (unclosedPayload.length > REACT_PARSER_CONSTANTS.ZERO) {
      const repairedPayload = repairTruncatedJson(unclosedPayload);
      const parsed = repairJsonArguments(repairedPayload);
      const call = createToolCallFromRecord(parsed, unclosedPayload);
      if (call) {
        toolCalls.push(call);
      }
    }
    workingText = workingText.replace(UNCLOSED_TOOL_CALL_TAG_REGEX, REACT_PARSER_CONSTANTS.EMPTY_STRING);
  }

  // 3. Extract tool calls from markdown code blocks if no <tool_call> tags were found
  if (toolCalls.length === REACT_PARSER_CONSTANTS.ZERO) {
    const markdownRegex = new RegExp(
      MARKDOWN_TOOL_BLOCK_REGEX.source,
      MARKDOWN_TOOL_BLOCK_REGEX.flags
    );
    let mdMatch: RegExpExecArray | null;
    const matchedFences: string[] = [];

    while ((mdMatch = markdownRegex.exec(workingText)) !== null) {
      const rawPayload = (mdMatch[1] ?? REACT_PARSER_CONSTANTS.EMPTY_STRING).trim();
      if (rawPayload.length === REACT_PARSER_CONSTANTS.ZERO) continue;

      const parsed = repairJsonArguments(rawPayload);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isRecord(item) && isToolCallStructure(item)) {
            const call = createToolCallFromRecord(item, rawPayload);
            if (call) {
              toolCalls.push(call);
            }
          }
        }
        if (toolCalls.length > REACT_PARSER_CONSTANTS.ZERO && mdMatch[0]) {
          matchedFences.push(mdMatch[0]);
        }
      } else if (isRecord(parsed) && isToolCallStructure(parsed)) {
        const call = createToolCallFromRecord(parsed, rawPayload);
        if (call) {
          toolCalls.push(call);
          if (mdMatch[0]) {
            matchedFences.push(mdMatch[0]);
          }
        }
      }
    }

    for (const fence of matchedFences) {
      workingText = workingText.replace(fence, REACT_PARSER_CONSTANTS.EMPTY_STRING);
    }
  }

  // 4. Extract classic ReAct Action / Action Input patterns
  if (toolCalls.length === REACT_PARSER_CONSTANTS.ZERO) {
    const reactRegex = new RegExp(REACT_ACTION_REGEX.source, REACT_ACTION_REGEX.flags);
    let reactMatch: RegExpExecArray | null;
    const matchedActions: string[] = [];

    while ((reactMatch = reactRegex.exec(workingText)) !== null) {
      const actionName = (reactMatch[1] ?? REACT_PARSER_CONSTANTS.EMPTY_STRING).trim();
      const rawActionInput = (reactMatch[2] ?? REACT_PARSER_CONSTANTS.EMPTY_STRING).trim();

      if (actionName.length > REACT_PARSER_CONSTANTS.ZERO) {
        let args: Record<string, unknown> = {};
        if (rawActionInput.length > REACT_PARSER_CONSTANTS.ZERO) {
          const repaired = repairJsonArguments(rawActionInput);
          if (Object.keys(repaired).length > REACT_PARSER_CONSTANTS.ZERO) {
            args = repaired;
          } else {
            args = { input: rawActionInput };
          }
        }

        toolCalls.push(
          createToolCallBlock(randomUUID(), actionName, args, rawActionInput)
        );
        if (reactMatch[0]) {
          matchedActions.push(reactMatch[0]);
        }
      }
    }

    for (const actionBlock of matchedActions) {
      workingText = workingText.replace(actionBlock, REACT_PARSER_CONSTANTS.EMPTY_STRING);
    }
  }

  // 5. Direct JSON check if whole text is a JSON tool call
  if (toolCalls.length === REACT_PARSER_CONSTANTS.ZERO) {
    const trimmed = workingText.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = repairJsonArguments(trimmed);
      if (isRecord(parsed) && isToolCallStructure(parsed)) {
        const call = createToolCallFromRecord(parsed, trimmed);
        if (call) {
          toolCalls.push(call);
          workingText = REACT_PARSER_CONSTANTS.EMPTY_STRING;
        }
      }
    }
  }

  const cleanText = workingText.trim();
  return {
    toolCalls,
    cleanText,
    isTruncated,
    unclosedFragment,
  };
}

/**
 * Detects if a streaming buffer ends with an unclosed <tool_call> tag.
 */
export function detectTruncatedReActTag(buffer: string): TruncatedStreamDetection {
  if (!buffer || typeof buffer !== "string") {
    return { isTruncated: false };
  }

  const lastOpen = buffer.lastIndexOf("<tool_call");
  if (lastOpen === REACT_PARSER_CONSTANTS.NOT_FOUND_INDEX) {
    return { isTruncated: false };
  }

  const lastClose = buffer.lastIndexOf("</tool_call>");
  if (lastClose !== REACT_PARSER_CONSTANTS.NOT_FOUND_INDEX && lastClose > lastOpen) {
    return { isTruncated: false };
  }

  const tagCloseAngle = buffer.indexOf(">", lastOpen);
  if (tagCloseAngle === REACT_PARSER_CONSTANTS.NOT_FOUND_INDEX) {
    return {
      isTruncated: true,
      partialTag: buffer.slice(lastOpen),
      tagContent: REACT_PARSER_CONSTANTS.EMPTY_STRING,
    };
  }

  return {
    isTruncated: true,
    partialTag: buffer.slice(
      lastOpen,
      tagCloseAngle + REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET
    ),
    tagContent: buffer.slice(
      tagCloseAngle + REACT_PARSER_CONSTANTS.SINGLE_CHAR_OFFSET
    ),
  };
}

/**
 * Checks whether text terminates with an unclosed <tool_call> tag.
 */
export function isReActStreamTruncated(text: string): boolean {
  return detectTruncatedReActTag(text).isTruncated;
}

/**
 * Stitches a truncated first fragment with a continuation response from the model.
 */
export function stitchTruncatedToolCall(
  firstFragment: string,
  continuation: string
): string {
  const cleanFirst = firstFragment ?? REACT_PARSER_CONSTANTS.EMPTY_STRING;
  const cleanContinuation = (continuation ?? REACT_PARSER_CONSTANTS.EMPTY_STRING).trim();

  // If first fragment has unclosed <tool_call>, join them
  return `${cleanFirst}${cleanContinuation}`;
}

/**
 * Standard ReContinuation prompt for models when JSON stream truncates mid-tag.
 */
export const RECONTINUATION_PROMPT =
  REACT_PARSER_CONSTANTS.DEFAULT_RECONTINUATION_PROMPT;

/**
 * Formats tool definitions into a system prompt for models lacking native tool use.
 */
export function formatReActToolInstructions(tools: PalToolDefinition[]): string {
  if (!tools || tools.length === REACT_PARSER_CONSTANTS.ZERO) {
    return REACT_PARSER_CONSTANTS.EMPTY_STRING;
  }

  const toolDescriptions = tools
    .map((tool) => {
      const params = tool.parameters
        ? JSON.stringify(
            tool.parameters,
            null,
            REACT_PARSER_CONSTANTS.JSON_INDENT_SPACES
          )
        : "{}";
      return `### Tool: \`${tool.name}\`\n${tool.description}\nParameters JSON Schema:\n\`\`\`json\n${params}\n\`\`\``;
    })
    .join("\n\n");

  return [
    "# Available Tools",
    "You have access to the following tools:",
    "",
    toolDescriptions,
    "",
    "## Tool Calling Format",
    "To invoke a tool, output a `<tool_call>` tag containing a valid JSON object with `name` and `arguments`:",
    "",
    "<tool_call>",
    JSON.stringify(
      {
        name: "tool_name",
        arguments: { param1: "value" },
      },
      null,
      REACT_PARSER_CONSTANTS.JSON_INDENT_SPACES
    ),
    "</tool_call>",
    "",
    "Alternatively, you may emit a raw markdown code block with the tool call:",
    "```json",
    JSON.stringify(
      {
        name: "tool_name",
        arguments: { param1: "value" },
      },
      null,
      REACT_PARSER_CONSTANTS.JSON_INDENT_SPACES
    ),
    "```",
  ].join("\n");
}
