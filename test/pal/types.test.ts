import { describe, expect, it } from "bun:test";
import {
  COGNITIVE_ROLES,
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ERROR_KINDS,
  PAL_FINISH_REASONS,
  PAL_IMAGE_MIME_TYPES,
  PAL_PROVIDER_NAMES,
  PAL_ROLES,
  PalError,
  PalErrorCodes,
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
  type ClaudeTurnPayload,
  type GeminiTurnPayload,
  type IPalProvider,
  type OpenAiTurnPayload,
  type PalContentBlock,
  type PalMessage,
  type PalOutcome,
  type PalProviderCapabilities,
  type PalRateLimitInfo,
  type PalSessionOptions,
  type PalStreamEvent,
  type PalTurnNormalizer,
} from "../../src/pal/types";

describe("PAL Canonical Schema Types & Data Model", () => {
  describe("Canonical Constants & Enumerations", () => {
    it("defines canonical roles conforming to agnostic looper contracts", () => {
      expect(PAL_ROLES.SYSTEM).toBe("system");
      expect(PAL_ROLES.USER).toBe("user");
      expect(PAL_ROLES.ASSISTANT).toBe("assistant");
      expect(PAL_ROLES.TOOL).toBe("tool");
    });

    it("defines all canonical content block types", () => {
      expect(PAL_CONTENT_BLOCK_TYPES.TEXT).toBe("text");
      expect(PAL_CONTENT_BLOCK_TYPES.THOUGHT).toBe("thought");
      expect(PAL_CONTENT_BLOCK_TYPES.TOOL_CALL).toBe("tool_call");
      expect(PAL_CONTENT_BLOCK_TYPES.TOOL_RESULT).toBe("tool_result");
      expect(PAL_CONTENT_BLOCK_TYPES.IMAGE).toBe("image");
    });

    it("defines supported image MIME types", () => {
      expect(PAL_IMAGE_MIME_TYPES.PNG).toBe("image/png");
      expect(PAL_IMAGE_MIME_TYPES.JPEG).toBe("image/jpeg");
      expect(PAL_IMAGE_MIME_TYPES.WEBP).toBe("image/webp");
      expect(PAL_IMAGE_MIME_TYPES.GIF).toBe("image/gif");
    });

    it("defines cognitive roles across multi-agent system", () => {
      expect(COGNITIVE_ROLES.SENTINEL).toBe("sentinel");
      expect(COGNITIVE_ROLES.ORCHESTRATOR).toBe("orchestrator");
      expect(COGNITIVE_ROLES.EXPLORER).toBe("explorer");
      expect(COGNITIVE_ROLES.WORKER).toBe("worker");
      expect(COGNITIVE_ROLES.REVIEWER).toBe("reviewer");
      expect(COGNITIVE_ROLES.CHALLENGER).toBe("challenger");
      expect(COGNITIVE_ROLES.AUDITOR).toBe("auditor");
    });

    it("defines supported providers and finish reasons", () => {
      expect(PAL_PROVIDER_NAMES.CLAUDE).toBe("claude");
      expect(PAL_PROVIDER_NAMES.ANTIGRAVITY).toBe("antigravity");
      expect(PAL_PROVIDER_NAMES.OPENCODE).toBe("opencode");

      expect(PAL_FINISH_REASONS.STOP).toBe("stop");
      expect(PAL_FINISH_REASONS.LENGTH).toBe("length");
      expect(PAL_FINISH_REASONS.TOOL_CALLS).toBe("tool_calls");
      expect(PAL_FINISH_REASONS.CONTENT_FILTER).toBe("content_filter");
      expect(PAL_FINISH_REASONS.ERROR).toBe("error");
    });
  });

  describe("Canonical Content Block Factories & Type Guards", () => {
    it("creates and discriminates PalTextContent", () => {
      const textBlock = createTextBlock("Hello agent", { type: "ephemeral" });
      expect(textBlock.type).toBe("text");
      expect(textBlock.text).toBe("Hello agent");
      expect(textBlock.cacheControl).toEqual({ type: "ephemeral" });

      expect(isPalTextContent(textBlock)).toBe(true);
      expect(isPalThoughtContent(textBlock)).toBe(false);
      expect(isPalToolCallContent(textBlock)).toBe(false);
      expect(isPalToolResultContent(textBlock)).toBe(false);
      expect(isPalImageContent(textBlock)).toBe(false);
    });

    it("creates and discriminates PalThoughtContent preserving cryptographic signature", () => {
      const thoughtBlock = createThoughtBlock("Planning step 1...", {
        signature: "sig_crypto_abc123",
        redacted: false,
      });
      expect(thoughtBlock.type).toBe("thought");
      expect(thoughtBlock.text).toBe("Planning step 1...");
      expect(thoughtBlock.signature).toBe("sig_crypto_abc123");
      expect(thoughtBlock.redacted).toBe(false);

      expect(isPalThoughtContent(thoughtBlock)).toBe(true);
      expect(isPalTextContent(thoughtBlock)).toBe(false);
    });

    it("creates and discriminates PalToolCallContent", () => {
      const toolCall = createToolCallBlock(
        "call_123",
        "read_file",
        { path: "/repo/package.json" },
        '{"path": "/repo/package.json"}'
      );
      expect(toolCall.type).toBe("tool_call");
      expect(toolCall.id).toBe("call_123");
      expect(toolCall.name).toBe("read_file");
      expect(toolCall.arguments).toEqual({ path: "/repo/package.json" });
      expect(toolCall.rawArguments).toBe('{"path": "/repo/package.json"}');

      expect(isPalToolCallContent(toolCall)).toBe(true);
      expect(isPalToolResultContent(toolCall)).toBe(false);
    });

    it("creates and discriminates PalToolResultContent with string and block content", () => {
      const resultString = createToolResultBlock(
        "call_123",
        "read_file",
        "File contents here",
        false,
        42
      );
      expect(resultString.type).toBe("tool_result");
      expect(resultString.toolCallId).toBe("call_123");
      expect(resultString.toolName).toBe("read_file");
      expect(resultString.content).toBe("File contents here");
      expect(resultString.isError).toBe(false);
      expect(resultString.durationMs).toBe(42);
      expect(isPalToolResultContent(resultString)).toBe(true);

      const resultNestedBlocks = createToolResultBlock(
        "call_456",
        "analyze",
        [createTextBlock("Sub-result 1")],
        true
      );
      expect(resultNestedBlocks.isError).toBe(true);
      expect(Array.isArray(resultNestedBlocks.content)).toBe(true);
      expect(isPalToolResultContent(resultNestedBlocks)).toBe(true);
    });

    it("creates and discriminates PalImageContent", () => {
      const imageBlock = createImageBlock(
        PAL_IMAGE_MIME_TYPES.PNG,
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      );
      expect(imageBlock.type).toBe("image");
      expect(imageBlock.mimeType).toBe("image/png");
      expect(imageBlock.data).toBeDefined();

      expect(isPalImageContent(imageBlock)).toBe(true);
      expect(isPalTextContent(imageBlock)).toBe(false);
    });
  });

  describe("Canonical PalMessage Data Model", () => {
    it("creates canonical message with defaults", () => {
      const blocks: PalContentBlock[] = [createTextBlock("Task instructions")];
      const message = createPalMessage({
        role: PAL_ROLES.USER,
        content: blocks,
      });

      expect(message.id).toBeDefined();
      expect(typeof message.id).toBe("string");
      expect(message.id.length).toBeGreaterThan(0);
      expect(message.role).toBe("user");
      expect(message.content).toEqual(blocks);
      expect(message.timestamp).toBeDefined();
      expect(new Date(message.timestamp).toISOString()).toBe(message.timestamp);
    });

    it("creates canonical message with explicit metadata and sender name", () => {
      const message: PalMessage = createPalMessage({
        id: "msg_fixed_uuid_001",
        role: PAL_ROLES.ASSISTANT,
        name: "reviewer",
        timestamp: "2026-10-24T12:00:00.000Z",
        metadata: { checkpoint: "gate_1", attempt: 1 },
        content: [
          createThoughtBlock("Verification passed."),
          createTextBlock("LGTM approval granted."),
        ],
      });

      expect(message.id).toBe("msg_fixed_uuid_001");
      expect(message.role).toBe("assistant");
      expect(message.name).toBe("reviewer");
      expect(message.timestamp).toBe("2026-10-24T12:00:00.000Z");
      expect(message.metadata).toEqual({ checkpoint: "gate_1", attempt: 1 });
      expect(message.content).toHaveLength(2);
    });
  });

  describe("Standardized PAL Error Taxonomy", () => {
    it("instantiates PalError with classified error kind and properties", () => {
      const resetsAt = Date.now() + 60_000;
      const raw = { status: 429, header: "retry-after" };
      const err = new PalError(
        PAL_ERROR_KINDS.RATE_LIMIT,
        "Rate limit exceeded on provider API",
        true,
        resetsAt,
        raw
      );

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("PalError");
      expect(err.kind).toBe("rate_limit");
      expect(err.message).toBe("[rate_limit] Rate limit exceeded on provider API");
      expect(err.retryable).toBe(true);
      expect(err.resetsAt).toBe(resetsAt);
      expect(err.rawError).toBe(raw);
    });

    it("provides canonical error codes dictionary", () => {
      expect(PalErrorCodes.RATE_LIMITED).toBe("PAL_RATE_LIMITED");
      expect(PalErrorCodes.CONTEXT_OVERFLOW).toBe("PAL_CONTEXT_OVERFLOW");
      expect(PalErrorCodes.AUTH_ERROR).toBe("PAL_AUTH_ERROR");
      expect(PalErrorCodes.TOOL_FAILED).toBe("PAL_TOOL_FAILED");
      expect(PalErrorCodes.OVERLOADED).toBe("PAL_OVERLOADED");
      expect(PalErrorCodes.TIMEOUT).toBe("PAL_TIMEOUT");
      expect(PalErrorCodes.INVALID_PAYLOAD).toBe("PAL_INVALID_PAYLOAD");
    });
  });

  describe("Provider Port & Adapter Contracts Compliance", () => {
    it("validates IPalProvider mock implementation structure", async () => {
      const mockProvider: IPalProvider = {
        providerName: "claude",
        modelName: "claude-3-7-sonnet-20250219",
        async executeTurn(options: PalSessionOptions): Promise<PalOutcome> {
          return {
            message: createPalMessage({
              role: "assistant",
              content: [createTextBlock("Execution completed")],
            }),
            finishReason: "stop",
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            },
          };
        },
        async *streamTurn(): AsyncIterable<PalStreamEvent> {
          yield { type: "text_delta", text: "chunk" };
          yield {
            type: "turn_complete",
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
          };
        },
        getCapabilities(): PalProviderCapabilities {
          return {
            providerName: "claude",
            modelName: "claude-3-7-sonnet-20250219",
            maxContextTokens: 200_000,
            maxOutputTokens: 64_000,
            supportsNativeTools: true,
            supportsStreaming: true,
            supportsExtendedThinking: true,
            supportsPromptCaching: true,
          };
        },
        getRateLimitState(): PalRateLimitInfo {
          return {
            requestsRemaining: 50,
            requestsLimit: 100,
            tokensRemaining: 100_000,
            tokensLimit: 200_000,
            resetsAt: 1729771200000,
          };
        },
      };

      expect(mockProvider.providerName).toBe("claude");
      const caps = mockProvider.getCapabilities();
      expect(caps.supportsExtendedThinking).toBe(true);

      const outcome = await mockProvider.executeTurn({
        sessionId: "sess_001",
        messages: [
          createPalMessage({
            role: "user",
            content: [createTextBlock("Run task")],
          }),
        ],
      });
      expect(outcome.finishReason).toBe("stop");
      expect(outcome.usage.totalTokens).toBe(150);
    });

    it("type checks provider payload contracts (Claude, Gemini, OpenAi)", () => {
      const claudePayload: ClaudeTurnPayload = {
        system: "You are a helpful assistant.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello Claude" }],
          },
        ],
      };
      expect(claudePayload.messages).toHaveLength(1);

      const geminiPayload: GeminiTurnPayload = {
        systemInstruction: { parts: [{ text: "Gemini system prompt" }] },
        contents: [
          {
            role: "user",
            parts: [{ text: "Hello Gemini" }],
          },
        ],
      };
      expect(geminiPayload.contents).toHaveLength(1);

      const openAiPayload: OpenAiTurnPayload = {
        messages: [
          {
            role: "user",
            content: "Hello OpenAI",
          },
        ],
      };
      expect(openAiPayload.messages).toHaveLength(1);

      const mockNormalizer: PalTurnNormalizer = {
        toClaude: () => claudePayload,
        fromClaude: () => createPalMessage({ role: "assistant", content: [] }),
        toGemini: () => geminiPayload,
        fromGemini: () => createPalMessage({ role: "assistant", content: [] }),
        toOpenAi: () => openAiPayload,
        fromOpenAi: () => createPalMessage({ role: "assistant", content: [] }),
      };
      expect(typeof mockNormalizer.toClaude).toBe("function");
    });
  });
});
