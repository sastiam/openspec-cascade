import { describe, expect, it } from "bun:test";
import {
  CLAUDE_ADAPTER_CONSTANTS,
  ClaudeAdapter,
  ClaudeStreamChunkParser,
  calculateClaudeTokenUsage,
  claudePalAdapter,
  countCacheBreakpoints,
  createClaudeAdapter,
  formatClaudeToolChoice,
  formatPromptCachingBetaHeader,
  mapClaudeStopReason,
  parseClaudeError,
  parseClaudeRateLimitHeaders,
  parseClaudeStream,
  parseClaudeStreamChunk,
  stripCacheControlFromMessages,
  toAsyncIterable,
  validateThinkingBudget,
} from "../../src/pal/adapters/claude";
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
  type ClaudeTurnMessage,
  type PalSessionOptions,
  type PalStreamEvent,
  type PalToolDefinition,
  type ProviderAdapter,
} from "../../src/pal/types";

describe("Anthropic Claude Provider Adapter (LOOPER-PAL-002)", () => {
  describe("ProviderAdapter Interface & Protocol Conformance (Task 1.1)", () => {
    it("initializes with default options and adheres to ProviderAdapter interface", () => {
      const adapter = new ClaudeAdapter();
      const providerAdapter: ProviderAdapter = adapter;

      expect(providerAdapter.providerName).toBe(PAL_PROVIDER_NAMES.CLAUDE);
      expect(adapter.providerName).toBe(PAL_PROVIDER_NAMES.CLAUDE);
      expect(adapter.modelName).toBe(CLAUDE_ADAPTER_CONSTANTS.DEFAULT_MODEL);
      expect(adapter.isPromptCachingEnabled()).toBe(true);
      expect(adapter.getDefaultThinking()).toBeUndefined();
    });

    it("respects custom configuration options", () => {
      const customOptions = {
        modelName: "claude-3-5-sonnet-custom",
        apiKey: "sk-ant-custom-key",
        baseUrl: "https://custom.anthropic.endpoint.local",
        timeoutMs: 30_000,
        defaultHeaders: {
          "x-organization-id": "org_test_123",
        },
        enablePromptCaching: false,
        betas: ["custom-beta-2025"],
      };

      const adapter = new ClaudeAdapter(customOptions);
      expect(adapter.modelName).toBe("claude-3-5-sonnet-custom");
      expect(adapter.isPromptCachingEnabled()).toBe(false);

      const headers = adapter.buildHeaders();
      expect(headers["x-api-key"]).toBe("sk-ant-custom-key");
      expect(headers["x-organization-id"]).toBe("org_test_123");
      expect(headers["anthropic-beta"]).toBe("custom-beta-2025");
    });

    it("falls back to environment variables for API key and base URL", () => {
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

      try {
        process.env.ANTHROPIC_API_KEY = "sk-ant-env-fallback-key";
        process.env.ANTHROPIC_BASE_URL = "https://env.anthropic.endpoint.local";

        const adapter = new ClaudeAdapter();
        const headers = adapter.buildHeaders();
        expect(headers["x-api-key"]).toBe("sk-ant-env-fallback-key");
      } finally {
        if (originalApiKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalApiKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
        if (originalBaseUrl !== undefined) {
          process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.ANTHROPIC_BASE_URL;
        }
      }
    });

    it("provides singleton claudePalAdapter and factory createClaudeAdapter", () => {
      expect(claudePalAdapter).toBeInstanceOf(ClaudeAdapter);
      expect(claudePalAdapter.providerName).toBe(PAL_PROVIDER_NAMES.CLAUDE);

      const created = createClaudeAdapter({ apiKey: "factory-key" });
      expect(created).toBeInstanceOf(ClaudeAdapter);
      expect(created.buildHeaders()["x-api-key"]).toBe("factory-key");
    });

    it("getCapabilities() accurately reports provider capabilities", () => {
      const adapter = new ClaudeAdapter({ modelName: "claude-test-model" });
      const caps = adapter.getCapabilities();

      expect(caps.providerName).toBe(PAL_PROVIDER_NAMES.CLAUDE);
      expect(caps.modelName).toBe("claude-test-model");
      expect(caps.maxContextTokens).toBe(CLAUDE_ADAPTER_CONSTANTS.MAX_CONTEXT_TOKENS);
      expect(caps.maxOutputTokens).toBe(CLAUDE_ADAPTER_CONSTANTS.MAX_OUTPUT_TOKENS);
      expect(caps.supportsNativeTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsExtendedThinking).toBe(true);
      expect(caps.supportsPromptCaching).toBe(true);
    });

    it("getRateLimitState() tracks rate limits and updates from response headers", () => {
      const adapter = new ClaudeAdapter();
      const initialLimits = adapter.getRateLimitState();

      expect(initialLimits.requestsLimit).toBe(CLAUDE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_LIMIT);
      expect(initialLimits.requestsRemaining).toBe(CLAUDE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_REMAINING);
      expect(initialLimits.tokensLimit).toBe(CLAUDE_ADAPTER_CONSTANTS.INITIAL_TOKENS_LIMIT);
      expect(initialLimits.tokensRemaining).toBe(CLAUDE_ADAPTER_CONSTANTS.INITIAL_TOKENS_REMAINING);
      expect(initialLimits.resetsAt).toBe(CLAUDE_ADAPTER_CONSTANTS.INITIAL_RESETS_AT);
    });

    it("parseClaudeRateLimitHeaders extracts rate limit metrics and reset timestamps", () => {
      const headers = new Headers();
      headers.set("anthropic-ratelimit-requests-limit", "500");
      headers.set("anthropic-ratelimit-requests-remaining", "450");
      headers.set("anthropic-ratelimit-tokens-limit", "80000");
      headers.set("anthropic-ratelimit-tokens-remaining", "72000");
      headers.set("anthropic-ratelimit-requests-reset", "2026-10-24T18:00:00Z");

      const parsed = parseClaudeRateLimitHeaders(headers);
      expect(parsed.requestsLimit).toBe(500);
      expect(parsed.requestsRemaining).toBe(450);
      expect(parsed.tokensLimit).toBe(80000);
      expect(parsed.tokensRemaining).toBe(72000);
      expect(parsed.resetsAt).toBe(Date.parse("2026-10-24T18:00:00Z"));

      // retry-after header support (seconds offset)
      const retryHeaders = new Headers();
      retryHeaders.set("retry-after", "120");
      const before = Date.now();
      const parsedRetry = parseClaudeRateLimitHeaders(retryHeaders);
      const after = Date.now();
      expect(parsedRetry.resetsAt).toBeGreaterThanOrEqual(before + 119 * 1000);
      expect(parsedRetry.resetsAt).toBeLessThanOrEqual(after + 121 * 1000);
    });

    it("formatClaudeToolChoice formats tool selection configurations", () => {
      expect(formatClaudeToolChoice(undefined)).toEqual({ type: "auto" });
      expect(formatClaudeToolChoice("auto")).toEqual({ type: "auto" });
      expect(formatClaudeToolChoice("none")).toBeUndefined();
      expect(formatClaudeToolChoice("required")).toEqual({ type: "any" });
      expect(
        formatClaudeToolChoice({ type: "tool", toolName: "execute_command" })
      ).toEqual({ type: "tool", name: "execute_command" });
      expect(formatClaudeToolChoice("other" as unknown as undefined)).toBeUndefined();
    });

    it("mapClaudeStopReason maps wire stop reasons to canonical PalFinishReason", () => {
      expect(mapClaudeStopReason("end_turn")).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapClaudeStopReason("stop_sequence")).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapClaudeStopReason("max_tokens")).toBe(PAL_FINISH_REASONS.LENGTH);
      expect(mapClaudeStopReason("tool_use")).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
      expect(mapClaudeStopReason("content_filter")).toBe(PAL_FINISH_REASONS.CONTENT_FILTER);
      expect(mapClaudeStopReason("unexpected_future_reason")).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapClaudeStopReason(undefined)).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapClaudeStopReason(123)).toBe(PAL_FINISH_REASONS.STOP);
    });

    it("parseClaudeError maps HTTP status codes and payloads to PalError instances", () => {
      // 400 Bad Request
      const badReq = parseClaudeError(400, {
        error: { type: "invalid_request_error", message: "Invalid JSON format" },
      });
      expect(badReq.kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
      expect(badReq.retryable).toBe(false);
      expect(badReq.message).toContain("Invalid JSON format");

      // 400 Context Length Exceeded
      const contextErr = parseClaudeError(400, {
        error: { message: "Prompt is too long: context_length_exceeded" },
      });
      expect(contextErr.kind).toBe(PAL_ERROR_KINDS.CONTEXT_EXCEEDED);
      expect(contextErr.retryable).toBe(false);

      // 401 / 403 Authentication / Permission Error
      const authErr = parseClaudeError(401, {
        error: { type: "authentication_error", message: "Invalid API key" },
      });
      expect(authErr.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
      expect(authErr.retryable).toBe(false);

      const permErr = parseClaudeError(403, {
        error: { type: "permission_error", message: "Forbidden model access" },
      });
      expect(permErr.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
      expect(permErr.retryable).toBe(false);

      // 408 Request Timeout
      const timeoutErr = parseClaudeError(408, {});
      expect(timeoutErr.kind).toBe(PAL_ERROR_KINDS.TIMEOUT);
      expect(timeoutErr.retryable).toBe(true);

      // 429 Rate Limit
      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("retry-after", "60");
      const rateLimitErr = parseClaudeError(
        429,
        { error: { type: "rate_limit_error", message: "Rate limit reached" } },
        rateLimitHeaders
      );
      expect(rateLimitErr.kind).toBe(PAL_ERROR_KINDS.RATE_LIMIT);
      expect(rateLimitErr.retryable).toBe(true);
      expect(rateLimitErr.resetsAt).toBeDefined();

      // 500 / 502 / 503 / 504 / 529 Overloaded Server Error
      const overloadedErr = parseClaudeError(529, {
        error: { type: "overloaded_error", message: "Anthropic service overloaded" },
      });
      expect(overloadedErr.kind).toBe(PAL_ERROR_KINDS.OVERLOADED);
      expect(overloadedErr.retryable).toBe(true);

      const serverErr = parseClaudeError(503, {});
      expect(serverErr.kind).toBe(PAL_ERROR_KINDS.OVERLOADED);
      expect(serverErr.retryable).toBe(true);
    });

    describe("executeTurn Error Handling & Resiliency", () => {
      it("throws PalError with AUTH_FAILURE on 401 response", async () => {
        const mockFetch = (async () => {
          return new Response(
            JSON.stringify({
              error: { type: "authentication_error", message: "API key invalid" },
            }),
            { status: 401 }
          );
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: mockFetch });

        expect(
          adapter.executeTurn({
            sessionId: "err_sess",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Ping")],
              }),
            ],
          })
        ).rejects.toThrow(PalError);

        try {
          await adapter.executeTurn({
            sessionId: "err_sess",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Ping")],
              }),
            ],
          });
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(PalError);
          const palErr = err as PalError;
          expect(palErr.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
          expect(palErr.retryable).toBe(false);
        }
      });

      it("throws PalError with TIMEOUT on request abort or timeout", async () => {
        const mockFetch = (async () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          throw err;
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: mockFetch, timeoutMs: 100 });

        try {
          await adapter.executeTurn({
            sessionId: "abort_sess",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Hello")],
              }),
            ],
          });
          expect(true).toBe(false); // Should not reach
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(PalError);
          const palErr = err as PalError;
          expect(palErr.kind).toBe(PAL_ERROR_KINDS.TIMEOUT);
          expect(palErr.retryable).toBe(true);
        }
      });

      it("throws PalError with TIMEOUT when external abortSignal is triggered", async () => {
        const controller = new AbortController();

        const mockFetch = (async (_url: unknown, init?: RequestInit) => {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: mockFetch });

        const turnPromise = adapter.executeTurn({
          sessionId: "abort_ext_sess",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Hello")],
            }),
          ],
          abortSignal: controller.signal,
        });

        // Trigger abort
        controller.abort();

        await expect(turnPromise).rejects.toThrow(PalError);
      });

      it("throws PalError with OVERLOADED on network connection failures", async () => {
        const mockFetch = (async () => {
          throw new TypeError("Failed to fetch: connection refused");
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: mockFetch });

        try {
          await adapter.executeTurn({
            sessionId: "network_err_sess",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Network test")],
              }),
            ],
          });
          expect(true).toBe(false);
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(PalError);
          const palErr = err as PalError;
          expect(palErr.kind).toBe(PAL_ERROR_KINDS.OVERLOADED);
          expect(palErr.retryable).toBe(true);
        }
      });

      it("throws PalError with INVALID_REQUEST when API returns invalid JSON or non-object", async () => {
        const invalidJsonFetch = (async () => {
          return new Response("<html>Gateway 502 Bad Gateway</html>", { status: 200 });
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: invalidJsonFetch });

        await expect(
          adapter.executeTurn({
            sessionId: "bad_json_sess",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Bad JSON")],
              }),
            ],
          })
        ).rejects.toThrow(PalError);

        const nonObjectFetch = (async () => {
          return new Response(JSON.stringify(["array_payload"]), { status: 200 });
        }) as unknown as typeof fetch;

        const adapter2 = new ClaudeAdapter({ fetchFn: nonObjectFetch });

        await expect(
          adapter2.executeTurn({
            sessionId: "non_obj_sess",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Non object")],
              }),
            ],
          })
        ).rejects.toThrow(PalError);
      });
    });

    describe("streamTurn Error Handling & Stream Resiliency", () => {
      it("yields error event on network connection failure", async () => {
        const mockFetch = (async () => {
          throw new Error("DNS resolution failed");
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: mockFetch });

        const events: PalStreamEvent[] = [];
        for await (const ev of adapter.streamTurn({
          sessionId: "stream_fail_sess",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Fail stream")],
            }),
          ],
        })) {
          events.push(ev);
        }

        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe("error");
        if (events[0]?.type === "error") {
          expect(events[0].error.kind).toBe(PAL_ERROR_KINDS.OVERLOADED);
        }
      });

      it("yields error event on HTTP error status response", async () => {
        const mockFetch = (async () => {
          return new Response(
            JSON.stringify({
              error: { type: "authentication_error", message: "Unauthorized stream" },
            }),
            { status: 401 }
          );
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: mockFetch });

        const events: PalStreamEvent[] = [];
        for await (const ev of adapter.streamTurn({
          sessionId: "stream_http_err_sess",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Auth stream test")],
            }),
          ],
        })) {
          events.push(ev);
        }

        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe("error");
        if (events[0]?.type === "error") {
          expect(events[0].error.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
        }
      });

      it("yields error event when response body is null", async () => {
        const mockFetch = (async () => {
          const resp = new Response(null, { status: 200 });
          Object.defineProperty(resp, "body", { value: null });
          return resp;
        }) as unknown as typeof fetch;

        const adapter = new ClaudeAdapter({ fetchFn: mockFetch });

        const events: PalStreamEvent[] = [];
        for await (const ev of adapter.streamTurn({
          sessionId: "null_body_sess",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Null body")],
            }),
          ],
        })) {
          events.push(ev);
        }

        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe("error");
        if (events[0]?.type === "error") {
          expect(events[0].error.kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
        }
      });
    });

    describe("toAsyncIterable Source Normalization Helper", () => {
      it("normalizes ReadableStream, AsyncIterable, and Array iterables", async () => {
        // Test ReadableStream
        const encoder = new TextEncoder();
        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("chunk1;"));
            controller.enqueue(encoder.encode("chunk2"));
            controller.close();
          },
        });

        const readableChunks: string[] = [];
        const decoder = new TextDecoder();
        for await (const bytes of toAsyncIterable(readable)) {
          readableChunks.push(decoder.decode(bytes));
        }
        expect(readableChunks).toEqual(["chunk1;", "chunk2"]);

        // Test AsyncIterable
        async function* asyncGen(): AsyncIterable<number> {
          yield 10;
          yield 20;
          yield 30;
        }
        const asyncNumbers: number[] = [];
        for await (const num of toAsyncIterable(asyncGen())) {
          asyncNumbers.push(num);
        }
        expect(asyncNumbers).toEqual([10, 20, 30]);

        // Test Array Iterable
        const arrayItems: string[] = [];
        for await (const item of toAsyncIterable(["a", "b", "c"])) {
          arrayItems.push(item);
        }
        expect(arrayItems).toEqual(["a", "b", "c"]);
      });
    });
  });

  describe("Prompt Caching Headers & Beta Management (Task 1.2)", () => {
    it("includes prompt caching and output 128k beta headers by default", () => {
      const adapter = new ClaudeAdapter({
        apiKey: "test-api-key",
      });

      const headers = adapter.buildHeaders();
      expect(headers["content-type"]).toBe("application/json");
      expect(headers["anthropic-version"]).toBe(CLAUDE_ADAPTER_CONSTANTS.ANTHROPIC_VERSION);
      expect(headers["x-api-key"]).toBe("test-api-key");
      expect(headers["anthropic-beta"]).toBeDefined();
      expect(headers["anthropic-beta"]).toContain(CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA);
      expect(headers["anthropic-beta"]).toContain(CLAUDE_ADAPTER_CONSTANTS.OUTPUT_128K_BETA);
      expect(adapter.isPromptCachingEnabled()).toBe(true);
    });

    it("omits prompt caching beta header when enablePromptCaching is false on adapter", () => {
      const adapter = new ClaudeAdapter({
        apiKey: "test-api-key",
        enablePromptCaching: false,
      });

      const headers = adapter.buildHeaders();
      expect(adapter.isPromptCachingEnabled()).toBe(false);
      expect(headers["anthropic-beta"]).toBeDefined();
      expect(headers["anthropic-beta"]).not.toContain(CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA);
      expect(headers["anthropic-beta"]).toContain(CLAUDE_ADAPTER_CONSTANTS.OUTPUT_128K_BETA);
    });

    it("omits anthropic-beta header entirely when prompt caching is disabled and no other betas configured", () => {
      const adapter = new ClaudeAdapter({
        enablePromptCaching: false,
        betas: [],
      });

      const headers = adapter.buildHeaders();
      expect(headers["anthropic-beta"]).toBeUndefined();
    });

    it("allows overriding prompt caching via session options (disable caching for specific session)", () => {
      const adapter = new ClaudeAdapter({
        enablePromptCaching: true,
      });

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_001",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Task message")],
          }),
        ],
        promptCaching: false,
      };

      const headers = adapter.buildHeaders(sessionOpts);
      expect(headers["anthropic-beta"]).not.toContain(CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA);
    });

    it("allows overriding prompt caching via session options object ({ enabled: true })", () => {
      const adapter = new ClaudeAdapter({
        enablePromptCaching: false,
      });

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_002",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Task message")],
          }),
        ],
        promptCaching: { enabled: true },
      };

      const headers = adapter.buildHeaders(sessionOpts);
      expect(headers["anthropic-beta"]).toContain(CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA);
    });

    it("merges custom betas and deduplicates prompt caching beta", () => {
      const customBeta = "custom-capability-2025";
      const adapter = new ClaudeAdapter({
        betas: [customBeta, CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA],
        enablePromptCaching: true,
      });

      const betaHeader = adapter.getAnthropicBetaHeader();
      expect(betaHeader).toBeDefined();
      expect(betaHeader).toContain(customBeta);
      expect(betaHeader).toContain(CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA);
      // Ensure prompt-caching is not duplicated
      const occurrences = betaHeader!.split(",").filter((b) => b === CLAUDE_ADAPTER_CONSTANTS.PROMPT_CACHING_BETA).length;
      expect(occurrences).toBe(1);
    });

    it("formatPromptCachingBetaHeader helper formats betas accurately", () => {
      const headerWithCache = formatPromptCachingBetaHeader(
        ["output-128k-2025-02-19"],
        true
      );
      expect(headerWithCache).toContain("prompt-caching-2024-07-31");
      expect(headerWithCache).toContain("output-128k-2025-02-19");

      const headerWithoutCache = formatPromptCachingBetaHeader(
        ["output-128k-2025-02-19", "prompt-caching-2024-07-31"],
        false
      );
      expect(headerWithoutCache).toBe("output-128k-2025-02-19");

      const emptyHeader = formatPromptCachingBetaHeader([], false);
      expect(emptyHeader).toBeUndefined();
    });
  });

  describe("Prompt Caching Breakpoints & Payload Serialization (Task 1.2)", () => {
    it("preserves cacheControl on system prompt parts, user messages, and tools when caching is enabled", () => {
      const adapter = new ClaudeAdapter({ enablePromptCaching: true });

      const tools: PalToolDefinition[] = [
        {
          name: "read_file",
          description: "Read file contents",
          parameters: { type: "object", properties: { path: { type: "string" } } },
          source: "native",
          cacheControl: { type: "ephemeral" },
        },
      ];

      const userMsg = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Inspect code", { type: "ephemeral" })],
      });

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_cache_1",
        messages: [userMsg],
        systemPrompt: [
          { type: "text", text: "Static System Prompt", cacheControl: { type: "ephemeral" } },
        ],
        tools,
      };

      const payload = adapter.buildTurnPayload(sessionOpts);

      // System prompt has cache_control
      const sys = payload.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
      expect(sys[0]?.cache_control).toEqual({ type: "ephemeral" });

      // Tools have cache_control
      const payloadTools = payload.tools as Array<{ name: string; cache_control?: { type: string } }>;
      expect(payloadTools[0]?.cache_control).toEqual({ type: "ephemeral" });

      // Messages have cache_control
      const msgs = payload.messages as Array<{ role: string; content: Array<{ type: string; cache_control?: { type: string } }> }>;
      expect(msgs[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" });

      expect(countCacheBreakpoints(payload)).toBe(3);
    });

    it("strips cacheControl when prompt caching is disabled via session options", () => {
      const adapter = new ClaudeAdapter({ enablePromptCaching: true });

      const tools: PalToolDefinition[] = [
        {
          name: "read_file",
          description: "Read file contents",
          parameters: { type: "object", properties: { path: { type: "string" } } },
          source: "native",
          cacheControl: { type: "ephemeral" },
        },
      ];

      const userMsg = createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock("Inspect code", { type: "ephemeral" })],
      });

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_cache_disabled",
        messages: [userMsg],
        systemPrompt: [
          { type: "text", text: "Static System Prompt", cacheControl: { type: "ephemeral" } },
        ],
        tools,
        promptCaching: false,
      };

      const payload = adapter.buildTurnPayload(sessionOpts);

      const sys = payload.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
      expect(sys[0]?.cache_control).toBeUndefined();

      const payloadTools = payload.tools as Array<{ name: string; cache_control?: { type: string } }>;
      expect(payloadTools[0]?.cache_control).toBeUndefined();

      const msgs = payload.messages as Array<{ role: string; content: Array<{ type: string; cache_control?: { type: string } }> }>;
      expect(msgs[0]?.content[0]?.cache_control).toBeUndefined();

      expect(countCacheBreakpoints(payload)).toBe(0);
    });

    it("enforces Anthropic maximum limit of 4 cache breakpoints per request", () => {
      const adapter = new ClaudeAdapter({ enablePromptCaching: true });

      // Build 5 cache breakpoints (1 system, 2 tools, 2 messages)
      const tools: PalToolDefinition[] = [
        {
          name: "tool_1",
          description: "Tool 1",
          parameters: { type: "object", properties: {} },
          source: "native",
          cacheControl: { type: "ephemeral" },
        },
        {
          name: "tool_2",
          description: "Tool 2",
          parameters: { type: "object", properties: {} },
          source: "native",
          cacheControl: { type: "ephemeral" },
        },
      ];

      const userMsg = createPalMessage({
        role: PAL_ROLES.USER,
        content: [
          createTextBlock("Block 1", { type: "ephemeral" }),
          createTextBlock("Block 2", { type: "ephemeral" }),
        ],
      });

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_too_many_breakpoints",
        messages: [userMsg],
        systemPrompt: [
          { type: "text", text: "Sys Prompt", cacheControl: { type: "ephemeral" } },
        ],
        tools,
      };

      expect(() => adapter.buildTurnPayload(sessionOpts)).toThrow(PalError);
      try {
        adapter.buildTurnPayload(sessionOpts);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PalError);
        const palErr = err as PalError;
        expect(palErr.kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
        expect(palErr.message).toContain("maximum of 4 cache_control breakpoints");
      }
    });

    it("stripCacheControlFromMessages strips cache_control from Claude messages", () => {
      const messages: ClaudeTurnMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Cached text", cache_control: { type: "ephemeral" } },
            { type: "text", text: "Uncached text" },
          ],
        },
      ];

      const stripped = stripCacheControlFromMessages(messages);
      const content = stripped[0]?.content;
      const firstBlock = Array.isArray(content) ? content[0] : undefined;
      const hasCacheControl =
        typeof firstBlock === "object" && firstBlock !== null && "cache_control" in firstBlock;
      expect(hasCacheControl).toBe(false);
    });
  });

  describe("Extended Thinking Budget Configuration (Task 1.2)", () => {
    it("configures thinking block with valid budget and sets temperature to 1.0", () => {
      const adapter = new ClaudeAdapter();

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_thinking_1",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Solve architectural constraint")],
          }),
        ],
        thinking: {
          enabled: true,
          budgetTokens: 4096,
        },
        temperature: 0.2, // Should be overridden to 1.0 per Anthropic constraint
      };

      const payload = adapter.buildTurnPayload(sessionOpts);
      expect(payload.thinking).toEqual({
        type: "enabled",
        budget_tokens: 4096,
      });
      expect(payload.temperature).toBe(1.0);
      expect((payload.max_tokens as number)).toBeGreaterThan(4096);
    });

    it("uses default thinking budget (2048) when budgetTokens is omitted but thinking is enabled", () => {
      const adapter = new ClaudeAdapter();

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_thinking_default_budget",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Analyze problem")],
          }),
        ],
        thinking: {
          enabled: true,
        },
      };

      const payload = adapter.buildTurnPayload(sessionOpts);
      expect(payload.thinking).toEqual({
        type: "enabled",
        budget_tokens: CLAUDE_ADAPTER_CONSTANTS.DEFAULT_THINKING_BUDGET_TOKENS,
      });
      expect((payload.max_tokens as number)).toBeGreaterThan(CLAUDE_ADAPTER_CONSTANTS.DEFAULT_THINKING_BUDGET_TOKENS);
    });

    it("inherits defaultThinking configuration set on ClaudeAdapter", () => {
      const adapter = new ClaudeAdapter({
        defaultThinking: {
          enabled: true,
          budgetTokens: 3000,
        },
      });

      expect(adapter.getDefaultThinking()).toEqual({
        enabled: true,
        budgetTokens: 3000,
      });

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_inherit_thinking",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Check defaults")],
          }),
        ],
      };

      const payload = adapter.buildTurnPayload(sessionOpts);
      expect(payload.thinking).toEqual({
        type: "enabled",
        budget_tokens: 3000,
      });
      expect(payload.temperature).toBe(1.0);
    });

    it("allows session options to explicitly disable thinking when adapter defaults have thinking enabled", () => {
      const adapter = new ClaudeAdapter({
        defaultThinking: {
          enabled: true,
          budgetTokens: 3000,
        },
      });

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_disable_thinking",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Simple prompt")],
          }),
        ],
        thinking: {
          enabled: false,
        },
        temperature: 0.5,
      };

      const payload = adapter.buildTurnPayload(sessionOpts);
      expect(payload.thinking).toBeUndefined();
      expect(payload.temperature).toBe(0.5);
    });

    it("rejects thinking budget below minimum limit of 1024 tokens", () => {
      const adapter = new ClaudeAdapter();

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_invalid_budget_low",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Invalid budget")],
          }),
        ],
        thinking: {
          enabled: true,
          budgetTokens: 500, // Below 1024
        },
      };

      expect(() => adapter.buildTurnPayload(sessionOpts)).toThrow(PalError);
      try {
        adapter.buildTurnPayload(sessionOpts);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PalError);
        const palErr = err as PalError;
        expect(palErr.kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
        expect(palErr.message).toContain("must be at least 1024 tokens");
      }
    });

    it("rejects thinking budget exceeding maximum allowed output tokens limit", () => {
      const adapter = new ClaudeAdapter();

      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_invalid_budget_high",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Invalid budget high")],
          }),
        ],
        thinking: {
          enabled: true,
          budgetTokens: 100_000,
        },
      };

      expect(() => adapter.buildTurnPayload(sessionOpts)).toThrow(PalError);
      try {
        adapter.buildTurnPayload(sessionOpts);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PalError);
        const palErr = err as PalError;
        expect(palErr.kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
        expect(palErr.message).toContain("exceeds maximum allowed limit");
      }
    });

    it("validateThinkingBudget validates valid and invalid budgets", () => {
      expect(() => validateThinkingBudget(1024)).not.toThrow();
      expect(() => validateThinkingBudget(4096)).not.toThrow();
      expect(() => validateThinkingBudget(64000)).not.toThrow();
      expect(() => validateThinkingBudget(1023)).toThrow(PalError);
      expect(() => validateThinkingBudget(64001)).toThrow(PalError);
    });

    it("ensures max_tokens is strictly greater than thinking.budget_tokens", () => {
      const adapter = new ClaudeAdapter();

      // If caller provides maxTokens equal to or smaller than budget, adapter automatically expands max_tokens
      const sessionOpts: PalSessionOptions = {
        sessionId: "sess_headroom",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Test headroom")],
          }),
        ],
        thinking: {
          enabled: true,
          budgetTokens: 4000,
        },
        maxTokens: 3000, // Smaller than budget
      };

      const payload = adapter.buildTurnPayload(sessionOpts);
      const maxTokens = payload.max_tokens as number;
      expect(maxTokens).toBeGreaterThan(4000);
      expect(maxTokens).toBe(4000 + CLAUDE_ADAPTER_CONSTANTS.DEFAULT_COMPLETION_HEADROOM_TOKENS);
    });
  });

  describe("Spec Scenario: Extended Thinking Token Accumulation Separation", () => {
    it("accumulates thinking tokens separately from completion tokens (Scenario: Extended thinking is configured)", () => {
      // In Anthropic API, output_tokens represents total output (completion + thinking).
      // PAL guarantees thinkingTokens is accumulated separately and completionTokens is net completion tokens.
      const rawUsage = {
        input_tokens: 1500,
        output_tokens: 2500,
        thinking_tokens: 1800,
        total_tokens: 4000,
        cache_read_input_tokens: 1200,
        cache_creation_input_tokens: 300,
      };

      const usage = calculateClaudeTokenUsage(rawUsage);

      expect(usage.promptTokens).toBe(1500);
      expect(usage.thinkingTokens).toBe(1800);
      expect(usage.completionTokens).toBe(700); // 2500 - 1800
      expect(usage.cachedPromptTokens).toBe(1200);
      expect(usage.cacheCreationInputTokens).toBe(300);
      expect(usage.totalTokens).toBe(4000);
    });

    it("handles output_tokens_details nested thinking tokens from Anthropic", () => {
      const rawUsage = {
        input_tokens: 500,
        output_tokens: 1200,
        output_tokens_details: {
          thinking_tokens: 900,
        },
      };

      const usage = calculateClaudeTokenUsage(rawUsage);

      expect(usage.promptTokens).toBe(500);
      expect(usage.thinkingTokens).toBe(900);
      expect(usage.completionTokens).toBe(300); // 1200 - 900
    });

    it("reports completion tokens equal to output tokens when thinking tokens is not present", () => {
      const rawUsage = {
        input_tokens: 200,
        output_tokens: 450,
      };

      const usage = calculateClaudeTokenUsage(rawUsage);

      expect(usage.promptTokens).toBe(200);
      expect(usage.completionTokens).toBe(450);
      expect(usage.thinkingTokens).toBeUndefined();
    });
  });

  describe("End-to-End executeTurn with Mock Anthropic API", () => {
    it("sends prompt caching headers and extended thinking payload and accumulates usage", async () => {
      let interceptedHeaders: Record<string, string> = {};
      let interceptedBody: Record<string, unknown> = {};

      const mockFetch = (async (_url: unknown, init?: RequestInit) => {
        interceptedHeaders = Object.fromEntries(
          Object.entries(init?.headers as Record<string, string> || {})
        );
        interceptedBody = JSON.parse(init?.body as string);

        const responsePayload = {
          id: "msg_mock_001",
          type: "message",
          role: "assistant",
          model: "claude-3-7-sonnet-20250219",
          content: [
            {
              type: "thinking",
              thinking: "Detailed architectural reasoning chain...",
              signature: "sig_crypto_valid_test",
            },
            {
              type: "text",
              text: "Implementation strategy approved.",
            },
          ],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 1200,
            output_tokens: 1500,
            thinking_tokens: 1000,
            cache_read_input_tokens: 800,
            cache_creation_input_tokens: 200,
          },
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "anthropic-ratelimit-requests-remaining": "999",
            "anthropic-ratelimit-tokens-remaining": "95000",
          },
        });
      }) as unknown as typeof fetch;

      const adapter = createClaudeAdapter({
        apiKey: "sk-ant-test-token",
        fetchFn: mockFetch,
        enablePromptCaching: true,
      });

      const outcome = await adapter.executeTurn({
        sessionId: "sess_e2e_1",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Analyze cache performance", { type: "ephemeral" })],
          }),
        ],
        systemPrompt: [
          { type: "text", text: "System prompt", cacheControl: { type: "ephemeral" } },
        ],
        thinking: {
          enabled: true,
          budgetTokens: 2048,
        },
      });

      // Verify headers sent to wire
      expect(interceptedHeaders["anthropic-beta"]).toContain("prompt-caching-2024-07-31");
      expect(interceptedHeaders["x-api-key"]).toBe("sk-ant-test-token");

      // Verify wire payload
      expect(interceptedBody.thinking).toEqual({
        type: "enabled",
        budget_tokens: 2048,
      });
      expect(interceptedBody.temperature).toBe(1.0);

      // Verify outcome message content & structure
      expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.STOP);
      expect(outcome.message.role).toBe(PAL_ROLES.ASSISTANT);
      expect(outcome.message.content.length).toBe(2);

      const thoughtBlock = outcome.message.content[0];
      expect(thoughtBlock?.type).toBe(PAL_CONTENT_BLOCK_TYPES.THOUGHT);
      if (thoughtBlock?.type === "thought") {
        expect(thoughtBlock.signature).toBe("sig_crypto_valid_test");
      }

      // Verify token accumulation separation
      expect(outcome.usage.promptTokens).toBe(1200);
      expect(outcome.usage.thinkingTokens).toBe(1000);
      expect(outcome.usage.completionTokens).toBe(500); // 1500 - 1000
      expect(outcome.usage.cachedPromptTokens).toBe(800);
      expect(outcome.usage.cacheCreationInputTokens).toBe(200);
    });
  });

  describe("Streaming Chunk Parser for Anthropic Content Blocks (Task 1.3)", () => {
    it("parses text block streaming chunks and accumulates turn telemetry", () => {
      const parser = new ClaudeStreamChunkParser();

      const chunks = [
        `data: {"type": "message_start", "message": {"id": "msg_stream_01", "type": "message", "role": "assistant", "model": "claude-3-7-sonnet-20250219", "usage": {"input_tokens": 150, "cache_read_input_tokens": 50, "cache_creation_input_tokens": 20, "output_tokens": 1}}}\n\n`,
        `data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello, "}}\n\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "world!"}}\n\n`,
        `data: {"type": "content_block_stop", "index": 0}\n\n`,
        `data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 25}}\n\n`,
        `data: {"type": "message_stop"}\n\n`,
      ];

      const emittedEvents: PalStreamEvent[] = [];
      for (const chunk of chunks) {
        emittedEvents.push(...parser.feed(chunk));
      }

      expect(emittedEvents.length).toBe(3);
      expect(emittedEvents[0]).toEqual({ type: "text_delta", text: "Hello, " });
      expect(emittedEvents[1]).toEqual({ type: "text_delta", text: "world!" });
      expect(emittedEvents[2]?.type).toBe("turn_complete");

      if (emittedEvents[2]?.type === "turn_complete") {
        expect(emittedEvents[2].finishReason).toBe(PAL_FINISH_REASONS.STOP);
        expect(emittedEvents[2].usage.promptTokens).toBe(150);
        expect(emittedEvents[2].usage.completionTokens).toBe(25);
        expect(emittedEvents[2].usage.cachedPromptTokens).toBe(50);
        expect(emittedEvents[2].usage.cacheCreationInputTokens).toBe(20);
        expect(emittedEvents[2].usage.totalTokens).toBe(175);
      }

      expect(parser.isCompleted()).toBe(true);
      expect(parser.getMessageId()).toBe("msg_stream_01");
      expect(parser.getModel()).toBe("claude-3-7-sonnet-20250219");

      // Verify canonical message reconstruction
      const message = parser.toMessage();
      expect(message.role).toBe(PAL_ROLES.ASSISTANT);
      expect(message.id).toBe("msg_stream_01");
      expect(message.content.length).toBe(1);
      expect(message.content[0]).toEqual(createTextBlock("Hello, world!"));
    });

    it("handles arbitrary chunk fragmentation across string and byte boundaries", () => {
      const parser = new ClaudeStreamChunkParser();

      const rawSse = [
        `data: {"type": "message_start", "message": {"id": "msg_frag_01", "model": "claude-3-7-sonnet-20250219", "usage": {"input_tokens": 10, "output_tokens": 1}}}\n`,
        `data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Fragmentation test 🚀 complete."}}\n`,
        `data: {"type": "content_block_stop", "index": 0}\n`,
        `data: {"type": "message_stop"}\n`,
      ].join("");

      // Split into 4-byte UTF-8 fragments (simulating network chunking across multibyte sequences)
      const encoder = new TextEncoder();
      const rawBytes = encoder.encode(rawSse);
      const chunkSize = 4;
      const emittedEvents: PalStreamEvent[] = [];

      for (let i = 0; i < rawBytes.length; i += chunkSize) {
        const slice = rawBytes.subarray(i, i + chunkSize);
        emittedEvents.push(...parser.feed(slice));
      }

      // Final flush
      emittedEvents.push(...parser.flush());

      const textEvents = emittedEvents.filter(
        (e): e is { type: "text_delta"; text: string } => e.type === "text_delta"
      );
      const reassembledText = textEvents.map((e) => e.text).join("");
      expect(reassembledText).toBe("Fragmentation test 🚀 complete.");

      const completeEvents = emittedEvents.filter((e) => e.type === "turn_complete");
      expect(completeEvents.length).toBe(1);
    });

    it("parses extended thinking content blocks and preserves cryptographic signatures", () => {
      const parser = new ClaudeStreamChunkParser();

      const sseStream = [
        `data: {"type": "message_start", "message": {"id": "msg_thinking_01", "usage": {"input_tokens": 500, "output_tokens": 1}}}\n`,
        `data: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Step 1: Check invariants. "}}\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Step 2: Formulate solution."}}\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "sig_crypto_valid_hex_012345"}}\n`,
        `data: {"type": "content_block_stop", "index": 0}\n`,
        `data: {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}\n`,
        `data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Solution: Success."}}\n`,
        `data: {"type": "content_block_stop", "index": 1}\n`,
        `data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 800, "thinking_tokens": 600}}\n`,
        `data: {"type": "message_stop"}\n`,
      ];

      const emittedEvents: PalStreamEvent[] = [];
      for (const line of sseStream) {
        emittedEvents.push(...parser.feed(line));
      }

      // Verify thought_delta events
      const thoughtEvents = emittedEvents.filter(
        (e): e is { type: "thought_delta"; thought: string; signature?: string } =>
          e.type === "thought_delta"
      );
      expect(thoughtEvents.length).toBe(3);
      expect(thoughtEvents[0]?.thought).toBe("Step 1: Check invariants. ");
      expect(thoughtEvents[1]?.thought).toBe("Step 2: Formulate solution.");
      expect(thoughtEvents[2]?.signature).toBe("sig_crypto_valid_hex_012345");

      // Verify text_delta event
      const textEvents = emittedEvents.filter((e) => e.type === "text_delta");
      expect(textEvents.length).toBe(1);
      expect(textEvents[0]?.text).toBe("Solution: Success.");

      // Verify token usage accumulation separation (Spec Invariant)
      const usage = parser.getUsage();
      expect(usage.promptTokens).toBe(500);
      expect(usage.thinkingTokens).toBe(600);
      expect(usage.completionTokens).toBe(200); // 800 - 600
      expect(usage.totalTokens).toBe(1300); // 500 + 200 + 600

      // Verify canonical message reconstruction preserving signature intact (Spec Section 4.4)
      const message = parser.toMessage();
      expect(message.content.length).toBe(2);

      const thoughtContent = message.content[0];
      expect(thoughtContent?.type).toBe(PAL_CONTENT_BLOCK_TYPES.THOUGHT);
      if (thoughtContent?.type === "thought") {
        expect(thoughtContent.text).toBe("Step 1: Check invariants. Step 2: Formulate solution.");
        expect(thoughtContent.signature).toBe("sig_crypto_valid_hex_012345");
      }

      const textContent = message.content[1];
      expect(textContent?.type).toBe(PAL_CONTENT_BLOCK_TYPES.TEXT);
      if (textContent?.type === "text") {
        expect(textContent.text).toBe("Solution: Success.");
      }
    });

    it("parses streaming tool invocations, streams json deltas, and auto-repairs arguments on stop", () => {
      const parser = new ClaudeStreamChunkParser();

      const sseStream = [
        `data: {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "toolu_abc_123", "name": "run_command", "input": {}}}\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "{\\"command\\": "}}\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "\\"bun test\\", "}}\n`,
        // Trailing comma to trigger JSON repair engine
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "\\"timeout\\": 5000,}"}}\n`,
        `data: {"type": "content_block_stop", "index": 0}\n`,
        `data: {"type": "message_delta", "delta": {"stop_reason": "tool_use"}}\n`,
        `data: {"type": "message_stop"}\n`,
      ];

      const emittedEvents: PalStreamEvent[] = [];
      for (const chunk of sseStream) {
        emittedEvents.push(...parser.feed(chunk));
      }

      const toolDeltas = emittedEvents.filter((e) => e.type === "tool_call_delta");
      expect(toolDeltas.length).toBe(3);
      expect(toolDeltas[0]?.id).toBe("toolu_abc_123");
      expect(toolDeltas[0]?.name).toBe("run_command");
      expect(toolDeltas[0]?.argumentsDelta).toBe('{"command": ');

      const toolEnds = emittedEvents.filter((e) => e.type === "tool_call_end");
      expect(toolEnds.length).toBe(1);
      const endEvent = toolEnds[0];
      expect(endEvent?.id).toBe("toolu_abc_123");
      expect(endEvent?.name).toBe("run_command");
      expect(endEvent?.arguments).toEqual({
        command: "bun test",
        timeout: 5000,
      });

      expect(parser.getFinishReason()).toBe(PAL_FINISH_REASONS.TOOL_CALLS);

      // Verify toMessage produces valid canonical PalToolCallContent
      const message = parser.toMessage();
      expect(message.content.length).toBe(1);
      const toolCallContent = message.content[0];
      expect(toolCallContent?.type).toBe(PAL_CONTENT_BLOCK_TYPES.TOOL_CALL);
      if (toolCallContent?.type === "tool_call") {
        expect(toolCallContent.id).toBe("toolu_abc_123");
        expect(toolCallContent.name).toBe("run_command");
        expect(toolCallContent.arguments).toEqual({
          command: "bun test",
          timeout: 5000,
        });
      }
    });

    it("manages multiple parallel streaming tool use blocks by index", () => {
      const parser = new ClaudeStreamChunkParser();

      const sseStream = [
        // Tool call 1 at index 1
        `data: {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "call_1", "name": "read_file"}}\n`,
        // Tool call 2 at index 2
        `data: {"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "call_2", "name": "edit_file"}}\n`,
        // Interleaved deltas
        `data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\\"path\\": \\"a.ts\\"}"}}\n`,
        `data: {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{\\"path\\": \\"b.ts\\"}"}}\n`,
        // Stops
        `data: {"type": "content_block_stop", "index": 1}\n`,
        `data: {"type": "content_block_stop", "index": 2}\n`,
        `data: {"type": "message_stop"}\n`,
      ];

      const emittedEvents: PalStreamEvent[] = [];
      for (const line of sseStream) {
        emittedEvents.push(...parser.feed(line));
      }

      const toolEnds = emittedEvents.filter(
        (e): e is { type: "tool_call_end"; id: string; name: string; arguments: Record<string, unknown> } =>
          e.type === "tool_call_end"
      );
      expect(toolEnds.length).toBe(2);
      expect(toolEnds[0]?.id).toBe("call_1");
      expect(toolEnds[0]?.name).toBe("read_file");
      expect(toolEnds[0]?.arguments).toEqual({ path: "a.ts" });

      expect(toolEnds[1]?.id).toBe("call_2");
      expect(toolEnds[1]?.name).toBe("edit_file");
      expect(toolEnds[1]?.arguments).toEqual({ path: "b.ts" });

      // Verify toMessage produces both tool call blocks
      const msg = parser.toMessage();
      expect(msg.content.length).toBe(2);
    });

    it("auto-finalizes unclosed tool use blocks when stream completes via message_stop or flush", () => {
      const parser = new ClaudeStreamChunkParser();

      // Tool call starts, receives arguments, but content_block_stop is missing before stream ends
      parser.feed(
        `data: {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "call_unclosed", "name": "fetch_url"}}\n`
      );
      parser.feed(
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "{\\"url\\": \\"https://example.com\\"}"}}\n`
      );

      // Stream terminates without content_block_stop
      const flushEvents = parser.flush();
      const toolEnds = flushEvents.filter((e) => e.type === "tool_call_end");
      expect(toolEnds.length).toBe(1);
      expect(toolEnds[0]?.id).toBe("call_unclosed");
      expect(toolEnds[0]?.name).toBe("fetch_url");
      expect(toolEnds[0]?.arguments).toEqual({ url: "https://example.com" });
    });

    it("maps wire error events to standardized PalError and halts stream", () => {
      const parser = new ClaudeStreamChunkParser();

      const events = parser.feed(
        `data: {"type": "error", "error": {"type": "overloaded_error", "message": "Anthropic upstream service is overloaded"}}\n`
      );

      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe("error");
      if (events[0]?.type === "error") {
        expect(events[0].error).toBeInstanceOf(PalError);
        expect(events[0].error.kind).toBe(PAL_ERROR_KINDS.OVERLOADED);
        expect(events[0].error.retryable).toBe(true);
        expect(events[0].error.message).toContain("Anthropic upstream service is overloaded");
      }
      expect(parser.isCompleted()).toBe(true);
    });

    it("ignores SSE comments, pings, [DONE] signal, and CRLF line breaks cleanly", () => {
      const parser = new ClaudeStreamChunkParser();

      const sseText = [
        ": keep-alive comment\r\n",
        "event: ping\r\n",
        "data: {\"type\": \"ping\"}\r\n\r\n",
        "data: [DONE]\r\n\r\n",
        "data: {\"type\": \"content_block_delta\", \"index\": 0, \"delta\": {\"type\": \"text_delta\", \"text\": \"clean\"}}\r\n",
      ].join("");

      const events = parser.feed(sseText);
      expect(events.length).toBe(1);
      expect(events[0]).toEqual({ type: "text_delta", text: "clean" });
    });

    it("parseClaudeStream generator parses async chunk iterables seamlessly", async () => {
      async function* generateChunks(): AsyncIterable<string> {
        yield `data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n`;
        yield `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Chunk 1; "}}\n`;
        yield `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Chunk 2."}}\n`;
        yield `data: {"type": "content_block_stop", "index": 0}\n`;
        yield `data: {"type": "message_stop"}\n`;
      }

      const events: PalStreamEvent[] = [];
      for await (const event of parseClaudeStream(generateChunks())) {
        events.push(event);
      }

      expect(events.length).toBe(3);
      expect(events[0]).toEqual({ type: "text_delta", text: "Chunk 1; " });
      expect(events[1]).toEqual({ type: "text_delta", text: "Chunk 2." });
      expect(events[2]?.type).toBe("turn_complete");
    });

    it("parseClaudeStreamChunk functional helper decodes single chunk synchronously", () => {
      const parser = new ClaudeStreamChunkParser();
      const events = parseClaudeStreamChunk(
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Instant chunk"}}\n`,
        parser
      );
      expect(events.length).toBe(1);
      expect(events[0]).toEqual({ type: "text_delta", text: "Instant chunk" });
    });

    it("dispatches events to optional onEvent listener callback", () => {
      const dispatched: PalStreamEvent[] = [];
      const parser = new ClaudeStreamChunkParser({
        onEvent: (ev) => dispatched.push(ev),
      });

      parser.feed(
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Callback test"}}\n`
      );

      expect(dispatched.length).toBe(1);
      expect(dispatched[0]).toEqual({ type: "text_delta", text: "Callback test" });
    });

    it("reset() restores parser state for clean reuse", () => {
      const parser = new ClaudeStreamChunkParser();
      parser.feed(
        `data: {"type": "message_start", "message": {"id": "msg_001", "model": "claude", "usage": {"input_tokens": 50, "output_tokens": 10}}}\n`
      );
      parser.feed(
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "text"}}\n`
      );
      parser.feed(`data: {"type": "message_stop"}\n`);

      expect(parser.isCompleted()).toBe(true);
      expect(parser.getMessageId()).toBe("msg_001");

      parser.reset();

      expect(parser.isCompleted()).toBe(false);
      expect(parser.getMessageId()).toBeUndefined();
      expect(parser.getModel()).toBeUndefined();
      expect(parser.getContentBlocks().length).toBe(0);
      expect(parser.getUsage().promptTokens).toBe(0);
    });

    it("End-to-end ClaudeAdapter.streamTurn streams tokens and tool calls from mock Response", async () => {
      const ssePayload = [
        `data: {"type": "message_start", "message": {"id": "msg_stream_e2e", "model": "claude-3-7-sonnet-20250219", "usage": {"input_tokens": 100, "output_tokens": 1}}}\n\n`,
        `data: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}\n\n`,
        `data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Analyzing code..."}}\n\n`,
        `data: {"type": "content_block_stop", "index": 0}\n\n`,
        `data: {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}\n\n`,
        `data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Ready to execute."}}\n\n`,
        `data: {"type": "content_block_stop", "index": 1}\n\n`,
        `data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 50, "thinking_tokens": 30}}\n\n`,
        `data: {"type": "message_stop"}\n\n`,
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const line of ssePayload) {
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        },
      });

      const mockFetch = (async () => {
        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "anthropic-ratelimit-requests-remaining": "995",
            "anthropic-ratelimit-tokens-remaining": "90000",
          },
        });
      }) as unknown as typeof fetch;

      const adapter = createClaudeAdapter({
        apiKey: "sk-stream-test",
        fetchFn: mockFetch,
      });

      const events: PalStreamEvent[] = [];
      for await (const event of adapter.streamTurn({
        sessionId: "sess_stream_e2e",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Execute turn")],
          }),
        ],
      })) {
        events.push(event);
      }

      expect(events.length).toBe(3);
      expect(events[0]).toEqual({ type: "thought_delta", thought: "Analyzing code..." });
      expect(events[1]).toEqual({ type: "text_delta", text: "Ready to execute." });
      expect(events[2]?.type).toBe("turn_complete");
      if (events[2]?.type === "turn_complete") {
        expect(events[2].finishReason).toBe(PAL_FINISH_REASONS.STOP);
        expect(events[2].usage.promptTokens).toBe(100);
        expect(events[2].usage.thinkingTokens).toBe(30);
        expect(events[2].usage.completionTokens).toBe(20); // 50 - 30
      }
    });
  });
});
