/**
 * Greptile CLI v3 client over `ISpawner`.
 *
 * Uses only the documented CLI surface: `greptile review --json [--branch <base>]`,
 * `greptile review status --json [--commit <sha>]`, `greptile whoami` and
 * `greptile --version`. The CLI has no query command, so `query` ranks the findings
 * of a review by relevance to a question.
 */
import { z } from "zod";
import { EXIT_CODE_CONSTANTS, GREPTILE_CONSTANTS } from "../../config/constants";
import { getDefaultSpawner } from "../../runtime/spawner";
import { SpawnError, type ISpawner, type SpawnResult } from "../../runtime/types";

export type GreptileErrorKind =
  | "not_installed"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "invalid_output"
  | "command_failed";

export type GreptileSeverity = keyof typeof GREPTILE_CONSTANTS.SEVERITY_RANK;

export type GreptileReviewState = (typeof GREPTILE_CONSTANTS.REVIEW_STATUS_EXIT_CODES)[keyof typeof GREPTILE_CONSTANTS.REVIEW_STATUS_EXIT_CODES];

export interface GreptileFinding {
  readonly file: string;
  readonly line?: number;
  readonly endLine?: number;
  readonly severity: GreptileSeverity;
  readonly securityIssue: boolean;
  readonly message: string;
}

export interface GreptileReviewResult {
  readonly summary?: string;
  readonly confidence?: number;
  readonly findings: readonly GreptileFinding[];
  readonly elapsedMs: number;
}

export interface GreptileStatus {
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly version?: string;
  readonly detail?: string;
}

export interface GreptileReviewOptions {
  readonly repoPath: string;
  readonly baseBranch?: string;
}

export interface GreptileReviewStatusOptions {
  readonly repoPath: string;
  readonly commit?: string;
}

export interface GreptileReviewStatusResult {
  readonly state: GreptileReviewState | "unknown";
  readonly exitCode: number;
  readonly raw?: unknown;
}

export interface GreptileQueryOptions {
  readonly question: string;
  readonly findings: readonly GreptileFinding[];
  readonly limit?: number;
}

export interface RankedFinding {
  readonly finding: GreptileFinding;
  readonly score: number;
}

export interface IGreptileClient {
  checkStatus(repoPath?: string): Promise<GreptileStatus>;
  review(options: GreptileReviewOptions): Promise<GreptileReviewResult>;
  reviewStatus(options: GreptileReviewStatusOptions): Promise<GreptileReviewStatusResult>;
  query(options: GreptileQueryOptions): Promise<RankedFinding[]>;
}

export class GreptileError extends Error {
  readonly kind: GreptileErrorKind;
  readonly retryable: boolean;
  readonly exitCode?: number;

  constructor(kind: GreptileErrorKind, message: string, exitCode?: number) {
    super(`[greptile:${kind}] ${message}`);
    this.name = "GreptileError";
    this.kind = kind;
    this.retryable = kind === "rate_limit" || kind === "timeout";
    this.exitCode = exitCode;
  }
}

const SeveritySchema = z
  .string()
  .optional()
  .transform((value): GreptileSeverity | undefined => {
    const normalized = value?.trim().toLowerCase();
    if (normalized === undefined) return undefined;
    if (normalized.startsWith("crit")) return "critical";
    if (normalized.startsWith("high") || normalized === "error") return "high";
    if (normalized.startsWith("med") || normalized === "warning") return "medium";
    if (normalized.startsWith("low") || normalized === "info" || normalized === "nit") return "low";
    return undefined;
  });

const ReviewCommentSchema = z
  .object({
    path: z.string().min(1),
    startLine: z.number().int().nonnegative().optional(),
    endLine: z.number().int().nonnegative().optional(),
    severity: SeveritySchema,
    securityIssue: z.boolean().optional(),
    body: z.string(),
  })
  .passthrough();

const ReviewOutputSchema = z
  .object({
    summary: z.string().optional(),
    confidence: z.number().optional(),
    comments: z.array(ReviewCommentSchema).default([]),
  })
  .passthrough();

const DEFAULT_SEVERITY: GreptileSeverity = "medium";
const SECURITY_MINIMUM_SEVERITY: GreptileSeverity = "high";

function raiseSeverity(severity: GreptileSeverity, minimum: GreptileSeverity): GreptileSeverity {
  return GREPTILE_CONSTANTS.SEVERITY_RANK[severity] >= GREPTILE_CONSTANTS.SEVERITY_RANK[minimum] ? severity : minimum;
}

/**
 * Parses `greptile review --json` stdout into normalized findings. Throws `invalid_output` on non-conforming data.
 */
export function parseReviewOutput(stdout: string): Omit<GreptileReviewResult, "elapsedMs"> {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new GreptileError("invalid_output", `review output is not JSON: ${stdout.slice(0, GREPTILE_CONSTANTS.STDERR_TAIL_LENGTH)}`);
  }
  const parsed = ReviewOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new GreptileError("invalid_output", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const findings = parsed.data.comments.map((comment): GreptileFinding => {
    const securityIssue = comment.securityIssue ?? false;
    const baseSeverity = comment.severity ?? DEFAULT_SEVERITY;
    return {
      file: comment.path,
      line: comment.startLine,
      endLine: comment.endLine,
      severity: securityIssue ? raiseSeverity(baseSeverity, SECURITY_MINIMUM_SEVERITY) : baseSeverity,
      securityIssue,
      message: comment.body.trim(),
    };
  });
  return { summary: parsed.data.summary, confidence: parsed.data.confidence, findings };
}

function queryTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((term) => term.length >= GREPTILE_CONSTANTS.QUERY_MIN_TERM_LENGTH),
    ),
  ];
}

/**
 * Ranks findings by term overlap with `question` (path and message), weighted by severity. Zero-score findings are dropped.
 */
export function rankFindings(question: string, findings: readonly GreptileFinding[], limit?: number): RankedFinding[] {
  const terms = queryTerms(question);
  const ranked = findings
    .map((finding) => {
      const haystack = queryTerms(`${finding.file} ${finding.message}`);
      const overlap = terms.filter((term) => haystack.some((word) => word.includes(term) || term.includes(word))).length;
      return { finding, score: overlap * GREPTILE_CONSTANTS.SEVERITY_RANK[finding.severity] };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.finding.file.localeCompare(right.finding.file));
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

/**
 * Classifies a failed CLI invocation into the Greptile error taxonomy.
 */
export function classifyCliFailure(result: SpawnResult, command: string): GreptileError {
  const stderrTail = (result.stderr || result.stdout).trim().slice(-GREPTILE_CONSTANTS.STDERR_TAIL_LENGTH);
  if (result.timedOut) {
    return new GreptileError("timeout", `${command} timed out`, result.exitCode);
  }
  if (GREPTILE_CONSTANTS.AUTH_FAILURE_PATTERN.test(stderrTail)) {
    return new GreptileError("auth", `${command} is not authenticated: ${stderrTail}`, result.exitCode);
  }
  if (GREPTILE_CONSTANTS.RATE_LIMIT_PATTERN.test(stderrTail)) {
    return new GreptileError("rate_limit", `${command} was rate limited: ${stderrTail}`, result.exitCode);
  }
  return new GreptileError("command_failed", `${command} exited ${result.exitCode}: ${stderrTail}`, result.exitCode);
}

export interface GreptileCliClientOptions {
  readonly spawner?: ISpawner;
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly env?: Record<string, string | undefined>;
  readonly now?: () => number;
}

export class GreptileCliClient implements IGreptileClient {
  private readonly spawner: ISpawner;
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;

  constructor(options: GreptileCliClientOptions = {}) {
    this.spawner = options.spawner ?? getDefaultSpawner();
    this.binary = options.binary ?? GREPTILE_CONSTANTS.DEFAULT_BINARY;
    this.timeoutMs = options.timeoutMs ?? GREPTILE_CONSTANTS.DEFAULT_TIMEOUT_MS;
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
  }

  private async invoke(args: readonly string[], cwd: string): Promise<SpawnResult> {
    try {
      return await this.spawner.run([this.binary, ...args], { cwd, env: this.env, timeoutMs: this.timeoutMs });
    } catch (error) {
      if (error instanceof SpawnError) {
        throw new GreptileError("not_installed", `"${this.binary}" is not installed or not on PATH (${error.code})`);
      }
      throw error;
    }
  }

  async checkStatus(repoPath: string = process.cwd()): Promise<GreptileStatus> {
    let version: SpawnResult;
    try {
      version = await this.invoke(GREPTILE_CONSTANTS.VERSION_ARGS, repoPath);
    } catch (error) {
      if (error instanceof GreptileError && error.kind === "not_installed") {
        return { installed: false, authenticated: false, detail: error.message };
      }
      throw error;
    }
    const whoami = await this.invoke(GREPTILE_CONSTANTS.WHOAMI_ARGS, repoPath);
    const authenticated = whoami.exitCode === EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
    return {
      installed: true,
      authenticated,
      version: version.stdout.trim() || undefined,
      detail: (authenticated ? whoami.stdout : whoami.stderr || whoami.stdout).trim() || undefined,
    };
  }

  async review(options: GreptileReviewOptions): Promise<GreptileReviewResult> {
    const args = [
      ...GREPTILE_CONSTANTS.REVIEW_ARGS,
      ...(options.baseBranch === undefined ? [] : [GREPTILE_CONSTANTS.REVIEW_BASE_FLAG, options.baseBranch]),
    ];
    const startedAt = this.now();
    const result = await this.invoke(args, options.repoPath);
    const elapsedMs = this.now() - startedAt;
    if (result.timedOut || result.exitCode !== EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS) {
      throw classifyCliFailure(result, "greptile review");
    }
    return { ...parseReviewOutput(result.stdout), elapsedMs };
  }

  async reviewStatus(options: GreptileReviewStatusOptions): Promise<GreptileReviewStatusResult> {
    const args = [
      ...GREPTILE_CONSTANTS.REVIEW_STATUS_ARGS,
      ...(options.commit === undefined ? [] : [GREPTILE_CONSTANTS.REVIEW_STATUS_COMMIT_FLAG, options.commit]),
    ];
    const result = await this.invoke(args, options.repoPath);
    if (result.timedOut) {
      throw classifyCliFailure(result, "greptile review status");
    }
    const states: Readonly<Record<number, GreptileReviewState>> = GREPTILE_CONSTANTS.REVIEW_STATUS_EXIT_CODES;
    let raw: unknown;
    try {
      raw = result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
    } catch {
      raw = result.stdout.trim();
    }
    return { state: states[result.exitCode] ?? "unknown", exitCode: result.exitCode, raw };
  }

  async query(options: GreptileQueryOptions): Promise<RankedFinding[]> {
    return rankFindings(options.question, options.findings, options.limit);
  }
}
