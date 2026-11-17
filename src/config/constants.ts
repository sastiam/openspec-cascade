/**
 * Centralized immutable constant namespaces for openspec-cascade.
 *
 * Eliminates magic numbers and unifies configuration, runtime, engine, budget,
 * timeout, git, SDD, diagram, exit-code, formatting, Greptile, telemetry,
 * guardrail, and verification constants in a single source of truth.
 */

export const EXIT_CODE_CONSTANTS = {
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_ERROR: 1,
  EXIT_CODE_FATAL: 2,
  EXIT_CODE_TIMEOUT: 124,
  EXIT_CODE_SIGINT: 130,
  EXIT_CODE_SIGTERM: 143,
} as const;

export const RUNTIME_CONSTANTS = {
  ARGV_START_INDEX: 2,
  DEFAULT_MODE: "v1" as const,
  SUPPORTED_MODES: ["v1", "v2"] as const,
  DEFAULT_CONFIG_FILENAME: ".openspec-cascade.json",
  DEFAULT_LOG_CACHE_SUBDIRS: [".cache", "openspec-cascade", "logs"] as const,
  ROLLBACK_ON_FAILURE: true,
  RESILIENT_MODE: false,
  LOCKFILE_NAMES: [
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ] as const,
  NUXT_CONFIG_FILES: [
    ".nuxt",
    "nuxt.config.ts",
    "nuxt.config.js",
    "nuxt.config.mjs",
    "nuxt.config.mts",
  ] as const,
  COMMIT_SUBJECT_MAX_LENGTH: 60,
} as const;

export const ENGINE_CONSTANTS = {
  DEFAULT_ENGINE: "claude" as const,
  SUPPORTED_ENGINES: ["claude", "opencode", "antigravity", "jules"] as const,
  ENGINE_ALIASES: { agy: "antigravity", gemini: "antigravity" } as const,
  DEFAULT_EFFORT: "high" as const,
  SUPPORTED_EFFORTS: ["low", "medium", "high", "max", "none"] as const,
  DEFAULT_ANTIGRAVITY_MODEL: "gemini-3.8-flash-high",
  DEFAULT_OPENCODE_MODEL: "opencode/deepseek-v4.1-flash",
  DEFAULT_CLAUDE_MODEL: "claude-3-7-sonnet-20250219",
  DEFAULT_JULES_MODEL: "jules",
  GEMINI_API_DEFAULT_MODEL: "gemini-2.5-pro",
  GEMINI_API_FALLBACK_MODEL: "gemini-2.0-flash",
  MAX_ATTEMPTS_PER_TASK: 3,
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
} as const;

export const BUDGET_CONSTANTS = {
  USAGE_LIMIT_PERCENT: 95,
  MIN_USAGE_LIMIT_PERCENT: 1,
  MAX_USAGE_LIMIT_PERCENT: 100,
  MAX_TURNS_PER_SESSION: 60,
  MAX_BUDGET_PER_SESSION_USD: 10,
  MAX_TOTAL_BUDGET_USD: 150,
  MIN_BUDGET_USD: 0,
  MAX_CHALLENGE_ATTEMPTS: 2,
  MAX_VICTORY_FAILURES: 3,
  DEFAULT_SPAWN_LIMIT: 16,
  DEFAULT_TOKEN_WATERMARK_PERCENT: 80,
  TOKEN_PRICE_BASE: 1_000_000,
  GEMINI_FLASH_INPUT_COST: 0.15,
  GEMINI_FLASH_OUTPUT_COST: 0.60,
  GEMINI_PRO_INPUT_COST: 1.25,
  GEMINI_PRO_OUTPUT_COST: 5.00,
} as const;

export const TIMEOUT_CONSTANTS = {
  RESET_MARGIN_MS: 120_000,
  UNKNOWN_RESET_SLEEP_MS: 1_800_000,
  MIN_PAUSE_MS: 60_000,
  COMMAND_TIMEOUT_MS: 1_800_000,
  ANTIGRAVITY_SESSION_TIMEOUT_MS: 2_700_000,
  OPENCODE_SESSION_TIMEOUT_MS: 2_700_000,
  ENGINE_SESSION_TIMEOUT_MS: 2_700_000,
  RATE_LIMIT_SLEEP_MS: 1_800_000,
  ADAPTER_DEFAULT_TIMEOUT_MS: 60_000,
  RATE_LIMIT_RESET_FALLBACK_MS: 60_000,
  EPOCH_MS_THRESHOLD: 1e12,
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60_000,
  MIN_DURATION_MS: 0,
} as const;

export const GIT_CONSTANTS = {
  PROTECTED_BRANCHES: ["stable", "main", "master"] as const,
  NEVER_COMMIT: [".atl", ".claude/settings.local.json"] as const,
  DEFAULT_ROLLBACK_EXCLUDES: [
    ".agents/teamwork/",
    "projects/",
    "logs/",
    ".atl",
    ".claude/settings.local.json",
  ] as const,
  GIT_RESET_CMD: "git reset --hard",
  GIT_CLEAN_CMD: "git clean -fd",
  GIT_HEAD_REF: "HEAD",
  GIT_REV_PARSE_HEAD: "git rev-parse HEAD",
  GIT_STATUS_PORCELAIN: "git status --porcelain",
  GIT_STATUS_PREFIX_LENGTH: 3,
  GIT_STATUS_CODE_LENGTH: 2,
  CONVENTIONAL_TYPE_REGEX: /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?$/,
  CONVENTIONAL_HEADER_REGEX: /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/,
} as const;

export const SDD_CONSTANTS = {
  SDD_ENABLED_DEFAULT: true,
  SDD_PRODUCTION_EXTENSIONS: [".ts", ".tsx", ".js", ".jsx", ".vue", ".py", ".go", ".rs", ".java", ".rb", ".php", ".kt"] as const,
  SDD_EXEMPT_PATH_SEGMENTS: ["/test/", "/tests/", "/__tests__/", "/spec/", "/specs/", "/docs/", "/openspec/", "/.agents/", "/.claude/", "/dist/"] as const,
  SDD_EXEMPT_NAME_PREFIXES: ["test_", "test.", "spec."] as const,
  SDD_EXEMPT_NAME_SUFFIXES: [".test.", ".spec."] as const,
  SDD_GATED_TOOLS: ["Edit", "Write", "MultiEdit"] as const,
  MIN_REVIEW_DURATION_SECONDS: 0,
  SDD_MIN_REVIEW_DURATION_SECONDS: 10,
  SDD_MAX_REVIEW_FIX_ROUNDS: 2,
  SDD_MAX_TASKS_BUDGET: 12,
  SDD_TASK_CHECK_HEADINGS_MANUAL: ["manual", "pendiente humano", "qa manual", "post-deploy", "deploy"] as const,
  SDD_FRONTEND_EXTENSIONS: [".vue", ".tsx", ".jsx", ".svelte", ".html", ".css", ".scss", ".sass", ".less"] as const,
  SDD_API_PATH_PATTERNS: ["/api/", "/routes/", "/controllers/", "/handlers/", "/server/", "/resolvers/"] as const,
  SDD_CONSTITUTION_PATH: "openspec/project.md",
  SDD_MIN_KEYWORD_LENGTH: 3,
} as const;

export const DIAGRAM_CONSTANTS = {
  AUTO_DIAGRAMS_DEFAULT: true,
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
} as const;

export const FORMAT_CONSTANTS = {
  ONE_LINE_MAX_LENGTH: 140,
  TOOL_INPUT_MAX_LENGTH: 100,
  LOG_TEXT_MAX_LENGTH: 500,
  STDERR_TAIL_MAX_LENGTH: 500,
  ERROR_DETAIL_MAX_LENGTH: 300,
  TASK_SUMMARY_MAX_LENGTH: 100,
  CHECK_FAILURE_TAIL_LINES: 15,
  CHECK_FAILURE_OUTPUT_MAX_LENGTH: 3000,
  COMMIT_ERROR_OUTPUT_MAX_LENGTH: 2000,
  COMMIT_MESSAGE_MAX_LENGTH: 100,
  DECIMAL_PLACES_USD: 2,
  HUMAN_TASK_REGEX: /\bopen the PRs?\b|\bdecide the delivery\b|\bgit push\b/i,
} as const;

export const GREPTILE_CONSTANTS = {
  DEFAULT_ENABLED: false,
  DEFAULT_TIMEOUT_MS: 60_000,
  DEFAULT_CACHE_TTL_MS: 3_600_000,
  DEFAULT_CACHE_DIR: ".cascade/cache/greptile",
  DEFAULT_TOKEN_BUDGET: 8_000,
  DEFAULT_BINARY: "greptile",
  CACHE_SCHEMA_VERSION: 1,
  CACHE_FILE_EXTENSION: ".json",
  DEFAULT_CACHE_POLICY: "fail-open" as const,
  CHARS_PER_TOKEN: 4,
  HASH_ALGORITHM: "sha256",
  SHADOW_REF_PREFIX: "refs/cascade/shadow/",
  SHADOW_INDEX_PREFIX: "cascade-shadow-index-",
  SHADOW_INDEX_FILENAME: "index",
  SHADOW_COMMIT_MESSAGE: "cascade: ephemeral shadow snapshot",
  SHADOW_AUTHOR_NAME: "openspec-cascade",
  SHADOW_AUTHOR_EMAIL: "cascade-shadow@localhost",
  REVIEW_QUERY_KEY: "__review__",
  SEVERITY_RANK: { critical: 4, high: 3, medium: 2, low: 1 } as const,
  CONTEXT_HEADER: "## Greptile semantic context",
  STDERR_TAIL_LENGTH: 500,
  SHADOW_WORKTREE_PREFIX: "cascade-shadow-worktree-",
  SHADOW_EXCLUDED_PATHS: [".cascade", ".agents/teamwork"] as const,
  API_KEY_ENV: "GREPTILE_API_KEY",
  REVIEW_ARGS: ["review", "--json"] as const,
  REVIEW_BASE_FLAG: "--branch",
  REVIEW_STATUS_ARGS: ["review", "status", "--json"] as const,
  REVIEW_STATUS_COMMIT_FLAG: "--commit",
  WHOAMI_ARGS: ["whoami"] as const,
  VERSION_ARGS: ["--version"] as const,
  REVIEW_STATUS_EXIT_CODES: { 0: "completed", 1: "none", 2: "invalid", 3: "running", 4: "failed", 5: "cancelled" } as const,
  AUTH_FAILURE_PATTERN: /not (?:signed|logged) in|sign in|login|unauthori[sz]ed|api key|\b401\b|\b403\b/i,
  RATE_LIMIT_PATTERN: /rate.?limit|\b429\b|quota|credits?/i,
  QUERY_MIN_TERM_LENGTH: 3,
} as const;

export const TELEMETRY_CONSTANTS = {
  DEFAULT_ENABLED: true,
  DEFAULT_TELEMETRY_DIR: ".cascade/telemetry",
  DEFAULT_REDACT_SECRETS: true,
  DEFAULT_MAX_REDACTION_DEPTH: 10,
} as const;

export const GUARDRAIL_CONSTANTS = {
  MAX_REDACTION_DEPTH: 10,
  REDACTED_VALUE: "[REDACTED]",
  CIRCULAR_REF_MARKER: "[Circular]",
  MAX_DEPTH_MARKER: "[MaxDepth]",
  MIN_POSITIVE_INT: 1,
  SENSITIVE_KEY_PATTERN: /(?:api[_-]?key|token|secret|password|passwd|auth(?:orization)?|bearer|credential|private[_-]?key|cookie|session[_-]?id|access[_-]?key|client[_-]?secret)/i,
} as const;

export const VERIFY_CONSTANTS = {
  DEFAULT_VERIFY: ["bun test", "bun run lint"] as const,
  QA_VERIFY_COMMANDS: [
    "bun test",
    "bunx tsc --noEmit",
    "bun run lint",
    "bun run build",
  ] as const,
  TSC_SERVER: "bunx tsc --noEmit -p .nuxt/tsconfig.server.json",
  TSC_APP: "bunx tsc --noEmit -p .nuxt/tsconfig.app.json",
  NUXT_PREPARE_CMD: "bunx nuxi prepare",
  ALWAYS_VERIFY: [] as readonly string[],
  ALWAYS_VERIFY_V2_WARNING: "alwaysVerify is ignored in v2 mode; it applies to v1 runs only.",
  ALWAYS_VERIFY_BASELINE_FAILED:
    "alwaysVerify fails before the first task; fix the project or the alwaysVerify setting. Failing commands:",
  NO_NEW_MIGRATION:
    'bun run db:generate || exit 1; if git status --porcelain --untracked-files=all | grep -q "migrations/"; then echo "db:generate produced a new migration"; exit 1; fi',
} as const;

/**
 * Composed flat constants dictionary preserving backward compatibility with root config.ts consumers.
 */
export const CONSTANTS = {
  USAGE_LIMIT_PERCENT: BUDGET_CONSTANTS.USAGE_LIMIT_PERCENT,
  RESET_MARGIN_MS: TIMEOUT_CONSTANTS.RESET_MARGIN_MS,
  UNKNOWN_RESET_SLEEP_MS: TIMEOUT_CONSTANTS.UNKNOWN_RESET_SLEEP_MS,
  MIN_PAUSE_MS: TIMEOUT_CONSTANTS.MIN_PAUSE_MS,

  MAX_ATTEMPTS_PER_TASK: ENGINE_CONSTANTS.MAX_ATTEMPTS_PER_TASK,
  MAX_TURNS_PER_SESSION: BUDGET_CONSTANTS.MAX_TURNS_PER_SESSION,
  MAX_BUDGET_PER_SESSION_USD: BUDGET_CONSTANTS.MAX_BUDGET_PER_SESSION_USD,
  MAX_TOTAL_BUDGET_USD: BUDGET_CONSTANTS.MAX_TOTAL_BUDGET_USD,
  COMMAND_TIMEOUT_MS: TIMEOUT_CONSTANTS.COMMAND_TIMEOUT_MS,

  ANTIGRAVITY_SESSION_TIMEOUT_MS: TIMEOUT_CONSTANTS.ANTIGRAVITY_SESSION_TIMEOUT_MS,
  OPENCODE_SESSION_TIMEOUT_MS: TIMEOUT_CONSTANTS.OPENCODE_SESSION_TIMEOUT_MS,
  ENGINE_SESSION_TIMEOUT_MS: TIMEOUT_CONSTANTS.ENGINE_SESSION_TIMEOUT_MS,
  RATE_LIMIT_SLEEP_MS: TIMEOUT_CONSTANTS.RATE_LIMIT_SLEEP_MS,

  DEFAULT_ENGINE: ENGINE_CONSTANTS.DEFAULT_ENGINE,
  DEFAULT_EFFORT: ENGINE_CONSTANTS.DEFAULT_EFFORT,
  DEFAULT_ANTIGRAVITY_MODEL: ENGINE_CONSTANTS.DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_OPENCODE_MODEL: ENGINE_CONSTANTS.DEFAULT_OPENCODE_MODEL,
  DEFAULT_CLAUDE_MODEL: ENGINE_CONSTANTS.DEFAULT_CLAUDE_MODEL,

  PROTECTED_BRANCHES: GIT_CONSTANTS.PROTECTED_BRANCHES,
  NEVER_COMMIT: GIT_CONSTANTS.NEVER_COMMIT,

  ALLOWED_TOOLS: ENGINE_CONSTANTS.ALLOWED_TOOLS,
  SETTING_SOURCES: ENGINE_CONSTANTS.SETTING_SOURCES,
  DENIED_BASH: ENGINE_CONSTANTS.DENIED_BASH,

  DEFAULT_VERIFY: VERIFY_CONSTANTS.DEFAULT_VERIFY,
  QA_VERIFY_COMMANDS: VERIFY_CONSTANTS.QA_VERIFY_COMMANDS,
  TSC_SERVER: VERIFY_CONSTANTS.TSC_SERVER,
  TSC_APP: VERIFY_CONSTANTS.TSC_APP,
  NO_NEW_MIGRATION: VERIFY_CONSTANTS.NO_NEW_MIGRATION,

  HUMAN_TASK_REGEX: FORMAT_CONSTANTS.HUMAN_TASK_REGEX,
  CONVENTIONAL_TYPE_REGEX: GIT_CONSTANTS.CONVENTIONAL_TYPE_REGEX,
  CONVENTIONAL_HEADER_REGEX: GIT_CONSTANTS.CONVENTIONAL_HEADER_REGEX,

  ONE_LINE_MAX_LENGTH: FORMAT_CONSTANTS.ONE_LINE_MAX_LENGTH,
  TOOL_INPUT_MAX_LENGTH: FORMAT_CONSTANTS.TOOL_INPUT_MAX_LENGTH,
  EPOCH_MS_THRESHOLD: TIMEOUT_CONSTANTS.EPOCH_MS_THRESHOLD,
  MS_PER_SECOND: TIMEOUT_CONSTANTS.MS_PER_SECOND,
  MS_PER_MINUTE: TIMEOUT_CONSTANTS.MS_PER_MINUTE,
  LOG_TEXT_MAX_LENGTH: FORMAT_CONSTANTS.LOG_TEXT_MAX_LENGTH,
  STDERR_TAIL_MAX_LENGTH: FORMAT_CONSTANTS.STDERR_TAIL_MAX_LENGTH,
  ERROR_DETAIL_MAX_LENGTH: FORMAT_CONSTANTS.ERROR_DETAIL_MAX_LENGTH,
  TASK_SUMMARY_MAX_LENGTH: FORMAT_CONSTANTS.TASK_SUMMARY_MAX_LENGTH,
  GIT_STATUS_PREFIX_LENGTH: GIT_CONSTANTS.GIT_STATUS_PREFIX_LENGTH,
  GIT_STATUS_CODE_LENGTH: GIT_CONSTANTS.GIT_STATUS_CODE_LENGTH,
  CHECK_FAILURE_TAIL_LINES: FORMAT_CONSTANTS.CHECK_FAILURE_TAIL_LINES,
  CHECK_FAILURE_OUTPUT_MAX_LENGTH: FORMAT_CONSTANTS.CHECK_FAILURE_OUTPUT_MAX_LENGTH,
  COMMIT_ERROR_OUTPUT_MAX_LENGTH: FORMAT_CONSTANTS.COMMIT_ERROR_OUTPUT_MAX_LENGTH,
  COMMIT_MESSAGE_MAX_LENGTH: FORMAT_CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH,

  ARGV_START_INDEX: RUNTIME_CONSTANTS.ARGV_START_INDEX,
  DECIMAL_PLACES_USD: FORMAT_CONSTANTS.DECIMAL_PLACES_USD,

  EXIT_CODE_SUCCESS: EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS,
  EXIT_CODE_ERROR: EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR,
  EXIT_CODE_FATAL: EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL,

  TOKEN_PRICE_BASE: BUDGET_CONSTANTS.TOKEN_PRICE_BASE,
  GEMINI_FLASH_INPUT_COST: BUDGET_CONSTANTS.GEMINI_FLASH_INPUT_COST,
  GEMINI_FLASH_OUTPUT_COST: BUDGET_CONSTANTS.GEMINI_FLASH_OUTPUT_COST,
  GEMINI_PRO_INPUT_COST: BUDGET_CONSTANTS.GEMINI_PRO_INPUT_COST,
  GEMINI_PRO_OUTPUT_COST: BUDGET_CONSTANTS.GEMINI_PRO_OUTPUT_COST,

  GRAPHIFY_COMMAND: DIAGRAM_CONSTANTS.GRAPHIFY_COMMAND,
  ARCHIFY_ACTION: DIAGRAM_CONSTANTS.ARCHIFY_ACTION,
  ARCHIFY_DEFAULT_QUALITY: DIAGRAM_CONSTANTS.ARCHIFY_DEFAULT_QUALITY,
  ARCHIFY_DIR_NAME: DIAGRAM_CONSTANTS.ARCHIFY_DIR_NAME,
  ARCHIFY_CANDIDATE_JSON: DIAGRAM_CONSTANTS.ARCHIFY_CANDIDATE_JSON,
  ARCHIFY_CANDIDATE_MD: DIAGRAM_CONSTANTS.ARCHIFY_CANDIDATE_MD,
  ARCHIFY_DEFAULT_TYPE: DIAGRAM_CONSTANTS.ARCHIFY_DEFAULT_TYPE,
  ARCHIFY_EXPLAINER_TYPE: DIAGRAM_CONSTANTS.ARCHIFY_EXPLAINER_TYPE,
  ARCHIFY_FALLBACK_EXT: DIAGRAM_CONSTANTS.ARCHIFY_FALLBACK_EXT,
  DIAGRAM_SYNC_TIMEOUT_MS: DIAGRAM_CONSTANTS.DIAGRAM_SYNC_TIMEOUT_MS,
  DIAGRAM_LOG_TAIL_LINES: DIAGRAM_CONSTANTS.DIAGRAM_LOG_TAIL_LINES,

  GIT_RESET_CMD: GIT_CONSTANTS.GIT_RESET_CMD,
  GIT_CLEAN_CMD: GIT_CONSTANTS.GIT_CLEAN_CMD,
  GIT_HEAD_REF: GIT_CONSTANTS.GIT_HEAD_REF,
  GIT_REV_PARSE_HEAD: GIT_CONSTANTS.GIT_REV_PARSE_HEAD,
  GIT_STATUS_PORCELAIN: GIT_CONSTANTS.GIT_STATUS_PORCELAIN,
  ROLLBACK_ON_FAILURE: RUNTIME_CONSTANTS.ROLLBACK_ON_FAILURE,
  RESILIENT_MODE: RUNTIME_CONSTANTS.RESILIENT_MODE,

  SDD_PRODUCTION_EXTENSIONS: SDD_CONSTANTS.SDD_PRODUCTION_EXTENSIONS,
  SDD_EXEMPT_PATH_SEGMENTS: SDD_CONSTANTS.SDD_EXEMPT_PATH_SEGMENTS,
  SDD_EXEMPT_NAME_PREFIXES: SDD_CONSTANTS.SDD_EXEMPT_NAME_PREFIXES,
  SDD_EXEMPT_NAME_SUFFIXES: SDD_CONSTANTS.SDD_EXEMPT_NAME_SUFFIXES,
  SDD_GATED_TOOLS: SDD_CONSTANTS.SDD_GATED_TOOLS,
  SDD_MIN_REVIEW_DURATION_SECONDS: SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS,
  SDD_MAX_REVIEW_FIX_ROUNDS: SDD_CONSTANTS.SDD_MAX_REVIEW_FIX_ROUNDS,
  SDD_MAX_TASKS_BUDGET: SDD_CONSTANTS.SDD_MAX_TASKS_BUDGET,
  SDD_TASK_CHECK_HEADINGS_MANUAL: SDD_CONSTANTS.SDD_TASK_CHECK_HEADINGS_MANUAL,
  SDD_FRONTEND_EXTENSIONS: SDD_CONSTANTS.SDD_FRONTEND_EXTENSIONS,
  SDD_API_PATH_PATTERNS: SDD_CONSTANTS.SDD_API_PATH_PATTERNS,
  SDD_CONSTITUTION_PATH: SDD_CONSTANTS.SDD_CONSTITUTION_PATH,
  SDD_MIN_KEYWORD_LENGTH: SDD_CONSTANTS.SDD_MIN_KEYWORD_LENGTH,
} as const;

/**
 * Subprocess supervision constants shared by every `ISpawner` implementation.
 */
export const RUNTIME_PROCESS_CONSTANTS = {
  KILL_GRACE_MS: 2_000,
  SIGNAL_EXIT_OFFSET: 128,
  EXIT_CODE_COMMAND_NOT_FOUND: 127,
  DEFAULT_KILL_SIGNAL: "SIGTERM" as const,
  FORCE_KILL_SIGNAL: "SIGKILL" as const,
  POSIX_SHELL: "sh",
  POSIX_SHELL_FLAG: "-c",
  WINDOWS_SHELL: "cmd.exe",
  WINDOWS_SHELL_FLAGS: ["/d", "/s", "/c"] as const,
  WINDOWS_TASKKILL: "taskkill",
  WINDOWS_TASKKILL_FLAGS: ["/T", "/F", "/PID"] as const,
  WINDOWS_DEFAULT_PATHEXT: ".COM;.EXE;.BAT;.CMD",
  WINDOWS_PLATFORM: "win32" as const,
  ERROR_CODE_NOT_FOUND: "ENOENT",
  ERROR_CODE_NO_PROCESS: "ESRCH",
} as const;

/**
 * Engine resilience (retry, backoff, circuit breaker) defaults for `ResilientEngineDecorator`.
 */
export const RESILIENCE_CONSTANTS = {
  DEFAULT_MAX_RETRIES: 2,
  DEFAULT_BASE_DELAY_MS: 1_000,
  DEFAULT_MAX_DELAY_MS: 30_000,
  BACKOFF_FACTOR: 2,
  DEFAULT_FAILURE_THRESHOLD: 5,
  DEFAULT_COOLDOWN_MS: 300_000,
  RETRY_EVENT: "engine_retry",
  CIRCUIT_EVENT: "engine_circuit",
  CIRCUIT_OPEN_REASON: "circuit_open",
} as const;

/**
 * Error categories and token field names recognized by `TelemetryMetricsDecorator`.
 */
export const ENGINE_TELEMETRY_CONSTANTS = {
  ERROR_CATEGORY_PATTERNS: [
    ["circuit_open", /circuit_open/i],
    ["budget", /budget/i],
    ["rate_limit", /rate.?limit|\b429\b|quota|too many requests|resource_exhausted|overloaded/i],
    ["auth", /unauthori[sz]ed|auth|credential|\b40[13]\b|forbidden/i],
    ["timeout", /time(?:d)?\s?out|deadline|\b124\b/i],
  ] as const,
  UNKNOWN_CATEGORY: "unknown",
  PAUSED_CATEGORY: "rate_limit",
  TOKEN_INPUT_KEYS: ["inputTokens", "promptTokens", "input_tokens"] as const,
  TOKEN_OUTPUT_KEYS: ["outputTokens", "completionTokens", "output_tokens"] as const,
  TOKEN_CONTAINER_KEYS: ["usage", "tokens"] as const,
} as const;

/**
 * Prompt assembly bounds and layout for `HarnessInjector`.
 */
export const HARNESS_CONSTANTS = {
  MAX_ARTIFACT_CHARS: 12_000,
  MAX_CONSTITUTION_CHARS: 8_000,
  MAX_REMEDIATION_DIRECTIVES: 5,
  TRUNCATION_MARKER: "\n…[truncated by openspec-cascade harness]",
  ARTIFACT_FILES: ["proposal.md", "design.md", "tasks.md"] as const,
  SPECS_DIR: "specs",
  SPEC_FILENAME: "spec.md",
  CHANGES_DIR: ["openspec", "changes"] as const,
  SECTION_ORDER: ["task", "rules", "remediation", "artifacts", "constitution", "skills", "greptile", "guardrails"] as const,
} as const;

/**
 * V2 pipeline wiring constants (`src/facade/v2_pipeline.ts`).
 */
export const V2_PIPELINE_CONSTANTS = {
  SDD_PROBE_TOOL: "Edit",
  SDD_PROBE_FILE: "src/__cascade_sdd_probe__.ts",
  WORKSPACE_EXCLUDES: [".agents/teamwork/", ".cascade/"] as const,
  STATE_PREFIX: "cascade-v2-",
  DEFAULT_COMMIT_TYPE: "feat",
  CHALLENGE_EXTENSIONS: [".ts", ".tsx", ".js", ".jsx", ".mjs"] as const,
  CHALLENGE_RUNTIME: "bun",
} as const;

/**
 * Self-improvement (telemetry → remediation directives) bounds.
 */
export const SELF_IMPROVER_CONSTANTS = {
  FILE_EXTENSION: ".jsonl",
  DATE_KEY_LENGTH: 10,
  MIN_OCCURRENCES: 2,
  MAX_DIRECTIVES: 5,
  SIGNATURE_MAX_CHARS: 240,
  EXAMPLE_MAX_CHARS: 160,
  DIRECTIVE_ID_LENGTH: 8,
  DIRECTIVE_ID_PREFIX: "SI-",
  CATEGORY_PATTERNS: [
    ["type_error", /\bTS\d{3,5}\b|type error|is not assignable|cannot find name|property .* does not exist/i],
    ["test_failure", /\(fail\)|tests? failed|expect\(|assertion|toBe|toEqual/i],
    ["lint", /eslint|no-magic-numbers|no-explicit-any|lint/i],
    ["timeout", /time(?:d)?\s?out|deadline|\b124\b/i],
    ["rate_limit", /rate.?limit|\b429\b|quota|too many requests/i],
    ["auth", /unauthori[sz]ed|\b40[13]\b|credential|not (?:signed|logged) in/i],
  ] as const,
  UNKNOWN_CATEGORY: "unknown",
  DIRECTIVE_TEMPLATES: {
    type_error: "Run `tsc --noEmit` before finishing and fix every type error; never silence them with `any` or casts.",
    test_failure: "Run the focused tests for the files you touch and make them pass before finishing; do not edit assertions to fit wrong behavior.",
    lint: "Run the linter on touched files; move numeric literals into named constants and type every export.",
    timeout: "Keep commands bounded: avoid watch modes and long-running servers; prefer focused test runs.",
    rate_limit: "Batch tool calls and avoid redundant reads; the engine is hitting provider rate limits.",
    auth: "Authentication failed for an external tool; do not retry blindly — report BLOCKED with the failing command.",
    unknown: "This failure has recurred; read the previous error carefully and change approach instead of repeating it.",
  } as const,
} as const;

/**
 * Bounded pre-PR review/fix loop limits.
 */
export const PRE_PR_CONSTANTS = {
  MAX_ROUNDS: 3,
} as const;

/**
 * Integration subcommands dispatched by `cascade.ts` before regular flag parsing.
 */
export const CLI_COMMAND_CONSTANTS = {
  SUBCOMMANDS: ["doctor", "catalog", "drift", "review", "spec-gate", "lint-tasks"] as const,
  ENGINE_BINARIES: { claude: "claude", opencode: "opencode", antigravity: "agy", jules: "jules" } as const,
  DEFAULT_OWNER_TYPE: "user" as const,
  OWNER_TYPES: ["user", "organization"] as const,
  STATUS_OK: "ok",
  STATUS_WARN: "warn",
  STATUS_FAIL: "fail",
  DEFAULT_REVIEW_ENGINE: "claude",
} as const;

/**
 * EGM spec gate: stages, marker files and the hashed artifacts of an OpenSpec change.
 */
export const SPEC_GATE_CONSTANTS = {
  STAGES: ["review", "drift"] as const,
  STATUSES: ["resolved", "open"] as const,
  FILE_BY_STAGE: { review: "review.md", drift: "drift.md" } as const,
  HASH_ALGORITHM: "sha256",
  HASH_ENCODING: "hex",
  FRONT_MATTER_FENCE: "---",
  KEY_STAGE: "egm",
  KEY_STATUS: "status",
  KEY_HASH: "hash",
  HASHED_TOP_LEVEL_FILES: ["proposal.md", "design.md", "tasks.md"] as const,
  SPECS_DIR: "specs",
  SPEC_FILE_NAME: "spec.md",
  OPENSPEC_DIR: "openspec",
  CHANGES_DIR: "changes",
  ARCHIVE_DIR: "archive",
  ARCHIVE_DATE_PREFIX: /^\d{4}-\d{2}-\d{2}-/,
  REASON_ARCHIVED: "archived",
  REASON_NO_CHANGE_FOLDER: "no change folder",
  ACTION_CHECK: "check",
  ACTION_STAMP: "stamp",
  LINE_BREAK: /\r\n?/g,
  BOM: /^﻿/,
  TRAILING_BLANKS: /[ \t]+$/gm,
  TRAILING_NEWLINES: /\n+$/,
  MARKER_KEYS: ["egm", "status", "hash"] as const,
  TASK_CHECKBOX: /^(\s*-\s*)\[[xX]\]/gm,
  TASK_CHECKBOX_OPEN: "$1[ ]",
} as const;

/**
 * Static checks on a change's tasks.md: code blocks and unchecked tasks without a `Verify:` line.
 */
const MANUAL_STEP_PHRASES: readonly string[] = [
  "manually",
  "manual step",
  "manual steps",
  "by hand",
  "the user must run",
  "the user must approve",
  "the user should run",
  "ask the user",
  "deploy to staging",
  "deploy to production",
  "deploy to prod",
  "check in the console",
  "set in the console",
  "you must run",
  "manualmente",
  "a mano",
  "el usuario debe",
  "pide al usuario",
  "despliega en",
  "desplegar en",
  "revisa en la consola",
  "configura en la consola",
  "ejecuta tú",
];

export const TASKS_LINT_CONSTANTS = {
  FILE_NAME: "tasks.md",
  RULE_NO_CODE_BLOCK: "no-code-block",
  RULE_MISSING_VERIFY: "missing-verify",
  MESSAGE_NO_CODE_BLOCK: "fenced code block; describe the expected outcome and put the command in a Verify: line",
  MESSAGE_MISSING_VERIFY: "unchecked task has no indented Verify: line with text; add one under the task",
  LINE_NUMBER_BASE: 1,
  LINE_BREAK: /\r\n?|\n/,
  BOM: /^﻿/,
  FENCE_OPENER: /^\s*(`{3,}|~{3,})(.*)$/,
  FENCE_CLOSER: /^\s*(`{3,}|~{3,})\s*$/,
  BACKTICK: "`",
  UNCHECKED_TASK: /^- \[ \]/,
  VERIFY_LINE: /^\s+(?:[-*]\s+)?Verify:\s*\S/,
  BLANK_LINE: /^\s*$/,
  INDENTED_LINE: /^\s/,
  CODE_SPAN: /`[^`]*`/g,
  MANUAL_FILE_NAME: "manual.md",
  RULE_MISSING_CHECK: "missing-check",
  RULE_MANUAL_CHECKBOX: "manual-checkbox",
  MESSAGE_MISSING_CHECK: "step has no indented Check: line with text; add one under the step",
  MESSAGE_MANUAL_CHECKBOX: "step has a checkbox; remove it so OpenSpec does not count it as a task",
  MANUAL_STEP_ITEM: /^(?:[-*]|\d+\.)\s+/,
  MANUAL_CHECKBOX: /^(?:[-*]|\d+\.)\s+\[[ xX]\]/,
  CHECK_LINE: /^\s+(?:[-*]\s+)?Check:\s*\S/,
  CHECKBOX_PREFIX: /^\[[ xX]\]\s*/,
  CHECK_PREFIX: /^\s*(?:[-*]\s+)?Check:/,
  RULE_MANUAL_STEP: "manual-step",
  MESSAGE_MANUAL_STEP:
    "task asks for a human action; move it to manual.md or describe the outcome the agent produces (text in backticks is ignored)",
  MANUAL_STEP_PATTERNS: MANUAL_STEP_PHRASES.map(
    (phrase) => new RegExp(`(?<![\\p{L}\\p{N}_])${phrase.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_])`, "iu"),
  ),
  OK_PREFIX: "lint-tasks: ok",
  FATAL_HEADER: "lint-tasks failed; fix these findings before running:",
  USAGE_PREFIX: "USAGE: cascade lint-tasks",
} as const;

/**
 * Adversarial hardening rules (M6): input allowlists and injection guards.
 */
export const HARDENING_CONSTANTS = {
  CHANGE_ID_PATTERN: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  PARENT_SEGMENT: "..",
  SHELL_CONTROL_PATTERN: /[;&|`<>\n\r]|\$\(|\$\{/,
  TRAILING_DOTS_AND_SPACES: /[.\s]+$/,
  TEST_FRAMEWORK_MODULES: ["bun:test", "vitest", "@jest/globals"] as const,
} as const;

/**
 * Project manifest: where helpers (MCP servers, skills, plugins, CLI tools) are recorded and how entries are validated.
 */
export const MANIFEST_CONSTANTS = {
  GLOBAL_DIR: "openspec-cascade",
  GLOBAL_FILE: "manifest.json",
  PROJECT_KEY: "manifest",
  ENTRY_TYPES: ["mcp", "skill", "plugin", "cli"] as const,
  HOSTS: ["claude-code", "opencode"] as const,
  WHEN_TO_USE_MAX_LENGTH: 200,
  PROFILE_PATTERN: /^[A-Za-z0-9._-]+$/,
  CHECK_TIMEOUT_MS: 15000,
  JSON_INDENT: 2,
  KNOWN_CLI_TOOLS: ["rtk", "gh", "aws", "greptile", "opencode", "engram", "codebase-memory-mcp", "openspec", "docker", "bun"] as const,
} as const;

/**
 * How to tell the user to create a change. OpenSpec 2.0 ships skills, not `/opsx` commands;
 * forja installs them globally, so Claude Code invokes `/openspec-propose` and OpenCode `@openspec-propose`.
 */
export const OPENSPEC_PROPOSE_HINT = "/openspec-propose (Claude Code) or @openspec-propose (OpenCode)";
