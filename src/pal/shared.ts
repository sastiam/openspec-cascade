/**
 * Helpers shared by the session-level CLI engines (OpenCode, Antigravity) and the PAL bridge.
 */
import type { EngineOutcome } from "../../engine";

export type EngineFailureKind = "fatal" | "paused" | "error";

export interface EngineFailurePatterns {
  readonly rateLimit: RegExp;
  readonly unrecoverable: RegExp;
}

/**
 * Classifies a failure message: unrecoverable (auth/model) errors are fatal, rate limits pause, the rest are retryable.
 */
export function classifyEngineFailure(failure: string, patterns: EngineFailurePatterns): EngineFailureKind {
  if (patterns.unrecoverable.test(failure)) return "fatal";
  return patterns.rateLimit.test(failure) ? "paused" : "error";
}

export interface CliSessionResultInput {
  readonly engineLabel: string;
  readonly failure: string | undefined;
  readonly patterns: EngineFailurePatterns;
  readonly sessionId: string | undefined;
  readonly costUsd: number;
  readonly result: string;
  readonly rateLimitSleepMs: number;
  readonly now?: () => number;
}

/**
 * Maps the end state of a CLI engine session to an `EngineOutcome`.
 */
export function toCliSessionOutcome(input: CliSessionResultInput): EngineOutcome {
  const { failure, sessionId, costUsd } = input;
  if (failure === undefined) {
    return { kind: "done", sessionId, result: input.result, costUsd };
  }
  const kind = classifyEngineFailure(failure, input.patterns);
  if (kind === "fatal") return { kind, reason: `${input.engineLabel}: ${failure}`, costUsd };
  if (kind === "paused") {
    return { kind, sessionId, resumeAt: (input.now ?? Date.now)() + input.rateLimitSleepMs, costUsd };
  }
  return { kind, sessionId, reason: failure, costUsd };
}
