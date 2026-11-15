/**
 * Unified Engine Adapter interfaces and registry for openspec-cascade.
 *
 * Implements Ports & Adapters pattern to decouple agent execution engines
 * (Claude, OpenCode, Antigravity) from the cascade runner harness.
 */

import { resolveEngine, type EngineType } from "./config";
import { AntigravityAdapter, antigravityAdapter } from "./antigravity";
import { ClaudeAdapter, claudeAdapter } from "./claude";
import { OpenCodeAdapter, openCodeAdapter } from "./opencode";
import { ENGINE_CONSTANTS } from "./src/config/constants";
import { PalEngineBridge } from "./src/pal/bridge";
import { getDefaultEngineFactory } from "./src/pal/factory";

export type { EngineType };
export type {
  EngineAdapter,
  EngineHooks,
  EngineOutcome,
  EngineSessionOptions,
  UsageMeter,
} from "./src/engine/contract";
import type { EngineAdapter } from "./src/engine/contract";

export {
  AntigravityAdapter,
  antigravityAdapter,
  ClaudeAdapter,
  claudeAdapter,
  OpenCodeAdapter,
  openCodeAdapter,
};

/**
 * Session-level Jules engine: the Jules PAL provider bridged to the `EngineAdapter` contract.
 */
export const julesEngineAdapter: PalEngineBridge = new PalEngineBridge({
  engineType: "jules",
  defaultModel: ENGINE_CONSTANTS.DEFAULT_JULES_MODEL,
  createProvider: (context) => getDefaultEngineFactory().createProvider("jules", context),
});

export const engineAdapters: Record<EngineType, EngineAdapter> = {
  claude: claudeAdapter,
  opencode: openCodeAdapter,
  antigravity: antigravityAdapter,
  jules: julesEngineAdapter,
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
