/**
 * GoF Decorator adding bounded retries (exponential backoff + full jitter) and a
 * closed / open / half-open circuit breaker around any `UnifiedEngine`.
 *
 * `paused` (rate limit) and `fatal` outcomes are never retried: waiting is owned by
 * the cascade loop and fatal errors must stop the run.
 */
import type { EngineOutcome, EngineSessionOptions, UsageMeter } from "../../engine";
import { RESILIENCE_CONSTANTS } from "../config/constants";
import type { EngineType } from "../config/schemas";
import type { UnifiedEngine } from "../pal/factory";
import type { ProviderContext } from "../pal/bridge";
import type { IPalProvider } from "../pal/types";
import { abortableSleep } from "../runtime/process_control";

export type CircuitState = "closed" | "open" | "half_open";

export interface ResilienceOptions {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

/**
 * Full-jitter exponential backoff: `random() * min(maxDelay, base * factor^attempt)`.
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * RESILIENCE_CONSTANTS.BACKOFF_FACTOR ** attempt);
  return Math.floor(random() * ceiling);
}

export class ResilientEngineDecorator implements UnifiedEngine {
  readonly readUsage?: (cwd: string) => Promise<UsageMeter[] | null>;
  private readonly inner: UnifiedEngine;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private openedAt: number | undefined;
  private state: CircuitState = "closed";

  constructor(inner: UnifiedEngine, options: ResilienceOptions = {}) {
    this.inner = inner;
    this.maxRetries = options.maxRetries ?? RESILIENCE_CONSTANTS.DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? RESILIENCE_CONSTANTS.DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? RESILIENCE_CONSTANTS.DEFAULT_MAX_DELAY_MS;
    this.failureThreshold = options.failureThreshold ?? RESILIENCE_CONSTANTS.DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? RESILIENCE_CONSTANTS.DEFAULT_COOLDOWN_MS;
    this.sleep = options.sleep ?? ((ms) => abortableSleep(ms));
    this.random = options.random ?? Math.random;
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

  get circuitState(): CircuitState {
    return this.state;
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
    if (!this.admit(options)) {
      return {
        kind: "fatal",
        reason: `${this.inner.name}: ${RESILIENCE_CONSTANTS.CIRCUIT_OPEN_REASON} after ${this.consecutiveFailures} consecutive failures`,
        costUsd: 0,
      };
    }
    let accumulatedCost = 0;
    let lastOutcome: EngineOutcome | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = computeBackoffDelay(attempt - 1, this.baseDelayMs, this.maxDelayMs, this.random);
        options.hooks.log(RESILIENCE_CONSTANTS.RETRY_EVENT, {
          engine: this.inner.name,
          attempt,
          delayMs,
          reason: lastOutcome?.kind === "error" ? lastOutcome.reason : undefined,
        });
        await this.sleep(delayMs);
      }
      const resume = lastOutcome !== undefined && "sessionId" in lastOutcome ? lastOutcome.sessionId ?? options.resume : options.resume;
      const outcome = await this.invoke({ ...options, resume });
      accumulatedCost += outcome.costUsd;
      lastOutcome = { ...outcome, costUsd: accumulatedCost };
      if (outcome.kind !== "error") {
        this.recordResult(outcome.kind === "done" || outcome.kind === "paused", options);
        return lastOutcome;
      }
      this.recordResult(false, options);
      if (this.state === "open") {
        return lastOutcome;
      }
    }
    return lastOutcome ?? { kind: "fatal", reason: `${this.inner.name}: no attempt executed`, costUsd: accumulatedCost };
  }

  private async invoke(options: EngineSessionOptions): Promise<EngineOutcome> {
    try {
      return await this.inner.runSession(options);
    } catch (error) {
      return {
        kind: "error",
        sessionId: options.resume,
        reason: error instanceof Error ? error.message : String(error),
        costUsd: 0,
      };
    }
  }

  private admit(options: EngineSessionOptions): boolean {
    if (this.state !== "open") {
      return true;
    }
    if (this.openedAt !== undefined && this.now() - this.openedAt >= this.cooldownMs) {
      this.transition("half_open", options);
      return true;
    }
    return false;
  }

  private recordResult(success: boolean, options: EngineSessionOptions): void {
    if (success) {
      this.consecutiveFailures = 0;
      if (this.state !== "closed") {
        this.openedAt = undefined;
        this.transition("closed", options);
      }
      return;
    }
    this.consecutiveFailures++;
    if (this.state === "half_open" || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.now();
      this.transition("open", options);
    }
  }

  private transition(next: CircuitState, options: EngineSessionOptions): void {
    if (next === this.state) {
      return;
    }
    options.hooks.log(RESILIENCE_CONSTANTS.CIRCUIT_EVENT, {
      engine: this.inner.name,
      from: this.state,
      to: next,
      consecutiveFailures: this.consecutiveFailures,
    });
    this.state = next;
  }
}
