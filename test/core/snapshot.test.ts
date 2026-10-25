import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COGNITIVE_ROLES,
  HANDOFF_COMPONENTS,
  ROLES_CONSTANTS,
  SubagentDispatcher,
  createSubagentDispatcher,
} from "../../src/core/dispatcher";
import {
  HandoffValidationError,
  InvalidSnapshotError,
  SNAPSHOT_CONSTANTS,
  SnapshotError,
  captureContextSnapshot,
  createDiagnosticHandoffPayload,
  createHandoffPayload,
  createSuccessionHandoffPayload,
  createSuccessionSnapshot,
  deserializeContextSnapshot,
  formatHandoffMarkdown,
  loadContextSnapshot,
  parseHandoffMarkdown,
  saveContextSnapshot,
  serializeContextSnapshot,
  validateHandoffReport,
  type AgentContextSnapshot,
  type HandoffPayload,
  type SnapshotTargetAgent,
  type SuccessionContextSnapshot,
} from "../../src/core/snapshot";

describe("Context Snapshotting & Handoff Payload Generator (LOOPER-CORE-003 / Task 1.3)", () => {
  let tempBaseDir: string;
  let dispatcher: SubagentDispatcher;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "looper-snapshot-test-"));
    dispatcher = createSubagentDispatcher({
      workspaceRoot: tempBaseDir,
      baseDir: join(tempBaseDir, ".agents/teamwork"),
      skillsDir: join(tempBaseDir, ".agents/skills"),
    });
  });

  afterEach(async () => {
    await dispatcher.destroy();
    if (existsSync(tempBaseDir)) {
      await rm(tempBaseDir, { recursive: true, force: true });
    }
  });

  describe("Snapshot Constants", () => {
    it("defines schema version and file names correctly", () => {
      expect(SNAPSHOT_CONSTANTS.SCHEMA_VERSION).toBe("1.0.0");
      expect(SNAPSHOT_CONSTANTS.FILE_SNAPSHOT).toBe("snapshot.json");
      expect(SNAPSHOT_CONSTANTS.FILE_SUCCESSION_SNAPSHOT).toBe("succession_snapshot.json");
      expect(SNAPSHOT_CONSTANTS.FILE_HANDOFF).toBe("handoff.md");
      expect(SNAPSHOT_CONSTANTS.FILE_BRIEFING).toBe("BRIEFING.md");
      expect(SNAPSHOT_CONSTANTS.FILE_PROGRESS).toBe("progress.md");
      expect(SNAPSHOT_CONSTANTS.FILE_DISPATCH).toBe("DISPATCH.md");
    });

    it("defines all 5 standard handoff components", () => {
      expect(SNAPSHOT_CONSTANTS.COMPONENT_OBSERVATION).toBe("Observation");
      expect(SNAPSHOT_CONSTANTS.COMPONENT_LOGIC_CHAIN).toBe("Logic Chain");
      expect(SNAPSHOT_CONSTANTS.COMPONENT_CAVEATS).toBe("Caveats");
      expect(SNAPSHOT_CONSTANTS.COMPONENT_CONCLUSION).toBe("Conclusion");
      expect(SNAPSHOT_CONSTANTS.COMPONENT_VERIFICATION_METHOD).toBe("Verification Method");
      expect(SNAPSHOT_CONSTANTS.SECTION_INDEX_OBSERVATION).toBe(1);
      expect(SNAPSHOT_CONSTANTS.SECTION_INDEX_LOGIC_CHAIN).toBe(2);
      expect(SNAPSHOT_CONSTANTS.SECTION_INDEX_CAVEATS).toBe(3);
      expect(SNAPSHOT_CONSTANTS.SECTION_INDEX_CONCLUSION).toBe(4);
      expect(SNAPSHOT_CONSTANTS.SECTION_INDEX_VERIFICATION_METHOD).toBe(5);
    });

    it("defines succession triggers and handoff types", () => {
      expect(SNAPSHOT_CONSTANTS.HANDOFF_TYPE_COMPLETION).toBe("completion");
      expect(SNAPSHOT_CONSTANTS.HANDOFF_TYPE_SOFT).toBe("soft");
      expect(SNAPSHOT_CONSTANTS.HANDOFF_TYPE_HARD).toBe("hard");
      expect(SNAPSHOT_CONSTANTS.HANDOFF_TYPE_ESCALATION).toBe("escalation");

      expect(SNAPSHOT_CONSTANTS.REASON_SPAWN_LIMIT).toBe("SPAWN_LIMIT_REACHED");
      expect(SNAPSHOT_CONSTANTS.REASON_TOKEN_WATERMARK).toBe("TOKEN_WATERMARK_80");
      expect(SNAPSHOT_CONSTANTS.REASON_MANUAL_SUCCESSION).toBe("MANUAL_SUCCESSION");
    });
  });

  describe("Handoff Payload Generator", () => {
    it("generates a valid HandoffPayload with all 5 mandatory components", () => {
      const payload = createHandoffPayload({
        agentId: "worker_1",
        role: "worker",
        taskId: "TASK-101",
        verdict: "APPROVED",
        handoffType: "completion",
        observation: "Completed implementation of subagent sandbox isolation.",
        logicChain: "Added mkdir for sandboxes and write path validators.",
        caveats: "Requires Gate 0 mechanical test execution.",
        conclusion: "Code is clean, strictly typed, and ready for review.",
        verificationMethod: "bun test test/core/snapshot.test.ts",
        modifiedFiles: ["src/core/snapshot.ts", "src/core/dispatcher.ts"],
        testResults: {
          passed: true,
          command: "bun test",
          exitCode: 0,
        },
      });

      expect(payload.agentId).toBe("worker_1");
      expect(payload.role).toBe(COGNITIVE_ROLES.WORKER);
      expect(payload.tier).toBe(3);
      expect(payload.taskId).toBe("TASK-101");
      expect(payload.verdict).toBe("APPROVED");
      expect(payload.handoffType).toBe("completion");
      expect(payload.observation).toContain("Completed implementation");
      expect(payload.logicChain).toContain("Added mkdir");
      expect(payload.caveats).toContain("Requires Gate 0");
      expect(payload.conclusion).toContain("ready for review");
      expect(payload.verificationMethod).toBe("bun test test/core/snapshot.test.ts");
      expect(payload.modifiedFiles).toEqual([
        "src/core/snapshot.ts",
        "src/core/dispatcher.ts",
      ]);
      expect(payload.testResults?.passed).toBe(true);
      expect(payload.testResults?.exitCode).toBe(0);
      expect(typeof payload.timestamp).toBe("string");
    });

    it("throws HandoffValidationError when mandatory sections are missing or empty", () => {
      expect(() =>
        createHandoffPayload({
          agentId: "worker_1",
          role: "worker",
          observation: "",
          logicChain: "valid logic",
          caveats: "valid caveats",
          conclusion: "valid conclusion",
          verificationMethod: "bun test",
        })
      ).toThrow(HandoffValidationError);

      try {
        createHandoffPayload({
          agentId: "worker_1",
          role: "worker",
          observation: "valid obs",
          logicChain: "   ",
          caveats: "valid caveats",
          conclusion: "",
          verificationMethod: "bun test",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HandoffValidationError);
        const valErr = err as HandoffValidationError;
        expect(valErr.missingSections).toContain("Logic Chain");
        expect(valErr.missingSections).toContain("Conclusion");
      }
    });

    it("formats structured markdown and roundtrips via parseHandoffMarkdown", () => {
      const original = createHandoffPayload({
        agentId: "explorer_survey_1",
        role: "explorer",
        taskId: "EXP-001",
        verdict: "COMPLETED",
        handoffType: "completion",
        observation: "Surveyed codebase and identified 4 PAL adapter candidates.",
        logicChain: "Decoupled turn normalizers from vendor protocols using Hexagonal ports.",
        caveats: "Gemini requires alternation folding for multi-turn conversations.",
        conclusion: "Adopt PAL turn folding invariant across adapters.",
        verificationMethod: "bun test test/pal/gemini.test.ts",
        modifiedFiles: ["src/pal/types.ts", "src/pal/normalizer.ts"],
        testResults: {
          passed: true,
          command: "bun test test/pal/",
          exitCode: 0,
        },
      });

      const markdown = formatHandoffMarkdown(original);

      expect(markdown).toContain("# Handoff Report: explorer_survey_1");
      expect(markdown).toContain("- **Author**: explorer_survey_1");
      expect(markdown).toContain("- **Verdict**: `COMPLETED`");
      expect(markdown).toContain("## 1. Observation");
      expect(markdown).toContain(original.observation);
      expect(markdown).toContain("## 2. Logic Chain");
      expect(markdown).toContain(original.logicChain);
      expect(markdown).toContain("## 3. Caveats");
      expect(markdown).toContain(original.caveats);
      expect(markdown).toContain("## 4. Conclusion");
      expect(markdown).toContain(original.conclusion);
      expect(markdown).toContain("## 5. Verification Method");
      expect(markdown).toContain(original.verificationMethod);
      expect(markdown).toContain("## Modified Files");
      expect(markdown).toContain("`src/pal/types.ts`");
      expect(markdown).toContain("## Test Verification Results");

      // Parse back
      const parsed = parseHandoffMarkdown(markdown);
      expect(parsed.agentId).toBe(original.agentId);
      expect(parsed.role).toBe(original.role);
      expect(parsed.tier).toBe(original.tier);
      expect(parsed.taskId).toBe(original.taskId);
      expect(parsed.verdict).toBe(original.verdict);
      expect(parsed.observation).toBe(original.observation);
      expect(parsed.logicChain).toBe(original.logicChain);
      expect(parsed.caveats).toBe(original.caveats);
      expect(parsed.conclusion).toBe(original.conclusion);
      expect(parsed.verificationMethod).toBe(original.verificationMethod);
      expect(parsed.modifiedFiles).toEqual([...original.modifiedFiles]);
    });

    it("validates handoff reports with validateHandoffReport", () => {
      const validMarkdown = [
        "# Handoff Report: reviewer_1",
        "- **Author**: reviewer_1",
        "- **Role**: reviewer",
        "- **Verdict**: `APPROVED`",
        "## 1. Observation",
        "Code diff examined against acceptance criteria.",
        "## 2. Logic Chain",
        "No API regressions found; clean architecture principles observed.",
        "## 3. Caveats",
        "Challenger stress tests should still run in Gate 2.",
        "## 4. Conclusion",
        "Gate 1 audit PASSED.",
        "## 5. Verification Method",
        "bun test && git diff --check",
      ].join("\n");

      const validResult = validateHandoffReport(validMarkdown);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors.length).toBe(0);
      expect(validResult.missingSections.length).toBe(0);
      expect(validResult.payload?.verdict).toBe("APPROVED");

      const invalidMarkdown = [
        "# Handoff Report: reviewer_1",
        "## 1. Observation",
        "Only observation provided.",
      ].join("\n");

      const invalidResult = validateHandoffReport(invalidMarkdown);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.missingSections.length).toBeGreaterThan(0);
    });

    it("generates soft handoff payloads for orchestrator succession", () => {
      const successionHandoff = createSuccessionHandoffPayload({
        predecessorId: "teamwork_preview_orchestrator_1",
        successorId: "teamwork_preview_orchestrator_2",
        spawnCount: 16,
        maxSpawns: 16,
        activeTasks: ["TASK-004"],
        completedTasks: ["TASK-001", "TASK-002", "TASK-003"],
        customNotes: "Clean handoff after Gate 3 certified commit.",
      });

      expect(successionHandoff.agentId).toBe("teamwork_preview_orchestrator_1");
      expect(successionHandoff.role).toBe(COGNITIVE_ROLES.ORCHESTRATOR);
      expect(successionHandoff.handoffType).toBe("soft");
      expect(successionHandoff.verdict).toBe("APPROVED");
      expect(successionHandoff.observation).toContain("16 spawns");
      expect(successionHandoff.logicChain).toContain("TASK-004");
      expect(successionHandoff.logicChain).toContain("TASK-001");
      expect(successionHandoff.conclusion).toContain("teamwork_preview_orchestrator_2");
    });

    it("generates diagnostic handoff payloads for escalation rungs", () => {
      const diagHandoff = createDiagnosticHandoffPayload({
        agentId: "challenger_1",
        role: "challenger",
        taskId: "TASK-003",
        error: new Error("Assertion failed: timeout threshold exceeded"),
        failingCommand: "bun test test/core/timeout.test.ts",
        rootCause: "Promise did not resolve within 50ms under heavy load.",
        proposedFix: "Increase default margin in configuration module.",
      });

      expect(diagHandoff.agentId).toBe("challenger_1");
      expect(diagHandoff.role).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(diagHandoff.handoffType).toBe("escalation");
      expect(diagHandoff.verdict).toBe("REJECTED");
      expect(diagHandoff.observation).toContain("timeout threshold exceeded");
      expect(diagHandoff.logicChain).toContain("Promise did not resolve");
      expect(diagHandoff.conclusion).toContain("Increase default margin");
      expect(diagHandoff.verificationMethod).toContain("bun test test/core/timeout.test.ts");
    });
  });

  describe("Context Snapshot Engine", () => {
    it("captures complete context snapshot from a dispatched agent", async () => {
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "TASK-SNAP-1",
        taskDescription: "Test context snapshotting",
        customBriefing: "Custom test objective",
      });

      // Write some telemetry and messages
      await dispatcher.touchHeartbeat(agent.id);
      await dispatcher.sendMessage(agent.id, "orchestrator", "Task in progress");

      // Write a structured handoff
      await dispatcher.writeHandoff(agent.id, {
        agentId: agent.id,
        role: "worker",
        taskId: "TASK-SNAP-1",
        observation: "Working on snapshotting.",
        logicChain: "Scaffolded agent files.",
        caveats: "None.",
        conclusion: "Ready for snapshot.",
        verificationMethod: "bun test",
      });

      const snapshot = await dispatcher.captureSnapshot(agent.id);

      expect(snapshot.agentId).toBe(agent.id);
      expect(snapshot.role).toBe(COGNITIVE_ROLES.WORKER);
      expect(snapshot.tier).toBe(3);
      expect(snapshot.schemaVersion).toBe("1.0.0");
      expect(snapshot.taskId).toBe("TASK-SNAP-1");
      expect(snapshot.taskDescription).toBe("Test context snapshotting");
      expect(snapshot.spawnIndex).toBeGreaterThanOrEqual(1);

      // Memory checks
      expect(snapshot.memory.briefing?.raw).toContain("# Agent Briefing");
      expect(snapshot.memory.briefing?.lockedIdentity).toBeDefined();
      expect(snapshot.memory.briefing?.objective).toContain("Custom test objective");

      expect(snapshot.memory.progress?.raw).toContain("# Progress Telemetry");
      expect(snapshot.memory.progress?.lastVisited).toBeDefined();

      expect(snapshot.memory.dispatch?.raw).toContain("# Dispatch Manifest");

      expect(snapshot.memory.handoff?.raw).toContain("# Handoff Report");
      expect(snapshot.memory.handoff?.parsed?.observation).toBe("Working on snapshotting.");

      // Logs & Messages
      expect(snapshot.logs.length).toBeGreaterThan(0);
      expect(snapshot.messages.length).toBeGreaterThan(0);
      expect(snapshot.messages[0]?.content).toBe("Task in progress");
    });

    it("serializes and deserializes snapshot with schema validation", async () => {
      const agent = await dispatcher.dispatch({
        role: "explorer",
        taskId: "TASK-SER-1",
        taskDescription: "Serialization test",
      });

      const snapshot = await dispatcher.captureSnapshot(agent.id);
      const json = serializeContextSnapshot(snapshot);
      expect(typeof json).toBe("string");

      const deserialized = deserializeContextSnapshot(json);
      expect(deserialized.snapshotId).toBe(snapshot.snapshotId);
      expect(deserialized.agentId).toBe(snapshot.agentId);
      expect(deserialized.role).toBe(snapshot.role);
      expect(deserialized.schemaVersion).toBe(snapshot.schemaVersion);
    });

    it("throws InvalidSnapshotError on corrupted or invalid snapshot json", () => {
      expect(() => deserializeContextSnapshot("")).toThrow(InvalidSnapshotError);
      expect(() => deserializeContextSnapshot("{ not_valid_json")).toThrow(InvalidSnapshotError);
      expect(() =>
        deserializeContextSnapshot(JSON.stringify({ schemaVersion: "99.0.0", agentId: "a1" }))
      ).toThrow(InvalidSnapshotError);
      expect(() =>
        deserializeContextSnapshot(
          JSON.stringify({
            snapshotId: "s1",
            schemaVersion: "1.0.0",
            agentId: "a1",
            role: "superman",
          })
        )
      ).toThrow(InvalidSnapshotError);
    });

    it("saves and loads snapshot file via dispatcher methods", async () => {
      const agent = await dispatcher.dispatch({
        role: "challenger",
        taskId: "TASK-SAVE-1",
        taskDescription: "Persistence test",
      });

      const savedPath = await dispatcher.saveSnapshot(agent.id);
      expect(existsSync(savedPath)).toBe(true);

      const loaded = await dispatcher.loadSnapshot(savedPath);
      expect(loaded.agentId).toBe(agent.id);
      expect(loaded.role).toBe(COGNITIVE_ROLES.CHALLENGER);
      expect(loaded.taskId).toBe("TASK-SAVE-1");
    });

    it("creates an Orchestrator succession snapshot", () => {
      const succession = createSuccessionSnapshot({
        predecessorAgentId: "orchestrator_1",
        successorAgentId: "orchestrator_2",
        spawnCount: 16,
        maxSpawns: 16,
        reason: "SPAWN_LIMIT_REACHED",
        activeTasks: ["TASK-005"],
        completedTasks: ["TASK-001", "TASK-002", "TASK-003", "TASK-004"],
        customNotes: "Mid-stream succession transfer.",
      });

      expect(succession.predecessorAgentId).toBe("orchestrator_1");
      expect(succession.successorAgentId).toBe("orchestrator_2");
      expect(succession.spawnCount).toBe(16);
      expect(succession.reason).toBe("SPAWN_LIMIT_REACHED");
      expect(succession.activeTasks).toEqual(["TASK-005"]);
      expect(succession.completedTasks.length).toBe(4);
      expect(succession.handoffPayload.handoffType).toBe("soft");
      expect(succession.handoffPayload.agentId).toBe("orchestrator_1");
    });
  });

  describe("SubagentDispatcher Handoff Integration", () => {
    it("completes agent with typed handoff payload and validates handoff", async () => {
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "TASK-COMP-1",
        taskDescription: "Complete with handoff",
      });

      const handoffOptions = {
        agentId: agent.id,
        role: "worker",
        taskId: "TASK-COMP-1",
        verdict: "APPROVED",
        observation: "All subagent tasks passed.",
        logicChain: "Verified test execution.",
        caveats: "None.",
        conclusion: "Task finished.",
        verificationMethod: "bun test",
        modifiedFiles: ["src/core/snapshot.ts"],
      };

      const completed = await dispatcher.completeAgent(agent.id, {
        handoffPayload: handoffOptions,
      });

      expect(completed.status).toBe("completed");
      expect(completed.completedTime).toBeDefined();

      // Read back handoff
      const read = await dispatcher.readHandoff(agent.id);
      expect(read.agentId).toBe(agent.id);
      expect(read.verdict).toBe("APPROVED");
      expect(read.observation).toBe("All subagent tasks passed.");

      // Validate agent handoff
      const validation = await dispatcher.validateAgentHandoff(agent.id);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it("reports validation error when agent handoff is missing required components", async () => {
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "TASK-INVALID-HANDOFF",
      });

      // Write incomplete raw handoff to sandbox
      await dispatcher.writeFile(
        agent.id,
        agent.sandbox.handoffPath,
        "# Incomplete Handoff\n## 1. Observation\nOnly this."
      );

      const validation = await dispatcher.validateAgentHandoff(agent.id);
      expect(validation.valid).toBe(false);
      expect(validation.missingSections.length).toBeGreaterThan(0);
    });
  });
});
