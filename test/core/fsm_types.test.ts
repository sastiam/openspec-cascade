import { describe, expect, it } from "bun:test";
import {
  FSM_ALLOWED_EVENTS,
  FSM_CONSTANTS,
  FSM_STATE_ADJACENCY,
  FSM_TRANSITION_MATRIX,
  FSM_TRANSITION_RULES,
  InvalidStateTransition,
  InvalidStateTransitionError,
  LOOPER_EVENTS,
  LOOPER_STATES,
  NON_TERMINAL_STATES,
  TERMINAL_STATES,
  canTransition,
  findTransitionRule,
  getAllowedEvents,
  getAllowedNextStates,
  isNonTerminalState,
  isTerminalState,
  isValidEvent,
  isValidNextState,
  isValidState,
  type LooperEvent,
  type LooperState,
} from "../../src/core/fsm_types";

describe("Looper Core FSM Types & 16-State Transition Matrix", () => {
  describe("FSM State Definitions", () => {
    it("defines exactly 18 lifecycle states (16 non-terminal + 2 terminal)", () => {
      const stateKeys = Object.keys(LOOPER_STATES);
      const stateValues = Object.values(LOOPER_STATES);

      expect(stateKeys.length).toBe(FSM_CONSTANTS.TOTAL_STATES_COUNT);
      expect(stateValues.length).toBe(18);
      expect(NON_TERMINAL_STATES.length).toBe(
        FSM_CONSTANTS.NON_TERMINAL_STATES_COUNT
      );
      expect(TERMINAL_STATES.length).toBe(
        FSM_CONSTANTS.TERMINAL_STATES_COUNT
      );
    });

    it("identifies initial and terminal states correctly", () => {
      expect(FSM_CONSTANTS.INITIAL_STATE).toBe(LOOPER_STATES.STATE_INIT);
      expect(FSM_CONSTANTS.TERMINAL_STATE_COMPLETED).toBe(
        LOOPER_STATES.STATE_COMPLETED
      );
      expect(FSM_CONSTANTS.TERMINAL_STATE_ABORTED).toBe(
        LOOPER_STATES.STATE_ABORTED
      );

      expect(isTerminalState(LOOPER_STATES.STATE_COMPLETED)).toBe(true);
      expect(isTerminalState(LOOPER_STATES.STATE_ABORTED)).toBe(true);
      expect(isTerminalState(LOOPER_STATES.STATE_INIT)).toBe(false);
      expect(isTerminalState(LOOPER_STATES.STATE_PLAN_DECOMPOSE)).toBe(false);

      expect(isNonTerminalState(LOOPER_STATES.STATE_INIT)).toBe(true);
      expect(isNonTerminalState(LOOPER_STATES.STATE_PLAN_DECOMPOSE)).toBe(true);
      expect(isNonTerminalState(LOOPER_STATES.STATE_COMPLETED)).toBe(false);
      expect(isNonTerminalState(LOOPER_STATES.STATE_ABORTED)).toBe(false);
    });

    it("validates arbitrary state strings with isValidState", () => {
      expect(isValidState("STATE_INIT")).toBe(true);
      expect(isValidState("STATE_PLAN_DECOMPOSE")).toBe(true);
      expect(isValidState("STATE_VICTORY_TRIAGE")).toBe(true);
      expect(isValidState("INVALID_STATE")).toBe(false);
      expect(isValidState(null)).toBe(false);
      expect(isValidState(123)).toBe(false);
    });
  });

  describe("FSM Domain Events", () => {
    it("defines all 37 distinct domain events", () => {
      const events = Object.values(LOOPER_EVENTS);
      expect(events.length).toBe(37);

      const uniqueEvents = new Set(events);
      expect(uniqueEvents.size).toBe(37);
    });

    it("validates arbitrary event strings with isValidEvent", () => {
      expect(isValidEvent("EVT_INIT_SUCCESS")).toBe(true);
      expect(isValidEvent("EVT_G0_PASS_FAST_TRACK")).toBe(true);
      expect(isValidEvent("EVT_TRIAGE_REOPENED")).toBe(true);
      expect(isValidEvent("EVT_NON_EXISTENT")).toBe(false);
      expect(isValidEvent(undefined)).toBe(false);
    });
  });

  describe("16-State Transition Matrix & Rules Completeness", () => {
    it("contains exactly 39 transition rules across the 16 non-terminal states", () => {
      expect(FSM_TRANSITION_RULES.length).toBe(
        FSM_CONSTANTS.TOTAL_TRANSITIONS_COUNT
      );
      expect(FSM_TRANSITION_RULES.length).toBe(39);
    });

    it("ensures every non-terminal state has declared transitions in FSM_TRANSITION_MATRIX", () => {
      for (const state of NON_TERMINAL_STATES) {
        const transitions = FSM_TRANSITION_MATRIX[state];
        expect(transitions).toBeDefined();
        expect(transitions.length).toBeGreaterThan(0);
      }
    });

    it("ensures terminal states have zero outgoing transitions", () => {
      expect(
        FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_COMPLETED].length
      ).toBe(0);
      expect(FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_ABORTED].length).toBe(
        0
      );
      expect(
        getAllowedNextStates(LOOPER_STATES.STATE_COMPLETED).length
      ).toBe(0);
      expect(
        getAllowedNextStates(LOOPER_STATES.STATE_ABORTED).length
      ).toBe(0);
    });

    it("ensures every transition rule references valid states and events", () => {
      for (const rule of FSM_TRANSITION_RULES) {
        expect(isValidState(rule.fromState)).toBe(true);
        expect(isValidState(rule.toState)).toBe(true);
        expect(isValidEvent(rule.event)).toBe(true);
        expect(rule.guardCondition).toBeDefined();
        expect(rule.guardCondition.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Graph Topology, Reachability & Livelock Prevention Invariants", () => {
    it("guarantees 100% reachability from STATE_INIT to all 18 states (BFS)", () => {
      const visited = new Set<LooperState>([LOOPER_STATES.STATE_INIT]);
      const queue: LooperState[] = [LOOPER_STATES.STATE_INIT];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbors = FSM_STATE_ADJACENCY[current] ?? [];
        for (const next of neighbors) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }

      expect(visited.size).toBe(18);
      for (const state of Object.values(LOOPER_STATES)) {
        expect(visited.has(state)).toBe(true);
      }
    });

    it("guarantees every non-terminal state can reach a terminal state", () => {
      const terminalSet = new Set<LooperState>([
        LOOPER_STATES.STATE_COMPLETED,
        LOOPER_STATES.STATE_ABORTED,
      ]);

      for (const startState of NON_TERMINAL_STATES) {
        const visited = new Set<LooperState>([startState]);
        const queue: LooperState[] = [startState];
        let reachesTerminal = false;

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (terminalSet.has(current)) {
            reachesTerminal = true;
            break;
          }
          const neighbors = FSM_STATE_ADJACENCY[current] ?? [];
          for (const next of neighbors) {
            if (!visited.has(next)) {
              visited.add(next);
              queue.push(next);
            }
          }
        }

        expect(reachesTerminal).toBe(true);
      }
    });

    it("verifies Fast-Track policy transitions directly from Gate 0 to Gate 3", () => {
      const fastTrackRule = findTransitionRule(
        LOOPER_STATES.STATE_GATE_0_AUTO,
        LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK
      );
      expect(fastTrackRule).toBeDefined();
      expect(fastTrackRule?.toState).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
    });

    it("verifies Victory Audit livelock elimination via STATE_VICTORY_TRIAGE", () => {
      const failRule = findTransitionRule(
        LOOPER_STATES.STATE_VICTORY_AUDIT,
        LOOPER_EVENTS.EVT_VICTORY_FAIL
      );
      expect(failRule).toBeDefined();
      expect(failRule?.toState).toBe(LOOPER_STATES.STATE_VICTORY_TRIAGE);

      // Verify STATE_VICTORY_TRIAGE can re-open tasks or abort
      const reopenRule = findTransitionRule(
        LOOPER_STATES.STATE_VICTORY_TRIAGE,
        LOOPER_EVENTS.EVT_TRIAGE_REOPENED
      );
      expect(reopenRule).toBeDefined();
      expect(reopenRule?.toState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      const blockRule = findTransitionRule(
        LOOPER_STATES.STATE_VICTORY_TRIAGE,
        LOOPER_EVENTS.EVT_TRIAGE_BLOCKED
      );
      expect(blockRule).toBeDefined();
      expect(blockRule?.toState).toBe(LOOPER_STATES.STATE_ABORTED);
    });

    it("verifies Explorer role lifecycle states and transitions", () => {
      const dispatchRule = findTransitionRule(
        LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        LOOPER_EVENTS.EVT_TASK_SELECTED_EXPLORER
      );
      expect(dispatchRule).toBeDefined();
      expect(dispatchRule?.toState).toBe(LOOPER_STATES.STATE_DISPATCH_EXPLORER);

      const executeRule = findTransitionRule(
        LOOPER_STATES.STATE_DISPATCH_EXPLORER,
        LOOPER_EVENTS.EVT_EXPLORER_SPAWNED
      );
      expect(executeRule).toBeDefined();
      expect(executeRule?.toState).toBe(LOOPER_STATES.STATE_EXECUTE_EXPLORER);

      const completeRule = findTransitionRule(
        LOOPER_STATES.STATE_EXECUTE_EXPLORER,
        LOOPER_EVENTS.EVT_EXPLORATION_COMPLETE
      );
      expect(completeRule).toBeDefined();
      expect(completeRule?.toState).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
    });

    it("verifies dirty tree retention in STATE_ESCALATE_DIAGNOSTIC before rollback", () => {
      // Gate 0 exhausted transitions to ESCALATE_DIAGNOSTIC (not direct rollback)
      const g0Exhausted = findTransitionRule(
        LOOPER_STATES.STATE_GATE_0_AUTO,
        LOOPER_EVENTS.EVT_G0_EXHAUSTED
      );
      expect(g0Exhausted?.toState).toBe(
        LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC
      );

      // Gate 1 reject transitions to ESCALATE_DIAGNOSTIC
      const g1Reject = findTransitionRule(
        LOOPER_STATES.STATE_GATE_1_REVIEW,
        LOOPER_EVENTS.EVT_G1_REJECT
      );
      expect(g1Reject?.toState).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);

      // Gate 2 exhausted transitions to ESCALATE_DIAGNOSTIC
      const g2Exhausted = findTransitionRule(
        LOOPER_STATES.STATE_GATE_2_CHALLENGE,
        LOOPER_EVENTS.EVT_G2_EXHAUSTED
      );
      expect(g2Exhausted?.toState).toBe(
        LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC
      );

      // Gate 3 veto transitions to ESCALATE_DIAGNOSTIC
      const g3Veto = findTransitionRule(
        LOOPER_STATES.STATE_GATE_3_AUDIT,
        LOOPER_EVENTS.EVT_G3_VETO
      );
      expect(g3Veto?.toState).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);

      // ESCALATE_DIAGNOSTIC can then proceed to rollback
      const rollbackRequired = findTransitionRule(
        LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
        LOOPER_EVENTS.EVT_ROLLBACK_REQUIRED
      );
      expect(rollbackRequired?.toState).toBe(
        LOOPER_STATES.STATE_ROLLBACK_RECOVERY
      );
    });

    it("verifies 16-spawn succession transitions at task boundaries", () => {
      // From PLAN_DECOMPOSE
      const planSuccession = findTransitionRule(
        LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        LOOPER_EVENTS.EVT_SPAWN_LIMIT
      );
      expect(planSuccession?.toState).toBe(LOOPER_STATES.STATE_SUCCESSION);

      // From COMMIT_CHECKPOINT
      const commitSuccession = findTransitionRule(
        LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
        LOOPER_EVENTS.EVT_SPAWN_LIMIT
      );
      expect(commitSuccession?.toState).toBe(LOOPER_STATES.STATE_SUCCESSION);

      // Return to PLAN_DECOMPOSE
      const successionReturn = findTransitionRule(
        LOOPER_STATES.STATE_SUCCESSION,
        LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE
      );
      expect(successionReturn?.toState).toBe(
        LOOPER_STATES.STATE_PLAN_DECOMPOSE
      );
    });
  });

  describe("Transition Helpers & Lookup Functions", () => {
    it("retrieves allowed next states and events correctly", () => {
      const initNextStates = getAllowedNextStates(LOOPER_STATES.STATE_INIT);
      expect(initNextStates).toEqual([
        LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        LOOPER_STATES.STATE_ABORTED,
      ]);

      const initEvents = getAllowedEvents(LOOPER_STATES.STATE_INIT);
      expect(initEvents).toEqual([
        LOOPER_EVENTS.EVT_INIT_SUCCESS,
        LOOPER_EVENTS.EVT_FATAL_ERROR,
      ]);
    });

    it("checks canTransition and isValidNextState correctly", () => {
      expect(
        canTransition(
          LOOPER_STATES.STATE_INIT,
          LOOPER_EVENTS.EVT_INIT_SUCCESS
        )
      ).toBe(true);
      expect(
        canTransition(
          LOOPER_STATES.STATE_INIT,
          LOOPER_EVENTS.EVT_WORK_SUBMITTED
        )
      ).toBe(false);

      expect(
        isValidNextState(
          LOOPER_STATES.STATE_INIT,
          LOOPER_STATES.STATE_PLAN_DECOMPOSE
        )
      ).toBe(true);
      expect(
        isValidNextState(
          LOOPER_STATES.STATE_INIT,
          LOOPER_STATES.STATE_COMMIT_CHECKPOINT
        )
      ).toBe(false);
    });
  });

  describe("InvalidStateTransitionError Taxonomy", () => {
    it("instantiates InvalidStateTransitionError with complete diagnostic information", () => {
      const error = new InvalidStateTransitionError(
        LOOPER_STATES.STATE_INIT,
        LOOPER_EVENTS.EVT_WORK_SUBMITTED,
        undefined,
        LOOPER_STATES.STATE_COMMIT_CHECKPOINT
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidStateTransition);
      expect(error.name).toBe("InvalidStateTransitionError");
      expect(error.fromState).toBe(LOOPER_STATES.STATE_INIT);
      expect(error.event).toBe(LOOPER_EVENTS.EVT_WORK_SUBMITTED);
      expect(error.toState).toBe(LOOPER_STATES.STATE_COMMIT_CHECKPOINT);
      expect(error.message).toContain("[InvalidStateTransitionError]");
      expect(error.message).toContain("STATE_INIT");
      expect(error.message).toContain("EVT_WORK_SUBMITTED");
      expect(error.message).toContain("STATE_COMMIT_CHECKPOINT");
    });

    it("formats message when target state is omitted", () => {
      const error = new InvalidStateTransitionError(
        LOOPER_STATES.STATE_GATE_1_REVIEW,
        LOOPER_EVENTS.EVT_G0_PASS
      );

      expect(error.message).toContain("STATE_GATE_1_REVIEW");
      expect(error.message).toContain("EVT_G0_PASS");
      expect(error.toState).toBeUndefined();
    });
  });
});
