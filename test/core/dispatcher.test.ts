import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import {
  AgentNotFoundError,
  COGNITIVE_ROLES,
  DISPATCHER_CONSTANTS,
  DispatcherError,
  HANDOFF_COMPONENTS,
  InvalidSubagentStateError,
  MaxConcurrencyExceededError,
  OrchestratorSuccessionLimitError,
  ROLES_CONSTANTS,
  SandboxAccessViolationError,
  SubagentDispatcher,
  createSubagentDispatcher,
  discoverAvailableSkills,
  generateAgentId,
  type AgentFilter,
  type InterAgentMessage,
  type SubagentInstance,
  type SubagentStatus,
} from "../../src/core/dispatcher";

describe("Subagent Dispatcher & Sandbox Manager (LOOPER-CORE-003 / Task 1.4)", () => {
  let tempBaseDir: string;
  let teamworkDir: string;
  let skillsDir: string;
  let dispatcher: SubagentDispatcher;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "looper-dispatcher-test-"));
    teamworkDir = join(tempBaseDir, ".agents/teamwork");
    skillsDir = join(tempBaseDir, ".agents/skills");

    // Scaffold mock in-repo skill
    const mockSkillDir = join(skillsDir, "qa-validator");
    await mkdir(mockSkillDir, { recursive: true });
    await writeFile(
      join(mockSkillDir, DISPATCHER_CONSTANTS.SKILL_FILE_NAME),
      "---\nname: qa-validator\ndescription: Automated QA validation skill\n---\n"
    );

    dispatcher = createSubagentDispatcher({
      workspaceRoot: tempBaseDir,
      baseDir: teamworkDir,
      skillsDir,
      maxConcurrentAgents: 4,
      maxOrchestratorSpawns: 16,
    });
  });

  afterEach(async () => {
    await dispatcher.destroy();
    if (existsSync(tempBaseDir)) {
      await rm(tempBaseDir, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // 1. Dispatcher Constants & Configuration
  // ==========================================================================
  describe("Dispatcher Constants & Configuration", () => {
    it("defines canonical limits, filenames, and default values without magic numbers", () => {
      expect(DISPATCHER_CONSTANTS.DEFAULT_MAX_CONCURRENT_AGENTS).toBe(4);
      expect(DISPATCHER_CONSTANTS.MIN_CONCURRENT_AGENTS).toBe(1);
      expect(DISPATCHER_CONSTANTS.MAX_ORCHESTRATOR_SPAWNS).toBe(16);
      expect(DISPATCHER_CONSTANTS.FILE_BRIEFING).toBe("BRIEFING.md");
      expect(DISPATCHER_CONSTANTS.FILE_PROGRESS).toBe("progress.md");
      expect(DISPATCHER_CONSTANTS.FILE_DISPATCH).toBe("DISPATCH.md");
      expect(DISPATCHER_CONSTANTS.FILE_HANDOFF).toBe("handoff.md");
      expect(DISPATCHER_CONSTANTS.DEFAULT_SANDBOX_BASE_DIR).toBe(".agents/teamwork");
      expect(DISPATCHER_CONSTANTS.DEFAULT_SKILLS_DIR).toBe(".agents/skills");
    });

    it("initializes with default options and normalizes paths", () => {
      expect(dispatcher.getWorkspaceRoot()).toBe(normalize(resolve(tempBaseDir)));
      expect(dispatcher.getBaseDir()).toBe(normalize(resolve(teamworkDir)));
      expect(dispatcher.getSkillsDir()).toBe(normalize(resolve(skillsDir)));
      expect(dispatcher.getMaxConcurrentAgents()).toBe(4);
      expect(dispatcher.getMaxOrchestratorSpawns()).toBe(16);
      expect(dispatcher.getSpawnCount()).toBe(0);
      expect(dispatcher.isSuccessionNeeded()).toBe(false);
      expect(dispatcher.getRunningCount()).toBe(0);
    });

    it("allows adjusting maximum concurrency within bounds", () => {
      dispatcher.setMaxConcurrentAgents(8);
      expect(dispatcher.getMaxConcurrentAgents()).toBe(8);

      dispatcher.setMaxConcurrentAgents(0);
      expect(dispatcher.getMaxConcurrentAgents()).toBe(DISPATCHER_CONSTANTS.MIN_CONCURRENT_AGENTS);
    });
  });

  // ==========================================================================
  // 2. Utility Functions (generateAgentId & discoverAvailableSkills)
  // ==========================================================================
  describe("Utility Functions", () => {
    it("generates deterministic and formatted agent IDs", () => {
      const idWithSuffix = generateAgentId("worker", "task-1");
      expect(idWithSuffix).toBe("worker_task-1");

      const idWithAliasedRole = generateAgentId("implementer", "sub-02");
      expect(idWithAliasedRole).toBe("worker_sub-02");

      const idAuto = generateAgentId("explorer");
      expect(idAuto.startsWith("explorer_")).toBe(true);
      expect(idAuto.split("_").length).toBeGreaterThanOrEqual(3);
    });

    it("sanitizes suffixes with special characters in generateAgentId", () => {
      const sanitized = generateAgentId("challenger", "TASK#123/foo.bar");
      expect(sanitized).toBe("challenger_TASK_123_foo_bar");
    });

    it("discovers in-repo skills containing SKILL.md", async () => {
      // Add another mock skill
      const secondSkillDir = join(skillsDir, "refactor-pro");
      await mkdir(secondSkillDir, { recursive: true });
      await writeFile(
        join(secondSkillDir, DISPATCHER_CONSTANTS.SKILL_FILE_NAME),
        "---\nname: refactor-pro\n---\n"
      );

      // Add directory without SKILL.md (should be ignored)
      const ignoredDir = join(skillsDir, "empty-folder");
      await mkdir(ignoredDir, { recursive: true });

      const discovered = await discoverAvailableSkills(skillsDir);
      expect(discovered).toEqual(["qa-validator", "refactor-pro"]);
    });

    it("returns empty array when skills directory does not exist", async () => {
      const nonExistent = join(tempBaseDir, "does-not-exist");
      const discovered = await discoverAvailableSkills(nonExistent);
      expect(discovered).toEqual([]);
    });
  });

  // ==========================================================================
  // 3. Subagent Dispatching & Sandbox Isolation
  // ==========================================================================
  describe("Subagent Dispatching & Sandbox Isolation", () => {
    it("dispatches a specialized subagent and scaffolds sandbox directory", async () => {
      let dispatchedEmitted = false;
      dispatcher.on(DISPATCHER_CONSTANTS.EVENT_AGENT_DISPATCHED, (agent: SubagentInstance) => {
        dispatchedEmitted = true;
        expect(agent.role).toBe(COGNITIVE_ROLES.WORKER);
      });

      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "TASK-001",
        taskDescription: "Implement core algorithm",
        targetFiles: ["src/core/math.ts"],
      });

      expect(dispatchedEmitted).toBe(true);
      expect(agent.id).toBe("worker_TASK-001");
      expect(agent.role).toBe(COGNITIVE_ROLES.WORKER);
      expect(agent.status).toBe(DISPATCHER_CONSTANTS.STATUS_RUNNING);
      expect(agent.spawnIndex).toBe(1);
      expect(dispatcher.getSpawnCount()).toBe(1);
      expect(dispatcher.getRunningCount()).toBe(1);

      // Verify sandbox structure on disk
      const sandboxDir = agent.sandbox.sandboxDir;
      expect(existsSync(sandboxDir)).toBe(true);
      expect(existsSync(agent.sandbox.briefingPath)).toBe(true);
      expect(existsSync(agent.sandbox.dispatchPath)).toBe(true);
      expect(existsSync(agent.sandbox.progressPath)).toBe(true);
      expect(existsSync(agent.sandbox.handoffPath)).toBe(true);

      // Verify BRIEFING.md conforms to <100 lines and contains 🔒 identity section
      const briefingContent = await readFile(agent.sandbox.briefingPath, "utf-8");
      const briefingLines = briefingContent.split("\n");
      expect(briefingLines.length).toBeLessThanOrEqual(ROLES_CONSTANTS.MAX_BRIEFING_LINES);
      expect(briefingContent).toContain("## 🔒 My Identity");
      expect(briefingContent).toContain("## 🔒 Key Constraints");
      expect(briefingContent).toContain("worker_TASK-001");

      // Verify DISPATCH.md contents
      const dispatchContent = await readFile(agent.sandbox.dispatchPath, "utf-8");
      expect(dispatchContent).toContain("TASK-001");
      expect(dispatchContent).toContain("Implement core algorithm");
      expect(dispatchContent).toContain("src/core/math.ts");

      // Verify progress.md initial telemetry
      const progressContent = await readFile(agent.sandbox.progressPath, "utf-8");
      expect(progressContent).toContain(DISPATCHER_CONSTANTS.STATUS_RUNNING);

      // Verify system prompt is generated and specialized
      expect(agent.systemPrompt).toContain("Worker (Tier 3)");
      expect(agent.systemPrompt).toContain("## 🔒 Active Session Identity");
      expect(agent.systemPrompt).toContain("TASK-001");
    });

    it("normalizes role aliases when dispatching", async () => {
      const agent = await dispatcher.dispatch({
        role: "implementer", // alias of worker
        taskId: "ALIAS-TEST",
      });
      expect(agent.role).toBe(COGNITIVE_ROLES.WORKER);

      const challenger = await dispatcher.dispatch({
        role: "red-team", // alias of challenger
        taskId: "RED-TEAM-TEST",
      });
      expect(challenger.role).toBe(COGNITIVE_ROLES.CHALLENGER);
    });

    it("supports custom agentId override", async () => {
      const agent = await dispatcher.dispatch({
        role: "explorer",
        customAgentId: "custom_explorer_fixed_id",
      });
      expect(agent.id).toBe("custom_explorer_fixed_id");
    });

    it("automatically injects discovered skills if skills option is omitted", async () => {
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "SKILL-INJECT-TEST",
      });
      expect(agent.sandbox.skills).toContain("qa-validator");
      expect(agent.systemPrompt).toContain("qa-validator");
    });

    it("respects explicitly specified skills over auto-discovered ones", async () => {
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "EXPLICIT-SKILLS",
        skills: ["custom-skill-a", "custom-skill-b"],
      });
      expect(agent.sandbox.skills).toEqual(["custom-skill-a", "custom-skill-b"]);
      expect(agent.systemPrompt).toContain("custom-skill-a");
    });
  });

  // ==========================================================================
  // 4. Workspace Isolation Modes (directory, worktree, shared)
  // ==========================================================================
  describe("Workspace Isolation Modes", () => {
    it("configures workingDirectory based on mode and role in directory mode", async () => {
      // Worker role points to workspaceRoot in directory mode
      const worker = await dispatcher.dispatch({
        role: "worker",
        taskId: "DIR-WORKER",
        workspaceMode: "directory",
      });
      expect(worker.sandbox.workingDirectory).toBe(dispatcher.getWorkspaceRoot());

      // Explorer (read-only) role points to sandboxDir in directory mode
      const explorer = await dispatcher.dispatch({
        role: "explorer",
        taskId: "DIR-EXPLORER",
        workspaceMode: "directory",
      });
      expect(explorer.sandbox.workingDirectory).toBe(explorer.sandbox.sandboxDir);
    });

    it("configures workingDirectory for worktree mode under .worktrees/<agent_id>", async () => {
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "WORKTREE-TEST",
        workspaceMode: "worktree",
      });
      const expectedWorktree = join(
        dispatcher.getWorkspaceRoot(),
        DISPATCHER_CONSTANTS.WORKTREE_DIR_PREFIX,
        agent.id
      );
      expect(agent.sandbox.workingDirectory).toBe(expectedWorktree);
    });

    it("configures workingDirectory for shared mode to workspaceRoot", async () => {
      const agent = await dispatcher.dispatch({
        role: "explorer",
        taskId: "SHARED-TEST",
        workspaceMode: "shared",
      });
      expect(agent.sandbox.workingDirectory).toBe(dispatcher.getWorkspaceRoot());
    });

    it("respects explicit workingDirectory override", async () => {
      const customSubdir = join(tempBaseDir, "custom-sub");
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "CUSTOM-DIR",
        workingDirectory: customSubdir,
      });
      expect(agent.sandbox.workingDirectory).toBe(normalize(resolve(customSubdir)));
    });
  });

  // ==========================================================================
  // 5. Timeout & Abort Signal Handling
  // ==========================================================================
  describe("Timeout & Abort Signal Handling", () => {
    it("triggers abort signal when timeoutMs expires", async () => {
      const shortTimeoutMs = 50;
      const agent = await dispatcher.dispatch({
        role: "worker",
        taskId: "TIMEOUT-TEST",
        timeoutMs: shortTimeoutMs,
      });

      expect(agent.abortController.signal.aborted).toBe(false);

      // Await expiration of timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(agent.abortController.signal.aborted).toBe(true);
      const reason = agent.abortController.signal.reason as DispatcherError;
      expect(reason).toBeInstanceOf(DispatcherError);
      expect(reason.code).toBe(DISPATCHER_CONSTANTS.ERR_TIMEOUT);
    });
  });

  // ==========================================================================
  // 6. Agent Registry & Query Filtering
  // ==========================================================================
  describe("Agent Registry & Query Filtering", () => {
    it("retrieves agents by ID or throws AgentNotFoundError", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "REG-01" });
      expect(dispatcher.getAgent(worker.id)).toBe(worker);
      expect(dispatcher.requireAgent(worker.id)).toBe(worker);

      expect(dispatcher.getAgent("non-existent-id")).toBeUndefined();
      expect(() => dispatcher.requireAgent("non-existent-id")).toThrow(AgentNotFoundError);
    });

    it("filters agents by status, role, taskId, and parentAgentId", async () => {
      const w1 = await dispatcher.dispatch({
        role: "worker",
        taskId: "TASK-A",
        parentAgentId: "orchestrator_main",
      });
      const e1 = await dispatcher.dispatch({
        role: "explorer",
        taskId: "TASK-B",
        parentAgentId: "orchestrator_main",
      });
      const c1 = await dispatcher.dispatch({
        role: "challenger",
        taskId: "TASK-A",
        parentAgentId: "orchestrator_secondary",
      });

      // Filter by role
      const workers = dispatcher.listAgents({ role: "worker" });
      expect(workers.map((a) => a.id)).toEqual([w1.id]);

      // Filter by taskId
      const taskAAgents = dispatcher.listAgents({ taskId: "TASK-A" });
      expect(taskAAgents.map((a) => a.id).sort()).toEqual([c1.id, w1.id].sort());

      // Filter by parentAgentId
      const mainChildren = dispatcher.listAgents({ parentAgentId: "orchestrator_main" });
      expect(mainChildren.map((a) => a.id).sort()).toEqual([e1.id, w1.id].sort());

      // Filter by status after completing one
      await dispatcher.completeAgent(w1.id);
      const completed = dispatcher.listAgents({ status: DISPATCHER_CONSTANTS.STATUS_COMPLETED });
      expect(completed.map((a) => a.id)).toEqual([w1.id]);

      const running = dispatcher.listAgents({ status: DISPATCHER_CONSTANTS.STATUS_RUNNING });
      expect(running.map((a) => a.id).sort()).toEqual([c1.id, e1.id].sort());
    });
  });

  // ==========================================================================
  // 7. Concurrency Limits & Capacity Management
  // ==========================================================================
  describe("Concurrency Limits & Capacity Management", () => {
    it("enforces maxConcurrentAgents and throws MaxConcurrencyExceededError", async () => {
      dispatcher.setMaxConcurrentAgents(2);

      const a1 = await dispatcher.dispatch({ role: "worker", taskId: "C-1" });
      const a2 = await dispatcher.dispatch({ role: "worker", taskId: "C-2" });

      expect(dispatcher.getRunningCount()).toBe(2);

      await expect(
        dispatcher.dispatch({ role: "worker", taskId: "C-3" })
      ).rejects.toThrow(MaxConcurrencyExceededError);

      // Completing an agent frees a slot
      await dispatcher.completeAgent(a1.id);
      expect(dispatcher.getRunningCount()).toBe(1);

      const a3 = await dispatcher.dispatch({ role: "worker", taskId: "C-3" });
      expect(a3.status).toBe(DISPATCHER_CONSTANTS.STATUS_RUNNING);
      expect(dispatcher.getRunningCount()).toBe(2);
    });
  });

  // ==========================================================================
  // 8. Orchestrator Succession Tracking (16-spawn limit)
  // ==========================================================================
  describe("Orchestrator Succession Tracking", () => {
    it("tracks spawn count and emits succession:triggered at limit", async () => {
      const customLimitDispatcher = createSubagentDispatcher({
        workspaceRoot: tempBaseDir,
        baseDir: teamworkDir,
        skillsDir,
        maxConcurrentAgents: 10,
        maxOrchestratorSpawns: 3, // Small limit for testing
      });

      let successionEmitted = false;
      customLimitDispatcher.on(DISPATCHER_CONSTANTS.EVENT_SUCCESSION_TRIGGERED, (evt) => {
        successionEmitted = true;
        expect(evt.spawnCount).toBe(3);
        expect(evt.maxSpawns).toBe(3);
      });

      await customLimitDispatcher.dispatch({ role: "worker", taskId: "SP-1" });
      await customLimitDispatcher.dispatch({ role: "worker", taskId: "SP-2" });
      expect(customLimitDispatcher.isSuccessionNeeded()).toBe(false);

      await customLimitDispatcher.dispatch({ role: "worker", taskId: "SP-3" });
      expect(customLimitDispatcher.isSuccessionNeeded()).toBe(true);
      expect(successionEmitted).toBe(true);

      customLimitDispatcher.resetSpawnCount();
      expect(customLimitDispatcher.getSpawnCount()).toBe(0);
      expect(customLimitDispatcher.isSuccessionNeeded()).toBe(false);

      await customLimitDispatcher.destroy();
    });

    it("throws OrchestratorSuccessionLimitError when throwOnSuccessionLimit is enabled", async () => {
      const strictDispatcher = createSubagentDispatcher({
        workspaceRoot: tempBaseDir,
        baseDir: teamworkDir,
        skillsDir,
        maxConcurrentAgents: 10,
        maxOrchestratorSpawns: 2,
        throwOnSuccessionLimit: true,
      });

      await strictDispatcher.dispatch({ role: "worker", taskId: "S-1" });
      await strictDispatcher.dispatch({ role: "worker", taskId: "S-2" });

      await expect(
        strictDispatcher.dispatch({ role: "worker", taskId: "S-3" })
      ).rejects.toThrow(OrchestratorSuccessionLimitError);

      await strictDispatcher.destroy();
    });
  });

  // ==========================================================================
  // 9. Sandbox Access Control & Write Path Boundary Enforcement
  // ==========================================================================
  describe("Sandbox Access Control & Write Path Boundary Enforcement", () => {
    it("allows Worker to write to src/, test/, and its assigned sandbox", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "PERM-WORKER" });

      const srcResult = dispatcher.validateWrite(worker.id, "src/core/index.ts");
      expect(srcResult.allowed).toBe(true);

      const testResult = dispatcher.validateWrite(worker.id, "test/core/index.test.ts");
      expect(testResult.allowed).toBe(true);

      const sandboxResult = dispatcher.validateWrite(
        worker.id,
        join(worker.sandbox.sandboxDir, "custom.md")
      );
      expect(sandboxResult.allowed).toBe(true);
    });

    it("denies Worker from modifying .git, .agents/skills, or project configs", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "DENY-WORKER" });

      const gitResult = dispatcher.validateWrite(worker.id, ".git/HEAD");
      expect(gitResult.allowed).toBe(false);

      const skillResult = dispatcher.validateWrite(worker.id, ".agents/skills/qa/SKILL.md");
      expect(skillResult.allowed).toBe(false);

      const outsideResult = dispatcher.validateWrite(worker.id, "projects/agnostic_looper/SPEC.md");
      expect(outsideResult.allowed).toBe(false);
    });

    it("restricts Challenger to authoring test probes under test/challenger*.test.ts and sandbox", async () => {
      const challenger = await dispatcher.dispatch({ role: "challenger", taskId: "CHALLENGER-TEST" });

      const probeResult = dispatcher.validateWrite(challenger.id, "test/challenger_01.test.ts");
      expect(probeResult.allowed).toBe(true);

      const sandboxResult = dispatcher.validateWrite(
        challenger.id,
        join(challenger.sandbox.sandboxDir, "report.md")
      );
      expect(sandboxResult.allowed).toBe(true);

      // Forbidden to mutate src code
      const srcResult = dispatcher.validateWrite(challenger.id, "src/core/index.ts");
      expect(srcResult.allowed).toBe(false);

      // Forbidden to write arbitrary test outside challenger prefix
      const normalTestResult = dispatcher.validateWrite(challenger.id, "test/core/math.test.ts");
      expect(normalTestResult.allowed).toBe(false);
    });

    it("restricts Explorer and Reviewer to their own sandbox folder only", async () => {
      const explorer = await dispatcher.dispatch({ role: "explorer", taskId: "EXP-READONLY" });
      const reviewer = await dispatcher.dispatch({ role: "reviewer", taskId: "REV-READONLY" });

      // Inside sandbox is allowed
      expect(
        dispatcher.validateWrite(explorer.id, join(explorer.sandbox.sandboxDir, "notes.md")).allowed
      ).toBe(true);
      expect(
        dispatcher.validateWrite(reviewer.id, join(reviewer.sandbox.sandboxDir, "review.md")).allowed
      ).toBe(true);

      // Outside sandbox is strictly rejected
      expect(dispatcher.validateWrite(explorer.id, "src/core/engine.ts").allowed).toBe(false);
      expect(dispatcher.validateWrite(reviewer.id, "src/core/engine.ts").allowed).toBe(false);
      expect(dispatcher.validateWrite(explorer.id, "test/unit.test.ts").allowed).toBe(false);
    });

    it("throws SandboxAccessViolationError and emits event on assertWritePermission failure", async () => {
      const explorer = await dispatcher.dispatch({ role: "explorer", taskId: "VIOLATION-TEST" });

      let violationEmitted = false;
      dispatcher.on(DISPATCHER_CONSTANTS.EVENT_ACCESS_VIOLATION, (evt) => {
        violationEmitted = true;
        expect(evt.agentId).toBe(explorer.id);
        expect(evt.targetPath).toBe("src/illegal.ts");
      });

      expect(() =>
        dispatcher.assertWritePermission(explorer.id, "src/illegal.ts")
      ).toThrow(SandboxAccessViolationError);

      expect(violationEmitted).toBe(true);
    });
  });

  // ==========================================================================
  // 10. File Operations (writeFile, readFile, deleteFile)
  // ==========================================================================
  describe("File Operations (writeFile, readFile, deleteFile)", () => {
    it("safely writes and reads files within allowed boundary", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "FILE-OP-TEST" });
      const testFilePath = join(tempBaseDir, "src/sample.ts");

      await dispatcher.writeFile(worker.id, testFilePath, "export const x = 42;");
      expect(existsSync(testFilePath)).toBe(true);

      const content = await dispatcher.readFile(worker.id, testFilePath);
      expect(content).toBe("export const x = 42;");

      const deleted = await dispatcher.deleteFile(worker.id, testFilePath);
      expect(deleted).toBe(true);
      expect(existsSync(testFilePath)).toBe(false);
    });

    it("protects locked sections in BRIEFING.md when writeFile is invoked", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "BRIEFING-GUARD" });
      const briefingPath = worker.sandbox.briefingPath;

      // 1. Attempting to overwrite BRIEFING.md with non-matching locked content throws error
      const tamperedBriefing = [
        "# Agent Briefing: tampered_agent",
        "",
        "## 🔒 My Identity",
        "- **Agent ID**: `tampered_id`",
        "",
        "## Current Objective",
        "Updated goal",
      ].join("\n");

      await expect(
        dispatcher.writeFile(worker.id, briefingPath, tamperedBriefing)
      ).rejects.toThrow();

      // 2. Modifying non-protected sections while preserving locked sections succeeds
      const originalBriefing = await dispatcher.readFile(worker.id, briefingPath);
      const updatedBriefing = originalBriefing.replace(
        "## Current Objective",
        "## Current Objective\nNew updated objective"
      );
      await dispatcher.writeFile(worker.id, briefingPath, updatedBriefing);

      const reRead = await dispatcher.readFile(worker.id, briefingPath);
      expect(reRead).toContain("New updated objective");
      expect(reRead).toContain(`- **Agent ID**: \`${worker.id}\``);
    });

    it("rejects file writes when unauthorized", async () => {
      const explorer = await dispatcher.dispatch({ role: "explorer", taskId: "REJECT-FILE-WRITE" });
      const unauthorizedFile = join(tempBaseDir, "src/forbidden.ts");

      await expect(
        dispatcher.writeFile(explorer.id, unauthorizedFile, "forbidden content")
      ).rejects.toThrow(SandboxAccessViolationError);
    });
  });

  // ==========================================================================
  // 11. Heartbeat & Telemetry Tracking
  // ==========================================================================
  describe("Heartbeat & Telemetry Tracking", () => {
    it("updates progress.md on touchHeartbeat and emits agent:heartbeat", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "HEARTBEAT-TEST" });

      let heartbeatEmitted = false;
      dispatcher.on(DISPATCHER_CONSTANTS.EVENT_AGENT_HEARTBEAT, (evt) => {
        heartbeatEmitted = true;
        expect(evt.agentId).toBe(worker.id);
      });

      const fixedTime = new Date("2026-10-24T12:00:00.000Z");
      const touched = await dispatcher.touchHeartbeat(worker.id, fixedTime);
      expect(touched).toEqual(fixedTime);
      expect(heartbeatEmitted).toBe(true);

      const recorded = await dispatcher.getHeartbeat(worker.id);
      expect(recorded?.toISOString()).toBe(fixedTime.toISOString());
    });

    it("records structured log entries on the agent instance", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "LOG-TEST" });
      dispatcher.recordAgentLog(worker.id, "info", "Step 1 complete");
      dispatcher.recordAgentLog(worker.id, "warn", "Deprecation warning");

      expect(worker.logs.length).toBeGreaterThanOrEqual(2);
      const messages = worker.logs.map((l) => l.message);
      expect(messages).toContain("Step 1 complete");
      expect(messages).toContain("Deprecation warning");
    });
  });

  // ==========================================================================
  // 12. Inter-Agent Messaging Protocol
  // ==========================================================================
  describe("Inter-Agent Messaging Protocol", () => {
    it("routes messages between agents and maintains conversation history", async () => {
      const sender = await dispatcher.dispatch({ role: "orchestrator", taskId: "MSG-ORCH" });
      const receiver = await dispatcher.dispatch({ role: "worker", taskId: "MSG-WORKER" });

      let messageEmitted = false;
      dispatcher.on(DISPATCHER_CONSTANTS.EVENT_AGENT_MESSAGE, (msg: InterAgentMessage) => {
        messageEmitted = true;
        expect(msg.fromAgentId).toBe(sender.id);
        expect(msg.toAgentId).toBe(receiver.id);
        expect(msg.content).toBe("Please begin implementation of task 1.4");
      });

      const sent = await dispatcher.sendMessage(
        sender.id,
        receiver.id,
        "Please begin implementation of task 1.4",
        { priority: "high" }
      );

      expect(messageEmitted).toBe(true);
      expect(sent.id.startsWith(DISPATCHER_CONSTANTS.MESSAGE_ID_PREFIX)).toBe(true);

      const allMessages = dispatcher.getMessageHistory();
      expect(allMessages.length).toBe(1);
      expect(allMessages[0]?.id).toBe(sent.id);

      const senderMessages = dispatcher.getMessageHistory(sender.id);
      expect(senderMessages.length).toBe(1);

      const unrelatedMessages = dispatcher.getMessageHistory("unrelated_agent");
      expect(unrelatedMessages.length).toBe(0);
    });
  });

  // ==========================================================================
  // 13. Context Snapshot & Succession Integration
  // ==========================================================================
  describe("Context Snapshot & Succession Integration", () => {
    it("captures, saves, and loads context snapshot of a dispatched agent", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "SNAP-TEST" });
      dispatcher.recordAgentLog(worker.id, "info", "Snapshot trace log");

      const snapshot = await dispatcher.captureSnapshot(worker.id);
      expect(snapshot.agentId).toBe(worker.id);
      expect(snapshot.role).toBe(COGNITIVE_ROLES.WORKER);
      expect(snapshot.tier).toBe(ROLES_CONSTANTS.TIER_WORKER);

      const savedPath = await dispatcher.saveSnapshot(worker.id);
      expect(existsSync(savedPath)).toBe(true);

      const loaded = await dispatcher.loadSnapshot(savedPath);
      expect(loaded.agentId).toBe(worker.id);
      expect(loaded.schemaVersion).toBe("1.0.0");
    });

    it("creates a succession context snapshot via dispatcher helper", () => {
      const succession = dispatcher.createSuccessionSnapshot({
        predecessorAgentId: "orchestrator_01",
        successorAgentId: "orchestrator_02",
        spawnCount: 16,
        maxSpawns: 16,
        reason: "SPAWN_LIMIT_REACHED",
        activeTasks: ["TASK-01"],
        completedTasks: ["TASK-00"],
      });

      expect(succession.predecessorAgentId).toBe("orchestrator_01");
      expect(succession.successorAgentId).toBe("orchestrator_02");
      expect(succession.spawnCount).toBe(16);
      expect(succession.maxSpawns).toBe(16);
      expect(succession.reason).toBe("SPAWN_LIMIT_REACHED");
    });
  });

  // ==========================================================================
  // 14. Structured Handoff Operations
  // ==========================================================================
  describe("Structured Handoff Operations", () => {
    it("writes and reads structured handoff report adhering to the 5-component standard", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "HANDOFF-TEST" });

      const payload = dispatcher.generateHandoffPayload({
        agentId: worker.id,
        role: "worker",
        taskId: "HANDOFF-TEST",
        verdict: "APPROVED",
        handoffType: "completion",
        observation: "Completed all test requirements.",
        logicChain: "Implemented unit tests for SubagentDispatcher.",
        caveats: "No regressions observed.",
        conclusion: "Ready for merge.",
        verificationMethod: "bun test test/core/dispatcher.test.ts",
      });

      await dispatcher.writeHandoff(worker.id, payload);

      // Validate handoff report
      const validation = await dispatcher.validateAgentHandoff(worker.id);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);

      // Read handoff back
      const readBack = await dispatcher.readHandoff(worker.id);
      expect(readBack.verdict).toBe("APPROVED");
      expect(readBack.observation).toBe("Completed all test requirements.");
      expect(readBack.verificationMethod).toBe(
        "bun test test/core/dispatcher.test.ts"
      );
    });
  });

  // ==========================================================================
  // 15. Lifecycle State Transitions (Complete, Fail, Terminate)
  // ==========================================================================
  describe("Lifecycle State Transitions", () => {
    it("completes an agent and emits agent:completed", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "COMPLETE-TEST" });

      let completedEmitted = false;
      dispatcher.on(DISPATCHER_CONSTANTS.EVENT_AGENT_COMPLETED, (agent: SubagentInstance) => {
        completedEmitted = true;
        expect(agent.id).toBe(worker.id);
      });

      const completed = await dispatcher.completeAgent(worker.id);
      expect(completed.status).toBe(DISPATCHER_CONSTANTS.STATUS_COMPLETED);
      expect(completed.completedTime).toBeInstanceOf(Date);
      expect(completedEmitted).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(0);
    });

    it("fails an agent and emits agent:failed with error details", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "FAIL-TEST" });

      let failedEmitted = false;
      dispatcher.on(
        DISPATCHER_CONSTANTS.EVENT_AGENT_FAILED,
        ({ agent, error }: { agent: SubagentInstance; error: Error }) => {
          failedEmitted = true;
          expect(agent.id).toBe(worker.id);
          expect(error.message).toBe("Compilation failed with code 1");
        }
      );

      const failed = await dispatcher.failAgent(worker.id, "Compilation failed with code 1");
      expect(failed.status).toBe(DISPATCHER_CONSTANTS.STATUS_FAILED);
      expect(failed.error?.message).toBe("Compilation failed with code 1");
      expect(failedEmitted).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(0);
    });

    it("terminates an agent and aborts its AbortController", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "TERMINATE-TEST" });

      let terminatedEmitted = false;
      dispatcher.on(
        DISPATCHER_CONSTANTS.EVENT_AGENT_TERMINATED,
        ({ agent, reason }: { agent: SubagentInstance; reason: string }) => {
          terminatedEmitted = true;
          expect(agent.id).toBe(worker.id);
          expect(reason).toBe("User canceled execution");
        }
      );

      const terminated = await dispatcher.terminateAgent(worker.id, "User canceled execution");
      expect(terminated.status).toBe(DISPATCHER_CONSTANTS.STATUS_TERMINATED);
      expect(terminated.abortController.signal.aborted).toBe(true);
      expect(terminatedEmitted).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(0);
    });

    it("terminates all active agents via terminateAll", async () => {
      await dispatcher.dispatch({ role: "worker", taskId: "TERM-ALL-1" });
      await dispatcher.dispatch({ role: "explorer", taskId: "TERM-ALL-2" });
      expect(dispatcher.getRunningCount()).toBe(2);

      await dispatcher.terminateAll("Batch cancellation");
      expect(dispatcher.getRunningCount()).toBe(0);

      const active = dispatcher.getActiveAgents();
      expect(active.length).toBe(0);
    });
  });

  // ==========================================================================
  // 16. Sandbox Cleanup & Teardown Lifecycle
  // ==========================================================================
  describe("Sandbox Cleanup & Teardown Lifecycle", () => {
    it("preserves handoff and progress reports during default cleanup", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "CLEANUP-TEST" });
      await dispatcher.cleanupAgent(worker.id);

      expect(worker.sandbox.cleanedUp).toBe(true);
      // Preserved files still exist
      expect(existsSync(worker.sandbox.handoffPath)).toBe(true);
      expect(existsSync(worker.sandbox.progressPath)).toBe(true);
      expect(existsSync(worker.sandbox.briefingPath)).toBe(true);
    });

    it("removes entire sandbox directory when explicitly instructed", async () => {
      const worker = await dispatcher.dispatch({ role: "worker", taskId: "PURGE-TEST" });
      const dir = worker.sandbox.sandboxDir;
      expect(existsSync(dir)).toBe(true);

      await dispatcher.cleanupAgent(worker.id, {
        removeSandboxDir: true,
        preserveBriefing: false,
        preserveHandoff: false,
        preserveLogs: false,
      });

      expect(existsSync(dir)).toBe(false);
    });

    it("cleans up all agent sandboxes via cleanupAll", async () => {
      const w1 = await dispatcher.dispatch({ role: "worker", taskId: "CLEAN-ALL-1" });
      const w2 = await dispatcher.dispatch({ role: "explorer", taskId: "CLEAN-ALL-2" });

      await dispatcher.cleanupAll();
      expect(w1.sandbox.cleanedUp).toBe(true);
      expect(w2.sandbox.cleanedUp).toBe(true);
    });
  });
});
