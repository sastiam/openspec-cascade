/**
 * Pre-PR review bridge: shadow worktree → merge-base diff → content-addressed cache →
 * Greptile CLI review → `verifyReviewFindings` (stale guard + diff match) → prompt context.
 */
import { GREPTILE_CONSTANTS, SDD_CONSTANTS, TIMEOUT_CONSTANTS } from "../../config/constants";
import {
  normalizeReviewPath,
  reviewFilesFromFindings,
  verifyReviewFindings,
  type RawReviewFinding,
  type ReviewVerificationResult,
} from "../../sdd/review_verifier";
import { GreptileCache, sha256, type CacheKeyComponents } from "./cache";
import type { GreptileFinding, IGreptileClient } from "./client";
import { formatGreptileContext } from "./search";
import { ShadowCommitManager } from "./shadow";

export interface CachedReview {
  readonly verification: ReviewVerificationResult;
  readonly findings: readonly GreptileFinding[];
  readonly summary?: string;
  readonly mergeBase: string;
  readonly diffFiles: readonly string[];
}

export interface GreptileBridgeResult extends CachedReview {
  readonly cached: boolean;
  readonly shadowSha: string;
  readonly context: string;
}

export interface GreptileReviewBridgeOptions {
  readonly client: IGreptileClient;
  readonly shadow?: ShadowCommitManager;
  readonly cache?: GreptileCache<CachedReview>;
  readonly tokenBudget?: number;
}

export interface BridgeReviewRequest {
  readonly repoPath: string;
  readonly baseBranch: string;
}

function isCachedReview(value: unknown): value is CachedReview {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.verification === "object" &&
    record.verification !== null &&
    Array.isArray(record.findings) &&
    typeof record.mergeBase === "string" &&
    Array.isArray(record.diffFiles)
  );
}

/**
 * Converts normalized Greptile findings into the verifier's raw finding shape.
 */
export function toRawFindings(findings: readonly GreptileFinding[]): RawReviewFinding[] {
  return findings.map((finding) => ({
    severity: finding.securityIssue ? `${finding.severity} security` : finding.severity,
    file: finding.file,
    line: finding.line,
    message: finding.securityIssue ? `security: ${finding.message}` : finding.message,
  }));
}

export class GreptileReviewBridge {
  private readonly client: IGreptileClient;
  private readonly shadow: ShadowCommitManager;
  private readonly cacheOverride?: GreptileCache<CachedReview>;
  private readonly tokenBudget: number;

  constructor(options: GreptileReviewBridgeOptions) {
    this.client = options.client;
    this.shadow = options.shadow ?? new ShadowCommitManager();
    this.cacheOverride = options.cache;
    this.tokenBudget = options.tokenBudget ?? GREPTILE_CONSTANTS.DEFAULT_TOKEN_BUDGET;
  }

  private cacheFor(repoPath: string): GreptileCache<CachedReview> {
    return (
      this.cacheOverride ??
      new GreptileCache<CachedReview>({
        rootDir: repoPath,
        validate: (value) => (isCachedReview(value) ? value : undefined),
      })
    );
  }

  /**
   * Reviews the current working tree (including uncommitted work) against `baseBranch`.
   */
  async review(request: BridgeReviewRequest): Promise<GreptileBridgeResult> {
    const cache = this.cacheFor(request.repoPath);
    return this.shadow.withShadowWorktree(request.repoPath, async (worktreePath, snapshot) => {
      const diff = await this.shadow.branchDiff(request.repoPath, request.baseBranch, snapshot.sha);
      const diffFiles = diff.files.map(normalizeReviewPath);
      const key: CacheKeyComponents = {
        baseSha: diff.mergeBase,
        diffHash: sha256(diff.patch),
        query: GREPTILE_CONSTANTS.REVIEW_QUERY_KEY,
      };
      const hit = cache.get(key);
      if (hit !== undefined) {
        return { ...hit, cached: true, shadowSha: snapshot.sha, context: formatGreptileContext(hit.findings, this.tokenBudget) };
      }
      if (diffFiles.length === 0) {
        const verification = verifyReviewFindings({
          reviewFiles: [],
          branchDiffFiles: [],
          elapsedSeconds: SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS,
          findings: [],
        });
        return { verification, findings: [], mergeBase: diff.mergeBase, diffFiles, cached: false, shadowSha: snapshot.sha, context: "" };
      }
      const review = await this.client.review({ repoPath: worktreePath, baseBranch: request.baseBranch });
      const rawFindings = toRawFindings(review.findings);
      const verification = verifyReviewFindings({
        reviewFiles: reviewFilesFromFindings(rawFindings),
        branchDiffFiles: diffFiles,
        elapsedSeconds: review.elapsedMs / TIMEOUT_CONSTANTS.MS_PER_SECOND,
        findings: rawFindings,
      });
      const outcome: CachedReview = {
        verification,
        findings: review.findings,
        summary: review.summary,
        mergeBase: diff.mergeBase,
        diffFiles,
      };
      if (verification.valid) {
        cache.set(key, outcome);
      }
      return { ...outcome, cached: false, shadowSha: snapshot.sha, context: formatGreptileContext(review.findings, this.tokenBudget) };
    });
  }
}
