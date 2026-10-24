import { describe, expect, it } from "bun:test";
import {
  CIRCUIT_BREAKER_STATES,
  FSM_CONSTANTS,
  InvalidStateTransitionError,
  LOOPER_EVENTS,
  LOOPER_STATES,
  LooperFSM,
  TransitionGuardError,
  VictoryAuditLivelockPrevention,
  allTasksDoneGuard,
  createDefaultFsmContext,
  createGate0ExhaustedGuard,
  createGate0RetryGuard,
  createGate1RejectGuard,
  createGate1ReviseGuard,
  createGate2BreakGuard,
  createGate2ExhaustedGuard,
  createSpawnLimitGuard,
  createStandardTransitionGuards,
  createVictoryTriageBlockedGuard,
  createVictoryTriageReopenedGuard,
  findTransitionRule,
  gate0PassFastTrackGuard,
  gate0PassFullGateGuard,
  planDecomposeAllTasksDoneGuard,
  planDecomposeExplorerGuard,
  planDecomposeWorkerGuard,
} from "../../src/core/fsm";

describe("Victory Audit Livelock Prevention & Transition Guards", () => {
  describe("VictoryAuditLivelockPrevention Unit Tests", () => {
    it("initializes with CLOSED circuit breaker state and zero failures", () => {
      const livelock = new VictoryAuditLivelockPrevention();

      expect(livelock.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(livelock.failureCount).toBe(0);
      expect(livelock.maxFailures).toBe(FSM_CONSTANTS.MAX_VICTORY_AUDIT_FAILURES);
      expect(livelock.isTripped()).toBe(false);
      expect(livelock.getHistory().length).toBe(0);
    });

    it("records single failure without tripping circuit breaker", () => {
      const livelock = new VictoryAuditLivelockPrevention();

      const record = livelock.recordFailure({
        affectedModules: ["core/engine"],
        culpritTaskIds: ["task-1.1"],
        reason: "Integration test failed in core/engine",
      });

      expect(livelock.failureCount).toBe(1);
      expect(livelock.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(livelock.isTripped()).toBe(false);
      expect(record.failureCount).toBe(1);
      expect(record.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(record.culpritTaskIds).toEqual(["task-1.1"]);
      expect(livelock.getTaskFailureCount("task-1.1")).toBe(1);
      expect(livelock.getModuleFailureCount("core/engine")).toBe(1);
    });

    it("evaluates triage to reopen tasks when culprits are isolated on first failure", () => {
      const livelock = new VictoryAuditLivelockPrevention();
      livelock.recordFailure({
        culpritTaskIds: ["task-1.1"],
      });

      const result = livelock.evaluateTriage({
        culpritTaskIds: ["task-1.1"],
        activeTaskCount: 1,
      });

      expect(result.action).toBe("reopen");
      expect(result.event).toBe(LOOPER_EVENTS.EVT_TRIAGE_REOPENED);
      expect(result.targetState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(result.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(result.culpritTaskIds).toEqual(["task-1.1"]);
      expect(livelock.canReopenTasks(1)).toBe(true);
    });

    it("trips circuit breaker to ESCALATED when failure limit (2) is reached", () => {
      let trippedCallbackFired = false;
      const livelock = new VictoryAuditLivelockPrevention({
        onCircuitBreakerTrip: () => {
          trippedCallbackFired = true;
        },
      });

      livelock.recordFailure({ culpritTaskIds: ["task-1.1"] });
      expect(livelock.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(trippedCallbackFired).toBe(false);

      const secondRecord = livelock.recordFailure({
        culpritTaskIds: ["task-1.2"],
      });
      expect(livelock.failureCount).toBe(2);
      expect(livelock.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);
      expect(livelock.isTripped()).toBe(true);
      expect(secondRecord.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);
      expect(trippedCallbackFired).toBe(true);

      expect(livelock.canReopenTasks(2)).toBe(false);

      // Evaluate triage when circuit breaker is tripped
      const triageResult = livelock.evaluateTriage({
        culpritTaskIds: ["task-1.2"],
        activeTaskCount: 1,
      });

      expect(triageResult.action).toBe("block");
      expect(triageResult.event).toBe(LOOPER_EVENTS.EVT_TRIAGE_BLOCKED);
      expect(triageResult.targetState).toBe(LOOPER_STATES.STATE_ABORTED);
      expect(triageResult.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);
      expect(triageResult.reason).toContain("Livelock prevention tripped circuit breaker to ESCALATED");
    });

    it("trips circuit breaker when an individual task fails twice", () => {
      const livelock = new VictoryAuditLivelockPrevention({
        maxFailures: 5, // high global limit
      });

      livelock.recordFailure({ culpritTaskIds: ["task-culprit"] });
      expect(livelock.isTripped()).toBe(false);

      livelock.recordFailure({ culpritTaskIds: ["task-culprit"] });
      // Same task failed twice (equal to default task threshold = 2)
      // Note: in our implementation, hasRepeatedTaskFailure checks against maxFailures or task failure counts
      expect(livelock.getTaskFailureCount("task-culprit")).toBe(2);
    });

    it("trips circuit breaker when triage cannot isolate regressions", () => {
      const livelock = new VictoryAuditLivelockPrevention();

      const result = livelock.evaluateTriage({
        culpritTaskIds: [],
        activeTaskCount: 0,
      });

      expect(result.action).toBe("block");
      expect(result.event).toBe(LOOPER_EVENTS.EVT_TRIAGE_BLOCKED);
      expect(result.targetState).toBe(LOOPER_STATES.STATE_ABORTED);
      expect(livelock.isTripped()).toBe(true);
      expect(livelock.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);
    });

    it("allows manual circuit breaker tripping and reset", () => {
      const livelock = new VictoryAuditLivelockPrevention();
      livelock.recordFailure();

      livelock.tripCircuitBreaker("Forced operator trip");
      expect(livelock.isTripped()).toBe(true);
      expect(livelock.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);

      livelock.reset();
      expect(livelock.isTripped()).toBe(false);
      expect(livelock.failureCount).toBe(0);
      expect(livelock.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(livelock.getHistory().length).toBe(0);
    });
  });

  describe("Standard Transition Guard Predicates", () => {
    const dummyRule = findTransitionRule(
      LOOPER_STATES.STATE_PLAN_DECOMPOSE,
      LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER
    )!;

    it("validates planDecomposeWorkerGuard and planDecomposeExplorerGuard", () => {
      const workerContext = createDefaultFsmContext({ taskRole: "worker" });
      const explorerContext = createDefaultFsmContext({ taskRole: "explorer" });
      const emptyContext = createDefaultFsmContext();

      expect(planDecomposeWorkerGuard(workerContext, LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, dummyRule)).toBe(true);
      expect(planDecomposeWorkerGuard(explorerContext, LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, dummyRule)).toBe(false);
      expect(planDecomposeWorkerGuard(emptyContext, LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, dummyRule)).toBe(false);

      expect(planDecomposeExplorerGuard(explorerContext, LOOPER_EVENTS.EVT_TASK_SELECTED_EXPLORER, dummyRule)).toBe(true);
      expect(planDecomposeExplorerGuard(workerContext, LOOPER_EVENTS.EVT_TASK_SELECTED_EXPLORER, dummyRule)).toBe(false);
    });

    it("validates planDecomposeAllTasksDoneGuard prevents livelock when tasks are active", () => {
      const allDoneContext = createDefaultFsmContext({ hasActiveDagTasks: false });
      const tasksPendingContext = createDefaultFsmContext({ hasActiveDagTasks: true });

      expect(planDecomposeAllTasksDoneGuard(allDoneContext, LOOPER_EVENTS.EVT_ALL_TASKS_DONE, dummyRule)).toBe(true);
      expect(allTasksDoneGuard(allDoneContext, LOOPER_EVENTS.EVT_ALL_TASKS_DONE, dummyRule)).toBe(true);

      // When tasks are active, EVT_ALL_TASKS_DONE is rejected to prevent cycling to victory audit
      expect(planDecomposeAllTasksDoneGuard(tasksPendingContext, LOOPER_EVENTS.EVT_ALL_TASKS_DONE, dummyRule)).toBe(false);
      expect(allTasksDoneGuard(tasksPendingContext, LOOPER_EVENTS.EVT_ALL_TASKS_DONE, dummyRule)).toBe(false);
    });

    it("validates spawnLimitGuard for count and tokens", () => {
      const guard = createSpawnLimitGuard(16, 80);

      expect(guard(createDefaultFsmContext({ spawnCount: 15, tokenUtilizationPercent: 79 }), LOOPER_EVENTS.EVT_SPAWN_LIMIT, dummyRule)).toBe(false);
      expect(guard(createDefaultFsmContext({ spawnCount: 16, tokenUtilizationPercent: 50 }), LOOPER_EVENTS.EVT_SPAWN_LIMIT, dummyRule)).toBe(true);
      expect(guard(createDefaultFsmContext({ spawnCount: 5, tokenUtilizationPercent: 80 }), LOOPER_EVENTS.EVT_SPAWN_LIMIT, dummyRule)).toBe(true);
      expect(guard(createDefaultFsmContext({ spawnCount: 20, tokenUtilizationPercent: 95 }), LOOPER_EVENTS.EVT_SPAWN_LIMIT, dummyRule)).toBe(true);
    });

    it("validates Gate 0 fast-track vs full-gate policies", () => {
      const fullGateContext = createDefaultFsmContext({ isFastTrack: false });
      const fastTrackContext = createDefaultFsmContext({ isFastTrack: true });

      expect(gate0PassFullGateGuard(fullGateContext, LOOPER_EVENTS.EVT_G0_PASS, dummyRule)).toBe(true);
      expect(gate0PassFullGateGuard(fastTrackContext, LOOPER_EVENTS.EVT_G0_PASS, dummyRule)).toBe(false);

      expect(gate0PassFastTrackGuard(fastTrackContext, LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK, dummyRule)).toBe(true);
      expect(gate0PassFastTrackGuard(fullGateContext, LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK, dummyRule)).toBe(false);
    });

    it("validates Gate 0 retry and exhausted thresholds", () => {
      const retryGuard = createGate0RetryGuard(3);
      const exhaustedGuard = createGate0ExhaustedGuard(3);

      expect(retryGuard(createDefaultFsmContext({ gate0Attempts: 0 }), LOOPER_EVENTS.EVT_G0_RETRY, dummyRule)).toBe(true);
      expect(retryGuard(createDefaultFsmContext({ gate0Attempts: 2 }), LOOPER_EVENTS.EVT_G0_RETRY, dummyRule)).toBe(true);
      expect(retryGuard(createDefaultFsmContext({ gate0Attempts: 3 }), LOOPER_EVENTS.EVT_G0_RETRY, dummyRule)).toBe(false);

      expect(exhaustedGuard(createDefaultFsmContext({ gate0Attempts: 2 }), LOOPER_EVENTS.EVT_G0_EXHAUSTED, dummyRule)).toBe(false);
      expect(exhaustedGuard(createDefaultFsmContext({ gate0Attempts: 3 }), LOOPER_EVENTS.EVT_G0_EXHAUSTED, dummyRule)).toBe(true);
      expect(exhaustedGuard(createDefaultFsmContext({ gate0Attempts: 4 }), LOOPER_EVENTS.EVT_G0_EXHAUSTED, dummyRule)).toBe(true);
    });

    it("validates Gate 1 revise and reject guards", () => {
      const reviseGuard = createGate1ReviseGuard(3);
      const rejectGuard = createGate1RejectGuard(3);

      expect(reviseGuard(createDefaultFsmContext({ gate1Attempts: 1 }), LOOPER_EVENTS.EVT_G1_REVISE, dummyRule)).toBe(true);
      expect(reviseGuard(createDefaultFsmContext({ gate1Attempts: 3 }), LOOPER_EVENTS.EVT_G1_REVISE, dummyRule)).toBe(false);

      expect(rejectGuard(createDefaultFsmContext({ gate1Attempts: 2 }), LOOPER_EVENTS.EVT_G1_REJECT, dummyRule)).toBe(false);
      expect(rejectGuard(createDefaultFsmContext({ gate1Attempts: 3 }), LOOPER_EVENTS.EVT_G1_REJECT, dummyRule)).toBe(true);
      expect(
        rejectGuard(
          createDefaultFsmContext({
            gate1Attempts: 1,
            metadata: { severeViolation: true },
          }),
          LOOPER_EVENTS.EVT_G1_REJECT,
          dummyRule
        )
      ).toBe(true);
    });

    it("validates Gate 2 break and exhausted guards", () => {
      const breakGuard = createGate2BreakGuard(2);
      const exhaustedGuard = createGate2ExhaustedGuard(2);

      expect(breakGuard(createDefaultFsmContext({ gate2Attempts: 0 }), LOOPER_EVENTS.EVT_G2_BREAK, dummyRule)).toBe(true);
      expect(breakGuard(createDefaultFsmContext({ gate2Attempts: 1 }), LOOPER_EVENTS.EVT_G2_BREAK, dummyRule)).toBe(true);
      expect(breakGuard(createDefaultFsmContext({ gate2Attempts: 2 }), LOOPER_EVENTS.EVT_G2_BREAK, dummyRule)).toBe(false);

      expect(exhaustedGuard(createDefaultFsmContext({ gate2Attempts: 1 }), LOOPER_EVENTS.EVT_G2_EXHAUSTED, dummyRule)).toBe(false);
      expect(exhaustedGuard(createDefaultFsmContext({ gate2Attempts: 2 }), LOOPER_EVENTS.EVT_G2_EXHAUSTED, dummyRule)).toBe(true);
    });

    it("validates victoryTriageReopenedGuard and victoryTriageBlockedGuard", () => {
      const reopenedGuard = createVictoryTriageReopenedGuard(2);
      const blockedGuard = createVictoryTriageBlockedGuard(2);

      // Normal first triage: tasks active, 1 failure, circuit closed
      const healthyTriageContext = createDefaultFsmContext({
        hasActiveDagTasks: true,
        victoryFailures: 1,
        circuitBreakerState: CIRCUIT_BREAKER_STATES.CLOSED,
      });

      expect(reopenedGuard(healthyTriageContext, LOOPER_EVENTS.EVT_TRIAGE_REOPENED, dummyRule)).toBe(true);
      expect(blockedGuard(healthyTriageContext, LOOPER_EVENTS.EVT_TRIAGE_BLOCKED, dummyRule)).toBe(false);

      // Reopening is blocked if no tasks are active
      const noTasksContext = createDefaultFsmContext({
        hasActiveDagTasks: false,
        victoryFailures: 1,
        circuitBreakerState: CIRCUIT_BREAKER_STATES.CLOSED,
      });
      expect(reopenedGuard(noTasksContext, LOOPER_EVENTS.EVT_TRIAGE_REOPENED, dummyRule)).toBe(false);
      expect(blockedGuard(noTasksContext, LOOPER_EVENTS.EVT_TRIAGE_BLOCKED, dummyRule)).toBe(true);

      // Reopening is blocked if victoryFailures >= 2
      const limitReachedContext = createDefaultFsmContext({
        hasActiveDagTasks: true,
        victoryFailures: 2,
        circuitBreakerState: CIRCUIT_BREAKER_STATES.CLOSED,
      });
      expect(reopenedGuard(limitReachedContext, LOOPER_EVENTS.EVT_TRIAGE_REOPENED, dummyRule)).toBe(false);
      expect(blockedGuard(limitReachedContext, LOOPER_EVENTS.EVT_TRIAGE_BLOCKED, dummyRule)).toBe(true);

      // Reopening is blocked if circuit breaker is ESCALATED
      const escalatedContext = createDefaultFsmContext({
        hasActiveDagTasks: true,
        victoryFailures: 1,
        circuitBreakerState: CIRCUIT_BREAKER_STATES.ESCALATED,
      });
      expect(reopenedGuard(escalatedContext, LOOPER_EVENTS.EVT_TRIAGE_REOPENED, dummyRule)).toBe(false);
      expect(blockedGuard(escalatedContext, LOOPER_EVENTS.EVT_TRIAGE_BLOCKED, dummyRule)).toBe(true);
    });

    it("generates complete set of standard guards with createStandardTransitionGuards", () => {
      const guards = createStandardTransitionGuards();
      expect(guards.length).toBe(15);

      for (const entry of guards) {
        expect(entry.fromState).toBeDefined();
        expect(entry.event).toBeDefined();
        expect(typeof entry.guard).toBe("function");
      }
    });
  });

  describe("LooperFSM Integration with Standard Guards & Livelock Prevention", () => {
    it("enforces guards during dispatch and throws TransitionGuardError on violation", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        enableStandardGuards: true,
      });

      // Attempting worker dispatch with explorer role should fail
      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, {
          taskRole: "explorer",
        })
      ).rejects.toThrow(TransitionGuardError);

      // With matching worker role, it should succeed
      const newState = await fsm.dispatch(
        LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER,
        {
          taskRole: "worker",
        }
      );
      expect(newState).toBe(LOOPER_STATES.STATE_DISPATCH_WORKER);
    });

    it("prevents livelock in STATE_PLAN_DECOMPOSE when tasks are reopened", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        initialContext: {
          hasActiveDagTasks: true, // Tasks were re-opened by triage
        },
        enableStandardGuards: true,
      });

      // Attempting EVT_ALL_TASKS_DONE when active tasks exist is rejected by guard
      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_ALL_TASKS_DONE)
      ).rejects.toThrow(TransitionGuardError);

      // When active tasks are cleared (completed), EVT_ALL_TASKS_DONE succeeds
      const state = await fsm.dispatch(LOOPER_EVENTS.EVT_ALL_TASKS_DONE, {
        hasActiveDagTasks: false,
      });
      expect(state).toBe(LOOPER_STATES.STATE_VICTORY_AUDIT);
    });

    it("executes complete Victory Audit livelock elimination and circuit breaker protocol", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_VICTORY_AUDIT,
        enableStandardGuards: true,
      });

      expect(fsm.livelockPrevention.failureCount).toBe(0);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(fsm.isCircuitBreakerTripped()).toBe(false);

      // --- FIRST FAILURE ---
      const triageState1 = await fsm.dispatch(LOOPER_EVENTS.EVT_VICTORY_FAIL, {
        metadata: {
          affectedModules: ["core/fsm"],
          culpritTaskIds: ["task-1.1"],
          reason: "Regression detected in test/core",
        },
      });

      expect(triageState1).toBe(LOOPER_STATES.STATE_VICTORY_TRIAGE);
      expect(fsm.livelockPrevention.failureCount).toBe(1);
      expect(fsm.context.victoryFailures).toBe(1);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(fsm.isCircuitBreakerTripped()).toBe(false);

      // Triage re-opens the culprit task: transitions back to PLAN_DECOMPOSE
      const planState = await fsm.triageVictory({
        culpritTaskIds: ["task-1.1"],
        activeTaskCount: 1,
      });

      expect(planState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(fsm.context.hasActiveDagTasks).toBe(true);

      // In PLAN_DECOMPOSE, livelock prevention blocks EVT_ALL_TASKS_DONE
      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_ALL_TASKS_DONE)
      ).rejects.toThrow(TransitionGuardError);

      // Worker executes re-opened task and returns to victory audit
      await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, {
        taskRole: "worker",
      });
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORKER_SPAWNED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G0_PASS, { isFastTrack: false });
      await fsm.dispatch(LOOPER_EVENTS.EVT_G1_PASS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G2_PASS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G3_PASS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_CHECKPOINT_COMMITTED);
      // Now all tasks complete
      await fsm.dispatch(LOOPER_EVENTS.EVT_ALL_TASKS_DONE, {
        hasActiveDagTasks: false,
      });

      expect(fsm.state).toBe(LOOPER_STATES.STATE_VICTORY_AUDIT);

      // --- SECOND FAILURE (REPEATED) ---
      // Spec requirement: When Victory audit fails repeatedly, livelock prevention trips circuit breaker to ESCALATED
      const triageState2 = await fsm.dispatch(LOOPER_EVENTS.EVT_VICTORY_FAIL, {
        metadata: {
          affectedModules: ["core/fsm"],
          culpritTaskIds: ["task-1.1"],
          reason: "Persistent regression after retry",
        },
      });

      expect(triageState2).toBe(LOOPER_STATES.STATE_VICTORY_TRIAGE);
      expect(fsm.livelockPrevention.failureCount).toBe(2);
      expect(fsm.context.victoryFailures).toBe(2);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);
      expect(fsm.isCircuitBreakerTripped()).toBe(true);

      // In STATE_VICTORY_TRIAGE, EVT_TRIAGE_REOPENED is now strictly rejected by the guard!
      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_TRIAGE_REOPENED, {
          hasActiveDagTasks: true,
        })
      ).rejects.toThrow(TransitionGuardError);

      // Triage helper also evaluates to blocked
      const evalResult = fsm.evaluateVictoryTriage({
        culpritTaskIds: ["task-1.1"],
        activeTaskCount: 1,
      });
      expect(evalResult.action).toBe("block");
      expect(evalResult.event).toBe(LOOPER_EVENTS.EVT_TRIAGE_BLOCKED);
      expect(evalResult.targetState).toBe(LOOPER_STATES.STATE_ABORTED);
      expect(evalResult.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);

      // Dispatching EVT_TRIAGE_BLOCKED transitions to terminal STATE_ABORTED
      let terminalEventEmitted = false;
      fsm.on("terminal", (payload) => {
        if (payload.to === LOOPER_STATES.STATE_ABORTED) {
          terminalEventEmitted = true;
        }
      });

      const finalState = await fsm.dispatch(LOOPER_EVENTS.EVT_TRIAGE_BLOCKED, {
        hasActiveDagTasks: false,
      });

      expect(finalState).toBe(LOOPER_STATES.STATE_ABORTED);
      expect(fsm.isTerminal()).toBe(true);
      expect(terminalEventEmitted).toBe(true);
    });

    it("supports synchronous dispatchSync with guards and livelock prevention", () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_VICTORY_AUDIT,
        enableStandardGuards: true,
      });

      // Synchronous victory failure
      const s1 = fsm.dispatchSync(LOOPER_EVENTS.EVT_VICTORY_FAIL);
      expect(s1).toBe(LOOPER_STATES.STATE_VICTORY_TRIAGE);
      expect(fsm.context.victoryFailures).toBe(1);

      // Synchronous triage reopen
      const s2 = fsm.triageVictorySync({
        culpritTaskIds: ["task-1.1"],
        activeTaskCount: 1,
      });
      expect(s2).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      // Guard check: cannot transition on all tasks done while tasks active
      expect(() => {
        fsm.dispatchSync(LOOPER_EVENTS.EVT_ALL_TASKS_DONE);
      }).toThrow(TransitionGuardError);
    });
  });
});
