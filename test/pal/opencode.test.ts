import { describe, expect, it } from "bun:test";
import {
  OPENCODE_ADAPTER_CONSTANTS,
  OpenCodeAdapter,
  OpenCodeStreamChunkParser,
  buildOpenCodeCliArgs,
  calculateOpenAiTokenUsage,
  classifyOpenCodeFailure,
  createOpenCodeAdapter,
  formatOpenAiToolChoice,
  formatOpenAiTools,
  formatReActToolInstructions,
  formatSessionPromptForCli,
  isReActStreamTruncated,
  mapOpenAiFinishReason,
  openCodeModelArg,
  openCodePalAdapter,
  openCodePermission,
  parseOpenAiError,
  parseOpenAiRateLimitHeaders,
  parseOpenAiStream,
  repairTruncatedJson,
  runOpenCodeSubprocess,
  stitchTruncatedToolCall,
  streamOpenCodeSubprocess,
  toAsyncIterable,
  RECONTINUATION_PROMPT,
  type OpenCodeAdapterOptions,
  type OpenCodeSpawnedProcess,
  type OpenCodeSubprocessSpawnFn,
} from "../../src/pal/adapters/opencode";
import {
  REACT_PARSER_CONSTANTS,
  detectTruncatedReActTag,
  extractReActToolCalls,
  normalizeUnescapedStringValues,
  repairJsonArguments,
} from "../../src/pal/react_parser";
import {
  COGNITIVE_ROLES,
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
  isPalThoughtContent,
  isPalToolCallContent,
  isPalToolResultContent,
  type PalSessionOptions,
  type PalStreamEvent,
  type PalToolDefinition,
  type PalToolExecutionContext,
  type PalToolResultContent,
  type ProviderAdapter,
} from "../../src/pal/types";
import {
  MCP_BRIDGE_CONSTANTS,
  type McpCallToolResult,
  type McpToolSchema,
  InMemoryMcpClient,
  McpToolBridge,
  PalToolDispatcher,
  batchMcpToolsToPalTools,
  batchPalToolsToMcpTools,
  createInMemoryMcpClient,
  createMcpToolBridge,
  createPalToolDispatcher,
  defaultPalToolDispatcher,
  formatMcpCallToolResult,
  mcpToolToPalTool,
  palToolToMcpTool,
  validateToolArguments,
} from "../../src/pal/mcp";

describe("OpenCode & Local LLM Provider Adapter (LOOPER-PAL-004)", () => {
  describe("ProviderAdapter Interface & Protocol Conformance (Task 1.1)", () => {
    it("initializes with default options and adheres to ProviderAdapter interface", () => {
      const adapter = new OpenCodeAdapter();
      const providerAdapter: ProviderAdapter = adapter;

      expect(providerAdapter.providerName).toBe(PAL_PROVIDER_NAMES.OPENCODE);
      expect(adapter.providerName).toBe(PAL_PROVIDER_NAMES.OPENCODE);
      expect(adapter.modelName).toBe(OPENCODE_ADAPTER_CONSTANTS.DEFAULT_MODEL);
      expect(adapter.getBaseUrl()).toBe(OPENCODE_ADAPTER_CONSTANTS.DEFAULT_BASE_URL);
      expect(adapter.getTimeoutMs()).toBe(OPENCODE_ADAPTER_CONSTANTS.DEFAULT_TIMEOUT_MS);
      expect(adapter.getExecutionMode()).toBe("api");
      expect(adapter.isCliMode()).toBe(false);
      expect(adapter.getDefaultThinking()).toBeUndefined();
    });

    it("respects custom configuration options", () => {
      const customOptions: OpenCodeAdapterOptions = {
        modelName: "deepseek-coder-v2-lite",
        apiKey: "sk-local-test-key",
        baseUrl: "http://localhost:8000/v1",
        timeoutMs: 45_000,
        defaultHeaders: {
          "x-custom-header": "test-val",
        },
        executionMode: "cli",
        deniedBash: ["Bash(rm -rf *)"],
        maxContextTokens: 64_000,
        maxOutputTokens: 4_096,
        supportsNativeTools: false,
        supportsExtendedThinking: true,
      };

      const adapter = new OpenCodeAdapter(customOptions);
      expect(adapter.modelName).toBe("deepseek-coder-v2-lite");
      expect(adapter.getBaseUrl()).toBe("http://localhost:8000/v1");
      expect(adapter.getTimeoutMs()).toBe(45_000);
      expect(adapter.getExecutionMode()).toBe("cli");
      expect(adapter.isCliMode()).toBe(true);

      const headers = adapter.buildHeaders();
      expect(headers["authorization"]).toBe("Bearer sk-local-test-key");
      expect(headers["x-custom-header"]).toBe("test-val");

      const caps = adapter.getCapabilities();
      expect(caps.maxContextTokens).toBe(64_000);
      expect(caps.maxOutputTokens).toBe(4_096);
      expect(caps.supportsNativeTools).toBe(false);
      expect(caps.supportsExtendedThinking).toBe(true);
    });

    it("falls back to environment variables for API key and base URL", () => {
      const origApiKey = process.env.OPENCODE_API_KEY;
      const origBaseUrl = process.env.OPENCODE_BASE_URL;

      try {
        process.env.OPENCODE_API_KEY = "env-opencode-key";
        process.env.OPENCODE_BASE_URL = "http://env.opencode.local/v1";

        const adapter = new OpenCodeAdapter();
        const headers = adapter.buildHeaders();
        expect(headers["authorization"]).toBe("Bearer env-opencode-key");
        expect(adapter.getBaseUrl()).toBe("http://env.opencode.local/v1");
        expect(adapter.buildEndpointUrl()).toBe("http://env.opencode.local/v1/chat/completions");
      } finally {
        if (origApiKey !== undefined) {
          process.env.OPENCODE_API_KEY = origApiKey;
        } else {
          delete process.env.OPENCODE_API_KEY;
        }
        if (origBaseUrl !== undefined) {
          process.env.OPENCODE_BASE_URL = origBaseUrl;
        } else {
          delete process.env.OPENCODE_BASE_URL;
        }
      }
    });

    it("falls back to OPENAI_API_KEY and OPENAI_BASE_URL when OPENCODE_* are unset", () => {
      const origOpencodeKey = process.env.OPENCODE_API_KEY;
      const origOpencodeUrl = process.env.OPENCODE_BASE_URL;
      const origOpenaiKey = process.env.OPENAI_API_KEY;
      const origOpenaiUrl = process.env.OPENAI_BASE_URL;

      try {
        delete process.env.OPENCODE_API_KEY;
        delete process.env.OPENCODE_BASE_URL;
        process.env.OPENAI_API_KEY = "openai-fallback-key";
        process.env.OPENAI_BASE_URL = "http://openai-compat.local/v1";

        const adapter = new OpenCodeAdapter();
        expect(adapter.buildHeaders()["authorization"]).toBe("Bearer openai-fallback-key");
        expect(adapter.getBaseUrl()).toBe("http://openai-compat.local/v1");
      } finally {
        if (origOpencodeKey !== undefined) process.env.OPENCODE_API_KEY = origOpencodeKey;
        if (origOpencodeUrl !== undefined) process.env.OPENCODE_BASE_URL = origOpencodeUrl;
        if (origOpenaiKey !== undefined) {
          process.env.OPENAI_API_KEY = origOpenaiKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
        if (origOpenaiUrl !== undefined) {
          process.env.OPENAI_BASE_URL = origOpenaiUrl;
        } else {
          delete process.env.OPENAI_BASE_URL;
        }
      }
    });

    it("provides singleton openCodePalAdapter and factory createOpenCodeAdapter", () => {
      expect(openCodePalAdapter).toBeInstanceOf(OpenCodeAdapter);
      expect(openCodePalAdapter.providerName).toBe(PAL_PROVIDER_NAMES.OPENCODE);

      const created = createOpenCodeAdapter({ apiKey: "factory-key" });
      expect(created).toBeInstanceOf(OpenCodeAdapter);
      expect(created.buildHeaders()["authorization"]).toBe("Bearer factory-key");
    });

    it("switches execution mode between api and cli seamlessly", () => {
      const adapter = new OpenCodeAdapter();
      expect(adapter.getExecutionMode()).toBe("api");
      expect(adapter.isCliMode()).toBe(false);

      adapter.setExecutionMode("cli");
      expect(adapter.getExecutionMode()).toBe("cli");
      expect(adapter.isCliMode()).toBe(true);

      adapter.setExecutionMode("api");
      expect(adapter.getExecutionMode()).toBe("api");
      expect(adapter.isCliMode()).toBe(false);
    });

    it("getCapabilities() accurately reports provider capabilities", () => {
      const adapter = new OpenCodeAdapter({ modelName: "qwen2.5-coder-32b" });
      const caps = adapter.getCapabilities();

      expect(caps.providerName).toBe(PAL_PROVIDER_NAMES.OPENCODE);
      expect(caps.modelName).toBe("qwen2.5-coder-32b");
      expect(caps.maxContextTokens).toBe(OPENCODE_ADAPTER_CONSTANTS.MAX_CONTEXT_TOKENS);
      expect(caps.maxOutputTokens).toBe(OPENCODE_ADAPTER_CONSTANTS.MAX_OUTPUT_TOKENS);
      expect(caps.supportsNativeTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsExtendedThinking).toBe(true);
      expect(caps.supportsPromptCaching).toBe(false);
    });

    it("getRateLimitState() tracks rate limits and updates from response headers", () => {
      const adapter = new OpenCodeAdapter();
      const initialLimits = adapter.getRateLimitState();

      expect(initialLimits.requestsLimit).toBe(OPENCODE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_LIMIT);
      expect(initialLimits.requestsRemaining).toBe(OPENCODE_ADAPTER_CONSTANTS.INITIAL_REQUESTS_REMAINING);
      expect(initialLimits.tokensLimit).toBe(OPENCODE_ADAPTER_CONSTANTS.INITIAL_TOKENS_LIMIT);
      expect(initialLimits.tokensRemaining).toBe(OPENCODE_ADAPTER_CONSTANTS.INITIAL_TOKENS_REMAINING);
      expect(initialLimits.resetsAt).toBe(OPENCODE_ADAPTER_CONSTANTS.INITIAL_RESETS_AT);
    });
  });

  describe("Endpoint and Payload Formatting", () => {
    it("buildEndpointUrl handles trailing slashes and existing /chat/completions", () => {
      const adapter1 = new OpenCodeAdapter({ baseUrl: "http://localhost:11434/v1/" });
      expect(adapter1.buildEndpointUrl()).toBe("http://localhost:11434/v1/chat/completions");

      const adapter2 = new OpenCodeAdapter({ baseUrl: "http://localhost:11434/v1/chat/completions" });
      expect(adapter2.buildEndpointUrl()).toBe("http://localhost:11434/v1/chat/completions");
    });

    it("buildHeaders includes authorization only when apiKey is provided", () => {
      const adapterNoKey = new OpenCodeAdapter({ apiKey: "" });
      const headersNoKey = adapterNoKey.buildHeaders();
      expect(headersNoKey["content-type"]).toBe("application/json");
      expect(headersNoKey["authorization"]).toBeUndefined();

      const adapterWithKey = new OpenCodeAdapter({ apiKey: "secret-key" });
      const headersWithKey = adapterWithKey.buildHeaders();
      expect(headersWithKey["authorization"]).toBe("Bearer secret-key");
    });

    it("formatOpenAiTools maps PalToolDefinition array to OpenAI tool schema", () => {
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

      const formatted = formatOpenAiTools(tools);
      expect(formatted).toBeDefined();
      expect(formatted!.length).toBe(1);
      const firstTool = formatted![0]!;
      expect(firstTool.type).toBe("function");
      expect(firstTool.function.name).toBe("read_file");
      expect(firstTool.function.description).toBe("Read file contents");
      expect(firstTool.function.parameters.type).toBe("object");

      expect(formatOpenAiTools(undefined)).toBeUndefined();
      expect(formatOpenAiTools([])).toBeUndefined();
    });

    it("formatOpenAiToolChoice formats auto, none, required and specific tool choice", () => {
      expect(formatOpenAiToolChoice("auto")).toBe("auto");
      expect(formatOpenAiToolChoice("none")).toBe("none");
      expect(formatOpenAiToolChoice("required")).toBe("required");
      expect(formatOpenAiToolChoice({ type: "tool", toolName: "read_file" })).toEqual({
        type: "function",
        function: { name: "read_file" },
      });
      expect(formatOpenAiToolChoice(undefined)).toBeUndefined();
    });

    it("buildTurnPayload formats messages, tools, system prompt, and parameters", () => {
      const adapter = new OpenCodeAdapter({ modelName: "test-model" });
      const options: PalSessionOptions = {
        sessionId: "sess-123",
        systemPrompt: "You are a helpful assistant.",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Hello OpenCode")],
          }),
        ],
        temperature: 0.2,
        maxTokens: 2048,
        tools: [
          {
            name: "execute_cmd",
            description: "Run command",
            parameters: { type: "object", properties: {} },
            source: "native",
          },
        ],
        toolChoice: "auto",
      };

      const payload = adapter.buildTurnPayload(options, false);
      expect(payload.model).toBe("test-model");
      expect(payload.stream).toBe(false);
      expect(payload.temperature).toBe(0.2);
      expect(payload.max_tokens).toBe(2048);

      const msgs = payload.messages as Array<Record<string, unknown>>;
      expect(msgs.length).toBe(2);
      const msg0 = msgs[0]!;
      const msg1 = msgs[1]!;
      expect(msg0.role).toBe("system");
      expect(msg0.content).toBe("You are a helpful assistant.");
      expect(msg1.role).toBe("user");
      expect(msg1.content).toBe("Hello OpenCode");

      expect(payload.tools).toBeDefined();
      expect(payload.tool_choice).toBe("auto");
    });
  });

  describe("Error Parsing & Telemetry Accumulation", () => {
    it("parseOpenAiRateLimitHeaders parses rate limit metrics and reset times", () => {
      const headers = new Headers();
      headers.set("x-ratelimit-limit-requests", "200");
      headers.set("x-ratelimit-remaining-requests", "150");
      headers.set("x-ratelimit-limit-tokens", "50000");
      headers.set("x-ratelimit-remaining-tokens", "40000");
      headers.set("x-ratelimit-reset-requests", "12.5");

      const parsed = parseOpenAiRateLimitHeaders(headers);
      expect(parsed.requestsLimit).toBe(200);
      expect(parsed.requestsRemaining).toBe(150);
      expect(parsed.tokensLimit).toBe(50000);
      expect(parsed.tokensRemaining).toBe(40000);
      expect(parsed.resetsAt).toBeGreaterThan(Date.now());
    });

    it("parseOpenAiError classifies HTTP status codes into standardized PalError instances", () => {
      // 401 Unauthorized -> auth_failure
      const authErr = parseOpenAiError(401, { error: { message: "Invalid API key" } });
      expect(authErr).toBeInstanceOf(PalError);
      expect(authErr.kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
      expect(authErr.retryable).toBe(false);

      // 429 Too Many Requests -> rate_limit
      const rateErr = parseOpenAiError(429, { error: { message: "Rate limit reached" } });
      expect(rateErr.kind).toBe(PAL_ERROR_KINDS.RATE_LIMIT);
      expect(rateErr.retryable).toBe(true);

      // 503 Service Unavailable -> overloaded
      const overloadErr = parseOpenAiError(503, { error: { message: "Server overloaded" } });
      expect(overloadErr.kind).toBe(PAL_ERROR_KINDS.OVERLOADED);
      expect(overloadErr.retryable).toBe(true);

      // 408 Request Timeout -> timeout
      const timeoutErr = parseOpenAiError(408, { message: "Timed out" });
      expect(timeoutErr.kind).toBe(PAL_ERROR_KINDS.TIMEOUT);
      expect(timeoutErr.retryable).toBe(true);
    });

    it("mapOpenAiFinishReason maps OpenAI stop reasons cleanly", () => {
      expect(mapOpenAiFinishReason("stop")).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapOpenAiFinishReason("length")).toBe(PAL_FINISH_REASONS.LENGTH);
      expect(mapOpenAiFinishReason("tool_calls")).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
      expect(mapOpenAiFinishReason("function_call")).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
      expect(mapOpenAiFinishReason("content_filter")).toBe(PAL_FINISH_REASONS.CONTENT_FILTER);
      expect(mapOpenAiFinishReason("unknown_reason")).toBe(PAL_FINISH_REASONS.STOP);
      expect(mapOpenAiFinishReason("stop", true)).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
    });

    it("calculateOpenAiTokenUsage accumulates prompt, completion, and reasoning tokens", () => {
      const usage = calculateOpenAiTokenUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        completion_tokens_details: {
          reasoning_tokens: 20,
        },
        prompt_tokens_details: {
          cached_tokens: 30,
        },
      });

      expect(usage.promptTokens).toBe(100);
      expect(usage.completionTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.thinkingTokens).toBe(20);
      expect(usage.cachedPromptTokens).toBe(30);
    });
  });

  describe("API Mode Execution (executeTurn and streamTurn)", () => {
    it("executeTurn executes synchronously and returns canonical PalOutcome", async () => {
      const mockResponseData = {
        id: "chatcmpl-test-1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello! Here is the answer.",
              reasoning_content: "First think about the greeting.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 10,
          total_tokens: 25,
        },
      };

      const mockFetch = (async () => {
        return new Response(JSON.stringify(mockResponseData), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-remaining-requests": "999",
          },
        });
      }) as unknown as typeof fetch;

      const adapter = new OpenCodeAdapter({ fetchFn: mockFetch });
      const outcome = await adapter.executeTurn({
        sessionId: "turn-test",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Greet me")],
          }),
        ],
      });

      expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.STOP);
      expect(outcome.usage.promptTokens).toBe(15);
      expect(outcome.usage.completionTokens).toBe(10);
      expect(outcome.usage.totalTokens).toBe(25);

      const msg = outcome.message;
      expect(msg.role).toBe(PAL_ROLES.ASSISTANT);
      const thoughtBlock = msg.content.find(isPalThoughtContent);
      expect(thoughtBlock).toBeDefined();
      expect(thoughtBlock!.text).toBe("First think about the greeting.");

      const textBlock = msg.content.find(isPalTextContent);
      expect(textBlock).toBeDefined();
      expect(textBlock!.text).toBe("Hello! Here is the answer.");

      expect(outcome.rateLimitInfo?.requestsRemaining).toBe(999);
    });

    it("executeTurn handles HTTP errors and throws PalError", async () => {
      const mockFetch = (async () => {
        return new Response(
          JSON.stringify({ error: { message: "Invalid API authorization" } }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      const adapter = new OpenCodeAdapter({ fetchFn: mockFetch });
      expect(
        adapter.executeTurn({
          sessionId: "error-test",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Test")],
            }),
          ],
        })
      ).rejects.toThrow(PalError);
    });

    it("streamTurn parses SSE stream and yields thought, text, tool calls, and completion", async () => {
      const sseChunks = [
        `data: {"choices":[{"delta":{"reasoning_content":"Thinking deeply..."}}]}\n\n`,
        `data: {"choices":[{"delta":{"content":"Let me "}}]}\n\n`,
        `data: {"choices":[{"delta":{"content":"run that."}}]}\n\n`,
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_01","type":"function","function":{"name":"search","arguments":"{\\"q\\": "}}]}}]}\n\n`,
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]}}]}\n\n`,
        `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":15,"total_tokens":35}}\n\n`,
        `data: [DONE]\n\n`,
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      const mockFetch = (async () => {
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as unknown as typeof fetch;

      const adapter = new OpenCodeAdapter({ fetchFn: mockFetch });
      const events: PalStreamEvent[] = [];

      for await (const ev of adapter.streamTurn({
        sessionId: "stream-test",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Search for test")],
          }),
        ],
      })) {
        events.push(ev);
      }

      const thoughtEvents = events.filter((e) => e.type === "thought_delta");
      expect(thoughtEvents.length).toBe(1);
      const thought0 = thoughtEvents[0];
      expect(thought0).toBeDefined();
      if (thought0 && thought0.type === "thought_delta") {
        expect(thought0.thought).toBe("Thinking deeply...");
      }

      const textEvents = events.filter((e) => e.type === "text_delta");
      expect(textEvents.length).toBe(2);

      const toolDeltaEvents = events.filter((e) => e.type === "tool_call_delta");
      expect(toolDeltaEvents.length).toBe(2);

      const toolEndEvents = events.filter((e) => e.type === "tool_call_end");
      expect(toolEndEvents.length).toBe(1);
      const tool0 = toolEndEvents[0];
      expect(tool0).toBeDefined();
      if (tool0 && tool0.type === "tool_call_end") {
        expect(tool0.id).toBe("call_01");
        expect(tool0.name).toBe("search");
        expect(tool0.arguments).toEqual({ q: "test" });
      }

      const completeEvents = events.filter((e) => e.type === "turn_complete");
      expect(completeEvents.length).toBe(1);
      const complete0 = completeEvents[0];
      expect(complete0).toBeDefined();
      if (complete0 && complete0.type === "turn_complete") {
        expect(complete0.finishReason).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
        expect(complete0.usage.totalTokens).toBe(35);
      }
    });
  });

  describe("OpenCode CLI Subprocessing & Helper Integration", () => {
    it("openCodeModelArg resolves variant reasoning effort or falls back to default", () => {
      expect(openCodeModelArg(undefined, undefined)).toBe(OPENCODE_ADAPTER_CONSTANTS.DEFAULT_MODEL);
      expect(openCodeModelArg("deepseek-coder", "high")).toBe("deepseek-coder#high");
      expect(openCodeModelArg("deepseek-coder#medium", "high")).toBe("deepseek-coder#medium");
      expect(openCodeModelArg("deepseek-coder", "none")).toBe("deepseek-coder");
    });

    it("openCodePermission converts deny bash rules to OpenCode permissions", () => {
      const perms = openCodePermission(["Bash(git push *)", "Bash(rm -rf /)"]);
      expect(perms.edit).toBe("allow");
      expect(perms.webfetch).toBe("allow");
      expect(perms.bash["*"]).toBe("allow");
      expect(perms.bash["git push *"]).toBe("deny");
      expect(perms.bash["rm -rf /"]).toBe("deny");
    });

    it("classifyOpenCodeFailure identifies fatal, paused, and error categories", () => {
      expect(classifyOpenCodeFailure("unauthorized: provider.auth failed")).toBe("fatal");
      expect(classifyOpenCodeFailure("429 Too many requests - rate limit")).toBe("paused");
      expect(classifyOpenCodeFailure("command timed out unexpectedly")).toBe("error");
    });

    it("buildOpenCodeCliArgs produces structured CLI argument array", () => {
      const args = buildOpenCodeCliArgs({
        model: "deepseek-coder",
        prompt: "Fix the bug",
        session: "sess-abc",
        title: "test-title",
      });

      expect(args).toEqual([
        "opencode",
        "run",
        "--format",
        "json",
        "--auto",
        "--model",
        "deepseek-coder",
        "--title",
        "test-title",
        "--session",
        "sess-abc",
        "Fix the bug",
      ]);
    });

    it("formatSessionPromptForCli extracts clean prompt text from messages", () => {
      const options: PalSessionOptions = {
        sessionId: "cli-prompt",
        systemPrompt: "System rules",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("User prompt 1")],
          }),
        ],
      };

      const prompt = formatSessionPromptForCli(options);
      expect(prompt).toContain("System rules");
      expect(prompt).toContain("User prompt 1");
    });

    it("OpenCodeAdapter in cli mode executes runOpenCodeSubprocess and returns PalOutcome", async () => {
      const mockSpawn: OpenCodeSubprocessSpawnFn = (argv, options) => {
        const lines = [
          JSON.stringify({ part: { type: "text", id: "t1", text: "Subprocess output" } }),
          JSON.stringify({ part: { type: "step-finish", cost: 0.005 } }),
        ];

        const stdout = new ReadableStream({
          start(controller) {
            for (const line of lines) {
              controller.enqueue(new TextEncoder().encode(`${line}\n`));
            }
            controller.close();
          },
        });

        return {
          stdout,
          stderr: null,
          exited: Promise.resolve(0),
        };
      };

      const adapter = new OpenCodeAdapter({
        executionMode: "cli",
        spawnFn: mockSpawn,
      });

      expect(adapter.isCliMode()).toBe(true);
      const outcome = await adapter.executeTurn({
        sessionId: "cli-turn",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Run task")],
          }),
        ],
      });

      expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.STOP);
      expect(outcome.message.role).toBe(PAL_ROLES.ASSISTANT);
      const textBlock = outcome.message.content.find(isPalTextContent);
      expect(textBlock).toBeDefined();
      expect(textBlock!.text).toBe("Subprocess output");
    });
  });

  describe("ReAct Text Fallback Parser and JSON Auto-Repair (Task 1.2)", () => {
    describe("JSON Auto-Repair (repairJsonArguments & normalizeUnescapedStringValues)", () => {
      it("repairs code generation payloads with unescaped internal double quotes", () => {
        const raw =
          '{"name": "write_to_file", "arguments": {"path": "test.js", "content": "console.log("hello world");"}}';
        const parsed = repairJsonArguments(raw);
        expect(parsed.name).toBe("write_to_file");
        expect(typeof parsed.arguments).toBe("object");
        const args = parsed.arguments as Record<string, unknown>;
        expect(args.path).toBe("test.js");
        expect(args.content).toBe('console.log("hello world");');
      });

      it("repairs unescaped quotes with internal commas in strings", () => {
        const raw =
          '{"name": "write_to_file", "arguments": {"path": "test.js", "content": "console.log("hello, world");"}}';
        const parsed = repairJsonArguments(raw);
        const args = parsed.arguments as Record<string, unknown>;
        expect(args.content).toBe('console.log("hello, world");');
      });

      it("normalizes literal newlines and tabs within JSON string values", () => {
        const raw =
          '{\n  "name": "write_to_file",\n  "arguments": {\n    "path": "test.txt",\n    "content": "line 1\nline 2\n\tline 3"\n  }\n}';
        const parsed = repairJsonArguments(raw);
        const args = parsed.arguments as Record<string, unknown>;
        expect(args.content).toBe("line 1\nline 2\n\tline 3");
      });

      it("normalizes single-quoted keys and string values", () => {
        const raw = "{'name': 'edit_file', 'arguments': {'path': 'src/index.ts'}}";
        const parsed = repairJsonArguments(raw);
        expect(parsed.name).toBe("edit_file");
        expect((parsed.arguments as Record<string, unknown>).path).toBe("src/index.ts");
      });

      it("normalizes unquoted object keys", () => {
        const raw = '{name: "readFile", arguments: {path: "package.json"}}';
        const parsed = repairJsonArguments(raw);
        expect(parsed.name).toBe("readFile");
        expect((parsed.arguments as Record<string, unknown>).path).toBe("package.json");
      });

      it("normalizes Python literals True, False, None to valid JSON types", () => {
        const raw =
          '{"name": "configure", "arguments": {"active": True, "dryRun": False, "details": None}}';
        const parsed = repairJsonArguments(raw);
        const args = parsed.arguments as Record<string, unknown>;
        expect(args.active).toBe(true);
        expect(args.dryRun).toBe(false);
        expect(args.details).toBeNull();
      });

      it("removes trailing commas before closing braces and brackets", () => {
        const raw = '{"name": "test", "arguments": {"items": [1, 2, ], "flag": true, }, }';
        const parsed = repairJsonArguments(raw);
        const args = parsed.arguments as Record<string, unknown>;
        expect(args.items).toEqual([1, 2]);
        expect(args.flag).toBe(true);
      });
    });

    describe("Truncated JSON Auto-Repair (repairTruncatedJson)", () => {
      it("repairs truncated strings by closing quotes and parent objects", () => {
        const truncated =
          '{"name": "write_file", "arguments": {"path": "src/app.ts", "content": "export function foo';
        const repaired = repairTruncatedJson(truncated);
        const parsed = JSON.parse(repaired);
        expect(parsed.name).toBe("write_file");
        expect(parsed.arguments.path).toBe("src/app.ts");
        expect(parsed.arguments.content).toBe("export function foo");
      });

      it("repairs truncated arrays by closing brackets and parent objects", () => {
        const truncated = '{"files": ["index.ts", "package.json"';
        const repaired = repairTruncatedJson(truncated);
        const parsed = JSON.parse(repaired);
        expect(parsed.files).toEqual(["index.ts", "package.json"]);
      });

      it("handles dangling colon at point of truncation", () => {
        const truncated = '{"status": "in_progress", "result": ';
        const repaired = repairTruncatedJson(truncated);
        const parsed = JSON.parse(repaired);
        expect(parsed.status).toBe("in_progress");
        expect(parsed.result).toBeNull();
      });

      it("handles trailing comma before closing truncated objects", () => {
        const truncated = '{"name": "run", "arguments": {"cmd": "ls", ';
        const repaired = repairTruncatedJson(truncated);
        const parsed = JSON.parse(repaired);
        expect(parsed.name).toBe("run");
        expect(parsed.arguments.cmd).toBe("ls");
      });

      it("handles unclosed key in truncated objects", () => {
        const truncated = '{"name": "run", "arguments": {"cmd';
        const repaired = repairTruncatedJson(truncated);
        const parsed = JSON.parse(repaired);
        expect(parsed.name).toBe("run");
        expect(parsed.arguments.cmd).toBeNull();
      });
    });

    describe("ReAct Fallback Tool Call Extraction (extractReActToolCalls)", () => {
      it("extracts command parameters from raw markdown code block (Spec Scenario)", () => {
        const markdown = [
          "I will inspect the files in the directory:",
          "```json",
          "{",
          '  "name": "run_command",',
          '  "arguments": {',
          '    "CommandLine": "bun test"',
          "  }",
          "}",
          "```",
          "Let me know if you would like me to proceed.",
        ].join("\n");

        const { toolCalls, cleanText } = extractReActToolCalls(markdown);
        expect(toolCalls.length).toBe(1);
        expect(toolCalls[0]?.type).toBe("tool_call");
        expect(toolCalls[0]?.name).toBe("run_command");
        expect(toolCalls[0]?.arguments).toEqual({ CommandLine: "bun test" });
        expect(cleanText).toContain("I will inspect the files in the directory:");
        expect(cleanText).toContain("Let me know if you would like me to proceed.");
        expect(cleanText).not.toContain("```json");
      });

      it("extracts tool call from ```tool_call code fence", () => {
        const text = [
          "```tool_call",
          "{",
          '  "tool": "readFile",',
          '  "parameters": {',
          '    "path": "README.md"',
          "  }",
          "}",
          "```",
        ].join("\n");

        const { toolCalls } = extractReActToolCalls(text);
        expect(toolCalls.length).toBe(1);
        expect(toolCalls[0]?.name).toBe("readFile");
        expect(toolCalls[0]?.arguments).toEqual({ path: "README.md" });
      });

      it("extracts tool call from standard <tool_call> tags and cleans conversational text", () => {
        const text =
          'Checking status:\n<tool_call>{"name": "git_status", "arguments": {"verbose": true}}</tool_call>\nAll done.';
        const { toolCalls, cleanText } = extractReActToolCalls(text);
        expect(toolCalls.length).toBe(1);
        expect(toolCalls[0]?.name).toBe("git_status");
        expect(toolCalls[0]?.arguments).toEqual({ verbose: true });
        expect(cleanText).toBe("Checking status:\n\nAll done.");
      });

      it("extracts multiple tool calls from array in markdown block", () => {
        const text = [
          "```json",
          "[",
          '  {"name": "tool1", "arguments": {"step": 1}},',
          '  {"name": "tool2", "arguments": {"step": 2}}',
          "]",
          "```",
        ].join("\n");

        const { toolCalls } = extractReActToolCalls(text);
        expect(toolCalls.length).toBe(2);
        expect(toolCalls[0]?.name).toBe("tool1");
        expect(toolCalls[0]?.arguments).toEqual({ step: 1 });
        expect(toolCalls[1]?.name).toBe("tool2");
        expect(toolCalls[1]?.arguments).toEqual({ step: 2 });
      });

      it("extracts classic ReAct Action / Action Input syntax", () => {
        const text = [
          "Thought: I need to read the project configuration.",
          "Action: readFile",
          'Action Input: {"path": "package.json"}',
        ].join("\n");

        const { toolCalls, cleanText } = extractReActToolCalls(text);
        expect(toolCalls.length).toBe(1);
        expect(toolCalls[0]?.name).toBe("readFile");
        expect(toolCalls[0]?.arguments).toEqual({ path: "package.json" });
        expect(cleanText).toContain("Thought: I need to read the project configuration.");
      });

      it("extracts unclosed <tool_call> tag on stream truncation", () => {
        const text =
          'Running command:\n<tool_call>{"name": "execute", "arguments": {"cmd": "bun run build"';
        const { toolCalls, isTruncated, unclosedFragment } =
          extractReActToolCalls(text);
        expect(isTruncated).toBe(true);
        expect(unclosedFragment).toBeDefined();
        expect(toolCalls.length).toBe(1);
        expect(toolCalls[0]?.name).toBe("execute");
        expect(toolCalls[0]?.arguments).toEqual({ cmd: "bun run build" });
      });
    });

    describe("Stream Truncation Watchdog", () => {
      it("detects unclosed <tool_call> in stream buffer with detectTruncatedReActTag", () => {
        const buffer =
          'Some output\n<tool_call>{"name": "write_file", "arguments": {"content": "abc"';
        const detection = detectTruncatedReActTag(buffer);
        expect(detection.isTruncated).toBe(true);
        expect(detection.tagContent).toContain('"content": "abc"');
      });

      it("returns isTruncated false when all <tool_call> tags are properly closed", () => {
        const buffer =
          'Some output\n<tool_call>{"name": "write_file"}</tool_call>\nAll done.';
        const detection = detectTruncatedReActTag(buffer);
        expect(detection.isTruncated).toBe(false);
      });

      it("checks truncation state with isReActStreamTruncated helper", () => {
        expect(isReActStreamTruncated("<tool_call>unclosed")).toBe(true);
        expect(isReActStreamTruncated("<tool_call>closed</tool_call>")).toBe(false);
        expect(isReActStreamTruncated("regular text without tool calls")).toBe(false);
      });

      it("stitches truncated stream fragment with continuation prompt output", () => {
        const first =
          '<tool_call>{"name": "write", "arguments": {"text": "hello ';
        const continuation = 'world"}}</tool_call>';
        const stitched = stitchTruncatedToolCall(first, continuation);
        const { toolCalls } = extractReActToolCalls(stitched);
        expect(toolCalls.length).toBe(1);
        expect(toolCalls[0]?.name).toBe("write");
        expect(toolCalls[0]?.arguments).toEqual({ text: "hello world" });
      });

      it("provides standardized RECONTINUATION_PROMPT matching looper contracts", () => {
        expect(RECONTINUATION_PROMPT).toContain(
          "[SYSTEM] Your previous JSON tool call was truncated"
        );
        expect(RECONTINUATION_PROMPT).toContain("</tool_call>");
      });
    });

    describe("formatReActToolInstructions", () => {
      it("formats PalToolDefinition array into system prompt instructions", () => {
        const tools: PalToolDefinition[] = [
          {
            name: "readFile",
            description: "Read file contents from filesystem",
            source: "native",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Path to file" },
              },
              required: ["path"],
            },
          },
        ];

        const instructions = formatReActToolInstructions(tools);
        expect(instructions).toContain("# Available Tools");
        expect(instructions).toContain("readFile");
        expect(instructions).toContain("Read file contents from filesystem");
        expect(instructions).toContain("<tool_call>");
        expect(instructions).toContain("```json");
      });

      it("returns empty string when tools array is empty", () => {
        expect(formatReActToolInstructions([])).toBe("");
      });
    });

    describe("OpenCodeAdapter Non-Native Tool Calling Integration", () => {
      it("injects ReAct tool instructions into system message when supportsNativeTools is false", () => {
        const adapter = new OpenCodeAdapter({
          supportsNativeTools: false,
        });

        const tools: PalToolDefinition[] = [
          {
            name: "grepSearch",
            description: "Search pattern in codebase",
            source: "native",
            parameters: {
              type: "object",
              properties: {
                pattern: { type: "string" },
              },
            },
          },
        ];

        const payload = (
          adapter as unknown as {
            buildTurnPayload: (
              options: PalSessionOptions,
              isStream: boolean
            ) => Record<string, unknown>;
          }
        ).buildTurnPayload(
          {
            sessionId: "test-non-native",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Find all usages")],
              }),
            ],
            tools,
          },
          false
        );

        expect(payload.tools).toBeUndefined();
        expect(payload.tool_choice).toBeUndefined();

        const messages = payload.messages as Array<{
          role: string;
          content: string;
        }>;
        const sysMsg = messages.find((m) => m.role === PAL_ROLES.SYSTEM);
        expect(sysMsg).toBeDefined();
        expect(sysMsg!.content).toContain("grepSearch");
        expect(sysMsg!.content).toContain("<tool_call>");
      });

      it("executeTurn extracts tool calls from raw markdown code block when supportsNativeTools is false", async () => {
        const mockFetch = (async () => {
          const body = {
            id: "chatcmpl-react-1",
            object: "chat.completion",
            model: "llama-3-8b",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content:
                    'I will read the file.\n```json\n{\n  "name": "readFile",\n  "arguments": {\n    "path": "test.txt"\n  }\n}\n```\nDone.',
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 30,
              total_tokens: 80,
            },
          };

          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as unknown as typeof fetch;

        const adapter = new OpenCodeAdapter({
          supportsNativeTools: false,
          fetchFn: mockFetch,
        });

        const outcome = await adapter.executeTurn({
          sessionId: "test-react-exec",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Please read test.txt")],
            }),
          ],
        });

        expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
        const toolCall = outcome.message.content.find(isPalToolCallContent);
        expect(toolCall).toBeDefined();
        expect(toolCall!.name).toBe("readFile");
        expect(toolCall!.arguments).toEqual({ path: "test.txt" });

        const textBlock = outcome.message.content.find(isPalTextContent);
        expect(textBlock).toBeDefined();
        expect(textBlock!.text).toContain("I will read the file.");
      });

      it("streamTurn extracts tool calls from raw markdown in streaming text", async () => {
        const toolMarkdown =
          'the file:\n```json\n{\n  "name": "create_file",\n  "arguments": {\n    "path": "foo.ts"\n  }\n}\n```';

        const streamLines = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "I am creating " } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: toolMarkdown } }] })}\n\n`,
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 20, completion_tokens: 25, total_tokens: 45 },
          })}\n\n`,
          "data: [DONE]\n\n",
        ];

        const mockFetch = (async () => {
          const stream = new ReadableStream({
            start(controller) {
              for (const line of streamLines) {
                controller.enqueue(new TextEncoder().encode(line));
              }
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }) as unknown as typeof fetch;

        const adapter = new OpenCodeAdapter({
          supportsNativeTools: false,
          fetchFn: mockFetch,
        });

        const events: PalStreamEvent[] = [];
        for await (const event of adapter.streamTurn({
          sessionId: "test-stream-react",
          messages: [
            createPalMessage({
              role: PAL_ROLES.USER,
              content: [createTextBlock("Create foo.ts")],
            }),
          ],
        })) {
          events.push(event);
        }

        const toolCallEnd = events.find((e) => e.type === "tool_call_end");
        expect(toolCallEnd).toBeDefined();
        if (toolCallEnd && toolCallEnd.type === "tool_call_end") {
          expect(toolCallEnd.name).toBe("create_file");
          expect(toolCallEnd.arguments).toEqual({ path: "foo.ts" });
        }

        const turnComplete = events.find((e) => e.type === "turn_complete");
        expect(turnComplete).toBeDefined();
        if (turnComplete && turnComplete.type === "turn_complete") {
          expect(turnComplete.finishReason).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
        }
      });
    });

    describe("MCP Tool Schema Bridge and Execution Dispatcher (Task 1.3)", () => {
      const createTestContext = (
        overrides?: Partial<PalToolExecutionContext>
      ): PalToolExecutionContext => ({
        agentId: "test-agent-1",
        role: COGNITIVE_ROLES.WORKER,
        workingDirectory: "/workspace",
        logger: () => {},
        ...overrides,
      });

      describe("MCP Schema Bridge (mcpToolToPalTool & palToolToMcpTool)", () => {
        it("translates standard McpToolSchema to canonical PalToolDefinition", () => {
          const mcpTool: McpToolSchema = {
            name: "read_file",
            description: "Read contents of a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string", description: "Absolute file path" },
                encoding: { type: "string", default: "utf-8" },
              },
              required: ["filePath"],
              additionalProperties: false,
            },
          };

          const palTool = mcpToolToPalTool(mcpTool, {
            serverName: "filesystem",
            defaultTimeoutMs: 15_000,
          });

          expect(palTool.name).toBe("read_file");
          expect(palTool.description).toBe("Read contents of a file from disk");
          expect(palTool.source).toBe("mcp");
          expect(palTool.mcpServerName).toBe("filesystem");
          expect(palTool.timeoutMs).toBe(15_000);
          expect(palTool.parameters.type).toBe("object");
          expect(palTool.parameters.properties).toHaveProperty("filePath");
          expect(palTool.parameters.required).toEqual(["filePath"]);
          expect(palTool.parameters.additionalProperties).toBe(false);
        });

        it("prefixes server name when prefixServerName option is true", () => {
          const mcpTool: McpToolSchema = {
            name: "create_issue",
            description: "Create an issue on GitHub",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
              },
              required: ["title"],
            },
          };

          const palTool = mcpToolToPalTool(mcpTool, {
            serverName: "github",
            prefixServerName: true,
          });

          expect(palTool.name).toBe("github__create_issue");
          expect(palTool.mcpServerName).toBe("github");
        });

        it("converts canonical PalToolDefinition back to McpToolSchema", () => {
          const palTool: PalToolDefinition = {
            name: "search_code",
            description: "Search symbols in code",
            source: "mcp",
            mcpServerName: "code-server",
            timeoutMs: 10_000,
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              additionalProperties: true,
            },
          };

          const mcpTool = palToolToMcpTool(palTool);
          expect(mcpTool.name).toBe("search_code");
          expect(mcpTool.description).toBe("Search symbols in code");
          expect(mcpTool.inputSchema.type).toBe("object");
          expect(mcpTool.inputSchema.properties).toEqual({ query: { type: "string" } });
          expect(mcpTool.inputSchema.required).toEqual(["query"]);
          expect(mcpTool.inputSchema.additionalProperties).toBe(true);
        });

        it("converts batches of tools bidirectionally", () => {
          const mcpTools: McpToolSchema[] = [
            {
              name: "tool_a",
              description: "A",
              inputSchema: { type: "object", properties: { a: { type: "string" } } },
            },
            {
              name: "tool_b",
              description: "B",
              inputSchema: { type: "object", properties: { b: { type: "number" } } },
            },
          ];

          const palTools = batchMcpToolsToPalTools(mcpTools, { serverName: "srv" });
          expect(palTools.length).toBe(2);
          expect(palTools[0]!.name).toBe("tool_a");
          expect(palTools[1]!.name).toBe("tool_b");

          const roundtripped = batchPalToolsToMcpTools(palTools);
          expect(roundtripped.length).toBe(2);
          expect(roundtripped[0]!.name).toBe("tool_a");
          expect(roundtripped[1]!.name).toBe("tool_b");

          expect(batchMcpToolsToPalTools([])).toEqual([]);
          expect(batchPalToolsToMcpTools([])).toEqual([]);
        });
      });

      describe("Parameter Schema Validation (validateToolArguments)", () => {
        const schema = {
          type: "object" as const,
          properties: {
            text: { type: "string" },
            count: { type: "number" },
            flag: { type: "boolean" },
            items: { type: "array" },
            nested: { type: "object" },
          },
          required: ["text", "count"],
          additionalProperties: false,
        };

        it("accepts valid arguments satisfying required fields and types", () => {
          const res = validateToolArguments(schema, {
            text: "hello",
            count: 42,
            flag: true,
            items: [1, 2],
            nested: { k: "v" },
          });
          expect(res.valid).toBe(true);
          expect(res.errors.length).toBe(0);
        });

        it("detects missing required fields", () => {
          const res = validateToolArguments(schema, {
            text: "hello",
          });
          expect(res.valid).toBe(false);
          expect(res.errors.some((e) => e.includes("Missing required property: 'count'"))).toBe(true);
        });

        it("detects type mismatch errors", () => {
          const res = validateToolArguments(schema, {
            text: 123 as unknown as string,
            count: "not-a-number" as unknown as number,
          });
          expect(res.valid).toBe(false);
          expect(res.errors.some((e) => e.includes("must be a string"))).toBe(true);
          expect(res.errors.some((e) => e.includes("must be a number"))).toBe(true);
        });

        it("rejects unknown properties when additionalProperties is false", () => {
          const res = validateToolArguments(schema, {
            text: "valid",
            count: 1,
            unrecognized: "bad",
          });
          expect(res.valid).toBe(false);
          expect(res.errors.some((e) => e.includes("Additional property 'unrecognized' is not allowed"))).toBe(true);
        });
      });

      describe("Result Formatting (formatMcpCallToolResult)", () => {
        it("formats string result", () => {
          const res = formatMcpCallToolResult("simple string output");
          expect(res.content).toBe("simple string output");
          expect(res.isError).toBe(false);
        });

        it("formats structured McpCallToolResult with text, image, and resource parts", () => {
          const mcpResult: McpCallToolResult = {
            content: [
              { type: "text", text: "Report generation complete." },
              { type: "image", data: "base64payload", mimeType: "image/png" },
              {
                type: "resource",
                resource: { uri: "file:///workspace/out.log", text: "log contents" },
              },
            ],
            isError: false,
          };

          const res = formatMcpCallToolResult(mcpResult);
          expect(res.isError).toBe(false);
          expect(res.content).toContain("Report generation complete.");
          expect(res.content).toContain("[Image: image/png]");
          expect(res.content).toContain("[Resource: file:///workspace/out.log - log contents]");
        });

        it("preserves isError flag on tool error outcome", () => {
          const mcpResult: McpCallToolResult = {
            content: [{ type: "text", text: "Database connection failed." }],
            isError: true,
          };

          const res = formatMcpCallToolResult(mcpResult);
          expect(res.isError).toBe(true);
          expect(res.content).toBe("Database connection failed.");
        });
      });

      describe("InMemoryMcpClient", () => {
        it("registers tools and executes handlers", async () => {
          const client = createInMemoryMcpClient("test-mcp");
          client.addTool(
            {
              name: "echo",
              description: "Echo back message",
              inputSchema: { type: "object", properties: { msg: { type: "string" } } },
            },
            async (args) => `Echo: ${args.msg}`
          );

          const tools = await client.listTools();
          expect(tools.length).toBe(1);
          expect(tools[0]!.name).toBe("echo");

          const callRes = await client.callTool("echo", { msg: "ping" });
          expect(callRes.isError).toBe(false);
          if (Array.isArray(callRes.content) && callRes.content[0]) {
            const first = callRes.content[0];
            expect(first.type).toBe("text");
            if (first.type === "text") {
              expect(first.text).toBe("Echo: ping");
            }
          }
        });

        it("returns error for unknown tool", async () => {
          const client = new InMemoryMcpClient("srv");
          const callRes = await client.callTool("non_existent", {});
          expect(callRes.isError).toBe(true);
        });

        it("handles client cancellation via AbortSignal", async () => {
          const client = new InMemoryMcpClient("srv");
          client.addTool(
            { name: "slow", inputSchema: { type: "object" } },
            async () => "done"
          );

          const controller = new AbortController();
          controller.abort("User cancelled");

          const callRes = await client.callTool("slow", {}, { abortSignal: controller.signal });
          expect(callRes.isError).toBe(true);
        });
      });

      describe("McpToolBridge Registry", () => {
        it("registers servers and discovers tool definitions", async () => {
          const bridge = createMcpToolBridge();
          const client = createInMemoryMcpClient("fs-server");
          client.addTool(
            {
              name: "read_dir",
              description: "List directory files",
              inputSchema: { type: "object", properties: { dir: { type: "string" } } },
            },
            async (args) => `Files in ${args.dir}: a.txt, b.txt`
          );

          bridge.registerServer(client, { prefixServerName: true });
          expect(bridge.hasServer("fs-server")).toBe(true);
          expect(bridge.listServers()).toEqual(["fs-server"]);

          const tools = await bridge.discoverTools();
          expect(tools.length).toBe(1);
          expect(tools[0]!.name).toBe("fs-server__read_dir");
          expect(tools[0]!.source).toBe("mcp");
          expect(tools[0]!.mcpServerName).toBe("fs-server");

          const handler = bridge.createPalToolHandler("fs-server__read_dir");
          const context = createTestContext();
          const output = await handler({ dir: "/tmp" }, context);
          expect(output).toContain("Files in /tmp");
        });

        it("unregisters servers and purges tools cleanly", async () => {
          const bridge = new McpToolBridge();
          const client = createInMemoryMcpClient("temp-server");
          client.addTool(
            { name: "noop", inputSchema: { type: "object" } },
            async () => "ok"
          );

          bridge.registerServer(client);
          await bridge.discoverTools();
          expect(bridge.getAllToolDefinitions().length).toBe(1);

          const unregistered = bridge.unregisterServer("temp-server");
          expect(unregistered).toBe(true);
          expect(bridge.hasServer("temp-server")).toBe(false);
          expect(bridge.getAllToolDefinitions().length).toBe(0);
        });
      });

      describe("PalToolDispatcher Lifecycle & Robust Execution", () => {
        it("registers and executes a native tool successfully", async () => {
          const dispatcher = createPalToolDispatcher();
          const toolDef: PalToolDefinition = {
            name: "calculate_sum",
            description: "Adds two numbers",
            source: "native",
            parameters: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          };

          dispatcher.registerNativeTool(toolDef, async (args) => {
            const sum = (args.a as number) + (args.b as number);
            return { sum };
          });

          expect(dispatcher.hasTool("calculate_sum")).toBe(true);
          expect(dispatcher.getNativeTools().length).toBe(1);

          const call = createToolCallBlock("call-1", "calculate_sum", { a: 10, b: 20 });
          const context = createTestContext();

          const result = await dispatcher.dispatch(call, context);
          expect(result.toolCallId).toBe("call-1");
          expect(result.toolName).toBe("calculate_sum");
          expect(result.isError).toBe(false);
          expect(result.durationMs).toBeGreaterThanOrEqual(0);
          expect(result.content).toContain('"sum": 30');
        });

        it("returns structured error for unregistered tool", async () => {
          const dispatcher = new PalToolDispatcher();
          const call = createToolCallBlock("call-missing", "unknown_fn", {});
          const context = createTestContext();

          const result = await dispatcher.dispatch(call, context);
          expect(result.isError).toBe(true);
          expect(result.content).toContain("Tool not found");
        });

        it("returns validation error when arguments fail schema validation", async () => {
          const dispatcher = new PalToolDispatcher();
          dispatcher.registerTool(
            {
              name: "strict_input",
              description: "Strict",
              source: "native",
              parameters: {
                type: "object",
                properties: { count: { type: "number" } },
                required: ["count"],
              },
            },
            async (args) => `Count: ${args.count}`
          );

          const call = createToolCallBlock("call-invalid", "strict_input", {
            count: "not-a-number" as unknown as number,
          });
          const context = createTestContext();

          const result = await dispatcher.dispatch(call, context);
          expect(result.isError).toBe(true);
          expect(result.content).toContain("Validation failed");
        });

        it("enforces tool execution timeout", async () => {
          const dispatcher = new PalToolDispatcher({ defaultTimeoutMs: 50 });
          dispatcher.registerTool(
            {
              name: "slow_op",
              description: "Takes long",
              source: "native",
              timeoutMs: 30,
              parameters: { type: "object", properties: {} },
            },
            async (_args, ctx) => {
              await new Promise((resolve) => setTimeout(resolve, 150));
              if (ctx.abortSignal?.aborted) {
                throw new Error("Aborted by timeout");
              }
              return "done";
            }
          );

          const call = createToolCallBlock("call-slow", "slow_op", {});
          const context = createTestContext();

          const result = await dispatcher.dispatch(call, context);
          expect(result.isError).toBe(true);
          expect(result.content).toContain("Tool execution timed out");
        });

        it("honors pre-existing or runtime AbortSignal cancellation", async () => {
          const dispatcher = new PalToolDispatcher();
          dispatcher.registerTool(
            {
              name: "cancellable_op",
              description: "Cancel",
              source: "native",
              parameters: { type: "object", properties: {} },
            },
            async () => "should not finish"
          );

          const controller = new AbortController();
          controller.abort("User cancelled the looper");

          const call = createToolCallBlock("call-abort", "cancellable_op", {});
          const context = createTestContext({ abortSignal: controller.signal });

          const result = await dispatcher.dispatch(call, context);
          expect(result.isError).toBe(true);
          expect(result.content).toContain("Tool execution aborted");
        });

        it("safely catches unhandled tool handler exceptions", async () => {
          const dispatcher = new PalToolDispatcher();
          dispatcher.registerTool(
            {
              name: "failing_op",
              description: "Throws",
              source: "native",
              parameters: { type: "object", properties: {} },
            },
            async () => {
              throw new Error("Disk full: write error");
            }
          );

          const call = createToolCallBlock("call-fail", "failing_op", {});
          const context = createTestContext();

          const result = await dispatcher.dispatch(call, context);
          expect(result.isError).toBe(true);
          expect(result.content).toContain("Disk full: write error");
        });

        it("dispatches multiple tool calls in parallel by default", async () => {
          const dispatcher = new PalToolDispatcher();
          let concurrent = 0;
          let maxConcurrent = 0;

          dispatcher.registerTool(
            {
              name: "async_task",
              description: "Async",
              source: "native",
              parameters: { type: "object", properties: { id: { type: "number" } } },
            },
            async (args) => {
              concurrent++;
              if (concurrent > maxConcurrent) maxConcurrent = concurrent;
              await new Promise((resolve) => setTimeout(resolve, 20));
              concurrent--;
              return `Task ${args.id} complete`;
            }
          );

          const calls = [
            createToolCallBlock("c-1", "async_task", { id: 1 }),
            createToolCallBlock("c-2", "async_task", { id: 2 }),
            createToolCallBlock("c-3", "async_task", { id: 3 }),
          ];

          const context = createTestContext();
          const results = await dispatcher.dispatchBatch(calls, context);

          expect(results.length).toBe(3);
          expect(maxConcurrent).toBeGreaterThan(1);
          expect(results.every((r) => !r.isError)).toBe(true);
        });

        it("dispatches multiple tool calls sequentially when requested", async () => {
          const dispatcher = new PalToolDispatcher();
          const order: number[] = [];

          dispatcher.registerTool(
            {
              name: "seq_task",
              description: "Sequential",
              source: "native",
              parameters: { type: "object", properties: { num: { type: "number" } } },
            },
            async (args) => {
              order.push(args.num as number);
              return `Task ${args.num}`;
            }
          );

          const calls = [
            createToolCallBlock("c-1", "seq_task", { num: 1 }),
            createToolCallBlock("c-2", "seq_task", { num: 2 }),
            createToolCallBlock("c-3", "seq_task", { num: 3 }),
          ];

          const context = createTestContext();
          const results = await dispatcher.dispatchBatch(calls, context, { sequential: true });

          expect(results.length).toBe(3);
          expect(order).toEqual([1, 2, 3]);
        });

        it("stops sequential execution early when stopOnError is enabled", async () => {
          const dispatcher = new PalToolDispatcher();
          let executedCount = 0;

          dispatcher.registerTool(
            {
              name: "step",
              description: "Step",
              source: "native",
              parameters: { type: "object", properties: { fail: { type: "boolean" } } },
            },
            async (args) => {
              executedCount++;
              if (args.fail) throw new Error("Step failed");
              return "ok";
            }
          );

          const calls = [
            createToolCallBlock("c-1", "step", { fail: false }),
            createToolCallBlock("c-2", "step", { fail: true }),
            createToolCallBlock("c-3", "step", { fail: false }),
          ];

          const context = createTestContext();
          const results = await dispatcher.dispatchBatch(calls, context, {
            sequential: true,
            stopOnError: true,
          });

          expect(results.length).toBe(2);
          expect(executedCount).toBe(2);
          expect(results[1]!.isError).toBe(true);
        });

        it("dispatches tools directly from PalMessage content", async () => {
          const dispatcher = new PalToolDispatcher();
          dispatcher.registerTool(
            {
              name: "msg_tool",
              description: "Tool from message",
              source: "native",
              parameters: { type: "object", properties: {} },
            },
            async () => "result from message"
          );

          const message = createPalMessage({
            role: PAL_ROLES.ASSISTANT,
            content: [
              createTextBlock("Thinking..."),
              createToolCallBlock("tc-msg", "msg_tool", {}),
            ],
          });

          const context = createTestContext();
          const results = await dispatcher.dispatchFromMessage(message, context);

          expect(results.length).toBe(1);
          expect(results[0]!.toolCallId).toBe("tc-msg");
          expect(results[0]!.content).toBe("result from message");
        });

        it("triggers onToolStart and onToolEnd lifecycle hooks", async () => {
          let startTriggered = false;
          let endTriggered = false;

          const dispatcher = createPalToolDispatcher({
            onToolStart: (call) => {
              if (call.name === "hook_tool") startTriggered = true;
            },
            onToolEnd: (call, res) => {
              if (call.name === "hook_tool" && !res.isError) endTriggered = true;
            },
          });

          dispatcher.registerTool(
            {
              name: "hook_tool",
              description: "Hook test",
              source: "native",
              parameters: { type: "object", properties: {} },
            },
            async () => "hook result"
          );

          const call = createToolCallBlock("call-hook", "hook_tool", {});
          const context = createTestContext();

          await dispatcher.dispatch(call, context);
          expect(startTriggered).toBe(true);
          expect(endTriggered).toBe(true);
        });
      });

      describe("OpenCodeAdapter MCP & Dispatcher Integration", () => {
        it("allows configuring and updating PalToolDispatcher and McpToolBridge", () => {
          const dispatcher = createPalToolDispatcher();
          const bridge = createMcpToolBridge();
          const adapter = new OpenCodeAdapter({
            toolDispatcher: dispatcher,
            mcpBridge: bridge,
          });

          expect(adapter.getToolDispatcher()).toBe(dispatcher);
          expect(adapter.getMcpBridge()).toBe(bridge);

          const newDispatcher = createPalToolDispatcher();
          adapter.setToolDispatcher(newDispatcher);
          expect(adapter.getToolDispatcher()).toBe(newDispatcher);

          const newBridge = createMcpToolBridge();
          adapter.setMcpBridge(newBridge);
          expect(adapter.getMcpBridge()).toBe(newBridge);
        });

        it("registers MCP server through adapter and discovers tools", async () => {
          const adapter = new OpenCodeAdapter();
          const mcpClient = createInMemoryMcpClient("adapter-srv");
          mcpClient.addTool(
            {
              name: "fetch_status",
              description: "Get server status",
              inputSchema: { type: "object", properties: {} },
            },
            async () => ({ status: "HEALTHY", uptime: 100 })
          );

          const tools = await adapter.registerMcpServer(mcpClient);
          expect(tools.length).toBe(1);
          expect(tools[0]!.name).toBe("fetch_status");
          expect(tools[0]!.source).toBe("mcp");

          const call = createToolCallBlock("c-mcp", "fetch_status", {});
          const context = createTestContext();

          const results = await adapter.dispatchToolCalls([call], context);
          expect(results.length).toBe(1);
          expect(results[0]!.isError).toBe(false);
          expect(results[0]!.content).toContain("HEALTHY");
        });

        it("executes turn with ReAct fallback, extracts tool call and dispatches with MCP", async () => {
          const mcpClient = createInMemoryMcpClient("ops-server");
          mcpClient.addTool(
            {
              name: "deploy_service",
              description: "Deploy service",
              inputSchema: {
                type: "object",
                properties: { service: { type: "string" } },
                required: ["service"],
              },
            },
            async (args) => `Service '${args.service}' successfully deployed to staging.`
          );

          const dispatcher = createPalToolDispatcher();
          await dispatcher.registerMcpServer(mcpClient);

          const mockFetch = (async () => {
            const body = {
              id: "chatcmpl-react-mcp",
              object: "chat.completion",
              created: Date.now(),
              model: "opencode/deepseek-v4.1-flash",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content:
                      'Deploying now:\n```json\n{\n  "name": "deploy_service",\n  "arguments": {\n    "service": "auth-api"\n  }\n}\n```',
                  },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 30, completion_tokens: 25, total_tokens: 55 },
            };

            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }) as unknown as typeof fetch;

          const adapter = new OpenCodeAdapter({
            supportsNativeTools: false,
            fetchFn: mockFetch,
            toolDispatcher: dispatcher,
          });

          // 1. Execute turn (ReAct model outputs markdown tool call)
          const outcome = await adapter.executeTurn({
            sessionId: "test-mcp-e2e",
            messages: [
              createPalMessage({
                role: PAL_ROLES.USER,
                content: [createTextBlock("Deploy auth-api to staging")],
              }),
            ],
          });

          expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.TOOL_CALLS);
          const toolCall = outcome.message.content.find(isPalToolCallContent);
          expect(toolCall).toBeDefined();
          expect(toolCall!.name).toBe("deploy_service");
          expect(toolCall!.arguments).toEqual({ service: "auth-api" });

          // 2. Dispatch tool calls through the MCP bridge dispatcher
          const context = createTestContext();
          const results = await adapter.dispatchToolCalls([toolCall!], context);

          expect(results.length).toBe(1);
          expect(results[0]!.toolName).toBe("deploy_service");
          expect(results[0]!.isError).toBe(false);
          expect(results[0]!.content).toContain("Service 'auth-api' successfully deployed");
        });
      });
    });
  });
});
