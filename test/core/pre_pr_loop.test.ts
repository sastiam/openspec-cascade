import { describe, expect, test } from "bun:test";
import { PrePrReviewLoop, type PrePrReviewSnapshot } from "../../src/core/pre_pr_loop";
import { verifyReviewFindings, type RawReviewFinding } from "../../src/sdd/review_verifier";

function snapshot(findings: RawReviewFinding[], elapsedSeconds = 30, diffFiles = ["src/a.ts"]): PrePrReviewSnapshot {
  return {
    verification: verifyReviewFindings({
      reviewFiles: findings.map((finding) => finding.file),
      branchDiffFiles: diffFiles,
      elapsedSeconds,
      findings,
    }),
  };
}

const mechanical: RawReviewFinding = { severity: "low", file: "src/a.ts", line: 3, message: "unused import of fs" };
const risky: RawReviewFinding = { severity: "high", file: "src/a.ts", line: 9, message: "SQL injection in query builder" };

function scripted(...reviews: PrePrReviewSnapshot[]): { review: () => Promise<PrePrReviewSnapshot>; calls: () => number } {
  let index = 0;
  return {
    review: async () => reviews[Math.min(index++, reviews.length - 1)] ?? snapshot([]),
    calls: () => index,
  };
}

describe("PrePrReviewLoop", () => {
  test("fixes mechanical findings then reports clean", async () => {
    const source = scripted(snapshot([mechanical]), snapshot([]));
    const fixed: number[] = [];
    const result = await new PrePrReviewLoop({ source, fixer: async (findings, round) => void fixed.push(findings.length, round) }).run();
    expect(result).toMatchObject({ status: "clean", rounds: 2 });
    expect(fixed).toEqual([1, 1]);
    expect(result.history.map((record) => record.mechanical)).toEqual([1, 0]);
  });

  test("risky findings stop the loop for a human without fixing", async () => {
    let fixerCalls = 0;
    const result = await new PrePrReviewLoop({
      source: scripted(snapshot([mechanical, risky])),
      fixer: async () => void fixerCalls++,
    }).run();
    expect(result.status).toBe("needs_human");
    expect(fixerCalls).toBe(0);
  });

  test("clamps the round budget to three and reports exhausted", async () => {
    const source = scripted(snapshot([mechanical]));
    let fixerCalls = 0;
    const loop = new PrePrReviewLoop({ source, maxRounds: 10, fixer: async () => void fixerCalls++ });
    expect(loop.roundBudget).toBe(3);
    const result = await loop.run();
    expect(result).toMatchObject({ status: "exhausted", rounds: 3 });
    expect(source.calls()).toBe(3);
    expect(fixerCalls).toBe(2);
    expect(new PrePrReviewLoop({ source, maxRounds: 0, fixer: async () => undefined }).roundBudget).toBe(1);
  });

  test("stale, mismatched and empty reviews stop immediately", async () => {
    const noop = async (): Promise<void> => undefined;
    expect((await new PrePrReviewLoop({ source: scripted(snapshot([mechanical], 1)), fixer: noop }).run()).status).toBe("stale");
    expect((await new PrePrReviewLoop({ source: scripted(snapshot([{ ...mechanical, file: "other.ts" }])), fixer: noop }).run()).status).toBe("mismatch");
    expect((await new PrePrReviewLoop({ source: scripted(snapshot([], 30, [])), fixer: noop }).run()).status).toBe("empty");
  });
});
