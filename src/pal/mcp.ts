/**
 * Model Context Protocol (MCP) Tool Schema Bridge and Execution Dispatcher (PAL).
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 4.5 and Section 4.5.1,
 * and OpenSpec change `looper-pal-opencode-adapter` Task 1.3.
 *
 * Provides:
 * 1. Bidirectional MCP Tool Schema Bridge: translates MCP tool definitions
 *    (JSON Schema inputSchema) into canonical `PalToolDefinition` and vice-versa.
 * 2. Parameter schema validation: enforces required properties and JSON types.
 * 3. MCP Client abstraction & in-memory mock client for testing and local execution.
 * 4. MCP Tool Bridge Registry: manages MCP server connections, tool discovery,
 *    namespacing, and tool handlers.
 * 5. Universal PalToolDispatcher: registers native and MCP tools, enforces timeouts,
 *    handles cancellations via AbortSignal, measures latency, captures errors cleanly,
 *    and executes tool batches in parallel or sequentially.
 */

import { randomUUID } from "node:crypto";
import {
  COGNITIVE_ROLES,
  type CognitiveRole,
  type PalContentBlock,
  type PalMessage,
  type PalToolCallContent,
  type PalToolDefinition,
  type PalToolExecutionContext,
  type PalToolHandler,
  type PalToolParametersSchema,
  type PalToolResultContent,
  createToolResultBlock,
  isPalToolCallContent,
} from "./types";

/**
 * Central constants ensuring zero magic numbers across MCP bridge and dispatcher operations.
 */
export const MCP_BRIDGE_CONSTANTS = {
  // Default Timeouts & Numbers
  DEFAULT_TIMEOUT_MS: 30_000,
  DEFAULT_MAX_RETRIES: 3,
  ZERO: 0,
  SINGLE_ITEM: 1,
  NOT_FOUND_INDEX: -1,
  DURATION_ZERO_MS: 0,
  MS_PER_SECOND: 1_000,
  JSON_INDENT_SPACES: 2,

  // Fallbacks and Strings
  EMPTY_STRING: "",
  FALLBACK_TOOL_NAME: "unknown_tool",
  FALLBACK_SERVER_NAME: "mcp-server",
  MCP_SOURCE: "mcp" as const,
  NATIVE_SOURCE: "native" as const,
  NAMESPACE_SEPARATOR: "__",

  // Execution Context Defaults
  DEFAULT_AGENT_ID: "pal-agent",
  DEFAULT_ROLE: "worker" as CognitiveRole,
  DEFAULT_WORKING_DIRECTORY: ".",

  // Error Messages and Diagnostic Tags
  ERROR_PREFIX_NOT_FOUND: "Tool not found: ",
  ERROR_PREFIX_VALIDATION: "Validation failed: ",
  ERROR_PREFIX_TIMEOUT: "Tool execution timed out: ",
  ERROR_PREFIX_ABORTED: "Tool execution aborted: ",
  ERROR_PREFIX_EXECUTION: "Tool execution error: ",

  // Content Types
  CONTENT_TYPE_TEXT: "text" as const,
  CONTENT_TYPE_IMAGE: "image" as const,
  CONTENT_TYPE_RESOURCE: "resource" as const,

  // JSON Schema Types
  SCHEMA_TYPE_OBJECT: "object",
  SCHEMA_TYPE_STRING: "string",
  SCHEMA_TYPE_NUMBER: "number",
  SCHEMA_TYPE_INTEGER: "integer",
  SCHEMA_TYPE_BOOLEAN: "boolean",
  SCHEMA_TYPE_ARRAY: "array",
} as const;

/**
 * MCP Text Content block.
 */
export interface McpTextContent {
  type: "text";
  text: string;
}

/**
 * MCP Image Content block.
 */
export interface McpImageContent {
  type: "image";
  data: string; // Base64 encoded data
  mimeType: string;
}

/**
 * MCP Resource Content block.
 */
export interface McpResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

/**
 * Union of MCP content blocks.
 */
export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

/**
 * MCP Tool representation as specified by Model Context Protocol.
 */
export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    description?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Result returned by an MCP tool invocation.
 */
export interface McpCallToolResult {
  content: McpContent[] | string;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * Configuration for an MCP server connection.
 */
export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse" | "websocket" | "in-memory";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  timeoutMs?: number;
  disabled?: boolean;
  autoApprove?: string[];
}

/**
 * Primary interface for communicating with an MCP server.
 */
export interface IMcpClient {
  readonly serverName: string;
  listTools(): Promise<McpToolSchema[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { abortSignal?: AbortSignal; timeoutMs?: number }
  ): Promise<McpCallToolResult>;
  ping?(): Promise<boolean>;
  close?(): Promise<void>;
}

/**
 * Options for configuring MCP schema bridge conversion.
 */
export interface McpBridgeOptions {
  serverName?: string;
  defaultTimeoutMs?: number;
  prefixServerName?: boolean;
}

/**
 * Diagnostic result of parameter schema validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates tool call arguments against a PAL parameter schema.
 *
 * Checks:
 * - Presence of required properties.
 * - Primitive type conformance (string, number, integer, boolean, object, array).
 * - Additional properties restriction if `additionalProperties: false`.
 */
export function validateToolArguments(
  schema: PalToolParametersSchema | undefined,
  args: Record<string, unknown> | undefined
): ValidationResult {
  const errors: string[] = [];
  if (!schema) {
    return { valid: true, errors: [] };
  }

  const effectiveArgs = args ?? {};

  // Check required fields
  if (Array.isArray(schema.required)) {
    for (const requiredKey of schema.required) {
      const val = effectiveArgs[requiredKey];
      if (val === undefined || val === null) {
        errors.push(`Missing required property: '${requiredKey}'`);
      }
    }
  }

  // Check property types
  if (schema.properties && typeof schema.properties === "object") {
    for (const [key, propDef] of Object.entries(schema.properties)) {
      const actualVal = effectiveArgs[key];
      if (actualVal === undefined || actualVal === null) {
        continue;
      }

      if (typeof propDef === "object" && propDef !== null) {
        const expectedType = (propDef as { type?: string }).type;
        if (!expectedType) continue;

        switch (expectedType) {
          case MCP_BRIDGE_CONSTANTS.SCHEMA_TYPE_STRING:
            if (typeof actualVal !== "string") {
              errors.push(
                `Property '${key}' must be a string, got ${typeof actualVal}`
              );
            }
            break;
          case MCP_BRIDGE_CONSTANTS.SCHEMA_TYPE_NUMBER:
            if (typeof actualVal !== "number" || Number.isNaN(actualVal)) {
              errors.push(
                `Property '${key}' must be a number, got ${typeof actualVal}`
              );
            }
            break;
          case MCP_BRIDGE_CONSTANTS.SCHEMA_TYPE_INTEGER:
            if (
              typeof actualVal !== "number" ||
              !Number.isInteger(actualVal) ||
              Number.isNaN(actualVal)
            ) {
              errors.push(
                `Property '${key}' must be an integer, got ${typeof actualVal}`
              );
            }
            break;
          case MCP_BRIDGE_CONSTANTS.SCHEMA_TYPE_BOOLEAN:
            if (typeof actualVal !== "boolean") {
              errors.push(
                `Property '${key}' must be a boolean, got ${typeof actualVal}`
              );
            }
            break;
          case MCP_BRIDGE_CONSTANTS.SCHEMA_TYPE_OBJECT:
            if (
              typeof actualVal !== "object" ||
              actualVal === null ||
              Array.isArray(actualVal)
            ) {
              errors.push(`Property '${key}' must be an object`);
            }
            break;
          case MCP_BRIDGE_CONSTANTS.SCHEMA_TYPE_ARRAY:
            if (!Array.isArray(actualVal)) {
              errors.push(`Property '${key}' must be an array`);
            }
            break;
        }
      }
    }
  }

  // Check additionalProperties if explicitly disallowed
  if (schema.additionalProperties === false && schema.properties) {
    const allowedKeys = new Set(Object.keys(schema.properties));
    for (const argKey of Object.keys(effectiveArgs)) {
      if (!allowedKeys.has(argKey)) {
        errors.push(`Additional property '${argKey}' is not allowed`);
      }
    }
  }

  return {
    valid: errors.length === MCP_BRIDGE_CONSTANTS.ZERO,
    errors,
  };
}

/**
 * Translates an MCP tool schema into a canonical PAL tool definition.
 */
export function mcpToolToPalTool(
  mcpTool: McpToolSchema,
  options?: McpBridgeOptions
): PalToolDefinition {
  const serverName = options?.serverName;
  const prefix = options?.prefixServerName && serverName;
  const name = prefix
    ? `${serverName}${MCP_BRIDGE_CONSTANTS.NAMESPACE_SEPARATOR}${mcpTool.name}`
    : mcpTool.name;

  const rawSchema = mcpTool.inputSchema;
  const properties =
    rawSchema &&
    typeof rawSchema.properties === "object" &&
    rawSchema.properties !== null
      ? (rawSchema.properties as Record<string, unknown>)
      : {};
  const required =
    rawSchema && Array.isArray(rawSchema.required) ? rawSchema.required : [];
  const additionalProperties =
    rawSchema && typeof rawSchema.additionalProperties === "boolean"
      ? rawSchema.additionalProperties
      : true;

  const parameters: PalToolParametersSchema = {
    type: "object",
    properties,
    required,
    additionalProperties,
  };

  return {
    name,
    description: mcpTool.description ?? MCP_BRIDGE_CONSTANTS.EMPTY_STRING,
    parameters,
    source: MCP_BRIDGE_CONSTANTS.MCP_SOURCE,
    ...(serverName ? { mcpServerName: serverName } : {}),
    ...(options?.defaultTimeoutMs
      ? { timeoutMs: options.defaultTimeoutMs }
      : {}),
  };
}

/**
 * Translates a canonical PAL tool definition into standard MCP tool schema format.
 */
export function palToolToMcpTool(palTool: PalToolDefinition): McpToolSchema {
  return {
    name: palTool.name,
    description: palTool.description,
    inputSchema: {
      type: MCP_BRIDGE_CONSTANTS.SCHEMA_TYPE_OBJECT,
      properties: palTool.parameters.properties ?? {},
      required: palTool.parameters.required ?? [],
      additionalProperties: palTool.parameters.additionalProperties ?? true,
    },
  };
}

/**
 * Translates an array of MCP tool schemas to canonical PAL tool definitions.
 */
export function batchMcpToolsToPalTools(
  tools: McpToolSchema[],
  options?: McpBridgeOptions
): PalToolDefinition[] {
  if (!tools || tools.length === MCP_BRIDGE_CONSTANTS.ZERO) {
    return [];
  }
  return tools.map((tool) => mcpToolToPalTool(tool, options));
}

/**
 * Translates an array of canonical PAL tool definitions to MCP tool schemas.
 */
export function batchPalToolsToMcpTools(
  tools: PalToolDefinition[]
): McpToolSchema[] {
  if (!tools || tools.length === MCP_BRIDGE_CONSTANTS.ZERO) {
    return [];
  }
  return tools.map((tool) => palToolToMcpTool(tool));
}

/**
 * Formats an MCP tool invocation result into a canonical string and error flag.
 */
export function formatMcpCallToolResult(
  result: McpCallToolResult | string | Record<string, unknown>
): { content: string; isError: boolean } {
  if (typeof result === "string") {
    return { content: result, isError: false };
  }
  if (!result || typeof result !== "object") {
    return { content: String(result), isError: false };
  }

  // Handle standard McpCallToolResult structure
  if (
    "content" in result &&
    (Array.isArray(result.content) || typeof result.content === "string")
  ) {
    const isError = Boolean((result as McpCallToolResult).isError);
    if (typeof result.content === "string") {
      return { content: result.content, isError };
    }

    const textParts: string[] = [];
    for (const item of result.content) {
      if (item.type === MCP_BRIDGE_CONSTANTS.CONTENT_TYPE_TEXT && item.text) {
        textParts.push(item.text);
      } else if (item.type === MCP_BRIDGE_CONSTANTS.CONTENT_TYPE_IMAGE) {
        textParts.push(`[Image: ${item.mimeType}]`);
      } else if (
        item.type === MCP_BRIDGE_CONSTANTS.CONTENT_TYPE_RESOURCE &&
        item.resource
      ) {
        const textSuffix = item.resource.text ? ` - ${item.resource.text}` : "";
        textParts.push(`[Resource: ${item.resource.uri}${textSuffix}]`);
      } else {
        textParts.push(JSON.stringify(item));
      }
    }
    return {
      content: textParts.join("\n"),
      isError,
    };
  }

  return {
    content: JSON.stringify(
      result,
      null,
      MCP_BRIDGE_CONSTANTS.JSON_INDENT_SPACES
    ),
    isError: false,
  };
}

/**
 * In-memory MCP client implementation for unit testing and local in-process tools.
 */
export class InMemoryMcpClient implements IMcpClient {
  readonly serverName: string;
  private readonly tools = new Map<
    string,
    {
      schema: McpToolSchema;
      handler: (
        args: Record<string, unknown>,
        options?: { abortSignal?: AbortSignal; timeoutMs?: number }
      ) => Promise<McpCallToolResult | string | Record<string, unknown>>;
    }
  >();

  constructor(serverName: string = MCP_BRIDGE_CONSTANTS.FALLBACK_SERVER_NAME) {
    this.serverName = serverName;
  }

  /**
   * Registers a tool on this in-memory MCP client.
   */
  addTool(
    schema: McpToolSchema,
    handler: (
      args: Record<string, unknown>,
      options?: { abortSignal?: AbortSignal; timeoutMs?: number }
    ) => Promise<McpCallToolResult | string | Record<string, unknown>>
  ): this {
    this.tools.set(schema.name, { schema, handler });
    return this;
  }

  /**
   * Removes a tool from this in-memory MCP client.
   */
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Lists all tools exposed by this MCP server.
   */
  async listTools(): Promise<McpToolSchema[]> {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  /**
   * Calls an MCP tool by name.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { abortSignal?: AbortSignal; timeoutMs?: number }
  ): Promise<McpCallToolResult> {
    const entry = this.tools.get(name);
    if (!entry) {
      return {
        content: `Error: Tool '${name}' not found on server '${this.serverName}'`,
        isError: true,
      };
    }

    try {
      if (options?.abortSignal?.aborted) {
        return {
          content: `Error: Execution aborted for tool '${name}'`,
          isError: true,
        };
      }

      const result = await entry.handler(args, options);
      if (typeof result === "string") {
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }
      if (
        "content" in result &&
        (Array.isArray(result.content) || typeof result.content === "string")
      ) {
        return result as McpCallToolResult;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              result,
              null,
              MCP_BRIDGE_CONSTANTS.JSON_INDENT_SPACES
            ),
          },
        ],
        isError: false,
      };
    } catch (err: unknown) {
      return {
        content: `Error executing tool '${name}': ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.tools.clear();
  }
}

/**
 * Creates an in-memory MCP client.
 */
export function createInMemoryMcpClient(serverName?: string): InMemoryMcpClient {
  return new InMemoryMcpClient(serverName);
}

/**
 * Registered MCP tool metadata record.
 */
interface RegisteredMcpTool {
  definition: PalToolDefinition;
  originalName: string;
  serverName: string;
}

/**
 * Model Context Protocol (MCP) Tool Bridge Registry.
 *
 * Manages connections to MCP clients, dynamically queries tool lists,
 * converts schemas into canonical `PalToolDefinition` objects, and generates
 * execution handlers.
 */
export class McpToolBridge {
  private readonly servers = new Map<
    string,
    { client: IMcpClient; options?: McpBridgeOptions }
  >();
  private readonly toolRegistry = new Map<string, RegisteredMcpTool>();

  /**
   * Registers an MCP server client with the bridge.
   */
  registerServer(client: IMcpClient, options?: McpBridgeOptions): void {
    this.servers.set(client.serverName, { client, options });
  }

  /**
   * Unregisters an MCP server client and removes its associated tools.
   */
  unregisterServer(serverName: string): boolean {
    const existed = this.servers.delete(serverName);
    if (existed) {
      for (const [key, val] of this.toolRegistry.entries()) {
        if (val.serverName === serverName) {
          this.toolRegistry.delete(key);
        }
      }
    }
    return existed;
  }

  /**
   * Checks whether a server is registered.
   */
  hasServer(serverName: string): boolean {
    return this.servers.has(serverName);
  }

  /**
   * Retrieves an MCP client by server name.
   */
  getServer(serverName: string): IMcpClient | undefined {
    return this.servers.get(serverName)?.client;
  }

  /**
   * Lists the names of all registered MCP servers.
   */
  listServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Discovers tools across registered MCP servers, transforms them into
   * `PalToolDefinition` schemas, and registers them in the bridge.
   */
  async discoverTools(serverName?: string): Promise<PalToolDefinition[]> {
    const discovered: PalToolDefinition[] = [];
    const targetServers = serverName
      ? [serverName]
      : Array.from(this.servers.keys());

    for (const name of targetServers) {
      const entry = this.servers.get(name);
      if (!entry) continue;

      const mcpTools = await entry.client.listTools();
      const bridgeOptions: McpBridgeOptions = {
        serverName: name,
        defaultTimeoutMs: entry.options?.defaultTimeoutMs,
        prefixServerName: entry.options?.prefixServerName,
        ...entry.options,
      };

      for (const mcpTool of mcpTools) {
        const palDef = mcpToolToPalTool(mcpTool, bridgeOptions);
        this.toolRegistry.set(palDef.name, {
          definition: palDef,
          originalName: mcpTool.name,
          serverName: name,
        });
        discovered.push(palDef);
      }
    }

    return discovered;
  }

  /**
   * Retrieves a discovered tool definition by name.
   */
  getToolDefinition(name: string): PalToolDefinition | undefined {
    return this.toolRegistry.get(name)?.definition;
  }

  /**
   * Returns all discovered tool definitions.
   */
  getAllToolDefinitions(): PalToolDefinition[] {
    return Array.from(this.toolRegistry.values()).map((v) => v.definition);
  }

  /**
   * Creates a PalToolHandler that delegates to the underlying MCP client.
   */
  createPalToolHandler(toolName: string): PalToolHandler {
    return async (
      args: Record<string, unknown>,
      context: PalToolExecutionContext
    ): Promise<string> => {
      const toolEntry = this.toolRegistry.get(toolName);
      if (!toolEntry) {
        throw new Error(
          `${MCP_BRIDGE_CONSTANTS.ERROR_PREFIX_NOT_FOUND}'${toolName}' in MCP bridge`
        );
      }

      const client = this.getServer(toolEntry.serverName);
      if (!client) {
        throw new Error(
          `MCP server '${toolEntry.serverName}' is not registered`
        );
      }

      context.logger?.(
        "info",
        `Invoking MCP tool '${toolEntry.originalName}' on server '${toolEntry.serverName}'`
      );

      const result = await client.callTool(toolEntry.originalName, args, {
        abortSignal: context.abortSignal,
        timeoutMs: toolEntry.definition.timeoutMs,
      });

      const formatted = formatMcpCallToolResult(result);
      if (formatted.isError) {
        throw new Error(formatted.content);
      }

      return formatted.content;
    };
  }
}

/**
 * Creates an McpToolBridge instance.
 */
export function createMcpToolBridge(): McpToolBridge {
  return new McpToolBridge();
}

/**
 * Options for configuring PalToolDispatcher.
 */
export interface PalToolDispatcherOptions {
  defaultTimeoutMs?: number;
  defaultWorkingDir?: string;
  onToolStart?: (
    call: PalToolCallContent,
    context: PalToolExecutionContext
  ) => void;
  onToolEnd?: (
    call: PalToolCallContent,
    result: PalToolResultContent,
    context: PalToolExecutionContext
  ) => void;
}

/**
 * Registered tool execution descriptor.
 */
interface RegisteredTool {
  definition: PalToolDefinition;
  handler: PalToolHandler;
}

/**
 * Universal Tool Execution Dispatcher.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification Section 4.5.
 * Coordinates execution of native tools and MCP tools, performing:
 * - Registration of native tool handlers and MCP server bridges.
 * - Argument validation against `PalToolParametersSchema`.
 * - Timeout enforcement with automatic abort signaling.
 * - AbortSignal propagation and cancellation detection.
 * - Millisecond latency measurement (`durationMs`).
 * - Safe error handling (guaranteeing zero unhandled exceptions).
 * - Parallel or sequential batch execution.
 */
export class PalToolDispatcher {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly mcpBridge = new McpToolBridge();
  private readonly defaultTimeoutMs: number;
  private readonly onToolStart?: (
    call: PalToolCallContent,
    context: PalToolExecutionContext
  ) => void;
  private readonly onToolEnd?: (
    call: PalToolCallContent,
    result: PalToolResultContent,
    context: PalToolExecutionContext
  ) => void;

  constructor(options?: PalToolDispatcherOptions) {
    this.defaultTimeoutMs =
      options?.defaultTimeoutMs ?? MCP_BRIDGE_CONSTANTS.DEFAULT_TIMEOUT_MS;
    this.onToolStart = options?.onToolStart;
    this.onToolEnd = options?.onToolEnd;
  }

  /**
   * Registers a native tool definition and execution handler.
   */
  registerTool(definition: PalToolDefinition, handler: PalToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Registers a native tool definition and execution handler (alias).
   */
  registerNativeTool(
    definition: PalToolDefinition,
    handler: PalToolHandler
  ): void {
    this.registerTool(
      { ...definition, source: MCP_BRIDGE_CONSTANTS.NATIVE_SOURCE },
      handler
    );
  }

  /**
   * Registers an MCP client server, discovers its tools, and wires them into the dispatcher.
   */
  async registerMcpServer(
    client: IMcpClient,
    options?: McpBridgeOptions
  ): Promise<PalToolDefinition[]> {
    this.mcpBridge.registerServer(client, options);
    const discovered = await this.mcpBridge.discoverTools(client.serverName);

    for (const toolDef of discovered) {
      const handler = this.mcpBridge.createPalToolHandler(toolDef.name);
      this.tools.set(toolDef.name, { definition: toolDef, handler });
    }

    return discovered;
  }

  /**
   * Integrates an existing McpToolBridge into this dispatcher.
   */
  async registerMcpBridge(
    bridge: McpToolBridge
  ): Promise<PalToolDefinition[]> {
    const discovered = await bridge.discoverTools();
    for (const toolDef of discovered) {
      const handler = bridge.createPalToolHandler(toolDef.name);
      this.tools.set(toolDef.name, { definition: toolDef, handler });
    }
    return discovered;
  }

  /**
   * Unregisters a tool by name.
   */
  unregisterTool(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  /**
   * Checks whether a tool is registered in this dispatcher.
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Retrieves a tool definition by name.
   */
  getTool(toolName: string): PalToolDefinition | undefined {
    return this.tools.get(toolName)?.definition;
  }

  /**
   * Returns all registered tool definitions.
   */
  getAllTools(): PalToolDefinition[] {
    return Array.from(this.tools.values()).map((v) => v.definition);
  }

  /**
   * Returns registered native tool definitions.
   */
  getNativeTools(): PalToolDefinition[] {
    return this.getAllTools().filter(
      (t) => t.source === MCP_BRIDGE_CONSTANTS.NATIVE_SOURCE
    );
  }

  /**
   * Returns registered MCP tool definitions.
   */
  getMcpTools(): PalToolDefinition[] {
    return this.getAllTools().filter(
      (t) => t.source === MCP_BRIDGE_CONSTANTS.MCP_SOURCE
    );
  }

  /**
   * Accesses the underlying McpToolBridge.
   */
  getMcpBridge(): McpToolBridge {
    return this.mcpBridge;
  }

  /**
   * Dispatches a single tool call through the execution lifecycle.
   *
   * Enforces:
   * 1. Tool existence check.
   * 2. Schema argument validation.
   * 3. Timeout enforcement with timer cleanup.
   * 4. AbortSignal cancellation handling.
   * 5. Execution timing measurement.
   * 6. Safe conversion of output to canonical `PalToolResultContent`.
   */
  async dispatch(
    call: PalToolCallContent,
    context: PalToolExecutionContext
  ): Promise<PalToolResultContent> {
    const startTime = performance.now();
    this.onToolStart?.(call, context);

    const registered = this.tools.get(call.name);
    if (!registered) {
      const durationMs = Math.round(performance.now() - startTime);
      context.logger?.(
        "warn",
        `Tool '${call.name}' not found in dispatcher registry`
      );
      const notFoundResult = createToolResultBlock(
        call.id,
        call.name,
        `${MCP_BRIDGE_CONSTANTS.ERROR_PREFIX_NOT_FOUND}'${call.name}' is not registered`,
        true,
        durationMs
      );
      this.onToolEnd?.(call, notFoundResult, context);
      return notFoundResult;
    }

    const { definition, handler } = registered;

    // Validate parameters
    const validation = validateToolArguments(
      definition.parameters,
      call.arguments
    );
    if (!validation.valid) {
      const durationMs = Math.round(performance.now() - startTime);
      context.logger?.(
        "warn",
        `Tool '${call.name}' argument validation failed: ${validation.errors.join("; ")}`
      );
      const validationErrorResult = createToolResultBlock(
        call.id,
        call.name,
        `${MCP_BRIDGE_CONSTANTS.ERROR_PREFIX_VALIDATION}${validation.errors.join("; ")}`,
        true,
        durationMs
      );
      this.onToolEnd?.(call, validationErrorResult, context);
      return validationErrorResult;
    }

    // Check pre-existing cancellation
    if (context.abortSignal?.aborted) {
      const durationMs = Math.round(performance.now() - startTime);
      const abortedResult = createToolResultBlock(
        call.id,
        call.name,
        `${MCP_BRIDGE_CONSTANTS.ERROR_PREFIX_ABORTED}${String(
          context.abortSignal.reason ?? "AbortSignal triggered before execution"
        )}`,
        true,
        durationMs
      );
      this.onToolEnd?.(call, abortedResult, context);
      return abortedResult;
    }

    // Set up timeout and abort controller
    const timeoutMs = definition.timeoutMs ?? this.defaultTimeoutMs;
    const timeoutController = new AbortController();
    let timeoutTriggered = false;

    const timeoutTimer = setTimeout(() => {
      timeoutTriggered = true;
      timeoutController.abort(
        new Error(`Tool execution timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);

    const onContextAbort = () => {
      timeoutController.abort(context.abortSignal?.reason);
    };

    if (context.abortSignal) {
      context.abortSignal.addEventListener("abort", onContextAbort, {
        once: true,
      });
    }

    const childContext: PalToolExecutionContext = {
      ...context,
      abortSignal: timeoutController.signal,
    };

    let resultBlock: PalToolResultContent;
    try {
      context.logger?.(
        "info",
        `Executing tool '${call.name}' with id '${call.id}'`
      );

      const rawResult = await handler(call.arguments, childContext);
      const durationMs = Math.round(performance.now() - startTime);

      let content: string;
      if (typeof rawResult === "string") {
        content = rawResult;
      } else if (typeof rawResult === "object" && rawResult !== null) {
        content = JSON.stringify(
          rawResult,
          null,
          MCP_BRIDGE_CONSTANTS.JSON_INDENT_SPACES
        );
      } else {
        content = String(rawResult);
      }

      resultBlock = createToolResultBlock(
        call.id,
        call.name,
        content,
        false,
        durationMs
      );
      context.logger?.(
        "info",
        `Tool '${call.name}' completed in ${durationMs}ms`
      );
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - startTime);

      if (timeoutTriggered) {
        context.logger?.(
          "error",
          `Tool '${call.name}' timed out after ${timeoutMs}ms`
        );
        resultBlock = createToolResultBlock(
          call.id,
          call.name,
          `${MCP_BRIDGE_CONSTANTS.ERROR_PREFIX_TIMEOUT}${timeoutMs}ms`,
          true,
          durationMs
        );
      } else if (context.abortSignal?.aborted) {
        context.logger?.(
          "warn",
          `Tool '${call.name}' aborted by context signal`
        );
        resultBlock = createToolResultBlock(
          call.id,
          call.name,
          `${MCP_BRIDGE_CONSTANTS.ERROR_PREFIX_ABORTED}${String(
            context.abortSignal.reason ?? "AbortSignal triggered"
          )}`,
          true,
          durationMs
        );
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        context.logger?.(
          "error",
          `Tool '${call.name}' execution failed: ${errorMessage}`
        );
        resultBlock = createToolResultBlock(
          call.id,
          call.name,
          `${MCP_BRIDGE_CONSTANTS.ERROR_PREFIX_EXECUTION}${errorMessage}`,
          true,
          durationMs
        );
      }
    } finally {
      clearTimeout(timeoutTimer);
      if (context.abortSignal) {
        context.abortSignal.removeEventListener("abort", onContextAbort);
      }
    }

    this.onToolEnd?.(call, resultBlock, context);
    return resultBlock;
  }

  /**
   * Dispatches a batch of tool calls.
   *
   * By default executes concurrently via `Promise.all`.
   * When `options.sequential` is true, executes sequentially in caller order.
   * When `options.stopOnError` is true, halts sequential execution upon the first error.
   */
  async dispatchBatch(
    calls: PalToolCallContent[],
    context: PalToolExecutionContext,
    options?: { sequential?: boolean; stopOnError?: boolean }
  ): Promise<PalToolResultContent[]> {
    if (!calls || calls.length === MCP_BRIDGE_CONSTANTS.ZERO) {
      return [];
    }

    if (options?.sequential) {
      const results: PalToolResultContent[] = [];
      for (const call of calls) {
        const res = await this.dispatch(call, context);
        results.push(res);
        if (options.stopOnError && res.isError) {
          break;
        }
      }
      return results;
    }

    // Parallel execution
    return Promise.all(calls.map((call) => this.dispatch(call, context)));
  }

  /**
   * Extracts and executes all tool calls present in a canonical PAL message.
   */
  async dispatchFromMessage(
    message: PalMessage,
    context: PalToolExecutionContext,
    options?: { sequential?: boolean; stopOnError?: boolean }
  ): Promise<PalToolResultContent[]> {
    const toolCalls = message.content.filter(isPalToolCallContent);
    return this.dispatchBatch(toolCalls, context, options);
  }
}

/**
 * Creates a PalToolDispatcher instance.
 */
export function createPalToolDispatcher(
  options?: PalToolDispatcherOptions
): PalToolDispatcher {
  return new PalToolDispatcher(options);
}

/**
 * Default singleton instance of PalToolDispatcher.
 */
export const defaultPalToolDispatcher = new PalToolDispatcher();
