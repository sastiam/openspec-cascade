/**
 * Unified Engine Adapter interfaces and registry for openspec-cascade.
 *
 * Implements Ports & Adapters pattern to decouple agent execution engines
 * (Claude, OpenCode, Antigravity) from the cascade runner harness.
 */

import { CONSTANTS, type CascadeConfig, type EngineType, resolveEngine } from "./config";
import { AntigravityAdapter, antigravityAdapter } from "./antigravity";
import { ClaudeAdapter, claudeAdapter } from "./claude";
import { OpenCodeAdapter, openCodeAdapter } from "./opencode";

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

export {
  AntigravityAdapter,
  antigravityAdapter,
  ClaudeAdapter,
  claudeAdapter,
  OpenCodeAdapter,
  openCodeAdapter,
};

export const engineAdapters: Record<EngineType, EngineAdapter> = {
  claude: claudeAdapter,
  opencode: openCodeAdapter,
  antigravity: antigravityAdapter,
};

/**
 * Resolves and returns the EngineAdapter for the given engine name or alias.
 */
export function getEngineAdapter(engine: EngineType | string | undefined): EngineAdapter {
  const resolved = resolveEngine(engine);
  const adapter = engineAdapters[resolved];
  if (!adapter) {
    throw new Error(`Unknown engine adapter: "${engine}"`);
  }
  return adapter;
}
