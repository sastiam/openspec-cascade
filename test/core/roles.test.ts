import { describe, expect, it } from "bun:test";
import {
  ALL_COGNITIVE_ROLES,
  COGNITIVE_ROLE_MATRIX,
  COGNITIVE_ROLES,
  HANDOFF_COMPONENTS,
  InvalidCognitiveRoleError,
  ROLES_CONSTANTS,
  ROLE_ALIASES,
  SPECIALIZED_SUBAGENT_ROLES,
  canRoleDispatch,
  formatBriefingContent,
  formatDispatchContent,
  formatHandoffTemplate,
  formatProgressContent,
  generateRoleSystemPrompt,
  getAllRoles,
  getRoleByTier,
  getRoleDefinition,
  getSpecializedSubagentRoles,
  isCodeMutationAllowed,
  isTestExecutionAllowed,
  isValidRole,
  isValidTier,
  normalizeRole,
  roleHoldsBinaryVeto,
  validateWritePath,
  type CognitiveRole,
  type RoleTier,
} from "../../src/core/roles";

describe("Cognitive Role Specialization Matrix & System Prompts (LOOPER-CORE-003 / Task 1.1)", () => {
  describe("Role Constants & Enumerations", () => {
    it("defines exactly 7 cognitive roles and 6 specialized subagents", () => {
      expect(ROLES_CONSTANTS.TOTAL_ROLES_COUNT).toBe(7);
      expect(ROLES_CONSTANTS.SPECIALIZED_SUBAGENTS_COUNT).toBe(6);
      expect(ROLES_CONSTANTS.TOTAL_TIERS_COUNT).toBe(7);
      expect(ALL_COGNITIVE_ROLES.length).toBe(7);
      expect(SPECIALIZED_SUBAGENT_ROLES.length).toBe(6);
    });

    it("orders roles correctly from Tier 0 to Tier 6", () => {
      expect(ROLES_CONSTANTS.TIER_SENTINEL).toBe(0);
      expect(ROLES_CONSTANTS.TIER_ORCHESTRATOR).toBe(1);
      expect(ROLES_CONSTANTS.TIER_EXPLORER).toBe(2);
      expect(ROLES_CONSTANTS.TIER_WORKER).toBe(3);
      expect(ROLES_CONSTANTS.TIER_REVIEWER).toBe(4);
      expect(ROLES_CONSTANTS.TIER_CHALLENGER).toBe(5);
      expect(ROLES_CONSTANTS.TIER_AUDITOR).toBe(6);

      const tiers = ALL_COGNITIVE_ROLES.map((r) => COGNITIVE_ROLE_MATRIX[r].tier);
      expect(tiers).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("verifies specialized subagent roles exclude Sentinel Tier 0", () => {
      expect(SPECIALIZED_SUBAGENT_ROLES).not.toContain(COGNITIVE_ROLES.SENTINEL);
      expect(SPECIALIZED_SUBAGENT_ROLES).toEqual([
        COGNITIVE_ROLES.ORCHESTRATOR,
        COGNITIVE_ROLES.EXPLORER,
        COGNITIVE_ROLES.WORKER,
        COGNITIVE_ROLES.REVIEWER,
        COGNITIVE_ROLES.CHALLENGER,
        COGNITIVE_ROLES.AUDITOR,
      ]);
    });

    it("exports default constants conforming to Antigravity Teamwork specifications", () => {
      expect(ROLES_CONSTANTS.DEFAULT_ROLE).toBe("worker");
      expect(ROLES_CONSTANTS.MAX_BRIEFING_LINES).toBe(100);
      expect(ROLES_CONSTANTS.HEARTBEAT_INTERVAL_MINUTES).toBe(5);
      expect(ROLES_CONSTANTS.MAX_ORCHESTRATOR_SPAWNS).toBe(16);
    });
  });

  describe("Cognitive Role Matrix & Permissions", () => {
    it("defines every role with complete, non-empty metadata", () => {
      for (const role of ALL_COGNITIVE_ROLES) {
        const def = COGNITIVE_ROLE_MATRIX[role];
        expect(def.role).toBe(role);
        expect(def.archetype.length).toBeGreaterThan(0);
        expect(def.displayName.length).toBeGreaterThan(0);
        expect(def.coreResponsibility.length).toBeGreaterThan(0);
        expect(def.inputs.length).toBeGreaterThan(0);
        expect(def.primaryOutputs.length).toBeGreaterThan(0);
        expect(def.recommendedProvider.length).toBeGreaterThan(0);
        expect(def.recommendedModel.length).toBeGreaterThan(0);
        expect(def.systemPrompt.length).toBeGreaterThan(0);
        expect(def.requiredHandoffSections).toEqual([...HANDOFF_COMPONENTS]);
      }
    });

    it("enforces strict cognitive permissions per role according to spec axioms", () => {
      // 1. Sentinel (Tier 0)
      const sentinel = COGNITIVE_ROLE_MATRIX[COGNITIVE_ROLES.SENTINEL];
      expect(sentinel.permissions.canEditCode).toBe(false);
      expect(sentinel.permissions.canRunTests).toBe(false);
      expect(sentinel.permissions.canCommitOrPush).toBe(false);
      expect(sentinel.permissions.canDispatchSubagents).toBe(true);
      expect(sentinel.permissions.holdsBinaryVeto).toBe(false);

      // 2. Orchestrator (Tier 1)
      const orchestrator = COGNITIVE_ROLE_MATRIX[COGNITIVE_ROLES.ORCHESTRATOR];
      expect(orchestrator.permissions.canEditCode).toBe(false);
      expect(orchestrator.permissions.canRunTests).toBe(false);
      expect(orchestrator.permissions.canCommitOrPush).toBe(false);
      expect(orchestrator.permissions.canDispatchSubagents).toBe(true);
      expect(orchestrator.permissions.holdsBinaryVeto).toBe(false);

      // 3. Explorer (Tier 2)
      const explorer = COGNITIVE_ROLE_MATRIX[COGNITIVE_ROLES.EXPLORER];
      expect(explorer.permissions.canEditCode).toBe(false);
      expect(explorer.permissions.canRunTests).toBe(false);
      expect(explorer.permissions.canCommitOrPush).toBe(false);
      expect(explorer.permissions.canDispatchSubagents).toBe(false);
      expect(explorer.permissions.holdsBinaryVeto).toBe(false);

      // 4. Worker (Tier 3) - Sole role permitted to edit application code
      const worker = COGNITIVE_ROLE_MATRIX[COGNITIVE_ROLES.WORKER];
      expect(worker.permissions.canEditCode).toBe(true);
      expect(worker.permissions.canRunTests).toBe(true);
      expect(worker.permissions.canCommitOrPush).toBe(false);
      expect(worker.permissions.canDispatchSubagents).toBe(false);
      expect(worker.permissions.holdsBinaryVeto).toBe(false);

      // 5. Reviewer (Tier 4)
      const reviewer = COGNITIVE_ROLE_MATRIX[COGNITIVE_ROLES.REVIEWER];
      expect(reviewer.permissions.canEditCode).toBe(false);
      expect(reviewer.permissions.canRunTests).toBe(false);
      expect(reviewer.permissions.canCommitOrPush).toBe(false);
      expect(reviewer.permissions.canDispatchSubagents).toBe(false);
      expect(reviewer.permissions.holdsBinaryVeto).toBe(false);

      // 6. Challenger (Tier 5) - Author test probes and run tests
      const challenger = COGNITIVE_ROLE_MATRIX[COGNITIVE_ROLES.CHALLENGER];
      expect(challenger.permissions.canEditCode).toBe(false);
      expect(challenger.permissions.canRunTests).toBe(true);
      expect(challenger.permissions.canCommitOrPush).toBe(false);
      expect(challenger.permissions.canDispatchSubagents).toBe(false);
      expect(challenger.permissions.holdsBinaryVeto).toBe(false);

      // 7. Auditor (Tier 6) - Sole role holding binary veto
      const auditor = COGNITIVE_ROLE_MATRIX[COGNITIVE_ROLES.AUDITOR];
      expect(auditor.permissions.canEditCode).toBe(false);
      expect(auditor.permissions.canRunTests).toBe(true);
      expect(auditor.permissions.canCommitOrPush).toBe(false);
      expect(auditor.permissions.canDispatchSubagents).toBe(false);
      expect(auditor.permissions.holdsBinaryVeto).toBe(true);
    });

    it("ensures zero agents are permitted to git commit or push", () => {
      for (const role of ALL_COGNITIVE_ROLES) {
        expect(COGNITIVE_ROLE_MATRIX[role].permissions.canCommitOrPush).toBe(false);
      }
    });

    it("ensures every agent has permission to write within its own teamwork sandbox", () => {
      for (const role of ALL_COGNITIVE_ROLES) {
        expect(COGNITIVE_ROLE_MATRIX[role].permissions.canWriteOwnFolder).toBe(true);
      }
    });
  });

  describe("Role Normalization, Aliases & Type Guards", () => {
    it("validates canonical roles with isValidRole", () => {
      for (const role of ALL_COGNITIVE_ROLES) {
        expect(isValidRole(role)).toBe(true);
      }
      expect(isValidRole("implementer")).toBe(false);
      expect(isValidRole("invalid_role")).toBe(false);
      expect(isValidRole("")).toBe(false);
      expect(isValidRole(null)).toBe(false);
      expect(isValidRole(undefined)).toBe(false);
      expect(isValidRole(42)).toBe(false);
    });

    it("validates role tiers with isValidTier", () => {
      for (let i = 0; i <= 6; i++) {
        expect(isValidTier(i)).toBe(true);
      }
      expect(isValidTier(-1)).toBe(false);
      expect(isValidTier(7)).toBe(false);
      expect(isValidTier(1.5)).toBe(false);
      expect(isValidTier("3")).toBe(false);
      expect(isValidTier(null)).toBe(false);
    });

    it("normalizes canonical roles and case-insensitive strings", () => {
      expect(normalizeRole("worker")).toBe(COGNITIVE_ROLES.WORKER);
      expect(normalizeRole("Worker")).toBe(COGNITIVE_ROLES.WORKER);
      expect(normalizeRole("  WORKER  ")).toBe(COGNITIVE_ROLES.WORKER);
      expect(normalizeRole("explorer")).toBe(COGNITIVE_ROLES.EXPLORER);
      expect(normalizeRole("auditor")).toBe(COGNITIVE_ROLES.AUDITOR);
    });

    it("resolves all defined archetype aliases accurately", () => {
      expect(normalizeRole("implementer")).toBe(COGNITIVE_ROLES.WORKER);
      expect(normalizeRole("developer")).toBe(COGNITIVE_ROLES.WORKER);
      expect(normalizeRole("coder")).toBe(COGNITIVE_ROLES.WORKER);

      expect(normalizeRole("qa")).toBe(COGNITIVE_ROLES.REVIEWER);
      expect(normalizeRole("critic")).toBe(COGNITIVE_ROLES.REVIEWER);

      expect(normalizeRole("specialist")).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(normalizeRole("adversarial_challenger")).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(normalizeRole("adversarial-challenger")).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(normalizeRole("red_team")).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(normalizeRole("red-team")).toBe(COGNITIVE_ROLES.CHALLENGER);

      expect(normalizeRole("forensic_auditor")).toBe(COGNITIVE_ROLES.AUDITOR);
      expect(normalizeRole("forensic-auditor")).toBe(COGNITIVE_ROLES.AUDITOR);
      expect(normalizeRole("victory_auditor")).toBe(COGNITIVE_ROLES.AUDITOR);
      expect(normalizeRole("victory-auditor")).toBe(COGNITIVE_ROLES.AUDITOR);

      expect(normalizeRole("planner")).toBe(COGNITIVE_ROLES.ORCHESTRATOR);
      expect(normalizeRole("scheduler")).toBe(COGNITIVE_ROLES.ORCHESTRATOR);

      expect(normalizeRole("guardian")).toBe(COGNITIVE_ROLES.SENTINEL);
      expect(normalizeRole("watchdog")).toBe(COGNITIVE_ROLES.SENTINEL);
    });

    it("throws InvalidCognitiveRoleError for unknown roles or empty strings", () => {
      expect(() => normalizeRole("")).toThrow(InvalidCognitiveRoleError);
      expect(() => normalizeRole("   ")).toThrow(InvalidCognitiveRoleError);
      expect(() => normalizeRole("non_existent")).toThrow(InvalidCognitiveRoleError);

      try {
        normalizeRole("superman");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidCognitiveRoleError);
        const roleErr = err as InvalidCognitiveRoleError;
        expect(roleErr.requestedRole).toBe("superman");
        expect(roleErr.validRoles).toContain("worker");
      }
    });
  });

  describe("Matrix Query Helpers", () => {
    it("retrieves role definitions via getRoleDefinition with alias support", () => {
      const workerDef = getRoleDefinition("worker");
      const implementerDef = getRoleDefinition("implementer");
      expect(workerDef).toBe(implementerDef);
      expect(workerDef.tier).toBe(3);
    });

    it("retrieves role definition by tier with getRoleByTier", () => {
      expect(getRoleByTier(0)?.role).toBe(COGNITIVE_ROLES.SENTINEL);
      expect(getRoleByTier(1)?.role).toBe(COGNITIVE_ROLES.ORCHESTRATOR);
      expect(getRoleByTier(2)?.role).toBe(COGNITIVE_ROLES.EXPLORER);
      expect(getRoleByTier(3)?.role).toBe(COGNITIVE_ROLES.WORKER);
      expect(getRoleByTier(4)?.role).toBe(COGNITIVE_ROLES.REVIEWER);
      expect(getRoleByTier(5)?.role).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(getRoleByTier(6)?.role).toBe(COGNITIVE_ROLES.AUDITOR);

      expect(getRoleByTier(-1)).toBeUndefined();
      expect(getRoleByTier(7)).toBeUndefined();
      expect(getRoleByTier(99)).toBeUndefined();
    });

    it("retrieves all roles and specialized subagent roles", () => {
      const all = getAllRoles();
      expect(all.length).toBe(7);
      expect(all[0]?.role).toBe(COGNITIVE_ROLES.SENTINEL);
      expect(all[6]?.role).toBe(COGNITIVE_ROLES.AUDITOR);

      const subagents = getSpecializedSubagentRoles();
      expect(subagents.length).toBe(6);
      expect(subagents.every((s) => s.role !== COGNITIVE_ROLES.SENTINEL)).toBe(true);
    });

    it("evaluates permission checks correctly via helper functions", () => {
      expect(isCodeMutationAllowed("worker")).toBe(true);
      expect(isCodeMutationAllowed("implementer")).toBe(true);
      expect(isCodeMutationAllowed("explorer")).toBe(false);
      expect(isCodeMutationAllowed("auditor")).toBe(false);
      expect(isCodeMutationAllowed("invalid")).toBe(false);

      expect(isTestExecutionAllowed("worker")).toBe(true);
      expect(isTestExecutionAllowed("challenger")).toBe(true);
      expect(isTestExecutionAllowed("auditor")).toBe(true);
      expect(isTestExecutionAllowed("explorer")).toBe(false);
      expect(isTestExecutionAllowed("reviewer")).toBe(false);

      expect(canRoleDispatch("orchestrator")).toBe(true);
      expect(canRoleDispatch("sentinel")).toBe(true);
      expect(canRoleDispatch("worker")).toBe(false);
      expect(canRoleDispatch("explorer")).toBe(false);

      expect(roleHoldsBinaryVeto("auditor")).toBe(true);
      expect(roleHoldsBinaryVeto("forensic_auditor")).toBe(true);
      expect(roleHoldsBinaryVeto("reviewer")).toBe(false);
      expect(roleHoldsBinaryVeto("worker")).toBe(false);
    });
  });

  describe("Path Validation & Access Control (validateWritePath)", () => {
    it("blocks writes to .git repository internals for all roles", () => {
      const roles = ["worker", "orchestrator", "auditor", "explorer"];
      for (const r of roles) {
        const res1 = validateWritePath(r, ".git/config");
        expect(res1.allowed).toBe(false);
        expect(res1.reason).toContain(".git");

        const res2 = validateWritePath(r, "some/path/.git/HEAD");
        expect(res2.allowed).toBe(false);
      }
    });

    it("blocks writes to in-repo skills under .agents/skills/ for all roles", () => {
      const res = validateWritePath("worker", ".agents/skills/my-skill/SKILL.md");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain(".agents/skills/");
    });

    it("allows any role to write within its own allocated sandbox folder", () => {
      const sandbox = ".agents/teamwork/explorer_42";
      const res = validateWritePath("explorer", ".agents/teamwork/explorer_42/handoff.md", sandbox);
      expect(res.allowed).toBe(true);

      const res2 = validateWritePath("auditor", ".agents/teamwork/auditor_01/report.md", ".agents/teamwork/auditor_01");
      expect(res2.allowed).toBe(true);
    });

    it("allows Worker to write to src/, test/, and teamwork folders", () => {
      expect(validateWritePath("worker", "src/core/dispatcher.ts").allowed).toBe(true);
      expect(validateWritePath("worker", "test/core/dispatcher.test.ts").allowed).toBe(true);
      expect(validateWritePath("worker", ".agents/teamwork/worker_1/progress.md").allowed).toBe(true);
      expect(validateWritePath("worker", "projects/agnostic_looper/SPECIFICATION.md").allowed).toBe(false);
    });

    it("allows Challenger to write only test probes under test/challenger*.test.ts", () => {
      expect(validateWritePath("challenger", "test/challenger_task1.test.ts").allowed).toBe(true);
      expect(validateWritePath("challenger", "test/challenger_fuzz.spec.ts").allowed).toBe(true);
      expect(validateWritePath("challenger", "src/core/dag.ts").allowed).toBe(false);
      expect(validateWritePath("challenger", "test/core/dag.test.ts").allowed).toBe(false);
    });

    it("allows Orchestrator to update task lists and teamwork files, but not source code", () => {
      expect(validateWritePath("orchestrator", "openspec/changes/feature/tasks.md").allowed).toBe(true);
      expect(validateWritePath("orchestrator", ".agents/teamwork/orchestrator/DISPATCH.md").allowed).toBe(true);
      expect(validateWritePath("orchestrator", "src/core/fsm.ts").allowed).toBe(false);
      expect(validateWritePath("orchestrator", "test/core/fsm.test.ts").allowed).toBe(false);
    });

    it("blocks Explorer, Reviewer, and Auditor from modifying workspace source code", () => {
      expect(validateWritePath("explorer", "src/main.ts").allowed).toBe(false);
      expect(validateWritePath("reviewer", "src/main.ts").allowed).toBe(false);
      expect(validateWritePath("auditor", "src/main.ts").allowed).toBe(false);
      expect(validateWritePath("sentinel", "src/main.ts").allowed).toBe(false);
    });

    it("handles invalid inputs gracefully", () => {
      expect(validateWritePath("invalid_role", "src/main.ts").allowed).toBe(false);
      expect(validateWritePath("worker", "").allowed).toBe(false);
    });
  });

  describe("Dynamic System Prompt Generation (generateRoleSystemPrompt)", () => {
    it("generates base system prompt for a role with execution directives", () => {
      const prompt = generateRoleSystemPrompt("worker");
      expect(prompt).toContain("You are the Worker (Tier 3)");
      expect(prompt).toContain("THE HARNESS AND GATES ARE THE ORACLE");
      expect(prompt).toContain("ZERO MAGIC NUMBERS");
      expect(prompt).toContain("ZERO GIT CONTROL");
      expect(prompt).toContain("Execution & Handoff Directive");
      expect(prompt).toContain("Observation, Logic Chain, Caveats, Conclusion, Verification Method");
    });

    it("incorporates all context fields into the generated prompt", () => {
      const prompt = generateRoleSystemPrompt("worker", {
        agentId: "worker_task_1",
        taskKey: "LOOPER-CORE-003",
        taskTitle: "Cognitive Role Dispatcher",
        taskDescription: "Implement cognitive roles and dispatcher engine.",
        workingDirectory: ".agents/teamwork/worker_task_1",
        baselineSha: "a1b2c3d4e5",
        iterationCount: 2,
        maxIterations: 3,
        assignedSkills: ["openspec-cascade-runner", "openspec-apply-change"],
        constraints: ["Zero magic numbers", "Strict typing only"],
        contextSnapshot: "Previous test run failed on edge cases.",
        customInstructions: "Prioritize clean error handling.",
      });

      expect(prompt).toContain("worker_task_1");
      expect(prompt).toContain("LOOPER-CORE-003");
      expect(prompt).toContain("Cognitive Role Dispatcher");
      expect(prompt).toContain("Implement cognitive roles and dispatcher engine.");
      expect(prompt).toContain(".agents/teamwork/worker_task_1");
      expect(prompt).toContain("a1b2c3d4e5");
      expect(prompt).toContain("Current Iteration Attempt: 2 / 3");
      expect(prompt).toContain("- openspec-cascade-runner");
      expect(prompt).toContain("- openspec-apply-change");
      expect(prompt).toContain("- 🔒 Zero magic numbers");
      expect(prompt).toContain("- 🔒 Strict typing only");
      expect(prompt).toContain("Previous test run failed on edge cases.");
      expect(prompt).toContain("Prioritize clean error handling.");
    });

    it("generates tailored system prompts for each role archetype", () => {
      expect(generateRoleSystemPrompt("sentinel")).toContain("You are the Sentinel (Tier 0)");
      expect(generateRoleSystemPrompt("orchestrator")).toContain("You are the Orchestrator (Tier 1)");
      expect(generateRoleSystemPrompt("explorer")).toContain("You are the Explorer (Tier 2)");
      expect(generateRoleSystemPrompt("reviewer")).toContain("You are the Reviewer (Tier 4)");
      expect(generateRoleSystemPrompt("challenger")).toContain("You are the Adversarial Challenger (Tier 5)");
      expect(generateRoleSystemPrompt("auditor")).toContain("You are the Forensic Auditor (Tier 6)");
    });
  });

  describe("Antigravity Teamwork Coordination Templates", () => {
    describe("formatBriefingContent (BRIEFING.md)", () => {
      it("generates structured BRIEFING.md conforming to the <100 lines limit", () => {
        const briefing = formatBriefingContent("worker_001", "worker", {
          taskKey: "TASK-123",
          goal: "Implement subagent sandboxing",
        });

        const lineCount = briefing.split("\n").length;
        expect(lineCount).toBeLessThan(ROLES_CONSTANTS.MAX_BRIEFING_LINES);
        expect(briefing).toContain("# Agent Briefing: worker_001");
        expect(briefing).toContain("## 🔒 My Identity");
        expect(briefing).toContain("## 🔒 Key Constraints");
        expect(briefing).toContain("## Current Objective");
        expect(briefing).toContain("Implement subagent sandboxing");
        expect(briefing).toContain("## Recent Decisions & Context");
      });

      it("supports custom sections and custom constraints", () => {
        const briefing = formatBriefingContent("explorer_002", "explorer", {
          constraints: ["Do not mutate files", "Report findings within 15 minutes"],
          customSections: {
            "Diagnostic Scope": "Investigating memory leak in DAG scheduler.",
          },
        });

        expect(briefing).toContain("- 🔒 Do not mutate files");
        expect(briefing).toContain("## Diagnostic Scope");
        expect(briefing).toContain("Investigating memory leak in DAG scheduler.");
      });
    });

    describe("formatProgressContent (progress.md)", () => {
      it("generates progress.md with timestamped heartbeat telemetry", () => {
        const progress = formatProgressContent("worker_001", "worker", "IN_PROGRESS");
        expect(progress).toContain("# Progress Telemetry: worker_001");
        expect(progress).toContain("**Status**: IN_PROGRESS");
        expect(progress).toContain("**Last Visited**:");
        expect(progress).toContain(`**Heartbeat Interval**: ${ROLES_CONSTANTS.HEARTBEAT_INTERVAL_MINUTES} minutes`);
        expect(progress).toContain("## Activity Log");
      });
    });

    describe("formatDispatchContent (DISPATCH.md)", () => {
      it("generates DISPATCH.md with mission, target scope, and skills", () => {
        const dispatch = formatDispatchContent("worker_001", "worker", {
          taskKey: "LOOPER-CORE-003",
          prompt: "Build isolated sandbox manager.",
          targetFiles: ["src/core/dispatcher.ts", "test/core/dispatcher.test.ts"],
          skills: ["openspec-cascade-runner"],
        });

        expect(dispatch).toContain("# Dispatch Manifest: worker_001");
        expect(dispatch).toContain("**Task Key**: `LOOPER-CORE-003`");
        expect(dispatch).toContain("Build isolated sandbox manager.");
        expect(dispatch).toContain("`src/core/dispatcher.ts`");
        expect(dispatch).toContain("`openspec-cascade-runner`");
        expect(dispatch).toContain("Allowed Permissions Summary");
      });
    });

    describe("formatHandoffTemplate (handoff.md)", () => {
      it("generates handoff report containing all 5 mandatory components", () => {
        const handoff = formatHandoffTemplate("worker_001", "worker", {
          observation: "Found missing role matrix definitions.",
          logicChain: "Defined canonical matrix and added validator functions.",
          caveats: "Requires dispatcher integration in task 1.2.",
          conclusion: "Task 1.1 successfully implemented and verified.",
          verificationMethod: "bun test test/core/roles.test.ts",
          verdict: "APPROVED",
          filesModified: ["src/core/roles.ts", "test/core/roles.test.ts"],
        });

        expect(handoff).toContain("# Handoff Report: worker_001");
        expect(handoff).toContain("**Verdict**: `APPROVED`");
        expect(handoff).toContain("## 1. Observation");
        expect(handoff).toContain("Found missing role matrix definitions.");
        expect(handoff).toContain("## 2. Logic Chain");
        expect(handoff).toContain("Defined canonical matrix and added validator functions.");
        expect(handoff).toContain("## 3. Caveats");
        expect(handoff).toContain("Requires dispatcher integration in task 1.2.");
        expect(handoff).toContain("## 4. Conclusion");
        expect(handoff).toContain("Task 1.1 successfully implemented and verified.");
        expect(handoff).toContain("## 5. Verification Method");
        expect(handoff).toContain("bun test test/core/roles.test.ts");
        expect(handoff).toContain("## Modified Files");
        expect(handoff).toContain("`src/core/roles.ts`");
      });
    });
  });
});
