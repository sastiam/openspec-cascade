import type { EngineOutcome, EngineSessionOptions } from "../../engine";
import type { UnifiedEngine } from "../../src/pal/factory";
import type { IPalProvider } from "../../src/pal/types";

/**
 * Unit-test engine that replays a fixed sequence of outcomes (or thrown errors).
 */
export class ScriptedEngine implements UnifiedEngine {
  readonly name = "opencode" as const;
  readonly engineType = "opencode" as const;
  readonly calls: EngineSessionOptions[] = [];
  private readonly script: Array<EngineOutcome | Error>;

  constructor(script: Array<EngineOutcome | Error>) {
    this.script = [...script];
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    this.calls.push(options);
    options.hooks.log("opencode_exit", { usage: { inputTokens: 10, outputTokens: 5 } });
    const next = this.script.shift() ?? { kind: "done", result: "default", costUsd: 0 };
    if (next instanceof Error) throw next;
    return next;
  }

  getDefaultModel(): string {
    return "scripted-model";
  }

  supportsPlanMeters(): boolean {
    return false;
  }

  getProvider(): IPalProvider {
    throw new Error("provider not available in ScriptedEngine");
  }
}
