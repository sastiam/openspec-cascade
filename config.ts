/**
 * Centralized configuration module for openspec-cascade.
 *
 * Provides typed configuration loading with CLI arguments, environment variable
 * overrides, and strict constants to ensure zero magic numbers across the codebase.
 */

import { parseArgs } from "node:util";
import { normalizePlatformPath } from "./platform";

export type EngineType = "claude" | "opencode" | "antigravity";

/** Central application constants. */
export const CONSTANTS = {
  // Usage limits and sleep margins
  USAGE_LIMIT_PERCENT: 95,
  RESET_MARGIN_MS: 120_000,
  UNKNOWN_RESET_SLEEP_MS: 1_800_000,
  MIN_PAUSE_MS: 60_000,

  // Session and task limits
  MAX_ATTEMPTS_PER_TASK: 3,
  MAX_TURNS_PER_SESSION: 60,
  MAX_BUDGET_PER_SESSION_USD: 10,
  MAX_TOTAL_BUDGET_USD: 150,
  COMMAND_TIMEOUT_MS: 1_800_000,

  // Engine timeouts
  ANTIGRAVITY_SESSION_TIMEOUT_MS: 2_700_000,
  OPENCODE_SESSION_TIMEOUT_MS: 2_700_000,
  ENGINE_SESSION_TIMEOUT_MS: 2_700_000,
  RATE_LIMIT_SLEEP_MS: 1_800_000,

  // Defaults
  DEFAULT_ENGINE: "claude" as const,
  DEFAULT_EFFORT: "high" as const,
  DEFAULT_ANTIGRAVITY_MODEL: "gemini-3.8-flash-high",
  DEFAULT_OPENCODE_MODEL: "opencode/deepseek-v4.1-flash",
  DEFAULT_CLAUDE_MODEL: "claude-3-7-sonnet-20250219",

  // Branches and ignored files
  PROTECTED_BRANCHES: ["stable", "main", "master"] as const,
  NEVER_COMMIT: [".atl", ".claude/settings.local.json"] as const,

  // Tools and permissions
  ALLOWED_TOOLS: [
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "Bash",
    "WebFetch",
    "WebSearch",
    "TaskCreate",
    "TaskUpdate",
  ] as const,
  SETTING_SOURCES: ["project"] as const,
  DENIED_BASH: [
    "Bash(git commit)",
    "Bash(git commit *)",
    "Bash(git push)",
    "Bash(git push *)",
    "Bash(git reset *)",
    "Bash(git checkout *)",
    "Bash(git switch *)",
    "Bash(git stash *)",
    "Bash(git rebase *)",
    "Bash(git clean *)",
    "Bash(bun run db:push)",
    "Bash(bun run db:push *)",
    "Bash(bun run db:migrate *)",
  ] as const,

  // Verification commands
  DEFAULT_VERIFY: ["bun test", "bun run lint"] as const,
  TSC_SERVER: "bunx tsc --noEmit -p .nuxt/tsconfig.server.json",
  TSC_APP: "bunx tsc --noEmit -p .nuxt/tsconfig.app.json",
  NO_NEW_MIGRATION:
    'bun run db:generate || exit 1; if git status --porcelain --untracked-files=all | grep -q "migrations/"; then echo "db:generate produced a new migration"; exit 1; fi',

  // Regex patterns
  HUMAN_TASK_REGEX: /\bopen the PRs?\b|\bdecide the delivery\b|\bgit push\b/i,
  CONVENTIONAL_TYPE_REGEX: /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?$/,
  CONVENTIONAL_HEADER_REGEX: /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/,

  // Formatting and output truncation
  ONE_LINE_MAX_LENGTH: 140,
  TOOL_INPUT_MAX_LENGTH: 100,
  EPOCH_MS_THRESHOLD: 1e12,
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60_000,
  LOG_TEXT_MAX_LENGTH: 500,
  STDERR_TAIL_MAX_LENGTH: 500,
  ERROR_DETAIL_MAX_LENGTH: 300,
  TASK_SUMMARY_MAX_LENGTH: 100,
  GIT_STATUS_PREFIX_LENGTH: 3,
  CHECK_FAILURE_TAIL_LINES: 15,
  CHECK_FAILURE_OUTPUT_MAX_LENGTH: 3000,
  COMMIT_ERROR_OUTPUT_MAX_LENGTH: 2000,
  COMMIT_MESSAGE_MAX_LENGTH: 100,

  // CLI and formatting indices
  ARGV_START_INDEX: 2,
  DECIMAL_PLACES_USD: 2,

  // Exit codes
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_ERROR: 1,
  EXIT_CODE_FATAL: 2,

  // Token cost calculation (Gemini)
  TOKEN_PRICE_BASE: 1_000_000,
  GEMINI_FLASH_INPUT_COST: 0.15,
  GEMINI_FLASH_OUTPUT_COST: 0.60,
  GEMINI_PRO_INPUT_COST: 1.25,
  GEMINI_PRO_OUTPUT_COST: 5.00,
} as const;

export const FULL_VERIFY: readonly string[] = [
  ...CONSTANTS.DEFAULT_VERIFY,
  CONSTANTS.TSC_SERVER,
  CONSTANTS.TSC_APP,
  "bun run build",
  "bun run test:e2e",
];

export interface CascadeConfig {
  /** Root directory of target repository */
  repo: string;
  /** Changes to execute in cascade order */
  changes: string[];
  /** Allow execution on dirty git working tree */
  allowDirty: boolean;
  /** Print execution plan and usage meters without running tasks */
  dryRun: boolean;
  /** Run full verification on every committing task */
  fullGate: boolean;
  /** Selected agent execution engine */
  engine: EngineType;
  /** Keep-alive sleep prevention mechanism */
  keepAlive: boolean;
  /** Model override */
  model?: string;
  /** Reasoning effort override ("high", "low", "none", etc.) */
  effort?: string;

  /** Maximum plan usage percentage before pausing (0-100) */
  usageLimitPercent: number;
  /** Reset margin ms added to rate limit reset time */
  resetMarginMs: number;
  /** Reset sleep ms when rate limit reset time is unknown */
  unknownResetSleepMs: number;
  /** Minimum pause duration ms */
  minPauseMs: number;
  /** Max retry attempts per task */
  maxAttemptsPerTask: number;
  /** Max turns allowed in a single agent session */
  maxTurnsPerSession: number;
  /** Max USD budget per session */
  maxBudgetPerSessionUsd: number;
  /** Max total USD budget across all changes */
  maxTotalBudgetUsd: number;
  /** Subprocess command timeout ms */
  commandTimeoutMs: number;
  /** Engine session timeout ms */
  engineSessionTimeoutMs: number;
  /** Rate limit pause duration ms for external engines */
  rateLimitSleepMs: number;

  /** Protected git branches where runner refuses to run */
  protectedBranches: readonly string[];
  /** Path patterns never committed */
  neverCommit: readonly string[];
  /** Bash commands prohibited for agents */
  deniedBash: readonly string[];
  /** Allowed agent tools */
  allowedTools: readonly string[];
  /** Setting sources allowed */
  settingSources: readonly string[];

  /** Default verification suite */
  defaultVerify: readonly string[];
  /** TypeScript server verification command */
  tscServer: string;
  /** TypeScript app verification command */
  tscApp: string;
  /** Full verification suite */
  fullVerify: readonly string[];
  /** Shell check ensuring db:generate produces no new migration */
  noNewMigration: string;

  /** Default model for Antigravity engine */
  defaultAntigravityModel: string;
  /** Default model for OpenCode engine */
  defaultOpenCodeModel: string;
}

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
  [key: string]: unknown;
}

export interface LoadConfigOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  cwd?: string;
  overrides?: Partial<CascadeConfig>;
}

export function resolveEngine(engineArg: string | undefined): EngineType {
  const raw = (engineArg ?? CONSTANTS.DEFAULT_ENGINE).toLowerCase();
  if (raw === "antigravity" || raw === "agy") return "antigravity";
  if (raw === "opencode") return "opencode";
  if (raw === "claude") return "claude";
  throw new Error(`--engine must be "claude", "opencode", or "antigravity" (or "agy"), got "${engineArg}"`);
}

export function isKeepAliveEnabled(options: { "no-keep-alive"?: boolean; "keep-alive"?: boolean }): boolean {
  if (options["no-keep-alive"]) return false;
  if (options["keep-alive"] === false) return false;
  return true;
}

export function parseCliArgs(argv: string[] = process.argv.slice(CONSTANTS.ARGV_START_INDEX)): {
  options: ParsedCliOptions;
  positionals: string[];
} {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        repo: { type: "string" },
        changes: { type: "string" },
        "allow-dirty": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        "full-gate": { type: "boolean", default: false },
        engine: { type: "string" },
        "no-keep-alive": { type: "boolean", default: false },
        "keep-alive": { type: "boolean" },
        model: { type: "string" },
        effort: { type: "string" },
      },
      strict: false,
      allowPositionals: true,
    });
    return { options: values as ParsedCliOptions, positionals };
  } catch {
    return { options: {}, positionals: [] };
  }
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const lower = value.toLowerCase().trim();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return defaultValue;
}

export function loadConfig(options: LoadConfigOptions = {}): CascadeConfig {
  const argv = options.argv ?? process.argv.slice(CONSTANTS.ARGV_START_INDEX);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const overrides = options.overrides ?? {};

  const { options: cliOpts } = parseCliArgs(argv);

  // 1. Repo
  const rawRepo = overrides.repo ?? cliOpts.repo ?? env.CASCADE_REPO ?? cwd;
  const repo = normalizePlatformPath(rawRepo);

  // 2. Changes
  let changes: string[];
  if (overrides.changes) {
    changes = [...overrides.changes];
  } else if (cliOpts.changes !== undefined) {
    changes = cliOpts.changes.split(",").map((c) => c.trim()).filter(Boolean);
  } else if (env.CASCADE_CHANGES !== undefined) {
    changes = env.CASCADE_CHANGES.split(",").map((c) => c.trim()).filter(Boolean);
  } else {
    changes = [];
  }

  // 3. Flags
  const allowDirty =
    overrides.allowDirty ??
    (cliOpts["allow-dirty"] ? true : parseBoolean(env.CASCADE_ALLOW_DIRTY, false));

  const dryRun =
    overrides.dryRun ??
    (cliOpts["dry-run"] ? true : parseBoolean(env.CASCADE_DRY_RUN, false));

  const fullGate =
    overrides.fullGate ??
    (cliOpts["full-gate"] ? true : parseBoolean(env.CASCADE_FULL_GATE, false));

  // 4. Engine
  const rawEngine = overrides.engine ?? cliOpts.engine ?? env.CASCADE_ENGINE;
  const engine = resolveEngine(rawEngine);

  // 5. Keep-Alive
  let keepAlive: boolean;
  if (overrides.keepAlive !== undefined) {
    keepAlive = overrides.keepAlive;
  } else if (cliOpts["no-keep-alive"]) {
    keepAlive = false;
  } else if (cliOpts["keep-alive"] !== undefined) {
    keepAlive = Boolean(cliOpts["keep-alive"]);
  } else if (env.CASCADE_KEEP_ALIVE !== undefined) {
    keepAlive = parseBoolean(env.CASCADE_KEEP_ALIVE, true);
  } else {
    keepAlive = true;
  }

  // 6. Model & Effort
  const model = overrides.model ?? cliOpts.model ?? env.CASCADE_MODEL ?? undefined;
  const effort = overrides.effort ?? cliOpts.effort ?? env.CASCADE_EFFORT ?? CONSTANTS.DEFAULT_EFFORT;

  // 7. Limits & Margins
  const usageLimitPercent =
    overrides.usageLimitPercent ??
    parseNumber(env.CASCADE_USAGE_LIMIT_PERCENT, CONSTANTS.USAGE_LIMIT_PERCENT);

  const resetMarginMs =
    overrides.resetMarginMs ??
    parseNumber(env.CASCADE_RESET_MARGIN_MS, CONSTANTS.RESET_MARGIN_MS);

  const unknownResetSleepMs =
    overrides.unknownResetSleepMs ??
    parseNumber(env.CASCADE_UNKNOWN_RESET_SLEEP_MS, CONSTANTS.UNKNOWN_RESET_SLEEP_MS);

  const minPauseMs =
    overrides.minPauseMs ??
    parseNumber(env.CASCADE_MIN_PAUSE_MS, CONSTANTS.MIN_PAUSE_MS);

  const maxAttemptsPerTask =
    overrides.maxAttemptsPerTask ??
    parseNumber(env.CASCADE_MAX_ATTEMPTS, CONSTANTS.MAX_ATTEMPTS_PER_TASK);

  const maxTurnsPerSession =
    overrides.maxTurnsPerSession ??
    parseNumber(env.CASCADE_MAX_TURNS, CONSTANTS.MAX_TURNS_PER_SESSION);

  const maxBudgetPerSessionUsd =
    overrides.maxBudgetPerSessionUsd ??
    parseNumber(env.CASCADE_MAX_BUDGET_USD, CONSTANTS.MAX_BUDGET_PER_SESSION_USD);

  const maxTotalBudgetUsd =
    overrides.maxTotalBudgetUsd ??
    parseNumber(env.CASCADE_TOTAL_BUDGET_USD, CONSTANTS.MAX_TOTAL_BUDGET_USD);

  const commandTimeoutMs =
    overrides.commandTimeoutMs ??
    parseNumber(env.CASCADE_COMMAND_TIMEOUT_MS, CONSTANTS.COMMAND_TIMEOUT_MS);

  const engineSessionTimeoutMs =
    overrides.engineSessionTimeoutMs ??
    parseNumber(env.CASCADE_ENGINE_TIMEOUT_MS, CONSTANTS.ENGINE_SESSION_TIMEOUT_MS);

  const rateLimitSleepMs =
    overrides.rateLimitSleepMs ??
    parseNumber(env.CASCADE_RATE_LIMIT_SLEEP_MS, CONSTANTS.RATE_LIMIT_SLEEP_MS);

  return {
    repo,
    changes,
    allowDirty,
    dryRun,
    fullGate,
    engine,
    keepAlive,
    model,
    effort,
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
    protectedBranches: overrides.protectedBranches ?? CONSTANTS.PROTECTED_BRANCHES,
    neverCommit: overrides.neverCommit ?? CONSTANTS.NEVER_COMMIT,
    deniedBash: overrides.deniedBash ?? CONSTANTS.DENIED_BASH,
    allowedTools: overrides.allowedTools ?? CONSTANTS.ALLOWED_TOOLS,
    settingSources: overrides.settingSources ?? CONSTANTS.SETTING_SOURCES,
    defaultVerify: overrides.defaultVerify ?? CONSTANTS.DEFAULT_VERIFY,
    tscServer: overrides.tscServer ?? CONSTANTS.TSC_SERVER,
    tscApp: overrides.tscApp ?? CONSTANTS.TSC_APP,
    fullVerify: overrides.fullVerify ?? FULL_VERIFY,
    noNewMigration: overrides.noNewMigration ?? CONSTANTS.NO_NEW_MIGRATION,
    defaultAntigravityModel: overrides.defaultAntigravityModel ?? CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL,
    defaultOpenCodeModel: overrides.defaultOpenCodeModel ?? CONSTANTS.DEFAULT_OPENCODE_MODEL,
  };
}

export function getDefaultConfig(cwd = process.cwd()): CascadeConfig {
  return loadConfig({ argv: [], env: {}, cwd });
}
