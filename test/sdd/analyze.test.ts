import { describe, expect, test } from "bun:test";
import {
  analyzeChangeArtifacts,
  extractRequirementsFromSpec,
  extractTasks,
} from "../../src/sdd/analyze";

describe("extractRequirementsFromSpec", () => {
  test("extracts requirement titles accurately", () => {
    const spec = `
# Spec Title

## ADDED Requirements

### Requirement: PreToolUse SDD Gate Enforcement
The system MUST prevent modification...

### Requirement: Cross-Artifact Analyze Gate
The system MUST perform cross-artifact validation...
`;
    const reqs = extractRequirementsFromSpec(spec);
    expect(reqs).toEqual([
      "PreToolUse SDD Gate Enforcement",
      "Cross-Artifact Analyze Gate",
    ]);
  });
});

describe("extractTasks", () => {
  test("extracts both pending and checked tasks", () => {
    const tasks = `
# Tasks
- [ ] 1.1 Implement SDD gate
- [x] 1.2 Implement Analyze gate
`;
    const extracted = extractTasks(tasks);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]).toBe("1.1 Implement SDD gate");
    expect(extracted[1]).toBe("1.2 Implement Analyze gate");
  });
});

describe("analyzeChangeArtifacts", () => {
  test("analyzes cascade-v2-sdd-framework change successfully", async () => {
    const result = await analyzeChangeArtifacts(
      "cascade-v2-sdd-framework",
      process.cwd()
    );
    expect(result.changeId).toBe("cascade-v2-sdd-framework");
    expect(result.passed).toBe(true);
    expect(result.confirmedBlocking).toBe(0);
    expect(result.verdict).toContain("passed Analyze gate");
  });

  test("reports blocking gaps when change artifacts are missing", async () => {
    const result = await analyzeChangeArtifacts("non-existent-change", process.cwd());
    expect(result.passed).toBe(false);
    expect(result.confirmedBlocking).toBeGreaterThan(0);
  });
});
