import { describe, expect, it } from "bun:test";
import { COGNITIVE_ROLES } from "../../src/pal/types";
import { LOOPER_EVENTS } from "../../src/core/fsm_types";
import {
  DynamicEscalationLadder,
  ESCALATION_CONSTANTS,
  ESCALATION_RUNG_DEFINITIONS,
  EscalationBlockedError,
  EscalationError,
  FAILURE_CATEGORIES,
  FAILURE_CLASSIFIER_CONSTANTS,
  FAILURE_ROUTING_TARGETS,
  FAILURE_SEVERITIES,
  FailureClassifier,
  InvalidEscalationStateError,
  InvalidRungTransitionError,
  InvalidSuccessionStateError,
  OrchestratorSuccessionManager,
  SUCCESSION_CONSTANTS,
  SuccessionBoundaryError,
  SuccessionError,
  buildFailureEnrichedPrompt,
  buildRollbackCommand,
  buildRungPromptEnrichment,
  buildSuccessionBriefing,
  classifyFailure,
  createDynamicEscalationLadder,
  createFailureClassifier,
  createOrchestratorSuccessionManager,
  evaluateSuccessionBoundary,
  extractCompilerDiagnostics,
  formatBlockedMarker,
  generateSuccessorOrchestratorId,
  getAllEscalationRungDefinitions,
  getEscalationRungDefinition,
  isForensicAuditRequired,
  isPromptEnrichmentRequired,
  isRetryEligible,
  isWorkingTreeRetainedDirty,
  parseBlockedMarker,
  parseOrchestratorGeneration,
  routeFailure,
  type AuditRequirements,
  type EscalationDecision,
  type EscalationRung,
  type ExtractedCompilerDiagnostic,
  type FailureCategory,
  type FailureClassification,
  type FailureClassifierOptions,
  type FailureClassifierRule,
  type FailureReport,
  type FailureRoutingContext,
  type FailureRoutingDecision,
  type FailureRoutingTarget,
  type FailureSeverity,
  type SuccessionBoundaryEvaluation,
  type SuccessionExecutionResult,
  type SuccessionTriggerReason,
} from "../../src/core/escalation";

describe("Dynamic 6-Rung Escalation Ladder (LOOPER-CORE-004 / Task 1.1)", () => {
  const TEST_TASK_ID = "TASK-TEST-001";
  const TEST_BASELINE_SHA = "a1b2c3d4e5f6";

  describe("Constants & Static Rung Definitions", () => {
    it("defines exactly 6 rungs spanning 1 to 6", () => {
      expect(ESCALATION_CONSTANTS.TOTAL_RUNGS).toBe(6);
      expect(ESCALATION_CONSTANTS.MIN_RUNG).toBe(1);
      expect(ESCALATION_CONSTANTS.MAX_RUNG).toBe(6);
      expect(ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY).toBe(1);
      expect(ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC).toBe(2);
      expect(ESCALATION_CONSTANTS.RUNG_3_EXPLORER_DEEP_DIVE).toBe(3);
      expect(ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT).toBe(4);
      expect(ESCALATION_CONSTANTS.RUNG_5_TASK_REDECOMPOSITION).toBe(5);
      expect(ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION).toBe(6);
    });

    it("enforces attempt limits and zero magic numbers", () => {
      expect(ESCALATION_CONSTANTS.MAX_LOCAL_RETRIES).toBe(2);
      expect(ESCALATION_CONSTANTS.MAX_CHALLENGER_ATTEMPTS).toBe(2);
      expect(ESCALATION_CONSTANTS.MAX_EXPLORER_ATTEMPTS).toBe(1);
      expect(ESCALATION_CONSTANTS.MAX_WORKER_REPLACEMENT_ATTEMPTS).toBe(1);
      expect(ESCALATION_CONSTANTS.MAX_REDECOMPOSITION_ATTEMPTS).toBe(1);
      expect(ESCALATION_CONSTANTS.MAX_SENTINEL_ATTEMPTS).toBe(1);
      expect(ESCALATION_CONSTANTS.MIN_DECOMPOSED_SUBTASKS).toBe(2);
      expect(ESCALATION_CONSTANTS.MAX_DECOMPOSED_SUBTASKS).toBe(3);
    });

    it("defines preserved directories for atomic rollback", () => {
      expect(ESCALATION_CONSTANTS.PRESERVED_PATHS).toContain(".agents/teamwork/");
      expect(ESCALATION_CONSTANTS.PRESERVED_PATHS).toContain("projects/");
      expect(ESCALATION_CONSTANTS.ROLLBACK_CLEAN_COMMAND).toBe(
        "git clean -fd -e .agents/teamwork/ -e projects/"
      );
    });

    it("provides complete definitions for all 6 rungs in order", () => {
      const allDefs = getAllEscalationRungDefinitions();
      expect(allDefs.length).toBe(6);

      const rungs = allDefs.map((d) => d.rung);
      expect(rungs).toEqual([1, 2, 3, 4, 5, 6]);

      // Verify Rung 1: Local Mechanical Retry
      const r1 = getEscalationRungDefinition(1);
      expect(r1.name).toBe("local_retry");
      expect(r1.targetRole).toBe(COGNITIVE_ROLES.WORKER);
      expect(r1.workingTreePolicy).toBe("retain_dirty");
      expect(r1.retainsWorkingTreeDirty).toBe(true);
      expect(r1.requiresAtomicRollback).toBe(false);
      expect(r1.maxAttempts).toBe(2);
      expect(r1.fsmEvent).toBe(LOOPER_EVENTS.EVT_G0_RETRY);

      // Verify Rung 2: Challenger Diagnostic
      const r2 = getEscalationRungDefinition(2);
      expect(r2.name).toBe("challenger_diagnostic");
      expect(r2.targetRole).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(r2.workingTreePolicy).toBe("retain_dirty");
      expect(r2.retainsWorkingTreeDirty).toBe(true);
      expect(r2.requiresAtomicRollback).toBe(false);
      expect(r2.maxAttempts).toBe(2);
      expect(r2.fsmEvent).toBe(LOOPER_EVENTS.EVT_DIAGNOSTIC_RETRY);

      // Verify Rung 3: Explorer Deep Dive
      const r3 = getEscalationRungDefinition(3);
      expect(r3.name).toBe("explorer_deep_dive");
      expect(r3.targetRole).toBe(COGNITIVE_ROLES.EXPLORER);
      expect(r3.workingTreePolicy).toBe("retain_dirty");
      expect(r3.retainsWorkingTreeDirty).toBe(true);
      expect(r3.requiresAtomicRollback).toBe(false);
      expect(r3.maxAttempts).toBe(1);
      expect(r3.fsmEvent).toBe(LOOPER_EVENTS.EVT_ROLLBACK_REQUIRED);

      // Verify Rung 4: Clean Worker Replacement
      const r4 = getEscalationRungDefinition(4);
      expect(r4.name).toBe("clean_worker_replacement");
      expect(r4.targetRole).toBe(COGNITIVE_ROLES.WORKER);
      expect(r4.workingTreePolicy).toBe("atomic_rollback");
      expect(r4.retainsWorkingTreeDirty).toBe(false);
      expect(r4.requiresAtomicRollback).toBe(true);
      expect(r4.maxAttempts).toBe(1);
      expect(r4.fsmEvent).toBe(LOOPER_EVENTS.EVT_ESCALATION_RESOLVED);

      // Verify Rung 5: Task Re-Decomposition
      const r5 = getEscalationRungDefinition(5);
      expect(r5.name).toBe("task_redecomposition");
      expect(r5.targetRole).toBe(COGNITIVE_ROLES.ORCHESTRATOR);
      expect(r5.workingTreePolicy).toBe("atomic_rollback");
      expect(r5.retainsWorkingTreeDirty).toBe(false);
      expect(r5.requiresAtomicRollback).toBe(true);
      expect(r5.maxAttempts).toBe(1);
      expect(r5.fsmEvent).toBe(LOOPER_EVENTS.EVT_REDECOMPOSE_REQUIRED);

      // Verify Rung 6: Sentinel Human Escalation
      const r6 = getEscalationRungDefinition(6);
      expect(r6.name).toBe("sentinel_escalation");
      expect(r6.targetRole).toBe(COGNITIVE_ROLES.SENTINEL);
      expect(r6.workingTreePolicy).toBe("blocked");
      expect(r6.retainsWorkingTreeDirty).toBe(false);
      expect(r6.requiresAtomicRollback).toBe(false);
      expect(r6.maxAttempts).toBe(1);
      expect(r6.fsmEvent).toBe(LOOPER_EVENTS.EVT_ESCALATION_FAILED);
    });

    it("throws on invalid rung requested", () => {
      expect(() => getEscalationRungDefinition(0 as unknown as EscalationRung)).toThrow(
        EscalationError
      );
      expect(() => getEscalationRungDefinition(7 as unknown as EscalationRung)).toThrow(
        EscalationError
      );
    });
  });

  describe("Working Tree Dirty Retention & Atomic Rollback Command", () => {
    it("preserves dirty working tree strictly at Rungs 1, 2, and 3", () => {
      expect(isWorkingTreeRetainedDirty(1)).toBe(true);
      expect(isWorkingTreeRetainedDirty(2)).toBe(true);
      expect(isWorkingTreeRetainedDirty(3)).toBe(true);
      expect(isWorkingTreeRetainedDirty(4)).toBe(false);
      expect(isWorkingTreeRetainedDirty(5)).toBe(false);
      expect(isWorkingTreeRetainedDirty(6)).toBe(false);
    });

    it("formulates certified atomic rollback command preserving agent memory and project assets", () => {
      const command = buildRollbackCommand(TEST_BASELINE_SHA);
      expect(command).toBe(
        `git reset --hard ${TEST_BASELINE_SHA} && git clean -fd -e .agents/teamwork/ -e projects/`
      );
    });

    it("rejects empty or whitespace-only baseline SHA for rollback command", () => {
      expect(() => buildRollbackCommand("")).toThrow(EscalationError);
      expect(() => buildRollbackCommand("   ")).toThrow(EscalationError);
    });
  });

  describe("Blocked Marker Formatting & Parsing", () => {
    it("formats standard BLOCKED markers correctly", () => {
      expect(formatBlockedMarker("Missing required dependency")).toBe(
        "BLOCKED: Missing required dependency"
      );
    });

    it("throws when formatting empty or 'none' blocked reason", () => {
      expect(() => formatBlockedMarker("")).toThrow(EscalationError);
      expect(() => formatBlockedMarker("none")).toThrow(EscalationError);
      expect(() => formatBlockedMarker("  NONE  ")).toThrow(EscalationError);
    });

    it("parses valid BLOCKED markers and rejects 'none'", () => {
      expect(parseBlockedMarker("BLOCKED: Missing API credential")).toBe(
        "Missing API credential"
      );
      expect(parseBlockedMarker("Execution complete.\nBLOCKED: Network timeout\n")).toBe(
        "Network timeout"
      );
      expect(parseBlockedMarker("BLOCKED: none")).toBeUndefined();
      expect(parseBlockedMarker("All tests passing.\nCOMMIT_SUBJECT: done")).toBeUndefined();
      expect(parseBlockedMarker("")).toBeUndefined();
    });
  });

  describe("Prompt Enrichment Builder", () => {
    it("builds detailed prompt enrichment for Rung 1 with traces", () => {
      const enrichment = buildRungPromptEnrichment(1, {
        taskId: TEST_TASK_ID,
        failureTrace: "AssertionError: expected 200 to be 201",
        stdout: "Running test suite...",
        stderr: "FAIL test/api.test.ts",
        attempt: 1,
        maxAttempts: 2,
      });

      expect(enrichment).toContain("## Escalation Rung 1: Local Mechanical Retry");
      expect(enrichment).toContain("**Role**: WORKER");
      expect(enrichment).toContain("AssertionError: expected 200 to be 201");
      expect(enrichment).toContain("Running test suite...");
      expect(enrichment).toContain("FAIL test/api.test.ts");
    });

    it("builds prompt enrichment for Rung 2 injecting reproduction probe", () => {
      const enrichment = buildRungPromptEnrichment(2, {
        taskId: TEST_TASK_ID,
        reproScript: "const broken = true; expect(broken).toBe(false);",
        attempt: 1,
        maxAttempts: 2,
      });

      expect(enrichment).toContain("## Escalation Rung 2: Challenger Diagnostic");
      expect(enrichment).toContain("**Role**: CHALLENGER");
      expect(enrichment).toContain("Minimal Reproduction Probe");
      expect(enrichment).toContain("const broken = true;");
    });

    it("builds prompt enrichment for Rung 4 injecting remediation patch and baseline SHA", () => {
      const enrichment = buildRungPromptEnrichment(4, {
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
        remediationPatch: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new",
        attempt: 1,
        maxAttempts: 1,
      });

      expect(enrichment).toContain("## Escalation Rung 4: Clean Worker Replacement");
      expect(enrichment).toContain(TEST_BASELINE_SHA);
      expect(enrichment).toContain("Explorer Remediation Patch Proposal");
      expect(enrichment).toContain("+new");
    });

    it("builds prompt enrichment for Rung 6 injecting blocked marker", () => {
      const enrichment = buildRungPromptEnrichment(6, {
        taskId: TEST_TASK_ID,
        attempt: 1,
        maxAttempts: 1,
        blockedReason: "External authentication server unreachable",
      });

      expect(enrichment).toContain("## Escalation Rung 6: Sentinel Human Escalation");
      expect(enrichment).toContain("BLOCKED: External authentication server unreachable");
    });
  });

  describe("DynamicEscalationLadder Lifecycle & State Progression", () => {
    it("initializes with valid options and defaults to Rung 1", () => {
      const ladder = createDynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      expect(ladder.taskId).toBe(TEST_TASK_ID);
      expect(ladder.baselineSha).toBe(TEST_BASELINE_SHA);
      expect(ladder.currentRung).toBe(1);
      expect(ladder.currentRungName).toBe("local_retry");
      expect(ladder.currentAttempt).toBe(0);
      expect(ladder.status).toBe("idle");
      expect(ladder.history.length).toBe(0);
      expect(ladder.isWorkingTreeDirtyRetained()).toBe(true);
      expect(ladder.requiresRollback()).toBe(false);
    });

    it("rejects instantiation with invalid task ID or baseline SHA", () => {
      expect(
        () =>
          new DynamicEscalationLadder({
            taskId: "",
            baselineSha: TEST_BASELINE_SHA,
          })
      ).toThrow(EscalationError);

      expect(
        () =>
          new DynamicEscalationLadder({
            taskId: TEST_TASK_ID,
            baselineSha: "",
          })
      ).toThrow(EscalationError);
    });

    it("executes the strict 6-rung failure progression ladder from Rung 1 to Rung 6", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      const transitionEvents: Array<{ fromRung: number; toRung: number }> = [];
      const retryEvents: Array<{ rung: number; attempt: number }> = [];
      let rollbackTriggered = false;
      let blockedEventEmitted = false;

      ladder.on("ladder:rung_transition", (ev) => transitionEvents.push(ev));
      ladder.on("ladder:retry", (ev) => retryEvents.push(ev));
      ladder.on("ladder:rollback", () => {
        rollbackTriggered = true;
      });
      ladder.on("ladder:blocked", () => {
        blockedEventEmitted = true;
      });

      // --- Rung 1: Local Mechanical Retry ---
      // Attempt 1: First failure, stays at Rung 1
      const d1 = ladder.handleFailure("Syntax error on line 42");
      expect(d1.rung).toBe(1);
      expect(d1.action).toBe("retry_current_rung");
      expect(d1.attempt).toBe(1);
      expect(d1.targetRole).toBe(COGNITIVE_ROLES.WORKER);
      expect(d1.workingTreePolicy).toBe("retain_dirty");
      expect(d1.shouldRollback).toBe(false);
      expect(ladder.isWorkingTreeDirtyRetained()).toBe(true);

      // Attempt 2: Second failure, stays at Rung 1 (attempt 2 of 2)
      const d2 = ladder.handleFailure("Type error on line 45");
      expect(d2.rung).toBe(1);
      expect(d2.action).toBe("retry_current_rung");
      expect(d2.attempt).toBe(2);
      expect(d2.shouldRollback).toBe(false);

      // --- Rung 2: Challenger Diagnostic ---
      // Third failure: Max attempts reached at Rung 1; advances to Rung 2!
      const d3 = ladder.handleFailure("Persistent test failure");
      expect(d3.rung).toBe(2);
      expect(d3.rungName).toBe("challenger_diagnostic");
      expect(d3.action).toBe("advance_rung");
      expect(d3.attempt).toBe(1);
      expect(d3.targetRole).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(d3.workingTreePolicy).toBe("retain_dirty");
      expect(d3.shouldRollback).toBe(false);
      expect(ladder.isWorkingTreeDirtyRetained()).toBe(true);

      // Challenger synthesizes minimal reproduction probe
      ladder.attachChallengerReproScript("test('repro', () => { expect(broken).toBe(true); });");
      expect(ladder.challengerReproScript).toContain("test('repro'");

      // Rung 2 attempt 2 (retry with repro probe)
      const d4 = ladder.handleFailure("Repro probe still fails");
      expect(d4.rung).toBe(2);
      expect(d4.action).toBe("retry_current_rung");
      expect(d4.attempt).toBe(2);
      expect(d4.reproScript).toBeDefined();

      // --- Rung 3: Explorer Deep Dive ---
      // Exhausted Rung 2; advances to Rung 3
      const d5 = ladder.handleFailure("Repro still unresolved");
      expect(d5.rung).toBe(3);
      expect(d5.rungName).toBe("explorer_deep_dive");
      expect(d5.action).toBe("advance_rung");
      expect(d5.attempt).toBe(1);
      expect(d5.targetRole).toBe(COGNITIVE_ROLES.EXPLORER);
      expect(d5.workingTreePolicy).toBe("retain_dirty");
      expect(d5.shouldRollback).toBe(false);
      expect(ladder.isWorkingTreeDirtyRetained()).toBe(true);

      // Explorer analyzes root cause and produces remediation patch
      ladder.attachExplorerRemediationPatch("diff --git a/src/app.ts b/src/app.ts\n+fixed code");
      expect(ladder.explorerRemediationPatch).toContain("+fixed code");

      // --- Rung 4: Clean Worker Replacement ---
      // Explorer diagnosis complete; advances to Rung 4
      const d6 = ladder.handleFailure("Explorer finished diagnosis");
      expect(d6.rung).toBe(4);
      expect(d6.rungName).toBe("clean_worker_replacement");
      expect(d6.action).toBe("advance_rung");
      expect(d6.attempt).toBe(1);
      expect(d6.targetRole).toBe(COGNITIVE_ROLES.WORKER);
      expect(d6.workingTreePolicy).toBe("atomic_rollback");
      expect(d6.shouldRollback).toBe(true);
      expect(d6.rollbackCommand).toBe(
        `git reset --hard ${TEST_BASELINE_SHA} && git clean -fd -e .agents/teamwork/ -e projects/`
      );
      expect(d6.remediationPatch).toContain("+fixed code");
      expect(ladder.isWorkingTreeDirtyRetained()).toBe(false);
      expect(ladder.requiresRollback()).toBe(true);
      expect(rollbackTriggered).toBe(true);

      // --- Rung 5: Task Re-Decomposition ---
      // Clean worker replacement failed; advances to Rung 5
      const d7 = ladder.handleFailure("Fresh worker failed to pass gate");
      expect(d7.rung).toBe(5);
      expect(d7.rungName).toBe("task_redecomposition");
      expect(d7.action).toBe("advance_rung");
      expect(d7.attempt).toBe(1);
      expect(d7.targetRole).toBe(COGNITIVE_ROLES.ORCHESTRATOR);
      expect(d7.workingTreePolicy).toBe("atomic_rollback");
      expect(d7.shouldRollback).toBe(true);

      // Orchestrator splits compound task into 2 subtasks in DAG
      const subtasks = ladder.decomposeTask([
        "Subtask A: Implement core parser",
        "Subtask B: Implement CLI adapter",
      ]);
      expect(subtasks.length).toBe(2);
      expect(subtasks[0]!.id).toBe(`${TEST_TASK_ID}.1`);
      expect(subtasks[1]!.id).toBe(`${TEST_TASK_ID}.2`);

      // --- Rung 6: Sentinel Human Escalation ---
      // Decomposition failed or unresolvable blocker; advances to Rung 6
      const d8 = ladder.handleFailure("Cannot safely split dependencies");
      expect(d8.rung).toBe(6);
      expect(d8.rungName).toBe("sentinel_escalation");
      expect(d8.action).toBe("block_task");
      expect(d8.targetRole).toBe(COGNITIVE_ROLES.SENTINEL);
      expect(d8.workingTreePolicy).toBe("blocked");
      expect(d8.shouldRollback).toBe(false);
      expect(d8.blockedReason).toBeDefined();
      expect(ladder.status).toBe("blocked");
      expect(blockedEventEmitted).toBe(true);

      // Subsequent failure throws EscalationBlockedError
      expect(() => ladder.handleFailure("Another failure")).toThrow(EscalationBlockedError);

      // Verify event log: 5 transitions (1->2, 2->3, 3->4, 4->5, 5->6) and 3 retries (2 at Rung 1, 1 at Rung 2)
      expect(transitionEvents.length).toBe(5);
      expect(retryEvents.length).toBe(3);
    });

    it("supports direct advance via advanceToRung", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      const decision = ladder.advanceToRung(3, "Manual promotion to Explorer deep dive");
      expect(decision.rung).toBe(3);
      expect(ladder.currentRung).toBe(3);

      // Backward transitions are rejected
      expect(() => ladder.advanceToRung(2, "Invalid reverse transition")).toThrow(
        InvalidRungTransitionError
      );
      // Same-rung transitions are rejected
      expect(() => ladder.advanceToRung(3, "Invalid self transition")).toThrow(
        InvalidRungTransitionError
      );
    });

    it("supports immediate markBlocked jumping directly to Rung 6", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      const decision = ladder.markBlocked("Missing upstream library");
      expect(decision.rung).toBe(6);
      expect(decision.action).toBe("block_task");
      expect(decision.blockedReason).toBe("Missing upstream library");
      expect(ladder.status).toBe("blocked");
      expect(ladder.blockedReason).toBe("Missing upstream library");
    });

    it("supports marking escalation as resolved", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      ladder.handleFailure("Initial hiccup");
      expect(ladder.status).toBe("in_progress");

      let resolvedEmitted = false;
      ladder.on("ladder:resolved", () => {
        resolvedEmitted = true;
      });

      ladder.resolve("All checks passed on attempt 2");
      expect(ladder.status).toBe("resolved");
      expect(resolvedEmitted).toBe(true);

      // Further failures on resolved ladder are rejected
      expect(() => ladder.handleFailure("New failure")).toThrow(InvalidEscalationStateError);
    });

    it("supports reset to Rung 1 with optional new baseline SHA", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      ladder.handleFailure("Error");
      ladder.attachChallengerReproScript("test script");
      ladder.reset("newsha999");

      expect(ladder.currentRung).toBe(1);
      expect(ladder.currentAttempt).toBe(0);
      expect(ladder.status).toBe("idle");
      expect(ladder.baselineSha).toBe("newsha999");
      expect(ladder.challengerReproScript).toBeUndefined();
    });

    it("serializes and deserializes accurately preserving state and history", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
        activeWorkerId: "agent-worker-101",
      });

      ladder.handleFailure("Failure 1");
      ladder.handleFailure("Failure 2");
      ladder.handleFailure("Failure 3"); // advances to Rung 2
      ladder.attachChallengerReproScript("script contents");

      const serialized = ladder.serialize();
      expect(serialized.taskId).toBe(TEST_TASK_ID);
      expect(serialized.currentRung).toBe(2);
      expect(serialized.activeWorkerId).toBe("agent-worker-101");
      expect(serialized.challengerReproScript).toBe("script contents");
      expect(serialized.history.length).toBe(3);

      const restored = DynamicEscalationLadder.deserialize(serialized);
      expect(restored.taskId).toBe(TEST_TASK_ID);
      expect(restored.currentRung).toBe(2);
      expect(restored.challengerReproScript).toBe("script contents");
      expect(restored.history.length).toBe(3);
      expect(restored.activeWorkerId).toBe("agent-worker-101");
    });
  });
});

describe("Orchestrator Context Succession Engine (LOOPER-CORE-005 / Task 1.2)", () => {
  const TEST_BASELINE_SHA = "b1c2d3e4f5a6";

  describe("Succession Constants & Invariants", () => {
    it("enforces the 16-spawn boundary and 80% token watermark constants", () => {
      expect(SUCCESSION_CONSTANTS.DEFAULT_MAX_SPAWNS).toBe(16);
      expect(SUCCESSION_CONSTANTS.DEFAULT_TOKEN_WATERMARK_PERCENT).toBe(80);
      expect(SUCCESSION_CONSTANTS.DEFAULT_TOKEN_WARNING_PERCENT).toBe(75);
      expect(SUCCESSION_CONSTANTS.DEFAULT_SPAWN_WARNING_OFFSET).toBe(2);
      expect(SUCCESSION_CONSTANTS.INITIAL_GENERATION).toBe(1);
      expect(SUCCESSION_CONSTANTS.INITIAL_SPAWN_COUNT).toBe(0);
      expect(SUCCESSION_CONSTANTS.INITIAL_TOKEN_UTILIZATION).toBe(0);
      expect(SUCCESSION_CONSTANTS.SPAWN_INCREMENT).toBe(1);
    });

    it("defines canonical naming conventions and trigger reasons", () => {
      expect(SUCCESSION_CONSTANTS.DEFAULT_ORCHESTRATOR_PREFIX).toBe("teamwork_preview_orchestrator_");
      expect(SUCCESSION_CONSTANTS.INITIAL_ORCHESTRATOR_ID).toBe("teamwork_preview_orchestrator_1");
      expect(SUCCESSION_CONSTANTS.REASON_SPAWN_LIMIT).toBe("SPAWN_LIMIT_REACHED");
      expect(SUCCESSION_CONSTANTS.REASON_TOKEN_WATERMARK).toBe("TOKEN_WATERMARK_80");
      expect(SUCCESSION_CONSTANTS.REASON_MANUAL).toBe("MANUAL_SUCCESSION");
    });

    it("defines succession lifecycle states and event names", () => {
      expect(SUCCESSION_CONSTANTS.STATUS_ACTIVE).toBe("active");
      expect(SUCCESSION_CONSTANTS.STATUS_PAUSED).toBe("paused");
      expect(SUCCESSION_CONSTANTS.STATUS_HANDING_OVER).toBe("handing_over");
      expect(SUCCESSION_CONSTANTS.STATUS_SUCCEEDED).toBe("succeeded");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_LIMIT_REACHED).toBe("succession:limit_reached");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_WARNING).toBe("succession:warning");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_TOKEN_WATERMARK).toBe("succession:token_watermark_reached");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_PAUSED).toBe("succession:paused");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_RESUMED).toBe("succession:resumed");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_HANDOVER_STARTED).toBe("succession:handover_started");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_COMPLETED).toBe("succession:completed");
      expect(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_MID_EXECUTION).toBe("succession:mid_execution_triggered");
    });

    it("provides custom error classes for succession boundaries and state transitions", () => {
      const err = new InvalidSuccessionStateError("invalid state", "active");
      expect(err).toBeInstanceOf(SuccessionError);
      expect(err).toBeInstanceOf(EscalationError);
      expect(err.name).toBe("InvalidSuccessionStateError");
      expect(err.message).toBe("invalid state");
      expect(err.currentStatus).toBe("active");

      const boundaryErr = new SuccessionBoundaryError("boundary exceeded", 16, 16);
      expect(boundaryErr).toBeInstanceOf(SuccessionError);
      expect(boundaryErr.name).toBe("SuccessionBoundaryError");
      expect(boundaryErr.spawnCount).toBe(16);
      expect(boundaryErr.maxSpawns).toBe(16);
    });
  });

  describe("Orchestrator ID & Generation Helpers", () => {
    it("generates sequential successor orchestrator IDs", () => {
      expect(generateSuccessorOrchestratorId("teamwork_preview_orchestrator_1")).toBe(
        "teamwork_preview_orchestrator_2"
      );
      expect(generateSuccessorOrchestratorId("teamwork_preview_orchestrator_2")).toBe(
        "teamwork_preview_orchestrator_3"
      );
      expect(generateSuccessorOrchestratorId("teamwork_preview_orchestrator_16")).toBe(
        "teamwork_preview_orchestrator_17"
      );
      expect(generateSuccessorOrchestratorId("orchestrator_9")).toBe("orchestrator_10");
      expect(generateSuccessorOrchestratorId("custom_orchestrator")).toBe("custom_orchestrator_2");
      expect(generateSuccessorOrchestratorId("")).toBe("teamwork_preview_orchestrator_1");
    });

    it("parses generation index correctly", () => {
      expect(parseOrchestratorGeneration("teamwork_preview_orchestrator_1")).toBe(1);
      expect(parseOrchestratorGeneration("teamwork_preview_orchestrator_16")).toBe(16);
      expect(parseOrchestratorGeneration("orchestrator_42")).toBe(42);
      expect(parseOrchestratorGeneration("orchestrator_no_num")).toBe(1);
      expect(parseOrchestratorGeneration("")).toBe(1);
    });
  });

  describe("Boundary Evaluation Pure Helper (evaluateSuccessionBoundary)", () => {
    it("evaluates safe operating conditions within bounds", () => {
      const evaluation = evaluateSuccessionBoundary({
        spawnCount: 0,
        tokenUtilizationPercent: 0,
      });

      expect(evaluation.isSuccessionRequired).toBe(false);
      expect(evaluation.isApproachingLimit).toBe(false);
      expect(evaluation.reason).toBeUndefined();
      expect(evaluation.spawnCount).toBe(0);
      expect(evaluation.maxSpawns).toBe(16);
      expect(evaluation.remainingSpawns).toBe(16);
      expect(evaluation.tokenUtilizationPercent).toBe(0);
      expect(evaluation.explanation).toContain("Operating within safe limits");
    });

    it("flags approaching boundary warning at 14 spawns (16 - 2)", () => {
      const evaluation = evaluateSuccessionBoundary({
        spawnCount: 14,
        tokenUtilizationPercent: 50,
      });

      expect(evaluation.isSuccessionRequired).toBe(false);
      expect(evaluation.isApproachingLimit).toBe(true);
      expect(evaluation.remainingSpawns).toBe(2);
      expect(evaluation.explanation).toContain("Approaching succession boundary");
    });

    it("flags approaching boundary warning at 75% token utilization", () => {
      const evaluation = evaluateSuccessionBoundary({
        spawnCount: 5,
        tokenUtilizationPercent: 75,
      });

      expect(evaluation.isSuccessionRequired).toBe(false);
      expect(evaluation.isApproachingLimit).toBe(true);
      expect(evaluation.explanation).toContain("Approaching succession boundary");
    });

    it("triggers succession requirement when reaching exactly 16 spawns", () => {
      const evaluation = evaluateSuccessionBoundary({
        spawnCount: 16,
        tokenUtilizationPercent: 50,
      });

      expect(evaluation.isSuccessionRequired).toBe(true);
      expect(evaluation.reason).toBe("SPAWN_LIMIT_REACHED");
      expect(evaluation.remainingSpawns).toBe(0);
      expect(evaluation.explanation).toContain("Spawn limit reached (16/16 spawns)");
    });

    it("triggers succession requirement when reaching 80% token watermark", () => {
      const evaluation = evaluateSuccessionBoundary({
        spawnCount: 8,
        tokenUtilizationPercent: 80,
      });

      expect(evaluation.isSuccessionRequired).toBe(true);
      expect(evaluation.reason).toBe("TOKEN_WATERMARK_80");
      expect(evaluation.explanation).toContain("Token watermark threshold reached (80% >= 80%)");
    });

    it("prioritizes spawn limit reason when both boundaries are reached", () => {
      const evaluation = evaluateSuccessionBoundary({
        spawnCount: 16,
        tokenUtilizationPercent: 85,
      });

      expect(evaluation.isSuccessionRequired).toBe(true);
      expect(evaluation.reason).toBe("SPAWN_LIMIT_REACHED");
    });
  });

  describe("Successor BRIEFING Builder (buildSuccessionBriefing)", () => {
    it("constructs compliant BRIEFING.md with append-only 🔒 sections", () => {
      const briefing = buildSuccessionBriefing({
        orchestratorId: "teamwork_preview_orchestrator_2",
        generation: 2,
        predecessorId: "teamwork_preview_orchestrator_1",
        handoffReportPath: "handoff.md",
        maxSpawns: 16,
        activeTasks: ["TASK-002"],
        completedTasks: ["TASK-001"],
      });

      expect(briefing).toContain("# BRIEFING: Orchestrator Context Succession (Generation 2)");
      expect(briefing).toContain("## 🔒 My Identity");
      expect(briefing).toContain("- **Agent ID**: `teamwork_preview_orchestrator_2`");
      expect(briefing).toContain("- **Role**: Orchestrator");
      expect(briefing).toContain("- **Generation**: 2");
      expect(briefing).toContain("- **Predecessor**: `teamwork_preview_orchestrator_1`");
      expect(briefing).toContain("## 🔒 Key Constraints");
      expect(briefing).toContain("- **Spawn Limit**: 16 subagent dispatches per orchestrator lifetime.");
      expect(briefing).toContain("- **16-Spawn Rule**: Automatic context succession triggered at 16 spawns");
      expect(briefing).toContain("## Orchestration State & Succession Telemetry");
      expect(briefing).toContain("- **Spawn Counter**: 0 / 16 (Reset for new generation)");
      expect(briefing).toContain("- **Predecessor Soft Handoff**: `handoff.md`");
      expect(briefing).toContain("- **Active Tasks**: 1");
      expect(briefing).toContain("- **Completed Tasks**: 1");
    });
  });

  describe("OrchestratorSuccessionManager Lifecycle & Telemetry", () => {
    it("initializes with default options at Generation 1", () => {
      const manager = createOrchestratorSuccessionManager();

      expect(manager.currentOrchestratorId).toBe("teamwork_preview_orchestrator_1");
      expect(manager.generation).toBe(1);
      expect(manager.spawnCount).toBe(0);
      expect(manager.maxSpawns).toBe(16);
      expect(manager.tokenUtilizationPercent).toBe(0);
      expect(manager.tokenWatermarkPercent).toBe(80);
      expect(manager.status).toBe("active");
      expect(manager.isDispatchesPaused).toBe(false);
      expect(manager.isSuccessionRequired()).toBe(false);
      expect(manager.history.length).toBe(0);
    });

    it("tracks subagent spawns and fires warning when approaching limit", () => {
      const manager = new OrchestratorSuccessionManager();
      let warningEmitted = false;

      manager.on(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_WARNING, (data) => {
        warningEmitted = true;
        expect(data.spawnCount).toBe(14);
        expect(data.remainingSpawns).toBe(2);
      });

      for (let i = 1; i <= 13; i++) {
        manager.recordSpawn();
        expect(manager.isDispatchesPaused).toBe(false);
        expect(manager.isSuccessionRequired()).toBe(false);
      }

      expect(warningEmitted).toBe(false);
      manager.recordSpawn(); // 14th spawn -> warning
      expect(warningEmitted).toBe(true);
      expect(manager.spawnCount).toBe(14);
      expect(manager.isSuccessionRequired()).toBe(false);
    });

    it("pauses dispatches and emits succession events upon reaching 16 spawns", () => {
      const manager = new OrchestratorSuccessionManager();
      let limitReachedEvent: unknown = undefined;
      let dispatchesPausedEvent: unknown = undefined;

      manager.on(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_LIMIT_REACHED, (evt) => {
        limitReachedEvent = evt;
      });
      manager.on(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_PAUSED, (evt) => {
        dispatchesPausedEvent = evt;
      });

      for (let i = 1; i <= 15; i++) {
        manager.recordSpawn();
      }
      expect(manager.isDispatchesPaused).toBe(false);
      expect(manager.status).toBe("active");

      // 16th spawn triggers succession boundary
      manager.recordSpawn();

      expect(manager.spawnCount).toBe(16);
      expect(manager.isSuccessionRequired()).toBe(true);
      expect(manager.isDispatchesPaused).toBe(true);
      expect(manager.status).toBe("paused");
      expect(limitReachedEvent).toBeDefined();
      expect(dispatchesPausedEvent).toBeDefined();

      // Attempting to resume dispatches while at limit must throw
      expect(() => manager.resumeDispatches()).toThrow(SuccessionBoundaryError);
    });

    it("tracks token window watermark and triggers succession at 80%", () => {
      const manager = new OrchestratorSuccessionManager();
      let tokenWatermarkEvent: unknown = undefined;

      manager.on(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_TOKEN_WATERMARK, (evt) => {
        tokenWatermarkEvent = evt;
      });

      manager.updateTokenUtilization(50);
      expect(manager.isSuccessionRequired()).toBe(false);

      manager.updateTokenUtilization(80);
      expect(manager.isSuccessionRequired()).toBe(true);
      expect(manager.isDispatchesPaused).toBe(true);
      expect(manager.status).toBe("paused");
      expect(tokenWatermarkEvent).toBeDefined();

      // Validates range checks on token utilization percent
      expect(() => manager.updateTokenUtilization(-1)).toThrow(SuccessionError);
      expect(() => manager.updateTokenUtilization(101)).toThrow(SuccessionError);
    });

    it("allows manual pause and resume when within safe limits", () => {
      const manager = new OrchestratorSuccessionManager();
      manager.recordSpawn(); // 1 spawn

      manager.pauseDispatches();
      expect(manager.isDispatchesPaused).toBe(true);
      expect(manager.status).toBe("paused");

      manager.resumeDispatches();
      expect(manager.isDispatchesPaused).toBe(false);
      expect(manager.status).toBe("active");
    });
  });

  describe("Standard Boundary Succession Execution (executeSuccession)", () => {
    it("Scenario: Orchestrator reaches 16 spawns, rotates to successor, and preserves snapshot", () => {
      const manager = new OrchestratorSuccessionManager({
        currentOrchestratorId: "teamwork_preview_orchestrator_1",
      });

      for (let i = 1; i <= 16; i++) {
        manager.recordSpawn();
      }
      expect(manager.isSuccessionRequired()).toBe(true);

      let handoverStarted = false;
      let handoverCompleted = false;

      manager.on(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_HANDOVER_STARTED, (evt) => {
        handoverStarted = true;
        expect(evt.predecessorId).toBe("teamwork_preview_orchestrator_1");
        expect(evt.successorId).toBe("teamwork_preview_orchestrator_2");
      });

      manager.on(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_COMPLETED, (evt: SuccessionExecutionResult) => {
        handoverCompleted = true;
        expect(evt.fsmEvent).toBe(LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE);
      });

      const result = manager.executeSuccession({
        activeTasks: ["TASK-003"],
        completedTasks: ["TASK-001", "TASK-002"],
        customNotes: "Completed milestone 1.",
      });

      expect(handoverStarted).toBe(true);
      expect(handoverCompleted).toBe(true);

      // Verify result payload
      expect(result.predecessorId).toBe("teamwork_preview_orchestrator_1");
      expect(result.successorId).toBe("teamwork_preview_orchestrator_2");
      expect(result.predecessorGeneration).toBe(1);
      expect(result.successorGeneration).toBe(2);
      expect(result.spawnCountAtHandover).toBe(16);
      expect(result.reason).toBe("SPAWN_LIMIT_REACHED");
      expect(result.isMidExecution).toBe(false);
      expect(result.fsmEvent).toBe(LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE);

      // Verify snapshot properties
      expect(result.snapshot.predecessorAgentId).toBe("teamwork_preview_orchestrator_1");
      expect(result.snapshot.successorAgentId).toBe("teamwork_preview_orchestrator_2");
      expect(result.snapshot.spawnCount).toBe(16);
      expect(result.snapshot.activeTasks).toEqual(["TASK-003"]);
      expect(result.snapshot.completedTasks).toEqual(["TASK-001", "TASK-002"]);
      expect(result.snapshot.handoffPayload.handoffType).toBe("soft");

      // Verify successor has cleanly assumed control
      expect(manager.currentOrchestratorId).toBe("teamwork_preview_orchestrator_2");
      expect(manager.generation).toBe(2);
      expect(manager.spawnCount).toBe(0); // Reset for new generation!
      expect(manager.tokenUtilizationPercent).toBe(0);
      expect(manager.isDispatchesPaused).toBe(false);
      expect(manager.status).toBe("active");
      expect(manager.isSuccessionRequired()).toBe(false);
      expect(manager.history.length).toBe(1);
    });

    it("resets manager state completely via reset()", () => {
      const manager = new OrchestratorSuccessionManager();
      for (let i = 0; i < 5; i++) {
        manager.recordSpawn();
      }
      manager.executeSuccession();

      expect(manager.generation).toBe(2);
      expect(manager.history.length).toBe(1);

      manager.reset("teamwork_preview_orchestrator_1");
      expect(manager.currentOrchestratorId).toBe("teamwork_preview_orchestrator_1");
      expect(manager.generation).toBe(1);
      expect(manager.spawnCount).toBe(0);
      expect(manager.history.length).toBe(0);
      expect(manager.status).toBe("active");
    });
  });

  describe("Mid-Execution Succession Protection Invariant (executeMidExecutionSuccession)", () => {
    it("executes emergency mid-execution succession with stashed diff and atomic rollback", () => {
      const manager = new OrchestratorSuccessionManager({
        currentOrchestratorId: "teamwork_preview_orchestrator_1",
      });

      // 8 spawns executed, but token consumption hits 80% watermark during worker execution
      for (let i = 0; i < 8; i++) {
        manager.recordSpawn();
      }
      manager.updateTokenUtilization(82);

      let midExecutionTriggered = false;
      manager.on(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_MID_EXECUTION, (evt) => {
        midExecutionTriggered = true;
        expect(evt.activeWorkerId).toBe("worker_m1_1");
        expect(evt.baselineSha).toBe(TEST_BASELINE_SHA);
        expect(evt.stashedSha).toBe("stash@{0}:abc1234");
      });

      const result = manager.executeMidExecutionSuccession({
        activeWorkerId: "worker_m1_1",
        baselineSha: TEST_BASELINE_SHA,
        stashedSha: "stash@{0}:abc1234",
        activeTasks: ["TASK-004"],
        completedTasks: ["TASK-001", "TASK-002", "TASK-003"],
        customNotes: "Worker paused at 82% token watermark mid-run.",
      });

      expect(midExecutionTriggered).toBe(true);
      expect(result.isMidExecution).toBe(true);
      expect(result.stashedSha).toBe("stash@{0}:abc1234");
      expect(result.rollbackCommand).toBe(
        `git reset --hard ${TEST_BASELINE_SHA} && git clean -fd -e .agents/teamwork/ -e projects/`
      );
      expect(result.reason).toBe("TOKEN_WATERMARK_80");
      expect(result.snapshot.stashedSha).toBe("stash@{0}:abc1234");

      // Verify successor has cleanly assumed control
      expect(manager.currentOrchestratorId).toBe("teamwork_preview_orchestrator_2");
      expect(manager.generation).toBe(2);
      expect(manager.spawnCount).toBe(0);
      expect(manager.isDispatchesPaused).toBe(false);
      expect(manager.status).toBe("active");
    });

    it("rejects mid-execution succession without activeWorkerId or baselineSha", () => {
      const manager = new OrchestratorSuccessionManager();

      expect(() =>
        manager.executeMidExecutionSuccession({
          activeWorkerId: "",
          baselineSha: TEST_BASELINE_SHA,
        })
      ).toThrow(SuccessionError);

      expect(() =>
        manager.executeMidExecutionSuccession({
          activeWorkerId: "worker_1",
          baselineSha: "",
        })
      ).toThrow(SuccessionError);
    });
  });

  describe("DynamicEscalationLadder Integration with Succession", () => {
    it("attaches succession manager to DynamicEscalationLadder options and accessors", () => {
      const successionManager = createOrchestratorSuccessionManager();
      const ladder = new DynamicEscalationLadder({
        taskId: "TASK-LADDER-001",
        baselineSha: TEST_BASELINE_SHA,
        successionManager,
      });

      expect(ladder.successionManager).toBe(successionManager);

      const anotherManager = createOrchestratorSuccessionManager({
        currentOrchestratorId: "teamwork_preview_orchestrator_3",
      });
      ladder.successionManager = anotherManager;
      expect(ladder.successionManager).toBe(anotherManager);
    });
  });
});

describe("Failure Classifier Routing Engine (LOOPER-CORE-004 / Task 1.3)", () => {
  const TEST_TASK_ID = "TASK-CLASSIFIER-001";
  const TEST_BASELINE_SHA = "c1d2e3f4a5b6";

  describe("Constants & Classification Taxonomy", () => {
    it("defines exactly 3 canonical routing targets", () => {
      expect(FAILURE_ROUTING_TARGETS.RETRY).toBe("retry");
      expect(FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT).toBe("prompt_enrichment");
      expect(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT).toBe("forensic_audit");
    });

    it("defines comprehensive failure categories across mechanical, contextual, and invariant tiers", () => {
      // Mechanical
      expect(FAILURE_CATEGORIES.TRANSIENT_MECHANICAL).toBe("transient_mechanical");
      expect(FAILURE_CATEGORIES.TRANSIENT_NETWORK).toBe("transient_network");
      expect(FAILURE_CATEGORIES.ASSERTION_FAILURE).toBe("assertion_failure");

      // Contextual / Semantic
      expect(FAILURE_CATEGORIES.TYPE_CHECK_COMPILER).toBe("type_check_compiler");
      expect(FAILURE_CATEGORIES.SEMANTIC_LOGIC).toBe("semantic_logic");
      expect(FAILURE_CATEGORIES.REVIEWER_REVISION).toBe("reviewer_revision");
      expect(FAILURE_CATEGORIES.CHALLENGER_BREAK).toBe("challenger_break");
      expect(FAILURE_CATEGORIES.EXHAUSTED_LOCAL_RETRY).toBe("exhausted_local_retry");

      // Forensic / Invariant
      expect(FAILURE_CATEGORIES.LAYOUT_INVARIANT_VIOLATION).toBe("layout_invariant_violation");
      expect(FAILURE_CATEGORIES.GIT_HYGIENE_VIOLATION).toBe("git_hygiene_violation");
      expect(FAILURE_CATEGORIES.PROTECTED_SECTION_TAMPERING).toBe("protected_section_tampering");
      expect(FAILURE_CATEGORIES.BINARY_VETO).toBe("binary_veto");
      expect(FAILURE_CATEGORIES.PROCESS_TIMEOUT_HANG).toBe("process_timeout_hang");
      expect(FAILURE_CATEGORIES.SECURITY_CREDENTIAL_LEAK).toBe("security_credential_leak");
      expect(FAILURE_CATEGORIES.FATAL_UNRECOVERABLE).toBe("fatal_unrecoverable");
      expect(FAILURE_CATEGORIES.UNKNOWN_ANOMALY).toBe("unknown_anomaly");
    });

    it("defines severity levels and zero magic numbers in classifier constants", () => {
      expect(FAILURE_SEVERITIES.LOW).toBe("low");
      expect(FAILURE_SEVERITIES.MEDIUM).toBe("medium");
      expect(FAILURE_SEVERITIES.HIGH).toBe("high");
      expect(FAILURE_SEVERITIES.CRITICAL).toBe("critical");

      expect(FAILURE_CLASSIFIER_CONSTANTS.DEFAULT_MAX_RETRY_ATTEMPTS).toBe(2);
      expect(FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH).toBe(0.95);
      expect(FAILURE_CLASSIFIER_CONSTANTS.PRIORITY_CRITICAL_FORENSIC).toBe(100);
      expect(FAILURE_CLASSIFIER_CONSTANTS.PERCENTAGE_MULTIPLIER).toBe(100);
      expect(FAILURE_CLASSIFIER_CONSTANTS.EVENT_CLASSIFIED).toBe("classifier:classified");
      expect(FAILURE_CLASSIFIER_CONSTANTS.EVENT_ROUTED).toBe("classifier:routed");
      expect(FAILURE_CLASSIFIER_CONSTANTS.EVENT_RETRY_DISPATCHED).toBe("classifier:retry_dispatched");
      expect(FAILURE_CLASSIFIER_CONSTANTS.EVENT_PROMPT_ENRICHED).toBe("classifier:prompt_enriched");
      expect(FAILURE_CLASSIFIER_CONSTANTS.EVENT_FORENSIC_AUDIT_TRIGGERED).toBe(
        "classifier:forensic_audit_triggered"
      );
    });
  });

  describe("Compiler Diagnostics Extraction (extractCompilerDiagnostics)", () => {
    it("extracts single TypeScript error code, file, line, and message", () => {
      const trace = "src/app.ts:42:15 - error TS2322: Type 'string' is not assignable to type 'number'.";
      const diags = extractCompilerDiagnostics(trace);

      expect(diags.length).toBe(1);
      expect(diags[0]!.code).toBe("TS2322");
      expect(diags[0]!.file).toBe("src/app.ts");
      expect(diags[0]!.line).toBe(42);
      expect(diags[0]!.character).toBe(15);
      expect(diags[0]!.message).toContain("Type 'string' is not assignable to type 'number'");
    });

    it("extracts multiple TypeScript errors from complex compiler log", () => {
      const trace = [
        "src/core/router.ts(10,5): error TS2345: Argument of type 'boolean' is not assignable.",
        "src/pal/types.ts:99:1 - error TS2304: Cannot find name 'UnknownInterface'.",
        "Build finished with 2 errors.",
      ].join("\n");

      const diags = extractCompilerDiagnostics(trace);
      expect(diags.length).toBe(2);
      expect(diags[0]!.code).toBe("TS2345");
      expect(diags[0]!.line).toBe(10);
      expect(diags[1]!.code).toBe("TS2304");
      expect(diags[1]!.line).toBe(99);
    });

    it("handles error without file or line gracefully", () => {
      const trace = "error TS1005: ';' expected.";
      const diags = extractCompilerDiagnostics(trace);

      expect(diags.length).toBe(1);
      expect(diags[0]!.code).toBe("TS1005");
      expect(diags[0]!.file).toBeUndefined();
      expect(diags[0]!.message).toContain("';' expected");
    });

    it("returns empty array for non-compiler error strings", () => {
      expect(extractCompilerDiagnostics("All 10 tests passed successfully.")).toEqual([]);
      expect(extractCompilerDiagnostics("")).toEqual([]);
    });
  });

  describe("Failure Classification Logic (classifyFailure)", () => {
    it("classifies Gate 0 mechanical test runner failure as assertion_failure", () => {
      const failure: FailureReport = {
        taskId: TEST_TASK_ID,
        failureTrace: "AssertionError: expect(received).toBe(expected) // expected 42, received 0",
        exitCode: 1,
      };

      const result = classifyFailure(failure);
      expect(result.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);
      expect(result.severity).toBe(FAILURE_SEVERITIES.LOW);
      expect(result.suggestedRung).toBe(1);
    });

    it("classifies TypeScript compiler error as type_check_compiler with extracted diagnostics", () => {
      const trace = "src/core/escalation.ts:15:3 - error TS2322: Type 'number' is not assignable to 'string'.";
      const result = classifyFailure(trace);

      expect(result.category).toBe(FAILURE_CATEGORIES.TYPE_CHECK_COMPILER);
      expect(result.severity).toBe(FAILURE_SEVERITIES.MEDIUM);
      expect(result.suggestedRung).toBe(2);
      expect(result.compilerDiagnostics).toBeDefined();
      expect(result.compilerDiagnostics!.length).toBe(1);
      expect(result.compilerDiagnostics![0]!.code).toBe("TS2322");
    });

    it("classifies syntax or linter error as type_check_compiler", () => {
      const trace = "SyntaxError: Unexpected token '}' at line 89";
      const result = classifyFailure(trace);

      expect(result.category).toBe(FAILURE_CATEGORIES.TYPE_CHECK_COMPILER);
      expect(result.severity).toBe(FAILURE_SEVERITIES.LOW);
      expect(result.suggestedRung).toBe(1);
    });

    it("classifies Gate 1 reviewer critique as reviewer_revision", () => {
      const failure: FailureReport = {
        taskId: TEST_TASK_ID,
        failingGate: "gate_1",
        failureTrace: "Reviewer rejected changes: architectural violation and spec fidelity gaps detected.",
      };

      const result = classifyFailure(failure);
      expect(result.category).toBe(FAILURE_CATEGORIES.REVIEWER_REVISION);
      expect(result.severity).toBe(FAILURE_SEVERITIES.MEDIUM);
      expect(result.suggestedRung).toBe(2);
    });

    it("classifies Gate 2 challenger break probe as challenger_break", () => {
      const failure: FailureReport = {
        taskId: TEST_TASK_ID,
        failingGate: "gate_2",
        failureTrace: "Adversarial challenger synthesized fuzz probe breaking null safety on line 12.",
      };

      const result = classifyFailure(failure);
      expect(result.category).toBe(FAILURE_CATEGORIES.CHALLENGER_BREAK);
      expect(result.severity).toBe(FAILURE_SEVERITIES.MEDIUM);
      expect(result.suggestedRung).toBe(2);
    });

    it("classifies Gate 3 forensic veto as binary_veto", () => {
      const failure: FailureReport = {
        taskId: TEST_TASK_ID,
        failingGate: "gate_3",
        failureTrace: "Gate 3 Forensic Auditor issued absolute binary veto.",
      };

      const result = classifyFailure(failure);
      expect(result.category).toBe(FAILURE_CATEGORIES.BINARY_VETO);
      expect(result.severity).toBe(FAILURE_SEVERITIES.CRITICAL);
      expect(result.suggestedRung).toBe(4);
    });

    it("classifies layout invariant violation (non-md file in teamwork)", () => {
      const trace = "Layout invariant broken: unauthorized file created at .agents/teamwork/worker_1/helper.ts";
      const result = classifyFailure(trace);

      expect(result.category).toBe(FAILURE_CATEGORIES.LAYOUT_INVARIANT_VIOLATION);
      expect(result.severity).toBe(FAILURE_SEVERITIES.HIGH);
      expect(result.suggestedRung).toBe(4);
    });

    it("classifies git hygiene violation (secret key or binary)", () => {
      const trace = "Git hygiene failure: secret_key or bearer token detected in uncommitted diff.";
      const result = classifyFailure(trace);

      expect(result.category).toBe(FAILURE_CATEGORIES.GIT_HYGIENE_VIOLATION);
      expect(result.severity).toBe(FAILURE_SEVERITIES.CRITICAL);
      expect(result.suggestedRung).toBe(4);
    });

    it("classifies protected section tampering (🔒 section modified)", () => {
      const trace = "Attempted write to protected section 🔒 My Identity in BRIEFING.md";
      const result = classifyFailure(trace);

      expect(result.category).toBe(FAILURE_CATEGORIES.PROTECTED_SECTION_TAMPERING);
      expect(result.severity).toBe(FAILURE_SEVERITIES.CRITICAL);
      expect(result.suggestedRung).toBe(6);
    });

    it("classifies subagent timeout or hung process", () => {
      const failure: FailureReport = {
        taskId: TEST_TASK_ID,
        failingGate: "timeout",
        failureTrace: "Worker process execution timeout exceeded (hung for >15 minutes).",
      };

      const result = classifyFailure(failure);
      expect(result.category).toBe(FAILURE_CATEGORIES.PROCESS_TIMEOUT_HANG);
      expect(result.severity).toBe(FAILURE_SEVERITIES.HIGH);
      expect(result.suggestedRung).toBe(4);
    });

    it("classifies fatal authentication or missing credentials", () => {
      const trace = "Authentication failed: unauthorized API key. Missing required credentials.";
      const result = classifyFailure(trace);

      expect(result.category).toBe(FAILURE_CATEGORIES.SECURITY_CREDENTIAL_LEAK);
      expect(result.severity).toBe(FAILURE_SEVERITIES.CRITICAL);
      expect(result.suggestedRung).toBe(6);
    });

    it("classifies exhausted local retry attempts into exhausted_local_retry", () => {
      const trace = "AssertionError: expected 5, received 4";
      const result = classifyFailure(trace, undefined, { attempt: 2, maxAttempts: 2 });

      expect(result.category).toBe(FAILURE_CATEGORIES.EXHAUSTED_LOCAL_RETRY);
      expect(result.severity).toBe(FAILURE_SEVERITIES.MEDIUM);
      expect(result.suggestedRung).toBe(2);
    });
  });

  describe("Failure Routing Decision Engine (routeFailure)", () => {
    describe("Target: RETRY", () => {
      it("routes first-attempt mechanical failure to 'retry' with EVT_G0_RETRY and Rung 1", () => {
        const failure: FailureReport = {
          taskId: TEST_TASK_ID,
          failureTrace: "AssertionError: expect(received).toBe(10)",
          exitCode: 1,
        };

        const decision = routeFailure(failure, undefined, { attempt: 1, maxAttempts: 2 });

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.RETRY);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_G0_RETRY);
        expect(decision.retryContext?.canRetryLocally).toBe(true);
        expect(decision.retryContext?.attempt).toBe(1);
        expect(decision.retryContext?.maxAttempts).toBe(2);
        expect(decision.enrichedPrompt).toContain("Local Mechanical Retry (Attempt 1/2)");
        expect(decision.enrichedPrompt).toContain("Working tree retained dirty");
      });
    });

    describe("Target: PROMPT_ENRICHMENT", () => {
      it("routes compiler errors to 'prompt_enrichment' with compiler directives", () => {
        const trace = "src/app.ts:12:8 - error TS2322: Type 'number' is not assignable to 'string'.";
        const decision = routeFailure(trace);

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_DIAGNOSTIC_RETRY);
        expect(decision.enrichedPrompt).toContain("Extracted Compiler & Type Diagnostics");
        expect(decision.enrichedPrompt).toContain("TS2322");
      });

      it("routes Gate 1 reviewer revisions to 'prompt_enrichment' with EVT_G1_REVISE", () => {
        const failure: FailureReport = {
          taskId: TEST_TASK_ID,
          failingGate: "gate_1",
          failureTrace: "Reviewer requested revisions: criteria not met for edge cases.",
        };

        const decision = routeFailure(failure);

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_G1_REVISE);
        expect(decision.enrichedPrompt).toContain("Remediation Prompt Enrichment");
      });

      it("routes Gate 2 challenger breaks to 'prompt_enrichment' with EVT_G2_BREAK and reproduction probe", () => {
        const reproProbe = "test('probe', () => { expect(parse('bad-input')).toBeDefined(); });";
        const failure: FailureReport = {
          taskId: TEST_TASK_ID,
          failingGate: "gate_2",
          failureTrace: "Adversarial probe crashed the parser.",
        };

        const decision = routeFailure(failure, undefined, { reproScript: reproProbe });

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_G2_BREAK);
        expect(decision.enrichedPrompt).toContain("Adversarial Challenger Reproduction Probe");
        expect(decision.enrichedPrompt).toContain("expect(parse('bad-input'))");
      });

      it("routes exhausted local retries to 'prompt_enrichment' with EVT_G0_EXHAUSTED", () => {
        const failure: FailureReport = {
          taskId: TEST_TASK_ID,
          failureTrace: "AssertionError: expected true, got false",
          exitCode: 1,
        };

        const decision = routeFailure(failure, undefined, { attempt: 2, maxAttempts: 2 });

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_G0_EXHAUSTED);
      });

      it("embeds remediation patch when provided in context", () => {
        const patch = "diff --git a/src/app.ts b/src/app.ts\n+return true;";
        const decision = routeFailure("AssertionError: test failed", undefined, {
          attempt: 2,
          maxAttempts: 2,
          remediationPatch: patch,
        });

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT);
        expect(decision.enrichedPrompt).toContain("Explorer Remediation Patch Proposal");
        expect(decision.enrichedPrompt).toContain("+return true;");
      });
    });

    describe("Target: FORENSIC_AUDIT", () => {
      it("routes Gate 3 binary veto to 'forensic_audit' with invariant audit requirements and rollback", () => {
        const failure: FailureReport = {
          taskId: TEST_TASK_ID,
          failingGate: "gate_3",
          failureTrace: "Gate 3 Forensic Auditor issued binary veto: project layout invariant violated.",
        };

        const decision = routeFailure(failure);

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_G3_VETO);
        expect(decision.auditRequirements?.requiresBinaryVetoCheck).toBe(true);
        expect(decision.auditRequirements?.requiresRollback).toBe(true);
        expect(decision.auditRequirements?.isolatedShellProcess).toBe(true);
        expect(decision.enrichedPrompt).toContain("Gate 3 Forensic Audit Directive");
        expect(decision.enrichedPrompt).toContain("Binary Decision");
      });

      it("routes layout invariant violation to 'forensic_audit' with layout inspection requirement", () => {
        const trace = "Layout invariant violated: non-md file .agents/teamwork/foo.ts detected";
        const decision = routeFailure(trace);

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT);
        expect(decision.auditRequirements?.requiresLayoutInspection).toBe(true);
        expect(decision.auditRequirements?.requiresRollback).toBe(true);
      });

      it("routes git hygiene violation to 'forensic_audit' with hygiene verification requirement", () => {
        const trace = "Git hygiene alert: unstaged binary artifact detected in workspace";
        const decision = routeFailure(trace);

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT);
        expect(decision.auditRequirements?.requiresGitHygieneVerification).toBe(true);
      });

      it("routes worker timeout to 'forensic_audit' with EVT_WORKER_TIMEOUT", () => {
        const failure: FailureReport = {
          taskId: TEST_TASK_ID,
          failingGate: "timeout",
          failureTrace: "Worker process hung and exceeded maximum timeout duration.",
        };

        const decision = routeFailure(failure);

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_WORKER_TIMEOUT);
      });

      it("routes fatal credentials failure to 'forensic_audit' with EVT_ESCALATION_FATAL", () => {
        const trace = "Fatal unrecoverable error: corrupted git index and invalid credentials.";
        const decision = routeFailure(trace);

        expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT);
        expect(decision.suggestedFsmEvent).toBe(LOOPER_EVENTS.EVT_ESCALATION_FATAL);
      });
    });

    describe("Prompt Enrichment Construction (buildFailureEnrichedPrompt)", () => {
      it("builds forensic audit directive prompt with invariant breaches, confidence, and mandates", () => {
        const decision = routeFailure("Gate 3 binary veto: unauthorized file modification");
        const prompt = buildFailureEnrichedPrompt(decision, undefined, {
          taskId: TEST_TASK_ID,
          failingGate: "gate_3",
          failureTrace: "VETO: file outside scope modified",
        });

        expect(prompt).toContain("Gate 3 Forensic Audit Directive: Binary Veto & Invariant Enforcement");
        expect(prompt).toContain("Category");
        expect(prompt).toContain("Severity");
        expect(prompt).toContain("Layout Invariant");
        expect(prompt).toContain("Git Hygiene");
        expect(prompt).toContain("Atomic Rollback");
        expect(prompt).toContain("Binary Decision");
        expect(prompt).toContain("Captured Failure Trace");
        expect(prompt).toContain("VETO: file outside scope modified");
      });

      it("builds remediation prompt with extracted compiler diagnostics and directives", () => {
        const trace = "src/foo.ts:12:5 - error TS2322: Type 'number' is not assignable to type 'string'.";
        const decision = routeFailure(trace);
        const prompt = buildFailureEnrichedPrompt(decision, undefined, {
          taskId: TEST_TASK_ID,
          failingGate: "gate_0",
          failureTrace: trace,
        });

        expect(prompt).toContain("Remediation Prompt Enrichment");
        expect(prompt).toContain("Extracted Compiler & Type Diagnostics");
        expect(prompt).toContain("TS2322");
        expect(prompt).toContain("src/foo.ts:12");
        expect(prompt).toContain("Compiler Remediation Directives");
        expect(prompt).toContain("Resolve the extracted TypeScript compiler errors");
      });

      it("builds remediation prompt embedding Challenger reproduction probe", () => {
        const decision = routeFailure("Adversarial probe: reproduction probe failed");
        const reproScript = "describe('fuzz', () => { it('breaks', () => { throw new Error('Boom'); }); });";
        const prompt = buildFailureEnrichedPrompt(
          decision,
          { reproScript },
          { taskId: TEST_TASK_ID, failingGate: "gate_2", failureTrace: "Adversarial probe: reproduction probe failed" }
        );

        expect(prompt).toContain("Adversarial Challenger Reproduction Probe");
        expect(prompt).toContain(reproScript);
        expect(prompt).toContain("Remediation Directive: Update implementation to satisfy this reproduction test probe.");
      });

      it("builds remediation prompt embedding Explorer remediation patch", () => {
        const decision = routeFailure("AssertionError: test failed", undefined, { attempt: 2, maxAttempts: 2 });
        const patch = "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-broken\n+fixed";
        const prompt = buildFailureEnrichedPrompt(
          decision,
          { remediationPatch: patch },
          { taskId: TEST_TASK_ID, failingGate: "gate_0", failureTrace: "Exhausted" }
        );

        expect(prompt).toContain("Explorer Remediation Patch Proposal");
        expect(prompt).toContain("Remediation Directive: Inspect and apply the Explorer's synthesized patch proposal.");
        expect(prompt).toContain(patch);
      });

      it("builds local mechanical retry prompt with attempt counter and dirty tree policy", () => {
        const decision = routeFailure("AssertionError: expected 1 to be 2", undefined, {
          attempt: 1,
          maxAttempts: 2,
        });
        const prompt = buildFailureEnrichedPrompt(decision, undefined, {
          taskId: TEST_TASK_ID,
          failingGate: "gate_0",
          failureTrace: "AssertionError: expected 1 to be 2",
        });

        expect(prompt).toContain("Local Mechanical Retry (Attempt 1/2)");
        expect(prompt).toContain("Working tree retained dirty for surgical in-place correction.");
        expect(prompt).toContain("Captured Failure Trace");
        expect(prompt).toContain("AssertionError: expected 1 to be 2");
      });
    });

    describe("Predicate Helper Functions", () => {
      it("correctly identifies forensic audit requirements via isForensicAuditRequired", () => {
        expect(isForensicAuditRequired("Gate 3 binary veto")).toBe(true);
        expect(isForensicAuditRequired("Layout invariant violated in .agents/teamwork/x.ts")).toBe(
          true
        );
        expect(isForensicAuditRequired("AssertionError: test failed", undefined, { attempt: 1, maxAttempts: 2 })).toBe(
          false
        );
      });

      it("correctly identifies prompt enrichment requirements via isPromptEnrichmentRequired", () => {
        expect(isPromptEnrichmentRequired("src/x.ts:1:1 - error TS2322: Type mismatch")).toBe(true);
        expect(
          isPromptEnrichmentRequired("AssertionError: test failed", undefined, {
            attempt: 2,
            maxAttempts: 2,
          })
        ).toBe(true);
        expect(
          isPromptEnrichmentRequired("AssertionError: test failed", undefined, {
            attempt: 1,
            maxAttempts: 2,
          })
        ).toBe(false);
      });

      it("correctly identifies retry eligibility via isRetryEligible", () => {
        expect(
          isRetryEligible("AssertionError: expected 1 got 2", undefined, { attempt: 1, maxAttempts: 2 })
        ).toBe(true);
        expect(
          isRetryEligible("AssertionError: expected 1 got 2", undefined, { attempt: 2, maxAttempts: 2 })
        ).toBe(false);
        expect(isRetryEligible("Gate 3 binary veto")).toBe(false);
      });
    });
  });

  describe("FailureClassifier Class Lifecycle & Events", () => {
    it("initializes with options and default thresholds", () => {
      const classifier = createFailureClassifier({ maxRetryAttempts: 3 });

      expect(classifier.maxRetryAttempts).toBe(3);
      expect(classifier.customRules.length).toBe(0);
    });

    it("emits classification and routing events during evaluation", () => {
      const classifier = new FailureClassifier();
      let classifiedEmitted = false;
      let routedEmitted = false;
      let retryDispatchedEmitted = false;

      classifier.on(FAILURE_CLASSIFIER_CONSTANTS.EVENT_CLASSIFIED, (evt) => {
        classifiedEmitted = true;
        expect(evt.classification.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);
      });

      classifier.on(FAILURE_CLASSIFIER_CONSTANTS.EVENT_ROUTED, (evt) => {
        routedEmitted = true;
        expect(evt.decision.target).toBe(FAILURE_ROUTING_TARGETS.RETRY);
      });

      classifier.on(FAILURE_CLASSIFIER_CONSTANTS.EVENT_RETRY_DISPATCHED, () => {
        retryDispatchedEmitted = true;
      });

      const decision = classifier.route("AssertionError: expect(1).toBe(2)", {
        attempt: 1,
        maxAttempts: 2,
      });

      expect(classifiedEmitted).toBe(true);
      expect(routedEmitted).toBe(true);
      expect(retryDispatchedEmitted).toBe(true);
      expect(decision.target).toBe("retry");
    });

    it("emits prompt_enriched and forensic_audit_triggered events", () => {
      const classifier = new FailureClassifier();
      let promptEnrichedEmitted = false;
      let forensicAuditEmitted = false;

      classifier.on(FAILURE_CLASSIFIER_CONSTANTS.EVENT_PROMPT_ENRICHED, () => {
        promptEnrichedEmitted = true;
      });
      classifier.on(FAILURE_CLASSIFIER_CONSTANTS.EVENT_FORENSIC_AUDIT_TRIGGERED, () => {
        forensicAuditEmitted = true;
      });

      classifier.route("src/a.ts:1:1 - error TS2322: mismatch");
      expect(promptEnrichedEmitted).toBe(true);

      classifier.route("Gate 3 binary veto issued");
      expect(forensicAuditEmitted).toBe(true);
    });

    it("supports custom classification rules with priority ordering", () => {
      const classifier = new FailureClassifier();

      const customRule: FailureClassifierRule = {
        name: "custom_db_deadlock",
        predicate: (report) => Boolean(report.failureTrace?.includes("DEADLOCK_DETECTED")),
        target: FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT,
        category: FAILURE_CATEGORIES.BINARY_VETO,
        severity: FAILURE_SEVERITIES.CRITICAL,
        explanation: "Database deadlock detected; requires forensic inspection.",
        priority: 150,
      };

      classifier.addCustomRule(customRule);
      expect(classifier.customRules.length).toBe(1);

      const decision = classifier.route("Database query error: DEADLOCK_DETECTED");
      expect(decision.target).toBe(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT);
      expect(decision.classification.matchedSignals).toContain("custom_rule:custom_db_deadlock");

      const removed = classifier.removeCustomRule("custom_db_deadlock");
      expect(removed).toBe(true);
      expect(classifier.customRules.length).toBe(0);
    });
  });

  describe("DynamicEscalationLadder Integration with FailureClassifier", () => {
    it("exposes failureClassifier and helper methods on DynamicEscalationLadder", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      expect(ladder.failureClassifier).toBeDefined();

      const classification = ladder.classifyFailure("AssertionError: test failed");
      expect(classification.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);

      const routing = ladder.routeFailure("Gate 3 binary veto");
      expect(routing.target).toBe(FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT);
    });

    it("automatically attaches routing metadata (routingTarget, failureRouting) to EscalationDecision on handleFailure()", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      let routedEventData: unknown = undefined;
      ladder.on("ladder:routed", (evt) => {
        routedEventData = evt;
      });

      const decision1 = ladder.handleFailure("AssertionError: expect(1).toBe(2)");
      expect(decision1.rung).toBe(1);
      expect(decision1.action).toBe("retry_current_rung");
      expect(decision1.routingTarget).toBe(FAILURE_ROUTING_TARGETS.RETRY);
      expect(decision1.failureRouting).toBeDefined();
      expect(decision1.failureRouting?.target).toBe("retry");
      expect(routedEventData).toBeDefined();

      // Check history entry has failureRouting recorded
      expect(ladder.history.length).toBe(1);
      expect(ladder.history[0]!.failureRouting).toBeDefined();
      expect(ladder.history[0]!.failureRouting?.target).toBe("retry");
    });

    it("supports handleFailureWithRouting returning both decision and routing simultaneously", () => {
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
      });

      const { decision, routing } = ladder.handleFailureWithRouting(
        "src/test.ts:5:2 - error TS2322: Type 'number' is not assignable"
      );

      expect(decision.rung).toBe(1);
      expect(decision.action).toBe("retry_current_rung");
      expect(routing.target).toBe(FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT);
      expect(routing.classification.category).toBe(FAILURE_CATEGORIES.TYPE_CHECK_COMPILER);
    });

    it("allows injecting a custom FailureClassifier into DynamicEscalationLadder", () => {
      const customClassifier = createFailureClassifier({ maxRetryAttempts: 5 });
      const ladder = new DynamicEscalationLadder({
        taskId: TEST_TASK_ID,
        baselineSha: TEST_BASELINE_SHA,
        failureClassifier: customClassifier,
      });

      expect(ladder.failureClassifier).toBe(customClassifier);
      expect(ladder.failureClassifier.maxRetryAttempts).toBe(5);
    });
  });
});
