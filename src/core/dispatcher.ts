/**
 * Subagent Dispatcher and Sandbox Manager.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 1.3, Section 2.4, and Section 6.1 (LOOPER-CORE-003)
 * and OpenSpec change `looper-core-subagent-dispatcher` Task 1.2.
 *
 * Provides isolated working directory sandboxing under `.agents/teamwork/<agent_id>`,
 * archetype and cognitive role specialization, in-repo skill discovery and injection,
 * strict access control and write path boundary enforcement, orchestrator succession
 * tracking (16-spawn limit), heartbeat liveness monitoring, and inter-agent communication.
 */

import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { COGNITIVE_ROLES, type CognitiveRole, type PalToolExecutionContext } from "../pal/types";
import {
  COGNITIVE_ROLE_MATRIX,
  HANDOFF_COMPONENTS,
  ROLES_CONSTANTS,
  type CognitiveRoleDefinition,
  type RolePermissions,
  type WritePathValidationResult,
  formatBriefingContent,
  formatDispatchContent,
  formatHandoffTemplate,
  formatProgressContent,
  generateRoleSystemPrompt,
  getRoleDefinition,
  normalizeRole,
  validateWritePath,
} from "./roles";
import {
  MemoryStorage,
  STORAGE_CONSTANTS,
  createMemoryStorage,
  readAtomic,
  writeAtomic,
  writeBriefingAtomic,
} from "../storage/memory";
import {
  SNAPSHOT_CONSTANTS,
  type AgentContextSnapshot,
  type CreateHandoffOptions,
  type CreateSuccessionSnapshotOptions,
  type HandoffComponents,
  type HandoffPayload,
  type HandoffTestResults,
  type HandoffType,
  type HandoffValidationResult,
  type HandoffVerdict,
  type ParsedBriefingMemory,
  type ParsedDispatchManifest,
  type ParsedProgressTelemetry,
  type SnapshotCaptureOptions,
  type SnapshotTargetAgent,
  type SuccessionContextSnapshot,
  HandoffValidationError,
  InvalidSnapshotError,
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
} from "./snapshot";

export {
  COGNITIVE_ROLES,
  type CognitiveRole,
  type PalToolExecutionContext,
};

export {
  COGNITIVE_ROLE_MATRIX,
  HANDOFF_COMPONENTS,
  ROLES_CONSTANTS,
  type CognitiveRoleDefinition,
  type RolePermissions,
  type WritePathValidationResult,
  formatBriefingContent,
  formatDispatchContent,
  formatHandoffTemplate,
  formatProgressContent,
  generateRoleSystemPrompt,
  getRoleDefinition,
  normalizeRole,
  validateWritePath,
};

export {
  SNAPSHOT_CONSTANTS,
  type AgentContextSnapshot,
  type CreateHandoffOptions,
  type CreateSuccessionSnapshotOptions,
  type HandoffComponents,
  type HandoffPayload,
  type HandoffTestResults,
  type HandoffType,
  type HandoffValidationResult,
  type HandoffVerdict,
  type ParsedBriefingMemory,
  type ParsedDispatchManifest,
  type ParsedProgressTelemetry,
  type SnapshotCaptureOptions,
  type SnapshotTargetAgent,
  type SuccessionContextSnapshot,
  HandoffValidationError,
  InvalidSnapshotError,
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
};

/**
 * Central constants ensuring zero magic numbers across dispatcher and sandbox operations.
 */
export const DISPATCHER_CONSTANTS = {
  // Concurrency & Spawns
  DEFAULT_MAX_CONCURRENT_AGENTS: 4,
  MIN_CONCURRENT_AGENTS: 1,
  MAX_ORCHESTRATOR_SPAWNS: 16,
  ZERO_SPAWNS: 0,
  SPAWN_INCREMENT: 1,
  EMPTY_COUNT: 0,
  FIRST_INDEX: 0,
  INDEX_OFFSET_ONE: 1,

  // Timing & Intervals (ms)
  DEFAULT_TIMEOUT_MS: 300_000,
  DEFAULT_HEARTBEAT_THRESHOLD_MS: 300_000,
  DEFAULT_HEARTBEAT_INTERVAL_MS: 30_000,
  MIN_TIMEOUT_MS: 1_000,

  // ID & Randomness
  AGENT_ID_RANDOM_BYTES: 4,
  MESSAGE_ID_RANDOM_BYTES: 4,
  ID_HEX_RADIX: 16,
  AGENT_ID_SEPARATOR: "_",
  MESSAGE_ID_PREFIX: "msg_",

  // Directory Conventions
  DEFAULT_SANDBOX_BASE_DIR: ".agents/teamwork",
  DEFAULT_SKILLS_DIR: ".agents/skills",
  WORKTREE_DIR_PREFIX: ".worktrees",
  SKILL_FILE_NAME: "SKILL.md",

  // Files
  FILE_BRIEFING: "BRIEFING.md",
  FILE_PROGRESS: "progress.md",
  FILE_DISPATCH: "DISPATCH.md",
  FILE_HANDOFF: "handoff.md",
  FILE_PROJECT: "PROJECT.md",

  // Encoding & Serialization
  DEFAULT_ENCODING: "utf-8" as BufferEncoding,
  JSON_INDENT: 2,

  // Logging & Display
  LOG_PREVIEW_MAX_LENGTH: 80,

  // Lifecycle States
  STATUS_IDLE: "idle",
  STATUS_SPAWNING: "spawning",
  STATUS_RUNNING: "running",
  STATUS_COMPLETED: "completed",
  STATUS_FAILED: "failed",
  STATUS_TERMINATED: "terminated",

  // Workspace Modes
  WORKSPACE_MODE_DIRECTORY: "directory",
  WORKSPACE_MODE_WORKTREE: "worktree",
  WORKSPACE_MODE_SHARED: "shared",

  // Event Names
  EVENT_AGENT_DISPATCHED: "agent:dispatched",
  EVENT_AGENT_COMPLETED: "agent:completed",
  EVENT_AGENT_FAILED: "agent:failed",
  EVENT_AGENT_TERMINATED: "agent:terminated",
  EVENT_AGENT_HEARTBEAT: "agent:heartbeat",
  EVENT_AGENT_MESSAGE: "agent:message",
  EVENT_SUCCESSION_TRIGGERED: "succession:triggered",
  EVENT_ACCESS_VIOLATION: "agent:access_violation",

  // Error Codes
  ERR_AGENT_NOT_FOUND: "DISPATCHER_AGENT_NOT_FOUND",
  ERR_MAX_CONCURRENCY: "DISPATCHER_MAX_CONCURRENCY_EXCEEDED",
  ERR_SUCCESSION_LIMIT: "DISPATCHER_SUCCESSION_LIMIT_EXCEEDED",
  ERR_ACCESS_VIOLATION: "DISPATCHER_ACCESS_VIOLATION",
  ERR_INVALID_STATE: "DISPATCHER_INVALID_STATE",
  ERR_SPAWN_FAILED: "DISPATCHER_SPAWN_FAILED",
  ERR_TIMEOUT: "DISPATCHER_TIMEOUT",
} as const;

/**
 * Valid lifecycle states of a dispatched subagent.
 */
export type SubagentStatus =
  | "idle"
  | "spawning"
  | "running"
  | "completed"
  | "failed"
  | "terminated";

/**
 * Sandboxing workspace isolation mode.
 */
export type WorkspaceMode = "directory" | "worktree" | "shared";

/**
 * Isolated sandbox directory metadata allocated to a subagent.
 */
export interface SubagentSandbox {
  /** Unique subagent identifier */
  readonly agentId: string;
  /** Normalized cognitive role */
  readonly role: CognitiveRole;
  /** Absolute path to the isolated sandbox folder in .agents/teamwork/<agent_id> */
  readonly sandboxDir: string;
  /** Absolute path to the workspace root repository */
  readonly workspaceRoot: string;
  /** Effective working directory where execution tools operate */
  readonly workingDirectory: string;
  /** Absolute path to BRIEFING.md inside the sandbox */
  readonly briefingPath: string;
  /** Absolute path to progress.md inside the sandbox */
  readonly progressPath: string;
  /** Absolute path to DISPATCH.md inside the sandbox */
  readonly dispatchPath: string;
  /** Absolute path to handoff.md inside the sandbox */
  readonly handoffPath: string;
  /** In-repo skill identifiers injected into this sandbox */
  readonly skills: readonly string[];
  /** Workspace isolation mode */
  readonly mode: WorkspaceMode;
  /** Timestamp when sandbox was allocated */
  readonly createdAt: Date;
  /** Whether the sandbox temporary assets have been cleaned up */
  cleanedUp: boolean;
}

/**
 * Configuration options for dispatching a new subagent.
 */
export interface SubagentDispatchOptions {
  /** Cognitive role or archetype alias (e.g. "worker", "implementer", "qa", "auditor") */
  readonly role: CognitiveRole | string;
  /** Unique task identifier from DAG or catalog (e.g. "LOOPER-CORE-003") */
  readonly taskId?: string;
  /** Primary goal, mission, or requirement assigned to the subagent */
  readonly taskDescription?: string;
  /** Explicit whitelist of target files the agent is authorized to modify */
  readonly targetFiles?: readonly string[];
  /** Whitelist of permitted tool names */
  readonly allowedTools?: readonly string[];
  /** In-repo skills to inject (discovered automatically if omitted) */
  readonly skills?: readonly string[];
  /** Recommended LLM model name */
  readonly model?: string;
  /** Recommended LLM provider adapter */
  readonly provider?: string;
  /** Maximum execution duration in milliseconds before timeout abort */
  readonly timeoutMs?: number;
  /** Sandbox workspace mode (default: directory) */
  readonly workspaceMode?: WorkspaceMode;
  /** Optional custom working directory override */
  readonly workingDirectory?: string;
  /** Custom objective to override in BRIEFING.md */
  readonly customBriefing?: string;
  /** Custom operational constraints for BRIEFING.md */
  readonly customConstraints?: readonly string[];
  /** Additional custom markdown sections for BRIEFING.md */
  readonly customSections?: Readonly<Record<string, string>>;
  /** Identifier of the parent agent dispatching this subagent (e.g. orchestrator) */
  readonly parentAgentId?: string;
  /** Freeform metadata dictionary */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Custom agent identifier override */
  readonly customAgentId?: string;
}

/**
 * Structured log entry captured during subagent operation.
 */
export interface SubagentLogEntry {
  readonly timestamp: Date;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

/**
 * Active or historical subagent instance managed by the dispatcher.
 */
export interface SubagentInstance {
  readonly id: string;
  readonly role: CognitiveRole;
  readonly roleDefinition: CognitiveRoleDefinition;
  status: SubagentStatus;
  readonly sandbox: SubagentSandbox;
  readonly systemPrompt: string;
  readonly taskDescription: string;
  readonly taskId?: string;
  readonly spawnIndex: number;
  readonly abortController: AbortController;
  readonly startTime: Date;
  completedTime?: Date;
  error?: Error;
  readonly logs: SubagentLogEntry[];
  readonly metadata: Record<string, unknown>;
  readonly executionContext: PalToolExecutionContext;
}

/**
 * Options configuring the SubagentDispatcher instance.
 */
export interface SubagentDispatcherOptions {
  /** Root directory of the repository/workspace (defaults to process.cwd()) */
  readonly workspaceRoot?: string;
  /** Base directory where agent sandboxes are scaffolded (defaults to .agents/teamwork) */
  readonly baseDir?: string;
  /** Directory containing in-repo skills (defaults to .agents/skills) */
  readonly skillsDir?: string;
  /** Maximum concurrent active agents (default: 4) */
  readonly maxConcurrentAgents?: number;
  /** Orchestrator succession spawn threshold (default: 16) */
  readonly maxOrchestratorSpawns?: number;
  /** Whether to throw OrchestratorSuccessionLimitError when spawn limit reached */
  readonly throwOnSuccessionLimit?: boolean;
  /** Whether to automatically clean up temporary files upon completion */
  readonly autoCleanup?: boolean;
  /** Optional pre-configured MemoryStorage instance */
  readonly memoryStorage?: MemoryStorage;
  /** Optional custom logger callback */
  readonly logger?: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * Filter criteria for querying registered subagents.
 */
export interface AgentFilter {
  readonly status?: SubagentStatus | readonly SubagentStatus[];
  readonly role?: CognitiveRole | string;
  readonly parentAgentId?: string;
  readonly taskId?: string;
}

/**
 * Structured inter-agent coordination message.
 */
export interface InterAgentMessage {
  readonly id: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly content: string;
  readonly timestamp: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Options for cleaning up an agent sandbox.
 */
export interface SandboxCleanupOptions {
  /** Whether to preserve handoff.md during cleanup (default: true) */
  readonly preserveHandoff?: boolean;
  /** Whether to preserve progress.md activity logs (default: true) */
  readonly preserveLogs?: boolean;
  /** Whether to preserve BRIEFING.md (default: true) */
  readonly preserveBriefing?: boolean;
  /** Whether to delete the entire sandbox directory (default: false) */
  readonly removeSandboxDir?: boolean;
}

/**
 * Payload emitted on succession boundary detection.
 */
export interface SuccessionTriggerEvent {
  readonly spawnCount: number;
  readonly maxSpawns: number;
  readonly lastAgentId: string;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base error class for all dispatcher and sandboxing failures.
 */
export class DispatcherError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "DispatcherError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown when an agent lookup by ID fails.
 */
export class AgentNotFoundError extends DispatcherError {
  readonly agentId: string;

  constructor(agentId: string) {
    super(
      `Subagent with ID '${agentId}' was not found in dispatcher registry.`,
      DISPATCHER_CONSTANTS.ERR_AGENT_NOT_FOUND,
      { agentId }
    );
    this.name = "AgentNotFoundError";
    this.agentId = agentId;
  }
}

/**
 * Thrown when maximum concurrent subagent limit is exceeded.
 */
export class MaxConcurrencyExceededError extends DispatcherError {
  readonly activeCount: number;
  readonly maxConcurrent: number;

  constructor(activeCount: number, maxConcurrent: number) {
    super(
      `Cannot dispatch subagent: maximum concurrency limit reached (${activeCount}/${maxConcurrent} active agents).`,
      DISPATCHER_CONSTANTS.ERR_MAX_CONCURRENCY,
      { activeCount, maxConcurrent }
    );
    this.name = "MaxConcurrencyExceededError";
    this.activeCount = activeCount;
    this.maxConcurrent = maxConcurrent;
  }
}

/**
 * Thrown when Orchestrator reaches 16 agent spawns without succession.
 */
export class OrchestratorSuccessionLimitError extends DispatcherError {
  readonly spawnCount: number;
  readonly maxSpawns: number;

  constructor(spawnCount: number, maxSpawns: number) {
    super(
      `Orchestrator succession limit reached: ${spawnCount} spawns executed (limit: ${maxSpawns}). Orchestrator succession required.`,
      DISPATCHER_CONSTANTS.ERR_SUCCESSION_LIMIT,
      { spawnCount, maxSpawns }
    );
    this.name = "OrchestratorSuccessionLimitError";
    this.spawnCount = spawnCount;
    this.maxSpawns = maxSpawns;
  }
}

/**
 * Thrown when a subagent attempts a path mutation outside permitted boundaries.
 */
export class SandboxAccessViolationError extends DispatcherError {
  readonly agentId: string;
  readonly role: CognitiveRole;
  readonly targetPath: string;
  readonly violationReason: string;

  constructor(
    agentId: string,
    role: CognitiveRole,
    targetPath: string,
    violationReason: string
  ) {
    super(
      `Sandbox access violation by agent '${agentId}' (role: ${role}) targeting '${targetPath}': ${violationReason}`,
      DISPATCHER_CONSTANTS.ERR_ACCESS_VIOLATION,
      { agentId, role, targetPath, violationReason }
    );
    this.name = "SandboxAccessViolationError";
    this.agentId = agentId;
    this.role = role;
    this.targetPath = targetPath;
    this.violationReason = violationReason;
  }
}

/**
 * Thrown when an invalid lifecycle state transition is requested on an agent.
 */
export class InvalidSubagentStateError extends DispatcherError {
  readonly agentId: string;
  readonly currentState: SubagentStatus;
  readonly attemptedAction: string;

  constructor(
    agentId: string,
    currentState: SubagentStatus,
    attemptedAction: string
  ) {
    super(
      `Invalid state transition for agent '${agentId}': cannot perform '${attemptedAction}' from state '${currentState}'.`,
      DISPATCHER_CONSTANTS.ERR_INVALID_STATE,
      { agentId, currentState, attemptedAction }
    );
    this.name = "InvalidSubagentStateError";
    this.agentId = agentId;
    this.currentState = currentState;
    this.attemptedAction = attemptedAction;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generates a unique, deterministic agent identifier based on cognitive role and random suffix.
 */
export function generateAgentId(
  roleOrAlias: CognitiveRole | string,
  suffix?: string
): string {
  const normalized = normalizeRole(roleOrAlias);
  if (suffix && suffix.trim().length > DISPATCHER_CONSTANTS.EMPTY_COUNT) {
    const cleanSuffix = suffix.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${normalized}${DISPATCHER_CONSTANTS.AGENT_ID_SEPARATOR}${cleanSuffix}`;
  }
  const randomHex = randomBytes(DISPATCHER_CONSTANTS.AGENT_ID_RANDOM_BYTES).toString("hex");
  return `${normalized}${DISPATCHER_CONSTANTS.AGENT_ID_SEPARATOR}${Date.now()}${DISPATCHER_CONSTANTS.AGENT_ID_SEPARATOR}${randomHex}`;
}

/**
 * Asynchronously discovers available in-repo skill identifiers located in .agents/skills.
 */
export async function discoverAvailableSkills(
  skillsDir: string
): Promise<string[]> {
  const resolvedDir = resolve(skillsDir);
  if (!existsSync(resolvedDir)) {
    return [];
  }
  try {
    const entries = await readdir(resolvedDir, { withFileTypes: true });
    const skillNames: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDoc = join(resolvedDir, entry.name, DISPATCHER_CONSTANTS.SKILL_FILE_NAME);
        if (existsSync(skillDoc)) {
          skillNames.push(entry.name);
        }
      }
    }
    return skillNames.sort();
  } catch {
    return [];
  }
}

// ============================================================================
// SUBAGENT DISPATCHER CLASS
// ============================================================================

/**
 * Core Subagent Dispatcher and Sandbox Manager.
 *
 * Coordinates multi-agent workflows, enforces sandbox isolation boundaries,
 * tracks 16-spawn orchestrator succession, manages heartbeats, and routes messages.
 */
export class SubagentDispatcher extends EventEmitter {
  private readonly workspaceRoot: string;
  private readonly baseDir: string;
  private readonly skillsDir: string;
  private maxConcurrentAgents: number;
  private readonly maxOrchestratorSpawns: number;
  private readonly throwOnSuccessionLimit: boolean;
  private readonly autoCleanup: boolean;
  private readonly memoryStorage: MemoryStorage;
  private readonly customLogger?: (
    level: "info" | "warn" | "error",
    message: string
  ) => void;

  private readonly agents: Map<string, SubagentInstance> = new Map();
  private readonly messages: InterAgentMessage[] = [];
  private spawnCount: number = DISPATCHER_CONSTANTS.ZERO_SPAWNS;

  constructor(options?: SubagentDispatcherOptions) {
    super();
    this.workspaceRoot = options?.workspaceRoot
      ? normalize(resolve(options.workspaceRoot))
      : normalize(resolve(process.cwd()));

    this.baseDir = options?.baseDir
      ? normalize(resolve(this.workspaceRoot, options.baseDir))
      : normalize(resolve(this.workspaceRoot, DISPATCHER_CONSTANTS.DEFAULT_SANDBOX_BASE_DIR));

    this.skillsDir = options?.skillsDir
      ? normalize(resolve(this.workspaceRoot, options.skillsDir))
      : normalize(resolve(this.workspaceRoot, DISPATCHER_CONSTANTS.DEFAULT_SKILLS_DIR));

    this.maxConcurrentAgents =
      options?.maxConcurrentAgents ?? DISPATCHER_CONSTANTS.DEFAULT_MAX_CONCURRENT_AGENTS;
    this.maxOrchestratorSpawns =
      options?.maxOrchestratorSpawns ?? DISPATCHER_CONSTANTS.MAX_ORCHESTRATOR_SPAWNS;
    this.throwOnSuccessionLimit = options?.throwOnSuccessionLimit ?? false;
    this.autoCleanup = options?.autoCleanup ?? false;
    this.customLogger = options?.logger;

    this.memoryStorage =
      options?.memoryStorage ??
      createMemoryStorage({
        baseDir: this.baseDir,
        repoRoot: this.workspaceRoot,
      });
  }

  // --------------------------------------------------------------------------
  // Configuration & Introspection Accessors
  // --------------------------------------------------------------------------

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public getSkillsDir(): string {
    return this.skillsDir;
  }

  public getMaxConcurrentAgents(): number {
    return this.maxConcurrentAgents;
  }

  public setMaxConcurrentAgents(limit: number): void {
    if (limit < DISPATCHER_CONSTANTS.MIN_CONCURRENT_AGENTS) {
      this.maxConcurrentAgents = DISPATCHER_CONSTANTS.MIN_CONCURRENT_AGENTS;
    } else {
      this.maxConcurrentAgents = limit;
    }
  }

  public getMaxOrchestratorSpawns(): number {
    return this.maxOrchestratorSpawns;
  }

  public getSpawnCount(): number {
    return this.spawnCount;
  }

  public resetSpawnCount(): void {
    this.spawnCount = DISPATCHER_CONSTANTS.ZERO_SPAWNS;
  }

  public isSuccessionNeeded(): boolean {
    return this.spawnCount >= this.maxOrchestratorSpawns;
  }

  public getRunningCount(): number {
    let running = DISPATCHER_CONSTANTS.EMPTY_COUNT;
    for (const agent of this.agents.values()) {
      if (
        agent.status === DISPATCHER_CONSTANTS.STATUS_RUNNING ||
        agent.status === DISPATCHER_CONSTANTS.STATUS_SPAWNING
      ) {
        running += DISPATCHER_CONSTANTS.INDEX_OFFSET_ONE;
      }
    }
    return running;
  }

  public getActiveAgents(): SubagentInstance[] {
    return this.listAgents({
      status: [
        DISPATCHER_CONSTANTS.STATUS_RUNNING,
        DISPATCHER_CONSTANTS.STATUS_SPAWNING,
      ],
    });
  }

  // --------------------------------------------------------------------------
  // Agent Registry & Queries
  // --------------------------------------------------------------------------

  public getAgent(agentId: string): SubagentInstance | undefined {
    return this.agents.get(agentId);
  }

  public requireAgent(agentId: string): SubagentInstance {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }
    return agent;
  }

  public listAgents(filter?: AgentFilter): SubagentInstance[] {
    const all = Array.from(this.agents.values());
    if (!filter) {
      return all;
    }

    return all.filter((agent) => {
      if (filter.status !== undefined) {
        if (Array.isArray(filter.status)) {
          if (!filter.status.includes(agent.status)) {
            return false;
          }
        } else if (agent.status !== filter.status) {
          return false;
        }
      }

      if (filter.role !== undefined) {
        const targetRole = normalizeRole(filter.role);
        if (agent.role !== targetRole) {
          return false;
        }
      }

      if (filter.taskId !== undefined && agent.taskId !== filter.taskId) {
        return false;
      }

      if (filter.parentAgentId !== undefined) {
        const parentId = agent.metadata["parentAgentId"];
        if (parentId !== filter.parentAgentId) {
          return false;
        }
      }

      return true;
    });
  }

  // --------------------------------------------------------------------------
  // Dispatch & Sandbox Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Dispatches a specialized subagent, scaffold its isolated sandbox workspace,
   * generates tailored system prompts and briefing files, and registers its lifecycle.
   */
  public async dispatch(
    options: SubagentDispatchOptions
  ): Promise<SubagentInstance> {
    const role = normalizeRole(options.role);
    const roleDef = getRoleDefinition(role);

    // 2. Concurrency limit check
    const currentRunning = this.getRunningCount();
    if (currentRunning >= this.maxConcurrentAgents) {
      throw new MaxConcurrencyExceededError(currentRunning, this.maxConcurrentAgents);
    }

    // 3. Increment spawn counter
    this.spawnCount += DISPATCHER_CONSTANTS.SPAWN_INCREMENT;
    const currentSpawnIndex = this.spawnCount;

    // 4. Determine agent ID
    const agentId =
      options.customAgentId ?? generateAgentId(role, options.taskId);

    // 5. Orchestrator succession boundary check (16-spawn limit)
    if (this.isSuccessionNeeded()) {
      const event: SuccessionTriggerEvent = {
        spawnCount: this.spawnCount,
        maxSpawns: this.maxOrchestratorSpawns,
        lastAgentId: agentId,
      };
      this.emit(DISPATCHER_CONSTANTS.EVENT_SUCCESSION_TRIGGERED, event);
      if (
        this.throwOnSuccessionLimit &&
        this.spawnCount > this.maxOrchestratorSpawns
      ) {
        throw new OrchestratorSuccessionLimitError(
          this.spawnCount,
          this.maxOrchestratorSpawns
        );
      }
    }

    // 5. Determine sandbox and working directories
    const sandboxDir = join(this.baseDir, agentId);
    const mode = options.workspaceMode ?? DISPATCHER_CONSTANTS.WORKSPACE_MODE_DIRECTORY;

    let workingDirectory: string;
    if (options.workingDirectory) {
      workingDirectory = normalize(resolve(this.workspaceRoot, options.workingDirectory));
    } else if (mode === DISPATCHER_CONSTANTS.WORKSPACE_MODE_WORKTREE) {
      workingDirectory = join(
        this.workspaceRoot,
        DISPATCHER_CONSTANTS.WORKTREE_DIR_PREFIX,
        agentId
      );
    } else if (mode === DISPATCHER_CONSTANTS.WORKSPACE_MODE_SHARED) {
      workingDirectory = this.workspaceRoot;
    } else {
      // Directory mode: Workers edit code from workspaceRoot; non-code roles work from sandboxDir
      workingDirectory = roleDef.permissions.canEditCode
        ? this.workspaceRoot
        : sandboxDir;
    }

    // 6. Discover skills
    let effectiveSkills: readonly string[];
    if (options.skills && options.skills.length > DISPATCHER_CONSTANTS.EMPTY_COUNT) {
      effectiveSkills = options.skills;
    } else {
      effectiveSkills = await discoverAvailableSkills(this.skillsDir);
    }

    // 7. Scaffold sandbox folder
    await mkdir(sandboxDir, { recursive: true });

    // 8. Generate file templates
    const briefingContent = formatBriefingContent(agentId, role, {
      goal: options.customBriefing ?? options.taskDescription,
      constraints: options.customConstraints,
      taskKey: options.taskId,
      customSections: options.customSections,
    });

    const dispatchContent = formatDispatchContent(agentId, role, {
      taskKey: options.taskId,
      prompt: options.taskDescription,
      targetFiles: options.targetFiles,
      skills: effectiveSkills,
    });

    const progressContent = formatProgressContent(
      agentId,
      role,
      DISPATCHER_CONSTANTS.STATUS_RUNNING
    );

    const handoffTemplate = formatHandoffTemplate(agentId, role, {
      filesModified: options.targetFiles,
    });

    const briefingPath = join(sandboxDir, DISPATCHER_CONSTANTS.FILE_BRIEFING);
    const progressPath = join(sandboxDir, DISPATCHER_CONSTANTS.FILE_PROGRESS);
    const dispatchPath = join(sandboxDir, DISPATCHER_CONSTANTS.FILE_DISPATCH);
    const handoffPath = join(sandboxDir, DISPATCHER_CONSTANTS.FILE_HANDOFF);

    // Atomically write initial coordination files
    await writeAtomic(briefingPath, briefingContent);
    await writeAtomic(dispatchPath, dispatchContent);
    await writeAtomic(progressPath, progressContent);
    await writeAtomic(handoffPath, handoffTemplate);

    // 9. Generate role system prompt
    const systemPrompt = generateRoleSystemPrompt(role, {
      agentId,
      taskKey: options.taskId,
      taskDescription: options.taskDescription,
      workingDirectory,
      assignedSkills: effectiveSkills,
      constraints: options.customConstraints,
    });

    // 10. Instantiate SubagentSandbox
    const sandbox: SubagentSandbox = {
      agentId,
      role,
      sandboxDir,
      workspaceRoot: this.workspaceRoot,
      workingDirectory,
      briefingPath,
      progressPath,
      dispatchPath,
      handoffPath,
      skills: effectiveSkills,
      mode,
      createdAt: new Date(),
      cleanedUp: false,
    };

    // 11. Create AbortController & execution context
    const abortController = new AbortController();

    if (
      options.timeoutMs !== undefined &&
      options.timeoutMs > DISPATCHER_CONSTANTS.EMPTY_COUNT
    ) {
      const timeoutHandle = setTimeout(() => {
        abortController.abort(
          new DispatcherError(
            `Agent '${agentId}' timed out after ${options.timeoutMs}ms`,
            DISPATCHER_CONSTANTS.ERR_TIMEOUT
          )
        );
      }, options.timeoutMs);

      // Prevent timer from keeping test processes alive
      if (typeof timeoutHandle.unref === "function") {
        timeoutHandle.unref();
      }
    }

    const executionContext: PalToolExecutionContext = {
      agentId,
      role,
      workingDirectory,
      abortSignal: abortController.signal,
      logger: (level: "info" | "warn" | "error", message: string): void => {
        this.recordAgentLog(agentId, level, message);
      },
    };

    // 12. Create SubagentInstance
    const metadata: Record<string, unknown> = {
      ...options.metadata,
      ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
    };

    const instance: SubagentInstance = {
      id: agentId,
      role,
      roleDefinition: roleDef,
      status: DISPATCHER_CONSTANTS.STATUS_RUNNING,
      sandbox,
      systemPrompt,
      taskDescription: options.taskDescription ?? roleDef.coreResponsibility,
      taskId: options.taskId,
      spawnIndex: currentSpawnIndex,
      abortController,
      startTime: new Date(),
      logs: [],
      metadata,
      executionContext,
    };

    this.agents.set(agentId, instance);

    this.recordAgentLog(
      agentId,
      "info",
      `Dispatched agent '${agentId}' (role: ${role}, tier: ${roleDef.tier})`
    );

    this.emit(DISPATCHER_CONSTANTS.EVENT_AGENT_DISPATCHED, instance);
    return instance;
  }

  // --------------------------------------------------------------------------
  // Execution Context & Path Boundary Enforcement
  // --------------------------------------------------------------------------

  /**
   * Creates a PalToolExecutionContext wired with the agent's isolated workspace.
   */
  public createExecutionContext(agentId: string): PalToolExecutionContext {
    const agent = this.requireAgent(agentId);
    return agent.executionContext;
  }

  /**
   * Validates a write operation path against the subagent's cognitive permissions.
   */
  public validateWrite(
    agentId: string,
    targetPath: string
  ): WritePathValidationResult {
    const agent = this.requireAgent(agentId);
    const relPath = isAbsolute(targetPath)
      ? relative(this.workspaceRoot, targetPath)
      : targetPath;
    const relSandbox = isAbsolute(agent.sandbox.sandboxDir)
      ? relative(this.workspaceRoot, agent.sandbox.sandboxDir)
      : agent.sandbox.sandboxDir;

    // Check with relative path first
    const relResult = validateWritePath(agent.role, relPath, relSandbox);
    if (relResult.allowed) {
      return relResult;
    }

    // Also check direct path against absolute sandboxDir
    const directResult = validateWritePath(
      agent.role,
      targetPath,
      agent.sandbox.sandboxDir
    );
    if (directResult.allowed) {
      return directResult;
    }

    // Return the result with reason
    return relResult.reason ? relResult : directResult;
  }

  /**
   * Asserts write permission; throws SandboxAccessViolationError if disallowed.
   */
  public assertWritePermission(agentId: string, targetPath: string): void {
    const agent = this.requireAgent(agentId);
    const result = this.validateWrite(agentId, targetPath);
    if (!result.allowed) {
      const reason = result.reason ?? "Access disallowed by cognitive role policy.";
      this.emit(DISPATCHER_CONSTANTS.EVENT_ACCESS_VIOLATION, {
        agentId,
        role: agent.role,
        targetPath,
        reason,
      });
      throw new SandboxAccessViolationError(
        agentId,
        agent.role,
        targetPath,
        reason
      );
    }
  }

  /**
   * Safely writes content to a file on behalf of an agent after verifying sandbox write access.
   * If writing to BRIEFING.md, guards append-only locked sections (## 🔒 My Identity).
   */
  public async writeFile(
    agentId: string,
    targetPath: string,
    content: string | Uint8Array,
    options?: { encoding?: BufferEncoding }
  ): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.assertWritePermission(agentId, targetPath);

    const resolved = isAbsolute(targetPath)
      ? normalize(targetPath)
      : normalize(resolve(agent.sandbox.workingDirectory, targetPath));

    if (resolved.endsWith(DISPATCHER_CONSTANTS.FILE_BRIEFING)) {
      const text = typeof content === "string" ? content : content.toString();
      await writeBriefingAtomic(resolved, text, {
        encoding: options?.encoding ?? DISPATCHER_CONSTANTS.DEFAULT_ENCODING,
      });
    } else {
      await writeAtomic(resolved, content, {
        encoding: options?.encoding ?? DISPATCHER_CONSTANTS.DEFAULT_ENCODING,
      });
    }

    this.recordAgentLog(agentId, "info", `Mutated file: ${resolved}`);
  }

  /**
   * Reads content from a file within or relative to an agent's workspace.
   */
  public async readFile(
    agentId: string,
    targetPath: string,
    encoding: BufferEncoding = DISPATCHER_CONSTANTS.DEFAULT_ENCODING
  ): Promise<string> {
    const agent = this.requireAgent(agentId);
    const resolved = isAbsolute(targetPath)
      ? normalize(targetPath)
      : normalize(resolve(agent.sandbox.workingDirectory, targetPath));

    return await readAtomic(resolved, encoding);
  }

  /**
   * Deletes a file on behalf of an agent, enforcing write permissions.
   */
  public async deleteFile(
    agentId: string,
    targetPath: string
  ): Promise<boolean> {
    const agent = this.requireAgent(agentId);
    this.assertWritePermission(agentId, targetPath);

    const resolved = isAbsolute(targetPath)
      ? normalize(targetPath)
      : normalize(resolve(agent.sandbox.workingDirectory, targetPath));

    if (!existsSync(resolved)) {
      return false;
    }

    await unlink(resolved);
    this.recordAgentLog(agentId, "info", `Deleted file: ${resolved}`);
    return true;
  }

  // --------------------------------------------------------------------------
  // Heartbeat & Telemetry
  // --------------------------------------------------------------------------

  /**
   * Touches the heartbeat timestamp in an agent's progress.md.
   */
  public async touchHeartbeat(
    agentId: string,
    timestamp: Date = new Date()
  ): Promise<Date> {
    const agent = this.requireAgent(agentId);
    const touched = await this.memoryStorage.touchHeartbeat(
      agent.sandbox.progressPath,
      timestamp
    );
    this.emit(DISPATCHER_CONSTANTS.EVENT_AGENT_HEARTBEAT, {
      agentId,
      timestamp: touched,
    });
    return touched;
  }

  /**
   * Reads the latest heartbeat timestamp recorded in an agent's progress.md.
   */
  public async getHeartbeat(agentId: string): Promise<Date | null> {
    const agent = this.requireAgent(agentId);
    return await this.memoryStorage.getHeartbeat(agent.sandbox.progressPath);
  }

  /**
   * Records a structured log entry for an agent.
   */
  public recordAgentLog(
    agentId: string,
    level: "info" | "warn" | "error",
    message: string
  ): void {
    const entry: SubagentLogEntry = {
      timestamp: new Date(),
      level,
      message,
    };

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.logs.push(entry);
    }

    if (this.customLogger) {
      this.customLogger(level, `[${agentId}] ${message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Inter-Agent Coordination Protocol
  // --------------------------------------------------------------------------

  /**
   * Dispatches an inter-agent message between cognitive agents.
   */
  public async sendMessage(
    fromAgentId: string,
    toAgentId: string,
    content: string,
    metadata?: Readonly<Record<string, unknown>>
  ): Promise<InterAgentMessage> {
    const msgId = `${DISPATCHER_CONSTANTS.MESSAGE_ID_PREFIX}${Date.now()}_${randomBytes(
      DISPATCHER_CONSTANTS.MESSAGE_ID_RANDOM_BYTES
    ).toString("hex")}`;

    const message: InterAgentMessage = {
      id: msgId,
      fromAgentId,
      toAgentId,
      content,
      timestamp: new Date(),
      metadata,
    };

    this.messages.push(message);

    this.recordAgentLog(
      fromAgentId,
      "info",
      `Sent message to '${toAgentId}': ${content.slice(
        DISPATCHER_CONSTANTS.FIRST_INDEX,
        DISPATCHER_CONSTANTS.LOG_PREVIEW_MAX_LENGTH
      )}`
    );

    const targetAgent = this.agents.get(toAgentId);
    if (targetAgent) {
      this.recordAgentLog(
        toAgentId,
        "info",
        `Received message from '${fromAgentId}': ${content.slice(
          DISPATCHER_CONSTANTS.FIRST_INDEX,
          DISPATCHER_CONSTANTS.LOG_PREVIEW_MAX_LENGTH
        )}`
      );
    }

    this.emit(DISPATCHER_CONSTANTS.EVENT_AGENT_MESSAGE, message);
    return message;
  }

  /**
   * Retrieves message history, optionally filtered by agent participation.
   */
  public getMessageHistory(agentId?: string): readonly InterAgentMessage[] {
    if (!agentId) {
      return Object.freeze([...this.messages]);
    }
    return Object.freeze(
      this.messages.filter(
        (m) => m.fromAgentId === agentId || m.toAgentId === agentId
      )
    );
  }

  // --------------------------------------------------------------------------
  // Context Snapshotting & Succession
  // --------------------------------------------------------------------------

  /**
   * Captures an immutable serializable context snapshot of a registered subagent.
   */
  public async captureSnapshot(
    agentId: string,
    options?: SnapshotCaptureOptions
  ): Promise<AgentContextSnapshot> {
    const agent = this.requireAgent(agentId);
    const messages = this.getMessageHistory(agentId);
    return await captureContextSnapshot(agent, {
      ...options,
      messages: options?.messages ?? messages,
    });
  }

  /**
   * Captures and persists an agent's context snapshot to disk.
   */
  public async saveSnapshot(
    agentId: string,
    customPath?: string,
    options?: SnapshotCaptureOptions
  ): Promise<string> {
    const snapshot = await this.captureSnapshot(agentId, options);
    const savedPath = await saveContextSnapshot(snapshot, customPath);
    this.recordAgentLog(agentId, "info", `Persisted context snapshot to ${savedPath}`);
    return savedPath;
  }

  /**
   * Loads an agent context snapshot from disk.
   */
  public async loadSnapshot(filePath: string): Promise<AgentContextSnapshot> {
    return await loadContextSnapshot(filePath);
  }

  /**
   * Packages a succession context snapshot for orchestrator handover.
   */
  public createSuccessionSnapshot(
    options: CreateSuccessionSnapshotOptions
  ): SuccessionContextSnapshot {
    return createSuccessionSnapshot(options);
  }

  // --------------------------------------------------------------------------
  // Handoff Payload Operations
  // --------------------------------------------------------------------------

  /**
   * Constructs a typed HandoffPayload validating the 5 mandatory components.
   */
  public generateHandoffPayload(
    options: CreateHandoffOptions
  ): HandoffPayload {
    return createHandoffPayload(options);
  }

  /**
   * Writes a structured handoff report to the agent's sandbox.
   */
  public async writeHandoff(
    agentId: string,
    payloadOrOptions: HandoffPayload | CreateHandoffOptions
  ): Promise<HandoffPayload> {
    const agent = this.requireAgent(agentId);
    const payload =
      "tier" in payloadOrOptions && "timestamp" in payloadOrOptions
        ? (payloadOrOptions as HandoffPayload)
        : createHandoffPayload(payloadOrOptions);

    const markdown = formatHandoffMarkdown(payload);
    await writeAtomic(agent.sandbox.handoffPath, markdown);
    this.recordAgentLog(
      agentId,
      "info",
      `Generated structured handoff report (verdict: ${payload.verdict})`
    );
    return payload;
  }

  /**
   * Reads and parses an agent's handoff.md report from its sandbox.
   */
  public async readHandoff(agentId: string): Promise<HandoffPayload> {
    const agent = this.requireAgent(agentId);
    const raw = await readAtomic(agent.sandbox.handoffPath);
    return parseHandoffMarkdown(raw);
  }

  /**
   * Validates whether an agent's handoff.md satisfies the 5-component standard.
   */
  public async validateAgentHandoff(
    agentId: string
  ): Promise<HandoffValidationResult> {
    const agent = this.requireAgent(agentId);
    if (!existsSync(agent.sandbox.handoffPath)) {
      return {
        valid: false,
        errors: [`Handoff report not found at '${agent.sandbox.handoffPath}'`],
        missingSections: [...HANDOFF_COMPONENTS],
      };
    }
    const raw = await readAtomic(agent.sandbox.handoffPath);
    return validateHandoffReport(raw);
  }

  // --------------------------------------------------------------------------
  // Agent Completion, Failure & Termination
  // --------------------------------------------------------------------------

  /**
   * Marks a subagent as completed, optionally writing its structured handoff report.
   */
  public async completeAgent(
    agentId: string,
    payload?: {
      handoffContent?: string;
      handoffPayload?: HandoffPayload | CreateHandoffOptions;
    }
  ): Promise<SubagentInstance> {
    const agent = this.requireAgent(agentId);
    if (
      agent.status === DISPATCHER_CONSTANTS.STATUS_COMPLETED ||
      agent.status === DISPATCHER_CONSTANTS.STATUS_TERMINATED
    ) {
      return agent;
    }

    if (payload?.handoffPayload) {
      await this.writeHandoff(agentId, payload.handoffPayload);
    } else if (payload?.handoffContent) {
      await writeAtomic(agent.sandbox.handoffPath, payload.handoffContent);
    }

    agent.status = DISPATCHER_CONSTANTS.STATUS_COMPLETED;
    agent.completedTime = new Date();

    await this.touchHeartbeat(agentId, agent.completedTime);

    this.recordAgentLog(agentId, "info", `Completed execution successfully`);
    this.emit(DISPATCHER_CONSTANTS.EVENT_AGENT_COMPLETED, agent);

    if (this.autoCleanup) {
      await this.cleanupAgent(agentId);
    }

    return agent;
  }

  /**
   * Marks a subagent as failed and records the failure error.
   */
  public async failAgent(
    agentId: string,
    error: Error | string
  ): Promise<SubagentInstance> {
    const agent = this.requireAgent(agentId);
    const err = typeof error === "string" ? new Error(error) : error;

    agent.status = DISPATCHER_CONSTANTS.STATUS_FAILED;
    agent.error = err;
    agent.completedTime = new Date();

    this.recordAgentLog(agentId, "error", `Failed execution: ${err.message}`);
    this.emit(DISPATCHER_CONSTANTS.EVENT_AGENT_FAILED, { agent, error: err });

    return agent;
  }

  /**
   * Terminates a running subagent, triggering its AbortController.
   */
  public async terminateAgent(
    agentId: string,
    reason = "Terminated by dispatcher"
  ): Promise<SubagentInstance> {
    const agent = this.requireAgent(agentId);
    if (
      agent.status === DISPATCHER_CONSTANTS.STATUS_COMPLETED ||
      agent.status === DISPATCHER_CONSTANTS.STATUS_TERMINATED
    ) {
      return agent;
    }

    agent.abortController.abort(new Error(reason));
    agent.status = DISPATCHER_CONSTANTS.STATUS_TERMINATED;
    agent.completedTime = new Date();

    this.recordAgentLog(agentId, "warn", `Terminated: ${reason}`);
    this.emit(DISPATCHER_CONSTANTS.EVENT_AGENT_TERMINATED, { agent, reason });

    return agent;
  }

  /**
   * Terminates all currently active or running subagents.
   */
  public async terminateAll(
    reason = "Dispatcher terminating all active subagents"
  ): Promise<void> {
    const active = this.getActiveAgents();
    for (const agent of active) {
      await this.terminateAgent(agent.id, reason);
    }
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Cleans up sandbox resources for a subagent while preserving reports and logs by default.
   */
  public async cleanupAgent(
    agentId: string,
    options?: SandboxCleanupOptions
  ): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.sandbox.cleanedUp) {
      return;
    }

    const removeDir = options?.removeSandboxDir ?? false;
    const preserveHandoff = options?.preserveHandoff ?? true;
    const preserveLogs = options?.preserveLogs ?? true;
    const preserveBriefing = options?.preserveBriefing ?? true;

    if (removeDir) {
      // If complete deletion requested without preservation
      if (!preserveHandoff && !preserveLogs && !preserveBriefing) {
        if (existsSync(agent.sandbox.sandboxDir)) {
          await rm(agent.sandbox.sandboxDir, { recursive: true, force: true });
        }
      }
    }

    agent.sandbox.cleanedUp = true;
    this.recordAgentLog(agentId, "info", `Cleaned up sandbox workspace`);
  }

  /**
   * Cleans up all registered subagent sandboxes.
   */
  public async cleanupAll(options?: SandboxCleanupOptions): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.cleanupAgent(agentId, options);
    }
  }

  /**
   * Shuts down the dispatcher, terminates running agents, and performs cleanup.
   */
  public async destroy(): Promise<void> {
    await this.terminateAll("Dispatcher destroy invoked");
    this.removeAllListeners();
  }
}

/**
 * Factory helper function to instantiate a SubagentDispatcher.
 */
export function createSubagentDispatcher(
  options?: SubagentDispatcherOptions
): SubagentDispatcher {
  return new SubagentDispatcher(options);
}
