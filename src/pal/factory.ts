/**
 * Creational factory unifying every engine behind both the v1 `EngineAdapter`
 * (session) contract and the v2 `IPalProvider` (turn) contract.
 */
import { AntigravityAdapter } from "../../antigravity";
import { ClaudeAdapter } from "../../claude";
import type { EngineAdapter, EngineOutcome, EngineSessionOptions, UsageMeter } from "../engine/contract";
import { OpenCodeAdapter } from "../../opencode";
import { ENGINE_CONSTANTS } from "../config/constants";
import { ConfigValidationError, EngineTypeSchema, type EngineType } from "../config/schemas";
import { getDefaultSpawner, toAdapterProcess, type AdapterProcess } from "../runtime/spawner";
import type { ISpawner } from "../runtime/types";
import { createClaudeAdapter } from "./adapters/claude";
import { createGeminiAdapter } from "./adapters/gemini";
import { JulesAdapter } from "./adapters/jules";
import { createOpenCodeAdapter } from "./adapters/opencode";
import { PalEngineBridge, type ProviderContext } from "./bridge";
import type { IPalProvider } from "./types";

/**
 * An engine usable by both pipelines: `runSession` for v1, `getProvider` for the v2 dispatcher.
 */
export interface UnifiedEngine extends EngineAdapter {
  readonly engineType: EngineType;
  getProvider(context?: Partial<ProviderContext>): IPalProvider;
}

export interface EngineFactoryOptions {
  readonly spawner?: ISpawner;
  readonly cwd?: string;
  readonly model?: string;
}

interface AdapterSpawnOptions {
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeout?: number;
}

/**
 * Builds the adapter-level spawn function backed by an `ISpawner`.
 */
export function createAdapterSpawnFn(spawner: ISpawner): (argv: string[], options: AdapterSpawnOptions) => AdapterProcess {
  return (argv, options) =>
    toAdapterProcess(spawner.spawn(argv, { cwd: options.cwd, env: options.env, timeoutMs: options.timeout }));
}

/**
 * Resolves a CLI engine name or alias to its canonical type, failing closed with exit code 2.
 */
export function resolveEngineType(engine: string): EngineType {
  const parsed = EngineTypeSchema.safeParse(engine);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message);
    throw new ConfigValidationError(`Invalid engine: ${issues.join("; ")}`, issues);
  }
  return parsed.data;
}

class FactoryEngine implements UnifiedEngine {
  readonly engineType: EngineType;
  readonly readUsage?: (cwd: string) => Promise<UsageMeter[] | null>;
  private readonly inner: EngineAdapter;
  private readonly providerFactory: (context: ProviderContext) => IPalProvider;
  private readonly defaultContext: ProviderContext;

  constructor(
    engineType: EngineType,
    inner: EngineAdapter,
    providerFactory: (context: ProviderContext) => IPalProvider,
    defaultContext: ProviderContext,
  ) {
    this.engineType = engineType;
    this.inner = inner;
    this.providerFactory = providerFactory;
    this.defaultContext = defaultContext;
    const innerReadUsage = inner.readUsage?.bind(inner);
    if (innerReadUsage !== undefined) {
      this.readUsage = innerReadUsage;
    }
  }

  get name(): EngineType {
    return this.inner.name;
  }

  runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    return this.inner.runSession(options);
  }

  getDefaultModel(effort?: string): string {
    return this.inner.getDefaultModel(effort);
  }

  supportsPlanMeters(): boolean {
    return this.inner.supportsPlanMeters();
  }

  getProvider(context: Partial<ProviderContext> = {}): IPalProvider {
    return this.providerFactory({ ...this.defaultContext, ...context });
  }
}

export class EngineFactory {
  private readonly spawner: ISpawner;

  constructor(options: { spawner?: ISpawner } = {}) {
    this.spawner = options.spawner ?? getDefaultSpawner();
  }

  /**
   * Canonical engine names accepted by `create` (aliases such as `gemini`/`agy` resolve to `antigravity`).
   */
  static supportedEngines(): readonly EngineType[] {
    return ENGINE_CONSTANTS.SUPPORTED_ENGINES;
  }

  /**
   * Creates the IPalProvider for an engine, bound to a working directory and model.
   */
  createProvider(engine: string, context: Partial<ProviderContext> = {}): IPalProvider {
    const engineType = resolveEngineType(engine);
    const cwd = context.cwd ?? process.cwd();
    const spawnFn = createAdapterSpawnFn(this.spawner);
    switch (engineType) {
      case "claude":
        return createClaudeAdapter({ modelName: context.model });
      case "antigravity":
        return createGeminiAdapter({ modelName: context.model, cwd, spawnFn, executionMode: "cli" });
      case "opencode":
        return createOpenCodeAdapter({ modelName: context.model, cwd, spawnFn, executionMode: "cli" });
      case "jules":
        return new JulesAdapter({
          modelName: context.model,
          cwd,
          spawnFn,
          sleep: (ms) => this.spawner.sleep(ms),
        });
    }
  }

  /**
   * Creates a `UnifiedEngine` for an engine name or alias.
   */
  create(engine: string, options: EngineFactoryOptions = {}): UnifiedEngine {
    const engineType = resolveEngineType(engine);
    const spawner = options.spawner ?? this.spawner;
    const factory = spawner === this.spawner ? this : new EngineFactory({ spawner });
    const providerFactory = (context: ProviderContext): IPalProvider => factory.createProvider(engineType, context);
    const defaultContext: ProviderContext = { cwd: options.cwd ?? process.cwd(), model: options.model };
    return new FactoryEngine(engineType, this.createSessionAdapter(engineType, spawner, providerFactory), providerFactory, defaultContext);
  }

  private createSessionAdapter(
    engineType: EngineType,
    spawner: ISpawner,
    providerFactory: (context: ProviderContext) => IPalProvider,
  ): EngineAdapter {
    switch (engineType) {
      case "claude":
        return new ClaudeAdapter();
      case "opencode":
        return new OpenCodeAdapter({ spawner });
      case "antigravity":
        return new AntigravityAdapter({ spawner });
      case "jules":
        return new PalEngineBridge({
          engineType,
          defaultModel: ENGINE_CONSTANTS.DEFAULT_JULES_MODEL,
          createProvider: providerFactory,
        });
    }
  }
}

let defaultFactory: EngineFactory | undefined;

/**
 * Returns the process-wide factory bound to the default spawner.
 */
export function getDefaultEngineFactory(): EngineFactory {
  defaultFactory ??= new EngineFactory();
  return defaultFactory;
}
