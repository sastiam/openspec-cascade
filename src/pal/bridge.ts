/**
 * Adapts any v2 `IPalProvider` to the session-level v1 `EngineAdapter` contract.
 *
 * The cascade runner speaks `runSession(prompt) -> EngineOutcome`; PAL providers speak
 * `executeTurn(messages) -> PalOutcome`. The bridge lets engines that only exist as
 * PAL providers (Jules) run under the v1 loop, and lets the v2 dispatcher reuse the
 * same provider instances.
 */
import { randomUUID } from "node:crypto";
import type { EngineAdapter, EngineOutcome, EngineSessionOptions } from "../engine/contract";
import { TIMEOUT_CONSTANTS } from "../config/constants";
import type { EngineType } from "../config/schemas";
import {
  createPalMessage,
  createTextBlock,
  isPalTextContent,
  isPalToolCallContent,
  PAL_ERROR_KINDS,
  PAL_ROLES,
  PalError,
  type IPalProvider,
  type PalErrorKind,
} from "./types";

export interface ProviderContext {
  readonly cwd: string;
  readonly model?: string;
}

export interface PalEngineBridgeOptions {
  readonly engineType: EngineType;
  readonly defaultModel: string;
  readonly createProvider: (context: ProviderContext) => IPalProvider;
  readonly rateLimitSleepMs?: number;
  readonly now?: () => number;
}

const FATAL_PAL_ERROR_KINDS: ReadonlySet<PalErrorKind> = new Set([
  PAL_ERROR_KINDS.AUTH_FAILURE,
  PAL_ERROR_KINDS.INVALID_REQUEST,
  PAL_ERROR_KINDS.CONTENT_FILTER,
]);

const PAUSING_PAL_ERROR_KINDS: ReadonlySet<PalErrorKind> = new Set([
  PAL_ERROR_KINDS.RATE_LIMIT,
  PAL_ERROR_KINDS.OVERLOADED,
]);

export class PalEngineBridge implements EngineAdapter {
  readonly name: EngineType;
  private readonly options: PalEngineBridgeOptions;

  constructor(options: PalEngineBridgeOptions) {
    this.name = options.engineType;
    this.options = options;
  }

  getDefaultModel(): string {
    return this.options.defaultModel;
  }

  supportsPlanMeters(): boolean {
    return false;
  }

  /**
   * Builds the provider bound to a working directory and model, exposed for the v2 dispatcher.
   */
  createProvider(context: ProviderContext): IPalProvider {
    return this.options.createProvider(context);
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    const provider = this.createProvider({ cwd: options.cwd, model: options.model });
    const sessionId = options.resume ?? randomUUID();
    try {
      const outcome = await provider.executeTurn({
        sessionId,
        messages: [createPalMessage({ role: PAL_ROLES.USER, content: [createTextBlock(options.prompt)] })],
      });
      const texts: string[] = [];
      for (const block of outcome.message.content) {
        if (isPalTextContent(block)) {
          texts.push(block.text);
          options.hooks.onText(block.text);
        } else if (isPalToolCallContent(block)) {
          options.hooks.onTool(block.name, block.arguments);
        }
      }
      options.hooks.log("pal_turn", {
        provider: provider.providerName,
        finishReason: outcome.finishReason,
        usage: outcome.usage,
      });
      options.hooks.onModel?.(provider.modelName);
      return { kind: "done", sessionId, result: texts.join("\n"), costUsd: 0 };
    } catch (error) {
      return this.toFailureOutcome(error, sessionId);
    }
  }

  private toFailureOutcome(error: unknown, sessionId: string): EngineOutcome {
    const reason = `${this.name}: ${error instanceof Error ? error.message : String(error)}`;
    if (!(error instanceof PalError)) {
      return { kind: "error", sessionId, reason, costUsd: 0 };
    }
    if (PAUSING_PAL_ERROR_KINDS.has(error.kind)) {
      const now = (this.options.now ?? Date.now)();
      const resumeAt =
        error.resetsAt !== undefined && error.resetsAt > now
          ? error.resetsAt
          : now + (this.options.rateLimitSleepMs ?? TIMEOUT_CONSTANTS.RATE_LIMIT_SLEEP_MS);
      return { kind: "paused", sessionId, resumeAt, costUsd: 0 };
    }
    if (FATAL_PAL_ERROR_KINDS.has(error.kind) || !error.retryable) {
      return { kind: "fatal", reason, costUsd: 0 };
    }
    return { kind: "error", sessionId, reason, costUsd: 0 };
  }
}
