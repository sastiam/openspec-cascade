import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DirectedAcyclicGraph, DagLevelBatchResolver } from "../../../src/core/dag";
import { createSubagentDispatcher } from "../../../src/core/dispatcher";
import { DynamicEscalationLadder } from "../../../src/core/escalation";
import { LooperFSM } from "../../../src/core/fsm";
import { LOOPER_EVENTS, LOOPER_STATES } from "../../../src/core/fsm_types";
import { VictoryAuditLivelockPrevention } from "../../../src/core/victory_livelock";
import { Gate0MechanicalRunner, GATE0_CONSTANTS } from "../../../src/gates/gate0_qa";
import { Gate1Reviewer } from "../../../src/gates/gate1_review";
import { Gate2Challenger } from "../../../src/gates/gate2_challenger";
import { Gate3Auditor } from "../../../src/gates/gate3_audit";
import { analyzeChangeArtifacts } from "../../../src/sdd/analyze";
import { evaluateSddGate } from "../../../src/sdd/sdd_gate";
import { classifySurfaces } from "../../../src/sdd/surface_verifier";
import { createTempGitRepo, addOpenSpecChange } from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

describe("Tier 3 Combinations: SDD + Gates 0–3 + FSM/DAG/Dispatcher Pipeline", () => {
  test("analyzeChangeArtifacts + classifySurfaces + evaluateSddGate align on a multi-surface change", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    addOpenSpecChange(fixture.repoDir, "multi-surface-change", {
      includeConstitution: true,
      capabilitySlug: "api-ui-sync",
      tasksMarkdown: [
        "## 1. API & UI",
        "",
        "- [ ] 1.1 Implement api-ui-sync controller endpoint and dashboard view",
        "",
      ].join("\n"),
    });

    const analyzeRes = await analyzeChangeArtifacts("multi-surface-change", fixture.repoDir);
    expect(analyzeRes.passed).toBe(true);

    const gateRes = await evaluateSddGate({
      toolName: "Write",
      filePath: join(fixture.repoDir, "src", "api", "users.ts"),
      repoRoot: fixture.repoDir,
    });
    expect(gateRes.allowed).toBe(true);
    expect(gateRes.activeChangeId).toBe("multi-surface-change");

    const surfaces = classifySurfaces([
      "src/api/users.ts",
      "src/components/UsersPanel.tsx",
    ]);
    expect(surfaces.surfaces.backend).toBe(true);
    expect(surfaces.surfaces.frontend).toBe(true);
    expect(surfaces.recommendedChecks).toContain("sdd-verify:api-contract-smoke");
    expect(surfaces.recommendedChecks).toContain("sdd-verify:frontend-render-check");
  });

  test("Gate 0 + Gate 1 + Gate 2 + Gate 3 evaluate a clean temp git repo without workspace leakage", async () => {
    const cleanSource = [
      "export function addNumbers(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "",
    ].join("\n");
    const cleanTest = [
      'import { expect, test } from "bun:test";',
      'import { addNumbers } from "../src/calc";',
      'test("adds numbers", () => { expect(addNumbers(2, 3)).toBe(5); });',
      "",
    ].join("\n");

    const fixture = await createTempGitRepo({
      files: {
        "src/calc.ts": cleanSource,
        "test/calc.test.ts": cleanTest,
      },
    });
    cleanups.push(fixture.cleanup);

    const gate0 = new Gate0MechanicalRunner({
      repoRoot: fixture.repoDir,
      cwd: fixture.repoDir,
      policy: GATE0_CONSTANTS.POLICY_FULL_GATE,
      commands: ["echo gate0-pass"],
      enableLayoutCheck: true,
    });
    const gate0Res = await gate0.run();
    expect(gate0Res.success).toBe(true);

    const cleanDiff = [
      "diff --git a/src/calc.ts b/src/calc.ts",
      "--- a/src/calc.ts",
      "+++ b/src/calc.ts",
      "@@ -0,0 +1,3 @@",
      "+export function addNumbers(a: number, b: number): number {",
      "+  return a + b;",
      "+}",
      "diff --git a/test/calc.test.ts b/test/calc.test.ts",
      "--- a/test/calc.test.ts",
      "+++ b/test/calc.test.ts",
      "@@ -0,0 +1,3 @@",
      '+import { expect, test } from "bun:test";',
      '+import { addNumbers } from "../src/calc";',
      '+test("adds numbers", () => { expect(addNumbers(2, 3)).toBe(5); });',
    ].join("\n");

    const gate1 = new Gate1Reviewer({
      workspaceRoot: fixture.repoDir,
      repoRoot: fixture.repoDir,
      taskId: "E2E-CALC-1",
      diff: cleanDiff,
      targetFiles: ["src/calc.ts", "test/calc.test.ts"],
      autoCleanup: true,
    });
    const boundaries = gate1.verifyBoundaries(["src/calc.ts", "test/calc.test.ts"]);
    expect(boundaries.passed).toBe(true);

    const gate2 = new Gate2Challenger({
      workspaceRoot: fixture.repoDir,
      repoRoot: fixture.repoDir,
      taskId: "E2E-CALC-1",
      autoCleanup: true,
    });
    const gate2Options = gate2.getOptions();
    expect(gate2Options.workspaceRoot).toBe(fixture.repoDir);

    const gate3 = new Gate3Auditor({
      workspaceRoot: fixture.repoDir,
      repoRoot: fixture.repoDir,
      taskId: "E2E-CALC-1",
      baselineSha: fixture.initialSha,
    });
    const layoutInvariant = await gate3.checkLayoutInvariant();
    expect(layoutInvariant.passed).toBe(true);
  });

  test("DirectedAcyclicGraph + DagLevelBatchResolver + LooperFSM + VictoryAuditLivelockPrevention coordinate execution", () => {
    const dag = new DirectedAcyclicGraph<{ label: string }>([
      { id: "T1", data: { label: "Init schema" } },
      { id: "T2", data: { label: "Implement runner" }, dependencies: ["T1"] },
      { id: "T3", data: { label: "Write docs" }, dependencies: ["T1"] },
      { id: "T4", data: { label: "Final verify" }, dependencies: ["T2", "T3"] },
    ]);

    const resolver = new DagLevelBatchResolver(dag);
    const firstBatch = resolver.getNextExecutableBatch();
    expect(firstBatch).toEqual(["T1"]);

    resolver.markInProgress("T1");
    resolver.markCompleted("T1");
    const secondBatch = resolver.getNextExecutableBatch();
    expect(secondBatch).toEqual(["T2", "T3"]);

    const livelock = new VictoryAuditLivelockPrevention({ maxFailures: 2 });
    const fsm = new LooperFSM({
      initialContext: {
        hasActiveDagTasks: true,
      },
      enableStandardGuards: true,
      livelockPrevention: livelock,
    });

    fsm.dispatchSync(LOOPER_EVENTS.EVT_INIT_SUCCESS);
    expect(fsm.state).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

    livelock.recordFailure({ culpritTaskIds: ["T2"], reason: "first audit fail" });
    expect(livelock.isTripped()).toBe(false);
    livelock.recordFailure({ culpritTaskIds: ["T2"], reason: "second audit fail" });
    expect(livelock.isTripped()).toBe(true);
    const triage = livelock.evaluateTriage({ culpritTaskIds: ["T2"], activeTaskCount: 1 });
    expect(triage.event).toBe(LOOPER_EVENTS.EVT_TRIAGE_BLOCKED);
  });

  test("SubagentDispatcher + DynamicEscalationLadder enforce sandboxes and failure routing", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    const dispatcher = createSubagentDispatcher({
      workspaceRoot: fixture.repoDir,
      maxConcurrentAgents: 2,
      autoCleanup: true,
    });

    const worker = await dispatcher.dispatch({
      role: "worker",
      taskId: "E2E-T1",
      taskDescription: "Implement module cleanly",
      targetFiles: ["src/**"],
    });
    expect(worker.role).toBe("worker");
    expect(dispatcher.getActiveAgents().length).toBe(1);

    const ladder = new DynamicEscalationLadder({
      taskId: "E2E-T1",
      baselineSha: fixture.initialSha,
    });

    const classification = ladder.classifyFailure({
      taskId: "E2E-T1",
      failureTrace: "TS2304: TypeScript compilation failed on line 12",
      exitCode: 1,
    });
    expect(classification.category).toBeDefined();

    const routing = ladder.handleFailureWithRouting({
      taskId: "E2E-T1",
      failureTrace: "AssertionError: Unit test assertion mismatch",
      exitCode: 1,
    });
    expect(routing.decision.action).toBeDefined();

    await dispatcher.completeAgent(worker.id);
    expect(dispatcher.getActiveAgents().length).toBe(0);
  });
});
