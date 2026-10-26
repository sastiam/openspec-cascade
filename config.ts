/**
 * Centralized configuration module for openspec-cascade.
 *
 * Provides typed configuration loading with CLI arguments, environment variable
 * overrides, and strict constants to ensure zero magic numbers across the codebase.
 */

import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
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
  QA_VERIFY_COMMANDS: [
    "bun test",
    "bunx tsc --noEmit",
    "bun run lint",
    "bun run build",
  ] as const,
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
  GIT_STATUS_CODE_LENGTH: 2,
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

  // Diagram synchronization
  GRAPHIFY_COMMAND: "graphify update .",
  ARCHIFY_ACTION: "deliver",
  ARCHIFY_DEFAULT_QUALITY: "showcase",
  ARCHIFY_DIR_NAME: ".archify",
  ARCHIFY_CANDIDATE_JSON: "candidate.json",
  ARCHIFY_CANDIDATE_MD: "candidate.archify.md",
  ARCHIFY_DEFAULT_TYPE: "architecture",
  ARCHIFY_EXPLAINER_TYPE: "explainer",
  ARCHIFY_FALLBACK_EXT: ".html",
  DIAGRAM_SYNC_TIMEOUT_MS: 300_000,
  DIAGRAM_LOG_TAIL_LINES: 10,

  // 24/7 Failure resilience and git rollback state buffer
  GIT_RESET_CMD: "git reset --hard",
  GIT_CLEAN_CMD: "git clean -fd",
  GIT_HEAD_REF: "HEAD",
  GIT_REV_PARSE_HEAD: "git rev-parse HEAD",
  GIT_STATUS_PORCELAIN: "git status --porcelain",
  ROLLBACK_ON_FAILURE: true,
  RESILIENT_MODE: false,
} as const;

export const FULL_VERIFY: readonly string[] = [
  ...CONSTANTS.DEFAULT_VERIFY,
  CONSTANTS.TSC_SERVER,
  CONSTANTS.TSC_APP,
  "bun run build",
  "bun run test:e2e",
];

export const QA_VERIFY_COMMANDS: readonly string[] = CONSTANTS.QA_VERIFY_COMMANDS;

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
  /** Directory where run logs are written (created lazily on first write) */
  logDir: string;

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

  /** Command to update Graphify knowledge graph */
  graphifyCommand: string;
  /** Action for Archify CLI rendering (e.g. "deliver" or "render") */
  archifyAction: string;
  /** Default quality profile for Archify */
  archifyQuality: string;
  /** Custom Archify binary or command prefix */
  archifyBin?: string;
  /** Whether automatic diagram synchronization is enabled */
  autoDiagrams: boolean;

  /** Whether to roll back working tree on task failure after exhausting attempts */
  rollbackOnFailure: boolean;
  /** Whether to continue to next task on task failure in 24/7 resilience mode */
  resilient: boolean;
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

export interface LogDirInput {
  /** Value of `--log-dir` */
  option?: string;
  /** Value of `CASCADE_LOG_DIR` */
  env?: string;
  /** Target repository root; its basename names the default subdirectory */
  repo: string;
  /** Home directory hosting the default cache location */
  home: string;
  /** Base for resolving relative paths */
  cwd: string;
}

/** Log directory precedence: `--log-dir` > `CASCADE_LOG_DIR` > `<home>/.cache/openspec-cascade/logs/<repo name>`. */
export function resolveLogDir({ option, env, repo, home, cwd }: LogDirInput): string {
  const explicit = [option, env].find((value) => value !== undefined && value.trim() !== "");
  if (explicit !== undefined) return resolve(cwd, explicit.trim());
  return join(home, ".cache", "openspec-cascade", "logs", basename(repo));
}

const HELP_TEXT = `openspec-cascade: run OpenSpec changes in order, one agent session per task.

Usage:
  openspec-cascade --repo <path> --changes a,b,c [options]

Options:
  --repo <path>              Target repository (default: current directory; env CASCADE_REPO)
  --changes a,b,c            OpenSpec changes to run, in cascade order (env CASCADE_CHANGES)
  --engine <name>            claude (default), opencode, or antigravity (alias: agy)
  --model <name>             Model override for the selected engine
  --effort <level>           Reasoning effort override (default: ${CONSTANTS.DEFAULT_EFFORT})
  --allow-dirty              Run on a dirty git working tree
  --dry-run                  Print the plan and usage meters; run nothing and write no logs
  --full-gate                Run the full verification suite on every committing task
  --no-keep-alive            Do not prevent the machine from sleeping while running
  --log-dir <path>           Directory for run logs (default: ~/.cache/openspec-cascade/logs/<repo name>)
  --no-diagrams              Disable automatic diagram synchronization
  --graphify-command <cmd>   Command that updates the Graphify knowledge graph
  --archify-action <action>  Archify action (default: ${CONSTANTS.ARCHIFY_ACTION})
  --archify-quality <name>   Archify quality profile (default: ${CONSTANTS.ARCHIFY_DEFAULT_QUALITY})
  --archify-bin <path>       Archify binary or command prefix
  --no-rollback              Keep the working tree as is when a task fails
  --resilient                Continue with the next task when a task fails (alias: --continue-on-failure)
  -h, --help                 Show this help and exit

Environment:
  CASCADE_MODEL              Same as --model
  CASCADE_EFFORT             Same as --effort
  CASCADE_LOG_DIR            Same as --log-dir (the flag takes precedence)

Examples:
  openspec-cascade --repo ~/work/my-app --changes add-auth,add-billing
  openspec-cascade --repo . --changes add-auth --engine opencode --dry-run
`;

export function formatHelp(): string {
  return HELP_TEXT;
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
        "log-dir": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        "no-diagrams": { type: "boolean", default: false },
        diagrams: { type: "boolean" },
        "graphify-command": { type: "string" },
        "archify-action": { type: "string" },
        "archify-quality": { type: "string" },
        "archify-bin": { type: "string" },
        "no-rollback": { type: "boolean", default: false },
        rollback: { type: "boolean" },
        resilient: { type: "boolean", default: false },
        "continue-on-failure": { type: "boolean" },
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
    changes = cliOpts.changes.split(",").map((c) => c.replace(/\s+/g, "")).filter(Boolean);
  } else if (env.CASCADE_CHANGES !== undefined) {
    changes = env.CASCADE_CHANGES.split(",").map((c) => c.replace(/\s+/g, "")).filter(Boolean);
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

  // 6b. Log directory
  const logDir =
    overrides.logDir ??
    resolveLogDir({
      option: typeof cliOpts["log-dir"] === "string" ? cliOpts["log-dir"] : undefined,
      env: env.CASCADE_LOG_DIR,
      repo,
      home: homedir(),
      cwd,
    });

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

  // 8. Diagram Synchronization
  let autoDiagrams: boolean;
  if (overrides.autoDiagrams !== undefined) {
    autoDiagrams = overrides.autoDiagrams;
  } else if (cliOpts["no-diagrams"]) {
    autoDiagrams = false;
  } else if (cliOpts.diagrams !== undefined) {
    autoDiagrams = Boolean(cliOpts.diagrams);
  } else if (env.CASCADE_AUTO_DIAGRAMS !== undefined) {
    autoDiagrams = parseBoolean(env.CASCADE_AUTO_DIAGRAMS, true);
  } else {
    autoDiagrams = true;
  }

  const graphifyCommand =
    overrides.graphifyCommand ??
    (typeof cliOpts["graphify-command"] === "string" ? cliOpts["graphify-command"] : undefined) ??
    env.CASCADE_GRAPHIFY_COMMAND ??
    CONSTANTS.GRAPHIFY_COMMAND;

  const archifyAction =
    overrides.archifyAction ??
    (typeof cliOpts["archify-action"] === "string" ? cliOpts["archify-action"] : undefined) ??
    env.CASCADE_ARCHIFY_ACTION ??
    CONSTANTS.ARCHIFY_ACTION;

  const archifyQuality =
    overrides.archifyQuality ??
    (typeof cliOpts["archify-quality"] === "string" ? cliOpts["archify-quality"] : undefined) ??
    env.CASCADE_ARCHIFY_QUALITY ??
    CONSTANTS.ARCHIFY_DEFAULT_QUALITY;

  const archifyBin =
    overrides.archifyBin ??
    (typeof cliOpts["archify-bin"] === "string" ? cliOpts["archify-bin"] : undefined) ??
    env.ARCHIFY_BIN ??
    env.CASCADE_ARCHIFY_BIN ??
    undefined;

  // 9. Failure Resilience & Rollback Buffer
  let rollbackOnFailure: boolean;
  if (overrides.rollbackOnFailure !== undefined) {
    rollbackOnFailure = overrides.rollbackOnFailure;
  } else if (cliOpts["no-rollback"]) {
    rollbackOnFailure = false;
  } else if (cliOpts.rollback !== undefined) {
    rollbackOnFailure = Boolean(cliOpts.rollback);
  } else if (env.CASCADE_ROLLBACK_ON_FAILURE !== undefined) {
    rollbackOnFailure = parseBoolean(env.CASCADE_ROLLBACK_ON_FAILURE, CONSTANTS.ROLLBACK_ON_FAILURE);
  } else if (env.CASCADE_GIT_ROLLBACK !== undefined) {
    rollbackOnFailure = parseBoolean(env.CASCADE_GIT_ROLLBACK, CONSTANTS.ROLLBACK_ON_FAILURE);
  } else {
    rollbackOnFailure = CONSTANTS.ROLLBACK_ON_FAILURE;
  }

  let resilient: boolean;
  if (overrides.resilient !== undefined) {
    resilient = overrides.resilient;
  } else if (cliOpts.resilient) {
    resilient = true;
  } else if (cliOpts["continue-on-failure"]) {
    resilient = true;
  } else if (env.CASCADE_RESILIENT !== undefined) {
    resilient = parseBoolean(env.CASCADE_RESILIENT, CONSTANTS.RESILIENT_MODE);
  } else if (env.CASCADE_CONTINUE_ON_FAILURE !== undefined) {
    resilient = parseBoolean(env.CASCADE_CONTINUE_ON_FAILURE, CONSTANTS.RESILIENT_MODE);
  } else {
    resilient = CONSTANTS.RESILIENT_MODE;
  }

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
    logDir,
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
