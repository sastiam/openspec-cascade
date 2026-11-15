/**
 * Strict Zod validation schemas and boundary error types for openspec-cascade configuration.
 *
 * Rejects NaN, Infinity, empty strings, out-of-bounds numbers, and unknown CLI or
 * file configuration keys fail-closed with ConfigValidationError (exit code 2).
 */

import { z } from "zod";
import {
  BUDGET_CONSTANTS,
  DIAGRAM_CONSTANTS,
  ENGINE_CONSTANTS,
  EXIT_CODE_CONSTANTS,
  GIT_CONSTANTS,
  GREPTILE_CONSTANTS,
  GUARDRAIL_CONSTANTS,
  RUNTIME_CONSTANTS,
  SDD_CONSTANTS,
  TELEMETRY_CONSTANTS,
  TIMEOUT_CONSTANTS,
  VERIFY_CONSTANTS,
} from "./constants";

export type EngineType = (typeof ENGINE_CONSTANTS.SUPPORTED_ENGINES)[number];
export type EffortLevel = (typeof ENGINE_CONSTANTS.SUPPORTED_EFFORTS)[number];
export type ExecutionMode = (typeof RUNTIME_CONSTANTS.SUPPORTED_MODES)[number];

const STRICT_NUMBER_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLEAN_TRUE_VALUES = new Set(["true", "1", "yes"]);
const BOOLEAN_FALSE_VALUES = new Set(["false", "0", "no"]);

/**
 * Fatal configuration validation error mapped to CLI exit code 2.
 */
export class ConfigValidationError extends Error {
  readonly issues: readonly string[];
  readonly exitCode: number = EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "ConfigValidationError";
    this.issues = issues.length > 0 ? [...issues] : [message];
  }
}

export interface NumericSchemaOptions {
  min?: number;
  minExclusive?: number;
  max?: number;
  int?: boolean;
  label?: string;
}

function preprocessStrictNumberInput(value: unknown): unknown {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || !STRICT_NUMBER_REGEX.test(trimmed)) {
      return value;
    }
    return Number(trimmed);
  }
  return value;
}

function preprocessStrictBooleanInput(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.has(lower)) {
      return true;
    }
    if (BOOLEAN_FALSE_VALUES.has(lower)) {
      return false;
    }
  }
  return value;
}

function preprocessEngineInput(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "agy" ? "antigravity" : normalized;
}

function preprocessEffortInput(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().toLowerCase();
}

function preprocessModeInput(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().toLowerCase();
}

/**
 * Builds a strict finite-number Zod schema avoiding raw z.coerce.number() pitfalls.
 */
export function strictFiniteNumberSchema(options: NumericSchemaOptions = {}): z.ZodType<number> {
  const label = options.label ?? "value";
  let schema = z
    .number({
      error: () => `${label} must be a finite number`,
    })
    .finite({ message: `${label} must be finite (NaN and Infinity are disallowed)` });

  if (options.int) {
    schema = schema.int({ message: `${label} must be an integer` });
  }
  if (options.min !== undefined) {
    schema = schema.min(options.min, { message: `${label} must be >= ${options.min}` });
  }
  if (options.minExclusive !== undefined) {
    schema = schema.gt(options.minExclusive, { message: `${label} must be > ${options.minExclusive}` });
  }
  if (options.max !== undefined) {
    schema = schema.max(options.max, { message: `${label} must be <= ${options.max}` });
  }

  return z.preprocess(preprocessStrictNumberInput, schema);
}

/**
 * Strict boolean schema accepting booleans or canonical string flags ("true", "false", "1", "0", "yes", "no").
 */
export function strictBooleanSchema(label = "boolean"): z.ZodType<boolean> {
  return z.preprocess(
    preprocessStrictBooleanInput,
    z.boolean({ error: () => `${label} must be a boolean` }),
  );
}

export const EngineTypeSchema: z.ZodType<EngineType> = z.preprocess(
  preprocessEngineInput,
  z.enum(ENGINE_CONSTANTS.SUPPORTED_ENGINES, {
    error: () => `--engine must be "claude", "opencode", or "antigravity" (or "agy")`,
  }),
);

export const EffortLevelSchema: z.ZodType<EffortLevel> = z.preprocess(
  preprocessEffortInput,
  z.enum(ENGINE_CONSTANTS.SUPPORTED_EFFORTS, {
    error: () => `effort must be one of: ${ENGINE_CONSTANTS.SUPPORTED_EFFORTS.join(", ")}`,
  }),
);

export const ExecutionModeSchema: z.ZodType<ExecutionMode> = z.preprocess(
  preprocessModeInput,
  z.enum(RUNTIME_CONSTANTS.SUPPORTED_MODES, {
    error: () => `mode must be one of: ${RUNTIME_CONSTANTS.SUPPORTED_MODES.join(", ")}`,
  }),
);

const nonEmptyStringSchema = (label: string): z.ZodString =>
  z.string().trim().min(GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT, {
    message: `${label} must be a non-empty string`,
  });

const stringListSchema = z.array(z.string());

export const RuntimeConfigSchema = z.object({
  repo: nonEmptyStringSchema("repo"),
  changes: stringListSchema,
  logDir: nonEmptyStringSchema("logDir"),
  allowDirty: strictBooleanSchema("allowDirty"),
  dryRun: strictBooleanSchema("dryRun"),
  fullGate: strictBooleanSchema("fullGate"),
  keepAlive: strictBooleanSchema("keepAlive"),
  rollbackOnFailure: strictBooleanSchema("rollbackOnFailure"),
  resilient: strictBooleanSchema("resilient"),
  mode: ExecutionModeSchema,
  protectedBranches: stringListSchema.readonly(),
  neverCommit: stringListSchema.readonly(),
  commandTimeoutMs: strictFiniteNumberSchema({
    int: true,
    minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "commandTimeoutMs",
  }),
});

export const EngineConfigSchema = z.object({
  engine: EngineTypeSchema,
  model: nonEmptyStringSchema("model").optional(),
  effort: EffortLevelSchema.optional(),
  maxTurnsPerSession: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "maxTurnsPerSession",
  }),
  engineSessionTimeoutMs: strictFiniteNumberSchema({
    int: true,
    minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "engineSessionTimeoutMs",
  }),
  rateLimitSleepMs: strictFiniteNumberSchema({
    int: true,
    minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "rateLimitSleepMs",
  }),
  usageLimitPercent: strictFiniteNumberSchema({
    int: true,
    min: BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT,
    max: BUDGET_CONSTANTS.MAX_USAGE_LIMIT_PERCENT,
    label: "usageLimitPercent",
  }),
  resetMarginMs: strictFiniteNumberSchema({
    int: true,
    min: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "resetMarginMs",
  }),
  unknownResetSleepMs: strictFiniteNumberSchema({
    int: true,
    minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "unknownResetSleepMs",
  }),
  minPauseMs: strictFiniteNumberSchema({
    int: true,
    min: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "minPauseMs",
  }),
  allowedTools: stringListSchema.readonly(),
  deniedBash: stringListSchema.readonly(),
  settingSources: stringListSchema.readonly(),
  defaultAntigravityModel: nonEmptyStringSchema("defaultAntigravityModel"),
  defaultOpenCodeModel: nonEmptyStringSchema("defaultOpenCodeModel"),
});

export const GateBudgetsSchema = z.object({
  maxAttemptsPerTask: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "maxAttemptsPerTask",
  }),
  maxBudgetPerSessionUsd: strictFiniteNumberSchema({
    minExclusive: BUDGET_CONSTANTS.MIN_BUDGET_USD,
    label: "maxBudgetPerSessionUsd",
  }),
  maxTotalBudgetUsd: strictFiniteNumberSchema({
    minExclusive: BUDGET_CONSTANTS.MIN_BUDGET_USD,
    label: "maxTotalBudgetUsd",
  }),
  maxChallengeAttempts: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "maxChallengeAttempts",
  }),
  maxVictoryFailures: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "maxVictoryFailures",
  }),
  spawnLimit: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "spawnLimit",
  }),
  tokenWatermarkPercent: strictFiniteNumberSchema({
    int: true,
    min: BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT,
    max: BUDGET_CONSTANTS.MAX_USAGE_LIMIT_PERCENT,
    label: "tokenWatermarkPercent",
  }),
});

export const SddConfigSchema = z.object({
  enabled: strictBooleanSchema("sdd.enabled"),
  constitutionPath: nonEmptyStringSchema("sdd.constitutionPath"),
  minKeywordLength: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "sdd.minKeywordLength",
  }),
  minReviewDurationSeconds: strictFiniteNumberSchema({
    int: true,
    min: SDD_CONSTANTS.MIN_REVIEW_DURATION_SECONDS,
    label: "sdd.minReviewDurationSeconds",
  }),
  productionExtensions: stringListSchema.readonly(),
  exemptPathSegments: stringListSchema.readonly(),
  gatedTools: stringListSchema.readonly(),
});

export const GreptileConfigSchema = z.object({
  enabled: strictBooleanSchema("greptile.enabled"),
  timeoutMs: strictFiniteNumberSchema({
    int: true,
    minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "greptile.timeoutMs",
  }),
  cacheTtlMs: strictFiniteNumberSchema({
    int: true,
    min: TIMEOUT_CONSTANTS.MIN_DURATION_MS,
    label: "greptile.cacheTtlMs",
  }),
  cacheDir: nonEmptyStringSchema("greptile.cacheDir"),
  tokenBudget: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "greptile.tokenBudget",
  }),
});

export const TelemetryConfigSchema = z.object({
  enabled: strictBooleanSchema("telemetry.enabled"),
  telemetryDir: nonEmptyStringSchema("telemetry.telemetryDir"),
  redactSecrets: strictBooleanSchema("telemetry.redactSecrets"),
  maxRedactionDepth: strictFiniteNumberSchema({
    int: true,
    min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT,
    label: "telemetry.maxRedactionDepth",
  }),
});

export const DiagramsConfigSchema = z.object({
  autoDiagrams: strictBooleanSchema("autoDiagrams"),
  graphifyCommand: nonEmptyStringSchema("graphifyCommand"),
  archifyAction: nonEmptyStringSchema("archifyAction"),
  archifyQuality: nonEmptyStringSchema("archifyQuality"),
  archifyBin: nonEmptyStringSchema("archifyBin").optional(),
});

export type SddConfig = z.output<typeof SddConfigSchema>;
export type GreptileConfig = z.output<typeof GreptileConfigSchema>;
export type TelemetryConfig = z.output<typeof TelemetryConfigSchema>;

export interface CascadeConfig {
  repo: string;
  changes: string[];
  allowDirty: boolean;
  dryRun: boolean;
  fullGate: boolean;
  engine: EngineType;
  keepAlive: boolean;
  model?: string;
  effort?: EffortLevel;
  logDir: string;
  mode: ExecutionMode;

  usageLimitPercent: number;
  resetMarginMs: number;
  unknownResetSleepMs: number;
  minPauseMs: number;
  maxAttemptsPerTask: number;
  maxTurnsPerSession: number;
  maxBudgetPerSessionUsd: number;
  maxTotalBudgetUsd: number;
  commandTimeoutMs: number;
  engineSessionTimeoutMs: number;
  rateLimitSleepMs: number;

  protectedBranches: readonly string[];
  neverCommit: readonly string[];
  deniedBash: readonly string[];
  allowedTools: readonly string[];
  settingSources: readonly string[];

  defaultVerify: readonly string[];
  tscServer: string;
  tscApp: string;
  fullVerify: readonly string[];
  noNewMigration: string;

  defaultAntigravityModel: string;
  defaultOpenCodeModel: string;

  graphifyCommand: string;
  archifyAction: string;
  archifyQuality: string;
  archifyBin?: string;
  autoDiagrams: boolean;

  rollbackOnFailure: boolean;
  resilient: boolean;

  sdd: SddConfig;
  greptile: GreptileConfig;
  telemetry: TelemetryConfig;
}

export const DEFAULT_SDD_CONFIG: SddConfig = {
  enabled: SDD_CONSTANTS.SDD_ENABLED_DEFAULT,
  constitutionPath: SDD_CONSTANTS.SDD_CONSTITUTION_PATH,
  minKeywordLength: SDD_CONSTANTS.SDD_MIN_KEYWORD_LENGTH,
  minReviewDurationSeconds: SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS,
  productionExtensions: SDD_CONSTANTS.SDD_PRODUCTION_EXTENSIONS,
  exemptPathSegments: SDD_CONSTANTS.SDD_EXEMPT_PATH_SEGMENTS,
  gatedTools: SDD_CONSTANTS.SDD_GATED_TOOLS,
};

export const DEFAULT_GREPTILE_CONFIG: GreptileConfig = {
  enabled: GREPTILE_CONSTANTS.DEFAULT_ENABLED,
  timeoutMs: GREPTILE_CONSTANTS.DEFAULT_TIMEOUT_MS,
  cacheTtlMs: GREPTILE_CONSTANTS.DEFAULT_CACHE_TTL_MS,
  cacheDir: GREPTILE_CONSTANTS.DEFAULT_CACHE_DIR,
  tokenBudget: GREPTILE_CONSTANTS.DEFAULT_TOKEN_BUDGET,
};

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: TELEMETRY_CONSTANTS.DEFAULT_ENABLED,
  telemetryDir: TELEMETRY_CONSTANTS.DEFAULT_TELEMETRY_DIR,
  redactSecrets: TELEMETRY_CONSTANTS.DEFAULT_REDACT_SECRETS,
  maxRedactionDepth: TELEMETRY_CONSTANTS.DEFAULT_MAX_REDACTION_DEPTH,
};

export const CascadeConfigSchema: z.ZodType<CascadeConfig> = z.object({
  repo: RuntimeConfigSchema.shape.repo,
  changes: RuntimeConfigSchema.shape.changes,
  allowDirty: RuntimeConfigSchema.shape.allowDirty,
  dryRun: RuntimeConfigSchema.shape.dryRun,
  fullGate: RuntimeConfigSchema.shape.fullGate,
  engine: EngineConfigSchema.shape.engine,
  keepAlive: RuntimeConfigSchema.shape.keepAlive,
  model: EngineConfigSchema.shape.model,
  effort: EngineConfigSchema.shape.effort,
  logDir: RuntimeConfigSchema.shape.logDir,
  mode: RuntimeConfigSchema.shape.mode.default(RUNTIME_CONSTANTS.DEFAULT_MODE),

  usageLimitPercent: EngineConfigSchema.shape.usageLimitPercent,
  resetMarginMs: EngineConfigSchema.shape.resetMarginMs,
  unknownResetSleepMs: EngineConfigSchema.shape.unknownResetSleepMs,
  minPauseMs: EngineConfigSchema.shape.minPauseMs,
  maxAttemptsPerTask: GateBudgetsSchema.shape.maxAttemptsPerTask,
  maxTurnsPerSession: EngineConfigSchema.shape.maxTurnsPerSession,
  maxBudgetPerSessionUsd: GateBudgetsSchema.shape.maxBudgetPerSessionUsd,
  maxTotalBudgetUsd: GateBudgetsSchema.shape.maxTotalBudgetUsd,
  commandTimeoutMs: RuntimeConfigSchema.shape.commandTimeoutMs,
  engineSessionTimeoutMs: EngineConfigSchema.shape.engineSessionTimeoutMs,
  rateLimitSleepMs: EngineConfigSchema.shape.rateLimitSleepMs,

  protectedBranches: RuntimeConfigSchema.shape.protectedBranches,
  neverCommit: RuntimeConfigSchema.shape.neverCommit,
  deniedBash: EngineConfigSchema.shape.deniedBash,
  allowedTools: EngineConfigSchema.shape.allowedTools,
  settingSources: EngineConfigSchema.shape.settingSources,

  defaultVerify: stringListSchema.readonly(),
  tscServer: z.string(),
  tscApp: z.string(),
  fullVerify: stringListSchema.readonly(),
  noNewMigration: z.string(),

  defaultAntigravityModel: EngineConfigSchema.shape.defaultAntigravityModel,
  defaultOpenCodeModel: EngineConfigSchema.shape.defaultOpenCodeModel,

  graphifyCommand: DiagramsConfigSchema.shape.graphifyCommand,
  archifyAction: DiagramsConfigSchema.shape.archifyAction,
  archifyQuality: DiagramsConfigSchema.shape.archifyQuality,
  archifyBin: DiagramsConfigSchema.shape.archifyBin,
  autoDiagrams: DiagramsConfigSchema.shape.autoDiagrams,

  rollbackOnFailure: RuntimeConfigSchema.shape.rollbackOnFailure,
  resilient: RuntimeConfigSchema.shape.resilient,

  sdd: SddConfigSchema.default(DEFAULT_SDD_CONFIG),
  greptile: GreptileConfigSchema.default(DEFAULT_GREPTILE_CONFIG),
  telemetry: TelemetryConfigSchema.default(DEFAULT_TELEMETRY_CONFIG),
});

export const CascadeFileConfigSchema = z.strictObject({
  repo: RuntimeConfigSchema.shape.repo.optional(),
  changes: RuntimeConfigSchema.shape.changes.optional(),
  allowDirty: RuntimeConfigSchema.shape.allowDirty.optional(),
  dryRun: RuntimeConfigSchema.shape.dryRun.optional(),
  fullGate: RuntimeConfigSchema.shape.fullGate.optional(),
  engine: EngineConfigSchema.shape.engine.optional(),
  keepAlive: RuntimeConfigSchema.shape.keepAlive.optional(),
  model: EngineConfigSchema.shape.model.optional(),
  effort: EngineConfigSchema.shape.effort.optional(),
  logDir: RuntimeConfigSchema.shape.logDir.optional(),
  mode: RuntimeConfigSchema.shape.mode.optional(),

  usageLimitPercent: EngineConfigSchema.shape.usageLimitPercent.optional(),
  resetMarginMs: EngineConfigSchema.shape.resetMarginMs.optional(),
  unknownResetSleepMs: EngineConfigSchema.shape.unknownResetSleepMs.optional(),
  minPauseMs: EngineConfigSchema.shape.minPauseMs.optional(),
  maxAttemptsPerTask: GateBudgetsSchema.shape.maxAttemptsPerTask.optional(),
  maxTurnsPerSession: EngineConfigSchema.shape.maxTurnsPerSession.optional(),
  maxBudgetPerSessionUsd: GateBudgetsSchema.shape.maxBudgetPerSessionUsd.optional(),
  maxTotalBudgetUsd: GateBudgetsSchema.shape.maxTotalBudgetUsd.optional(),
  commandTimeoutMs: RuntimeConfigSchema.shape.commandTimeoutMs.optional(),
  engineSessionTimeoutMs: EngineConfigSchema.shape.engineSessionTimeoutMs.optional(),
  rateLimitSleepMs: EngineConfigSchema.shape.rateLimitSleepMs.optional(),

  protectedBranches: RuntimeConfigSchema.shape.protectedBranches.optional(),
  neverCommit: RuntimeConfigSchema.shape.neverCommit.optional(),
  deniedBash: EngineConfigSchema.shape.deniedBash.optional(),
  allowedTools: EngineConfigSchema.shape.allowedTools.optional(),
  settingSources: EngineConfigSchema.shape.settingSources.optional(),

  defaultVerify: stringListSchema.readonly().optional(),
  tscServer: nonEmptyStringSchema("tscServer").optional(),
  tscApp: nonEmptyStringSchema("tscApp").optional(),
  fullVerify: stringListSchema.readonly().optional(),
  noNewMigration: nonEmptyStringSchema("noNewMigration").optional(),

  defaultAntigravityModel: EngineConfigSchema.shape.defaultAntigravityModel.optional(),
  defaultOpenCodeModel: EngineConfigSchema.shape.defaultOpenCodeModel.optional(),

  graphifyCommand: DiagramsConfigSchema.shape.graphifyCommand.optional(),
  archifyAction: DiagramsConfigSchema.shape.archifyAction.optional(),
  archifyQuality: DiagramsConfigSchema.shape.archifyQuality.optional(),
  archifyBin: DiagramsConfigSchema.shape.archifyBin.optional(),
  autoDiagrams: DiagramsConfigSchema.shape.autoDiagrams.optional(),

  rollbackOnFailure: RuntimeConfigSchema.shape.rollbackOnFailure.optional(),
  resilient: RuntimeConfigSchema.shape.resilient.optional(),

  sdd: SddConfigSchema.partial().strict().optional(),
  greptile: GreptileConfigSchema.partial().strict().optional(),
  telemetry: TelemetryConfigSchema.partial().strict().optional(),
});

export type CascadeFileConfig = z.output<typeof CascadeFileConfigSchema>;

/**
 * Formats Zod issues into readable paths and throws ConfigValidationError on failure.
 */
export function parseWithConfigError<T>(schema: z.ZodType<T>, input: unknown, context: string): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
  throw new ConfigValidationError(`${context}: ${issues.join("; ")}`, issues);
}

export const DEFAULT_RUNTIME_VALUES = {
  protectedBranches: GIT_CONSTANTS.PROTECTED_BRANCHES,
  neverCommit: GIT_CONSTANTS.NEVER_COMMIT,
  deniedBash: ENGINE_CONSTANTS.DENIED_BASH,
  allowedTools: ENGINE_CONSTANTS.ALLOWED_TOOLS,
  settingSources: ENGINE_CONSTANTS.SETTING_SOURCES,
  defaultVerify: VERIFY_CONSTANTS.DEFAULT_VERIFY,
  tscServer: VERIFY_CONSTANTS.TSC_SERVER,
  tscApp: VERIFY_CONSTANTS.TSC_APP,
  noNewMigration: VERIFY_CONSTANTS.NO_NEW_MIGRATION,
  defaultAntigravityModel: ENGINE_CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL,
  defaultOpenCodeModel: ENGINE_CONSTANTS.DEFAULT_OPENCODE_MODEL,
  graphifyCommand: DIAGRAM_CONSTANTS.GRAPHIFY_COMMAND,
  archifyAction: DIAGRAM_CONSTANTS.ARCHIFY_ACTION,
  archifyQuality: DIAGRAM_CONSTANTS.ARCHIFY_DEFAULT_QUALITY,
} as const;
