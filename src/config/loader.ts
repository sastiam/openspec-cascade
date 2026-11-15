/**
 * Layered configuration loader for openspec-cascade.
 *
 * Resolves configuration synchronously in strict precedence order:
 *   overrides > CLI args > CASCADE_* env > .openspec-cascade.json > dynamic/repo defaults
 * and validates the final configuration fail-closed with Zod.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  isNuxtProject,
  normalizePlatformPath,
  resolvePackageCommands,
  tryDetectPackageManager,
} from "../../platform";
import {
  BUDGET_CONSTANTS,
  DIAGRAM_CONSTANTS,
  ENGINE_CONSTANTS,
  GIT_CONSTANTS,
  GUARDRAIL_CONSTANTS,
  RUNTIME_CONSTANTS,
  TIMEOUT_CONSTANTS,
  VERIFY_CONSTANTS,
} from "./constants";
import {
  type CascadeConfig,
  CascadeConfigSchema,
  type CascadeFileConfig,
  CascadeFileConfigSchema,
  ConfigValidationError,
  DEFAULT_GREPTILE_CONFIG,
  DEFAULT_SDD_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
  type EffortLevel,
  EffortLevelSchema,
  type EngineType,
  EngineTypeSchema,
  type ExecutionMode,
  ExecutionModeSchema,
  parseWithConfigError,
  strictBooleanSchema,
  strictFiniteNumberSchema,
} from "./schemas";

export const FULL_VERIFY: readonly string[] = [
  ...VERIFY_CONSTANTS.DEFAULT_VERIFY,
  VERIFY_CONSTANTS.TSC_SERVER,
  VERIFY_CONSTANTS.TSC_APP,
  "bun run build",
  "bun run test:e2e",
];

export const QA_VERIFY_COMMANDS: readonly string[] = VERIFY_CONSTANTS.QA_VERIFY_COMMANDS;

export interface ParsedCliOptions {
  repo?: string;
  changes?: string;
  "allow-dirty"?: boolean;
  "dry-run"?: boolean;
  "full-gate"?: boolean;
  engine?: string;
  "no-keep-alive"?: boolean;
  "keep-alive"?: boolean;
  model?: string;
  effort?: string;
  "log-dir"?: string;
  help?: boolean;
  "no-diagrams"?: boolean;
  diagrams?: boolean;
  "graphify-command"?: string;
  "archify-action"?: string;
  "archify-quality"?: string;
  "archify-bin"?: string;
  "no-rollback"?: boolean;
  rollback?: boolean;
  resilient?: boolean;
  "continue-on-failure"?: boolean;
  budget?: string;
  "max-budget"?: string;
  "total-budget"?: string;
  "usage-limit"?: string;
  "max-turns"?: string;
  "max-attempts"?: string;
  mode?: string;
  config?: string;
}

export interface LoadConfigOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  cwd?: string;
  overrides?: Partial<CascadeConfig>;
}

export interface LogDirInput {
  option?: string;
  env?: string;
  file?: string;
  repo: string;
  home: string;
  cwd: string;
}

const HELP_TEXT = `openspec-cascade: run OpenSpec changes in order, one agent session per task.

Usage:
  openspec-cascade --repo <path> --changes a,b,c [options]

Options:
  --repo <path>              Target repository (default: current directory; env CASCADE_REPO)
  --changes a,b,c            OpenSpec changes to run, in cascade order (env CASCADE_CHANGES)
  --engine <name>            claude (default), opencode, or antigravity (alias: agy)
  --model <name>             Model override for the selected engine
  --effort <level>           Reasoning effort override (default: ${ENGINE_CONSTANTS.DEFAULT_EFFORT})
  --mode <v1|v2>             Execution pipeline mode (default: ${RUNTIME_CONSTANTS.DEFAULT_MODE})
  --config <path>            Path to .openspec-cascade.json config file (env CASCADE_CONFIG)
  --budget <usd>             Max USD budget per session (alias: --max-budget; env CASCADE_MAX_BUDGET_USD)
  --total-budget <usd>       Max total USD budget across changes (env CASCADE_TOTAL_BUDGET_USD)
  --usage-limit <percent>    Plan usage limit percent 1-100 (env CASCADE_USAGE_LIMIT_PERCENT)
  --max-turns <count>        Max turns per agent session (env CASCADE_MAX_TURNS)
  --max-attempts <count>     Max retry attempts per task (env CASCADE_MAX_ATTEMPTS)
  --allow-dirty              Run on a dirty git working tree
  --dry-run                  Print the plan and usage meters; run nothing and write no logs
  --full-gate                Run the full verification suite on every committing task
  --no-keep-alive            Do not prevent the machine from sleeping while running
  --log-dir <path>           Directory for run logs (default: ~/.cache/openspec-cascade/logs/<repo name>)
  --no-diagrams              Disable automatic diagram synchronization
  --graphify-command <cmd>   Command that updates the Graphify knowledge graph
  --archify-action <action>  Archify action (default: ${DIAGRAM_CONSTANTS.ARCHIFY_ACTION})
  --archify-quality <name>   Archify quality profile (default: ${DIAGRAM_CONSTANTS.ARCHIFY_DEFAULT_QUALITY})
  --archify-bin <path>       Archify binary or command prefix
  --no-rollback              Keep the working tree as is when a task fails
  --resilient                Continue with the next task when a task fails (alias: --continue-on-failure)
  -h, --help                 Show this help and exit

Environment:
  CASCADE_MODEL              Same as --model
  CASCADE_EFFORT             Same as --effort
  CASCADE_LOG_DIR            Same as --log-dir (the flag takes precedence)
  CASCADE_CONFIG             Same as --config

Configuration file:
  Place .openspec-cascade.json in the target repo or cwd (precedence: CLI > env > file > defaults).

Examples:
  openspec-cascade --repo ~/work/my-app --changes add-auth,add-billing
  openspec-cascade --repo . --changes add-auth --engine opencode --dry-run
`;

/**
 * Returns the formatted CLI help text.
 */
export function formatHelp(): string {
  return HELP_TEXT;
}

/**
 * Resolves and validates the target execution engine name or alias.
 */
export function resolveEngine(engineArg: string | undefined): EngineType {
  if (engineArg === undefined) {
    return ENGINE_CONSTANTS.DEFAULT_ENGINE;
  }
  return parseWithConfigError(EngineTypeSchema, engineArg, "Invalid engine");
}

/**
 * Determines whether OS sleep prevention (keep-alive) is enabled from CLI boolean flags.
 */
export function isKeepAliveEnabled(options: { "no-keep-alive"?: boolean; "keep-alive"?: boolean }): boolean {
  if (options["no-keep-alive"]) return false;
  if (options["keep-alive"] === false) return false;
  return true;
}

/**
 * Resolves the log directory in precedence: `--log-dir` > `CASCADE_LOG_DIR` > file config > default home cache.
 */
export function resolveLogDir({ option, env, file, repo, home, cwd }: LogDirInput): string {
  const explicit = [option, env, file].find((value) => value !== undefined && value.trim() !== "");
  if (explicit !== undefined) return resolve(cwd, explicit.trim());
  return join(home, ...RUNTIME_CONSTANTS.DEFAULT_LOG_CACHE_SUBDIRS, basename(repo));
}

/**
 * Parses CLI arguments strictly, throwing ConfigValidationError on unknown flags or invalid syntax.
 */
export function parseCliArgs(argv: string[] = process.argv.slice(RUNTIME_CONSTANTS.ARGV_START_INDEX)): {
  options: ParsedCliOptions;
  positionals: string[];
} {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        repo: { type: "string" },
        changes: { type: "string" },
        "allow-dirty": { type: "boolean" },
        "dry-run": { type: "boolean" },
        "full-gate": { type: "boolean" },
        engine: { type: "string" },
        "no-keep-alive": { type: "boolean" },
        "keep-alive": { type: "boolean" },
        model: { type: "string" },
        effort: { type: "string" },
        "log-dir": { type: "string" },
        help: { type: "boolean", short: "h" },
        "no-diagrams": { type: "boolean" },
        diagrams: { type: "boolean" },
        "graphify-command": { type: "string" },
        "archify-action": { type: "string" },
        "archify-quality": { type: "string" },
        "archify-bin": { type: "string" },
        "no-rollback": { type: "boolean" },
        rollback: { type: "boolean" },
        resilient: { type: "boolean" },
        "continue-on-failure": { type: "boolean" },
        budget: { type: "string" },
        "max-budget": { type: "string" },
        "total-budget": { type: "string" },
        "usage-limit": { type: "string" },
        "max-turns": { type: "string" },
        "max-attempts": { type: "string" },
        mode: { type: "string" },
        config: { type: "string" },
      },
      strict: true,
      allowPositionals: true,
    });
    return { options: values as ParsedCliOptions, positionals };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigValidationError(`Invalid CLI arguments: ${message}`, [message]);
  }
}

function readCascadeJsonFile(filePath: string): CascadeFileConfig {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigValidationError(`Unable to read config file "${filePath}": ${message}`, [message]);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigValidationError(`Malformed JSON in config file "${filePath}": ${message}`, [message]);
  }

  return parseWithConfigError(CascadeFileConfigSchema, parsedJson, `Invalid configuration file "${filePath}"`);
}

function loadFileConfigLayer(
  explicitConfigPath: string | undefined,
  candidateRepo: string,
  cwd: string,
): CascadeFileConfig {
  if (explicitConfigPath !== undefined) {
    const trimmed = explicitConfigPath.trim();
    if (trimmed.length === 0) {
      throw new ConfigValidationError("Config file path must not be empty", ["config path is empty"]);
    }
    const resolvedPath = resolve(cwd, trimmed);
    if (!existsSync(resolvedPath)) {
      throw new ConfigValidationError(`Configuration file not found: ${resolvedPath}`, [
        `Configuration file not found: ${resolvedPath}`,
      ]);
    }
    return readCascadeJsonFile(resolvedPath);
  }

  const repoConfigPath = resolve(candidateRepo, RUNTIME_CONSTANTS.DEFAULT_CONFIG_FILENAME);
  if (existsSync(repoConfigPath)) {
    return readCascadeJsonFile(repoConfigPath);
  }

  const cwdConfigPath = resolve(cwd, RUNTIME_CONSTANTS.DEFAULT_CONFIG_FILENAME);
  if (cwdConfigPath !== repoConfigPath && existsSync(cwdConfigPath)) {
    return readCascadeJsonFile(cwdConfigPath);
  }

  return {};
}

function nonBlankEnv(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value;
}

function assertNonEmptyExplicitString(value: string | undefined, label: string): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new ConfigValidationError(`Invalid ${label}: ${label} must be a non-empty string`, [
      `${label}: ${label} must be a non-empty string`,
    ]);
  }
}

function parseStrictNumberOption(
  raw: unknown,
  fallback: number,
  options: { min?: number; minExclusive?: number; max?: number; int?: boolean; label: string },
): number {
  if (raw === undefined) {
    return fallback;
  }
  return parseWithConfigError(strictFiniteNumberSchema(options), raw, `Invalid ${options.label}`);
}

function parseStrictBooleanOption(raw: unknown, fallback: boolean, label: string): boolean {
  if (raw === undefined) {
    return fallback;
  }
  return parseWithConfigError(strictBooleanSchema(label), raw, `Invalid ${label}`);
}

function resolveDefaultVerifyCommands(repo: string): {
  defaultVerify: readonly string[];
  fullVerify: readonly string[];
} {
  const pm = tryDetectPackageManager(repo);
  if (pm === null) {
    return {
      defaultVerify: VERIFY_CONSTANTS.DEFAULT_VERIFY,
      fullVerify: FULL_VERIFY,
    };
  }
  const cmds = resolvePackageCommands(pm);
  const defaultVerify: readonly string[] = [cmds.test, cmds.lint];
  if (isNuxtProject(repo)) {
    return {
      defaultVerify,
      fullVerify: [
        ...defaultVerify,
        VERIFY_CONSTANTS.TSC_SERVER,
        VERIFY_CONSTANTS.TSC_APP,
        cmds.build,
        cmds.run("test:e2e"),
      ],
    };
  }
  return {
    defaultVerify,
    fullVerify: [cmds.typecheck, cmds.lint, cmds.test, cmds.build],
  };
}

function resolveChangesList(
  overrideChanges: string[] | undefined,
  cliChanges: string | undefined,
  envChanges: string | undefined,
  fileChanges: string[] | undefined,
): string[] {
  if (overrideChanges !== undefined) {
    return [...overrideChanges];
  }
  if (cliChanges !== undefined) {
    return cliChanges.split(",").map((c) => c.replace(/\s+/g, "")).filter(Boolean);
  }
  if (envChanges !== undefined) {
    return envChanges.split(",").map((c) => c.replace(/\s+/g, "")).filter(Boolean);
  }
  if (fileChanges !== undefined) {
    return [...fileChanges];
  }
  return [];
}

function resolveKeepAliveValue(
  overrideValue: boolean | undefined,
  cliOpts: ParsedCliOptions,
  envValue: string | undefined,
  fileValue: boolean | undefined,
): boolean {
  if (overrideValue !== undefined) {
    return overrideValue;
  }
  if (cliOpts["no-keep-alive"]) {
    return false;
  }
  if (cliOpts["keep-alive"] !== undefined) {
    return Boolean(cliOpts["keep-alive"]);
  }
  if (envValue !== undefined) {
    return parseStrictBooleanOption(envValue, true, "CASCADE_KEEP_ALIVE");
  }
  if (fileValue !== undefined) {
    return fileValue;
  }
  return true;
}

function resolveAutoDiagramsValue(
  overrideValue: boolean | undefined,
  cliOpts: ParsedCliOptions,
  envValue: string | undefined,
  fileValue: boolean | undefined,
): boolean {
  if (overrideValue !== undefined) {
    return overrideValue;
  }
  if (cliOpts["no-diagrams"]) {
    return false;
  }
  if (cliOpts.diagrams !== undefined) {
    return Boolean(cliOpts.diagrams);
  }
  if (envValue !== undefined) {
    return parseStrictBooleanOption(envValue, DIAGRAM_CONSTANTS.AUTO_DIAGRAMS_DEFAULT, "CASCADE_AUTO_DIAGRAMS");
  }
  if (fileValue !== undefined) {
    return fileValue;
  }
  return DIAGRAM_CONSTANTS.AUTO_DIAGRAMS_DEFAULT;
}

function resolveRollbackValue(
  overrideValue: boolean | undefined,
  cliOpts: ParsedCliOptions,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fileValue: boolean | undefined,
): boolean {
  if (overrideValue !== undefined) {
    return overrideValue;
  }
  if (cliOpts["no-rollback"]) {
    return false;
  }
  if (cliOpts.rollback !== undefined) {
    return Boolean(cliOpts.rollback);
  }
  if (env.CASCADE_ROLLBACK_ON_FAILURE !== undefined) {
    return parseStrictBooleanOption(
      env.CASCADE_ROLLBACK_ON_FAILURE,
      RUNTIME_CONSTANTS.ROLLBACK_ON_FAILURE,
      "CASCADE_ROLLBACK_ON_FAILURE",
    );
  }
  if (env.CASCADE_GIT_ROLLBACK !== undefined) {
    return parseStrictBooleanOption(
      env.CASCADE_GIT_ROLLBACK,
      RUNTIME_CONSTANTS.ROLLBACK_ON_FAILURE,
      "CASCADE_GIT_ROLLBACK",
    );
  }
  if (fileValue !== undefined) {
    return fileValue;
  }
  return RUNTIME_CONSTANTS.ROLLBACK_ON_FAILURE;
}

function resolveResilientValue(
  overrideValue: boolean | undefined,
  cliOpts: ParsedCliOptions,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fileValue: boolean | undefined,
): boolean {
  if (overrideValue !== undefined) {
    return overrideValue;
  }
  if (cliOpts.resilient || cliOpts["continue-on-failure"]) {
    return true;
  }
  if (env.CASCADE_RESILIENT !== undefined) {
    return parseStrictBooleanOption(env.CASCADE_RESILIENT, RUNTIME_CONSTANTS.RESILIENT_MODE, "CASCADE_RESILIENT");
  }
  if (env.CASCADE_CONTINUE_ON_FAILURE !== undefined) {
    return parseStrictBooleanOption(
      env.CASCADE_CONTINUE_ON_FAILURE,
      RUNTIME_CONSTANTS.RESILIENT_MODE,
      "CASCADE_CONTINUE_ON_FAILURE",
    );
  }
  if (fileValue !== undefined) {
    return fileValue;
  }
  return RUNTIME_CONSTANTS.RESILIENT_MODE;
}

function resolveOptionalEffort(raw: unknown): EffortLevel | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return parseWithConfigError(EffortLevelSchema, raw, "Invalid effort");
}

function resolveExecutionMode(raw: unknown): ExecutionMode {
  if (raw === undefined) {
    return RUNTIME_CONSTANTS.DEFAULT_MODE;
  }
  return parseWithConfigError(ExecutionModeSchema, raw, "Invalid mode");
}

function normalizeLoadOptions(
  optionsOrArgv?: LoadConfigOptions | string[],
  envArg?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): LoadConfigOptions {
  if (Array.isArray(optionsOrArgv)) {
    return { argv: optionsOrArgv, env: envArg };
  }
  return optionsOrArgv ?? {};
}

/**
 * Builds and validates the resolved CascadeConfig synchronously across all precedence layers.
 */
export function loadConfig(options?: LoadConfigOptions): CascadeConfig;
export function loadConfig(
  argv?: string[],
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): CascadeConfig;
export function loadConfig(
  optionsOrArgv?: LoadConfigOptions | string[],
  envArg?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): CascadeConfig {
  const options = normalizeLoadOptions(optionsOrArgv, envArg);
  const argv = options.argv ?? process.argv.slice(RUNTIME_CONSTANTS.ARGV_START_INDEX);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const overrides = options.overrides ?? {};

  const { options: cliOpts } = parseCliArgs(argv);

  const explicitRepo = overrides.repo ?? cliOpts.repo ?? env.CASCADE_REPO;
  assertNonEmptyExplicitString(explicitRepo, "repo");
  assertNonEmptyExplicitString(overrides.logDir ?? cliOpts["log-dir"], "logDir");

  const preliminaryRepo = normalizePlatformPath(explicitRepo ?? cwd);
  const explicitConfigPath = cliOpts.config ?? nonBlankEnv(env.CASCADE_CONFIG);
  const fileConfig = loadFileConfigLayer(explicitConfigPath, preliminaryRepo, cwd);

  const rawRepo = explicitRepo ?? fileConfig.repo ?? cwd;
  const repo = normalizePlatformPath(rawRepo);

  const changes = resolveChangesList(
    overrides.changes,
    cliOpts.changes,
    nonBlankEnv(env.CASCADE_CHANGES),
    fileConfig.changes,
  );

  const allowDirty =
    overrides.allowDirty ??
    (cliOpts["allow-dirty"]
      ? true
      : parseStrictBooleanOption(nonBlankEnv(env.CASCADE_ALLOW_DIRTY), fileConfig.allowDirty ?? false, "allowDirty"));

  const dryRun =
    overrides.dryRun ??
    (cliOpts["dry-run"]
      ? true
      : parseStrictBooleanOption(nonBlankEnv(env.CASCADE_DRY_RUN), fileConfig.dryRun ?? false, "dryRun"));

  const fullGate =
    overrides.fullGate ??
    (cliOpts["full-gate"]
      ? true
      : parseStrictBooleanOption(nonBlankEnv(env.CASCADE_FULL_GATE), fileConfig.fullGate ?? false, "fullGate"));

  const rawEngine = overrides.engine ?? cliOpts.engine ?? nonBlankEnv(env.CASCADE_ENGINE) ?? fileConfig.engine;
  const engine = resolveEngine(rawEngine);

  const keepAlive = resolveKeepAliveValue(
    overrides.keepAlive,
    cliOpts,
    nonBlankEnv(env.CASCADE_KEEP_ALIVE),
    fileConfig.keepAlive,
  );

  const model = overrides.model ?? cliOpts.model ?? nonBlankEnv(env.CASCADE_MODEL) ?? fileConfig.model ?? undefined;
  const rawEffort = overrides.effort ?? cliOpts.effort ?? nonBlankEnv(env.CASCADE_EFFORT) ?? fileConfig.effort;
  const effort = resolveOptionalEffort(rawEffort) ?? ENGINE_CONSTANTS.DEFAULT_EFFORT;

  const mode = resolveExecutionMode(overrides.mode ?? cliOpts.mode ?? nonBlankEnv(env.CASCADE_MODE) ?? fileConfig.mode);

  const logDir =
    overrides.logDir ??
    resolveLogDir({
      option: cliOpts["log-dir"],
      env: nonBlankEnv(env.CASCADE_LOG_DIR),
      file: fileConfig.logDir,
      repo,
      home: homedir(),
      cwd,
    });

  const usageLimitPercent = parseStrictNumberOption(
    overrides.usageLimitPercent ??
      cliOpts["usage-limit"] ??
      nonBlankEnv(env.CASCADE_USAGE_LIMIT_PERCENT) ??
      fileConfig.usageLimitPercent,
    BUDGET_CONSTANTS.USAGE_LIMIT_PERCENT,
    {
      int: true,
      min: BUDGET_CONSTANTS.MIN_USAGE_LIMIT_PERCENT,
      max: BUDGET_CONSTANTS.MAX_USAGE_LIMIT_PERCENT,
      label: "usageLimitPercent",
    },
  );

  const resetMarginMs = parseStrictNumberOption(
    overrides.resetMarginMs ?? nonBlankEnv(env.CASCADE_RESET_MARGIN_MS) ?? fileConfig.resetMarginMs,
    TIMEOUT_CONSTANTS.RESET_MARGIN_MS,
    { int: true, min: TIMEOUT_CONSTANTS.MIN_DURATION_MS, label: "resetMarginMs" },
  );

  const unknownResetSleepMs = parseStrictNumberOption(
    overrides.unknownResetSleepMs ??
      nonBlankEnv(env.CASCADE_UNKNOWN_RESET_SLEEP_MS) ??
      fileConfig.unknownResetSleepMs,
    TIMEOUT_CONSTANTS.UNKNOWN_RESET_SLEEP_MS,
    { int: true, minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS, label: "unknownResetSleepMs" },
  );

  const minPauseMs = parseStrictNumberOption(
    overrides.minPauseMs ?? nonBlankEnv(env.CASCADE_MIN_PAUSE_MS) ?? fileConfig.minPauseMs,
    TIMEOUT_CONSTANTS.MIN_PAUSE_MS,
    { int: true, min: TIMEOUT_CONSTANTS.MIN_DURATION_MS, label: "minPauseMs" },
  );

  const maxAttemptsPerTask = parseStrictNumberOption(
    overrides.maxAttemptsPerTask ??
      cliOpts["max-attempts"] ??
      nonBlankEnv(env.CASCADE_MAX_ATTEMPTS) ??
      fileConfig.maxAttemptsPerTask,
    ENGINE_CONSTANTS.MAX_ATTEMPTS_PER_TASK,
    { int: true, min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT, label: "maxAttemptsPerTask" },
  );

  const maxTurnsPerSession = parseStrictNumberOption(
    overrides.maxTurnsPerSession ??
      cliOpts["max-turns"] ??
      nonBlankEnv(env.CASCADE_MAX_TURNS) ??
      fileConfig.maxTurnsPerSession,
    BUDGET_CONSTANTS.MAX_TURNS_PER_SESSION,
    { int: true, min: GUARDRAIL_CONSTANTS.MIN_POSITIVE_INT, label: "maxTurnsPerSession" },
  );

  const cliSessionBudget = cliOpts.budget ?? cliOpts["max-budget"];
  const maxBudgetPerSessionUsd = parseStrictNumberOption(
    overrides.maxBudgetPerSessionUsd ??
      cliSessionBudget ??
      nonBlankEnv(env.CASCADE_MAX_BUDGET_USD) ??
      fileConfig.maxBudgetPerSessionUsd,
    BUDGET_CONSTANTS.MAX_BUDGET_PER_SESSION_USD,
    { minExclusive: BUDGET_CONSTANTS.MIN_BUDGET_USD, label: "maxBudgetPerSessionUsd" },
  );

  const maxTotalBudgetUsd = parseStrictNumberOption(
    overrides.maxTotalBudgetUsd ??
      cliOpts["total-budget"] ??
      nonBlankEnv(env.CASCADE_TOTAL_BUDGET_USD) ??
      fileConfig.maxTotalBudgetUsd,
    BUDGET_CONSTANTS.MAX_TOTAL_BUDGET_USD,
    { minExclusive: BUDGET_CONSTANTS.MIN_BUDGET_USD, label: "maxTotalBudgetUsd" },
  );

  const commandTimeoutMs = parseStrictNumberOption(
    overrides.commandTimeoutMs ?? nonBlankEnv(env.CASCADE_COMMAND_TIMEOUT_MS) ?? fileConfig.commandTimeoutMs,
    TIMEOUT_CONSTANTS.COMMAND_TIMEOUT_MS,
    { int: true, minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS, label: "commandTimeoutMs" },
  );

  const engineSessionTimeoutMs = parseStrictNumberOption(
    overrides.engineSessionTimeoutMs ??
      nonBlankEnv(env.CASCADE_ENGINE_TIMEOUT_MS) ??
      fileConfig.engineSessionTimeoutMs,
    TIMEOUT_CONSTANTS.ENGINE_SESSION_TIMEOUT_MS,
    { int: true, minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS, label: "engineSessionTimeoutMs" },
  );

  const rateLimitSleepMs = parseStrictNumberOption(
    overrides.rateLimitSleepMs ?? nonBlankEnv(env.CASCADE_RATE_LIMIT_SLEEP_MS) ?? fileConfig.rateLimitSleepMs,
    TIMEOUT_CONSTANTS.RATE_LIMIT_SLEEP_MS,
    { int: true, minExclusive: TIMEOUT_CONSTANTS.MIN_DURATION_MS, label: "rateLimitSleepMs" },
  );

  const autoDiagrams = resolveAutoDiagramsValue(
    overrides.autoDiagrams,
    cliOpts,
    nonBlankEnv(env.CASCADE_AUTO_DIAGRAMS),
    fileConfig.autoDiagrams,
  );

  const graphifyCommand =
    overrides.graphifyCommand ??
    cliOpts["graphify-command"] ??
    nonBlankEnv(env.CASCADE_GRAPHIFY_COMMAND) ??
    fileConfig.graphifyCommand ??
    DIAGRAM_CONSTANTS.GRAPHIFY_COMMAND;

  const archifyAction =
    overrides.archifyAction ??
    cliOpts["archify-action"] ??
    nonBlankEnv(env.CASCADE_ARCHIFY_ACTION) ??
    fileConfig.archifyAction ??
    DIAGRAM_CONSTANTS.ARCHIFY_ACTION;

  const archifyQuality =
    overrides.archifyQuality ??
    cliOpts["archify-quality"] ??
    nonBlankEnv(env.CASCADE_ARCHIFY_QUALITY) ??
    fileConfig.archifyQuality ??
    DIAGRAM_CONSTANTS.ARCHIFY_DEFAULT_QUALITY;

  const archifyBin =
    overrides.archifyBin ??
    cliOpts["archify-bin"] ??
    nonBlankEnv(env.ARCHIFY_BIN) ??
    nonBlankEnv(env.CASCADE_ARCHIFY_BIN) ??
    fileConfig.archifyBin ??
    undefined;

  const rollbackOnFailure = resolveRollbackValue(
    overrides.rollbackOnFailure,
    cliOpts,
    {
      CASCADE_ROLLBACK_ON_FAILURE: nonBlankEnv(env.CASCADE_ROLLBACK_ON_FAILURE),
      CASCADE_GIT_ROLLBACK: nonBlankEnv(env.CASCADE_GIT_ROLLBACK),
    },
    fileConfig.rollbackOnFailure,
  );

  const resilient = resolveResilientValue(
    overrides.resilient,
    cliOpts,
    {
      CASCADE_RESILIENT: nonBlankEnv(env.CASCADE_RESILIENT),
      CASCADE_CONTINUE_ON_FAILURE: nonBlankEnv(env.CASCADE_CONTINUE_ON_FAILURE),
    },
    fileConfig.resilient,
  );

  const stackVerify = resolveDefaultVerifyCommands(repo);

  const candidateConfig: CascadeConfig = {
    repo,
    changes,
    allowDirty,
    dryRun,
    fullGate,
    engine,
    keepAlive,
    model,
    effort,
    logDir,
    mode,
    usageLimitPercent,
    resetMarginMs,
    unknownResetSleepMs,
    minPauseMs,
    maxAttemptsPerTask,
    maxTurnsPerSession,
    maxBudgetPerSessionUsd,
    maxTotalBudgetUsd,
    commandTimeoutMs,
    engineSessionTimeoutMs,
    rateLimitSleepMs,
    graphifyCommand,
    archifyAction,
    archifyQuality,
    archifyBin,
    autoDiagrams,
    rollbackOnFailure,
    resilient,
    protectedBranches: overrides.protectedBranches ?? fileConfig.protectedBranches ?? GIT_CONSTANTS.PROTECTED_BRANCHES,
    neverCommit: overrides.neverCommit ?? fileConfig.neverCommit ?? GIT_CONSTANTS.NEVER_COMMIT,
    deniedBash: overrides.deniedBash ?? fileConfig.deniedBash ?? ENGINE_CONSTANTS.DENIED_BASH,
    allowedTools: overrides.allowedTools ?? fileConfig.allowedTools ?? ENGINE_CONSTANTS.ALLOWED_TOOLS,
    settingSources: overrides.settingSources ?? fileConfig.settingSources ?? ENGINE_CONSTANTS.SETTING_SOURCES,
    defaultVerify: overrides.defaultVerify ?? fileConfig.defaultVerify ?? stackVerify.defaultVerify,
    tscServer: overrides.tscServer ?? fileConfig.tscServer ?? VERIFY_CONSTANTS.TSC_SERVER,
    tscApp: overrides.tscApp ?? fileConfig.tscApp ?? VERIFY_CONSTANTS.TSC_APP,
    fullVerify: overrides.fullVerify ?? fileConfig.fullVerify ?? stackVerify.fullVerify,
    noNewMigration: overrides.noNewMigration ?? fileConfig.noNewMigration ?? VERIFY_CONSTANTS.NO_NEW_MIGRATION,
    defaultAntigravityModel:
      overrides.defaultAntigravityModel ?? fileConfig.defaultAntigravityModel ?? ENGINE_CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL,
    defaultOpenCodeModel:
      overrides.defaultOpenCodeModel ?? fileConfig.defaultOpenCodeModel ?? ENGINE_CONSTANTS.DEFAULT_OPENCODE_MODEL,
    sdd: { ...DEFAULT_SDD_CONFIG, ...fileConfig.sdd, ...overrides.sdd },
    greptile: { ...DEFAULT_GREPTILE_CONFIG, ...fileConfig.greptile, ...overrides.greptile },
    telemetry: { ...DEFAULT_TELEMETRY_CONFIG, ...fileConfig.telemetry, ...overrides.telemetry },
  };

  return parseWithConfigError(CascadeConfigSchema, candidateConfig, "Configuration validation failed");
}

/**
 * Alias for loadConfig supporting explicit option-based construction.
 */
export function buildConfig(options: LoadConfigOptions = {}): CascadeConfig {
  return loadConfig(options);
}

/**
 * Returns default configuration anchored to the provided working directory.
 */
export function getDefaultConfig(cwd: string = process.cwd()): CascadeConfig {
  return loadConfig({ argv: [], env: {}, cwd });
}
