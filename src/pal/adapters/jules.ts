/**
 * Google Jules Provider Adapter (PAL).
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 4 and OpenSpec change
 * `looper-pal-jules-adapter`.
 *
 * Jules is an asynchronous cloud coding agent, not a streaming chat model. This
 * adapter drives the `jules remote` CLI as a subprocess:
 *   - `jules remote new --repo <repo> --session=<prompt> [--parallel <n>]` creates sessions
 *   - `jules remote list --session` polls their status
 *   - `jules remote pull --session <id>` retrieves the result (a unified diff on stdout)
 *
 * The CLI's stdout format is undocumented. All stdout parsing is isolated in the
 * "Stdout parsing" section below; the formats it assumes are noted there.
 */

import {
  PAL_ERROR_KINDS,
  PAL_FINISH_REASONS,
  PAL_PROVIDER_NAMES,
  PAL_ROLES,
  PalError,
  createPalMessage,
  createTextBlock,
  isPalTextContent,
  type PalFinishReason,
  type PalOutcome,
  type PalProviderCapabilities,
  type PalProviderName,
  type PalRateLimitInfo,
  type PalSessionOptions,
  type PalStreamEvent,
  type PalTokenUsage,
  type ProviderAdapter,
} from "../types";

/**
 * Central constants ensuring zero magic numbers across JulesAdapter operations.
 */
export const JULES_ADAPTER_CONSTANTS = {
  // Identity
  DEFAULT_MODEL: "jules",
  DEFAULT_CLI_BIN: "jules",

  // CLI surface (verified against `jules remote --help`)
  CLI_SUBCOMMAND_REMOTE: "remote",
  CLI_ACTION_NEW: "new",
  CLI_ACTION_LIST: "list",
  CLI_ACTION_PULL: "pull",
  CLI_FLAG_REPO: "--repo",
  CLI_FLAG_SESSION: "--session",
  CLI_FLAG_PARALLEL: "--parallel",
  CLI_STDIN_IGNORE: "ignore",
  CLI_PIPE: "pipe",
  EXIT_CODE_SUCCESS: 0,
  INSTALL_HINT: "npm install -g @google/jules",
  LOGIN_HINT: "jules login",

  // Parallelism (verified: `--parallel int  (1-5) (default 1)`)
  DEFAULT_PARALLEL: 1,
  MIN_PARALLEL: 1,
  MAX_PARALLEL: 5,

  // Polling & timeouts (injectable per instance)
  DEFAULT_POLL_INTERVAL_MS: 15_000,
  DEFAULT_POLL_TIMEOUT_MS: 3_600_000,
  DEFAULT_COMMAND_TIMEOUT_MS: 120_000,

  // Stdout parsing (ASSUMED formats, see parser section)
  ANSI_ESCAPE_PATTERN: /\u001b\[[0-9;]*[A-Za-z]/g,
  SESSION_ID_PATTERN: /\b\d{10,}\b/g,
  TABLE_COLUMN_SEPARATOR_PATTERN: /\s{2,}/,
  // A row with a status column: ID, description, repo, last active, status.
  SESSION_ROW_MIN_COLUMNS_WITH_STATUS: 5,
  // A row with an empty status column: ID, description, repo, last active.
  SESSION_ROW_MIN_COLUMNS_WITHOUT_STATUS: 4,
  // Trailing fixed columns after description when a status column is present: repo, last active, status.
  SESSION_ROW_TRAILING_COLUMNS: 3,
  SESSION_ROW_LAST_ACTIVE_OFFSET: 2,
  // Last-active values look like "4m25s ago" or "2 days ago"; a status never ends in "ago".
  SESSION_ROW_LAST_ACTIVE_PATTERN: /\bago$/i,
  SESSION_ROW_ID_PATTERN: /^\d+$/,
  // Shown in thought events in place of an empty status label.
  EMPTY_STATUS_DISPLAY_LABEL: "awaiting input",
  SESSION_URL_BASE: "https://jules.google.com/session/",
  // Exact stdout of `jules remote pull` when the remote VM has no changes (exit 0).
  NO_DIFF_MESSAGE: "No diff found in the remote VM.",
  AUTH_FAILURE_PATTERN:
    /\b(unauthenticated|unauthorized|not logged in|login required|please log ?in|jules login)\b/i,
  STDERR_TAIL_MAX_LENGTH: 400,

  // Remote session status labels (only "Completed" and "In Progress" observed live;
  // the failure labels are ASSUMED). An EMPTY status label means the session is waiting on input.
  STATUS_LABEL_COMPLETED: "completed",
  STATUS_LABEL_FAILED: "failed",
  STATUS_LABEL_CANCELLED: "cancelled",

  // Awaiting-input policy. Default fails fast so polling never hangs until the timeout.
  DEFAULT_AWAITING_INPUT_POLL_LIMIT: 3,
  MIN_AWAITING_INPUT_POLL_LIMIT: 1,

  // Usage & rate limits (not reported by the CLI)
  ZERO_TOKENS: 0,
  NOT_REPORTED: -1,
  NOT_PUBLISHED: 0,

  // Text joining
  SESSION_SECTION_HEADING: "### Jules session",
  PROMPT_SECTION_SEPARATOR: "\n\n",
  PROMPT_LINE_SEPARATOR: "\n",
} as const;

/**
 * Normalized lifecycle state of a remote Jules session.
 */
export const JULES_SESSION_STATES = {
  RUNNING: "running",
  /** Session is blocked on a user response (observed as an empty status column). */
  AWAITING_INPUT: "awaiting_input",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type JulesSessionState =
  (typeof JULES_SESSION_STATES)[keyof typeof JULES_SESSION_STATES];

/**
 * Policies applied when a session stays in AWAITING_INPUT for the configured number of
 * consecutive polls: fail fast with JulesAwaitingInputError, or keep polling until timeout.
 */
export const JULES_AWAITING_INPUT_POLICIES = {
  FAIL: "fail",
  KEEP_WAITING: "keep-waiting",
} as const;

export type JulesAwaitingInputPolicy =
  (typeof JULES_AWAITING_INPUT_POLICIES)[keyof typeof JULES_AWAITING_INPUT_POLICIES];

/**
 * Outcome of `jules remote pull --session <id>`.
 * `empty` means the CLI reported that the remote VM has no changes.
 */
export type JulesPullResult =
  | { status: "diff"; patch: string }
  | { status: "empty" };

/**
 * Structured row parsed from `jules remote list --session`.
 */
export interface JulesSessionRow {
  id: string;
  description: string;
  repo: string;
  lastActive: string;
  status: string;
}

/**
 * Lifecycle transition emitted while polling a session.
 */
export interface JulesSessionTransition {
  sessionId: string;
  rawStatus: string;
  state: JulesSessionState;
}

/**
 * Task request for creating remote Jules sessions.
 */
export interface JulesTaskRequest {
  prompt: string;
  repo?: string;
  parallel?: number;
}

/**
 * Minimal view of a spawned Jules CLI process.
 */
export interface JulesSpawnedProcess {
  stdout:
    | ReadableStream<Uint8Array | string>
    | AsyncIterable<Uint8Array | string>
    | null;
  stderr?:
    | ReadableStream<Uint8Array | string>
    | AsyncIterable<Uint8Array | string>
    | null;
  exited: Promise<number>;
  kill?(signal?: number | string): void;
}

/**
 * Factory signature for spawning the Jules CLI.
 */
export type JulesSubprocessSpawnFn = (
  argv: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    stdin: "ignore";
    stdout: "pipe";
    stderr: "pipe";
  }
) => JulesSpawnedProcess;

/**
 * Options for configuring JulesAdapter.
 */
export interface JulesAdapterOptions {
  modelName?: string;
  /** Repository in `owner/name` form. Defaults to the CLI's current working directory repo. */
  repo?: string;
  cwd?: string;
  cliBin?: string;
  /** Number of parallel sessions created per task (1-5). */
  parallel?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  commandTimeoutMs?: number;
  /** Behaviour when a session is awaiting input. Defaults to "fail". */
  awaitingInputPolicy?: JulesAwaitingInputPolicy;
  /** Consecutive AWAITING_INPUT polls before the policy applies. Defaults to 3. */
  awaitingInputPollLimit?: number;
  spawnFn?: JulesSubprocessSpawnFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Jules CLI binary is not installed or not on PATH.
 */
export class JulesCliNotFoundError extends PalError {
  constructor(cliBin: string, rawError?: unknown) {
    super(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      `Jules CLI "${cliBin}" not found. Install it with: ${JULES_ADAPTER_CONSTANTS.INSTALL_HINT}`,
      false,
      undefined,
      rawError
    );
    this.name = "JulesCliNotFoundError";
  }
}

/**
 * Jules CLI is installed but no Google account is logged in.
 */
export class JulesAuthError extends PalError {
  constructor(stderrTail: string) {
    super(
      PAL_ERROR_KINDS.AUTH_FAILURE,
      `Jules is not authenticated. Run "${JULES_ADAPTER_CONSTANTS.LOGIN_HINT}" first. CLI output: ${stderrTail}`,
      false,
      undefined,
      { stderr: stderrTail }
    );
    this.name = "JulesAuthError";
  }
}

/**
 * Polling exceeded the configured timeout before all sessions reached a terminal state.
 */
export class JulesTimeoutError extends PalError {
  constructor(
    public readonly pendingSessionIds: string[],
    timeoutMs: number
  ) {
    super(
      PAL_ERROR_KINDS.TIMEOUT,
      `Jules sessions [${pendingSessionIds.join(", ")}] did not complete within ${timeoutMs}ms`,
      true
    );
    this.name = "JulesTimeoutError";
  }
}

/**
 * A remote Jules session ended in a failed or cancelled state.
 */
export class JulesSessionFailedError extends PalError {
  constructor(
    public readonly sessionId: string,
    public readonly rawStatus: string
  ) {
    super(
      PAL_ERROR_KINDS.TOOL_ERROR,
      `Jules session ${sessionId} ended with status "${rawStatus}"`,
      false,
      undefined,
      { sessionId, rawStatus }
    );
    this.name = "JulesSessionFailedError";
  }
}

/**
 * A remote Jules session is waiting for a user response and, under the "fail"
 * awaiting-input policy, cannot proceed unattended.
 */
export class JulesAwaitingInputError extends PalError {
  constructor(
    public readonly sessionId: string,
    public readonly consecutivePolls: number
  ) {
    const sessionUrl = `${JULES_ADAPTER_CONSTANTS.SESSION_URL_BASE}${sessionId}`;
    super(
      PAL_ERROR_KINDS.TOOL_ERROR,
      `Jules session ${sessionId} needs user input (awaiting input for ${consecutivePolls} consecutive polls). Respond at ${sessionUrl} and re-run`,
      false,
      undefined,
      { sessionId, consecutivePolls, sessionUrl }
    );
    this.name = "JulesAwaitingInputError";
  }
}

/**
 * Converts an arbitrary thrown value into a PalError, preserving existing PalErrors.
 */
function toPalError(err: unknown): PalError {
  if (err instanceof PalError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new PalError(PAL_ERROR_KINDS.TOOL_ERROR, message, false, undefined, err);
}

/**
 * Detects a spawn failure caused by a missing executable.
 */
function isSpawnNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  if (code === "ENOENT") {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && /ENOENT|not found in \$PATH/i.test(message);
}

/**
 * Validates parallel session count against the CLI bounds.
 */
export function validateJulesParallel(parallel: number): void {
  if (
    !Number.isInteger(parallel) ||
    parallel < JULES_ADAPTER_CONSTANTS.MIN_PARALLEL ||
    parallel > JULES_ADAPTER_CONSTANTS.MAX_PARALLEL
  ) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      `Jules parallel must be an integer between ${JULES_ADAPTER_CONSTANTS.MIN_PARALLEL} and ${JULES_ADAPTER_CONSTANTS.MAX_PARALLEL}, got ${parallel}`,
      false
    );
  }
}

/**
 * Formats canonical PalSessionOptions into the single prompt Jules accepts.
 * Only text blocks are carried over; Jules has no structured message input.
 */
export function formatJulesPrompt(options: PalSessionOptions): string {
  const systemText =
    typeof options.systemPrompt === "string"
      ? options.systemPrompt
      : (options.systemPrompt ?? []).map((part) => part.text).join(
          JULES_ADAPTER_CONSTANTS.PROMPT_LINE_SEPARATOR
        );

  const turns = options.messages
    .map((message) => {
      const text = message.content
        .filter(isPalTextContent)
        .map((block) => block.text)
        .join(JULES_ADAPTER_CONSTANTS.PROMPT_LINE_SEPARATOR);
      return text.trim().length > 0 ? `[${message.role}]\n${text}` : "";
    })
    .filter((section) => section.length > 0);

  const prompt = [systemText, ...turns]
    .filter((section) => section.trim().length > 0)
    .join(JULES_ADAPTER_CONSTANTS.PROMPT_SECTION_SEPARATOR);

  if (prompt.trim().length === 0) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      "Jules requires a non-empty prompt",
      false
    );
  }
  return prompt;
}

/**
 * Validates the consecutive-poll limit for the awaiting-input policy.
 */
export function validateAwaitingInputPollLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < JULES_ADAPTER_CONSTANTS.MIN_AWAITING_INPUT_POLL_LIMIT) {
    throw new PalError(
      PAL_ERROR_KINDS.INVALID_REQUEST,
      `Jules awaitingInputPollLimit must be an integer >= ${JULES_ADAPTER_CONSTANTS.MIN_AWAITING_INPUT_POLL_LIMIT}, got ${limit}`,
      false
    );
  }
}

/**
 * Maps a raw Jules status label to a normalized session state.
 * An empty label means the session is waiting for user input.
 * Unrecognized labels are treated as running so that polling continues until timeout.
 */
export function normalizeJulesStatus(rawStatus: string): JulesSessionState {
  const label = rawStatus.trim().toLowerCase();
  if (label.length === 0) {
    return JULES_SESSION_STATES.AWAITING_INPUT;
  }
  if (label === JULES_ADAPTER_CONSTANTS.STATUS_LABEL_COMPLETED) {
    return JULES_SESSION_STATES.COMPLETED;
  }
  if (
    label === JULES_ADAPTER_CONSTANTS.STATUS_LABEL_FAILED ||
    label === JULES_ADAPTER_CONSTANTS.STATUS_LABEL_CANCELLED
  ) {
    return JULES_SESSION_STATES.FAILED;
  }
  return JULES_SESSION_STATES.RUNNING;
}

/**
 * Classifies CLI stderr output as an authentication failure.
 */
export function isJulesAuthFailure(stderr: string): boolean {
  return JULES_ADAPTER_CONSTANTS.AUTH_FAILURE_PATTERN.test(stderr);
}

/* -------------------------------------------------------------------------- */
/* Stdout parsing                                                             */
/*                                                                            */
/* The CLI's stdout format is undocumented. Everything that interprets CLI    */
/* output lives in this section. Observed (verified with `jules` installed):  */
/*   - `remote list --session`: whitespace-aligned table with the header       */
/*     ID / Description / Repo / Last active / Status, columns separated by    */
/*     2+ spaces, truncated descriptions ending in "…", status values          */
/*     "Completed" and "In Progress". A session waiting on input shows an     */
/*     EMPTY status column, so its row has one column fewer ("…" then          */
/*     "4m25s ago" as the last column).                                       */
/*   - `remote pull --session <id>`: unified diff on stdout (no --apply). When */
/*     the remote VM has no changes it prints "No diff found in the remote VM." */
/*     and exits 0.                                                           */
/* ASSUMED (not yet observed): `remote new` prints the created session IDs as  */
/* numeric tokens of 10+ digits. Failure labels ("Failed", "Cancelled") are    */
/* also assumed.                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Removes ANSI color/style escape sequences from CLI stdout.
 */
function stripAnsi(text: string): string {
  return text.replace(JULES_ADAPTER_CONSTANTS.ANSI_ESCAPE_PATTERN, "");
}

/**
 * Builds one session row from its columns, tolerating an empty status column.
 * When the last column is a relative "last active" value, the status is empty and
 * the row has one column fewer. Returns undefined when the row is too short.
 */
function parseSessionColumns(columns: string[]): JulesSessionRow | undefined {
  const end = columns.length;
  const lastColumn = columns[end - 1] ?? "";
  const hasStatusColumn = !JULES_ADAPTER_CONSTANTS.SESSION_ROW_LAST_ACTIVE_PATTERN.test(lastColumn);
  const minColumns = hasStatusColumn
    ? JULES_ADAPTER_CONSTANTS.SESSION_ROW_MIN_COLUMNS_WITH_STATUS
    : JULES_ADAPTER_CONSTANTS.SESSION_ROW_MIN_COLUMNS_WITHOUT_STATUS;
  if (end < minColumns) {
    return undefined;
  }

  const lastActiveIndex = hasStatusColumn
    ? end - JULES_ADAPTER_CONSTANTS.SESSION_ROW_LAST_ACTIVE_OFFSET
    : end - 1;
  const repoIndex = lastActiveIndex - 1;
  const descriptionEnd = hasStatusColumn
    ? end - JULES_ADAPTER_CONSTANTS.SESSION_ROW_TRAILING_COLUMNS
    : repoIndex;

  return {
    id: columns[0] ?? "",
    description: columns.slice(1, descriptionEnd).join(" "),
    repo: columns[repoIndex] ?? "",
    lastActive: columns[lastActiveIndex] ?? "",
    status: hasStatusColumn ? lastColumn : "",
  };
}

/**
 * Parses stdout of `jules remote list --session` into structured rows.
 * Columns are split on runs of 2+ spaces; descriptions may contain single spaces.
 * The ID is anchored from the left; repo, last active and status are anchored from
 * the right so that a description containing a run of spaces does not shift them.
 * A row with an empty status column yields `status: ""`.
 */
export function parseJulesSessionList(stdout: string): JulesSessionRow[] {
  const rows: JulesSessionRow[] = [];
  for (const rawLine of stripAnsi(stdout).split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const columns = line.split(JULES_ADAPTER_CONSTANTS.TABLE_COLUMN_SEPARATOR_PATTERN);
    if (!JULES_ADAPTER_CONSTANTS.SESSION_ROW_ID_PATTERN.test(columns[0] ?? "")) {
      continue;
    }
    const row = parseSessionColumns(columns);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Classifies stdout of `jules remote pull --session <id>`.
 * Only output that is exactly the "no diff" message (or blank) is an empty result;
 * anything else is passed through unchanged as the patch.
 */
export function parseJulesPullOutput(stdout: string): JulesPullResult {
  const trimmed = stripAnsi(stdout).trim();
  if (
    trimmed.length === 0 ||
    trimmed === JULES_ADAPTER_CONSTANTS.NO_DIFF_MESSAGE
  ) {
    return { status: "empty" };
  }
  return { status: "diff", patch: stdout };
}

/**
 * Extracts the unique session IDs reported by `jules remote new`.
 */
export function parseJulesCreatedSessionIds(stdout: string): string[] {
  const matches = stripAnsi(stdout).match(JULES_ADAPTER_CONSTANTS.SESSION_ID_PATTERN) ?? [];
  return [...new Set(matches)];
}

/* -------------------------------------------------------------------------- */

/**
 * Default subprocess spawn implementation using Bun.spawn.
 */
function defaultBunSpawn(
  argv: string[],
  options: Parameters<JulesSubprocessSpawnFn>[1]
): JulesSpawnedProcess {
  if (typeof Bun !== "undefined" && typeof Bun.spawn === "function") {
    return Bun.spawn(argv, options) as unknown as JulesSpawnedProcess;
  }
  throw new PalError(
    PAL_ERROR_KINDS.INVALID_REQUEST,
    "Bun.spawn is not available in current runtime environment",
    false
  );
}

/**
 * Reads a subprocess stream fully into a UTF-8 string.
 */
async function readStreamText(
  stream: JulesSpawnedProcess["stdout"] | undefined
): Promise<string> {
  if (!stream) {
    return "";
  }
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Default delay implementation.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Provider adapter for the Google Jules remote coding agent (via `jules remote`).
 */
export class JulesAdapter implements ProviderAdapter {
  readonly providerName: PalProviderName = PAL_PROVIDER_NAMES.JULES;
  readonly modelName: string;

  private readonly repo?: string;
  private readonly cwd: string;
  private readonly cliBin: string;
  private readonly parallel: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly awaitingInputPolicy: JulesAwaitingInputPolicy;
  private readonly awaitingInputPollLimit: number;
  private readonly spawnFn: JulesSubprocessSpawnFn;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options?: JulesAdapterOptions) {
    this.modelName = options?.modelName ?? JULES_ADAPTER_CONSTANTS.DEFAULT_MODEL;
    this.repo = options?.repo;
    this.cwd = options?.cwd ?? process.cwd();
    this.cliBin = options?.cliBin ?? JULES_ADAPTER_CONSTANTS.DEFAULT_CLI_BIN;
    this.parallel = options?.parallel ?? JULES_ADAPTER_CONSTANTS.DEFAULT_PARALLEL;
    validateJulesParallel(this.parallel);
    this.pollIntervalMs =
      options?.pollIntervalMs ?? JULES_ADAPTER_CONSTANTS.DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs =
      options?.pollTimeoutMs ?? JULES_ADAPTER_CONSTANTS.DEFAULT_POLL_TIMEOUT_MS;
    this.commandTimeoutMs =
      options?.commandTimeoutMs ?? JULES_ADAPTER_CONSTANTS.DEFAULT_COMMAND_TIMEOUT_MS;
    this.awaitingInputPolicy =
      options?.awaitingInputPolicy ?? JULES_AWAITING_INPUT_POLICIES.FAIL;
    if (
      this.awaitingInputPolicy !== JULES_AWAITING_INPUT_POLICIES.FAIL &&
      this.awaitingInputPolicy !== JULES_AWAITING_INPUT_POLICIES.KEEP_WAITING
    ) {
      throw new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        `Unknown Jules awaitingInputPolicy "${String(this.awaitingInputPolicy)}"`,
        false
      );
    }
    this.awaitingInputPollLimit =
      options?.awaitingInputPollLimit ?? JULES_ADAPTER_CONSTANTS.DEFAULT_AWAITING_INPUT_POLL_LIMIT;
    validateAwaitingInputPollLimit(this.awaitingInputPollLimit);
    this.spawnFn = options?.spawnFn ?? defaultBunSpawn;
    this.now = options?.now ?? Date.now;
    this.sleep = options?.sleep ?? defaultSleep;
  }

  /**
   * Runs `jules remote <args>` and resolves its stdout.
   * Maps missing binary, authentication failure and non-zero exit to typed errors.
   */
  private async runRemoteCommand(args: string[]): Promise<string> {
    const argv = [this.cliBin, JULES_ADAPTER_CONSTANTS.CLI_SUBCOMMAND_REMOTE, ...args];

    let proc: JulesSpawnedProcess;
    try {
      proc = this.spawnFn(argv, {
        cwd: this.cwd,
        env: process.env as Record<string, string | undefined>,
        stdin: JULES_ADAPTER_CONSTANTS.CLI_STDIN_IGNORE,
        stdout: JULES_ADAPTER_CONSTANTS.CLI_PIPE,
        stderr: JULES_ADAPTER_CONSTANTS.CLI_PIPE,
      });
    } catch (spawnErr: unknown) {
      if (isSpawnNotFoundError(spawnErr)) {
        throw new JulesCliNotFoundError(this.cliBin, spawnErr);
      }
      throw new PalError(
        PAL_ERROR_KINDS.TOOL_ERROR,
        `Failed to spawn Jules CLI: ${String(spawnErr)}`,
        false,
        undefined,
        spawnErr
      );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try {
          proc.kill?.("SIGTERM");
        } catch {
          // Process may already have exited.
        }
        reject(
          new PalError(
            PAL_ERROR_KINDS.TIMEOUT,
            `Jules CLI command "${args.join(" ")}" timed out after ${this.commandTimeoutMs}ms`,
            true
          )
        );
      }, this.commandTimeoutMs);
    });

    try {
      const [stdout, stderr, exitCode] = await Promise.race([
        Promise.all([readStreamText(proc.stdout), readStreamText(proc.stderr), proc.exited]),
        timeout,
      ]);

      if (exitCode !== JULES_ADAPTER_CONSTANTS.EXIT_CODE_SUCCESS) {
        const trimmed = stderr.trim();
        if (isJulesAuthFailure(trimmed) || isJulesAuthFailure(stdout)) {
          throw new JulesAuthError(trimmed.slice(-JULES_ADAPTER_CONSTANTS.STDERR_TAIL_MAX_LENGTH));
        }
        throw new PalError(
          PAL_ERROR_KINDS.TOOL_ERROR,
          `Jules CLI exited with code ${exitCode}: ${
            trimmed.slice(-JULES_ADAPTER_CONSTANTS.STDERR_TAIL_MAX_LENGTH) || "no stderr output"
          }`,
          false,
          undefined,
          { exitCode, stderr }
        );
      }
      return stdout;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Creates one or more remote sessions for a task and returns their IDs.
   */
  async createSessions(task: JulesTaskRequest): Promise<string[]> {
    const parallel = task.parallel ?? this.parallel;
    validateJulesParallel(parallel);

    const repo = task.repo ?? this.repo;
    const args: string[] = [JULES_ADAPTER_CONSTANTS.CLI_ACTION_NEW];
    if (repo !== undefined) {
      args.push(`${JULES_ADAPTER_CONSTANTS.CLI_FLAG_REPO}=${repo}`);
    }
    // `=` form keeps the prompt a single argv element even if it begins with "-".
    args.push(`${JULES_ADAPTER_CONSTANTS.CLI_FLAG_SESSION}=${task.prompt}`);
    if (parallel > JULES_ADAPTER_CONSTANTS.MIN_PARALLEL) {
      args.push(JULES_ADAPTER_CONSTANTS.CLI_FLAG_PARALLEL, String(parallel));
    }

    const stdout = await this.runRemoteCommand(args);
    const sessionIds = parseJulesCreatedSessionIds(stdout);
    if (sessionIds.length === 0) {
      throw new PalError(
        PAL_ERROR_KINDS.INVALID_REQUEST,
        "Could not extract a session ID from `jules remote new` output",
        false,
        undefined,
        { stdout }
      );
    }
    return sessionIds;
  }

  /**
   * Lists remote sessions with their raw status labels.
   */
  async listSessions(): Promise<JulesSessionRow[]> {
    const stdout = await this.runRemoteCommand([
      JULES_ADAPTER_CONSTANTS.CLI_ACTION_LIST,
      JULES_ADAPTER_CONSTANTS.CLI_FLAG_SESSION,
    ]);
    return parseJulesSessionList(stdout);
  }

  /**
   * Retrieves the result of a session (unified diff, not applied locally).
   * Resolves to `{ status: "empty" }` when the remote VM has no changes.
   */
  async pullSession(sessionId: string): Promise<JulesPullResult> {
    const stdout = await this.runRemoteCommand([
      JULES_ADAPTER_CONSTANTS.CLI_ACTION_PULL,
      `${JULES_ADAPTER_CONSTANTS.CLI_FLAG_SESSION}=${sessionId}`,
    ]);
    return parseJulesPullOutput(stdout);
  }

  /**
   * Polls the given sessions until all complete, yielding each state transition.
   * Each poll is a single `remote list` call that serves every tracked session.
   * Throws JulesSessionFailedError on the first failed session, JulesTimeoutError
   * when the poll deadline passes with sessions still pending, and (under the default
   * "fail" awaiting-input policy) JulesAwaitingInputError once a session has been
   * AWAITING_INPUT for `awaitingInputPollLimit` consecutive polls.
   */
  async *watchSessions(
    sessionIds: string[],
    abortSignal?: AbortSignal
  ): AsyncIterable<JulesSessionTransition> {
    const deadline = this.now() + this.pollTimeoutMs;
    const pending = new Set(sessionIds);
    const lastState = new Map<string, JulesSessionState>();
    const consecutiveAwaitingPolls = new Map<string, number>();

    while (pending.size > 0) {
      if (abortSignal?.aborted) {
        throw new PalError(
          PAL_ERROR_KINDS.TIMEOUT,
          "Jules polling aborted by caller",
          true
        );
      }

      const rows = await this.listSessions();
      const rowsById = new Map(rows.map((row) => [row.id, row]));

      for (const sessionId of [...pending]) {
        const row = rowsById.get(sessionId);
        if (row === undefined) {
          // Not yet visible in the list; keep waiting. Not an awaiting-input poll.
          consecutiveAwaitingPolls.delete(sessionId);
          continue;
        }
        const state = normalizeJulesStatus(row.status);
        if (lastState.get(sessionId) !== state) {
          lastState.set(sessionId, state);
          yield { sessionId, rawStatus: row.status, state };
        }
        if (state === JULES_SESSION_STATES.COMPLETED) {
          pending.delete(sessionId);
          consecutiveAwaitingPolls.delete(sessionId);
        } else if (state === JULES_SESSION_STATES.FAILED) {
          throw new JulesSessionFailedError(sessionId, row.status);
        } else if (state === JULES_SESSION_STATES.AWAITING_INPUT) {
          const polls = (consecutiveAwaitingPolls.get(sessionId) ?? 0) + 1;
          consecutiveAwaitingPolls.set(sessionId, polls);
          if (
            this.awaitingInputPolicy === JULES_AWAITING_INPUT_POLICIES.FAIL &&
            polls >= this.awaitingInputPollLimit
          ) {
            throw new JulesAwaitingInputError(sessionId, polls);
          }
        } else {
          consecutiveAwaitingPolls.delete(sessionId);
        }
      }

      if (pending.size === 0) {
        break;
      }
      if (this.now() >= deadline) {
        throw new JulesTimeoutError([...pending], this.pollTimeoutMs);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Delegates a prompt to Jules, waits for completion and yields canonical events:
   * thought_delta per status transition, text_delta per pulled diff, thought_delta
   * (and no text) for a session whose pull reports no changes, then turn_complete.
   * Any failure is yielded as a single error event.
   */
  async *streamTurn(options: PalSessionOptions): AsyncIterable<PalStreamEvent> {
    try {
      const prompt = formatJulesPrompt(options);
      const sessionIds = await this.createSessions({ prompt });

      for await (const transition of this.watchSessions(sessionIds, options.abortSignal)) {
        const statusLabel =
          transition.rawStatus.trim().length > 0
            ? transition.rawStatus
            : JULES_ADAPTER_CONSTANTS.EMPTY_STATUS_DISPLAY_LABEL;
        yield {
          type: "thought_delta",
          thought: `Jules session ${transition.sessionId}: ${statusLabel}`,
        };
      }

      for (const sessionId of sessionIds) {
        const pulled = await this.pullSession(sessionId);
        if (pulled.status === "empty") {
          yield {
            type: "thought_delta",
            thought: `Jules session ${sessionId}: completed with no changes to pull`,
          };
          continue;
        }
        const text =
          sessionIds.length > 1
            ? `${JULES_ADAPTER_CONSTANTS.SESSION_SECTION_HEADING} ${sessionId}\n${pulled.patch}`
            : pulled.patch;
        yield { type: "text_delta", text };
      }

      yield {
        type: "turn_complete",
        finishReason: PAL_FINISH_REASONS.STOP,
        usage: this.zeroUsage(),
      };
    } catch (err: unknown) {
      yield { type: "error", error: toPalError(err) };
    }
  }

  /**
   * Runs a turn to completion by consuming streamTurn and aggregating the pulled results.
   */
  async executeTurn(options: PalSessionOptions): Promise<PalOutcome> {
    const textParts: string[] = [];
    let finishReason: PalFinishReason = PAL_FINISH_REASONS.ERROR;
    let usage: PalTokenUsage = this.zeroUsage();

    for await (const event of this.streamTurn(options)) {
      if (event.type === "error") {
        throw event.error;
      }
      if (event.type === "text_delta") {
        textParts.push(event.text);
      }
      if (event.type === "turn_complete") {
        finishReason = event.finishReason;
        usage = event.usage;
      }
    }

    return {
      message: createPalMessage({
        role: PAL_ROLES.ASSISTANT,
        content: [createTextBlock(textParts.join(""))],
      }),
      finishReason,
      usage,
    };
  }

  getCapabilities(): PalProviderCapabilities {
    return {
      providerName: this.providerName,
      modelName: this.modelName,
      maxContextTokens: JULES_ADAPTER_CONSTANTS.NOT_PUBLISHED,
      maxOutputTokens: JULES_ADAPTER_CONSTANTS.NOT_PUBLISHED,
      supportsNativeTools: false,
      // Emits progress and result events only; there is no token-level streaming.
      supportsStreaming: false,
      supportsExtendedThinking: false,
      supportsPromptCaching: false,
    };
  }

  getRateLimitState(): PalRateLimitInfo {
    // The CLI does not expose quota telemetry.
    return {
      requestsRemaining: JULES_ADAPTER_CONSTANTS.NOT_REPORTED,
      requestsLimit: JULES_ADAPTER_CONSTANTS.NOT_REPORTED,
      tokensRemaining: JULES_ADAPTER_CONSTANTS.NOT_REPORTED,
      tokensLimit: JULES_ADAPTER_CONSTANTS.NOT_REPORTED,
      resetsAt: JULES_ADAPTER_CONSTANTS.NOT_REPORTED,
    };
  }

  /**
   * Jules does not report token usage; all counters are zero.
   */
  private zeroUsage(): PalTokenUsage {
    return {
      promptTokens: JULES_ADAPTER_CONSTANTS.ZERO_TOKENS,
      completionTokens: JULES_ADAPTER_CONSTANTS.ZERO_TOKENS,
      totalTokens: JULES_ADAPTER_CONSTANTS.ZERO_TOKENS,
    };
  }
}
