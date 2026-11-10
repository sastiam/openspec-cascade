import { describe, expect, test } from "bun:test";
import {
  triageFinding,
  verifyReviewFindings,
} from "../../src/sdd/review_verifier";

describe("triageFinding", () => {
  test("triages risky security and concurrency findings", () => {
    const finding1 = triageFinding({
      severity: "high",
      file: "src/auth.ts",
      message: "Potential SQL injection vulnerability in query handler",
    });
    expect(finding1.tier).toBe("risky");
    expect(finding1.severity).toBe("high");

    const finding2 = triageFinding({
      severity: "medium",
      file: "src/worker.ts",
      message: "Race condition detected under concurrent access",
    });
    expect(finding2.tier).toBe("risky");
  });

  test("triages mechanical formatting and import findings", () => {
    const finding = triageFinding({
      severity: "low",
      file: "src/utils.ts",
      message: "Unused import detected and missing null check",
    });
    expect(finding.tier).toBe("mechanical");
  });

  test("defaults to advisory for general comments", () => {
    const finding = triageFinding({
      severity: "low",
      file: "src/index.ts",
      message: "Consider extracting this variable for readability",
    });
    expect(finding.tier).toBe("advisory");
  });
});

describe("verifyReviewFindings", () => {
  test("flags reviews completing in under threshold as stale cache hits", () => {
    const result = verifyReviewFindings({
      elapsedSeconds: 4,
      branchDiffFiles: ["src/core/fsm.ts"],
      reviewFiles: ["src/core/fsm.ts"],
      findings: [],
    });

    expect(result.valid).toBe(false);
    expect(result.status).toBe("stale");
    expect(result.reason).toContain("stale cache hit");
  });

  test("detects file set mismatch against branch diff", () => {
    const result = verifyReviewFindings({
      elapsedSeconds: 15,
      branchDiffFiles: ["src/core/fsm.ts"],
      reviewFiles: ["completely/different/repo/file.py"],
      findings: [],
    });

    expect(result.valid).toBe(false);
    expect(result.status).toBe("mismatch");
    expect(result.reason).toContain("do not overlap");
  });

  test("verifies and triages legitimate review findings", () => {
    const result = verifyReviewFindings({
      elapsedSeconds: 22,
      branchDiffFiles: ["src/core/fsm.ts", "src/auth.ts"],
      reviewFiles: ["src/core/fsm.ts"],
      findings: [
        {
          severity: "high",
          file: "src/core/fsm.ts",
          message: "Potential security vulnerability in auth header handling",
        },
        {
          severity: "low",
          file: "src/core/fsm.ts",
          message: "Unused import in module header",
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.blockingFindingsCount).toBe(1);
    expect(result.triagedFindings).toHaveLength(2);
    expect(result.triagedFindings[0]?.tier).toBe("risky");
    expect(result.triagedFindings[1]?.tier).toBe("mechanical");
  });

  test("handles empty branch diff gracefully", () => {
    const result = verifyReviewFindings({
      elapsedSeconds: 15,
      branchDiffFiles: [],
      reviewFiles: [],
      findings: [],
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe("empty");
    expect(result.blockingFindingsCount).toBe(0);
  });
});
