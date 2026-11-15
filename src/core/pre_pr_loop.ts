/**
 * Bounded pre-PR review loop: review → auto-fix mechanical findings → re-review,
 * at most `PRE_PR_CONSTANTS.MAX_ROUNDS` rounds. Risky findings (security, auth,
 * concurrency, data loss, breaking changes) are never auto-fixed: they stop the
 * loop for a human.
 */
import { PRE_PR_CONSTANTS } from "../config/constants";
import type { ReviewFinding, ReviewVerificationResult } from "../sdd/review_verifier";

export type PrePrStatus = "clean" | "needs_human" | "exhausted" | "stale" | "mismatch" | "empty";

export interface PrePrReviewSnapshot {
  readonly verification: ReviewVerificationResult;
}

export interface PrePrReviewSource {
  review(): Promise<PrePrReviewSnapshot>;
}

export type PrePrFixer = (mechanical: readonly ReviewFinding[], round: number) => Promise<void>;

export interface PrePrRoundRecord {
  readonly round: number;
  readonly status: ReviewVerificationResult["status"];
  readonly mechanical: number;
  readonly risky: number;
  readonly advisory: number;
}

export interface PrePrLoopResult {
  readonly status: PrePrStatus;
  readonly rounds: number;
  readonly history: readonly PrePrRoundRecord[];
  readonly findings: readonly ReviewFinding[];
}

export interface PrePrLoopOptions {
  readonly source: PrePrReviewSource;
  readonly fixer: PrePrFixer;
  readonly maxRounds?: number;
  readonly onRound?: (record: PrePrRoundRecord) => void;
}

export class PrePrReviewLoop {
  private readonly source: PrePrReviewSource;
  private readonly fixer: PrePrFixer;
  private readonly maxRounds: number;
  private readonly onRound?: (record: PrePrRoundRecord) => void;

  constructor(options: PrePrLoopOptions) {
    this.source = options.source;
    this.fixer = options.fixer;
    this.maxRounds = Math.max(1, Math.min(options.maxRounds ?? PRE_PR_CONSTANTS.MAX_ROUNDS, PRE_PR_CONSTANTS.MAX_ROUNDS));
    this.onRound = options.onRound;
  }

  /**
   * Effective round budget after clamping the requested value to `[1, MAX_ROUNDS]`.
   */
  get roundBudget(): number {
    return this.maxRounds;
  }

  async run(): Promise<PrePrLoopResult> {
    const history: PrePrRoundRecord[] = [];
    let findings: readonly ReviewFinding[] = [];
    for (let round = 1; round <= this.maxRounds; round++) {
      const { verification } = await this.source.review();
      findings = verification.triagedFindings;
      const mechanical = findings.filter((finding) => finding.tier === "mechanical");
      const risky = findings.filter((finding) => finding.tier === "risky");
      const record: PrePrRoundRecord = {
        round,
        status: verification.status,
        mechanical: mechanical.length,
        risky: risky.length,
        advisory: findings.length - mechanical.length - risky.length,
      };
      history.push(record);
      this.onRound?.(record);
      if (verification.status === "stale" || verification.status === "mismatch" || verification.status === "empty") {
        return { status: verification.status, rounds: round, history, findings };
      }
      if (risky.length > 0) {
        return { status: "needs_human", rounds: round, history, findings };
      }
      if (mechanical.length === 0) {
        return { status: "clean", rounds: round, history, findings };
      }
      if (round === this.maxRounds) {
        break;
      }
      await this.fixer(mechanical, round);
    }
    return { status: "exhausted", rounds: this.maxRounds, history, findings };
  }
}
