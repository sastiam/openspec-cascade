import { describe, expect, it } from "bun:test";
import {
  DEFAULT_IMAGE_MIME_TYPE,
  PROVIDER_ROLES,
  SYNTHETIC_TOOL_ERROR_MESSAGE,
  SYNTHETIC_USER_PROMPT,
  TOOL_CALL_REGEX,
  extractReActToolCalls,
  formatGeminiResponse,
  fromClaudeResponse,
  fromGeminiResponse,
  fromOpenAiResponse,
  normalizeToolCallFromClaude,
  normalizeToolCallFromGemini,
  normalizeToolCallFromOpenAi,
  normalizeToolCallToClaude,
  normalizeToolCallToGemini,
  normalizeToolCallToOpenAi,
  normalizeToolResultFromClaude,
  normalizeToolResultFromGemini,
  normalizeToolResultFromOpenAi,
  normalizeToolResultToClaude,
  normalizeToolResultToGemini,
  normalizeToolResultToOpenAi,
  normalizeTurns,
  palNormalizer,
  PalNormalizer,
  reconcileToolBatch,
  repairJsonArguments,
  toClaudePayload,
  toGeminiPayload,
  toOpenAiPayload,
} from "../../src/pal/normalizer";
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
  type ClaudeToolResultBlock,
  type ClaudeToolUseBlock,
  type GeminiFunctionCallPart,
  type GeminiFunctionResponsePart,
  type OpenAiToolCall,
  type OpenAiTurnMessage,
  type PalMessage,
  type PalToolCallContent,
  type PalToolResultContent,
} from "../../src/pal/types";

describe("PAL Bi-directional Message Normalizer", () => {
  describe("Module Constants", () => {
    it("exports standard synthetic constants avoiding magic strings", () => {
      expect(SYNTHETIC_USER_PROMPT).toBe("Begin session");
      expect(SYNTHETIC_TOOL_ERROR_MESSAGE).toContain("Error: Tool execution aborted");
      expect(TOOL_CALL_REGEX).toBeInstanceOf(RegExp);
      expect(DEFAULT_IMAGE_MIME_TYPE).toBe(PAL_IMAGE_MIME_TYPES.PNG);
    });

    it("exports provider role constants", () => {
      expect(PROVIDER_ROLES.CLAUDE_USER).toBe("user");
      expect(PROVIDER_ROLES.CLAUDE_ASSISTANT).toBe("assistant");
      expect(PROVIDER_ROLES.GEMINI_USER).toBe("user");
      expect(PROVIDER_ROLES.GEMINI_MODEL).toBe("model");
      expect(PROVIDER_ROLES.OPENAI_SYSTEM).toBe("system");
      expect(PROVIDER_ROLES.OPENAI_USER).toBe("user");
      expect(PROVIDER_ROLES.OPENAI_ASSISTANT).toBe("assistant");
      expect(PROVIDER_ROLES.OPENAI_TOOL).toBe("tool");
    });
  });

  describe("JSON Argument Repair (repairJsonArguments)", () => {
    it("returns empty object for empty or non-string input", () => {
      expect(repairJsonArguments("")).toEqual({});
      expect(repairJsonArguments("   ")).toEqual({});
    });

    it("parses valid JSON directly", () => {
      const input = '{"command": "git status", "timeout": 5000}';
      expect(repairJsonArguments(input)).toEqual({
        command: "git status",
        timeout: 5000,
      });
    });

    it("strips markdown code fences (```json ... ```)", () => {
      const fenced = "```json\n{\n  \"action\": \"build\",\n  \"dryRun\": true\n}\n```";
      expect(repairJsonArguments(fenced)).toEqual({
        action: "build",
        dryRun: true,
      });
    });

    it("strips generic markdown code fences without language tag", () => {
      const fenced = "```\n{\n  \"target\": \"dist\"\n}\n```";
      expect(repairJsonArguments(fenced)).toEqual({
        target: "dist",
      });
    });

    it("removes trailing commas before closing braces and brackets", () => {
      const withTrailingCommas = '{"items": ["a", "b", ], "config": {"debug": true, }, }';
      expect(repairJsonArguments(withTrailingCommas)).toEqual({
        items: ["a", "b"],
        config: { debug: true },
      });
    });

    it("normalizes single-quoted keys and string values", () => {
      const singleQuoted = "{'name': 'search', 'query': 'pal architecture'}";
      expect(repairJsonArguments(singleQuoted)).toEqual({
        name: "search",
        query: "pal architecture",
      });
    });

    it("extracts JSON substring between first { and last } with surrounding text", () => {
      const noisyText = 'Here is the parameters payload: {"file": "src/index.ts", "line": 42} Hope this helps!';
      expect(repairJsonArguments(noisyText)).toEqual({
        file: "src/index.ts",
        line: 42,
      });
    });

    it("wraps primitive valid JSON in value property", () => {
      expect(repairJsonArguments("12345")).toEqual({ value: 12345 });
      expect(repairJsonArguments('"simple string"')).toEqual({ value: "simple string" });
      expect(repairJsonArguments("true")).toEqual({ value: true });
    });

    it("returns empty object when completely unparseable", () => {
      expect(repairJsonArguments("not json at all { unclosed")).toEqual({});
    });
  });

  describe("ReAct Tool Call Parsing (extractReActToolCalls)", () => {
    it("returns empty calls and empty text for empty input", () => {
      const result = extractReActToolCalls("");
      expect(result.toolCalls).toEqual([]);
      expect(result.cleanText).toBe("");
    });

    it("extracts single <tool_call> and cleans the surrounding text", () => {
      const text = "Let me check the files.\n<tool_call>\n{\"name\": \"readFile\", \"arguments\": {\"path\": \"README.md\"}}\n</tool_call>\nI will read it now.";
      const { toolCalls, cleanText } = extractReActToolCalls(text);

      expect(toolCalls.length).toBe(1);
      const call = toolCalls[0];
      expect(call).toBeDefined();
      if (!call) return;
      expect(call.type).toBe("tool_call");
      expect(call.name).toBe("readFile");
      expect(call.arguments).toEqual({ path: "README.md" });
      expect(cleanText).toBe("Let me check the files.\n\nI will read it now.");
    });

    it("extracts multiple <tool_call> tags and supports alternative schema keys", () => {
      const text = [
        "<tool_call>{\"tool\": \"bash\", \"parameters\": {\"cmd\": \"ls\"}}</tool_call>",
        "<tool_call>{\"call\": \"grep\", \"args\": {\"pattern\": \"TODO\"}}</tool_call>",
        "<tool_call>{\"name\": \"notify\", \"message\": \"done\"}</tool_call>",
      ].join("\n");

      const { toolCalls } = extractReActToolCalls(text);
      expect(toolCalls.length).toBe(3);

      expect(toolCalls[0]?.name).toBe("bash");
      expect(toolCalls[0]?.arguments).toEqual({ cmd: "ls" });

      expect(toolCalls[1]?.name).toBe("grep");
      expect(toolCalls[1]?.arguments).toEqual({ pattern: "TODO" });

      expect(toolCalls[2]?.name).toBe("notify");
      expect(toolCalls[2]?.arguments).toEqual({ message: "done" });
    });
  });

  describe("Individual Tool Call & Result Block Normalizers", () => {
    describe("Claude Tool Blocks", () => {
      it("converts PalToolCallContent to ClaudeToolUseBlock", () => {
        const palCall = createToolCallBlock("call-1", "runTest", { suite: "pal" });
        const claudeBlock = normalizeToolCallToClaude(palCall);

        expect(claudeBlock.type).toBe("tool_use");
        expect(claudeBlock.id).toBe("call-1");
        expect(claudeBlock.name).toBe("runTest");
        expect(claudeBlock.input).toEqual({ suite: "pal" });
      });

      it("converts ClaudeToolUseBlock to PalToolCallContent", () => {
        const rawClaude: ClaudeToolUseBlock = {
          type: "tool_use",
          id: "call-2",
          name: "compile",
          input: { optimize: true },
        };

        const palCall = normalizeToolCallFromClaude(rawClaude);
        expect(palCall.type).toBe("tool_call");
        expect(palCall.id).toBe("call-2");
        expect(palCall.name).toBe("compile");
        expect(palCall.arguments).toEqual({ optimize: true });
        expect(palCall.rawArguments).toBe('{"optimize":true}');
      });

      it("handles string input in ClaudeToolUseBlock", () => {
        const rawClaude = {
          type: "tool_use",
          id: "call-str",
          name: "parse",
          input: '{"key": "value"}',
        };

        const palCall = normalizeToolCallFromClaude(rawClaude);
        expect(palCall.arguments).toEqual({ key: "value" });
      });

      it("throws PalError when normalizing invalid Claude tool use block", () => {
        expect(() => normalizeToolCallFromClaude(null)).toThrow(PalError);
        expect(() => normalizeToolCallFromClaude("not an object")).toThrow(PalError);
      });

      it("converts PalToolResultContent to ClaudeToolResultBlock with string content", () => {
        const palResult = createToolResultBlock("call-1", "runTest", "Tests passed", false);
        const claudeBlock = normalizeToolResultToClaude(palResult);

        expect(claudeBlock.type).toBe("tool_result");
        expect(claudeBlock.tool_use_id).toBe("call-1");
        expect(claudeBlock.content).toBe("Tests passed");
        expect(claudeBlock.is_error).toBeUndefined();
      });

      it("converts PalToolResultContent with error flag to ClaudeToolResultBlock", () => {
        const palResult = createToolResultBlock("call-1", "runTest", "Command failed: exit 1", true);
        const claudeBlock = normalizeToolResultToClaude(palResult);

        expect(claudeBlock.is_error).toBe(true);
      });

      it("converts PalToolResultContent with multimodal blocks to ClaudeToolResultBlock", () => {
        const textBlock = createTextBlock("Graph output:");
        const imgBlock = createImageBlock(PAL_IMAGE_MIME_TYPES.PNG, "base64data==");
        const palResult = createToolResultBlock("call-img", "renderGraph", [textBlock, imgBlock]);

        const claudeBlock = normalizeToolResultToClaude(palResult);
        expect(Array.isArray(claudeBlock.content)).toBe(true);
        if (!Array.isArray(claudeBlock.content)) return;
        expect(claudeBlock.content.length).toBe(2);
        expect(claudeBlock.content[0]).toEqual({ type: "text", text: "Graph output:" });
        expect(claudeBlock.content[1]).toEqual({
          type: "image",
          source: {
            type: "base64",
            media_type: PAL_IMAGE_MIME_TYPES.PNG,
            data: "base64data==",
          },
        });
      });

      it("converts ClaudeToolResultBlock to PalToolResultContent", () => {
        const rawClaude: ClaudeToolResultBlock = {
          type: "tool_result",
          tool_use_id: "call-3",
          content: "Done successfully",
          is_error: false,
        };

        const palResult = normalizeToolResultFromClaude(rawClaude);
        expect(palResult.type).toBe("tool_result");
        expect(palResult.toolCallId).toBe("call-3");
        expect(palResult.content).toBe("Done successfully");
        expect(palResult.isError).toBe(false);
      });

      it("converts ClaudeToolResultBlock with array content to PalToolResultContent", () => {
        const rawClaude = {
          type: "tool_result",
          tool_use_id: "call-arr",
          content: [
            { type: "text", text: "Screenshot attached" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "imagebase64==",
              },
            },
          ],
        };

        const palResult = normalizeToolResultFromClaude(rawClaude);
        expect(Array.isArray(palResult.content)).toBe(true);
        if (!Array.isArray(palResult.content)) return;
        expect(palResult.content.length).toBe(2);
        expect(isPalTextContent(palResult.content[0]!)).toBe(true);
        expect(isPalImageContent(palResult.content[1]!)).toBe(true);
      });

      it("throws PalError when normalizing invalid Claude tool result block", () => {
        expect(() => normalizeToolResultFromClaude(undefined)).toThrow(PalError);
      });
    });

    describe("Gemini Tool Blocks", () => {
      it("converts PalToolCallContent to GeminiFunctionCallPart", () => {
        const palCall = createToolCallBlock("fn-1", "getWeather", { city: "Tokyo" });
        const geminiPart = normalizeToolCallToGemini(palCall);

        expect(geminiPart.functionCall).toBeDefined();
        expect(geminiPart.functionCall.name).toBe("getWeather");
        expect(geminiPart.functionCall.args).toEqual({ city: "Tokyo" });
        expect(geminiPart.functionCall.id).toBe("fn-1");
      });

      it("converts GeminiFunctionCallPart to PalToolCallContent", () => {
        const part: GeminiFunctionCallPart = {
          functionCall: {
            name: "fetchStock",
            args: { symbol: "GOOG" },
            id: "call-goog",
          },
        };

        const palCall = normalizeToolCallFromGemini(part);
        expect(palCall.type).toBe("tool_call");
        expect(palCall.name).toBe("fetchStock");
        expect(palCall.arguments).toEqual({ symbol: "GOOG" });
        expect(palCall.id).toBe("call-goog");
      });

      it("handles string arguments in GeminiFunctionCallPart", () => {
        const part = {
          functionCall: {
            name: "evalMath",
            args: '{"expr": "2 + 2"}',
          },
        };

        const palCall = normalizeToolCallFromGemini(part, "fallback-id");
        expect(palCall.id).toBe("fallback-id");
        expect(palCall.arguments).toEqual({ expr: "2 + 2" });
      });

      it("throws PalError when normalizing invalid Gemini function call", () => {
        expect(() => normalizeToolCallFromGemini(null)).toThrow(PalError);
      });

      it("converts PalToolResultContent to GeminiFunctionResponsePart", () => {
        const palResult = createToolResultBlock("call-geo", "getGeo", "Latitude: 35.68", false);
        const geminiPart = normalizeToolResultToGemini(palResult);

        expect(geminiPart.functionResponse).toBeDefined();
        expect(geminiPart.functionResponse.name).toBe("getGeo");
        expect(geminiPart.functionResponse.id).toBe("call-geo");
        expect(geminiPart.functionResponse.response).toEqual({ output: "Latitude: 35.68" });
      });

      it("converts PalToolResultContent with error to GeminiFunctionResponsePart", () => {
        const palResult = createToolResultBlock("call-err", "getGeo", "Not found", true);
        const geminiPart = normalizeToolResultToGemini(palResult);

        expect(geminiPart.functionResponse.response).toEqual({ error: "Not found" });
      });

      it("converts GeminiFunctionResponsePart to PalToolResultContent", () => {
        const part: GeminiFunctionResponsePart = {
          functionResponse: {
            name: "getGeo",
            id: "call-geo",
            response: { output: "35.68, 139.76" },
          },
        };

        const palResult = normalizeToolResultFromGemini(part);
        expect(palResult.type).toBe("tool_result");
        expect(palResult.toolCallId).toBe("call-geo");
        expect(palResult.toolName).toBe("getGeo");
        expect(palResult.content).toBe("35.68, 139.76");
        expect(palResult.isError).toBe(false);
      });

      it("converts GeminiFunctionResponsePart with error response", () => {
        const part = {
          functionResponse: {
            name: "queryDb",
            id: "call-db",
            response: { error: "Connection timeout", isError: true },
          },
        };

        const palResult = normalizeToolResultFromGemini(part);
        expect(palResult.content).toBe("Connection timeout");
        expect(palResult.isError).toBe(true);
      });

      it("throws PalError when normalizing invalid Gemini function response", () => {
        expect(() => normalizeToolResultFromGemini("invalid")).toThrow(PalError);
      });
    });

    describe("OpenAI Tool Blocks", () => {
      it("converts PalToolCallContent to OpenAiToolCall", () => {
        const palCall = createToolCallBlock("call-oa1", "searchCode", { query: "PAL" });
        const openAiCall = normalizeToolCallToOpenAi(palCall);

        expect(openAiCall.id).toBe("call-oa1");
        expect(openAiCall.type).toBe("function");
        expect(openAiCall.function.name).toBe("searchCode");
        expect(openAiCall.function.arguments).toBe('{"query":"PAL"}');
      });

      it("converts OpenAiToolCall to PalToolCallContent", () => {
        const openAiCall: OpenAiToolCall = {
          id: "call-oa2",
          type: "function",
          function: {
            name: "readFile",
            arguments: '{"path":"src/pal/normalizer.ts"}',
          },
        };

        const palCall = normalizeToolCallFromOpenAi(openAiCall);
        expect(palCall.type).toBe("tool_call");
        expect(palCall.id).toBe("call-oa2");
        expect(palCall.name).toBe("readFile");
        expect(palCall.arguments).toEqual({ path: "src/pal/normalizer.ts" });
        expect(palCall.rawArguments).toBe('{"path":"src/pal/normalizer.ts"}');
      });

      it("throws PalError when normalizing invalid OpenAI tool call", () => {
        expect(() => normalizeToolCallFromOpenAi(null)).toThrow(PalError);
      });

      it("converts PalToolResultContent to OpenAiTurnMessage", () => {
        const palResult = createToolResultBlock("call-oa1", "searchCode", "Found 5 matches", false);
        const openAiMsg = normalizeToolResultToOpenAi(palResult);

        expect(openAiMsg.role).toBe("tool");
        expect(openAiMsg.tool_call_id).toBe("call-oa1");
        expect(openAiMsg.name).toBe("searchCode");
        expect(openAiMsg.content).toBe("Found 5 matches");
      });

      it("converts PalToolResultContent with array content to OpenAiTurnMessage", () => {
        const palResult = createToolResultBlock("call-oa2", "status", [
          createTextBlock("Line 1"),
          createTextBlock("Line 2"),
        ]);
        const openAiMsg = normalizeToolResultToOpenAi(palResult);

        expect(openAiMsg.content).toBe("Line 1\nLine 2");
      });

      it("converts OpenAiTurnMessage to PalToolResultContent", () => {
        const openAiMsg: OpenAiTurnMessage = {
          role: "tool",
          tool_call_id: "call-oa3",
          name: "checkLint",
          content: "0 errors found",
        };

        const palResult = normalizeToolResultFromOpenAi(openAiMsg);
        expect(palResult.type).toBe("tool_result");
        expect(palResult.toolCallId).toBe("call-oa3");
        expect(palResult.toolName).toBe("checkLint");
        expect(palResult.content).toBe("0 errors found");
      });

      it("throws PalError when normalizing invalid OpenAI tool message", () => {
        expect(() => normalizeToolResultFromOpenAi(1234)).toThrow(PalError);
      });
    });
  });

  describe("Gemini Protobuf Struct Formatting (formatGeminiResponse)", () => {
    it("wraps string output into { output: content }", () => {
      expect(formatGeminiResponse("Success", false)).toEqual({ output: "Success" });
    });

    it("wraps string error into { error: content }", () => {
      expect(formatGeminiResponse("Failure occurred", true)).toEqual({
        error: "Failure occurred",
      });
    });

    it("wraps content block array into concatenated string output", () => {
      const blocks = [createTextBlock("Part A"), createTextBlock("Part B")];
      expect(formatGeminiResponse(blocks, false)).toEqual({ output: "Part A\nPart B" });
    });

    it("preserves object records directly when no error", () => {
      const obj = { recordsFound: 10, page: 1 };
      expect(formatGeminiResponse(obj as unknown as string, false)).toEqual(obj);
    });

    it("wraps object records in { error: obj } when error", () => {
      const obj = { code: 500, reason: "Database unavailable" };
      expect(formatGeminiResponse(obj as unknown as string, true)).toEqual({ error: obj });
    });
  });

  describe("Atomic Tool Batch Reconciliation (reconcileToolBatch)", () => {
    it("preserves exact matches between model calls and user results", () => {
      const modelCalls: PalToolCallContent[] = [
        createToolCallBlock("call-1", "read", { file: "a.ts" }),
        createToolCallBlock("call-2", "write", { file: "b.ts" }),
      ];
      const userResults: PalToolResultContent[] = [
        createToolResultBlock("call-1", "read", "content a"),
        createToolResultBlock("call-2", "write", "ok"),
      ];

      const reconciled = reconcileToolBatch(modelCalls, userResults);
      expect(reconciled.length).toBe(2);
      expect(reconciled[0]?.toolCallId).toBe("call-1");
      expect(reconciled[0]?.content).toBe("content a");
      expect(reconciled[0]?.isError).toBe(false);
      expect(reconciled[1]?.toolCallId).toBe("call-2");
      expect(reconciled[1]?.content).toBe("ok");
    });

    it("resolves missing toolName in result from call.name", () => {
      const modelCalls = [createToolCallBlock("call-x", "calculateSum", {})];
      const userResults = [createToolResultBlock("call-x", "", "42")];

      const reconciled = reconcileToolBatch(modelCalls, userResults);
      expect(reconciled[0]?.toolName).toBe("calculateSum");
    });

    it("synthesizes error tool result for unhandled or dropped model calls", () => {
      const modelCalls = [
        createToolCallBlock("call-1", "fastOp", {}),
        createToolCallBlock("call-2", "slowOp", {}),
      ];
      // User only responded to call-1
      const userResults = [createToolResultBlock("call-1", "fastOp", "fast result")];

      const reconciled = reconcileToolBatch(modelCalls, userResults);
      expect(reconciled.length).toBe(2);
      expect(reconciled[0]?.toolCallId).toBe("call-1");
      expect(reconciled[0]?.content).toBe("fast result");

      const synthetic = reconciled[1];
      expect(synthetic).toBeDefined();
      if (!synthetic) return;
      expect(synthetic.toolCallId).toBe("call-2");
      expect(synthetic.toolName).toBe("slowOp");
      expect(synthetic.content).toBe(SYNTHETIC_TOOL_ERROR_MESSAGE);
      expect(synthetic.isError).toBe(true);
    });

    it("preserves extraneous user results that did not match a model call", () => {
      const modelCalls = [createToolCallBlock("call-1", "op1", {})];
      const userResults = [
        createToolResultBlock("call-1", "op1", "res1"),
        createToolResultBlock("call-orphan", "orphanOp", "orphan res"),
      ];

      const reconciled = reconcileToolBatch(modelCalls, userResults);
      expect(reconciled.length).toBe(2);
      expect(reconciled[0]?.toolCallId).toBe("call-1");
      expect(reconciled[1]?.toolCallId).toBe("call-orphan");
      expect(reconciled[1]?.content).toBe("orphan res");
    });
  });

  describe("Turn-Folding Invariant (normalizeTurns)", () => {
    it("returns empty array when given empty message list", () => {
      expect(normalizeTurns([])).toEqual([]);
    });

    it("preserves leading system messages without modification", () => {
      const sysMsg = createPalMessage({
        role: PAL_ROLES.SYSTEM,
        content: [createTextBlock("You are a helpful assistant.")],
      });
      const userMsg = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Hello")],
      });

      const normalized = normalizeTurns([sysMsg, userMsg]);
      expect(normalized.length).toBe(2);
      expect(normalized[0]?.role).toBe(PAL_ROLES.SYSTEM);
      expect(normalized[1]?.role).toBe(PAL_ROLES.USER);
    });

    it("folds contiguous user and tool messages into a single user turn", () => {
      const user1 = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Execute step 1")],
      });
      const tool1 = createPalMessage({
        role: PAL_ROLES.TOOL,
        content: [createToolResultBlock("call-1", "cmd", "output 1")],
      });
      const tool2 = createPalMessage({
        role: PAL_ROLES.TOOL,
        content: [createToolResultBlock("call-2", "cmd", "output 2")],
      });
      const user2 = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("And step 2")],
      });

      const normalized = normalizeTurns([user1, tool1, tool2, user2]);
      expect(normalized.length).toBe(1);
      expect(normalized[0]?.role).toBe(PAL_ROLES.USER);
      expect(normalized[0]?.content.length).toBe(4);
      expect(normalized[0]?.content[0]).toEqual(createTextBlock("Execute step 1"));
      expect(isPalToolResultContent(normalized[0]?.content[1]!)).toBe(true);
      expect(isPalToolResultContent(normalized[0]?.content[2]!)).toBe(true);
      expect(normalized[0]?.content[3]).toEqual(createTextBlock("And step 2"));
    });

    it("folds contiguous assistant messages into a single assistant turn", () => {
      const asst1 = createPalMessage({
        role: PAL_ROLES.ASSISTANT,
        content: [createThoughtBlock("Thinking through the problem...")],
      });
      const asst2 = createPalMessage({
        role: PAL_ROLES.ASSISTANT,
        content: [createTextBlock("Here is the solution.")],
      });

      const normalized = normalizeTurns([asst1, asst2]);
      // Note: As conversational history starts with assistant, synthetic user prompt is prepended!
      expect(normalized.length).toBe(2);
      expect(normalized[0]?.role).toBe(PAL_ROLES.USER);
      expect(normalized[0]?.content[0]).toEqual(createTextBlock(SYNTHETIC_USER_PROMPT));

      expect(normalized[1]?.role).toBe(PAL_ROLES.ASSISTANT);
      expect(normalized[1]?.content.length).toBe(2);
      expect(isPalThoughtContent(normalized[1]?.content[0]!)).toBe(true);
      expect(isPalTextContent(normalized[1]?.content[1]!)).toBe(true);
    });

    it("prepends synthetic user message if first conversational turn is assistant", () => {
      const asst = createPalMessage({
        role: PAL_ROLES.ASSISTANT,
        content: [createTextBlock("Autonomous initialization")],
      });

      const normalized = normalizeTurns([asst]);
      expect(normalized.length).toBe(2);
      expect(normalized[0]?.role).toBe(PAL_ROLES.USER);
      expect(normalized[0]?.content[0]).toEqual(createTextBlock(SYNTHETIC_USER_PROMPT));
      expect(normalized[0]?.metadata).toEqual({ synthetic: true });

      expect(normalized[1]?.role).toBe(PAL_ROLES.ASSISTANT);
      expect(normalized[1]?.content[0]).toEqual(createTextBlock("Autonomous initialization"));
    });

    it("does not prepend synthetic user message if history begins with user turn", () => {
      const user = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Hi")],
      });
      const asst = createPalMessage({
        role: PAL_ROLES.ASSISTANT,
        content: [createTextBlock("Hello!")],
      });

      const normalized = normalizeTurns([user, asst]);
      expect(normalized.length).toBe(2);
      expect(normalized[0]?.role).toBe(PAL_ROLES.USER);
      expect(normalized[0]?.content[0]).toEqual(createTextBlock("Hi"));
      expect(normalized[1]?.role).toBe(PAL_ROLES.ASSISTANT);
    });

    it("gathers interspersed system messages to top", () => {
      const user = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("User prompt")],
      });
      const interspersedSys = createPalMessage({
        role: PAL_ROLES.SYSTEM,
        content: [createTextBlock("System reminder")],
      });
      const asst = createPalMessage({
        role: PAL_ROLES.ASSISTANT,
        content: [createTextBlock("Assistant response")],
      });

      const normalized = normalizeTurns([user, interspersedSys, asst]);
      expect(normalized.length).toBe(3);
      expect(normalized[0]?.role).toBe(PAL_ROLES.SYSTEM);
      expect(normalized[0]?.content[0]).toEqual(createTextBlock("System reminder"));
      expect(normalized[1]?.role).toBe(PAL_ROLES.USER);
      expect(normalized[2]?.role).toBe(PAL_ROLES.ASSISTANT);
    });

    it("aggregates metadata across folded messages", () => {
      const u1 = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Part 1")],
        metadata: { metaA: 1 },
      });
      const u2 = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Part 2")],
        metadata: { metaB: 2 },
      });

      const normalized = normalizeTurns([u1, u2]);
      expect(normalized.length).toBe(1);
      expect(normalized[0]?.metadata).toEqual({ metaA: 1, metaB: 2 });
    });
  });

  describe("Anthropic Claude Bidirectional Normalization", () => {
    describe("toClaudePayload", () => {
      it("extracts system messages into top-level system array with ephemeral cache_control", () => {
        const sysMsg = createPalMessage({
          role: PAL_ROLES.SYSTEM,
          content: [createTextBlock("Claude system instruction", { type: "ephemeral" })],
        });
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Hello Claude")],
        });

        const payload = toClaudePayload([sysMsg, userMsg]);
        expect(payload.system).toBeDefined();
        expect(Array.isArray(payload.system)).toBe(true);
        expect(payload.system?.[0]).toEqual({
          type: "text",
          text: "Claude system instruction",
          cache_control: { type: "ephemeral" },
        });

        expect(payload.messages.length).toBe(1);
        expect(payload.messages[0]?.role).toBe("user");
        expect(payload.messages[0]?.content).toEqual([{ type: "text", text: "Hello Claude" }]);
      });

      it("preserves cryptographic signatures in thought blocks", () => {
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Think first")],
        });
        const asstMsg = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [
            createThoughtBlock("Deep reasoning chain...", { signature: "crypto-sig-xyz" }),
            createTextBlock("Final answer"),
          ],
        });

        const payload = toClaudePayload([userMsg, asstMsg]);
        expect(payload.messages.length).toBe(2);

        const asstTurn = payload.messages[1];
        expect(asstTurn?.role).toBe("assistant");
        expect(Array.isArray(asstTurn?.content)).toBe(true);
        if (!Array.isArray(asstTurn?.content)) return;

        expect(asstTurn.content[0]).toEqual({
          type: "thinking",
          thinking: "Deep reasoning chain...",
          signature: "crypto-sig-xyz",
        });
        expect(asstTurn.content[1]).toEqual({
          type: "text",
          text: "Final answer",
        });
      });

      it("handles redacted thought blocks", () => {
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Prompt")],
        });
        const asstMsg = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [createThoughtBlock("encrypted_data", { redacted: true })],
        });

        const payload = toClaudePayload([userMsg, asstMsg]);
        const asstTurn = payload.messages[1];
        if (!asstTurn || !Array.isArray(asstTurn.content)) return;

        expect(asstTurn.content[0]).toEqual({
          type: "redacted_thinking",
          data: "encrypted_data",
        });
      });

      it("reconciles model tool calls with user tool results", () => {
        const user1 = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("List files")],
        });
        const asst1 = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [
            createToolCallBlock("call-ls", "listFiles", { dir: "." }),
            createToolCallBlock("call-stat", "statFile", { file: "package.json" }),
          ],
        });
        // User responds only to call-ls; call-stat is dropped
        const user2 = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createToolResultBlock("call-ls", "listFiles", "file1\nfile2")],
        });

        const payload = toClaudePayload([user1, asst1, user2]);
        expect(payload.messages.length).toBe(3);

        const lastUserTurn = payload.messages[2];
        expect(lastUserTurn?.role).toBe("user");
        if (!lastUserTurn || !Array.isArray(lastUserTurn.content)) return;

        expect(lastUserTurn.content.length).toBe(2);
        // First tool result matched
        expect(lastUserTurn.content[0]).toEqual({
          type: "tool_result",
          tool_use_id: "call-ls",
          content: "file1\nfile2",
        });
        // Second tool result synthesized with error
        expect(lastUserTurn.content[1]).toEqual({
          type: "tool_result",
          tool_use_id: "call-stat",
          content: SYNTHETIC_TOOL_ERROR_MESSAGE,
          is_error: true,
        });
      });

      it("normalizes image blocks in user turns", () => {
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createImageBlock(PAL_IMAGE_MIME_TYPES.JPEG, "base64jpeg==")],
        });

        const payload = toClaudePayload([userMsg]);
        const turn = payload.messages[0];
        if (!turn || !Array.isArray(turn.content)) return;

        expect(turn.content[0]).toEqual({
          type: "image",
          source: {
            type: "base64",
            media_type: PAL_IMAGE_MIME_TYPES.JPEG,
            data: "base64jpeg==",
          },
        });
      });

      it("ensures turns never have empty content arrays", () => {
        const emptyUserMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [],
        });

        const payload = toClaudePayload([emptyUserMsg]);
        expect(payload.messages[0]?.content).toEqual([{ type: "text", text: "" }]);
      });
    });

    describe("fromClaudeResponse", () => {
      it("parses Anthropic response containing text, thinking, and tool_use blocks", () => {
        const rawResponse = {
          id: "msg_claude_123",
          role: "assistant",
          model: "claude-3-7-sonnet-20250219",
          stop_reason: "tool_use",
          usage: { input_tokens: 120, output_tokens: 85 },
          content: [
            {
              type: "thinking",
              thinking: "Let me check the tools available...",
              signature: "sig_val_123",
            },
            {
              type: "text",
              text: "I will now read the file.",
            },
            {
              type: "tool_use",
              id: "call_read_1",
              name: "readFile",
              input: { path: "src/pal/types.ts" },
            },
          ],
        };

        const palMessage = fromClaudeResponse(rawResponse);
        expect(palMessage.id).toBe("msg_claude_123");
        expect(palMessage.role).toBe(PAL_ROLES.ASSISTANT);
        expect(palMessage.metadata?.model).toBe("claude-3-7-sonnet-20250219");
        expect(palMessage.metadata?.stop_reason).toBe("tool_use");

        expect(palMessage.content.length).toBe(3);
        const [thought, text, toolCall] = palMessage.content;

        expect(thought).toBeDefined();
        if (thought && isPalThoughtContent(thought)) {
          expect(thought.text).toBe("Let me check the tools available...");
          expect(thought.signature).toBe("sig_val_123");
        } else {
          expect(isPalThoughtContent(thought!)).toBe(true);
        }

        expect(text).toBeDefined();
        if (text && isPalTextContent(text)) {
          expect(text.text).toBe("I will now read the file.");
        } else {
          expect(isPalTextContent(text!)).toBe(true);
        }

        expect(toolCall).toBeDefined();
        if (toolCall && isPalToolCallContent(toolCall)) {
          expect(toolCall.id).toBe("call_read_1");
          expect(toolCall.name).toBe("readFile");
          expect(toolCall.arguments).toEqual({ path: "src/pal/types.ts" });
        } else {
          expect(isPalToolCallContent(toolCall!)).toBe(true);
        }
      });

      it("parses raw response where payload is wrapped in message property", () => {
        const wrapped = {
          message: {
            id: "msg_wrapped_99",
            role: "assistant",
            content: "Simple text message",
          },
        };

        const palMessage = fromClaudeResponse(wrapped);
        expect(palMessage.id).toBe("msg_wrapped_99");
        expect(palMessage.content.length).toBe(1);
        expect(palMessage.content[0]).toEqual(createTextBlock("Simple text message"));
      });

      it("throws PalError on non-object response payload", () => {
        expect(() => fromClaudeResponse("bad string")).toThrow(PalError);
      });
    });
  });

  describe("Google Gemini Bidirectional Normalization", () => {
    describe("toGeminiPayload", () => {
      it("maps system messages to systemInstruction parts", () => {
        const sysMsg = createPalMessage({
          role: PAL_ROLES.SYSTEM,
          content: [createTextBlock("Gemini System Rules")],
        });
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Hello Gemini")],
        });

        const payload = toGeminiPayload([sysMsg, userMsg]);
        expect(payload.systemInstruction).toBeDefined();
        expect(payload.systemInstruction?.parts).toEqual([{ text: "Gemini System Rules" }]);

        expect(payload.contents.length).toBe(1);
        expect(payload.contents[0]?.role).toBe("user");
        expect(payload.contents[0]?.parts).toEqual([{ text: "Hello Gemini" }]);
      });

      it("strips thoughts from model turns to prevent token inflation", () => {
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Prompt")],
        });
        const asstMsg = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [
            createThoughtBlock("Hidden Gemini thought"),
            createTextBlock("Visible Gemini answer"),
          ],
        });

        const payload = toGeminiPayload([userMsg, asstMsg]);
        expect(payload.contents.length).toBe(2);

        const modelTurn = payload.contents[1];
        expect(modelTurn?.role).toBe("model");
        expect(modelTurn?.parts).toEqual([{ text: "Visible Gemini answer" }]);
      });

      it("maps function calls and function responses with protobuf struct formatting", () => {
        const user1 = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Run query")],
        });
        const asst1 = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [createToolCallBlock("call-gem-1", "queryDb", { sql: "SELECT 1" })],
        });
        const user2 = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createToolResultBlock("call-gem-1", "queryDb", "1 row returned")],
        });

        const payload = toGeminiPayload([user1, asst1, user2]);
        expect(payload.contents.length).toBe(3);

        const modelTurn = payload.contents[1];
        expect(modelTurn?.role).toBe("model");
        expect(modelTurn?.parts[0]).toEqual({
          functionCall: {
            name: "queryDb",
            args: { sql: "SELECT 1" },
            id: "call-gem-1",
          },
        });

        const toolTurn = payload.contents[2];
        expect(toolTurn?.role).toBe("user");
        expect(toolTurn?.parts[0]).toEqual({
          functionResponse: {
            name: "queryDb",
            id: "call-gem-1",
            response: { output: "1 row returned" },
          },
        });
      });

      it("normalizes inline image data", () => {
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createImageBlock(PAL_IMAGE_MIME_TYPES.PNG, "geminipng==")],
        });

        const payload = toGeminiPayload([userMsg]);
        expect(payload.contents[0]?.parts[0]).toEqual({
          inlineData: {
            mimeType: PAL_IMAGE_MIME_TYPES.PNG,
            data: "geminipng==",
          },
        });
      });

      it("reconciles dropped function calls with synthetic error response", () => {
        const user1 = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Start")],
        });
        const asst1 = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [createToolCallBlock("call-missing", "timeoutOp", {})],
        });
        const user2 = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Next turn without result")],
        });

        const payload = toGeminiPayload([user1, asst1, user2]);
        const userTurn = payload.contents[2];
        expect(userTurn?.parts[0]).toEqual({
          functionResponse: {
            name: "timeoutOp",
            id: "call-missing",
            response: { error: SYNTHETIC_TOOL_ERROR_MESSAGE },
          },
        });
      });
    });

    describe("fromGeminiResponse", () => {
      it("parses GenerateContent candidate with thoughts, text, and functionCall", () => {
        const rawGemini = {
          candidates: [
            {
              content: {
                parts: [
                  { thought: "Step-by-step reasoning" },
                  { text: "Here is what I found" },
                  {
                    functionCall: {
                      name: "browseUrl",
                      args: { url: "https://example.com" },
                      id: "call-br-1",
                    },
                  },
                ],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30 },
        };

        const palMessage = fromGeminiResponse(rawGemini);
        expect(palMessage.role).toBe(PAL_ROLES.ASSISTANT);
        expect(palMessage.metadata?.finishReason).toBe("STOP");
        expect(palMessage.metadata?.usageMetadata).toEqual({
          promptTokenCount: 50,
          candidatesTokenCount: 30,
        });

        expect(palMessage.content.length).toBe(3);
        expect(palMessage.content[0]).toEqual(createThoughtBlock("Step-by-step reasoning"));
        expect(palMessage.content[1]).toEqual(createTextBlock("Here is what I found"));

        const call = palMessage.content[2];
        if (!call || !isPalToolCallContent(call)) return;
        expect(call.name).toBe("browseUrl");
        expect(call.arguments).toEqual({ url: "https://example.com" });
        expect(call.id).toBe("call-br-1");
      });

      it("parses thought boolean flag with text property (Gemini 2.0 thought part format)", () => {
        const rawGemini = {
          content: {
            parts: [{ thought: true, text: "Internal Gemini reflection" }],
          },
        };

        const palMessage = fromGeminiResponse(rawGemini);
        expect(palMessage.content[0]).toEqual(createThoughtBlock("Internal Gemini reflection"));
      });

      it("parses inlineData in Gemini response", () => {
        const rawGemini = {
          parts: [
            {
              inlineData: {
                mimeType: "image/webp",
                data: "geminiwebpbase64",
              },
            },
          ],
        };

        const palMessage = fromGeminiResponse(rawGemini);
        expect(palMessage.content[0]).toEqual(
          createImageBlock(PAL_IMAGE_MIME_TYPES.WEBP, "geminiwebpbase64")
        );
      });

      it("throws PalError on invalid non-object response", () => {
        expect(() => fromGeminiResponse(null)).toThrow(PalError);
      });
    });
  });

  describe("OpenAI / OpenCode Bidirectional Normalization", () => {
    describe("toOpenAiPayload", () => {
      it("maps system messages with role 'system'", () => {
        const sysMsg = createPalMessage({
          role: PAL_ROLES.SYSTEM,
          content: [createTextBlock("OpenAI System Instruction")],
          name: "system-agent",
        });
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Hello OpenAI")],
        });

        const payload = toOpenAiPayload([sysMsg, userMsg]);
        expect(payload.messages.length).toBe(2);

        expect(payload.messages[0]).toEqual({
          role: "system",
          content: "OpenAI System Instruction",
          name: "system-agent",
        });

        expect(payload.messages[1]).toEqual({
          role: "user",
          content: "Hello OpenAI",
        });
      });

      it("maps assistant tool calls into tool_calls array with serialized arguments", () => {
        const asstMsg = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [
            createTextBlock("Invoking tool"),
            createToolCallBlock("call-oa-1", "formatCode", { file: "test.ts" }),
          ],
        });

        const payload = toOpenAiPayload([asstMsg]);
        expect(payload.messages.length).toBe(1);

        const turn = payload.messages[0];
        expect(turn?.role).toBe("assistant");
        expect(turn?.content).toBe("Invoking tool");
        expect(turn?.tool_calls).toEqual([
          {
            id: "call-oa-1",
            type: "function",
            function: {
              name: "formatCode",
              arguments: '{"file":"test.ts"}',
            },
          },
        ]);
      });

      it("emits discrete messages with role 'tool' for tool results", () => {
        const toolMsg = createPalMessage({
          role: PAL_ROLES.TOOL,
          content: [createToolResultBlock("call-oa-1", "formatCode", "Formatted ok")],
        });

        const payload = toOpenAiPayload([toolMsg]);
        expect(payload.messages.length).toBe(1);
        expect(payload.messages[0]).toEqual({
          role: "tool",
          tool_call_id: "call-oa-1",
          name: "formatCode",
          content: "Formatted ok",
        });
      });

      it("maps multimodal user messages to data URL image_url parts", () => {
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [
            createTextBlock("Examine diagram"),
            createImageBlock(PAL_IMAGE_MIME_TYPES.PNG, "diagrambase64=="),
          ],
        });

        const payload = toOpenAiPayload([userMsg]);
        expect(payload.messages.length).toBe(1);

        const turn = payload.messages[0];
        expect(turn?.role).toBe("user");
        expect(Array.isArray(turn?.content)).toBe(true);
        if (!Array.isArray(turn?.content)) return;

        expect(turn.content).toEqual([
          { type: "text", text: "Examine diagram" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,diagrambase64==" },
          },
        ]);
      });

      it("reconciles dropped assistant tool calls with synthetic error tool message", () => {
        const asstMsg = createPalMessage({
          role: PAL_ROLES.ASSISTANT,
          content: [createToolCallBlock("call-drop", "longRunningTask", {})],
        });
        const userMsg = createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Follow-up user message")],
        });

        const payload = toOpenAiPayload([asstMsg, userMsg]);
        // Expect: assistant msg, synthetic tool msg for call-drop, followed by user msg
        expect(payload.messages.length).toBe(3);
        expect(payload.messages[1]).toEqual({
          role: "tool",
          tool_call_id: "call-drop",
          name: "longRunningTask",
          content: SYNTHETIC_TOOL_ERROR_MESSAGE,
        });
        expect(payload.messages[2]?.role).toBe("user");
        expect(payload.messages[2]?.content).toBe("Follow-up user message");
      });
    });

    describe("fromOpenAiResponse", () => {
      it("parses reasoning_content (DeepSeek / OpenCode / OpenAI o-series) as thought block", () => {
        const response = {
          id: "chatcmpl-o1",
          model: "o1-preview",
          choices: [
            {
              message: {
                role: "assistant",
                reasoning_content: "Reflecting on invariants and edge cases...",
                content: "Here is the verified solution.",
              },
              finish_reason: "stop",
            },
          ],
        };

        const palMessage = fromOpenAiResponse(response);
        expect(palMessage.role).toBe(PAL_ROLES.ASSISTANT);
        expect(palMessage.content.length).toBe(2);

        expect(palMessage.content[0]).toEqual(
          createThoughtBlock("Reflecting on invariants and edge cases...")
        );
        expect(palMessage.content[1]).toEqual(createTextBlock("Here is the verified solution."));
      });

      it("extracts <think>...</think> tags embedded in raw content strings", () => {
        const response = {
          choices: [
            {
              message: {
                role: "assistant",
                content: "<think>\nExploring possible algorithms\nSelected BFS\n</think>\nFound shortest path.",
              },
            },
          ],
        };

        const palMessage = fromOpenAiResponse(response);
        expect(palMessage.content.length).toBe(2);
        expect(palMessage.content[0]).toEqual(
          createThoughtBlock("Exploring possible algorithms\nSelected BFS")
        );
        expect(palMessage.content[1]).toEqual(createTextBlock("Found shortest path."));
      });

      it("parses native tool_calls with repaired JSON arguments", () => {
        const response = {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_native_1",
                    type: "function",
                    function: {
                      name: "execCmd",
                      // Malformed JSON with trailing comma
                      arguments: '{"cmd": "npm test", "timeout": 3000, }',
                    },
                  },
                ],
              },
            },
          ],
        };

        const palMessage = fromOpenAiResponse(response);
        expect(palMessage.content.length).toBe(1);

        const call = palMessage.content[0];
        if (!call || !isPalToolCallContent(call)) return;
        expect(call.name).toBe("execCmd");
        expect(call.arguments).toEqual({ cmd: "npm test", timeout: 3000 });
      });

      it("falls back to ReAct <tool_call> extraction when native tool_calls are absent", () => {
        const response = {
          message: {
            role: "assistant",
            content: "I will invoke the tool:\n<tool_call>{\"name\": \"ping\", \"arguments\": {\"host\": \"localhost\"}}</tool_call>\nPing sent.",
          },
        };

        const palMessage = fromOpenAiResponse(response);
        expect(palMessage.content.length).toBe(2);

        const call = palMessage.content[0];
        if (!call || !isPalToolCallContent(call)) return;
        expect(call.name).toBe("ping");
        expect(call.arguments).toEqual({ host: "localhost" });

        expect(palMessage.content[1]).toEqual(
          createTextBlock("I will invoke the tool:\n\nPing sent.")
        );
      });

      it("handles discrete tool messages directly", () => {
        const response = {
          role: "tool",
          name: "ping",
          tool_call_id: "call-ping-1",
          content: "pong",
        };

        const palMessage = fromOpenAiResponse(response);
        expect(palMessage.role).toBe(PAL_ROLES.TOOL);
        expect(palMessage.content[0]).toEqual(
          createToolResultBlock("call-ping-1", "ping", "pong")
        );
      });

      it("throws PalError on non-object response", () => {
        expect(() => fromOpenAiResponse(undefined)).toThrow(PalError);
      });
    });
  });

  describe("PalNormalizer Class & Singleton Instance", () => {
    it("instantiates PalNormalizer and exports singleton palNormalizer", () => {
      expect(palNormalizer).toBeInstanceOf(PalNormalizer);
    });

    it("delegates all normalization methods correctly through singleton", () => {
      const messages: PalMessage[] = [
        createPalMessage({
          role: PAL_ROLES.USER,
          content: [createTextBlock("Ping")],
        }),
      ];

      const claude = palNormalizer.toClaude(messages);
      expect(claude.messages.length).toBe(1);

      const gemini = palNormalizer.toGemini(messages);
      expect(gemini.contents.length).toBe(1);

      const openAi = palNormalizer.toOpenAi(messages);
      expect(openAi.messages.length).toBe(1);
    });

    it("delegates helper methods through PalNormalizer instance", () => {
      const normalizer = new PalNormalizer();
      expect(normalizer.repairJsonArguments('{"a": 1, }')).toEqual({ a: 1 });

      const extracted = normalizer.extractReActToolCalls("<tool_call>{\"name\":\"t\"}</tool_call>");
      expect(extracted.toolCalls.length).toBe(1);

      const calls = [createToolCallBlock("c1", "t", {})];
      const results = [createToolResultBlock("c1", "t", "res")];
      const reconciled = normalizer.reconcileToolBatch(calls, results);
      expect(reconciled.length).toBe(1);
    });
  });

  describe("Bidirectional End-to-End Invariant Round-Trips", () => {
    it("preserves message semantics across canonical -> Claude -> canonical", () => {
      const originalSys = createPalMessage({
        role: PAL_ROLES.SYSTEM,
        content: [createTextBlock("System instruction")],
      });
      const originalUser = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Calculate checksum")],
      });

      const claudePayload = toClaudePayload([originalSys, originalUser]);

      // Simulated Claude response
      const simulatedClaudeResponse = {
        id: "msg_claude_roundtrip",
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "Generating SHA-256...",
            signature: "sig_claude_roundtrip",
          },
          {
            type: "tool_use",
            id: "call_hash_1",
            name: "sha256",
            input: { data: "abc" },
          },
        ],
      };

      const reconstructed = fromClaudeResponse(simulatedClaudeResponse);
      expect(reconstructed.role).toBe(PAL_ROLES.ASSISTANT);
      expect(reconstructed.content.length).toBe(2);

      const thought = reconstructed.content[0];
      if (thought && isPalThoughtContent(thought)) {
        expect(thought.text).toBe("Generating SHA-256...");
        expect(thought.signature).toBe("sig_claude_roundtrip");
      }

      const toolCall = reconstructed.content[1];
      if (toolCall && isPalToolCallContent(toolCall)) {
        expect(toolCall.name).toBe("sha256");
        expect(toolCall.arguments).toEqual({ data: "abc" });
      }
    });

    it("preserves message semantics across canonical -> Gemini -> canonical", () => {
      const user = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Fetch metadata")],
      });

      const geminiPayload = toGeminiPayload([user]);
      expect(geminiPayload.contents.length).toBe(1);

      // Simulated Gemini response
      const simulatedGeminiResponse = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "getMetadata",
                    args: { target: "all" },
                    id: "fn_meta_1",
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      };

      const reconstructed = fromGeminiResponse(simulatedGeminiResponse);
      expect(reconstructed.role).toBe(PAL_ROLES.ASSISTANT);
      expect(reconstructed.content.length).toBe(1);
      const call = reconstructed.content[0];
      if (call && isPalToolCallContent(call)) {
        expect(call.name).toBe("getMetadata");
        expect(call.arguments).toEqual({ target: "all" });
      }
    });

    it("preserves message semantics across canonical -> OpenAI -> canonical", () => {
      const user = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Run diagnostics")],
      });

      const openAiPayload = toOpenAiPayload([user]);
      expect(openAiPayload.messages.length).toBe(1);

      // Simulated OpenAI response
      const simulatedOpenAiResponse = {
        id: "chatcmpl_roundtrip",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_diag_1",
                  type: "function",
                  function: {
                    name: "runDiagnostics",
                    arguments: '{"level": "verbose"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const reconstructed = fromOpenAiResponse(simulatedOpenAiResponse);
      expect(reconstructed.role).toBe(PAL_ROLES.ASSISTANT);
      expect(reconstructed.content.length).toBe(1);
      const call = reconstructed.content[0];
      if (call && isPalToolCallContent(call)) {
        expect(call.name).toBe("runDiagnostics");
        expect(call.arguments).toEqual({ level: "verbose" });
      }
    });
  });
});
