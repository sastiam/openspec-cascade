/**
 * GoF Decorator measuring every engine session: latency, cost, turns, tokens,
 * retries (observed through `engine_retry` hook events) and error category.
 */
import type { EngineHooks, EngineOutcome, EngineSessionOptions, UsageMeter } from "../../engine";
import { ENGINE_TELEMETRY_CONSTANTS, RESILIENCE_CONSTANTS } from "../config/constants";
import type { EngineType } from "../config/schemas";
import type { ProviderContext } from "../pal/bridge";
import type { UnifiedEngine } from "../pal/factory";
import type { IPalProvider } from "../pal/types";

export type EngineErrorCategory =
  | (typeof ENGINE_TELEMETRY_CONSTANTS.ERROR_CATEGORY_PATTERNS)[number][0]
  | typeof ENGINE_TELEMETRY_CONSTANTS.UNKNOWN_CATEGORY;

export interface SessionTelemetryRecord {
  readonly engine: EngineType;
  readonly startedAt: string;
  readonly latencyMs: number;
  readonly outcome: EngineOutcome["kind"] | "thrown";
  readonly costUsd: number;
  readonly turns?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly retries: number;
  readonly errorCategory?: EngineErrorCategory;
  readonly errorMessage?: string;
}

export interface TelemetrySummary {
  readonly sessions: number;
  readonly totalLatencyMs: number;
  readonly averageLatencyMs: number;
  readonly totalCostUsd: number;
  readonly totalTurns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly retries: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly errorsByCategory: Readonly<Record<string, number>>;
}

export interface TelemetryOptions {
  readonly sink?: (record: SessionTelemetryRecord) => void;
  readonly now?: () => number;
}

/**
 * Maps a failure message to a coarse category used for dashboards and self-improvement.
 */
export function classifyEngineError(message: string): EngineErrorCategory {
  for (const [category, pattern] of ENGINE_TELEMETRY_CONSTANTS.ERROR_CATEGORY_PATTERNS) {
    if (pattern.test(message)) {
      return category;
    }
  }
  return ENGINE_TELEMETRY_CONSTANTS.UNKNOWN_CATEGORY;
}

function numericField(record: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

/**
 * Extracts `{ input, output }` token counts from a logged engine event payload, if present.
 */
export function extractTokenUsage(data: Record<string, unknown>): { input: number; output: number } {
  for (const key of ENGINE_TELEMETRY_CONSTANTS.TOKEN_CONTAINER_KEYS) {
    const container = data[key];
    if (typeof container === "object" && container !== null && !Array.isArray(container)) {
      const record = container as Record<string, unknown>;
      return {
        input: numericField(record, ENGINE_TELEMETRY_CONSTANTS.TOKEN_INPUT_KEYS),
        output: numericField(record, ENGINE_TELEMETRY_CONSTANTS.TOKEN_OUTPUT_KEYS),
      };
    }
  }
  return { input: 0, output: 0 };
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

export class TelemetryMetricsDecorator implements UnifiedEngine {
  readonly readUsage?: (cwd: string) => Promise<UsageMeter[] | null>;
  private readonly inner: UnifiedEngine;
  private readonly sink?: (record: SessionTelemetryRecord) => void;
  private readonly now: () => number;
  private readonly records: SessionTelemetryRecord[] = [];

  constructor(inner: UnifiedEngine, options: TelemetryOptions = {}) {
    this.inner = inner;
    this.sink = options.sink;
    this.now = options.now ?? Date.now;
    const innerReadUsage = inner.readUsage?.bind(inner);
    if (innerReadUsage !== undefined) {
      this.readUsage = innerReadUsage;
    }
  }

  get name(): EngineType {
    return this.inner.name;
  }

  get engineType(): EngineType {
    return this.inner.engineType;
  }

  getDefaultModel(effort?: string): string {
    return this.inner.getDefaultModel(effort);
  }

  supportsPlanMeters(): boolean {
    return this.inner.supportsPlanMeters();
  }

  getProvider(context?: Partial<ProviderContext>): IPalProvider {
    return this.inner.getProvider(context);
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    const startedAtMs = this.now();
    const counters = { retries: 0, input: 0, output: 0 };
    const hooks: EngineHooks = {
      ...options.hooks,
      log: (event, data) => {
        if (event === RESILIENCE_CONSTANTS.RETRY_EVENT) {
          counters.retries++;
        }
        const tokens = extractTokenUsage(data);
        counters.input += tokens.input;
        counters.output += tokens.output;
        options.hooks.log(event, data);
      },
    };
    const base = {
      engine: this.inner.name,
      startedAt: new Date(startedAtMs).toISOString(),
    };
    try {
      const outcome = await this.inner.runSession({ ...options, hooks });
      const failure = outcome.kind === "error" || outcome.kind === "fatal" ? outcome.reason : undefined;
      this.record({
        ...base,
        latencyMs: this.now() - startedAtMs,
        outcome: outcome.kind,
        costUsd: outcome.costUsd,
        turns: outcome.turns,
        inputTokens: counters.input,
        outputTokens: counters.output,
        retries: counters.retries,
        errorCategory:
          outcome.kind === "paused"
            ? ENGINE_TELEMETRY_CONSTANTS.PAUSED_CATEGORY
            : failure === undefined
              ? undefined
              : classifyEngineError(failure),
        errorMessage: failure,
      });
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.record({
        ...base,
        latencyMs: this.now() - startedAtMs,
        outcome: "thrown",
        costUsd: 0,
        inputTokens: counters.input,
        outputTokens: counters.output,
        retries: counters.retries,
        errorCategory: classifyEngineError(message),
        errorMessage: message,
      });
      throw error;
    }
  }

  /**
   * Returns a copy of every session record captured so far.
   */
  getRecords(): readonly SessionTelemetryRecord[] {
    return [...this.records];
  }

  /**
   * Aggregates the captured session records.
   */
  getSummary(): TelemetrySummary {
    return summarizeTelemetry(this.records);
  }

  private record(entry: SessionTelemetryRecord): void {
    this.records.push(entry);
    this.sink?.(entry);
  }
}

/**
 * Aggregates session records into a `TelemetrySummary`.
 */
export function summarizeTelemetry(records: readonly SessionTelemetryRecord[]): TelemetrySummary {
  const outcomes: Record<string, number> = {};
  const errorsByCategory: Record<string, number> = {};
  let totalLatencyMs = 0;
  let totalCostUsd = 0;
  let totalTurns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let retries = 0;
  for (const record of records) {
    increment(outcomes, record.outcome);
    if (record.errorCategory !== undefined) {
      increment(errorsByCategory, record.errorCategory);
    }
    totalLatencyMs += record.latencyMs;
    totalCostUsd += record.costUsd;
    totalTurns += record.turns ?? 0;
    inputTokens += record.inputTokens;
    outputTokens += record.outputTokens;
    retries += record.retries;
  }
  return {
    sessions: records.length,
    totalLatencyMs,
    averageLatencyMs: records.length === 0 ? 0 : totalLatencyMs / records.length,
    totalCostUsd,
    totalTurns,
    inputTokens,
    outputTokens,
    retries,
    outcomes,
    errorsByCategory,
  };
}
