/**
 * Backward-compatible centralized configuration facade for openspec-cascade.
 *
 * Re-exports typed constant namespaces, strict Zod boundary schemas, security
 * guardrails, and layered stack-aware config loading from src/config/.
 */

export {
  BUDGET_CONSTANTS,
  CONSTANTS,
  DIAGRAM_CONSTANTS,
  ENGINE_CONSTANTS,
  EXIT_CODE_CONSTANTS,
  FORMAT_CONSTANTS,
  GIT_CONSTANTS,
  GREPTILE_CONSTANTS,
  GUARDRAIL_CONSTANTS,
  RUNTIME_CONSTANTS,
  SDD_CONSTANTS,
  TELEMETRY_CONSTANTS,
  TIMEOUT_CONSTANTS,
  VERIFY_CONSTANTS,
} from "./src/config/constants";

export {
  CascadeConfigSchema,
  CascadeFileConfigSchema,
  ConfigValidationError,
  DEFAULT_GREPTILE_CONFIG,
  DEFAULT_RUNTIME_VALUES,
  DEFAULT_SDD_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
  DiagramsConfigSchema,
  EffortLevelSchema,
  EngineConfigSchema,
  EngineTypeSchema,
  ExecutionModeSchema,
  GateBudgetsSchema,
  GreptileConfigSchema,
  parseWithConfigError,
  RuntimeConfigSchema,
  SddConfigSchema,
  strictBooleanSchema,
  strictFiniteNumberSchema,
  TelemetryConfigSchema,
  type CascadeConfig,
  type CascadeFileConfig,
  type EffortLevel,
  type EngineType,
  type ExecutionMode,
  type GreptileConfig,
  type NumericSchemaOptions,
  type SddConfig,
  type TelemetryConfig,
} from "./src/config/schemas";

export {
  assertBranchSafety,
  BudgetExceededError,
  enforceSessionBudget,
  evaluateProtectedBranchGuard,
  ProtectedBranchError,
  redactSensitiveData,
  type BudgetScope,
  type ProtectedBranchGuardInput,
  type ProtectedBranchGuardResult,
} from "./src/config/guardrails";

export {
  buildConfig,
  formatHelp,
  FULL_VERIFY,
  getDefaultConfig,
  isKeepAliveEnabled,
  loadConfig,
  parseCliArgs,
  QA_VERIFY_COMMANDS,
  resolveEngine,
  resolveLogDir,
  type LoadConfigOptions,
  type LogDirInput,
  type ParsedCliOptions,
} from "./src/config/loader";
