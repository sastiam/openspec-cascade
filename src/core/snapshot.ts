/**
 * Context Snapshotting and Handoff Payload Generator.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 1.3, Section 5.1, Section 5.2, and Section 5.3 (LOOPER-CORE-003)
 * and OpenSpec change `looper-core-subagent-dispatcher` Task 1.3.
 *
 * Provides point-in-time serializable context snapshotting of subagent state and sandbox
 * files (BRIEFING.md, progress.md, DISPATCH.md, handoff.md), git working tree baselines,
 * 16-spawn orchestrator succession snapshots, and standard Antigravity Teamwork
 * 5-component handoff report generation, formatting, parsing, and validation.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { COGNITIVE_ROLES, type CognitiveRole } from "../pal/types";
import {
  COGNITIVE_ROLE_MATRIX,
  HANDOFF_COMPONENTS,
  ROLES_CONSTANTS,
  type CognitiveRoleDefinition,
  type HandoffComponent,
  type RoleTier,
  getRoleDefinition,
  isValidRole,
  normalizeRole,
} from "./roles";
import {
  readAtomic,
  writeAtomic,
} from "../storage/memory";
import { captureGitState, type GitWorkingTreeState } from "../../resilience";

/**
 * Central constants ensuring zero magic numbers across snapshotting and handoff operations.
 */
export const SNAPSHOT_CONSTANTS = {
  // Schema & File Names
  SCHEMA_VERSION: "1.0.0",
  FILE_SNAPSHOT: "snapshot.json",
  FILE_SUCCESSION_SNAPSHOT: "succession_snapshot.json",
  FILE_HANDOFF: "handoff.md",
  FILE_BRIEFING: "BRIEFING.md",
  FILE_PROGRESS: "progress.md",
  FILE_DISPATCH: "DISPATCH.md",

  // Formatting & Indentation
  DEFAULT_JSON_INDENT: 2,
  MAX_PREVIEW_LINES: 100,
  FIRST_INDEX: 0,
  EMPTY_COUNT: 0,
  INDEX_OFFSET_ONE: 1,
  ID_RANDOM_BYTES: 4,

  // Succession Thresholds
  DEFAULT_MAX_ORCHESTRATOR_SPAWNS: 16,
  SUCCESSION_WATERMARK_PERCENT: 80,

  // 5 Handoff Components (Antigravity Teamwork standard)
  COMPONENT_OBSERVATION: "Observation",
  COMPONENT_LOGIC_CHAIN: "Logic Chain",
  COMPONENT_CAVEATS: "Caveats",
  COMPONENT_CONCLUSION: "Conclusion",
  COMPONENT_VERIFICATION_METHOD: "Verification Method",

  // Component Index (1 through 5)
  SECTION_INDEX_OBSERVATION: 1,
  SECTION_INDEX_LOGIC_CHAIN: 2,
  SECTION_INDEX_CAVEATS: 3,
  SECTION_INDEX_CONCLUSION: 4,
  SECTION_INDEX_VERIFICATION_METHOD: 5,

  // Handoff Types
  HANDOFF_TYPE_COMPLETION: "completion" as const,
  HANDOFF_TYPE_SOFT: "soft" as const,
  HANDOFF_TYPE_HARD: "hard" as const,
  HANDOFF_TYPE_ESCALATION: "escalation" as const,

  // Standard Verdicts
  VERDICT_COMPLETED: "COMPLETED",
  VERDICT_APPROVED: "APPROVED",
  VERDICT_REJECTED: "REJECTED",
  VERDICT_PASSED_NO_BREAK: "PASSED_NO_BREAK",
  VERDICT_REPRODUCED_FAILURE: "REPRODUCED_FAILURE",
  VERDICT_PASS: "PASS",
  VERDICT_FAIL: "FAIL",

  // Succession Reasons
  REASON_SPAWN_LIMIT: "SPAWN_LIMIT_REACHED" as const,
  REASON_TOKEN_WATERMARK: "TOKEN_WATERMARK_80" as const,
  REASON_MANUAL_SUCCESSION: "MANUAL_SUCCESSION" as const,

  // Error Codes
  ERR_SNAPSHOT_NOT_FOUND: "SNAPSHOT_NOT_FOUND",
  ERR_INVALID_SNAPSHOT_SCHEMA: "INVALID_SNAPSHOT_SCHEMA",
  ERR_HANDOFF_VALIDATION_FAILED: "HANDOFF_VALIDATION_FAILED",
  ERR_MISSING_HANDOFF_SECTION: "MISSING_HANDOFF_SECTION",
  ERR_EMPTY_HANDOFF_SECTION: "EMPTY_HANDOFF_SECTION",
} as const;

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base error class for snapshotting and handoff payload failures.
 */
export class SnapshotError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "SnapshotError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown when a snapshot fails deserialization or schema validation.
 */
export class InvalidSnapshotError extends SnapshotError {
  constructor(message: string, details?: unknown) {
    super(message, SNAPSHOT_CONSTANTS.ERR_INVALID_SNAPSHOT_SCHEMA, details);
    this.name = "InvalidSnapshotError";
  }
}

/**
 * Thrown when a handoff report violates the 5-component protocol or validation rules.
 */
export class HandoffValidationError extends SnapshotError {
  readonly validationErrors: readonly string[];
  readonly missingSections: readonly string[];

  constructor(
    validationErrors: readonly string[],
    missingSections: readonly string[] = []
  ) {
    super(
      `Handoff validation failed: ${validationErrors.join("; ")}`,
      SNAPSHOT_CONSTANTS.ERR_HANDOFF_VALIDATION_FAILED,
      { validationErrors, missingSections }
    );
    this.name = "HandoffValidationError";
    this.validationErrors = validationErrors;
    this.missingSections = missingSections;
  }
}

// ============================================================================
// HANDOFF PAYLOAD DATA CONTRACTS
// ============================================================================

/**
 * Supported handoff transition types.
 */
export type HandoffType = "completion" | "soft" | "hard" | "escalation";

/**
 * Recognized completion and audit verdicts.
 */
export type HandoffVerdict =
  | "COMPLETED"
  | "APPROVED"
  | "REJECTED"
  | "PASSED_NO_BREAK"
  | "REPRODUCED_FAILURE"
  | "PASS"
  | "FAIL"
  | string;

/**
 * The 5 core sections required by the Antigravity Teamwork handoff protocol.
 */
export interface HandoffComponents {
  /** Section 1: Verbatim empirical observations, file lines, compiler logs */
  readonly observation: string;
  /** Section 2: Step-by-step reasoning from observation to conclusion */
  readonly logicChain: string;
  /** Section 3: Assumptions, edge cases, potential regressions */
  readonly caveats: string;
  /** Section 4: Actionable conclusion ready for next agent or gate */
  readonly conclusion: string;
  /** Section 5: Deterministic shell commands to verify the resolution */
  readonly verificationMethod: string;
}

/**
 * Test execution outcome details attached to a handoff.
 */
export interface HandoffTestResults {
  readonly passed: boolean;
  readonly command?: string;
  readonly exitCode?: number;
  readonly preview?: string;
}

/**
 * Fully typed, immutable structured handoff report payload.
 */
export interface HandoffPayload extends HandoffComponents {
  /** Identifier of the authoring agent (e.g. worker_1, explorer_002) */
  readonly agentId: string;
  /** Canonical cognitive role */
  readonly role: CognitiveRole;
  /** Hierarchy tier index (0 to 6) */
  readonly tier: RoleTier;
  /** Task identifier (e.g. LOOPER-CORE-003, Task 1.3) */
  readonly taskId?: string;
  /** Handoff verdict status */
  readonly verdict: HandoffVerdict;
  /** Transition classification */
  readonly handoffType: HandoffType;
  /** Files created or modified during the session */
  readonly modifiedFiles: readonly string[];
  /** Optional mechanical test execution traces */
  readonly testResults?: HandoffTestResults;
  /** Timestamp when handoff was generated */
  readonly timestamp: string;
  /** Freeform metadata dictionary */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Input parameters for constructing a HandoffPayload.
 */
export interface CreateHandoffOptions {
  readonly agentId: string;
  readonly role: CognitiveRole | string;
  readonly taskId?: string;
  readonly verdict?: HandoffVerdict;
  readonly handoffType?: HandoffType;
  readonly observation: string;
  readonly logicChain: string;
  readonly caveats: string;
  readonly conclusion: string;
  readonly verificationMethod: string;
  readonly modifiedFiles?: readonly string[];
  readonly testResults?: HandoffTestResults;
  readonly timestamp?: Date | string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Detailed verification verdict returned by handoff validators.
 */
export interface HandoffValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly missingSections: readonly string[];
  readonly payload?: HandoffPayload;
}

// ============================================================================
// CONTEXT SNAPSHOT DATA CONTRACTS
// ============================================================================

/**
 * Structural interface representing the agent target to snapshot.
 * Allows decoupling snapshotting logic from specific subagent implementations.
 */
export interface SnapshotTargetAgent {
  readonly id: string;
  readonly role: CognitiveRole;
  readonly status: string;
  readonly taskId?: string;
  readonly taskDescription: string;
  readonly spawnIndex: number;
  readonly startTime: Date;
  readonly completedTime?: Date;
  readonly sandbox: {
    readonly sandboxDir: string;
    readonly workspaceRoot: string;
    readonly workingDirectory: string;
    readonly briefingPath: string;
    readonly progressPath: string;
    readonly dispatchPath: string;
    readonly handoffPath: string;
    readonly skills: readonly string[];
  };
  readonly logs?: readonly {
    readonly timestamp: Date;
    readonly level: "info" | "warn" | "error";
    readonly message: string;
  }[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Parsed representation of BRIEFING.md memory contents.
 */
export interface ParsedBriefingMemory {
  readonly raw: string;
  readonly lockedIdentity?: string;
  readonly lockedConstraints?: readonly string[];
  readonly objective?: string;
  readonly recentDecisions?: readonly string[];
  readonly customSections?: Readonly<Record<string, string>>;
}

/**
 * Parsed representation of progress.md telemetry contents.
 */
export interface ParsedProgressTelemetry {
  readonly raw: string;
  readonly lastVisited?: string;
  readonly status?: string;
  readonly activityLog?: readonly string[];
}

/**
 * Parsed representation of DISPATCH.md manifest contents.
 */
export interface ParsedDispatchManifest {
  readonly raw: string;
  readonly mission?: string;
  readonly targetScope?: readonly string[];
  readonly injectedSkills?: readonly string[];
}

/**
 * Serialized point-in-time snapshot of subagent context and sandbox state.
 */
export interface AgentContextSnapshot {
  /** Unique snapshot identifier */
  readonly snapshotId: string;
  /** Snapshot schema version */
  readonly schemaVersion: string;
  /** ISO timestamp when snapshot was captured */
  readonly timestamp: string;
  /** Agent identifier */
  readonly agentId: string;
  /** Canonical cognitive role */
  readonly role: CognitiveRole;
  /** Hierarchy tier index */
  readonly tier: RoleTier;
  /** Lifecycle status at time of capture */
  readonly status: string;
  /** Task identifier */
  readonly taskId?: string;
  /** Primary goal / mission */
  readonly taskDescription: string;
  /** Spawn sequence index */
  readonly spawnIndex: number;
  /** Execution start time ISO string */
  readonly startTime: string;
  /** Execution completion time ISO string (if completed) */
  readonly completedTime?: string;
  /** Total elapsed runtime in milliseconds */
  readonly durationMs?: number;
  /** Sandbox filesystem layout */
  readonly sandbox: {
    readonly sandboxDir: string;
    readonly workspaceRoot: string;
    readonly workingDirectory: string;
    readonly briefingPath: string;
    readonly progressPath: string;
    readonly dispatchPath: string;
    readonly handoffPath: string;
    readonly skills: readonly string[];
  };
  /** Working memory contents */
  readonly memory: {
    readonly briefing?: ParsedBriefingMemory;
    readonly progress?: ParsedProgressTelemetry;
    readonly dispatch?: ParsedDispatchManifest;
    readonly handoff?: {
      readonly raw: string;
      readonly parsed?: HandoffPayload;
    };
  };
  /** Git working tree state at time of snapshot */
  readonly gitState?: {
    readonly headSha: string;
    readonly isDirty: boolean;
    readonly untrackedFiles: readonly string[];
    readonly modifiedFiles: readonly string[];
  };
  /** Execution log history */
  readonly logs: readonly {
    readonly timestamp: string;
    readonly level: "info" | "warn" | "error";
    readonly message: string;
  }[];
  /** Inter-agent messages participated in */
  readonly messages: readonly {
    readonly id: string;
    readonly fromAgentId: string;
    readonly toAgentId: string;
    readonly content: string;
    readonly timestamp: string;
  }[];
  /** Metadata dictionary */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Options configuring context snapshot capture.
 */
export interface SnapshotCaptureOptions {
  /** Whether to capture git status and HEAD SHA (default: true) */
  readonly captureGitState?: boolean;
  /** Custom working tree directory for git state check */
  readonly gitCwd?: string;
  /** Inter-agent messages to include in the snapshot */
  readonly messages?: readonly {
    readonly id: string;
    readonly fromAgentId: string;
    readonly toAgentId: string;
    readonly content: string;
    readonly timestamp: Date | string;
  }[];
  /** Custom snapshot identifier override */
  readonly customSnapshotId?: string;
}

/**
 * Context Succession Snapshot captured during Orchestrator transfer (16-spawn limit).
 */
export interface SuccessionContextSnapshot {
  /** Unique snapshot identifier */
  readonly snapshotId: string;
  /** Schema version */
  readonly schemaVersion: string;
  /** ISO timestamp */
  readonly timestamp: string;
  /** Predecessor Orchestrator ID (e.g. teamwork_preview_orchestrator_1) */
  readonly predecessorAgentId: string;
  /** Successor Orchestrator ID (e.g. teamwork_preview_orchestrator_2) */
  readonly successorAgentId: string;
  /** Spawn count reached at handoff (e.g. 16) */
  readonly spawnCount: number;
  /** Max permitted spawns before succession */
  readonly maxSpawns: number;
  /** Trigger reason for succession */
  readonly reason: "SPAWN_LIMIT_REACHED" | "TOKEN_WATERMARK_80" | "MANUAL_SUCCESSION";
  /** Currently active or pending task keys */
  readonly activeTasks: readonly string[];
  /** Completed task keys */
  readonly completedTasks: readonly string[];
  /** Structured soft handoff payload */
  readonly handoffPayload: HandoffPayload;
  /** Snapshot of predecessor Orchestrator */
  readonly predecessorSnapshot?: AgentContextSnapshot;
  /** Git stash SHA if mid-execution succession occurred */
  readonly stashedSha?: string;
  /** Metadata */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Options for creating an Orchestrator succession snapshot.
 */
export interface CreateSuccessionSnapshotOptions {
  readonly predecessorAgentId: string;
  readonly successorAgentId: string;
  readonly spawnCount: number;
  readonly maxSpawns?: number;
  readonly reason?: "SPAWN_LIMIT_REACHED" | "TOKEN_WATERMARK_80" | "MANUAL_SUCCESSION";
  readonly activeTasks?: readonly string[];
  readonly completedTasks?: readonly string[];
  readonly predecessorSnapshot?: AgentContextSnapshot;
  readonly stashedSha?: string;
  readonly customNotes?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// HANDOFF PAYLOAD GENERATOR & VALIDATOR FUNCTIONS
// ============================================================================

/**
 * Creates and validates a strongly typed HandoffPayload.
 * Throws HandoffValidationError if any of the 5 mandatory sections are missing or empty.
 */
export function createHandoffPayload(options: CreateHandoffOptions): HandoffPayload {
  const role = normalizeRole(options.role);
  const roleDef = getRoleDefinition(role);

  const errors: string[] = [];
  const missing: string[] = [];

  const checkSection = (name: string, value: string | undefined): void => {
    if (value === undefined || value === null) {
      errors.push(`Missing mandatory handoff section: '${name}'`);
      missing.push(name);
    } else if (value.trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
      errors.push(`Mandatory handoff section '${name}' cannot be empty`);
      missing.push(name);
    }
  };

  checkSection(SNAPSHOT_CONSTANTS.COMPONENT_OBSERVATION, options.observation);
  checkSection(SNAPSHOT_CONSTANTS.COMPONENT_LOGIC_CHAIN, options.logicChain);
  checkSection(SNAPSHOT_CONSTANTS.COMPONENT_CAVEATS, options.caveats);
  checkSection(SNAPSHOT_CONSTANTS.COMPONENT_CONCLUSION, options.conclusion);
  checkSection(
    SNAPSHOT_CONSTANTS.COMPONENT_VERIFICATION_METHOD,
    options.verificationMethod
  );

  if (!options.agentId || options.agentId.trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
    errors.push("Handoff payload author 'agentId' cannot be empty");
  }

  if (errors.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
    throw new HandoffValidationError(errors, missing);
  }

  const timestamp =
    options.timestamp instanceof Date
      ? options.timestamp.toISOString()
      : options.timestamp ?? new Date().toISOString();

  return {
    agentId: options.agentId.trim(),
    role,
    tier: roleDef.tier,
    taskId: options.taskId?.trim(),
    verdict: options.verdict ?? SNAPSHOT_CONSTANTS.VERDICT_COMPLETED,
    handoffType: options.handoffType ?? SNAPSHOT_CONSTANTS.HANDOFF_TYPE_COMPLETION,
    observation: options.observation.trim(),
    logicChain: options.logicChain.trim(),
    caveats: options.caveats.trim(),
    conclusion: options.conclusion.trim(),
    verificationMethod: options.verificationMethod.trim(),
    modifiedFiles: options.modifiedFiles ? [...options.modifiedFiles] : [],
    testResults: options.testResults ? { ...options.testResults } : undefined,
    timestamp,
    metadata: options.metadata ? { ...options.metadata } : {},
  };
}

/**
 * Formats a HandoffPayload into standard GitHub-flavored Markdown conforming to
 * Antigravity Teamwork 5-component handoff protocol.
 */
export function formatHandoffMarkdown(payload: HandoffPayload): string {
  const roleDef = getRoleDefinition(payload.role);

  const lines = [
    `# Handoff Report: ${payload.agentId}`,
    "",
    `- **Author**: ${payload.agentId} (${roleDef.displayName})`,
    `- **Role**: ${payload.role} (Tier ${payload.tier})`,
    `- **Verdict**: \`${payload.verdict}\``,
    `- **Handoff Type**: \`${payload.handoffType}\``,
    `- **Timestamp**: ${payload.timestamp}`,
  ];

  if (payload.taskId) {
    lines.push(`- **Task Key**: \`${payload.taskId}\``);
  }

  lines.push(
    "",
    `## 1. ${SNAPSHOT_CONSTANTS.COMPONENT_OBSERVATION}`,
    payload.observation,
    "",
    `## 2. ${SNAPSHOT_CONSTANTS.COMPONENT_LOGIC_CHAIN}`,
    payload.logicChain,
    "",
    `## 3. ${SNAPSHOT_CONSTANTS.COMPONENT_CAVEATS}`,
    payload.caveats,
    "",
    `## 4. ${SNAPSHOT_CONSTANTS.COMPONENT_CONCLUSION}`,
    payload.conclusion,
    "",
    `## 5. ${SNAPSHOT_CONSTANTS.COMPONENT_VERIFICATION_METHOD}`,
    payload.verificationMethod
  );

  if (payload.modifiedFiles && payload.modifiedFiles.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
    lines.push(
      "",
      "## Modified Files",
      ...payload.modifiedFiles.map((file) => `- \`${file}\``)
    );
  }

  if (payload.testResults) {
    lines.push(
      "",
      "## Test Verification Results",
      `- **Passed**: ${payload.testResults.passed ? "Yes (Exit 0)" : "No (Failed)"}`
    );
    if (payload.testResults.command) {
      lines.push(`- **Command**: \`${payload.testResults.command}\``);
    }
    if (payload.testResults.exitCode !== undefined) {
      lines.push(`- **Exit Code**: ${payload.testResults.exitCode}`);
    }
    if (payload.testResults.preview) {
      lines.push("", "### Output Preview", "```", payload.testResults.preview, "```");
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Parses raw handoff markdown text into a structured HandoffPayload.
 * Extracts metadata lines, numbered or unnumbered headings, modified files, and test results.
 */
export function parseHandoffMarkdown(markdown: string): HandoffPayload {
  if (typeof markdown !== "string" || markdown.trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
    throw new HandoffValidationError(["Cannot parse empty or non-string handoff markdown."]);
  }

  // 1. Extract Agent ID / Title
  let agentId = "";
  const titleMatch = markdown.match(/^#\s+Handoff\s+Report:\s*(.+)$/im);
  const titleGroup = titleMatch?.[1];
  if (titleGroup) {
    agentId = titleGroup.trim();
  }

  // 2. Extract Author metadata
  const authorMatch = markdown.match(/-\s+\*\*Author\*\*:\s*([^\n(]+)/i);
  const authorGroup = authorMatch?.[1];
  if (authorGroup && !agentId) {
    agentId = authorGroup.trim();
  }

  // 3. Extract Role
  let role: CognitiveRole = COGNITIVE_ROLES.WORKER;
  const roleMatch = markdown.match(/-\s+\*\*Role\*\*:\s*([a-zA-Z_-]+)/i);
  const roleGroup = roleMatch?.[1];
  if (roleGroup) {
    try {
      role = normalizeRole(roleGroup);
    } catch {
      // fallback to worker if unrecognized
    }
  } else if (agentId) {
    // Attempt extracting role from agentId prefix (e.g. worker_1, explorer_002)
    const prefix = agentId.split("_")[SNAPSHOT_CONSTANTS.FIRST_INDEX];
    if (prefix && isValidRole(prefix.toLowerCase())) {
      role = prefix.toLowerCase() as CognitiveRole;
    }
  }

  // 4. Extract Verdict
  let verdict: HandoffVerdict = SNAPSHOT_CONSTANTS.VERDICT_COMPLETED;
  const verdictMatch = markdown.match(/-\s+\*\*Verdict\*\*:\s*`?([^`\n]+)`?/i);
  const verdictGroup = verdictMatch?.[1];
  if (verdictGroup) {
    verdict = verdictGroup.trim();
  }

  // 5. Extract Handoff Type
  let handoffType: HandoffType = SNAPSHOT_CONSTANTS.HANDOFF_TYPE_COMPLETION;
  const typeMatch = markdown.match(/-\s+\*\*Handoff\s+Type\*\*:\s*`?([a-zA-Z_-]+)`?/i);
  const typeGroup = typeMatch?.[1];
  if (typeGroup) {
    const rawType = typeGroup.trim().toLowerCase();
    if (
      rawType === "completion" ||
      rawType === "soft" ||
      rawType === "hard" ||
      rawType === "escalation"
    ) {
      handoffType = rawType;
    }
  }

  // 6. Extract Timestamp
  let timestamp = new Date().toISOString();
  const timeMatch = markdown.match(/-\s+\*\*Timestamp\*\*:\s*([^\n]+)/i);
  const timeGroup = timeMatch?.[1];
  if (timeGroup) {
    const parsedTime = timeGroup.trim();
    if (!isNaN(Date.parse(parsedTime))) {
      timestamp = new Date(parsedTime).toISOString();
    }
  }

  // 7. Extract Task Key
  let taskId: string | undefined = undefined;
  const taskMatch = markdown.match(/-\s+\*\*Task\s+Key\*\*:\s*`?([^`\n]+)`?/i);
  const taskGroup = taskMatch?.[1];
  if (taskGroup) {
    taskId = taskGroup.trim();
  }

  // 8. Extract the 5 core sections using flexible heading boundaries
  const extractSection = (headingRegex: RegExp, nextHeadingRegex: RegExp): string => {
    const startMatch = markdown.match(headingRegex);
    const startHeading = startMatch?.[SNAPSHOT_CONSTANTS.FIRST_INDEX];
    if (!startMatch || startMatch.index === undefined || !startHeading) {
      return "";
    }
    const startIndex = startMatch.index + startHeading.length;
    const remainder = markdown.slice(startIndex);
    const endMatch = remainder.match(nextHeadingRegex);
    const text = endMatch && endMatch.index !== undefined
      ? remainder.slice(SNAPSHOT_CONSTANTS.FIRST_INDEX, endMatch.index)
      : remainder;
    return text.trim();
  };

  const reObs = /##\s+(?:1[.)]\s*)?Observation\b/i;
  const reLogic = /##\s+(?:2[.)]\s*)?Logic\s*Chain\b/i;
  const reCaveats = /##\s+(?:3[.)]\s*)?Caveats\b/i;
  const reConclusion = /##\s+(?:4[.)]\s*)?Conclusion\b/i;
  const reVerification = /##\s+(?:5[.)]\s*)?Verification\s*Method\b/i;
  const reAfter = /##\s+(?:Modified\s+Files|Test\s+Verification\s+Results|Activity\s+Log)\b|$/i;

  const observation = extractSection(reObs, reLogic);
  const logicChain = extractSection(reLogic, reCaveats);
  const caveats = extractSection(reCaveats, reConclusion);
  const conclusion = extractSection(reConclusion, reVerification);
  const verificationMethod = extractSection(reVerification, reAfter);

  // 9. Extract Modified Files
  const modifiedFiles: string[] = [];
  const filesSection = extractSection(
    /##\s+Modified\s+Files\b/i,
    /##\s+Test\s+Verification\s+Results\b|$/i
  );
  if (filesSection) {
    const fileLines = filesSection.split("\n");
    for (const rawLine of fileLines) {
      const line = rawLine.trim();
      const match = line.match(/^-\s+`?([^`]+)`?$/);
      const matchedFile = match?.[1];
      if (matchedFile) {
        modifiedFiles.push(matchedFile.trim());
      }
    }
  }

  // 10. Extract Test Results
  let testResults: HandoffTestResults | undefined = undefined;
  const testSection = extractSection(/##\s+Test\s+Verification\s+Results\b/i, /^#/m);
  if (testSection) {
    const passedMatch = testSection.match(/-\s+\*\*Passed\*\*:\s*([^\n]+)/i);
    const cmdMatch = testSection.match(/-\s+\*\*Command\*\*:\s*`?([^`\n]+)`?/i);
    const exitMatch = testSection.match(/-\s+\*\*Exit\s+Code\*\*:\s*(\d+)/i);
    const passedText = passedMatch?.[1];
    const passed = passedText ? passedText.toLowerCase().includes("yes") : true;
    const command = cmdMatch?.[1]?.trim();
    const exitCodeStr = exitMatch?.[1];
    const exitCode = exitCodeStr !== undefined ? parseInt(exitCodeStr, 10) : undefined;
    testResults = { passed, command, exitCode };
  }

  return createHandoffPayload({
    agentId: agentId || "unknown_agent",
    role,
    taskId,
    verdict,
    handoffType,
    observation,
    logicChain,
    caveats,
    conclusion,
    verificationMethod,
    modifiedFiles,
    testResults,
    timestamp,
  });
}

/**
 * Validates whether markdown content or a HandoffPayload conforms to the
 * 5-component handoff standard.
 */
export function validateHandoffReport(
  contentOrPayload: string | HandoffPayload
): HandoffValidationResult {
  const errors: string[] = [];
  const missingSections: string[] = [];

  let payload: HandoffPayload;

  if (typeof contentOrPayload === "string") {
    try {
      payload = parseHandoffMarkdown(contentOrPayload);
    } catch (err) {
      if (err instanceof HandoffValidationError) {
        return {
          valid: false,
          errors: err.validationErrors,
          missingSections: err.missingSections,
        };
      }
      return {
        valid: false,
        errors: [err instanceof Error ? err.message : "Failed to parse handoff markdown."],
        missingSections: [],
      };
    }
  } else {
    payload = contentOrPayload;
  }

  const checkComponent = (name: string, value: string): void => {
    if (!value || value.trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
      errors.push(`Missing or empty required component: '${name}'`);
      missingSections.push(name);
    }
  };

  checkComponent(SNAPSHOT_CONSTANTS.COMPONENT_OBSERVATION, payload.observation);
  checkComponent(SNAPSHOT_CONSTANTS.COMPONENT_LOGIC_CHAIN, payload.logicChain);
  checkComponent(SNAPSHOT_CONSTANTS.COMPONENT_CAVEATS, payload.caveats);
  checkComponent(SNAPSHOT_CONSTANTS.COMPONENT_CONCLUSION, payload.conclusion);
  checkComponent(
    SNAPSHOT_CONSTANTS.COMPONENT_VERIFICATION_METHOD,
    payload.verificationMethod
  );

  if (!payload.agentId || payload.agentId.trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
    errors.push("Missing required author 'agentId'");
  }

  return {
    valid: errors.length === SNAPSHOT_CONSTANTS.EMPTY_COUNT,
    errors,
    missingSections,
    payload: errors.length === SNAPSHOT_CONSTANTS.EMPTY_COUNT ? payload : undefined,
  };
}

/**
 * Generates a specialized Soft Handoff payload for Orchestrator succession (16-spawn limit).
 */
export function createSuccessionHandoffPayload(options: {
  readonly predecessorId: string;
  readonly successorId: string;
  readonly spawnCount: number;
  readonly maxSpawns?: number;
  readonly activeTasks?: readonly string[];
  readonly completedTasks?: readonly string[];
  readonly customNotes?: string;
}): HandoffPayload {
  const max = options.maxSpawns ?? SNAPSHOT_CONSTANTS.DEFAULT_MAX_ORCHESTRATOR_SPAWNS;
  const active = options.activeTasks ?? [];
  const completed = options.completedTasks ?? [];

  const activeList =
    active.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT
      ? active.map((t) => `- \`${t}\``).join("\n")
      : "- (None currently active; awaiting task selection)";

  const completedList =
    completed.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT
      ? completed.map((t) => `- \`${t}\``).join("\n")
      : "- (None completed in this succession window)";

  const notes = options.customNotes ? `\n\nNotes:\n${options.customNotes}` : "";

  return createHandoffPayload({
    agentId: options.predecessorId,
    role: COGNITIVE_ROLES.ORCHESTRATOR,
    verdict: SNAPSHOT_CONSTANTS.VERDICT_APPROVED,
    handoffType: SNAPSHOT_CONSTANTS.HANDOFF_TYPE_SOFT,
    observation:
      `Predecessor Orchestrator '${options.predecessorId}' reached ${options.spawnCount} spawns ` +
      `(threshold limit: ${max}). Active dispatches paused at clean task boundary.${notes}`,
    logicChain:
      `Antigravity Teamwork 16-spawn succession invariant triggered to eliminate context degradation ` +
      `and cognitive drift. Seamless transfer initiated to successor '${options.successorId}'.\n\n` +
      `### Active Tasks in Progress\n${activeList}\n\n` +
      `### Completed Milestones\n${completedList}`,
    caveats:
      `Successor must inherit directory structure, verify uncommitted diff state against baseline SHA, ` +
      `and resume topological DAG execution from the first uncompleted task.`,
    conclusion:
      `State transition to '${options.successorId}' authorized. Handing over orchestration baton.`,
    verificationMethod:
      `bun test test/core/dispatcher.test.ts && git status --porcelain`,
  });
}

/**
 * Generates a diagnostic handoff report for Escalation Rungs 2 and 3
 * (Challenger diagnostic or Explorer deep dive).
 */
export function createDiagnosticHandoffPayload(options: {
  readonly agentId: string;
  readonly role: CognitiveRole | string;
  readonly taskId?: string;
  readonly error: Error | string;
  readonly failingCommand?: string;
  readonly rootCause?: string;
  readonly proposedFix?: string;
  readonly verificationMethod?: string;
}): HandoffPayload {
  const errMessage = options.error instanceof Error ? options.error.message : options.error;
  const failingCmd = options.failingCommand ?? "bun test";

  return createHandoffPayload({
    agentId: options.agentId,
    role: options.role,
    taskId: options.taskId,
    verdict: SNAPSHOT_CONSTANTS.VERDICT_REJECTED,
    handoffType: SNAPSHOT_CONSTANTS.HANDOFF_TYPE_ESCALATION,
    observation:
      `Diagnostic failure encountered during execution.\n` +
      `- Failing Command: \`${failingCmd}\`\n` +
      `- Error Diagnostic: ${errMessage}`,
    logicChain:
      options.rootCause ??
      `Causal analysis: System triggered invariant rejection or compiler error. Detailed trace requires targeted worker remediation.`,
    caveats:
      `Remediation must preserve existing public API contracts and adhere to zero magic numbers.`,
    conclusion:
      options.proposedFix ??
      `Task reverted to Worker with diagnostic failure findings. Apply fix and re-run verification suite.`,
    verificationMethod:
      options.verificationMethod ?? `${failingCmd} && bunx tsc --noEmit`,
  });
}

// ============================================================================
// CONTEXT SNAPSHOTTING ENGINE
// ============================================================================

/**
 * Parses BRIEFING.md memory text into structured components.
 */
function parseBriefingMemory(raw: string): ParsedBriefingMemory {
  const identityMatch = raw.match(/##\s+🔒\s+My\s+Identity\b([\s\S]*?)(?=##|$)/i);
  const constraintsMatch = raw.match(/##\s+🔒\s+Key\s+Constraints\b([\s\S]*?)(?=##|$)/i);
  const objectiveMatch = raw.match(/##\s+Current\s+Objective\b([\s\S]*?)(?=##|$)/i);
  const decisionsMatch = raw.match(/##\s+Recent\s+Decisions\s+&\s+Context\b([\s\S]*?)(?=##|$)/i);

  const lockedIdentity = identityMatch?.[1]?.trim();
  const objective = objectiveMatch?.[1]?.trim();

  let lockedConstraints: string[] | undefined = undefined;
  const constraintsContent = constraintsMatch?.[1];
  if (constraintsContent) {
    const lines = constraintsContent.split("\n");
    lockedConstraints = lines
      .map((l) => l.replace(/^[-*]\s*(?:🔒\s*)?/, "").trim())
      .filter((l) => l.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT);
  }

  let recentDecisions: string[] | undefined = undefined;
  const decisionsContent = decisionsMatch?.[1];
  if (decisionsContent) {
    const lines = decisionsContent.split("\n");
    recentDecisions = lines
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT);
  }

  return {
    raw,
    lockedIdentity,
    lockedConstraints,
    objective,
    recentDecisions,
  };
}

/**
 * Parses progress.md telemetry text into structured components.
 */
function parseProgressTelemetry(raw: string): ParsedProgressTelemetry {
  const lastVisitedMatch = raw.match(/\*\*Last\s+Visited\*\*:\s*([^\n]+)/i);
  const statusMatch = raw.match(/\*\*Status\*\*:\s*([^\n]+)/i);
  const activityMatch = raw.match(/##\s+Activity\s+Log\b([\s\S]*?)$/i);

  const lastVisited = lastVisitedMatch?.[1]?.trim();
  const status = statusMatch?.[1]?.trim();

  let activityLog: string[] | undefined = undefined;
  const activityContent = activityMatch?.[1];
  if (activityContent) {
    const lines = activityContent.split("\n");
    activityLog = lines
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT);
  }

  return {
    raw,
    lastVisited,
    status,
    activityLog,
  };
}

/**
 * Parses DISPATCH.md manifest text into structured components.
 */
function parseDispatchManifest(raw: string): ParsedDispatchManifest {
  const missionMatch = raw.match(/##\s+Assigned\s+Mission\b([\s\S]*?)(?=##|$)/i);
  const scopeMatch = raw.match(/##\s+Authorized\s+Target\s+Scope\b([\s\S]*?)(?=##|$)/i);
  const skillsMatch = raw.match(/##\s+Injected\s+Skills\b([\s\S]*?)(?=##|$)/i);

  const mission = missionMatch?.[1]?.trim();

  let targetScope: string[] | undefined = undefined;
  const scopeContent = scopeMatch?.[1];
  if (scopeContent) {
    const lines = scopeContent.split("\n");
    targetScope = lines
      .map((l) => l.replace(/^[-*]\s*`?([^`]+)`?$/, "$1").trim())
      .filter((l) => l.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT && !l.startsWith("("));
  }

  let injectedSkills: string[] | undefined = undefined;
  const skillsContent = skillsMatch?.[1];
  if (skillsContent) {
    const lines = skillsContent.split("\n");
    injectedSkills = lines
      .map((l) => l.replace(/^[-*]\s*`?([^`]+)`?$/, "$1").trim())
      .filter((l) => l.length > SNAPSHOT_CONSTANTS.EMPTY_COUNT && !l.startsWith("("));
  }

  return {
    raw,
    mission,
    targetScope,
    injectedSkills,
  };
}

/**
 * Captures an immutable point-in-time serializable snapshot of a subagent's
 * context, files, logs, telemetry, and working tree baseline.
 */
export async function captureContextSnapshot(
  agent: SnapshotTargetAgent,
  options?: SnapshotCaptureOptions
): Promise<AgentContextSnapshot> {
  const roleDef = getRoleDefinition(agent.role);
  const now = new Date();

  const snapshotId =
    options?.customSnapshotId ??
    `snap_${agent.id}_${Date.now()}_${randomBytes(
      SNAPSHOT_CONSTANTS.ID_RANDOM_BYTES
    ).toString("hex")}`;

  // 1. Read BRIEFING.md if present
  let briefingMemory: ParsedBriefingMemory | undefined = undefined;
  if (existsSync(agent.sandbox.briefingPath)) {
    try {
      const raw = await readAtomic(agent.sandbox.briefingPath);
      briefingMemory = parseBriefingMemory(raw);
    } catch {
      // Ignore read errors
    }
  }

  // 2. Read progress.md if present
  let progressTelemetry: ParsedProgressTelemetry | undefined = undefined;
  if (existsSync(agent.sandbox.progressPath)) {
    try {
      const raw = await readAtomic(agent.sandbox.progressPath);
      progressTelemetry = parseProgressTelemetry(raw);
    } catch {
      // Ignore read errors
    }
  }

  // 3. Read DISPATCH.md if present
  let dispatchManifest: ParsedDispatchManifest | undefined = undefined;
  if (existsSync(agent.sandbox.dispatchPath)) {
    try {
      const raw = await readAtomic(agent.sandbox.dispatchPath);
      dispatchManifest = parseDispatchManifest(raw);
    } catch {
      // Ignore read errors
    }
  }

  // 4. Read handoff.md if present
  let handoffState: { raw: string; parsed?: HandoffPayload } | undefined = undefined;
  if (existsSync(agent.sandbox.handoffPath)) {
    try {
      const raw = await readAtomic(agent.sandbox.handoffPath);
      let parsed: HandoffPayload | undefined = undefined;
      try {
        parsed = parseHandoffMarkdown(raw);
      } catch {
        // Handoff may not yet conform or be complete
      }
      handoffState = { raw, parsed };
    } catch {
      // Ignore read errors
    }
  }

  // 5. Capture Git working tree state if requested
  let gitState:
    | {
        headSha: string;
        isDirty: boolean;
        untrackedFiles: readonly string[];
        modifiedFiles: readonly string[];
      }
    | undefined = undefined;

  const shouldCaptureGit = options?.captureGitState ?? true;
  if (shouldCaptureGit) {
    try {
      const gitCwd = options?.gitCwd ?? agent.sandbox.workspaceRoot;
      const state: GitWorkingTreeState = await captureGitState({ cwd: gitCwd });
      gitState = {
        headSha: state.headSha,
        isDirty: state.isDirty,
        untrackedFiles: [...state.untrackedFiles],
        modifiedFiles: [...state.modifiedFiles],
      };
    } catch {
      // Graceful fallback if not in git repo or git is unavailable
    }
  }

  // 6. Map logs
  const logs = (agent.logs ?? []).map((l) => ({
    timestamp: l.timestamp.toISOString(),
    level: l.level,
    message: l.message,
  }));

  // 7. Map messages
  const messages = (options?.messages ?? [])
    .filter(
      (m) => m.fromAgentId === agent.id || m.toAgentId === agent.id
    )
    .map((m) => ({
      id: m.id,
      fromAgentId: m.fromAgentId,
      toAgentId: m.toAgentId,
      content: m.content,
      timestamp:
        m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
    }));

  // 8. Calculate duration
  const startTime = agent.startTime.toISOString();
  const completedTime = agent.completedTime?.toISOString();
  const durationMs = agent.completedTime
    ? agent.completedTime.getTime() - agent.startTime.getTime()
    : now.getTime() - agent.startTime.getTime();

  return {
    snapshotId,
    schemaVersion: SNAPSHOT_CONSTANTS.SCHEMA_VERSION,
    timestamp: now.toISOString(),
    agentId: agent.id,
    role: agent.role,
    tier: roleDef.tier,
    status: agent.status,
    taskId: agent.taskId,
    taskDescription: agent.taskDescription,
    spawnIndex: agent.spawnIndex,
    startTime,
    completedTime,
    durationMs,
    sandbox: {
      sandboxDir: agent.sandbox.sandboxDir,
      workspaceRoot: agent.sandbox.workspaceRoot,
      workingDirectory: agent.sandbox.workingDirectory,
      briefingPath: agent.sandbox.briefingPath,
      progressPath: agent.sandbox.progressPath,
      dispatchPath: agent.sandbox.dispatchPath,
      handoffPath: agent.sandbox.handoffPath,
      skills: [...agent.sandbox.skills],
    },
    memory: {
      briefing: briefingMemory,
      progress: progressTelemetry,
      dispatch: dispatchManifest,
      handoff: handoffState,
    },
    gitState,
    logs,
    messages,
    metadata: agent.metadata ? { ...agent.metadata } : {},
  };
}

/**
 * Serializes an AgentContextSnapshot into a formatted JSON string.
 */
export function serializeContextSnapshot(snapshot: AgentContextSnapshot): string {
  return JSON.stringify(snapshot, null, SNAPSHOT_CONSTANTS.DEFAULT_JSON_INDENT);
}

/**
 * Deserializes and validates a JSON string into an AgentContextSnapshot.
 * Throws InvalidSnapshotError if schema validation fails.
 */
export function deserializeContextSnapshot(jsonStr: string): AgentContextSnapshot {
  if (typeof jsonStr !== "string" || jsonStr.trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT) {
    throw new InvalidSnapshotError("Cannot deserialize empty snapshot JSON string.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new InvalidSnapshotError(
      `Snapshot JSON syntax error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new InvalidSnapshotError("Snapshot JSON must evaluate to an object.");
  }

  const obj = parsed as Record<string, unknown>;

  if (
    typeof obj["snapshotId"] !== "string" ||
    obj["snapshotId"].trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT
  ) {
    throw new InvalidSnapshotError("Snapshot missing required string field: 'snapshotId'");
  }

  if (obj["schemaVersion"] !== SNAPSHOT_CONSTANTS.SCHEMA_VERSION) {
    throw new InvalidSnapshotError(
      `Invalid snapshot schema version: expected '${SNAPSHOT_CONSTANTS.SCHEMA_VERSION}', got '${obj["schemaVersion"]}'`
    );
  }

  if (
    typeof obj["agentId"] !== "string" ||
    obj["agentId"].trim().length === SNAPSHOT_CONSTANTS.EMPTY_COUNT
  ) {
    throw new InvalidSnapshotError("Snapshot missing required string field: 'agentId'");
  }

  if (!isValidRole(obj["role"])) {
    throw new InvalidSnapshotError(`Snapshot contains invalid cognitive role: '${obj["role"]}'`);
  }

  return parsed as AgentContextSnapshot;
}

/**
 * Atomically saves an AgentContextSnapshot to a JSON file.
 * Defaults to `<sandboxDir>/snapshot.json` if no target path is specified.
 */
export async function saveContextSnapshot(
  snapshot: AgentContextSnapshot,
  filePath?: string
): Promise<string> {
  const targetPath =
    filePath ?? resolve(snapshot.sandbox.sandboxDir, SNAPSHOT_CONSTANTS.FILE_SNAPSHOT);

  const jsonStr = serializeContextSnapshot(snapshot);
  await writeAtomic(targetPath, jsonStr);
  return targetPath;
}

/**
 * Loads and deserializes an AgentContextSnapshot from disk.
 */
export async function loadContextSnapshot(filePath: string): Promise<AgentContextSnapshot> {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new SnapshotError(
      `Snapshot file not found at '${resolved}'`,
      SNAPSHOT_CONSTANTS.ERR_SNAPSHOT_NOT_FOUND
    );
  }

  const raw = await readAtomic(resolved);
  return deserializeContextSnapshot(raw);
}

/**
 * Packages an Orchestrator Succession Snapshot during 16-spawn boundary transitions.
 */
export function createSuccessionSnapshot(
  options: CreateSuccessionSnapshotOptions
): SuccessionContextSnapshot {
  const now = new Date();
  const maxSpawns =
    options.maxSpawns ?? SNAPSHOT_CONSTANTS.DEFAULT_MAX_ORCHESTRATOR_SPAWNS;
  const reason = options.reason ?? SNAPSHOT_CONSTANTS.REASON_SPAWN_LIMIT;

  const snapshotId = `succession_${options.predecessorAgentId}_to_${options.successorAgentId}_${Date.now()}`;

  const handoffPayload = createSuccessionHandoffPayload({
    predecessorId: options.predecessorAgentId,
    successorId: options.successorAgentId,
    spawnCount: options.spawnCount,
    maxSpawns,
    activeTasks: options.activeTasks,
    completedTasks: options.completedTasks,
    customNotes: options.customNotes,
  });

  return {
    snapshotId,
    schemaVersion: SNAPSHOT_CONSTANTS.SCHEMA_VERSION,
    timestamp: now.toISOString(),
    predecessorAgentId: options.predecessorAgentId,
    successorAgentId: options.successorAgentId,
    spawnCount: options.spawnCount,
    maxSpawns,
    reason,
    activeTasks: options.activeTasks ? [...options.activeTasks] : [],
    completedTasks: options.completedTasks ? [...options.completedTasks] : [],
    handoffPayload,
    predecessorSnapshot: options.predecessorSnapshot,
    stashedSha: options.stashedSha,
    metadata: options.metadata ? { ...options.metadata } : {},
  };
}
