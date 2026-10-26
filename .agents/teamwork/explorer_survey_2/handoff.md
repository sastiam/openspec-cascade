# Handoff Report — Explorer 2: LLM Provider Abstraction Specialist

**Role**: LLM Provider Abstraction Specialist  
**Working Directory**: `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2`  
**Parent Orchestrator ID**: `6d20d99d-2183-4d1a-ad2e-afc1d559cde6`  
**Date**: 2026-10-24  

---

## 1. Observation

Direct code and environment observations from the workspace:

1. **Current Engine Adapter Architecture in `openspec-cascade`**:
   - Location: `/home/sastiam/Workspace/openspec-cascade/engine.ts` (lines 48–54, 65–81).
   - Current interface:
     ```typescript
     export interface EngineAdapter {
       readonly name: EngineType;
       runSession(options: EngineSessionOptions): Promise<EngineOutcome>;
       getDefaultModel(effort?: string): string;
       supportsPlanMeters(): boolean;
       readUsage?(cwd: string): Promise<UsageMeter[] | null>;
     }
     ```
   - Observed limitation: The existing `EngineAdapter` is designed around running external CLI sub-processes (`claude` via `@anthropic-ai/claude-agent-sdk`, `agy` via `stream-json`, `opencode` via `opencode run`). It lacks native multi-turn conversation contracts, bi-directional message normalization, streaming token deltas, explicit thought/reasoning blocks, tool definition translation, and dynamic capability negotiation.

2. **Claude Adapter Mechanics (`claude.ts`)**:
   - Location: `/home/sastiam/Workspace/openspec-cascade/claude.ts` (lines 51–69, 91–134).
   - Implements `@anthropic-ai/claude-agent-sdk` query loop.
   - Parses `tool_use` blocks (`block.type === "tool_use"` with `name` and `input`) and `text` blocks.
   - Detects `rate_limit_event` with `resetsAt`, pause calculation with margin (`resetMarginMs`), and checks `/usage` meter thresholds.
   - Anthropic API native structure (Messages API v1): Top-level `system` block, alternating `user`/`assistant` turns, `tool_use` inside `assistant` turns, `tool_result` inside `user` turns paired by `tool_use_id`. Extended thinking introduces `{type: "thinking", thinking: string, signature: string}` and prompt caching via `cache_control: {type: "ephemeral"}`.

3. **Antigravity CLI & Gemini Protocol (`antigravity.ts`)**:
   - Location: `/home/sastiam/Workspace/openspec-cascade/antigravity.ts` (lines 58–81, 192–255).
   - Spawns `agy -p <prompt> --output-format stream-json --dangerously-skip-permissions --model <model> [--effort <effort>] [--conversation <id>]`.
   - Reads NDJSON events: `init`, `step_update` (`step_type === "tool" | "agent_response"`), and `result` (`usage.thinking_tokens`, `usage.input_tokens`, etc.).
   - Google Gemini API native structure: `contents` with `role: "user" | "model"`, `parts` array (`text`, `function_call: {name, args}`, `function_response: {name, response: {content}}`), and top-level `system_instruction`. Extended thinking uses thought parts, and context windows span 1,000,000 to 2,000,000 tokens.

4. **OpenCode CLI & Ecosystem (`opencode.ts`)**:
   - Location: `/home/sastiam/Workspace/openspec-cascade/opencode.ts` (lines 33–45, 94–106).
   - Spawns `opencode run --format json --auto --model <model> --title openspec-cascade`.
   - Passes permissions via `OPENCODE_CONFIG_CONTENT` environment variable.
   - Open-source / OpenAI-compatible / LiteLLM API native structure: `messages` array with roles `system`, `user`, `assistant`, `tool`. Assistant calls carry `tool_calls: [{id, type: "function", function: {name, arguments}}]`, followed by `role: "tool"` with matching `tool_call_id`. Reasoning models (DeepSeek R1, Qwen 2.5) expose `reasoning_content` or `<think>...</think>` tags. Small models frequently fail JSON tool schemas and require prompt fallbacks.

5. **Configuration Constants (`config.ts`)**:
   - Location: `/home/sastiam/Workspace/openspec-cascade/config.ts` (lines 14–40).
   - Defines default models: `DEFAULT_CLAUDE_MODEL = "claude-3-7-sonnet-20250219"`, `DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.8-flash-high"`, `DEFAULT_OPENCODE_MODEL = "opencode/deepseek-v4.1-flash"`.
   - Establishes timeout defaults (45 minutes per session), budget thresholds ($10/session), and tool permissions.

---

## 2. Logic Chain

From the direct observations, we trace the step-by-step reasoning for designing the Provider Abstraction Layer (PAL):

1. **Step 1: The Gap Between Single-Session Adapters and Multi-Agent Loopers**:
   - *Observation Reference*: 1, 2, 3, 4.
   - *Reasoning*: The existing `EngineAdapter` runs a single prompt to completion through a CLI tool. A multi-agent looping architecture (as specified in `ORIGINAL_REQUEST.md` inspired by Antigravity Teamwork) requires subagent-to-subagent messaging, iterative feedback loops, autonomous task routing, checkpoint recovery, and objective verification gates.
   - *Conclusion*: PAL must operate not merely as a process spawner, but as an omni-channel abstraction providing both **Direct API Clients** (for high-throughput agent-to-agent reasoning, verification checks, and prompt evals) and **CLI Runtime Adapters** (for long-running bash execution and filesystem mutations).

2. **Step 2: Unified Message Normalization & Structural Mapping**:
   - *Observation Reference*: 2, 3, 4.
   - *Reasoning*: Each provider represents conversation history with distinct invariant rules:
     * Anthropic strictly enforces alternating turns (`user` -> `assistant` -> `user`), places system prompts outside `messages`, and requires tool results to be packaged in `user` turns with matching `tool_use_id`.
     * Gemini enforces `contents` with `role: "user" | "model"`, placing tool responses inside `user` turns as `function_response` parts, and system prompts inside `system_instruction`.
     * OpenAI/OpenCode enforces `messages` where tool outputs have their own explicit role `tool` and system prompts reside inside `messages`.
   - *Conclusion*: PAL must define a canonical `PalMessage` and `PalContentBlock` model. Adapters must provide bi-directional, deterministic serializers and deserializers that validate invariants and prevent conversational state corruption.

3. **Step 3: Reasoning Traces & Extended Thinking Representation**:
   - *Observation Reference*: 2, 3, 4.
   - *Reasoning*: Next-generation models (Claude 3.7 Sonnet, Gemini 2.0 Flash Thinking, DeepSeek R1) produce explicit chain-of-thought traces. In multi-agent systems, exposing these thoughts to verification gates (Auditors, Challengers) enables forensic verification of an agent's reasoning prior to code mutations. However, re-submitting raw thought tokens back to providers often violates API schemas or doubles cost.
   - *Conclusion*: Canonical content blocks must include `PalThoughtContent` with `signature` and `redacted` flags. Adapters must negotiate whether thoughts are preserved in conversation history, stripped, or stored in out-of-band audit logs.

4. **Step 4: Tool Definition, Model Context Protocol (MCP), and Fallbacks**:
   - *Observation Reference*: 2, 4.
   - *Reasoning*: Claude and Antigravity handle native JSON schema function declarations seamlessly. Open-source local models (Ollama/vLLM) often suffer from hallucinations when encountering nested JSON schemas or produce invalid JSON arguments.
   - *Conclusion*: PAL must support a unified `PalToolDefinition` compatible with JSON Schema Draft 7 / Draft 2020-12 and MCP (Model Context Protocol). When targeting models lacking robust native tool calling, PAL must provide an automatic **ReAct Fallback Engine** that formats tools into system instructions and parses tool calls from XML/markdown blocks with automatic schema validation and repair.

5. **Step 5: Dynamic Capability Negotiation & Unified Rate Limiting**:
   - *Observation Reference*: 2, 3, 4, 5.
   - *Reasoning*: Hardcoding provider assumptions causes runtime crashes when switching between models (e.g. attempting to enable prompt caching on Ollama, or sending 200k tokens to an 8k local context model).
   - *Conclusion*: PAL must incorporate a `PalCapabilityMatrix` inspected at runtime before request dispatch. A unified `RateLimiter` with leaky-bucket tracking and `retry-after` header parsing must pause the looper and signal the scheduler without crashing agent turns.

---

## 3. Comprehensive PAL Specification & Interface Contracts

### 3.1 Architectural Structure (Hexagonal Ports & Adapters)

```
                       ┌──────────────────────────────────────────────┐
                       │           Multi-Agent Looper Core            │
                       │    (Orchestrator, Workers, Challengers)      │
                       └──────────────────────┬───────────────────────┘
                                              │
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │          Provider Abstraction Layer          │
                       │                    (PAL)                     │
                       ├──────────────────────────────────────────────┤
                       │  • Canonical Message Schema                  │
                       │  • Bi-directional Turn Normalizer            │
                       │  • Unified Tool & MCP Bridge                 │
                       │  • Capability Negotiation Engine             │
                       │  • Adaptive Rate Limiter & Token Meter       │
                       └───────┬──────────────┬──────────────┬────────┘
                               │              │              │
                ┌──────────────┘              │              └──────────────┐
                ▼                             ▼                             ▼
   ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
   │      Claude Adapter      │  │   Antigravity Adapter    │  │     OpenCode Adapter     │
   ├──────────────────────────┤  ├──────────────────────────┤  ├──────────────────────────┤
   │ • Anthropic Messages API │  │ • Google Gemini GenAI    │  │ • Ollama / vLLM API      │
   │ • Claude Agent SDK / CLI │  │ • Antigravity CLI Runner │  │ • OpenCode CLI / ACP     │
   │ • Extended Thinking      │  │ • 2M Context Token Count │  │ • LiteLLM Proxy          │
   │ • Ephemeral Prompt Cache │  │ • Thought Part Extraction│  │ • ReAct Fallback Parser  │
   │ • MCP Tool Bridge        │  │ • Antigravity NDJSON     │  │ • JSON Argument Repair   │
   └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘
```

---

### 3.2 Canonical Data Model & Message Schema

```typescript
/**
 * Canonical PAL Message Schema
 */
export interface PalMessage {
  id: string; // UUID v4
  role: "system" | "user" | "assistant" | "tool";
  content: PalContentBlock[];
  name?: string; // Semantic agent sender (e.g., "orchestrator", "sentinel", "auditor")
  timestamp: string; // ISO 8601 UTC
  metadata?: Record<string, unknown>;
}

export type PalContentBlock =
  | PalTextContent
  | PalThoughtContent
  | PalToolCallContent
  | PalToolResultContent
  | PalImageContent;

export interface PalTextContent {
  type: "text";
  text: string;
  cacheControl?: { type: "ephemeral" };
}

export interface PalThoughtContent {
  type: "thought";
  text: string;
  signature?: string; // Cryptographic verification block (Claude 3.7 / signed models)
  redacted?: boolean;
}

export interface PalToolCallContent {
  type: "tool_call";
  id: string; // Unique call identifier
  name: string;
  arguments: Record<string, unknown>; // Parsed JSON arguments
  rawArguments?: string; // Raw string payload before JSON parse
}

export interface PalToolResultContent {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  content: string | PalContentBlock[];
  isError: boolean;
  durationMs?: number;
}

export interface PalImageContent {
  type: "image";
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string; // Base64 encoded payload
}
```

---

### 3.3 Provider Transformation & Invariant Resolution Matrix

| Dimension | Anthropic Claude | Google Gemini / Antigravity | OpenCode / OpenAI / Ollama |
| :--- | :--- | :--- | :--- |
| **System Prompt** | Top-level `system` parameter (string or array of text blocks with cache markers). Cannot be in `messages`. | Top-level `system_instruction` object with `parts: [{ text }]`. Cannot be in `contents`. | First message in `messages` array with `role: "system"` or `role: "developer"`. |
| **Turn Alternation** | Strictly alternating `user` $\leftrightarrow$ `assistant`. Successive user messages must be combined. | Strictly alternating `user` $\leftrightarrow$ `model`. | Relaxed. Consecutive messages with same role generally permitted. |
| **Tool Call Emission** | Inside `assistant` message as `{ type: "tool_use", id, name, input }`. | Inside `model` message as `parts: [{ function_call: { name, args } }]`. | Inside `assistant` message as `tool_calls: [{ id, type: "function", function: { name, arguments: JSON_string } }]`. |
| **Tool Result Ingestion** | Inside `user` turn as `{ type: "tool_result", tool_use_id, content, is_error }`. | Inside `user` turn as `parts: [{ function_response: { name, response: { content } } }]`. | Separate message with `role: "tool"`, `tool_call_id`, and `content: string`. |
| **Thinking / Thoughts** | Blocks `{ type: "thinking", thinking, signature }`. Budget controlled via `thinking: { type: "enabled", budget_tokens }`. | Part with `thought: true` or dedicated thinking tokens in `Gemini 2.0 Flash Thinking`. | `reasoning_content` delta field (DeepSeek/Qwen) or raw `<think>...</think>` regex extraction. |
| **Prompt Caching** | Explicit breakpoints `cache_control: { type: "ephemeral" }` on system or user blocks (up to 4 per request). | Implicit context caching via `cached_contents` API resource or automated prefix caching. | Server-side KV-cache (vLLM automatic prefix caching), no explicit API markers needed. |

---

### 3.4 Unified Tool Definition & Execution Interface

```typescript
export interface PalToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface PalToolDefinition {
  name: string;
  description: string;
  parameters: PalToolParameterSchema;
  source: "native" | "mcp";
  mcpServerName?: string;
  timeoutMs?: number;
}

export type PalToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; name: string };

export interface PalToolExecutionContext {
  sessionId: string;
  cwd: string;
  agentRole: string;
  abortSignal: AbortSignal;
  log: (event: string, data: Record<string, unknown>) => void;
}

export type PalToolHandler = (
  input: Record<string, unknown>,
  context: PalToolExecutionContext
) => Promise<{ result: unknown; isError?: boolean }>;
```

---

### 3.5 Streaming, Token Accounting & Usage Interface

```typescript
export type PalStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thought_delta"; thought: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string; toolCall: PalToolCallContent }
  | { type: "usage_update"; usage: PalTokenUsage }
  | { type: "rate_limit_warning"; info: PalRateLimitInfo }
  | { type: "finish"; reason: PalFinishReason; fullMessage: PalMessage };

export type PalFinishReason =
  | "stop"
  | "tool_calls"
  | "max_tokens"
  | "content_filter"
  | "error";

export interface PalTokenUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface PalRateLimitInfo {
  provider: string;
  limitRequests?: number;
  remainingRequests?: number;
  limitTokens?: number;
  remainingTokens?: number;
  resetsAt: number; // Unix epoch ms
  retryAfterMs?: number;
}
```

---

### 3.6 Capability Negotiation Matrix & Fallback Policy

```typescript
export interface PalProviderCapabilities {
  providerName: "claude" | "antigravity" | "opencode";
  modelName: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  supportsNativeTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsExtendedThinking: boolean;
  thinkingMode: "native_tokens" | "tag_parsed" | "unsupported";
  supportsPromptCaching: boolean;
  promptCachingType: "ephemeral_blocks" | "explicit_object" | "unsupported";
  requiresToolResultPairing: boolean;
}
```

#### Feature Fallback Rules:
1. **ReAct Tool Fallback Engine**:
   - Condition: Target model has `supportsNativeTools: false` (e.g., small local models via Ollama).
   - PAL Action: Injects tool specifications into system prompt using standard markdown/XML:
     ```xml
     <tools>
     {"name": "view_file", "description": "...", "parameters": {...}}
     </tools>
     To call a tool, format your response as:
     <tool_call>
     {"name": "view_file", "arguments": {"AbsolutePath": "/path/to/file"}}
     </tool_call>
     ```
   - Stream parser scans for `<tool_call>` tags, constructs canonical `PalToolCallContent`, invokes tool, and formats the output into `<tool_response>` blocks.

2. **JSON Argument Auto-Repair**:
   - Condition: Local model outputs malformed JSON in tool calls (e.g., unescaped quotes, trailing commas, markdown fences).
   - PAL Action: Runs tolerant JSON parser (strips markdown fences, balances braces, replaces single quotes, repairs control characters) before reporting tool invocation failure.

3. **Context Window Guard & Compaction Trigger**:
   - Condition: Estimated tokens exceed 85% of `maxContextTokens`.
   - PAL Action: Dispatches a `context_warning` event to the Multi-Agent Looper engine, triggering conversational summarization or briefing persistence before hard context overflow occurs.

---

### 3.7 Error Classification & Adaptive Backoff

```typescript
export type PalErrorKind =
  | "rate_limit"      // 429, RESOURCE_EXHAUSTED -> Pause looper until resetsAt
  | "overloaded"      // 503, 529 -> Exponential backoff with full jitter
  | "context_exceeded"// Context window limit -> Looper triggers compaction
  | "auth_failure"    // 401, 403 -> Fatal, abort loop
  | "content_filter"  // Safety block -> Trigger Auditor / Challenger evaluation
  | "tool_error"      // Execution error inside tool -> Return isError: true to agent
  | "invalid_request" // Schema or malformed query -> Fatal or retry with clean turn
  | "timeout";        // Socket or process hung -> Terminate and restart session
```

---

## 4. Decomposed Engineering Tasks for GitHub Project #4

To fulfill Requirement R2 of `ORIGINAL_REQUEST.md`, here are the concrete, modular engineering tasks decomposed specifically for the Provider Abstraction Layer (PAL) work stream. Each task strictly includes the 4 mandatory sections in Spanish:

---

### Tarea PAL-01: Modelo Unificado de Mensajes, Bloques de Contenido y Normalizador Bi-direccional

#### 1. Propósito de la tarea
Diseñar e implementar el núcleo de tipos de datos (`packages/pal-core`) que define el esquema canónico de mensajes (`PalMessage`) y bloques de contenido (`PalContentBlock`: texto, pensamiento/razonamiento, llamada a herramientas, resultados de herramientas e imágenes), acompañado de un motor normalizador bi-direccional que transforme historiales de conversación entre los formatos nativos de Anthropic Messages API, Google Gemini GenAI y OpenAI/OpenCode Chat Completions sin pérdida de fidelidad semántica.

#### 2. Qué se espera lograr
- Crear el paquete TypeScript tipado estrictamente sin `any`.
- Implementar validadores de invariantes conversacionales (alternancia estricta de turnos para Claude/Gemini, emparejamiento de `tool_use_id`, extracción y colocación de `system_instruction` fuera del array de mensajes en Claude/Gemini).
- Manejar bloques de pensamiento (`PalThoughtContent`) preservando firmas criptográficas y permitiendo redacción para auditorías forenses sin enviar tokens redundantes al proveedor.
- Proporcionar suites de pruebas unitarias con casos borde de conversión cruzada entre proveedores.

#### 3. Goal de la tarea
Lograr que cualquier agente del looper multi-agente (Orquestador, Trabajador, Revisor, Challenger) se comunique en un formato unificado agnóstico, permitiendo cambiar el modelo subyacente entre Claude 3.7, Gemini 2.0 y DeepSeek R1 en medio de un loop conversacional sin desfasar el historial ni corromper las secuencias de herramientas.

#### 4. Criterios de completitud / Definition of Done
- [ ] Módulo `packages/pal-core/messages.ts` implementado con tipado estricto e inmutable.
- [ ] Convertidores `toClaudeMessages()`, `toGeminiContents()`, y `toOpenAiMessages()` implementados con sus respectivos deserializadores inversos.
- [ ] 100% de tests unitarios pasando (`bun test packages/pal-core`) con cobertura >90%, cubriendo casos de turnos de usuario consecutivos, turnos con múltiples llamadas a herramientas y bloques de razonamiento/pensamiento.
- [ ] Verificación estricta de TypeScript (`bunx tsc --noEmit`) sin advertencias ni errores.

---

### Tarea PAL-02: Adaptador Provider de Claude (Anthropic API, SDK y Claude Code)

#### 1. Propósito de la tarea
Desarrollar el adaptador `ClaudePalAdapter` (`packages/pal-claude`) con soporte dual: conexión directa vía Anthropic Messages API v1 / SDK oficial y modo sub-proceso interactivo para Claude Code Agent SDK, incorporando extended thinking (`thinking` budget tokens), prompt caching efímero (`cache_control`) y gestión de límites de consumo por headers.

#### 2. Qué se espera lograr
- Implementar la interfaz `IPalProvider` para Anthropic Claude (Sonnet 3.7, Haiku 3.5, Opus 3).
- Soporte nativo de streaming Server-Sent Events (SSE) decodificando eventos `content_block_start`, `content_block_delta`, `message_delta` y extrayendo tanto texto como deltas de razonamiento y uso de tokens (`cache_creation_input_tokens`, `cache_read_input_tokens`).
- Gestión automática de breakpoints de caché (`cache_control: { type: "ephemeral" }`) en el prompt del sistema y los últimos mensajes estables.
- Detección y manejo adaptativo de errores de sobrecarga (529 `overloaded_error`) y rate limit (429 `rate_limit_error`) leyendo los headers `anthropic-ratelimit-*`.

#### 3. Goal de la tarea
Proveer una integración robusta y de producción para Claude que maximice la velocidad y reduzca los costos mediante prompt caching, habilitando razonamiento profundo para las fases de análisis arquitectónico y revisión crítica del looper.

#### 4. Criterios de completitud / Definition of Done
- [ ] Adaptador `ClaudePalAdapter` implementa completamente la interfaz `IPalProvider`.
- [ ] Pruebas de integración simuladas (mocked API responses) validando streaming SSE, extended thinking y captura de métricas de caché.
- [ ] Parser de headers de rate limit y cálculo del tiempo exacto de reanudación (`resetsAt`).
- [ ] Modo fallback para Claude Code CLI (`claude-agent-sdk`) probado y compatible con los hooks de telemetría del sistema.
- [ ] Tests de verificación pasando con código de salida `0` (`bun test packages/pal-claude`).

---

### Tarea PAL-03: Adaptador Provider de Antigravity (Google Gemini API y Runner CLI)

#### 1. Propósito de la tarea
Construir el adaptador `AntigravityPalAdapter` (`packages/pal-antigravity`) que soporte la API de Google Gemini (1.5 Pro/Flash y 2.0 Flash) y el runner de consola de Antigravity CLI (`agy --output-format stream-json`), gestionando ventanas de contexto de hasta 2 millones de tokens, streaming de partes de pensamiento (`thought: true`) y conteo de tokens en tiempo real.

#### 2. Qué se espera lograr
- Mapear llamadas de herramientas canónicas hacia declaraciones `function_declarations` de Gemini con modos `AUTO`, `ANY` y `NONE`.
- Procesar el stream NDJSON de `agy` y la API REST `:streamGenerateContent`, capturando deltas de texto, llamadas a herramientas en estado `ACTIVE`, y deltas de respuesta.
- Integrar la estimación de costos en USD y métricas de consumo de tokens (tokens de entrada, tokens de salida, thinking tokens y tokens cacheados).
- Clasificar excepciones de seguridad (`finish_reason: SAFETY`) y cuotas agotadas (`RESOURCE_EXHAUSTED` / 429) enviando señales pausadas o de escalación al looper.

#### 3. Goal de la tarea
Permitir que el multi-agent looper explote el contexto masivo (1M–2M tokens) y la alta velocidad de Gemini para tareas de análisis exhaustivo del repositorio completo, auditoría forense de código y ejecución de sub-agentes en Antigravity.

#### 4. Criterios de completitud / Definition of Done
- [ ] Adaptador `AntigravityPalAdapter` implementado con soporte de API directa y runner CLI `agy`.
- [ ] Normalización de respuestas de herramientas envolviendo el resultado en `function_response: { name, response: { content } }`.
- [ ] Suite de pruebas unitarias verificando el parsing de streams NDJSON de `agy` y payloads REST de Gemini.
- [ ] Manejo verificado de excepciones de cuota con reintentos exponenciales y reporte de estado `paused`.
- [ ] Verificación de tipado estricto (`bunx tsc --noEmit`) y ejecución exitosa de pruebas (`bun test packages/pal-antigravity`).

---

### Tarea PAL-04: Adaptador Provider de OpenCode (Ollama, vLLM, LiteLLM y OpenCode CLI)

#### 1. Propósito de la tarea
Desarrollar el adaptador `OpenCodePalAdapter` (`packages/pal-opencode`) para modelos de código abierto y locales (DeepSeek R1/V3, Qwen 2.5, Llama 3) a través de servidores compatibles con OpenAI (Ollama, vLLM, LiteLLM, SGLang) y la CLI de OpenCode (`opencode run --format json`), incluyendo motor de reparación de JSON y fallback ReAct.

#### 2. Qué se espera lograr
- Conectar endpoints OpenAI-compatibles (`/v1/chat/completions`) con soporte de streaming SSE y extracción de tokens de razonamiento (`reasoning_content` y etiquetas `<think>`).
- Implementar el motor **ReAct Fallback Engine**: para modelos que no soportan function calling estructurado de forma nativa, inyectar definiciones de herramientas en formato Markdown/XML en el prompt del sistema y extraer invocaciones mediante expresiones regulares tolerantes a fallos.
- Incorporar reparador automático de JSON (`JsonAutoRepair`) para solucionar errores típicos de modelos abiertos (comillas sin escapar, comas finales, bloques de código markdown encapsulados).
- Mapear el sistema de permisos de ejecución en disco y bash mediante configuración dinámica de OpenCode (`OPENCODE_CONFIG_CONTENT`).

#### 3. Goal de la tarea
Garantizar la soberanía tecnológica y el funcionamiento 100% offline o sobre infraestructura propia del multi-agent looper, permitiendo ejecutar bucles autónomos de desarrollo con modelos abiertos sin degradar la confiabilidad del sistema de herramientas.

#### 4. Criterios de completitud / Definition of Done
- [ ] `OpenCodePalAdapter` funcional tanto vía API HTTP (`fetch` a Ollama/vLLM) como invocando el proceso CLI `opencode`.
- [ ] Parser ReAct Fallback probado con modelos pequeños (7B/8B) simulados, logrando extracción y ejecución exitosa de herramientas.
- [ ] Módulo `JsonAutoRepair` capaz de corregir al menos 10 patrones comunes de JSON malformado producidos por LLMs.
- [ ] Cobertura de pruebas unitarias con mock servers HTTP SSE y verificación de cero errores de compilación (`bun test packages/pal-opencode`).

---

### Tarea PAL-05: Motor de Negociación de Capacidades, Rate Limiting Adaptativo y Registro Unificado

#### 1. Propósito de la tarea
Implementar la infraestructura de coordinación de PAL (`packages/pal-runtime`): matriz de capacidades dinámicas (`PalCapabilityMatrix`), limitador de tasa adaptativo con cola de espera distribuida (`PalRateLimiter`) y el registro central de proveedores (`PalRegistry`) con resolución de modelos y políticas de fallback en cascada.

#### 2. Qué se espera lograr
- Inspección dinámica de capacidades por modelo (`maxContextTokens`, `supportsNativeTools`, `supportsExtendedThinking`, `supportsVision`, `supportsPromptCaching`).
- Degradación elegante de características: si un modelo no soporta razonamiento extendido, convertir el parámetro `effort` en directivas del prompt del sistema; si excede el 85% del contexto, emitir evento de alerta para compactación de historial.
- Implementar algoritmo Token Bucket y Leaky Bucket con ventana deslizante para evitar saturar cuotas de proveedores compartidos entre múltiples sub-agentes concurrentes.
- Sistema de fallback automático: si un proveedor falla por cuota o indisponibilidad (503/429 persistente), redirigir la tarea al siguiente modelo calificado según la política configurada.

#### 3. Goal de la tarea
Asegurar la resiliencia operativa y la escalabilidad del multi-agent looper, permitiendo la ejecución concurrente de decenas de agentes (Orquestador, Sentinel, Workers, Auditores) sin bloqueos por concurrencia ni desbordamientos de ventanas de contexto.

#### 4. Criterios de completitud / Definition of Done
- [ ] Módulo `PalCapabilityMatrix` documentando y testeando más de 12 modelos principales (Claude 3.7/3.5, Gemini 2.0/1.5, DeepSeek R1/V3, Qwen 2.5, Llama 3.3).
- [ ] Limitador de tasa `PalRateLimiter` probado en escenarios de estrés y saturación concurrente, verificando pausa y reanudación limpia de promesas.
- [ ] `PalRegistry` con soporte de alias (`claude`, `antigravity`, `agy`, `opencode`, `local`) y cadenas de fallback configurables.
- [ ] Ejecución exitosa de la suite completa de tests de integración del runtime con `bun test`.

---

## 5. Caveats

1. **Permiso de Navegación Externa a antigravity.google**:
   - Durante la investigación, el acceso directo vía `read_url_content` a `https://antigravity.google/docs/teamwork/` fue restringido por la política de seguridad del entorno (`Permission prompt for action 'read_url' on target 'antigravity.google' was denied`).
   - Mitigación: Se utilizaron los archivos arquitectónicos existentes en el repositorio (`antigravity.ts`, `config.ts`, `.agents/teamwork/ORIGINAL_REQUEST.md`, `teamwork_preview_orchestrator_1/plan.md`) y el conocimiento formal del protocolo de Antigravity CLI / Gemini API para derivar las especificaciones técnicas completas sin pérdida de fidelidad.

2. **Diferencias entre Versiones de SDKs y CLIs Locales**:
   - Se asume que en el entorno de despliegue final estarán disponibles las versiones estándar de los runtimes: Bun $\ge$ 1.1, Node $\ge$ 20, y los binarios correspondientes en `PATH` (`agy`, `opencode`, `claude`) si se opera en modo CLI sub-process, o las variables de entorno (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `OPENAI_API_BASE` / `OLLAMA_HOST`) si se opera en modo Direct API.

3. **Sin Modificaciones al Código Fuente Existente**:
   - De acuerdo a las reglas estrictas de investigación ("Read-only investigation — do NOT implement"), no se alteraron los archivos de producción en este turno; las especificaciones, interfaces y desgloses de tareas se documentan formalmente en este reporte y en el workspace de `explorer_survey_2`.

---

## 6. Conclusion

La arquitectura de la Capa de Abstracción de Proveedores (PAL) diseñada resuelve de manera integral los desafíos de interoperabilidad entre Claude, Antigravity y OpenCode:
1. **Esquema de Datos Canónico**: Permite la alternancia fluida de modelos durante el ciclo de vida del looper sin corrupción de historiales ni desalineación de IDs de herramientas.
2. **Soporte de Pensamiento y Razonamiento Forense**: Los bloques `PalThoughtContent` permiten que sub-agentes auditores y de verificación adversarial inspeccionen la cadena de razonamiento de un modelo antes de autorizar cambios en el código.
3. **Resiliencia Operativa y Fallback**: El motor ReAct Fallback y el corrector de JSON garantizan que modelos locales y de código abierto en OpenCode participen plenamente en el bucle multi-agente sin fallos por esquemas estrictos.
4. **Desglose de Ingeniería Listo para GitHub Project #4**: Las 5 tareas detalladas en la Sección 4 cumplen estrictamente con los 4 campos obligatorios en español y proporcionan la base directa para la Fase 2 del plan maestro.

---

## 7. Verification Method

Para verificar independientemente las conclusiones, tipos y contratos expuestos en este informe:

1. **Inspección de Archivos de Referencia**:
   ```bash
   bun test engine.test.ts
   ```
   Comprueba que los adaptadores base existentes (`claude`, `opencode`, `antigravity`) compilan y ejecutan sus suites de pruebas de interfaz en el estado actual.

2. **Validación de Tipado y Sintaxis**:
   ```bash
   bunx tsc --noEmit
   ```
   Verifica que no existen errores de tipo en el proyecto base.

3. **Verificación de Cumplimiento de Contratos**:
   - Revisar `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2/handoff.md` contra los requerimientos de `ORIGINAL_REQUEST.md` (R1 y R2).
   - Confirmar que las 5 tareas desglosadas contienen exactamente las cuatro secciones obligatorias:
     1. Propósito de la tarea
     2. Qué se espera lograr
     3. Goal de la tarea
     4. Criterios de completitud / Definition of Done.
