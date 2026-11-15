import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_CONSTANTS } from "../../src/config/constants";
import { HarnessInjector, type HarnessInput } from "../../src/core/harness_injector";
import { estimateTokens } from "../../src/integration/greptile/search";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

function fixture(options: { hugeDesign?: boolean; constitution?: boolean } = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "cascade-harness-"));
  dirs.push(repo);
  const change = join(repo, "openspec", "changes", "add-greeting");
  mkdirSync(join(change, "specs", "greeting"), { recursive: true });
  mkdirSync(join(change, "specs", "alpha"), { recursive: true });
  writeFileSync(join(change, "proposal.md"), "# Proposal\nAdd a greeting module.\n");
  writeFileSync(join(change, "design.md"), options.hugeDesign ? "D".repeat(HARNESS_CONSTANTS.MAX_ARTIFACT_CHARS + 10) : "# Design\nPure function.\n");
  writeFileSync(join(change, "tasks.md"), "## 1. Build\n- [ ] 1.1 Create greeting\n");
  writeFileSync(join(change, "specs", "greeting", "spec.md"), "### Requirement: Greeting\nThe system MUST greet.\n");
  writeFileSync(join(change, "specs", "alpha", "spec.md"), "### Requirement: Alpha\nThe system MUST be first.\n");
  if (options.constitution !== false) {
    writeFileSync(join(repo, "openspec", "project.md"), "# Constitution\n1. Spec before code.\n");
  }
  return repo;
}

function input(repoRoot: string, extra: Partial<HarnessInput> = {}): HarnessInput {
  return {
    repoRoot,
    changeId: "add-greeting",
    task: { id: "1.1", done: false, text: "Create greeting", section: "1. Build", line: 1 },
    verifyCommands: ["bun test"],
    ...extra,
  };
}

describe("HarnessInjector", () => {
  const injector = new HarnessInjector();

  test("injects task, rules, artifacts (specs sorted) and constitution in a stable order", async () => {
    const repo = fixture();
    const harness = await injector.buildExecutionContext(input(repo));
    expect(harness.sections.map((section) => section.name)).toEqual(["task", "rules", "artifacts", "constitution"]);
    expect(harness.prompt).toContain("Implement ONLY task 1.1");
    expect(harness.prompt).toContain("`bun test`");
    expect(harness.prompt).toContain("Add a greeting module.");
    expect(harness.prompt).toContain("Spec before code.");
    expect(harness.prompt.indexOf("specs/alpha/spec.md")).toBeLessThan(harness.prompt.indexOf("specs/greeting/spec.md"));
    expect(harness.totalTokens).toBe(estimateTokens(harness.prompt));
    expect(harness.sections.every((section) => section.tokens === estimateTokens(section.content))).toBe(true);
  });

  test("optional sections appear only when provided, with bounded remediation directives", async () => {
    const repo = fixture({ constitution: false });
    const directives = Array.from({ length: 8 }, (_, index) => ({
      id: `D${index}`,
      signature: `sig-${index}`,
      directive: `Avoid failure ${index}`,
      occurrences: index,
    }));
    const harness = await injector.buildExecutionContext(
      input(repo, {
        greptileContext: "## Greptile semantic context\n- [high] a.ts — fix",
        remediationDirectives: directives,
        guardrails: { protectedBranches: ["main"], deniedCommands: ["git push"], maxBudgetPerSessionUsd: 5 },
        retryFeedback: "Gate 0 failed: bun test exited 1",
        sectionCommit: true,
      }),
    );
    expect(harness.sections.map((section) => section.name)).toEqual(["task", "rules", "remediation", "artifacts", "greptile", "guardrails"]);
    expect(harness.prompt).toContain("Gate 0 failed: bun test exited 1");
    expect(harness.prompt).toContain("COMMIT_MESSAGE:");
    expect(harness.prompt).toContain("[D7, seen 7x]");
    expect(harness.prompt).not.toContain("[D2, seen 2x]");
    expect(harness.prompt).toContain("Protected branches (never touched): main");
  });

  test("is deterministic and truncates oversized artifacts", async () => {
    const repo = fixture({ hugeDesign: true });
    const first = await injector.buildExecutionContext(input(repo));
    const second = await injector.buildExecutionContext(input(repo));
    expect(first.prompt).toBe(second.prompt);
    expect(first.truncatedArtifacts).toEqual(["openspec/changes/add-greeting/design.md"]);
    expect(first.prompt).toContain(HARNESS_CONSTANTS.TRUNCATION_MARKER.trim());
  });

  test("tolerates a change without artifacts", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cascade-harness-empty-"));
    dirs.push(repo);
    const harness = await injector.buildExecutionContext(input(repo, { verifyCommands: [] }));
    expect(harness.sections.map((section) => section.name)).toEqual(["task", "rules"]);
    expect(harness.prompt).toContain("Run the focused checks");
  });
});
