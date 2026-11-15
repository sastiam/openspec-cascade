/**
 * Session-level engine port shared by the v1 cascade loop, the engine adapters, the PAL
 * bridge, the decorators and the facade. Kept free of runtime imports so every consumer
 * can depend on it without creating import cycles.
 */
import type { CascadeConfig, EngineType } from "../config/schemas";

export type { EngineType };

export interface EngineHooks {
  onTool: (name: string, input: unknown) => void;
  onText: (text: string) => void;
  log: (event: string, data: Record<string, unknown>) => void;
  onModel?: (model: string) => void;
}

export interface EngineSessionOptions {
  prompt: string;
  cwd: string;
  resume?: string;
  model?: string;
  effort?: string;
  hooks: EngineHooks;
  config?: CascadeConfig;
  deniedBash?: readonly string[];
  allowedTools?: readonly string[];
  settingSources?: readonly string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export type EngineOutcome =
  | { kind: "done"; sessionId?: string; result: string; costUsd: number; turns?: number; subtype?: string }
  | { kind: "paused"; sessionId?: string; resumeAt: number; costUsd: number; turns?: number; subtype?: string }
  | { kind: "error"; sessionId?: string; reason: string; costUsd: number; turns?: number; subtype?: string }
  | { kind: "fatal"; reason: string; costUsd: number; turns?: number; subtype?: string };

export type UsageMeter = { kind: string; percent: number; resetsAt: number | null };

/**
 * Unified interface for agent execution engines.
 */
export interface EngineAdapter {
  readonly name: EngineType;
  runSession(options: EngineSessionOptions): Promise<EngineOutcome>;
  getDefaultModel(effort?: string): string;
  supportsPlanMeters(): boolean;
  readUsage?(cwd: string): Promise<UsageMeter[] | null>;
}
