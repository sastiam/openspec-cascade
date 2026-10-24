import { describe, expect, it } from "bun:test";
import {
  ANTIGRAVITY_RATE_LIMIT_REGEX,
  ANTIGRAVITY_UNRECOVERABLE_REGEX,
  AntigravityAdapter,
  AntigravityPalAdapter,
  GEMINI_ADAPTER_CONSTANTS,
  GeminiAdapter,
  GeminiNdjsonStreamReducer,
  GeminiStreamChunkParser,
  antigravityEffortArg,
  antigravityModelArg,
  buildAntigravityArgs,
  buildAntigravityCliArgs,
  calculateGeminiTokenUsage,
  classifyAntigravityFailure,
  classifyFailure,
  convertJsonToProtobufStruct,
  convertJsonToProtobufValue,
  convertProtobufStructToJson,
  createGeminiAdapter,
  createInitialNdjsonReducerState,
  describeToolInput,
  estimateCostUsd,
  estimateGeminiCostUsd,
  formatGeminiResponse,
  formatGeminiToolChoice,
  formatGeminiTools,
  formatSessionPromptForCli,
  formatToolInput,
  geminiPalAdapter,
  isProtobufStruct,
  isProtobufValue,
  mapGeminiFinishReason,
  ndjsonStateToPalMessage,
  oneLine,
  parseGeminiError,
  parseGeminiRateLimitHeaders,
  parseGeminiStream,
  parseGeminiStreamChunk,
  reduceGeminiNdjsonEvent,
  reduceNdjsonEvent,
  reduceNdjsonStream,
  runAntigravitySubprocess,
  streamAntigravitySubprocess,
  toAsyncIterable,
  validateThinkingBudget,
  type AntigravityCliArgsOptions,
  type AntigravitySpawnedProcess,
  type AntigravitySubprocessOptions,
  type AntigravitySubprocessSpawnFn,
} from "../../src/pal/adapters/gemini";
import {
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ERROR_KINDS,
  PAL_FINISH_REASONS,
  PAL_PROVIDER_NAMES,
  PAL_ROLES,
  PalError,
  createPalMessage,
  createTextBlock,
  isPalTextContent,
  isPalThoughtContent,
  isPalToolCallContent,
  type PalSessionOptions,
  type PalStreamEvent,
  type PalToolDefinition,
  type ProviderAdapter,
} from "../../src/pal/types";

describe("Google Gemini & Antigravity Provider Adapter (LOOPER-PAL-003)", () => {
  describe("ProviderAdapter Interface & Protocol Conformance (Task 1.1)", () => {
    it("initializes with default options and adheres to ProviderAdapter interface", () => {
      const adapter = new GeminiAdapter();
      const providerAdapter: ProviderAdapter = adapter;

      expect(providerAdapter.providerName).toBe(PAL_PROVIDER_NAMES.ANTIGRAVITY);
      expect(adapter.providerName).toBe(PAL_PROVIDER_NAMES.ANTIGRAVITY);
      expect(adapter.modelName).toBe(GEMINI_ADAPTER_CONSTANTS.DEFAULT_MODEL);
      expect(adapter.isDangerouslySkipPermissions()).toBe(false);
      expect(adapter.getDefaultThinking()).toBeUndefined();
    });

    it("respects custom configuration options", () => {
      const customOptions = {
        modelName: "gemini-2.0-flash-exp",
        apiKey: "test-gemini-key",
        baseUrl: "https://custom.gemini.endpoint.local",
        apiVersion: "v1alpha",
        timeoutMs: 30_000,
        defaultHeaders: {
          "x-custom-org": "org_test_gemini",
        },
        dangerouslySkipPermissions: true,
        providerName: PAL_PROVIDER_NAMES.ANTIGRAVITY,
      };

      const adapter = new GeminiAdapter(customOptions);
      expect(adapter.modelName).toBe("gemini-2.0-flash-exp");
      expect(adapter.isDangerouslySkipPermissions()).toBe(true);

      const headers = adapter.buildHeaders();
      expect(headers["x-goog-api-key"]).toBe("test-gemini-key");
      expect(headers["x-custom-org"]).toBe("org_test_gemini");

      const endpoint = adapter.buildEndpointUrl(false);
      expect(endpoint).toBe(
        "https://custom.gemini.endpoint.local/v1alpha/models/gemini-2.0-flash-exp:generateContent"
      );

      const streamEndpoint = adapter.buildEndpointUrl(true);
      expect(streamEndpoint).toBe(
        "https://custom.gemini.endpoint.local/v1alpha/models/gemini-2.0-flash-exp:streamGenerateContent?alt=sse"
      );
    });

    it("falls back to environment variables for API key and base URL", () => {
      const originalGeminiKey = process.env.GEMINI_API_KEY;
      const originalGoogleKey = process.env.GOOGLE_API_KEY;
      const originalBaseUrl = process.env.GEMINI_BASE_URL;

      try {
        delete process.env.GEMINI_API_KEY;
        process.env.GOOGLE_API_KEY = "google-env-fallback-key";
        process.env.GEMINI_BASE_URL = "https://env.gemini.endpoint.local";

        const adapter = new GeminiAdapter();
        const headers = adapter.buildHeaders();
        expect(headers["x-goog-api-key"]).toBe("google-env-fallback-key");
        expect(adapter.buildEndpointUrl(false)).toContain(
          "https://env.gemini.endpoint.local"
        );
      } finally {
        if (originalGeminiKey !== undefined) {
          process.env.GEMINI_API_KEY = originalGeminiKey;
        } else {
          delete process.env.GEMINI_API_KEY;
        }
        if (originalGoogleKey !== undefined) {
          process.env.GOOGLE_API_KEY = originalGoogleKey;
        } else {
          delete process.env.GOOGLE_API_KEY;
        }
        if (originalBaseUrl !== undefined) {
          process.env.GEMINI_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.GEMINI_BASE_URL;
        }
      }
    });

    it("provides singleton geminiPalAdapter and factory createGeminiAdapter", () => {
      expect(geminiPalAdapter).toBeInstanceOf(GeminiAdapter);
      expect(geminiPalAdapter.providerName).toBe(PAL_PROVIDER_NAMES.ANTIGRAVITY);

      const created = createGeminiAdapter({ apiKey: "factory-key" });
      expect(created).toBeInstanceOf(GeminiAdapter);
      expect(created.buildHeaders()["x-goog-api-key"]).toBe("factory-key");
    });

    it("getCapabilities() accurately reports provider capabilities (2M context)", () => {
      const adapter = new GeminiAdapter({ modelName: "gemini-2.5-pro" });
      const caps = adapter.getCapabilities();

      expect(caps.providerName).toBe(PAL_PROVIDER_NAMES.ANTIGRAVITY);
      expect(caps.modelName).toBe("gemini-2.5-pro");
      expect(caps.maxContextTokens).toBe(GEMINI_ADAPTER_CONSTANTS.MAX_CONTEXT_TOKENS);
      expect(caps.maxContextTokens).toBe(2_000_000);
      expect(caps.maxOutputTokens).toBe(GEMINI_ADAPTER_CONSTANTS.MAX_OUTPUT_TOKENS);
      expect(caps.supportsNativeTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsExtendedThinking).toBe(true);
      expect(caps.supportsPromptCaching).toBe(true);
    });

    it("getRateLimitState() tracks rate limits and updates from response headers", () => {
      const adapter = new GeminiAdapter();
      const initialLimits = adapter.getRateLimitState();

      expect(initialLimits.requestsLimit).toBe(GEMINI_ADAPTER_CONSTANTS.INITIAL_REQUESTS_LIMIT);
      expect(initialLimits.requestsRemaining).toBe(GEMINI_ADAPTER_CONSTANTS.INITIAL_REQUESTS_REMAINING);
      expect(initialLimits.tokensLimit).toBe(GEMINI_ADAPTER_CONSTANTS.INITIAL_TOKENS_LIMIT);
      expect(initialLimits.tokensRemaining).toBe(GEMINI_ADAPTER_CONSTANTS.INITIAL_TOKENS_REMAINING);
      expect(initialLimits.resetsAt).toBe(GEMINI_ADAPTER_CONSTANTS.INITIAL_RESETS_AT);
    });

    it("parseGeminiRateLimitHeaders extracts rate limit metrics and reset timestamps", () => {
      const headers = new Headers();
      headers.set("x-ratelimit-limit-requests", "600");
      headers.set("x-ratelimit-remaining-requests", "550");
      headers.set("x-ratelimit-limit-tokens", "1000000");
      headers.set("x-ratelimit-remaining-tokens", "950000");

      const parsed = parseGeminiRateLimitHeaders(headers);
      expect(parsed.requestsLimit).toBe(600);
      expect(parsed.requestsRemaining).toBe(550);
      expect(parsed.tokensLimit).toBe(1000000);
      expect(parsed.tokensRemaining).toBe(950000);

      // retry-after header support (seconds offset)
      const retryHeaders = new Headers();
      retryHeaders.set("retry-after", "120");
      const before = Date.now();
      const parsedRetry = parseGeminiRateLimitHeaders(retryHeaders);
      const after = Date.now();
      expect(parsedRetry.resetsAt).toBeGreaterThanOrEqual(before + 119 * 1000);
      expect(parsedRetry.resetsAt).toBeLessThanOrEqual(after + 121 * 1000);

      // retry-after HTTP date support
      const dateHeaders = new Headers();
      dateHeaders.set("retry-after", "2026-10-24T20:00:00Z");
      const parsedDate = parseGeminiRateLimitHeaders(dateHeaders);
      expect(parsedDate.resetsAt).toBe(Date.parse("2026-10-24T20:00:00Z"));
    });

    it("formatGeminiTools formats tool definitions to Gemini functionDeclarations", () => {
      expect(formatGeminiTools(undefined)).toBeUndefined();
      expect(formatGeminiTools([])).toBeUndefined();

      const tools: PalToolDefinition[] = [
        {
          name: "read_file",
          description: "Read file contents",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
          source: "native",
        },
      ];

      const formatted = formatGeminiTools(tools);
      expect(formatted).toBeDefined();
      expect(formatted).toHaveLength(1);
      const firstGroup = formatted?.[0];
      expect(firstGroup).toBeDefined();
      expect(firstGroup?.functionDeclarations).toHaveLength(1);
      expect(firstGroup?.functionDeclarations[0]?.name).toBe("read_file");
      expect(firstGroup?.functionDeclarations[0]?.description).toBe("Read file contents");
    });

    it("formatGeminiToolChoice formats tool selection configurations", () => {
      expect(formatGeminiToolChoice(undefined)).toEqual({
        functionCallingConfig: { mode: "AUTO" },
      });
      expect(formatGeminiToolChoice("auto")).toEqual({
        functionCallingConfig: { mode: "AUTO" },
      });
      expect(formatGeminiToolChoice("none")).toEqual({
        functionCallingConfig: { mode: "NONE" },
      });
      expect(formatGeminiToolChoice("required")).toEqual({
        functionCallingConfig: { mode: "ANY" },
      });
      expect(
        formatGeminiToolChoice({ type: "tool", toolName: "read_file" })
      ).toEqual({
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["read_file"],
        },
      });
    });

    it("mapGeminiFinishReason maps wire finish reasons to canonical PalFinishReason", () => {
      expect(mapGeminiFinishReason("STOP", false)).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapGeminiFinishReason("STOP", true)).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
      expect(mapGeminiFinishReason("MAX_TOKENS")).toBe(PAL_FINISH_REASONS.LENGTH);
      expect(mapGeminiFinishReason("SAFETY")).toBe(PAL_FINISH_REASONS.CONTENT_FILTER);
      expect(mapGeminiFinishReason("RECITATION")).toBe(PAL_FINISH_REASONS.CONTENT_FILTER);
      expect(mapGeminiFinishReason("BLOCKLIST")).toBe(PAL_FINISH_REASONS.CONTENT_FILTER);
      expect(mapGeminiFinishReason("MALFORMED_FUNCTION_CALL")).toBe(PAL_FINISH_REASONS.ERROR);
      expect(mapGeminiFinishReason("OTHER")).toBe(PAL_FINISH_REASONS.ERROR);
      expect(mapGeminiFinishReason("UNKNOWN_FUTURE_REASON")).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapGeminiFinishReason(undefined)).toBe(PAL_FINISH_REASONS.STOP);
    });

    it("calculateGeminiTokenUsage accurately sums tokens and separates thinking tokens", () => {
      const emptyUsage = calculateGeminiTokenUsage(undefined);
      expect(emptyUsage.promptTokens).toBe(0);
      expect(emptyUsage.completionTokens).toBe(0);
      expect(emptyUsage.totalTokens).toBe(0);

      const usageMetadata = {
        promptTokenCount: 1500,
        candidatesTokenCount: 600,
        totalTokenCount: 2100,
        cachedContentTokenCount: 500,
        candidatesTokensDetails: [
          { modality: "TEXT", tokenCount: 400 },
          { modality: "THINKING", tokenCount: 200 },
        ],
      };

      const calculated = calculateGeminiTokenUsage(usageMetadata);
      expect(calculated.promptTokens).toBe(1500);
      expect(calculated.completionTokens).toBe(600);
      expect(calculated.totalTokens).toBe(2100);
      expect(calculated.cachedPromptTokens).toBe(500);
      expect(calculated.thinkingTokens).toBe(200);
    });

    it("validateThinkingBudget enforces bounds correctly", () => {
      expect(() => validateThinkingBudget(2048)).not.toThrow();
      expect(() => validateThinkingBudget(0)).not.toThrow();
      expect(() => validateThinkingBudget(-1)).toThrow(PalError);
      expect(() => validateThinkingBudget(1.5)).toThrow(PalError);
      expect(() => validateThinkingBudget(100_000)).toThrow(PalError);
    });

    it("convertProtobufStructToJson converts protobuf Struct and Value structures", () => {
      expect(convertProtobufStructToJson(null)).toBeNull();
      expect(convertProtobufStructToJson("simple string")).toBe("simple string");
      expect(convertProtobufStructToJson(42)).toBe(42);

      // Value types
      expect(convertProtobufStructToJson({ stringValue: "hello" })).toBe("hello");
      expect(convertProtobufStructToJson({ numberValue: 123 })).toBe(123);
      expect(convertProtobufStructToJson({ boolValue: true })).toBe(true);
      expect(convertProtobufStructToJson({ nullValue: "NULL_VALUE" })).toBeNull();
      expect(
        convertProtobufStructToJson({
          listValue: {
            values: [{ stringValue: "a" }, { numberValue: 2 }],
          },
        })
      ).toEqual(["a", 2]);

      // Protobuf Struct with fields
      const protoStruct = {
        fields: {
          command: { stringValue: "bun test" },
          timeout: { numberValue: 5000 },
          flags: {
            listValue: {
              values: [{ stringValue: "--coverage" }],
            },
          },
          options: {
            structValue: {
              fields: {
                verbose: { boolValue: true },
              },
            },
          },
        },
      };

      const converted = convertProtobufStructToJson(protoStruct);
      expect(converted).toEqual({
        command: "bun test",
        timeout: 5000,
        flags: ["--coverage"],
        options: {
          verbose: true,
        },
      });
    });

    it("parseGeminiError maps HTTP status codes and payloads to PalError instances", () => {
      // 400 Bad Request
      const badReq = parseGeminiError(400, {
        error: { message: "Invalid argument provided", status: "INVALID_ARGUMENT" },
      });
      expect(badReq.kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
      expect(badReq.retryable).toBe(false);

      // 400 Context Length Exceeded
      const contextErr = parseGeminiError(400, {
        error: { message: "Maximum context length exceeded (token limit)" },
      });
      expect(contextErr.kind).toBe(PAL_ERROR_KINDS.CONTEXT_EXCEEDED);
      expect(contextErr.retryable).toBe(false);

      // 401 / 403 Authentication Error
      const authErr = parseGeminiError(401, {
        error: { message: "API key not valid", status: "UNAUTHENTICATED" },
      });
      expect(authErr.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
      expect(authErr.retryable).toBe(false);

      const permErr = parseGeminiError(403, {
        error: { message: "Permission denied", status: "PERMISSION_DENIED" },
      });
      expect(permErr.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
      expect(permErr.retryable).toBe(false);

      // 408 / 504 Timeout
      const timeoutErr = parseGeminiError(408, {});
      expect(timeoutErr.kind).toBe(PAL_ERROR_KINDS.TIMEOUT);
      expect(timeoutErr.retryable).toBe(true);

      // 429 Rate Limit
      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("retry-after", "60");
      const rateLimitErr = parseGeminiError(
        429,
        { error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } },
        rateLimitHeaders
      );
      expect(rateLimitErr.kind).toBe(PAL_ERROR_KINDS.RATE_LIMIT);
      expect(rateLimitErr.retryable).toBe(true);
      expect(rateLimitErr.resetsAt).toBeDefined();

      // 503 Overloaded
      const serverErr = parseGeminiError(503, {
        error: { message: "Model is overloaded", status: "UNAVAILABLE" },
      });
      expect(serverErr.kind).toBe(PAL_ERROR_KINDS.OVERLOADED);
      expect(serverErr.retryable).toBe(true);
    });

    it("buildTurnPayload constructs valid Gemini request with systemPrompt and tools", () => {
      const adapter = new GeminiAdapter();
      const sessionOptions: PalSessionOptions = {
        sessionId: "gemini-session-1",
        systemPrompt: "You are an expert engineer.",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Hello Gemini")],
          }),
        ],
        temperature: 0.7,
        maxTokens: 4096,
        thinking: {
          enabled: true,
          budgetTokens: 2048,
        },
        tools: [
          {
            name: "test_tool",
            description: "Test tool description",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
            source: "native",
          },
        ],
        toolChoice: "auto",
      };

      const payload = adapter.buildTurnPayload(sessionOptions);
      expect(payload.contents).toBeDefined();
      expect(payload.systemInstruction).toEqual({
        parts: [{ text: "You are an expert engineer." }],
      });
      expect(payload.generationConfig).toEqual({
        temperature: 0.7,
        maxOutputTokens: 4096,
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      });
      expect(payload.tools).toBeDefined();
      expect(payload.toolConfig).toBeDefined();
    });

    describe("executeTurn Error Handling & Resiliency", () => {
      it("throws PalError with AUTH_FAILURE on 401 response", async () => {
        const mockFetch = (async () =>
          new Response(
            JSON.stringify({
              error: { message: "Invalid API key", status: "UNAUTHENTICATED" },
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            }
          )) as unknown as typeof fetch;

        const adapter = new GeminiAdapter({ fetchFn: mockFetch });
        const options: PalSessionOptions = {
          sessionId: "test-session",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("test prompt")],
            }),
          ],
        };

        expect(adapter.executeTurn(options)).rejects.toThrow(PalError);
        try {
          await adapter.executeTurn(options);
        } catch (err: unknown) {
          const palErr = err as PalError;
          expect(palErr.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
          expect(palErr.retryable).toBe(false);
        }
      });

      it("throws PalError with RATE_LIMIT on 429 response", async () => {
        const mockFetch = (async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "Resource exhausted",
                status: "RESOURCE_EXHAUSTED",
              },
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "retry-after": "45",
              },
            }
          )) as unknown as typeof fetch;

        const adapter = new GeminiAdapter({ fetchFn: mockFetch });
        const options: PalSessionOptions = {
          sessionId: "test-session",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("test prompt")],
            }),
          ],
        };

        try {
          await adapter.executeTurn(options);
          expect.unreachable();
        } catch (err: unknown) {
          const palErr = err as PalError;
          expect(palErr.kind).toBe(PAL_ERROR_KINDS.RATE_LIMIT);
          expect(palErr.retryable).toBe(true);
          expect(palErr.resetsAt).toBeDefined();
        }
      });

      it("throws PalError with TIMEOUT when request is aborted", async () => {
        const abortCtrl = new AbortController();
        const mockFetch = (async () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          throw err;
        }) as unknown as typeof fetch;

        const adapter = new GeminiAdapter({ fetchFn: mockFetch });
        const options: PalSessionOptions = {
          sessionId: "test-session",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("test prompt")],
            }),
          ],
          abortSignal: abortCtrl.signal,
        };

        abortCtrl.abort();
        try {
          await adapter.executeTurn(options);
          expect.unreachable();
        } catch (err: unknown) {
          const palErr = err as PalError;
          expect(palErr.kind).toBe(PAL_ERROR_KINDS.TIMEOUT);
          expect(palErr.retryable).toBe(true);
        }
      });

      it("executes successfully and parses canonical outcome with tool calls", async () => {
        const mockApiResponse = {
          candidates: [
            {
              content: {
                parts: [
                  { text: "I will check the files." },
                  {
                    functionCall: {
                      name: "list_directory",
                      args: { path: "/workspace/src" },
                    },
                  },
                ],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 120,
            candidatesTokenCount: 65,
            totalTokenCount: 185,
          },
        };

        const mockFetch = (async () =>
          new Response(JSON.stringify(mockApiResponse), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-ratelimit-remaining-requests": "995",
            },
          })) as unknown as typeof fetch;

        const adapter = new GeminiAdapter({ fetchFn: mockFetch });
        const outcome = await adapter.executeTurn({
          sessionId: "test-turn",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Please list files")],
            }),
          ],
        });

        expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
        expect(outcome.usage.promptTokens).toBe(120);
        expect(outcome.usage.completionTokens).toBe(65);
        expect(outcome.usage.totalTokens).toBe(185);
        expect(outcome.message.role).toBe(PAL_ROLES.ASSISTANT);
        expect(outcome.message.content).toHaveLength(2);

        const firstBlock = outcome.message.content[0];
        const secondBlock = outcome.message.content[1];

        expect(firstBlock?.type).toBe(PAL_CONTENT_BLOCK_TYPES.TEXT);
        expect(secondBlock?.type).toBe(PAL_CONTENT_BLOCK_TYPES.TOOL_CALL);

        if (secondBlock && isPalToolCallContent(secondBlock)) {
          expect(secondBlock.name).toBe("list_directory");
          expect(secondBlock.arguments).toEqual({ path: "/workspace/src" });
        }
      });
    });

    describe("streamTurn Streaming & Chunk Processing", () => {
      it("streams SSE chunks yielding text deltas, thoughts, tool calls, and turn_complete", async () => {
        const sseStreamLines = [
          'data: {"candidates": [{"content": {"parts": [{"thought": "Thinking..."}]}}]}\n\n',
          'data: {"candidates": [{"content": {"parts": [{"text": "Hello world"}]}}]}\n\n',
          'data: {"candidates": [{"content": {"parts": [{"functionCall": {"name": "Bash", "args": {"cmd": "ls"}}}]}}]}\n\n',
          'data: {"candidates": [{"finishReason": "STOP"}], "usageMetadata": {"promptTokenCount": 50, "candidatesTokenCount": 25, "totalTokenCount": 75}}\n\n',
          "data: [DONE]\n\n",
        ];

        const readableStream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            for (const line of sseStreamLines) {
              controller.enqueue(encoder.encode(line));
            }
            controller.close();
          },
        });

        const mockFetch = (async () =>
          new Response(readableStream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })) as unknown as typeof fetch;

        const adapter = new GeminiAdapter({ fetchFn: mockFetch });
        const events: PalStreamEvent[] = [];

        for await (const ev of adapter.streamTurn({
          sessionId: "stream-session",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Run stream")],
            }),
          ],
        })) {
          events.push(ev);
        }

        const thoughts = events.filter((e) => e.type === "thought_delta");
        const texts = events.filter((e) => e.type === "text_delta");
        const toolCalls = events.filter((e) => e.type === "tool_call_end");
        const turnCompletes = events.filter((e) => e.type === "turn_complete");

        expect(thoughts).toHaveLength(1);
        const firstThought = thoughts[0];
        if (firstThought && firstThought.type === "thought_delta") {
          expect(firstThought.thought).toBe("Thinking...");
        }

        expect(texts).toHaveLength(1);
        const firstText = texts[0];
        if (firstText && firstText.type === "text_delta") {
          expect(firstText.text).toBe("Hello world");
        }

        expect(toolCalls).toHaveLength(1);
        const firstToolCall = toolCalls[0];
        if (firstToolCall && firstToolCall.type === "tool_call_end") {
          expect(firstToolCall.name).toBe("Bash");
          expect(firstToolCall.arguments).toEqual({ cmd: "ls" });
        }

        expect(turnCompletes).toHaveLength(1);
        const firstTurnComplete = turnCompletes[0];
        if (firstTurnComplete && firstTurnComplete.type === "turn_complete") {
          expect(firstTurnComplete.finishReason).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
          expect(firstTurnComplete.usage.promptTokens).toBe(50);
          expect(firstTurnComplete.usage.completionTokens).toBe(25);
          expect(firstTurnComplete.usage.totalTokens).toBe(75);
        }
      });

      it("parses Antigravity NDJSON events correctly", async () => {
        const ndjsonLines = [
          '{"type": "init", "conversation_id": "conv-test-99"}\n',
          '{"type": "step_update", "delta": {"thought": "Analyzing repository..."}}\n',
          '{"type": "step_update", "delta": {"text": "All checks pass."}}\n',
          '{"type": "step_update", "delta": {"tool_calls": [{"name": "Edit", "args": {"fields": {"path": {"stringValue": "main.ts"}}}}]}}\n',
          '{"type": "result", "status": "SUCCESS", "usage": {"input_tokens": 200, "output_tokens": 100}}\n',
        ];

        const parser = new GeminiStreamChunkParser();
        const events: PalStreamEvent[] = [];

        for (const line of ndjsonLines) {
          const parsed = parseGeminiStreamChunk(line, parser);
          events.push(...parsed);
        }

        const msg = parser.toMessage("custom-id");
        expect(msg.id).toBe("custom-id");
        expect(msg.role).toBe(PAL_ROLES.ASSISTANT);
        expect(msg.content).toHaveLength(3);

        const block0 = msg.content[0];
        const block1 = msg.content[1];
        const block2 = msg.content[2];

        expect(block0 && isPalThoughtContent(block0)).toBe(true);
        expect(block1 && isPalTextContent(block1)).toBe(true);
        expect(block2 && isPalToolCallContent(block2)).toBe(true);

        if (block2 && isPalToolCallContent(block2)) {
          expect(block2.name).toBe("Edit");
          expect(block2.arguments).toEqual({ path: "main.ts" });
        }

        expect(parser.isCompleted()).toBe(true);
        expect(parser.getFinishReason()).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
        expect(parser.getAccumulatedUsage().promptTokens).toBe(200);
        expect(parser.getAccumulatedUsage().completionTokens).toBe(100);
      });

      it("toAsyncIterable handles arrays and iterables properly", async () => {
        const items = ["chunk1", "chunk2", "chunk3"];
        const collected: string[] = [];

        for await (const chunk of toAsyncIterable(items)) {
          collected.push(chunk);
        }

        expect(collected).toEqual(["chunk1", "chunk2", "chunk3"]);
      });

      it("parseGeminiStream generator yields events from stream", async () => {
        const stream = ['{"candidates": [{"content": {"parts": [{"text": "Stream test"}]}}]}\n'];
        const events: PalStreamEvent[] = [];

        for await (const ev of parseGeminiStream(stream)) {
          events.push(ev);
        }

        expect(events.some((e) => e.type === "text_delta")).toBe(true);
        expect(events.some((e) => e.type === "turn_complete")).toBe(true);
      });
    });
  });

  describe("NDJSON Streaming Reducer & Protobuf Struct Mapping (Task 1.2)", () => {
    describe("Protobuf Struct Mapping & Schema Serialization", () => {
      it("Scenario: Tool parameters arrive as protobuf structs -> serializes them into standard JSON structures", () => {
        const protobufStructPayload = {
          fields: {
            command: { stringValue: "bun test" },
            timeout: { numberValue: 30000 },
            isDaemon: { boolValue: false },
            nullOption: { nullValue: 0 },
            flags: {
              listValue: {
                values: [
                  { stringValue: "--coverage" },
                  { stringValue: "--verbose" },
                ],
              },
            },
            nestedConfig: {
              structValue: {
                fields: {
                  env: { stringValue: "test" },
                  retries: { numberValue: 3 },
                },
              },
            },
          },
        };

        const json = convertProtobufStructToJson(protobufStructPayload);

        expect(json).toEqual({
          command: "bun test",
          timeout: 30000,
          isDaemon: false,
          nullOption: null,
          flags: ["--coverage", "--verbose"],
          nestedConfig: {
            env: "test",
            retries: 3,
          },
        });
      });

      it("handles nullValue variants (0, 'NULL_VALUE', null)", () => {
        expect(convertProtobufStructToJson({ nullValue: 0 })).toBeNull();
        expect(convertProtobufStructToJson({ nullValue: "NULL_VALUE" })).toBeNull();
        expect(convertProtobufStructToJson({ nullValue: null })).toBeNull();
      });

      it("handles listValue as an array or with values property", () => {
        const listWithValues = {
          listValue: {
            values: [{ stringValue: "item1" }, { numberValue: 42 }],
          },
        };
        expect(convertProtobufStructToJson(listWithValues)).toEqual(["item1", 42]);

        const listDirectArray = {
          listValue: [{ stringValue: "itemA" }, { boolValue: true }],
        };
        expect(convertProtobufStructToJson(listDirectArray)).toEqual(["itemA", true]);
      });

      it("handles structValue without fields property cleanly", () => {
        const structDirect = {
          structValue: {
            subKey: { stringValue: "subVal" },
          },
        };
        expect(convertProtobufStructToJson(structDirect)).toEqual({ subKey: "subVal" });
      });

      it("handles ts-proto / protobufjs kind representation", () => {
        const tsProtoPayload = {
          kind: {
            case: "stringValue",
            value: "ts-proto-value",
          },
        };
        expect(convertProtobufStructToJson(tsProtoPayload)).toBe("ts-proto-value");

        const tsProtoNull = {
          kind: {
            case: "nullValue",
          },
        };
        expect(convertProtobufStructToJson(tsProtoNull)).toBeNull();
      });

      it("safely passes through primitives and plain records without mutation", () => {
        expect(convertProtobufStructToJson(null)).toBeNull();
        expect(convertProtobufStructToJson(undefined)).toBeUndefined();
        expect(convertProtobufStructToJson("plain string")).toBe("plain string");
        expect(convertProtobufStructToJson(12345)).toBe(12345);
        expect(convertProtobufStructToJson(true)).toBe(true);

        const plainObj = { path: "src/index.ts", line: 10 };
        expect(convertProtobufStructToJson(plainObj)).toEqual({ path: "src/index.ts", line: 10 });
      });

      it("converts JSON to Protobuf Struct with convertJsonToProtobufStruct and verifies round-trip", () => {
        const sourceJson = {
          appName: "looper",
          maxWorkers: 4,
          enabled: true,
          tags: ["core", "pal"],
          options: {
            cache: true,
            ttl: 60,
          },
        };

        const protobufStruct = convertJsonToProtobufStruct(sourceJson);
        expect(isProtobufStruct(protobufStruct)).toBe(true);

        const appNameField = protobufStruct.fields.appName;
        expect(appNameField && "stringValue" in appNameField ? appNameField.stringValue : undefined).toBe("looper");

        const workersField = protobufStruct.fields.maxWorkers;
        expect(workersField && "numberValue" in workersField ? workersField.numberValue : undefined).toBe(4);

        const enabledField = protobufStruct.fields.enabled;
        expect(enabledField && "boolValue" in enabledField ? enabledField.boolValue : undefined).toBe(true);

        const tagsField = protobufStruct.fields.tags;
        expect(tagsField && "listValue" in tagsField ? tagsField.listValue.values : undefined).toHaveLength(2);

        const backToJson = convertProtobufStructToJson(protobufStruct);
        expect(backToJson).toEqual(sourceJson);
      });

      it("converts individual JSON values with convertJsonToProtobufValue", () => {
        expect(convertJsonToProtobufValue(null)).toEqual({ nullValue: 0 });
        expect(convertJsonToProtobufValue(undefined)).toEqual({ nullValue: 0 });
        expect(convertJsonToProtobufValue("text")).toEqual({ stringValue: "text" });
        expect(convertJsonToProtobufValue(99)).toEqual({ numberValue: 99 });
        expect(convertJsonToProtobufValue(false)).toEqual({ boolValue: false });
        expect(convertJsonToProtobufValue(["x"])).toEqual({
          listValue: { values: [{ stringValue: "x" }] },
        });

        const val = convertJsonToProtobufValue("test");
        expect(isProtobufValue(val)).toBe(true);
      });

      it("formatGeminiResponse wraps primitive values, arrays, and errors into Protobuf-compatible Struct records", () => {
        expect(formatGeminiResponse("Simple output", false)).toEqual({ output: "Simple output" });
        expect(formatGeminiResponse("Error occurred", true)).toEqual({ error: "Error occurred" });

        const blocks = [createTextBlock("Line 1"), createTextBlock("Line 2")];
        expect(formatGeminiResponse(blocks, false)).toEqual({ output: "Line 1\nLine 2" });

        const recordOutput = { filesScanned: 5, status: "OK" };
        expect(formatGeminiResponse(recordOutput as unknown as string, false)).toEqual(recordOutput);

        const recordError = { code: 404, message: "File not found" };
        expect(formatGeminiResponse(recordError as unknown as string, true)).toEqual({ error: recordError });
      });

      it("formatToolInput enriches tool parameters and converts protobuf structs", () => {
        const toolInfoWithProtobuf = {
          name: "Edit",
          parameters: {
            fields: {
              Path: { stringValue: "src/pal/adapters/gemini.ts" },
              CommandLine: { stringValue: "bun run check" },
            },
          },
        };

        const enriched = formatToolInput(toolInfoWithProtobuf);
        expect(enriched).toBeDefined();
        expect(enriched?.path).toBe("src/pal/adapters/gemini.ts");
        expect(enriched?.cmd).toBe("bun run check");

        expect(formatToolInput(null)).toBeUndefined();
        expect(formatToolInput("invalid")).toBeUndefined();
      });

      it("describeToolInput formats concise one-line descriptions with truncation", () => {
        const cmdInput = { cmd: "git commit -m 'feat: update adapter'", args: ["--no-verify"] };
        expect(describeToolInput(cmdInput)).toContain("git commit -m 'feat: update adapter' --no-verify");

        const pathInput = { path: "src/pal/adapters/gemini.ts" };
        expect(describeToolInput(pathInput)).toBe("src/pal/adapters/gemini.ts");

        const patternInput = { pattern: "function convertProtobufStructToJson" };
        expect(describeToolInput(patternInput)).toBe("function convertProtobufStructToJson");

        expect(describeToolInput(null)).toBe("");
        expect(describeToolInput("simple string")).toBe("simple string");

        const longText = "a".repeat(200);
        expect(describeToolInput(longText, 50).length).toBeLessThanOrEqual(50);
        expect(oneLine("hello\n\tworld")).toBe("hello world");
      });
    });

    describe("NDJSON Streaming Reducer (reduceGeminiNdjsonEvent & GeminiNdjsonStreamReducer)", () => {
      it("creates initial clean state with createInitialNdjsonReducerState", () => {
        const state = createInitialNdjsonReducerState("sess-100");
        expect(state.conversationId).toBe("sess-100");
        expect(state.texts).toHaveLength(0);
        expect(state.thoughts).toHaveLength(0);
        expect(state.toolCalls).toHaveLength(0);
        expect(state.contentBlocks).toHaveLength(0);
        expect(state.usage.totalTokens).toBe(0);
        expect(state.finishReason).toBe(PAL_FINISH_REASONS.STOP);
        expect(state.hasToolCalls).toBe(false);
        expect(state.isCompleted).toBe(false);
      });

      it("folds init event and captures conversation_id", () => {
        const state = createInitialNdjsonReducerState();
        const events = reduceGeminiNdjsonEvent(
          state,
          '{"event": "init", "conversation_id": "conv-ndjson-001"}'
        );

        expect(events).toHaveLength(0);
        expect(state.conversationId).toBe("conv-ndjson-001");
      });

      it("folds step_update with agent_response (text_delta and thought_delta)", () => {
        const state = createInitialNdjsonReducerState();
        const textEvents = reduceGeminiNdjsonEvent(state, {
          event: "step_update",
          step_update: {
            step_type: "agent_response",
            text_delta: "Analyzing requirements...",
          },
        });

        expect(textEvents).toHaveLength(1);
        expect(textEvents[0]?.type).toBe("text_delta");
        expect(state.texts).toEqual(["Analyzing requirements..."]);

        const thoughtEvents = reduceGeminiNdjsonEvent(state, {
          event: "step_update",
          step_update: {
            step_type: "agent_response",
            thought_delta: "Thinking through edge cases...",
          },
        });

        expect(thoughtEvents).toHaveLength(1);
        expect(thoughtEvents[0]?.type).toBe("thought_delta");
        expect(state.thoughts).toEqual(["Thinking through edge cases..."]);
      });

      it("folds step_update with tool invocation and Protobuf Struct parameters", () => {
        const state = createInitialNdjsonReducerState();
        const toolEvents = reduceGeminiNdjsonEvent(state, {
          event: "step_update",
          step_update: {
            step_type: "tool",
            state: "ACTIVE",
            tool_name: "Bash",
            tool_call_id: "call-001",
            tool_info: {
              name: "Bash",
              parameters: {
                fields: {
                  CommandLine: { stringValue: "bun test test/pal/gemini.test.ts" },
                },
              },
            },
            usage: {
              input_tokens: 350,
              output_tokens: 120,
              thinking_tokens: 45,
            },
          },
        });

        expect(toolEvents).toHaveLength(2);
        expect(toolEvents[0]?.type).toBe("tool_call_delta");
        expect(toolEvents[1]?.type).toBe("tool_call_end");

        const endEvent = toolEvents[1];
        if (endEvent && endEvent.type === "tool_call_end") {
          expect(endEvent.name).toBe("Bash");
          expect(endEvent.id).toBe("call-001");
          expect(endEvent.arguments).toEqual({
            CommandLine: "bun test test/pal/gemini.test.ts",
            cmd: "bun test test/pal/gemini.test.ts",
          });
        }

        expect(state.hasToolCalls).toBe(true);
        expect(state.toolCalls).toHaveLength(1);
        expect(state.usage.promptTokens).toBe(350);
        expect(state.usage.completionTokens).toBe(120);
        expect(state.usage.thinkingTokens).toBe(45);
        expect(state.usage.totalTokens).toBe(470);
      });

      it("folds result event with SUCCESS status and emits turn_complete with TOOL_CALLS", () => {
        const state = createInitialNdjsonReducerState();
        state.hasToolCalls = true;

        const resultEvents = reduceGeminiNdjsonEvent(state, {
          event: "result",
          result: {
            status: "SUCCESS",
            conversation_id: "conv-result-01",
            usage: {
              input_tokens: 500,
              output_tokens: 200,
              cache_read_tokens: 100,
            },
          },
        });

        expect(resultEvents).toHaveLength(1);
        const completeEvent = resultEvents[0];
        expect(completeEvent?.type).toBe("turn_complete");
        if (completeEvent && completeEvent.type === "turn_complete") {
          expect(completeEvent.finishReason).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
          expect(completeEvent.usage.promptTokens).toBe(500);
          expect(completeEvent.usage.completionTokens).toBe(200);
          expect(completeEvent.usage.cachedPromptTokens).toBe(100);
        }

        expect(state.isCompleted).toBe(true);
      });

      it("folds result event with non-SUCCESS status and sets error and ERROR finishReason", () => {
        const state = createInitialNdjsonReducerState();
        const resultEvents = reduceGeminiNdjsonEvent(state, {
          event: "result",
          result: {
            status: "FAILED",
            error: "Process timed out after 60s",
          },
        });

        expect(resultEvents).toHaveLength(1);
        const completeEvent = resultEvents[0];
        if (completeEvent && completeEvent.type === "turn_complete") {
          expect(completeEvent.finishReason).toBe(PAL_FINISH_REASONS.ERROR);
        }
        expect(state.error).toBe("Process timed out after 60s");
        expect(state.finishReason).toBe(PAL_FINISH_REASONS.ERROR);
      });

      it("folds error event cleanly", () => {
        const state = createInitialNdjsonReducerState();
        const errorEvents = reduceGeminiNdjsonEvent(state, {
          event: "error",
          error: "Unrecoverable model failure",
        });

        expect(errorEvents).toHaveLength(1);
        expect(errorEvents[0]?.type).toBe("turn_complete");
        expect(state.error).toBe("Unrecoverable model failure");
        expect(state.finishReason).toBe(PAL_FINISH_REASONS.ERROR);
        expect(state.isCompleted).toBe(true);
      });

      it("ignores non-JSON CLI banners, blank lines, and comments tolerantly", () => {
        const state = createInitialNdjsonReducerState();
        expect(reduceGeminiNdjsonEvent(state, "")).toHaveLength(0);
        expect(reduceGeminiNdjsonEvent(state, "   \n")).toHaveLength(0);
        expect(reduceGeminiNdjsonEvent(state, "# Agy CLI banner v2.0")).toHaveLength(0);
        expect(reduceGeminiNdjsonEvent(state, "// Internal debug info")).toHaveLength(0);
        expect(reduceGeminiNdjsonEvent(state, ": keep-alive comment")).toHaveLength(0);
        expect(reduceGeminiNdjsonEvent(state, "[INFO] Initializing workspace...")).toHaveLength(0);
        expect(reduceGeminiNdjsonEvent(state, "{ malformed json line")).toHaveLength(0);
      });

      it("assembles canonical PalMessage from reducer state with ndjsonStateToPalMessage", () => {
        const state = createInitialNdjsonReducerState("sess-msg");
        reduceGeminiNdjsonEvent(state, {
          event: "step_update",
          step_update: {
            step_type: "agent_response",
            thought_delta: "Thinking block",
          },
        });
        reduceGeminiNdjsonEvent(state, {
          event: "step_update",
          step_update: {
            step_type: "agent_response",
            text_delta: "Text block",
          },
        });
        reduceGeminiNdjsonEvent(state, {
          event: "step_update",
          step_update: {
            step_type: "tool",
            tool_name: "Read",
            tool_call_id: "read-1",
            tool_info: { path: "file.txt" },
          },
        });

        const msg = ndjsonStateToPalMessage(state, "msg-001");
        expect(msg.id).toBe("msg-001");
        expect(msg.role).toBe(PAL_ROLES.ASSISTANT);
        expect(msg.content).toHaveLength(3);
        expect(isPalThoughtContent(msg.content[0]!)).toBe(true);
        expect(isPalTextContent(msg.content[1]!)).toBe(true);
        expect(isPalToolCallContent(msg.content[2]!)).toBe(true);
      });

      it("GeminiNdjsonStreamReducer handles multi-chunk streams and chunk boundary splits", () => {
        const reducer = new GeminiNdjsonStreamReducer({ initialSessionId: "stream-sess" });

        // Split JSON line across two chunks
        const chunkPart1 = '{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Part';
        const chunkPart2 = ' 1 and Part 2"}}\n';

        const ev1 = reducer.feed(chunkPart1);
        expect(ev1).toHaveLength(0); // line incomplete

        const ev2 = reducer.feed(chunkPart2);
        expect(ev2).toHaveLength(1);
        expect(ev2[0]?.type).toBe("text_delta");
        if (ev2[0]?.type === "text_delta") {
          expect(ev2[0].text).toBe("Part 1 and Part 2");
        }

        // Uint8Array chunk
        const encoder = new TextEncoder();
        const binaryChunk = encoder.encode('{"event": "result", "result": {"status": "SUCCESS"}}\n');
        const ev3 = reducer.feed(binaryChunk);
        expect(ev3.some((e) => e.type === "turn_complete")).toBe(true);

        expect(reducer.isCompleted()).toBe(true);
        expect(reducer.getConversationId()).toBe("stream-sess");

        const msg = reducer.toMessage("final-msg");
        expect(msg.content).toHaveLength(1);
      });

      it("GeminiNdjsonStreamReducer flush completes stream if not already completed", () => {
        const reducer = new GeminiNdjsonStreamReducer();
        reducer.feed('{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Hello"}}\n');

        expect(reducer.isCompleted()).toBe(false);
        const flushed = reducer.flush();
        expect(flushed.some((e) => e.type === "turn_complete")).toBe(true);
        expect(reducer.isCompleted()).toBe(true);
      });

      it("reduceNdjsonStream async generator yields all stream events", async () => {
        const streamChunks = [
          '{"event": "init", "conversation_id": "gen-conv"}\n',
          '{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Yielded text"}}\n',
          '{"event": "result", "result": {"status": "SUCCESS"}}\n',
        ];

        const collected: PalStreamEvent[] = [];
        for await (const ev of reduceNdjsonStream(streamChunks)) {
          collected.push(ev);
        }

        expect(collected.some((e) => e.type === "text_delta")).toBe(true);
        expect(collected.some((e) => e.type === "turn_complete")).toBe(true);
      });

      it("reduceNdjsonEvent functional alias works interchangeably", () => {
        const state = createInitialNdjsonReducerState();
        const evs = reduceNdjsonEvent(state, {
          type: "step_update",
          delta: { text: "Alias test" },
        });

        expect(evs).toHaveLength(1);
        expect(state.texts).toEqual(["Alias test"]);
      });
    });
  });

  describe("Antigravity CLI Subprocessing with --dangerously-skip-permissions (Task 1.3)", () => {
    describe("buildAntigravityCliArgs & buildAntigravityArgs Argument Construction", () => {
      it("constructs base argument array with required flags including --dangerously-skip-permissions", () => {
        const argv = buildAntigravityCliArgs({
          prompt: "run semantic analysis",
          model: "gemini-2.5-pro",
        });

        expect(argv).toEqual([
          "agy",
          "-p",
          "run semantic analysis",
          "--output-format",
          "stream-json",
          "--dangerously-skip-permissions",
          "--model",
          "gemini-2.5-pro",
        ]);
      });

      it("defaults dangerouslySkipPermissions to true when omitted", () => {
        const argv = buildAntigravityCliArgs({
          prompt: "test default permission bypass",
        });
        expect(argv).toContain("--dangerously-skip-permissions");
      });

      it("omits --dangerously-skip-permissions when explicitly set to false", () => {
        const argv = buildAntigravityCliArgs({
          prompt: "safe mode execution",
          dangerouslySkipPermissions: false,
        });
        expect(argv).not.toContain("--dangerously-skip-permissions");
        expect(argv).toEqual([
          "agy",
          "-p",
          "safe mode execution",
          "--output-format",
          "stream-json",
          "--model",
          GEMINI_ADAPTER_CONSTANTS.DEFAULT_MODEL,
        ]);
      });

      it("includes --dangerously-skip-permissions when explicitly set to true", () => {
        const argv = buildAntigravityCliArgs({
          prompt: "explicit bypass",
          dangerouslySkipPermissions: true,
        });
        expect(argv).toContain("--dangerously-skip-permissions");
      });

      it("includes --effort flag when reasoning effort is provided", () => {
        const argv = buildAntigravityCliArgs({
          prompt: "deep thinking task",
          effort: "high",
        });
        expect(argv).toContain("--effort");
        expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
      });

      it("omits --effort flag when effort is none or undefined", () => {
        const argvNone = buildAntigravityCliArgs({
          prompt: "no thinking effort",
          effort: "none",
        });
        expect(argvNone).not.toContain("--effort");

        const argvUndef = buildAntigravityCliArgs({
          prompt: "no effort specified",
        });
        expect(argvUndef).not.toContain("--effort");
      });

      it("includes --conversation flag when conversationId or resume is specified", () => {
        const argvWithId = buildAntigravityCliArgs({
          prompt: "resumed task",
          conversationId: "conv-session-1234",
        });
        expect(argvWithId).toContain("--conversation");
        expect(argvWithId[argvWithId.indexOf("--conversation") + 1]).toBe(
          "conv-session-1234"
        );

        const argvWithResume = buildAntigravityCliArgs({
          prompt: "resume alias task",
          resume: "conv-alias-5678",
        });
        expect(argvWithResume).toContain("--conversation");
        expect(argvWithResume[argvWithResume.indexOf("--conversation") + 1]).toBe(
          "conv-alias-5678"
        );
      });

      it("buildAntigravityArgs alias functions identically to buildAntigravityCliArgs", () => {
        const options: AntigravityCliArgsOptions = {
          prompt: "alias check",
          model: "gemini-2.0-flash",
          effort: "medium",
          conversationId: "conv-test",
          dangerouslySkipPermissions: true,
        };
        expect(buildAntigravityArgs(options)).toEqual(
          buildAntigravityCliArgs(options)
        );
      });
    });

    describe("CLI Parameter and Cost Helpers", () => {
      it("antigravityModelArg selects provided model or falls back to default", () => {
        expect(antigravityModelArg(undefined)).toBe(
          GEMINI_ADAPTER_CONSTANTS.DEFAULT_MODEL
        );
        expect(antigravityModelArg("")).toBe(
          GEMINI_ADAPTER_CONSTANTS.DEFAULT_MODEL
        );
        expect(antigravityModelArg("   ")).toBe(
          GEMINI_ADAPTER_CONSTANTS.DEFAULT_MODEL
        );
        expect(antigravityModelArg("gemini-2.0-flash-exp")).toBe(
          "gemini-2.0-flash-exp"
        );
      });

      it("antigravityEffortArg formats reasoning effort correctly", () => {
        expect(antigravityEffortArg("high")).toBe("high");
        expect(antigravityEffortArg("max")).toBe("max");
        expect(antigravityEffortArg("low")).toBe("low");
        expect(antigravityEffortArg(undefined)).toBeUndefined();
        expect(antigravityEffortArg("none")).toBeUndefined();
        expect(antigravityEffortArg("")).toBeUndefined();
      });

      it("estimateGeminiCostUsd and estimateCostUsd estimate costs accurately", () => {
        const flashUsage = {
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens: 2_000_000,
        };
        const flashCost = estimateGeminiCostUsd(
          "gemini-2.0-flash",
          flashUsage
        );
        expect(flashCost).toBeCloseTo(0.15 + 0.6);

        const proUsage = {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        };
        const proCost = estimateCostUsd("gemini-2.5-pro", proUsage);
        expect(proCost).toBeCloseTo(1.25 + 5.0);

        expect(estimateCostUsd("unknown-vendor-model", proUsage)).toBe(0);
      });

      it("classifyAntigravityFailure and classifyFailure categorize failure messages", () => {
        expect(
          classifyAntigravityFailure("Rate limit exceeded. HTTP 429")
        ).toBe("paused");
        expect(
          classifyAntigravityFailure("Resource exhausted: quota exceeded")
        ).toBe("paused");
        expect(
          classifyAntigravityFailure("401 Unauthorized: invalid credential")
        ).toBe("fatal");
        expect(
          classifyAntigravityFailure("no such file or directory: agy")
        ).toBe("fatal");
        expect(
          classifyAntigravityFailure("Syntax error in generated script")
        ).toBe("error");

        expect(classifyFailure("429 Too Many Requests")).toBe("paused");
        expect(classifyFailure("Authentication failed")).toBe("fatal");
        expect(classifyFailure("General failure")).toBe("error");
      });

      it("formatSessionPromptForCli extracts clean prompt from single or multi-turn sessions", () => {
        const singleSession: PalSessionOptions = {
          sessionId: "session-1",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Analyze project repository")],
            }),
          ],
        };
        expect(formatSessionPromptForCli(singleSession)).toBe(
          "Analyze project repository"
        );

        const multiSession: PalSessionOptions = {
          sessionId: "session-2",
          systemPrompt: "You are an expert software engineer.",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("What is the architecture?")],
            }),
            createPalMessage({
              role: PAL_ROLES.ASSISTANT,
              content: [createTextBlock("It uses Clean Hexagonal architecture.")],
            }),
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Implement GeminiAdapter.")],
            }),
          ],
        };
        const formatted = formatSessionPromptForCli(multiSession);
        expect(formatted).toContain("You are an expert software engineer.");
        expect(formatted).toContain("[user]: What is the architecture?");
        expect(formatted).toContain(
          "[assistant]: It uses Clean Hexagonal architecture."
        );
        expect(formatted).toContain("[user]: Implement GeminiAdapter.");
      });
    });

    describe("GeminiAdapter Subprocess & CLI Integration", () => {
      it("exports AntigravityAdapter and AntigravityPalAdapter aliases", () => {
        expect(AntigravityAdapter).toBe(GeminiAdapter);
        expect(AntigravityPalAdapter).toBe(GeminiAdapter);
      });

      it("manages executionMode and isCliMode status", () => {
        const adapter = new GeminiAdapter();
        expect(adapter.getExecutionMode()).toBe("api");
        expect(adapter.isCliMode()).toBe(false);

        adapter.setExecutionMode("cli");
        expect(adapter.getExecutionMode()).toBe("cli");
        expect(adapter.isCliMode()).toBe(true);

        const cliAdapter = new GeminiAdapter({ executionMode: "cli" });
        expect(cliAdapter.getExecutionMode()).toBe("cli");
        expect(cliAdapter.isCliMode()).toBe(true);
      });

      it("adapter buildCliArgs inherits configured model and dangerouslySkipPermissions", () => {
        const defaultAdapter = new GeminiAdapter({
          modelName: "gemini-2.5-pro",
        });
        const defaultArgs = defaultAdapter.buildCliArgs({
          prompt: "test adapter prompt",
        });
        expect(defaultArgs).toContain("--model");
        expect(defaultArgs).toContain("gemini-2.5-pro");
        expect(defaultArgs).not.toContain("--dangerously-skip-permissions");

        const skipAdapter = new GeminiAdapter({
          dangerouslySkipPermissions: true,
        });
        const skipArgs = skipAdapter.buildCliArgs({
          prompt: "test bypass prompt",
        });
        expect(skipArgs).toContain("--dangerously-skip-permissions");

        const cliModeAdapter = new GeminiAdapter({
          executionMode: "cli",
        });
        const cliArgs = cliModeAdapter.buildCliArgs({
          prompt: "cli mode default bypass",
        });
        expect(cliArgs).toContain("--dangerously-skip-permissions");

        // Explicit override in options takes precedence
        const disabledArgs = cliModeAdapter.buildCliArgs({
          prompt: "explicitly disabled",
          dangerouslySkipPermissions: false,
        });
        expect(disabledArgs).not.toContain("--dangerously-skip-permissions");
      });
    });

    describe("Subprocess Execution with Mocked Spawning", () => {
      it("streamAntigravitySubprocess streams events and enforces --dangerously-skip-permissions", async () => {
        let capturedArgv: string[] = [];
        let capturedCwd: string = "";

        const mockLines = [
          '{"event": "init", "conversation_id": "conv-sub-1"}\n',
          '{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Working on "}}\n',
          '{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "the task."}}\n',
          '{"event": "step_update", "step_update": {"step_type": "tool", "state": "ACTIVE", "tool_name": "run_command", "tool_info": {"cmd": "bun test"}}}\n',
          '{"event": "result", "result": {"status": "SUCCESS", "usage": {"input_tokens": 120, "output_tokens": 45}}}\n',
        ];

        const mockSpawn: AntigravitySubprocessSpawnFn = (argv, options) => {
          capturedArgv = [...argv];
          capturedCwd = options.cwd;

          async function* generateChunks() {
            for (const line of mockLines) {
              yield new TextEncoder().encode(line);
            }
          }

          return {
            stdout: generateChunks(),
            stderr: null,
            exited: Promise.resolve(0),
            kill: () => {},
          };
        };

        const events: PalStreamEvent[] = [];
        const streamedText: string[] = [];

        for await (const ev of streamAntigravitySubprocess(
          {
            prompt: "execute subprocessing task",
            dangerouslySkipPermissions: true,
            cwd: "/workspace/project",
            onText: (text) => streamedText.push(text),
          },
          { spawnFn: mockSpawn }
        )) {
          events.push(ev);
        }

        expect(capturedArgv).toContain("--dangerously-skip-permissions");
        expect(capturedArgv).toContain("execute subprocessing task");
        expect(capturedCwd).toBe("/workspace/project");

        expect(streamedText).toEqual(["Working on ", "the task."]);
        expect(events.some((e) => e.type === "text_delta")).toBe(true);
        expect(events.some((e) => e.type === "tool_call_end")).toBe(true);
        expect(events.some((e) => e.type === "turn_complete")).toBe(true);

        const completeEv = events.find(
          (e): e is Extract<PalStreamEvent, { type: "turn_complete" }> =>
            e.type === "turn_complete"
        );
        expect(completeEv?.usage.promptTokens).toBe(120);
        expect(completeEv?.usage.completionTokens).toBe(45);
      });

      it("runAntigravitySubprocess executes to completion and returns canonical PalOutcome", async () => {
        const mockSpawn: AntigravitySubprocessSpawnFn = (argv) => {
          expect(argv).toContain("--dangerously-skip-permissions");

          async function* generateChunks() {
            yield new TextEncoder().encode(
              '{"event": "init", "conversation_id": "conv-run-outcome"}\n'
            );
            yield new TextEncoder().encode(
              '{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Subprocess outcome ready."}}\n'
            );
            yield new TextEncoder().encode(
              '{"event": "result", "result": {"status": "SUCCESS", "usage": {"input_tokens": 200, "output_tokens": 80}}}\n'
            );
          }

          return {
            stdout: generateChunks(),
            stderr: null,
            exited: Promise.resolve(0),
            kill: () => {},
          };
        };

        const outcome = await runAntigravitySubprocess(
          {
            prompt: "run outcome prompt",
            dangerouslySkipPermissions: true,
          },
          { spawnFn: mockSpawn }
        );

        expect(outcome.message.role).toBe(PAL_ROLES.ASSISTANT);
        const textBlock = outcome.message.content.find(isPalTextContent);
        expect(textBlock?.text).toBe("Subprocess outcome ready.");
        expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.STOP);
        expect(outcome.usage.promptTokens).toBe(200);
        expect(outcome.usage.completionTokens).toBe(80);
      });

      it("handles non-zero exit codes and classifies failure into PalError", async () => {
        const mockFatalSpawn: AntigravitySubprocessSpawnFn = () => {
          async function* generateStderr() {
            yield new TextEncoder().encode(
              "401 Unauthorized: Invalid API credential for agy"
            );
          }

          return {
            stdout: null,
            stderr: generateStderr(),
            exited: Promise.resolve(1),
            kill: () => {},
          };
        };

        const events: PalStreamEvent[] = [];
        for await (const ev of streamAntigravitySubprocess(
          { prompt: "failing auth prompt" },
          { spawnFn: mockFatalSpawn }
        )) {
          events.push(ev);
        }

        const errorEv = events.find(
          (e): e is Extract<PalStreamEvent, { type: "error" }> =>
            e.type === "error"
        );
        expect(errorEv).toBeDefined();
        expect(errorEv?.error.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
        expect(errorEv?.error.retryable).toBe(false);

        // runAntigravitySubprocess throws the PalError
        await expect(
          runAntigravitySubprocess(
            { prompt: "failing auth prompt" },
            { spawnFn: mockFatalSpawn }
          )
        ).rejects.toThrow(PalError);
      });

      it("handles rate limit failures and marks error as retryable", async () => {
        const mockRateLimitSpawn: AntigravitySubprocessSpawnFn = () => {
          async function* generateStderr() {
            yield new TextEncoder().encode(
              "Resource exhausted: 429 Too many requests"
            );
          }

          return {
            stdout: null,
            stderr: generateStderr(),
            exited: Promise.resolve(1),
            kill: () => {},
          };
        };

        const events: PalStreamEvent[] = [];
        for await (const ev of streamAntigravitySubprocess(
          { prompt: "rate limited prompt" },
          { spawnFn: mockRateLimitSpawn }
        )) {
          events.push(ev);
        }

        const errorEv = events.find(
          (e): e is Extract<PalStreamEvent, { type: "error" }> =>
            e.type === "error"
        );
        expect(errorEv?.error.kind).toBe(PAL_ERROR_KINDS.RATE_LIMIT);
        expect(errorEv?.error.retryable).toBe(true);
      });

      it("handles abort signals and kills subprocess with SIGTERM", async () => {
        let killedSignal: string | number | undefined;

        const mockHangingSpawn: AntigravitySubprocessSpawnFn = () => {
          async function* generateSlowStdout() {
            await new Promise((resolve) => setTimeout(resolve, 50));
            yield new TextEncoder().encode(
              '{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "slow"}}\n'
            );
          }

          return {
            stdout: generateSlowStdout(),
            stderr: null,
            exited: new Promise((resolve) => setTimeout(() => resolve(0), 100)),
            kill: (sig) => {
              killedSignal = sig;
            },
          };
        };

        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10);

        const events: PalStreamEvent[] = [];
        for await (const ev of streamAntigravitySubprocess(
          {
            prompt: "abort test prompt",
            abortSignal: controller.signal,
          },
          { spawnFn: mockHangingSpawn }
        )) {
          events.push(ev);
        }

        expect(killedSignal).toBe("SIGTERM");
        const errorEv = events.find(
          (e): e is Extract<PalStreamEvent, { type: "error" }> =>
            e.type === "error"
        );
        expect(errorEv?.error.kind).toBe(PAL_ERROR_KINDS.TIMEOUT);
      });

      it("GeminiAdapter in cli mode delegates executeTurn and streamTurn to subprocess runner", async () => {
        let spawnedWithBypass = false;

        const mockSpawn: AntigravitySubprocessSpawnFn = (argv) => {
          spawnedWithBypass = argv.includes("--dangerously-skip-permissions");

          async function* generateChunks() {
            yield new TextEncoder().encode(
              '{"event": "init", "conversation_id": "adapter-cli-conv"}\n'
            );
            yield new TextEncoder().encode(
              '{"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Delegated to CLI."}}\n'
            );
            yield new TextEncoder().encode(
              '{"event": "result", "result": {"status": "SUCCESS"}}\n'
            );
          }

          return {
            stdout: generateChunks(),
            stderr: null,
            exited: Promise.resolve(0),
            kill: () => {},
          };
        };

        const adapter = new GeminiAdapter({
          executionMode: "cli",
          dangerouslySkipPermissions: true,
          spawnFn: mockSpawn,
        });

        const sessionOptions: PalSessionOptions = {
          sessionId: "sess-delegation",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Execute turn via adapter CLI")],
            }),
          ],
        };

        const outcome = await adapter.executeTurn(sessionOptions);
        expect(spawnedWithBypass).toBe(true);
        expect(outcome.message.content.find(isPalTextContent)?.text).toBe(
          "Delegated to CLI."
        );

        // Test streamTurn delegation in CLI mode
        const streamEvents: PalStreamEvent[] = [];
        for await (const ev of adapter.streamTurn(sessionOptions)) {
          streamEvents.push(ev);
        }
        expect(streamEvents.some((e) => e.type === "text_delta")).toBe(true);
        expect(streamEvents.some((e) => e.type === "turn_complete")).toBe(true);
      });
    });
  });
});
