/**
 * Dynamic 6-Rung Failure Escalation Ladder Engine.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 2.5 and Section 6.1 (LOOPER-CORE-004),
 * and OpenSpec change proposal `looper-core-router-escalation` Tasks 1.1, 1.2, and 1.3.
 *
 * Architecture & Design Invariants:
 * 1. Progressive Remediative Escalation:
 *    - Rung 1 (Local Mechanical Retry): Injects stdout/stderr failure traces back to Worker (Attempts 1..2). Working tree retained dirty.
 *    - Rung 2 (Challenger Diagnostic): Working tree retained dirty! Dispatches Challenger to synthesize minimal reproduction script demonstrating failure.
 *    - Rung 3 (Explorer Deep Dive): Working tree retained dirty! Worker suspended. Dispatches Explorer for read-only root-cause survey across modules; generates remediation.patch.
 *    - Rung 4 (Clean Worker Replacement): Atomic rollback executed now (`git reset --hard ${baselineSha} && git clean -fd -e .agents/teamwork/ -e projects/`).
 *      Kills stuck Worker and spawns fresh Worker initialized with Explorer's remediation.patch.
 *    - Rung 5 (Task Re-Decomposition): Orchestrator marks task as compound; splits into 2-3 smaller sub-tasks in dependency DAG.
 *    - Rung 6 (Sentinel Human Escalation): Marks task `BLOCKED: <reason>`; notifies Sentinel; suspends task; proceeds with independent DAG branches or awaits human input.
 * 2. Deliberate Dirty Diff Retention:
 *    - Rungs 1, 2, and 3 strictly preserve dirty workspace diffs without resetting, allowing surgical fixes, minimal repro authoring, and root-cause survey.
 * 3. Atomic Rollback Isolation:
 *    - Rung 4 performs clean git reset and clean while preserving `.agents/teamwork/` and `projects/` assets.
 * 4. Zero Magic Numbers & Strict Typing:
 *    - All counts, offsets, and thresholds centralized in `ESCALATION_CONSTANTS`, `SUCCESSION_CONSTANTS`, and `FAILURE_CLASSIFIER_CONSTANTS`.
 * 5. Orchestrator Context Succession (16-Spawn Rule & Mid-Execution Invariant):
 *    - Tracks spawn counts and token watermark utilization.
 *    - Rotates ephemeral Orchestrators at safe task boundaries (or via mid-execution stash/rollback) upon reaching 16 spawns or 80% token quota.
 *    - Formulates succession snapshots, soft handoffs, and initializes successor `BRIEFING.md` preserving append-only invariants.
 * 6. Autonomous Failure Classifier & Tri-Modal Routing (Task 1.3):
 *    - Evaluates incoming failure reports across mechanical, contextual, and invariant tiers.
 *    - Dispatches to three objective targets:
 *      a) 'retry': local mechanical retry with dirty diff retention for transient assertion / exit-code failures within budget.
 *      b) 'prompt_enrichment': contextual prompt enrichment for TypeScript compiler errors, reviewer revisions, and challenger breaks.
 *      c) 'forensic_audit': binary veto enforcement, layout invariant inspection, and git hygiene validation for critical invariant violations.
 */

import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { COGNITIVE_ROLES, type CognitiveRole } from "../pal/types";
import { LOOPER_EVENTS, LOOPER_STATES, type LooperEvent, type LooperState } from "./fsm_types";
import {
  SNAPSHOT_CONSTANTS,
  createSuccessionSnapshot,
  type AgentContextSnapshot,
  type HandoffPayload,
  type SuccessionContextSnapshot,
} from "./snapshot";

/**
 * Central constants ensuring zero magic numbers across escalation operations.
 */
export const ESCALATION_CONSTANTS = {
  // Escalation Ladder Rungs (1 through 6)
  RUNG_1_LOCAL_RETRY: 1,
  RUNG_2_CHALLENGER_DIAGNOSTIC: 2,
  RUNG_3_EXPLORER_DEEP_DIVE: 3,
  RUNG_4_WORKER_REPLACEMENT: 4,
  RUNG_5_TASK_REDECOMPOSITION: 5,
  RUNG_6_SENTINEL_ESCALATION: 6,

  MIN_RUNG: 1,
  MAX_RUNG: 6,
  TOTAL_RUNGS: 6,

  // Default Max Attempts per Rung
  MAX_LOCAL_RETRIES: 2,
  MAX_CHALLENGER_ATTEMPTS: 2,
  MAX_EXPLORER_ATTEMPTS: 1,
  MAX_WORKER_REPLACEMENT_ATTEMPTS: 1,
  MAX_REDECOMPOSITION_ATTEMPTS: 1,
  MAX_SENTINEL_ATTEMPTS: 1,

  // Numeric zero & offsets
  ZERO: 0,
  FIRST_INDEX: 0,
  INDEX_OFFSET_ONE: 1,
  INCREMENT_ONE: 1,
  INITIAL_ATTEMPT: 1,
  MIN_DECOMPOSED_SUBTASKS: 2,
  MAX_DECOMPOSED_SUBTASKS: 3,
  DEFAULT_DECOMPOSED_SUBTASKS: 2,
  REGEX_CAPTURE_GROUP_ONE: 1,
  HEX_BYTES_LENGTH: 8,

  // Rung Identifiers
  NAME_LOCAL_RETRY: "local_retry" as const,
  NAME_CHALLENGER_DIAGNOSTIC: "challenger_diagnostic" as const,
  NAME_EXPLORER_DEEP_DIVE: "explorer_deep_dive" as const,
  NAME_WORKER_REPLACEMENT: "clean_worker_replacement" as const,
  NAME_TASK_REDECOMPOSITION: "task_redecomposition" as const,
  NAME_SENTINEL_ESCALATION: "sentinel_escalation" as const,

  // Working Tree Policies
  WORKING_TREE_RETAIN_DIRTY: "retain_dirty" as const,
  WORKING_TREE_ATOMIC_ROLLBACK: "atomic_rollback" as const,
  WORKING_TREE_CLEAN_ISOLATE: "clean_isolate" as const,
  WORKING_TREE_BLOCKED: "blocked" as const,

  // Status Identifiers
  STATUS_IDLE: "idle" as const,
  STATUS_IN_PROGRESS: "in_progress" as const,
  STATUS_RESOLVED: "resolved" as const,
  STATUS_BLOCKED: "blocked" as const,
  STATUS_ABORTED: "aborted" as const,

  // Action Identifiers
  ACTION_RETRY_CURRENT_RUNG: "retry_current_rung" as const,
  ACTION_ADVANCE_RUNG: "advance_rung" as const,
  ACTION_RESOLVE: "resolve" as const,
  ACTION_BLOCK_TASK: "block_task" as const,

  // Git / Shell Commands & Preserved Directories
  ROLLBACK_RESET_COMMAND: "git reset --hard",
  ROLLBACK_CLEAN_COMMAND: "git clean -fd -e .agents/teamwork/ -e projects/",
  PRESERVED_PATHS: [".agents/teamwork/", "projects/"] as const,

  // Blocked Formatting & Markers
  BLOCKED_PREFIX: "BLOCKED: ",
  BLOCKED_REASON_NONE: "none",
  DEFAULT_BLOCKED_REASON: "Unresolvable task failure after completing 6-rung dynamic escalation ladder.",

  // Orchestrator succession defaults
  SUCCESSION_MAX_SPAWNS: 16,
  SUCCESSION_TOKEN_WATERMARK: 80,
} as const;

/**
 * Central constants ensuring zero magic numbers across orchestrator context succession operations.
 */
export const SUCCESSION_CONSTANTS = {
  // Spawn limit threshold (16-spawn boundary)
  DEFAULT_MAX_SPAWNS: 16,
  SPAWN_INCREMENT: 1,
  INITIAL_SPAWN_COUNT: 0,

  // Token utilization thresholds
  DEFAULT_TOKEN_WATERMARK_PERCENT: 80,
  DEFAULT_TOKEN_WARNING_PERCENT: 75,
  INITIAL_TOKEN_UTILIZATION: 0,
  MIN_PERCENT: 0,
  MAX_PERCENT: 100,

  // Approaching limit warning threshold offset
  DEFAULT_SPAWN_WARNING_OFFSET: 2,

  // Generation offsets
  INITIAL_GENERATION: 1,
  GENERATION_INCREMENT: 1,

  // Orchestrator ID conventions
  DEFAULT_ORCHESTRATOR_PREFIX: "teamwork_preview_orchestrator_",
  INITIAL_ORCHESTRATOR_ID: "teamwork_preview_orchestrator_1",
  ORCHESTRATOR_ID_FALLBACK_INDEX: 2,

  // Trigger reasons
  REASON_SPAWN_LIMIT: "SPAWN_LIMIT_REACHED" as const,
  REASON_TOKEN_WATERMARK: "TOKEN_WATERMARK_80" as const,
  REASON_MANUAL: "MANUAL_SUCCESSION" as const,

  // Succession lifecycle status
  STATUS_ACTIVE: "active" as const,
  STATUS_PAUSED: "paused" as const,
  STATUS_HANDING_OVER: "handing_over" as const,
  STATUS_SUCCEEDED: "succeeded" as const,

  // Event identifiers
  EVENT_SUCCESSION_LIMIT_REACHED: "succession:limit_reached",
  EVENT_SUCCESSION_WARNING: "succession:warning",
  EVENT_SUCCESSION_TOKEN_WATERMARK: "succession:token_watermark_reached",
  EVENT_SUCCESSION_PAUSED: "succession:paused",
  EVENT_SUCCESSION_RESUMED: "succession:resumed",
  EVENT_SUCCESSION_HANDOVER_STARTED: "succession:handover_started",
  EVENT_SUCCESSION_COMPLETED: "succession:completed",
  EVENT_SUCCESSION_MID_EXECUTION: "succession:mid_execution_triggered",

  // Teamwork and artifact constants
  TEAMWORK_DIR: ".agents/teamwork/",
  BRIEFING_FILENAME: "BRIEFING.md",
  HANDOFF_FILENAME: "handoff.md",
  PROGRESS_FILENAME: "progress.md",

  // Numbers & offsets
  ZERO: 0,
  ONE: 1,
  INCREMENT_ONE: 1,
  REGEX_MATCH_PREFIX_GROUP: 1,
  REGEX_MATCH_DIGITS_GROUP: 2,
  PARSE_INT_RADIX: 10,
} as const;

/**
 * Canonical failure routing targets for automated recovery pipelines (Task 1.3).
 */
export const FAILURE_ROUTING_TARGETS = {
  RETRY: "retry" as const,
  PROMPT_ENRICHMENT: "prompt_enrichment" as const,
  FORENSIC_AUDIT: "forensic_audit" as const,
} as const;

export type FailureRoutingTarget =
  (typeof FAILURE_ROUTING_TARGETS)[keyof typeof FAILURE_ROUTING_TARGETS];

/**
 * Standardized taxonomy of failure categories across mechanical, contextual, and invariant tiers.
 */
export const FAILURE_CATEGORIES = {
  // Mechanical / Transient (-> retry)
  TRANSIENT_MECHANICAL: "transient_mechanical" as const,
  TRANSIENT_NETWORK: "transient_network" as const,
  ASSERTION_FAILURE: "assertion_failure" as const,

  // Contextual / Semantic (-> prompt_enrichment)
  TYPE_CHECK_COMPILER: "type_check_compiler" as const,
  SEMANTIC_LOGIC: "semantic_logic" as const,
  REVIEWER_REVISION: "reviewer_revision" as const,
  CHALLENGER_BREAK: "challenger_break" as const,
  EXHAUSTED_LOCAL_RETRY: "exhausted_local_retry" as const,

  // Invariant / Structural / Fatal (-> forensic_audit)
  LAYOUT_INVARIANT_VIOLATION: "layout_invariant_violation" as const,
  GIT_HYGIENE_VIOLATION: "git_hygiene_violation" as const,
  PROTECTED_SECTION_TAMPERING: "protected_section_tampering" as const,
  BINARY_VETO: "binary_veto" as const,
  PROCESS_TIMEOUT_HANG: "process_timeout_hang" as const,
  SECURITY_CREDENTIAL_LEAK: "security_credential_leak" as const,
  FATAL_UNRECOVERABLE: "fatal_unrecoverable" as const,
  UNKNOWN_ANOMALY: "unknown_anomaly" as const,
} as const;

export type FailureCategory =
  (typeof FAILURE_CATEGORIES)[keyof typeof FAILURE_CATEGORIES];

/**
 * Failure severity levels for routing and risk assessment.
 */
export const FAILURE_SEVERITIES = {
  LOW: "low" as const,
  MEDIUM: "medium" as const,
  HIGH: "high" as const,
  CRITICAL: "critical" as const,
} as const;

export type FailureSeverity =
  (typeof FAILURE_SEVERITIES)[keyof typeof FAILURE_SEVERITIES];

/**
 * Central constants ensuring zero magic numbers across failure classification and routing operations.
 */
export const FAILURE_CLASSIFIER_CONSTANTS = {
  // Routing targets
  TARGET_RETRY: "retry" as const,
  TARGET_PROMPT_ENRICHMENT: "prompt_enrichment" as const,
  TARGET_FORENSIC_AUDIT: "forensic_audit" as const,

  // Default thresholds & attempt boundaries
  DEFAULT_MAX_RETRY_ATTEMPTS: 2,
  INITIAL_ATTEMPT: 1,
  ZERO: 0,
  ONE: 1,
  INDEX_OFFSET_ONE: 1,

  // Confidence values
  CONFIDENCE_HIGH: 0.95,
  CONFIDENCE_MEDIUM: 0.8,
  CONFIDENCE_LOW: 0.5,
  CONFIDENCE_FALLBACK: 0.6,

  // Severity weights
  SEVERITY_WEIGHT_LOW: 1,
  SEVERITY_WEIGHT_MEDIUM: 2,
  SEVERITY_WEIGHT_HIGH: 3,
  SEVERITY_WEIGHT_CRITICAL: 4,

  // Rule priorities
  PRIORITY_CRITICAL_FORENSIC: 100,
  PRIORITY_HIGH_ENRICHMENT: 50,
  PRIORITY_NORMAL_RETRY: 10,
  PRIORITY_FALLBACK: 0,

  // Event names
  EVENT_CLASSIFIED: "classifier:classified",
  EVENT_ROUTED: "classifier:routed",
  EVENT_RETRY_DISPATCHED: "classifier:retry_dispatched",
  EVENT_PROMPT_ENRICHED: "classifier:prompt_enriched",
  EVENT_FORENSIC_AUDIT_TRIGGERED: "classifier:forensic_audit_triggered",

  // Regex patterns
  REGEX_TYPE_ERROR:
    /TS\d{4,5}:|type error|cannot find name|property .* does not exist|is not assignable to|type '.*' is not assignable|argument of type/i,
  REGEX_SYNTAX_ERROR:
    /syntaxerror|unexpected token|parsing error|failed to parse/i,
  REGEX_LINTER_ERROR:
    /eslint|biome|prettier|formatting error|lint error/i,
  REGEX_REVIEWER_REVISION:
    /revision required|spec fidelity|architectural violation|missing test coverage|criteria not met|reviewer.*reject/i,
  REGEX_CHALLENGER_BREAK:
    /challenger.*break|fuzz.*probe|adversarial probe|edge case failure|boundary crash|reproduction probe/i,
  REGEX_LAYOUT_VIOLATION:
    /\.agents\/teamwork\/.*(\.(ts|js|jsx|tsx|sh|py|jsonc?|lock)|package\.json|node_modules)|layout invariant|unauthorized workspace mutation|written outside/i,
  REGEX_GIT_HYGIENE:
    /git hygiene|secret.*key|bearer token|api[_-]?key|BEGIN (?:RSA|OPENSSH|PGP) PRIVATE KEY|\.env|\.tmp|unstaged binary|\.tar|\.zip/i,
  REGEX_PROTECTED_SECTION:
    /🔒|protected section|append-only|tamper.*briefing|read-only section/i,
  REGEX_BINARY_VETO:
    /binary veto|gate 3 veto|forensic veto|absolute veto/i,
  REGEX_TIMEOUT_HANG:
    /timed? ?out|execution timeout|process hung|exceeded maximum duration|watchdog heartbeat expired/i,
  REGEX_SECURITY_FATAL:
    /unauthorized|authentication failed|credential missing|invalid api token|corrupted git index|fatal initialization/i,
  REGEX_TRANSIENT_ASSERTION:
    /assertionerror|expect\(.*received|exit code [1-9]|test failed|failing test/i,

  // Parsing constants
  PARSE_INT_RADIX: 10,
  RAW_SNIPPET_MAX_LENGTH: 300,
  PERCENTAGE_MULTIPLIER: 100,
} as const;

/**
 * Valid escalation ladder rungs (1 through 6).
 */
export type EscalationRung = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Canonical names for the 6 rungs of the escalation ladder.
 */
export type EscalationRungName =
  | typeof ESCALATION_CONSTANTS.NAME_LOCAL_RETRY
  | typeof ESCALATION_CONSTANTS.NAME_CHALLENGER_DIAGNOSTIC
  | typeof ESCALATION_CONSTANTS.NAME_EXPLORER_DEEP_DIVE
  | typeof ESCALATION_CONSTANTS.NAME_WORKER_REPLACEMENT
  | typeof ESCALATION_CONSTANTS.NAME_TASK_REDECOMPOSITION
  | typeof ESCALATION_CONSTANTS.NAME_SENTINEL_ESCALATION;

/**
 * Working tree git retention policy for an escalation rung.
 */
export type WorkingTreePolicy =
  | typeof ESCALATION_CONSTANTS.WORKING_TREE_RETAIN_DIRTY
  | typeof ESCALATION_CONSTANTS.WORKING_TREE_ATOMIC_ROLLBACK
  | typeof ESCALATION_CONSTANTS.WORKING_TREE_CLEAN_ISOLATE
  | typeof ESCALATION_CONSTANTS.WORKING_TREE_BLOCKED;

/**
 * Lifecycle status of an escalation ladder instance.
 */
export type EscalationStatus =
  | typeof ESCALATION_CONSTANTS.STATUS_IDLE
  | typeof ESCALATION_CONSTANTS.STATUS_IN_PROGRESS
  | typeof ESCALATION_CONSTANTS.STATUS_RESOLVED
  | typeof ESCALATION_CONSTANTS.STATUS_BLOCKED
  | typeof ESCALATION_CONSTANTS.STATUS_ABORTED;

/**
 * Action type decided by the escalation ladder upon evaluating a failure.
 */
export type EscalationActionType =
  | typeof ESCALATION_CONSTANTS.ACTION_RETRY_CURRENT_RUNG
  | typeof ESCALATION_CONSTANTS.ACTION_ADVANCE_RUNG
  | typeof ESCALATION_CONSTANTS.ACTION_RESOLVE
  | typeof ESCALATION_CONSTANTS.ACTION_BLOCK_TASK;

/**
 * Static metadata definition for an escalation ladder rung.
 */
export interface RungDefinition {
  readonly rung: EscalationRung;
  readonly name: EscalationRungName;
  readonly title: string;
  readonly description: string;
  readonly targetRole: CognitiveRole;
  readonly workingTreePolicy: WorkingTreePolicy;
  readonly retainsWorkingTreeDirty: boolean;
  readonly requiresAtomicRollback: boolean;
  readonly maxAttempts: number;
  readonly fsmEvent: LooperEvent;
  readonly fsmExhaustedEvent: LooperEvent;
  readonly guidancePrompt: string;
}

/**
 * Structured failure report passed to the escalation ladder for remediation.
 */
export interface FailureReport {
  readonly taskId: string;
  readonly errorType?: string;
  readonly failureTrace?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly failingGate?: "gate_0" | "gate_1" | "gate_2" | "gate_3" | "timeout" | "runtime";
  readonly exitCode?: number;
  readonly timestamp?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Extracted compiler diagnostic item parsed from TypeScript/compiler logs (Task 1.3).
 */
export interface ExtractedCompilerDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly character?: number;
}

/**
 * Concrete audit invariants required when routing to forensic audit (Task 1.3).
 */
export interface AuditRequirements {
  readonly requiresBinaryVetoCheck: boolean;
  readonly requiresLayoutInspection: boolean;
  readonly requiresGitHygieneVerification: boolean;
  readonly requiresRollback: boolean;
  readonly isolatedShellProcess: boolean;
}

/**
 * Execution context provided when evaluating and routing failures (Task 1.3).
 */
export interface FailureRoutingContext {
  readonly taskId?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly currentRung?: EscalationRung;
  readonly reproScript?: string;
  readonly remediationPatch?: string;
  readonly baselineSha?: string;
  readonly customDirectives?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Structured result of classifying a failure report (Task 1.3).
 */
export interface FailureClassification {
  readonly category: FailureCategory;
  readonly severity: FailureSeverity;
  readonly confidence: number;
  readonly explanation: string;
  readonly matchedSignals: readonly string[];
  readonly rawTraceSnippet?: string;
  readonly suggestedRung: EscalationRung;
  readonly compilerDiagnostics?: readonly ExtractedCompilerDiagnostic[];
}

/**
 * Routing decision returned by the FailureClassifier directing recovery to retry, prompt enrichment, or forensic audit (Task 1.3).
 */
export interface FailureRoutingDecision {
  readonly target: FailureRoutingTarget;
  readonly classification: FailureClassification;
  readonly recommendedAction: string;
  readonly enrichedPrompt?: string;
  readonly suggestedFsmEvent: LooperEvent;
  readonly auditRequirements?: AuditRequirements;
  readonly retryContext?: Readonly<{
    attempt: number;
    maxAttempts: number;
    canRetryLocally: boolean;
  }>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Dynamic rule for customized failure classification and routing (Task 1.3).
 */
export interface FailureClassifierRule {
  readonly name: string;
  readonly predicate: (report: FailureReport, context?: FailureRoutingContext) => boolean;
  readonly target: FailureRoutingTarget;
  readonly category: FailureCategory;
  readonly severity: FailureSeverity;
  readonly explanation: string;
  readonly priority?: number;
}

/**
 * Options for configuring a FailureClassifier instance (Task 1.3).
 */
export interface FailureClassifierOptions {
  readonly maxRetryAttempts?: number;
  readonly customRules?: readonly FailureClassifierRule[];
  readonly autoEnrichPrompts?: boolean;
  readonly taskId?: string;
  readonly baselineSha?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Historical record of an action or transition within the escalation ladder.
 */
export interface EscalationHistoryEntry {
  readonly entryId: string;
  readonly rung: EscalationRung;
  readonly rungName: EscalationRungName;
  readonly attempt: number;
  readonly timestamp: string;
  readonly actionTaken: EscalationActionType;
  readonly workingTreePolicy: WorkingTreePolicy;
  readonly failureReport?: FailureReport;
  readonly failureRouting?: FailureRoutingDecision;
  readonly diagnosticArtifacts?: Readonly<{
    reproScript?: string;
    remediationPatch?: string;
    subtaskIds?: readonly string[];
    blockedReason?: string;
  }>;
  readonly notes?: string;
}

/**
 * Structured sub-task produced by Rung 5 compound task re-decomposition.
 */
export interface DecomposedSubtask {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly parentTaskId: string;
  readonly order: number;
}

/**
 * Remediation decision returned by the escalation ladder after evaluating an attempt or failure.
 */
export interface EscalationDecision {
  readonly rung: EscalationRung;
  readonly rungName: EscalationRungName;
  readonly targetRole: CognitiveRole;
  readonly action: EscalationActionType;
  readonly workingTreePolicy: WorkingTreePolicy;
  readonly shouldRollback: boolean;
  readonly rollbackCommand?: string;
  readonly fsmEvent: LooperEvent;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly promptEnrichment: string;
  readonly reproScript?: string;
  readonly remediationPatch?: string;
  readonly decomposedSubtasks?: readonly DecomposedSubtask[];
  readonly blockedReason?: string;
  readonly explanation: string;
  readonly routingTarget?: FailureRoutingTarget;
  readonly failureRouting?: FailureRoutingDecision;
}

/**
 * Configuration options for initializing a DynamicEscalationLadder.
 */
export interface EscalationLadderOptions {
  readonly taskId: string;
  readonly baselineSha: string;
  readonly initialRung?: EscalationRung;
  readonly maxLocalRetries?: number;
  readonly maxChallengerAttempts?: number;
  readonly maxExplorerAttempts?: number;
  readonly maxWorkerReplacementAttempts?: number;
  readonly maxRedecompositionAttempts?: number;
  readonly activeWorkerId?: string;
  readonly successionManager?: OrchestratorSuccessionManager;
  readonly failureClassifier?: FailureClassifier;
  readonly classifierOptions?: FailureClassifierOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Canonical trigger reasons for initiating an Orchestrator context succession.
 */
export type SuccessionTriggerReason =
  | typeof SUCCESSION_CONSTANTS.REASON_SPAWN_LIMIT
  | typeof SUCCESSION_CONSTANTS.REASON_TOKEN_WATERMARK
  | typeof SUCCESSION_CONSTANTS.REASON_MANUAL;

/**
 * Lifecycle status of an orchestrator succession manager.
 */
export type SuccessionStatus =
  | typeof SUCCESSION_CONSTANTS.STATUS_ACTIVE
  | typeof SUCCESSION_CONSTANTS.STATUS_PAUSED
  | typeof SUCCESSION_CONSTANTS.STATUS_HANDING_OVER
  | typeof SUCCESSION_CONSTANTS.STATUS_SUCCEEDED;

/**
 * Result of evaluating an orchestrator's progress against the 16-spawn boundary and token watermark.
 */
export interface SuccessionBoundaryEvaluation {
  readonly isSuccessionRequired: boolean;
  readonly isApproachingLimit: boolean;
  readonly reason?: SuccessionTriggerReason;
  readonly spawnCount: number;
  readonly maxSpawns: number;
  readonly tokenUtilizationPercent: number;
  readonly tokenWatermarkPercent: number;
  readonly remainingSpawns: number;
  readonly explanation: string;
}

/**
 * Configuration options for initializing an OrchestratorSuccessionManager.
 */
export interface OrchestratorSuccessionOptions {
  readonly currentOrchestratorId?: string;
  readonly initialGeneration?: number;
  readonly maxSpawns?: number;
  readonly tokenWatermarkPercent?: number;
  readonly warningSpawnOffset?: number;
  readonly warningTokenPercent?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Parameters for executing an orchestrator succession at a safe boundary.
 */
export interface SuccessionExecutionParams {
  readonly successorId?: string;
  readonly activeTasks?: readonly string[];
  readonly completedTasks?: readonly string[];
  readonly reason?: SuccessionTriggerReason;
  readonly customNotes?: string;
  readonly predecessorSnapshot?: AgentContextSnapshot;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Parameters for executing an emergency mid-execution orchestrator succession.
 */
export interface MidExecutionSuccessionParams {
  readonly activeWorkerId: string;
  readonly baselineSha: string;
  readonly stashedSha?: string;
  readonly successorId?: string;
  readonly activeTasks?: readonly string[];
  readonly completedTasks?: readonly string[];
  readonly reason?: SuccessionTriggerReason;
  readonly customNotes?: string;
  readonly predecessorSnapshot?: AgentContextSnapshot;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Result returned upon completing an orchestrator context succession handover.
 */
export interface SuccessionExecutionResult {
  readonly predecessorId: string;
  readonly successorId: string;
  readonly predecessorGeneration: number;
  readonly successorGeneration: number;
  readonly spawnCountAtHandover: number;
  readonly reason: SuccessionTriggerReason;
  readonly isMidExecution: boolean;
  readonly stashedSha?: string;
  readonly rollbackCommand?: string;
  readonly snapshot: SuccessionContextSnapshot;
  readonly fsmEvent: typeof LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE;
  readonly timestamp: string;
}

/**
 * Context for formatting contextual prompt enrichments for agents.
 */
export interface PromptEnrichmentContext {
  readonly taskId: string;
  readonly failureTrace?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly reproScript?: string;
  readonly remediationPatch?: string;
  readonly baselineSha?: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly blockedReason?: string;
}

/**
 * Plain serializable representation of an escalation ladder for snapshotting and persistence.
 */
export interface SerializedEscalationLadder {
  readonly taskId: string;
  readonly baselineSha: string;
  readonly currentRung: EscalationRung;
  readonly currentAttempt: number;
  readonly status: EscalationStatus;
  readonly activeWorkerId?: string;
  readonly challengerReproScript?: string;
  readonly explorerRemediationPatch?: string;
  readonly decomposedSubtasks: readonly DecomposedSubtask[];
  readonly blockedReason?: string;
  readonly history: readonly EscalationHistoryEntry[];
  readonly maxLocalRetries: number;
  readonly maxChallengerAttempts: number;
  readonly maxExplorerAttempts: number;
  readonly maxWorkerReplacementAttempts: number;
  readonly maxRedecompositionAttempts: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// -------------------------------------------------------------------------------------------------
// Error Classes
// -------------------------------------------------------------------------------------------------

/**
 * Base error class for all escalation ladder exceptions.
 */
export class EscalationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscalationError";
  }
}

/**
 * Thrown when an invalid transition between rungs is attempted.
 */
export class InvalidRungTransitionError extends EscalationError {
  readonly fromRung: EscalationRung;
  readonly toRung: EscalationRung;

  constructor(fromRung: EscalationRung, toRung: EscalationRung, reason?: string) {
    const detail = reason ? `: ${reason}` : "";
    super(`Invalid escalation rung transition from Rung ${fromRung} to Rung ${toRung}${detail}`);
    this.name = "InvalidRungTransitionError";
    this.fromRung = fromRung;
    this.toRung = toRung;
  }
}

/**
 * Thrown when an operation is attempted on an escalation ladder that has been marked BLOCKED.
 */
export class EscalationBlockedError extends EscalationError {
  readonly taskId: string;
  readonly reason: string;

  constructor(taskId: string, reason: string) {
    super(`Task "${taskId}" is BLOCKED at Escalation Rung 6: ${reason}`);
    this.name = "EscalationBlockedError";
    this.taskId = taskId;
    this.reason = reason;
  }
}

/**
 * Thrown when an escalation ladder is in an incompatible lifecycle state for the requested operation.
 */
export class InvalidEscalationStateError extends EscalationError {
  readonly currentState: EscalationStatus;

  constructor(currentState: EscalationStatus, operation: string) {
    super(`Cannot perform operation "${operation}" while escalation ladder is in state "${currentState}".`);
    this.name = "InvalidEscalationStateError";
    this.currentState = currentState;
  }
}

/**
 * Base error class for orchestrator succession failures.
 */
export class SuccessionError extends EscalationError {
  constructor(message: string) {
    super(message);
    this.name = "SuccessionError";
  }
}

/**
 * Thrown when operations violate the 16-spawn or token watermark boundary constraints.
 */
export class SuccessionBoundaryError extends SuccessionError {
  readonly spawnCount: number;
  readonly maxSpawns: number;

  constructor(message: string, spawnCount: number, maxSpawns: number) {
    super(message);
    this.name = "SuccessionBoundaryError";
    this.spawnCount = spawnCount;
    this.maxSpawns = maxSpawns;
  }
}

/**
 * Thrown when an invalid succession lifecycle transition is attempted.
 */
export class InvalidSuccessionStateError extends SuccessionError {
  readonly currentStatus: SuccessionStatus;

  constructor(message: string, currentStatus: SuccessionStatus) {
    super(message);
    this.name = "InvalidSuccessionStateError";
    this.currentStatus = currentStatus;
  }
}

// -------------------------------------------------------------------------------------------------
// Static 6-Rung Definitions Matrix
// -------------------------------------------------------------------------------------------------

export const ESCALATION_RUNG_DEFINITIONS: Readonly<Record<EscalationRung, RungDefinition>> = Object.freeze({
  [ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY]: Object.freeze({
    rung: ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY,
    name: ESCALATION_CONSTANTS.NAME_LOCAL_RETRY,
    title: "Local Mechanical Retry",
    description: "Inject stdout/stderr traces back to Worker (Attempts 1..2). Working tree retained dirty.",
    targetRole: COGNITIVE_ROLES.WORKER,
    workingTreePolicy: ESCALATION_CONSTANTS.WORKING_TREE_RETAIN_DIRTY,
    retainsWorkingTreeDirty: true,
    requiresAtomicRollback: false,
    maxAttempts: ESCALATION_CONSTANTS.MAX_LOCAL_RETRIES,
    fsmEvent: LOOPER_EVENTS.EVT_G0_RETRY,
    fsmExhaustedEvent: LOOPER_EVENTS.EVT_G0_EXHAUSTED,
    guidancePrompt: "Analyze the injected failure traces and apply surgical corrections without modifying unchanged files.",
  }),
  [ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC]: Object.freeze({
    rung: ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC,
    name: ESCALATION_CONSTANTS.NAME_CHALLENGER_DIAGNOSTIC,
    title: "Challenger Diagnostic",
    description: "Working tree retained dirty! Dispatch Challenger to synthesize minimal reproduction script demonstrating failure. Feed script to Worker.",
    targetRole: COGNITIVE_ROLES.CHALLENGER,
    workingTreePolicy: ESCALATION_CONSTANTS.WORKING_TREE_RETAIN_DIRTY,
    retainsWorkingTreeDirty: true,
    requiresAtomicRollback: false,
    maxAttempts: ESCALATION_CONSTANTS.MAX_CHALLENGER_ATTEMPTS,
    fsmEvent: LOOPER_EVENTS.EVT_DIAGNOSTIC_RETRY,
    fsmExhaustedEvent: LOOPER_EVENTS.EVT_G2_EXHAUSTED,
    guidancePrompt: "Synthesize a minimal, deterministic reproduction script highlighting the specific failure condition on the dirty tree.",
  }),
  [ESCALATION_CONSTANTS.RUNG_3_EXPLORER_DEEP_DIVE]: Object.freeze({
    rung: ESCALATION_CONSTANTS.RUNG_3_EXPLORER_DEEP_DIVE,
    name: ESCALATION_CONSTANTS.NAME_EXPLORER_DEEP_DIVE,
    title: "Explorer Deep Dive",
    description: "Working tree retained dirty! Worker suspended. Dispatch Explorer for read-only root-cause analysis across modules; generates remediation.patch.",
    targetRole: COGNITIVE_ROLES.EXPLORER,
    workingTreePolicy: ESCALATION_CONSTANTS.WORKING_TREE_RETAIN_DIRTY,
    retainsWorkingTreeDirty: true,
    requiresAtomicRollback: false,
    maxAttempts: ESCALATION_CONSTANTS.MAX_EXPLORER_ATTEMPTS,
    fsmEvent: LOOPER_EVENTS.EVT_ROLLBACK_REQUIRED,
    fsmExhaustedEvent: LOOPER_EVENTS.EVT_ROLLBACK_REQUIRED,
    guidancePrompt: "Conduct read-only cross-module root-cause analysis and generate a structured remediation.patch.",
  }),
  [ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT]: Object.freeze({
    rung: ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT,
    name: ESCALATION_CONSTANTS.NAME_WORKER_REPLACEMENT,
    title: "Clean Worker Replacement",
    description: "Atomic rollback executed now: git reset --hard ${baselineSha} && git clean -fd -e .agents/teamwork/ -e projects/. Kill stuck Worker. Spawn fresh Worker initialized with Explorer's remediation.patch.",
    targetRole: COGNITIVE_ROLES.WORKER,
    workingTreePolicy: ESCALATION_CONSTANTS.WORKING_TREE_ATOMIC_ROLLBACK,
    retainsWorkingTreeDirty: false,
    requiresAtomicRollback: true,
    maxAttempts: ESCALATION_CONSTANTS.MAX_WORKER_REPLACEMENT_ATTEMPTS,
    fsmEvent: LOOPER_EVENTS.EVT_ESCALATION_RESOLVED,
    fsmExhaustedEvent: LOOPER_EVENTS.EVT_REDECOMPOSE_REQUIRED,
    guidancePrompt: "Clean workspace restored to baseline SHA. Implement solution starting from Explorer's remediation.patch.",
  }),
  [ESCALATION_CONSTANTS.RUNG_5_TASK_REDECOMPOSITION]: Object.freeze({
    rung: ESCALATION_CONSTANTS.RUNG_5_TASK_REDECOMPOSITION,
    name: ESCALATION_CONSTANTS.NAME_TASK_REDECOMPOSITION,
    title: "Task Re-Decomposition",
    description: "Orchestrator marks task as compound; splits into 2-3 smaller sub-tasks in dependency DAG.",
    targetRole: COGNITIVE_ROLES.ORCHESTRATOR,
    workingTreePolicy: ESCALATION_CONSTANTS.WORKING_TREE_ATOMIC_ROLLBACK,
    retainsWorkingTreeDirty: false,
    requiresAtomicRollback: true,
    maxAttempts: ESCALATION_CONSTANTS.MAX_REDECOMPOSITION_ATTEMPTS,
    fsmEvent: LOOPER_EVENTS.EVT_REDECOMPOSE_REQUIRED,
    fsmExhaustedEvent: LOOPER_EVENTS.EVT_ESCALATION_FAILED,
    guidancePrompt: "Decompose this compound task into 2 to 3 discrete subtasks with explicit DAG dependencies.",
  }),
  [ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION]: Object.freeze({
    rung: ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION,
    name: ESCALATION_CONSTANTS.NAME_SENTINEL_ESCALATION,
    title: "Sentinel Human Escalation",
    description: "Sentinel Human Escalation: Mark task BLOCKED: <reason>; notify Sentinel; suspend task; proceed with independent DAG branches or await human input.",
    targetRole: COGNITIVE_ROLES.SENTINEL,
    workingTreePolicy: ESCALATION_CONSTANTS.WORKING_TREE_BLOCKED,
    retainsWorkingTreeDirty: false,
    requiresAtomicRollback: false,
    maxAttempts: ESCALATION_CONSTANTS.MAX_SENTINEL_ATTEMPTS,
    fsmEvent: LOOPER_EVENTS.EVT_ESCALATION_FAILED,
    fsmExhaustedEvent: LOOPER_EVENTS.EVT_ESCALATION_FATAL,
    guidancePrompt: "Task suspended and flagged as BLOCKED for human intervention. Independent DAG tasks may proceed.",
  }),
});

// -------------------------------------------------------------------------------------------------
// Helper Functions
// -------------------------------------------------------------------------------------------------

/**
 * Retrieves the static definition for a specified escalation rung.
 */
export function getEscalationRungDefinition(rung: EscalationRung): RungDefinition {
  const def = ESCALATION_RUNG_DEFINITIONS[rung];
  if (!def) {
    throw new EscalationError(`Invalid escalation rung: ${String(rung)}. Valid rungs are 1 through 6.`);
  }
  return def;
}

/**
 * Returns all 6 static escalation rung definitions in ascending order.
 */
export function getAllEscalationRungDefinitions(): ReadonlyArray<RungDefinition> {
  return [
    ESCALATION_RUNG_DEFINITIONS[ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY],
    ESCALATION_RUNG_DEFINITIONS[ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC],
    ESCALATION_RUNG_DEFINITIONS[ESCALATION_CONSTANTS.RUNG_3_EXPLORER_DEEP_DIVE],
    ESCALATION_RUNG_DEFINITIONS[ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT],
    ESCALATION_RUNG_DEFINITIONS[ESCALATION_CONSTANTS.RUNG_5_TASK_REDECOMPOSITION],
    ESCALATION_RUNG_DEFINITIONS[ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION],
  ];
}

/**
 * Determines whether a given escalation rung requires retaining the dirty working tree.
 * Rungs 1, 2, and 3 preserve dirty state for surgical repair and root-cause survey.
 */
export function isWorkingTreeRetainedDirty(rung: EscalationRung): boolean {
  return getEscalationRungDefinition(rung).retainsWorkingTreeDirty;
}

/**
 * Formulates the certified atomic rollback shell command restoring the repository to `baselineSha`
 * while strictly isolating and preserving `.agents/teamwork/` and `projects/`.
 */
export function buildRollbackCommand(baselineSha: string): string {
  if (!baselineSha || typeof baselineSha !== "string" || baselineSha.trim() === "") {
    throw new EscalationError("Cannot build rollback command: baselineSha must be a non-empty string.");
  }
  return `${ESCALATION_CONSTANTS.ROLLBACK_RESET_COMMAND} ${baselineSha.trim()} && ${ESCALATION_CONSTANTS.ROLLBACK_CLEAN_COMMAND}`;
}

/**
 * Formats a standardized Sentinel blocker string honoring the OpenSpec format (`BLOCKED: <reason>`).
 */
export function formatBlockedMarker(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === "" || trimmed.toLowerCase() === ESCALATION_CONSTANTS.BLOCKED_REASON_NONE) {
    throw new EscalationError("Cannot format blocked marker with empty or 'none' reason.");
  }
  return `${ESCALATION_CONSTANTS.BLOCKED_PREFIX}${trimmed}`;
}

/**
 * Parses a string to extract the `BLOCKED: <reason>` marker, returning undefined if absent or 'none'.
 */
export function parseBlockedMarker(text: string): string | undefined {
  if (!text || typeof text !== "string") {
    return undefined;
  }
  const match = text.match(/^\s*BLOCKED:\s*(.+)$/m);
  if (!match) {
    return undefined;
  }
  const reason = match[ESCALATION_CONSTANTS.REGEX_CAPTURE_GROUP_ONE]?.trim();
  if (!reason || reason.toLowerCase() === ESCALATION_CONSTANTS.BLOCKED_REASON_NONE) {
    return undefined;
  }
  return reason;
}

/**
 * Synthesizes a structured prompt enrichment block tailored to the specified escalation rung.
 */
export function buildRungPromptEnrichment(
  rung: EscalationRung,
  context: PromptEnrichmentContext
): string {
  const def = getEscalationRungDefinition(rung);
  const lines: string[] = [
    `## Escalation Rung ${def.rung}: ${def.title}`,
    `> **Role**: ${def.targetRole.toUpperCase()} | **Policy**: \`${def.workingTreePolicy}\` | **Attempt**: ${context.attempt}/${context.maxAttempts}`,
    "",
    def.description,
    "",
    `### Remediation Directives`,
    def.guidancePrompt,
  ];

  if (context.failureTrace !== undefined && context.failureTrace.trim() !== "") {
    lines.push("", "### Failure Diagnostic Trace", "```", context.failureTrace.trim(), "```");
  }

  if (context.stdout !== undefined && context.stdout.trim() !== "") {
    lines.push("", "### Stdout Output", "```", context.stdout.trim(), "```");
  }

  if (context.stderr !== undefined && context.stderr.trim() !== "") {
    lines.push("", "### Stderr Trace", "```", context.stderr.trim(), "```");
  }

  if (rung === ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC && context.reproScript !== undefined) {
    lines.push("", "### Minimal Reproduction Probe", "```typescript", context.reproScript.trim(), "```");
  }

  if (rung === ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT) {
    if (context.baselineSha !== undefined) {
      lines.push("", `Workspace has been atomically reset to clean baseline SHA: \`${context.baselineSha}\`.`);
    }
    if (context.remediationPatch !== undefined) {
      lines.push("", "### Explorer Remediation Patch Proposal", "```diff", context.remediationPatch.trim(), "```");
    }
  }

  if (rung === ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION && context.blockedReason !== undefined) {
    lines.push("", `### Sentinel Escalation Notice`, `Task is marked: ${formatBlockedMarker(context.blockedReason)}`);
  }

  return lines.join("\n");
}

// -------------------------------------------------------------------------------------------------
// Failure Classifier & Routing Pure Helpers (Task 1.3)
// -------------------------------------------------------------------------------------------------

/**
 * Extracts structured compiler diagnostic items from TypeScript or compiler failure traces.
 */
export function extractCompilerDiagnostics(
  trace: string
): ReadonlyArray<ExtractedCompilerDiagnostic> {
  if (!trace || typeof trace !== "string") {
    return [];
  }
  const regex =
    /(?:([a-zA-Z0-9_\-./\\]+)(?::|\()(\d+)(?::|,)(\d+)\)?)?\s*[-:]?\s*(?:error\s+)?(TS\d{4,5}):\s*([^\n\r]+)/g;
  const diagnostics: ExtractedCompilerDiagnostic[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trace)) !== null) {
    const file = match[FAILURE_CLASSIFIER_CONSTANTS.ONE];
    const line = match[2]
      ? parseInt(match[2], FAILURE_CLASSIFIER_CONSTANTS.PARSE_INT_RADIX)
      : undefined;
    const character = match[3]
      ? parseInt(match[3], FAILURE_CLASSIFIER_CONSTANTS.PARSE_INT_RADIX)
      : undefined;
    const code = match[4] ?? "";
    const message = match[5]?.trim() ?? "";
    diagnostics.push({
      code,
      message,
      file,
      line,
      character,
    });
  }
  return Object.freeze(diagnostics);
}

/**
 * Classifies an incoming task failure into the standardized looper failure taxonomy.
 */
export function classifyFailure(
  failureInput: FailureReport | string,
  options?: FailureClassifierOptions,
  context?: FailureRoutingContext
): FailureClassification {
  const failure: FailureReport =
    typeof failureInput === "string"
      ? {
          taskId: context?.taskId ?? options?.taskId ?? "TASK-UNKNOWN",
          failureTrace: failureInput,
          timestamp: new Date().toISOString(),
        }
      : {
          ...failureInput,
          taskId: failureInput.taskId || context?.taskId || options?.taskId || "TASK-UNKNOWN",
          timestamp: failureInput.timestamp ?? new Date().toISOString(),
        };

  const fullText = [
    failure.errorType,
    failure.failureTrace,
    failure.stdout,
    failure.stderr,
  ]
    .filter(Boolean)
    .join("\n");

  const traceSnippet =
    failure.failureTrace?.slice(
      FAILURE_CLASSIFIER_CONSTANTS.ZERO,
      FAILURE_CLASSIFIER_CONSTANTS.RAW_SNIPPET_MAX_LENGTH
    ) ||
    fullText.slice(
      FAILURE_CLASSIFIER_CONSTANTS.ZERO,
      FAILURE_CLASSIFIER_CONSTANTS.RAW_SNIPPET_MAX_LENGTH
    );

  // 1. Evaluate custom rules if configured
  if (options?.customRules && options.customRules.length > FAILURE_CLASSIFIER_CONSTANTS.ZERO) {
    const sortedRules = [...options.customRules].sort(
      (a, b) =>
        (b.priority ?? FAILURE_CLASSIFIER_CONSTANTS.PRIORITY_FALLBACK) -
        (a.priority ?? FAILURE_CLASSIFIER_CONSTANTS.PRIORITY_FALLBACK)
    );
    for (const rule of sortedRules) {
      if (rule.predicate(failure, context)) {
        return {
          category: rule.category,
          severity: rule.severity,
          confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
          explanation: rule.explanation,
          matchedSignals: [`custom_rule:${rule.name}`],
          rawTraceSnippet: traceSnippet,
          suggestedRung:
            rule.target === FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT
              ? ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT
              : rule.target === FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT
                ? ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC
                : ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY,
        };
      }
    }
  }

  // 2. Check gate-specific signals
  if (failure.failingGate === "gate_3") {
    return {
      category: FAILURE_CATEGORIES.BINARY_VETO,
      severity: FAILURE_SEVERITIES.CRITICAL,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Gate 3 Forensic Auditor issued binary veto on task changes.",
      matchedSignals: ["failingGate:gate_3"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT,
    };
  }

  if (failure.failingGate === "gate_1") {
    return {
      category: FAILURE_CATEGORIES.REVIEWER_REVISION,
      severity: FAILURE_SEVERITIES.MEDIUM,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Gate 1 Semantic Reviewer requested code revisions before proceeding.",
      matchedSignals: ["failingGate:gate_1"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC,
    };
  }

  if (failure.failingGate === "gate_2") {
    return {
      category: FAILURE_CATEGORIES.CHALLENGER_BREAK,
      severity: FAILURE_SEVERITIES.MEDIUM,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Gate 2 Adversarial Challenger synthesized breaking test probe.",
      matchedSignals: ["failingGate:gate_2"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC,
    };
  }

  if (failure.failingGate === "timeout") {
    return {
      category: FAILURE_CATEGORIES.PROCESS_TIMEOUT_HANG,
      severity: FAILURE_SEVERITIES.HIGH,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Subagent process execution timed out or hung.",
      matchedSignals: ["failingGate:timeout"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT,
    };
  }

  // 3. Priority 1: Forensic / Invariant / Layout / Security patterns
  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_LAYOUT_VIOLATION.test(fullText)) {
    return {
      category: FAILURE_CATEGORIES.LAYOUT_INVARIANT_VIOLATION,
      severity: FAILURE_SEVERITIES.HIGH,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation:
        "Layout invariant violation: files placed outside allowed directories or non-md files in .agents/teamwork/.",
      matchedSignals: ["regex:layout_violation"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT,
    };
  }

  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_BINARY_VETO.test(fullText)) {
    return {
      category: FAILURE_CATEGORIES.BINARY_VETO,
      severity: FAILURE_SEVERITIES.CRITICAL,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Binary veto invariant violation detected in failure trace.",
      matchedSignals: ["regex:binary_veto"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT,
    };
  }

  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_GIT_HYGIENE.test(fullText)) {
    return {
      category: FAILURE_CATEGORIES.GIT_HYGIENE_VIOLATION,
      severity: FAILURE_SEVERITIES.CRITICAL,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation:
        "Git hygiene violation: unstaged secret keys, credentials, or binary blobs detected.",
      matchedSignals: ["regex:git_hygiene"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT,
    };
  }

  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_PROTECTED_SECTION.test(fullText)) {
    return {
      category: FAILURE_CATEGORIES.PROTECTED_SECTION_TAMPERING,
      severity: FAILURE_SEVERITIES.CRITICAL,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Tampering with protected append-only 🔒 sections in BRIEFING.md or agent memory.",
      matchedSignals: ["regex:protected_section"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION,
    };
  }

  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_SECURITY_FATAL.test(fullText)) {
    const isCred = /secret|credential|token|auth/i.test(fullText);
    return {
      category: isCred
        ? FAILURE_CATEGORIES.SECURITY_CREDENTIAL_LEAK
        : FAILURE_CATEGORIES.FATAL_UNRECOVERABLE,
      severity: FAILURE_SEVERITIES.CRITICAL,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: isCred
        ? "Security or credential authentication failure detected."
        : "Fatal unrecoverable environment or git corruption detected.",
      matchedSignals: ["regex:security_fatal"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION,
    };
  }

  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_TIMEOUT_HANG.test(fullText)) {
    return {
      category: FAILURE_CATEGORIES.PROCESS_TIMEOUT_HANG,
      severity: FAILURE_SEVERITIES.HIGH,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Process timeout or execution hang detected in failure trace.",
      matchedSignals: ["regex:timeout_hang"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT,
    };
  }

  // 4. Priority 2: Contextual / Semantic / Prompt Enrichment patterns
  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_TYPE_ERROR.test(fullText)) {
    const compilerDiagnostics = extractCompilerDiagnostics(fullText);
    return {
      category: FAILURE_CATEGORIES.TYPE_CHECK_COMPILER,
      severity: FAILURE_SEVERITIES.MEDIUM,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: `TypeScript compiler / type errors detected (${compilerDiagnostics.length} diagnostics extracted).`,
      matchedSignals: ["regex:type_error"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC,
      compilerDiagnostics,
    };
  }

  if (
    FAILURE_CLASSIFIER_CONSTANTS.REGEX_SYNTAX_ERROR.test(fullText) ||
    FAILURE_CLASSIFIER_CONSTANTS.REGEX_LINTER_ERROR.test(fullText)
  ) {
    return {
      category: FAILURE_CATEGORIES.TYPE_CHECK_COMPILER,
      severity: FAILURE_SEVERITIES.LOW,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_MEDIUM,
      explanation: "Syntax or linter formatting error detected in output.",
      matchedSignals: ["regex:syntax_or_lint"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY,
    };
  }

  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_REVIEWER_REVISION.test(fullText)) {
    return {
      category: FAILURE_CATEGORIES.REVIEWER_REVISION,
      severity: FAILURE_SEVERITIES.MEDIUM,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_MEDIUM,
      explanation: "Reviewer requested revisions or noted specification fidelity gaps.",
      matchedSignals: ["regex:reviewer_revision"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC,
    };
  }

  if (FAILURE_CLASSIFIER_CONSTANTS.REGEX_CHALLENGER_BREAK.test(fullText)) {
    return {
      category: FAILURE_CATEGORIES.CHALLENGER_BREAK,
      severity: FAILURE_SEVERITIES.MEDIUM,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_MEDIUM,
      explanation: "Adversarial challenger test probe or edge case breakage detected.",
      matchedSignals: ["regex:challenger_break"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC,
    };
  }

  // Check attempt exhaustion
  const attempt = context?.attempt ?? FAILURE_CLASSIFIER_CONSTANTS.INITIAL_ATTEMPT;
  const maxAttempts =
    context?.maxAttempts ??
    options?.maxRetryAttempts ??
    FAILURE_CLASSIFIER_CONSTANTS.DEFAULT_MAX_RETRY_ATTEMPTS;

  if (attempt >= maxAttempts) {
    return {
      category: FAILURE_CATEGORIES.EXHAUSTED_LOCAL_RETRY,
      severity: FAILURE_SEVERITIES.MEDIUM,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: `Local mechanical retry attempts exhausted (${attempt}/${maxAttempts}). Advancing to contextual prompt enrichment.`,
      matchedSignals: ["attempt_exhausted"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC,
    };
  }

  // 5. Priority 3: Mechanical / Assertion failure
  if (
    FAILURE_CLASSIFIER_CONSTANTS.REGEX_TRANSIENT_ASSERTION.test(fullText) ||
    (failure.exitCode !== undefined && failure.exitCode !== FAILURE_CLASSIFIER_CONSTANTS.ZERO)
  ) {
    return {
      category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
      severity: FAILURE_SEVERITIES.LOW,
      confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_HIGH,
      explanation: "Unit test assertion failure or mechanical non-zero exit code detected.",
      matchedSignals: ["regex:assertion_or_exitcode"],
      rawTraceSnippet: traceSnippet,
      suggestedRung: ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY,
    };
  }

  // 6. Fallback
  return {
    category: FAILURE_CATEGORIES.TRANSIENT_MECHANICAL,
    severity: FAILURE_SEVERITIES.LOW,
    confidence: FAILURE_CLASSIFIER_CONSTANTS.CONFIDENCE_FALLBACK,
    explanation: "Generic unclassified mechanical failure; eligible for local retry.",
    matchedSignals: ["fallback"],
    rawTraceSnippet: traceSnippet,
    suggestedRung: ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY,
  };
}

/**
 * Builds structured prompt enrichment tailored to the failure classification and target.
 */
export function buildFailureEnrichedPrompt(
  decision: {
    target: FailureRoutingTarget;
    classification: FailureClassification;
    recommendedAction: string;
    suggestedFsmEvent: LooperEvent;
    auditRequirements?: AuditRequirements;
    retryContext?: { attempt: number; maxAttempts: number; canRetryLocally: boolean };
  },
  context?: FailureRoutingContext,
  failureReport?: FailureReport
): string {
  const { target, classification } = decision;
  const lines: string[] = [];

  if (target === FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT) {
    lines.push(
      `## 🚨 Gate 3 Forensic Audit Directive: Binary Veto & Invariant Enforcement`,
      `> **Category**: \`${classification.category}\` | **Severity**: \`${classification.severity.toUpperCase()}\` | **Confidence**: ${Math.round(classification.confidence * FAILURE_CLASSIFIER_CONSTANTS.PERCENTAGE_MULTIPLIER)}%`,
      "",
      `### Invariant Breach Summary`,
      classification.explanation,
      "",
      "### Audit Mandate & Verification Invariants",
      "- **Layout Invariant**: Ensure `.agents/teamwork/` contains exclusively metadata (`.md` files) and zero application source code or tests.",
      "- **Git Hygiene**: Verify no unstaged secret keys, credentials, temporary `.tmp` files, or binary artifacts exist.",
      "- **Atomic Rollback**: Restore repository cleanly to baseline commit SHA.",
      "- **Binary Decision**: If any invariant is violated, the Forensic Auditor exercises absolute binary veto."
    );
  } else if (target === FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT) {
    lines.push(
      `## 🔍 Remediation Prompt Enrichment: ${classification.category.replace(/_/g, " ").toUpperCase()}`,
      `> **Target**: \`${target}\` | **Severity**: \`${classification.severity}\` | **Event**: \`${decision.suggestedFsmEvent}\``,
      "",
      `### Diagnostic Overview`,
      classification.explanation
    );

    if (
      classification.compilerDiagnostics &&
      classification.compilerDiagnostics.length > FAILURE_CLASSIFIER_CONSTANTS.ZERO
    ) {
      lines.push("", "### Extracted Compiler & Type Diagnostics");
      for (const diag of classification.compilerDiagnostics) {
        const loc = diag.file
          ? `\`${diag.file}${diag.line !== undefined ? `:${diag.line}` : ""}\` `
          : "";
        lines.push(`- ${loc}[${diag.code}]: ${diag.message}`);
      }
      lines.push(
        "",
        "### Compiler Remediation Directives",
        "Resolve the extracted TypeScript compiler errors ensuring strict typing and zero any casts."
      );
    }

    if (context?.reproScript) {
      lines.push(
        "",
        "### Adversarial Challenger Reproduction Probe",
        "```typescript",
        context.reproScript.trim(),
        "```",
        "",
        "Remediation Directive: Update implementation to satisfy this reproduction test probe."
      );
    }

    if (context?.remediationPatch) {
      lines.push(
        "",
        "### Explorer Remediation Patch Proposal",
        "```diff",
        context.remediationPatch.trim(),
        "```",
        "",
        "Remediation Directive: Inspect and apply the Explorer's synthesized patch proposal."
      );
    }
  } else {
    // Retry
    const attempt =
      decision.retryContext?.attempt ?? FAILURE_CLASSIFIER_CONSTANTS.INITIAL_ATTEMPT;
    const max =
      decision.retryContext?.maxAttempts ??
      FAILURE_CLASSIFIER_CONSTANTS.DEFAULT_MAX_RETRY_ATTEMPTS;
    lines.push(
      `## 🔄 Local Mechanical Retry (Attempt ${attempt}/${max})`,
      `> **Target**: \`${target}\` | **Policy**: \`retain_dirty\` | **Event**: \`${decision.suggestedFsmEvent}\``,
      "",
      "Working tree retained dirty for surgical in-place correction.",
      classification.explanation
    );
  }

  // Append failure traces if available
  const trace =
    failureReport?.failureTrace ??
    (failureReport?.stderr || failureReport?.stdout);
  if (trace && trace.trim()) {
    lines.push("", "### Captured Failure Trace", "```", trace.trim(), "```");
  }

  return lines.join("\n");
}

/**
 * Pure evaluation function routing a failure to retry, prompt enrichment, or forensic audit.
 */
export function routeFailure(
  failureInput: FailureReport | string,
  options?: FailureClassifierOptions,
  context?: FailureRoutingContext
): FailureRoutingDecision {
  const classification = classifyFailure(failureInput, options, context);
  const failure: FailureReport =
    typeof failureInput === "string"
      ? {
          taskId: context?.taskId ?? options?.taskId ?? "TASK-UNKNOWN",
          failureTrace: failureInput,
        }
      : failureInput;

  const attempt = context?.attempt ?? FAILURE_CLASSIFIER_CONSTANTS.INITIAL_ATTEMPT;
  const maxAttempts =
    context?.maxAttempts ??
    options?.maxRetryAttempts ??
    FAILURE_CLASSIFIER_CONSTANTS.DEFAULT_MAX_RETRY_ATTEMPTS;

  // Determine Target: forensic_audit, prompt_enrichment, or retry
  let target: FailureRoutingTarget;

  switch (classification.category) {
    case FAILURE_CATEGORIES.LAYOUT_INVARIANT_VIOLATION:
    case FAILURE_CATEGORIES.GIT_HYGIENE_VIOLATION:
    case FAILURE_CATEGORIES.PROTECTED_SECTION_TAMPERING:
    case FAILURE_CATEGORIES.BINARY_VETO:
    case FAILURE_CATEGORIES.PROCESS_TIMEOUT_HANG:
    case FAILURE_CATEGORIES.SECURITY_CREDENTIAL_LEAK:
    case FAILURE_CATEGORIES.FATAL_UNRECOVERABLE:
      target = FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT;
      break;

    case FAILURE_CATEGORIES.TYPE_CHECK_COMPILER:
    case FAILURE_CATEGORIES.SEMANTIC_LOGIC:
    case FAILURE_CATEGORIES.REVIEWER_REVISION:
    case FAILURE_CATEGORIES.CHALLENGER_BREAK:
    case FAILURE_CATEGORIES.EXHAUSTED_LOCAL_RETRY:
      target = FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT;
      break;

    case FAILURE_CATEGORIES.TRANSIENT_MECHANICAL:
    case FAILURE_CATEGORIES.TRANSIENT_NETWORK:
    case FAILURE_CATEGORIES.ASSERTION_FAILURE:
    default:
      if (
        attempt >= maxAttempts ||
        Boolean(context?.reproScript) ||
        Boolean(context?.remediationPatch)
      ) {
        target = FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT;
      } else {
        target = FAILURE_ROUTING_TARGETS.RETRY;
      }
      break;
  }

  // Construct Audit Requirements if forensic_audit
  let auditRequirements: AuditRequirements | undefined;
  if (target === FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT) {
    auditRequirements = {
      requiresBinaryVetoCheck:
        classification.category === FAILURE_CATEGORIES.BINARY_VETO ||
        classification.category === FAILURE_CATEGORIES.LAYOUT_INVARIANT_VIOLATION ||
        classification.category === FAILURE_CATEGORIES.GIT_HYGIENE_VIOLATION,
      requiresLayoutInspection:
        classification.category === FAILURE_CATEGORIES.LAYOUT_INVARIANT_VIOLATION,
      requiresGitHygieneVerification:
        classification.category === FAILURE_CATEGORIES.GIT_HYGIENE_VIOLATION ||
        classification.category === FAILURE_CATEGORIES.SECURITY_CREDENTIAL_LEAK,
      requiresRollback: true,
      isolatedShellProcess: true,
    };
  }

  // Construct Retry Context if retry
  let retryContext:
    | { attempt: number; maxAttempts: number; canRetryLocally: boolean }
    | undefined;
  if (target === FAILURE_ROUTING_TARGETS.RETRY) {
    retryContext = {
      attempt,
      maxAttempts,
      canRetryLocally: attempt < maxAttempts,
    };
  }

  // Determine suggested FSM Event
  let suggestedFsmEvent: LooperEvent;
  if (target === FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT) {
    if (
      classification.category === FAILURE_CATEGORIES.FATAL_UNRECOVERABLE ||
      classification.category === FAILURE_CATEGORIES.SECURITY_CREDENTIAL_LEAK
    ) {
      suggestedFsmEvent = LOOPER_EVENTS.EVT_ESCALATION_FATAL;
    } else if (classification.category === FAILURE_CATEGORIES.PROCESS_TIMEOUT_HANG) {
      suggestedFsmEvent = LOOPER_EVENTS.EVT_WORKER_TIMEOUT;
    } else {
      suggestedFsmEvent = LOOPER_EVENTS.EVT_G3_VETO;
    }
  } else if (target === FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT) {
    if (classification.category === FAILURE_CATEGORIES.REVIEWER_REVISION) {
      suggestedFsmEvent = LOOPER_EVENTS.EVT_G1_REVISE;
    } else if (classification.category === FAILURE_CATEGORIES.CHALLENGER_BREAK) {
      suggestedFsmEvent = LOOPER_EVENTS.EVT_G2_BREAK;
    } else if (classification.category === FAILURE_CATEGORIES.EXHAUSTED_LOCAL_RETRY) {
      suggestedFsmEvent = LOOPER_EVENTS.EVT_G0_EXHAUSTED;
    } else {
      suggestedFsmEvent = LOOPER_EVENTS.EVT_DIAGNOSTIC_RETRY;
    }
  } else {
    suggestedFsmEvent = LOOPER_EVENTS.EVT_G0_RETRY;
  }

  // Recommended action text
  let recommendedAction: string;
  if (target === FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT) {
    recommendedAction = `Trigger Gate 3 Forensic Auditor binary veto inspection (${classification.category}) with atomic rollback.`;
  } else if (target === FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT) {
    recommendedAction = `Synthesize structured prompt enrichment with ${classification.category} diagnostics and remediation guidance.`;
  } else {
    recommendedAction = `Dispatch immediate local retry (attempt ${attempt}/${maxAttempts}) preserving dirty working tree.`;
  }

  // Formulate enriched prompt
  const enrichedPrompt = buildFailureEnrichedPrompt(
    {
      target,
      classification,
      recommendedAction,
      suggestedFsmEvent,
      auditRequirements,
      retryContext,
    },
    context,
    failure
  );

  return {
    target,
    classification,
    recommendedAction,
    enrichedPrompt,
    suggestedFsmEvent,
    auditRequirements,
    retryContext,
    metadata: {
      timestamp: new Date().toISOString(),
      ...(options?.metadata ?? {}),
      ...(context?.metadata ?? {}),
    },
  };
}

/**
 * Checks whether a failure requires immediate Gate 3 forensic audit or invariant verification.
 */
export function isForensicAuditRequired(
  failureInput: FailureReport | string,
  options?: FailureClassifierOptions,
  context?: FailureRoutingContext
): boolean {
  return (
    routeFailure(failureInput, options, context).target ===
    FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT
  );
}

/**
 * Checks whether a failure requires contextual prompt enrichment before re-dispatching.
 */
export function isPromptEnrichmentRequired(
  failureInput: FailureReport | string,
  options?: FailureClassifierOptions,
  context?: FailureRoutingContext
): boolean {
  return (
    routeFailure(failureInput, options, context).target ===
    FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT
  );
}

/**
 * Checks whether a failure is eligible for direct local mechanical retry within current attempt budget.
 */
export function isRetryEligible(
  failureInput: FailureReport | string,
  options?: FailureClassifierOptions,
  context?: FailureRoutingContext
): boolean {
  return (
    routeFailure(failureInput, options, context).target ===
    FAILURE_ROUTING_TARGETS.RETRY
  );
}

// -------------------------------------------------------------------------------------------------
// Dynamic Escalation Ladder Class
// -------------------------------------------------------------------------------------------------

/**
 * Autonomous 6-Rung Dynamic Escalation Ladder.
 *
 * Coordinates progressive failure recovery for an individual task through 6 discrete rungs:
 * 1. Local Mechanical Retry (attempts 1..2, working tree dirty)
 * 2. Challenger Diagnostic (working tree dirty, repro script synthesized)
 * 3. Explorer Deep Dive (working tree dirty, worker suspended, remediation patch generated)
 * 4. Clean Worker Replacement (atomic rollback with git reset & clean, fresh worker with patch)
 * 5. Task Re-Decomposition (compound task split into 2-3 DAG sub-tasks)
 * 6. Sentinel Human Escalation (task marked BLOCKED, task suspended, human alerted)
 */
export class DynamicEscalationLadder extends EventEmitter {
  private readonly _taskId: string;
  private _baselineSha: string;
  private _currentRung: EscalationRung;
  private _currentAttempt: number;
  private _status: EscalationStatus;
  private _activeWorkerId?: string;
  private _challengerReproScript?: string;
  private _explorerRemediationPatch?: string;
  private _decomposedSubtasks: DecomposedSubtask[] = [];
  private _blockedReason?: string;
  private readonly _history: EscalationHistoryEntry[] = [];
  private readonly _metadata: Record<string, unknown>;
  private _successionManager?: OrchestratorSuccessionManager;
  private _failureClassifier: FailureClassifier;

  private readonly _maxLocalRetries: number;
  private readonly _maxChallengerAttempts: number;
  private readonly _maxExplorerAttempts: number;
  private readonly _maxWorkerReplacementAttempts: number;
  private readonly _maxRedecompositionAttempts: number;

  constructor(options: EscalationLadderOptions) {
    super();

    if (!options.taskId || typeof options.taskId !== "string" || options.taskId.trim() === "") {
      throw new EscalationError("Cannot initialize DynamicEscalationLadder: taskId must be a non-empty string.");
    }
    if (!options.baselineSha || typeof options.baselineSha !== "string" || options.baselineSha.trim() === "") {
      throw new EscalationError("Cannot initialize DynamicEscalationLadder: baselineSha must be a non-empty string.");
    }

    this._taskId = options.taskId.trim();
    this._baselineSha = options.baselineSha.trim();
    this._currentRung = options.initialRung ?? ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY;
    this._currentAttempt = ESCALATION_CONSTANTS.ZERO;
    this._status = ESCALATION_CONSTANTS.STATUS_IDLE;
    this._activeWorkerId = options.activeWorkerId;
    this._metadata = options.metadata ? { ...options.metadata } : {};
    this._successionManager = options.successionManager;
    this._failureClassifier =
      options.failureClassifier ??
      createFailureClassifier({
        taskId: this._taskId,
        baselineSha: this._baselineSha,
        ...(options.classifierOptions ?? {}),
      });

    this._maxLocalRetries = options.maxLocalRetries ?? ESCALATION_CONSTANTS.MAX_LOCAL_RETRIES;
    this._maxChallengerAttempts = options.maxChallengerAttempts ?? ESCALATION_CONSTANTS.MAX_CHALLENGER_ATTEMPTS;
    this._maxExplorerAttempts = options.maxExplorerAttempts ?? ESCALATION_CONSTANTS.MAX_EXPLORER_ATTEMPTS;
    this._maxWorkerReplacementAttempts =
      options.maxWorkerReplacementAttempts ?? ESCALATION_CONSTANTS.MAX_WORKER_REPLACEMENT_ATTEMPTS;
    this._maxRedecompositionAttempts =
      options.maxRedecompositionAttempts ?? ESCALATION_CONSTANTS.MAX_REDECOMPOSITION_ATTEMPTS;
  }

  // --- Getters & Classifier Accessors ---

  public get failureClassifier(): FailureClassifier {
    return this._failureClassifier;
  }

  public set failureClassifier(classifier: FailureClassifier) {
    this._failureClassifier = classifier;
  }

  public classifyFailure(failure: FailureReport | string): FailureClassification {
    return this._failureClassifier.classify(failure, {
      taskId: this._taskId,
      attempt: this._currentAttempt,
      maxAttempts: this.getMaxAttemptsForRung(this._currentRung),
      currentRung: this._currentRung,
    });
  }

  public routeFailure(failure: FailureReport | string): FailureRoutingDecision {
    return this._failureClassifier.route(failure, {
      taskId: this._taskId,
      attempt: this._currentAttempt,
      maxAttempts: this.getMaxAttemptsForRung(this._currentRung),
      currentRung: this._currentRung,
      reproScript: this._challengerReproScript,
      remediationPatch: this._explorerRemediationPatch,
      baselineSha: this._baselineSha,
    });
  }

  public handleFailureWithRouting(
    failureInput: FailureReport | string
  ): { decision: EscalationDecision; routing: FailureRoutingDecision } {
    const failure: FailureReport =
      typeof failureInput === "string"
        ? { taskId: this._taskId, failureTrace: failureInput }
        : failureInput;
    const routing = this.routeFailure(failure);
    const decision = this.handleFailure(failure);
    return { decision, routing };
  }

  // --- Getters ---

  public get successionManager(): OrchestratorSuccessionManager | undefined {
    return this._successionManager;
  }

  public set successionManager(manager: OrchestratorSuccessionManager | undefined) {
    this._successionManager = manager;
  }

  public get taskId(): string {
    return this._taskId;
  }

  public get baselineSha(): string {
    return this._baselineSha;
  }

  public get currentRung(): EscalationRung {
    return this._currentRung;
  }

  public get currentRungName(): EscalationRungName {
    return getEscalationRungDefinition(this._currentRung).name;
  }

  public get currentAttempt(): number {
    return this._currentAttempt;
  }

  public get status(): EscalationStatus {
    return this._status;
  }

  public get activeWorkerId(): string | undefined {
    return this._activeWorkerId;
  }

  public set activeWorkerId(workerId: string | undefined) {
    this._activeWorkerId = workerId;
  }

  public get challengerReproScript(): string | undefined {
    return this._challengerReproScript;
  }

  public get explorerRemediationPatch(): string | undefined {
    return this._explorerRemediationPatch;
  }

  public get decomposedSubtasks(): ReadonlyArray<DecomposedSubtask> {
    return [...this._decomposedSubtasks];
  }

  public get blockedReason(): string | undefined {
    return this._blockedReason;
  }

  public get history(): ReadonlyArray<EscalationHistoryEntry> {
    return [...this._history];
  }

  public get metadata(): Readonly<Record<string, unknown>> {
    return { ...this._metadata };
  }

  // --- Policy Inspection ---

  /**
   * Checks whether the working tree is preserved dirty at the current (or specified) rung.
   */
  public isWorkingTreeDirtyRetained(rung?: EscalationRung): boolean {
    const targetRung = rung ?? this._currentRung;
    return isWorkingTreeRetainedDirty(targetRung);
  }

  /**
   * Checks whether the current (or specified) rung requires atomic rollback.
   */
  public requiresRollback(rung?: EscalationRung): boolean {
    const targetRung = rung ?? this._currentRung;
    return getEscalationRungDefinition(targetRung).requiresAtomicRollback;
  }

  /**
   * Returns the atomic rollback command for the current baseline SHA.
   */
  public getRollbackCommand(): string {
    return buildRollbackCommand(this._baselineSha);
  }

  /**
   * Retrieves the static rung definition for the current (or specified) rung.
   */
  public getRungDefinition(rung?: EscalationRung): RungDefinition {
    return getEscalationRungDefinition(rung ?? this._currentRung);
  }

  /**
   * Gets the maximum permitted attempts configured for a specific rung.
   */
  public getMaxAttemptsForRung(rung: EscalationRung): number {
    switch (rung) {
      case ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY:
        return this._maxLocalRetries;
      case ESCALATION_CONSTANTS.RUNG_2_CHALLENGER_DIAGNOSTIC:
        return this._maxChallengerAttempts;
      case ESCALATION_CONSTANTS.RUNG_3_EXPLORER_DEEP_DIVE:
        return this._maxExplorerAttempts;
      case ESCALATION_CONSTANTS.RUNG_4_WORKER_REPLACEMENT:
        return this._maxWorkerReplacementAttempts;
      case ESCALATION_CONSTANTS.RUNG_5_TASK_REDECOMPOSITION:
        return this._maxRedecompositionAttempts;
      case ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION:
        return ESCALATION_CONSTANTS.MAX_SENTINEL_ATTEMPTS;
    }
  }

  // --- Diagnostic Artifact Handlers ---

  /**
   * Attaches a minimal reproduction probe synthesized by the Challenger (Rung 2).
   */
  public attachChallengerReproScript(script: string): void {
    if (!script || typeof script !== "string" || script.trim() === "") {
      throw new EscalationError("Cannot attach empty Challenger reproduction script.");
    }
    this._challengerReproScript = script.trim();
    this.emit("ladder:repro_attached", {
      taskId: this._taskId,
      rung: this._currentRung,
      reproScript: this._challengerReproScript,
    });
  }

  /**
   * Attaches a structured remediation patch proposal generated by the Explorer (Rung 3).
   */
  public attachExplorerRemediationPatch(patch: string): void {
    if (!patch || typeof patch !== "string" || patch.trim() === "") {
      throw new EscalationError("Cannot attach empty Explorer remediation patch.");
    }
    this._explorerRemediationPatch = patch.trim();
    this.emit("ladder:patch_attached", {
      taskId: this._taskId,
      rung: this._currentRung,
      remediationPatch: this._explorerRemediationPatch,
    });
  }

  /**
   * Decomposes a compound task into 2 to 3 smaller sub-tasks for Rung 5 re-decomposition.
   */
  public decomposeTask(subtaskTitles?: readonly string[]): ReadonlyArray<DecomposedSubtask> {
    if (this._currentRung !== ESCALATION_CONSTANTS.RUNG_5_TASK_REDECOMPOSITION) {
      throw new EscalationError(
        `Task re-decomposition is permitted strictly at Escalation Rung 5 (current rung: ${this._currentRung}).`
      );
    }

    let titles: readonly string[];
    if (subtaskTitles && subtaskTitles.length > ESCALATION_CONSTANTS.ZERO) {
      if (
        subtaskTitles.length < ESCALATION_CONSTANTS.MIN_DECOMPOSED_SUBTASKS ||
        subtaskTitles.length > ESCALATION_CONSTANTS.MAX_DECOMPOSED_SUBTASKS
      ) {
        throw new EscalationError(
          `Task re-decomposition requires between ${ESCALATION_CONSTANTS.MIN_DECOMPOSED_SUBTASKS} and ` +
            `${ESCALATION_CONSTANTS.MAX_DECOMPOSED_SUBTASKS} subtasks (received: ${subtaskTitles.length}).`
        );
      }
      titles = subtaskTitles;
    } else {
      titles = [
        `${this._taskId} - Phase 1: Core Implementation & Schema`,
        `${this._taskId} - Phase 2: Verification, Edge Cases & Integration`,
      ];
    }

    this._decomposedSubtasks = titles.map((title, index) => ({
      id: `${this._taskId}.${index + ESCALATION_CONSTANTS.INDEX_OFFSET_ONE}`,
      title: title.trim(),
      parentTaskId: this._taskId,
      order: index + ESCALATION_CONSTANTS.INDEX_OFFSET_ONE,
    }));

    this.emit("ladder:decomposed", {
      taskId: this._taskId,
      subtasks: [...this._decomposedSubtasks],
    });

    return [...this._decomposedSubtasks];
  }

  // --- Core Escalation Logic ---

  /**
   * Processes a task failure report through the dynamic 6-rung ladder, deciding whether
   * to retry locally within the current rung or advance to the next rung.
   */
  public handleFailure(failureInput: FailureReport | string): EscalationDecision {
    if (this._status === ESCALATION_CONSTANTS.STATUS_BLOCKED) {
      throw new EscalationBlockedError(
        this._taskId,
        this._blockedReason ?? ESCALATION_CONSTANTS.DEFAULT_BLOCKED_REASON
      );
    }

    if (this._status === ESCALATION_CONSTANTS.STATUS_RESOLVED) {
      throw new InvalidEscalationStateError(this._status, "handleFailure");
    }

    if (this._status === ESCALATION_CONSTANTS.STATUS_IDLE) {
      this._status = ESCALATION_CONSTANTS.STATUS_IN_PROGRESS;
    }

    // Normalize failure report
    const failure: FailureReport =
      typeof failureInput === "string"
        ? {
            taskId: this._taskId,
            failureTrace: failureInput,
            timestamp: new Date().toISOString(),
          }
        : {
            ...failureInput,
            taskId: this._taskId,
            timestamp: failureInput.timestamp ?? new Date().toISOString(),
          };

    const currentDef = getEscalationRungDefinition(this._currentRung);
    const maxAttempts = this.getMaxAttemptsForRung(this._currentRung);
    const routing = this.routeFailure(failure);

    // Check if we can retry within the current rung
    if (this._currentAttempt < maxAttempts) {
      this._currentAttempt += ESCALATION_CONSTANTS.INCREMENT_ONE;

      const enrichmentContext: PromptEnrichmentContext = {
        taskId: this._taskId,
        failureTrace: failure.failureTrace,
        stdout: failure.stdout,
        stderr: failure.stderr,
        reproScript: this._challengerReproScript,
        remediationPatch: this._explorerRemediationPatch,
        baselineSha: this._baselineSha,
        attempt: this._currentAttempt,
        maxAttempts,
      };

      const promptEnrichment = buildRungPromptEnrichment(this._currentRung, enrichmentContext);

      const decision: EscalationDecision = {
        rung: this._currentRung,
        rungName: currentDef.name,
        targetRole: currentDef.targetRole,
        action: ESCALATION_CONSTANTS.ACTION_RETRY_CURRENT_RUNG,
        workingTreePolicy: currentDef.workingTreePolicy,
        shouldRollback: currentDef.requiresAtomicRollback,
        rollbackCommand: currentDef.requiresAtomicRollback ? this.getRollbackCommand() : undefined,
        fsmEvent: currentDef.fsmEvent,
        attempt: this._currentAttempt,
        maxAttempts,
        promptEnrichment,
        reproScript: this._challengerReproScript,
        remediationPatch: this._explorerRemediationPatch,
        explanation: `Retrying at Rung ${this._currentRung} (${currentDef.title}), attempt ${this._currentAttempt} of ${maxAttempts}.`,
        routingTarget: routing.target,
        failureRouting: routing,
      };

      this._recordHistory(ESCALATION_CONSTANTS.ACTION_RETRY_CURRENT_RUNG, failure, undefined, routing);
      this.emit("ladder:retry", {
        taskId: this._taskId,
        rung: this._currentRung,
        attempt: this._currentAttempt,
        decision,
      });
      this.emit("ladder:routed", {
        taskId: this._taskId,
        rung: this._currentRung,
        routing,
        decision,
      });

      return decision;
    }

    // Current rung attempts exhausted; advance to next rung or block
    if (this._currentRung < ESCALATION_CONSTANTS.MAX_RUNG) {
      const nextRung = (this._currentRung + ESCALATION_CONSTANTS.INCREMENT_ONE) as EscalationRung;
      return this._performRungAdvance(
        nextRung,
        `Attempts exhausted at Rung ${this._currentRung} (${currentDef.title}) after ${this._currentAttempt} attempts.`,
        failure
      );
    }

    // Already at Rung 6; task is blocked
    return this.markBlocked(failure.failureTrace ?? ESCALATION_CONSTANTS.DEFAULT_BLOCKED_REASON, failure);
  }

  /**
   * Explicitly advances the ladder to a target rung (forward-only transitions).
   */
  public advanceToRung(
    targetRung: EscalationRung,
    reason: string,
    failureReport?: FailureReport
  ): EscalationDecision {
    if (this._status === ESCALATION_CONSTANTS.STATUS_BLOCKED) {
      throw new EscalationBlockedError(
        this._taskId,
        this._blockedReason ?? ESCALATION_CONSTANTS.DEFAULT_BLOCKED_REASON
      );
    }

    if (this._status === ESCALATION_CONSTANTS.STATUS_RESOLVED) {
      throw new InvalidEscalationStateError(this._status, "advanceToRung");
    }

    if (targetRung <= this._currentRung) {
      throw new InvalidRungTransitionError(
        this._currentRung,
        targetRung,
        `Escalation ladder can only advance forward (target ${targetRung} <= current ${this._currentRung}).`
      );
    }

    if (targetRung > ESCALATION_CONSTANTS.MAX_RUNG) {
      throw new InvalidRungTransitionError(
        this._currentRung,
        targetRung,
        `Target rung exceeds maximum ladder rung ${ESCALATION_CONSTANTS.MAX_RUNG}.`
      );
    }

    return this._performRungAdvance(targetRung, reason, failureReport);
  }

  /**
   * Immediately escalates the task to Rung 6 (Sentinel Human Escalation) and marks it BLOCKED.
   */
  public markBlocked(reason: string, failureReport?: FailureReport): EscalationDecision {
    const trimmedReason = reason.trim() || ESCALATION_CONSTANTS.DEFAULT_BLOCKED_REASON;
    const prevRung = this._currentRung;

    this._currentRung = ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION;
    this._currentAttempt = ESCALATION_CONSTANTS.INITIAL_ATTEMPT;
    this._status = ESCALATION_CONSTANTS.STATUS_BLOCKED;
    this._blockedReason = trimmedReason;

    const sentinelDef = getEscalationRungDefinition(ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION);
    const enrichment = buildRungPromptEnrichment(ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION, {
      taskId: this._taskId,
      failureTrace: failureReport?.failureTrace ?? trimmedReason,
      attempt: ESCALATION_CONSTANTS.INITIAL_ATTEMPT,
      maxAttempts: ESCALATION_CONSTANTS.MAX_SENTINEL_ATTEMPTS,
      blockedReason: trimmedReason,
    });
    const routing = failureReport ? this.routeFailure(failureReport) : undefined;

    const decision: EscalationDecision = {
      rung: ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION,
      rungName: sentinelDef.name,
      targetRole: sentinelDef.targetRole,
      action: ESCALATION_CONSTANTS.ACTION_BLOCK_TASK,
      workingTreePolicy: sentinelDef.workingTreePolicy,
      shouldRollback: false,
      fsmEvent: sentinelDef.fsmEvent,
      attempt: ESCALATION_CONSTANTS.INITIAL_ATTEMPT,
      maxAttempts: ESCALATION_CONSTANTS.MAX_SENTINEL_ATTEMPTS,
      promptEnrichment: enrichment,
      blockedReason: trimmedReason,
      explanation: `Task escalated to Rung 6 Sentinel: ${formatBlockedMarker(trimmedReason)}`,
      routingTarget: routing?.target ?? FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT,
      failureRouting: routing,
    };

    this._recordHistory(ESCALATION_CONSTANTS.ACTION_BLOCK_TASK, failureReport, trimmedReason, routing);

    this.emit("ladder:rung_transition", {
      taskId: this._taskId,
      fromRung: prevRung,
      toRung: ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION,
      reason: trimmedReason,
      decision,
    });

    this.emit("ladder:blocked", {
      taskId: this._taskId,
      reason: trimmedReason,
      marker: formatBlockedMarker(trimmedReason),
      decision,
    });

    return decision;
  }

  /**
   * Marks the task escalation as resolved successfully.
   */
  public resolve(notes?: string): void {
    if (this._status === ESCALATION_CONSTANTS.STATUS_BLOCKED) {
      throw new EscalationBlockedError(
        this._taskId,
        this._blockedReason ?? ESCALATION_CONSTANTS.DEFAULT_BLOCKED_REASON
      );
    }

    this._status = ESCALATION_CONSTANTS.STATUS_RESOLVED;
    this._recordHistory(ESCALATION_CONSTANTS.ACTION_RESOLVE, undefined, notes ?? "Task verified and resolved.");

    this.emit("ladder:resolved", {
      taskId: this._taskId,
      resolvedAtRung: this._currentRung,
      notes,
    });
  }

  /**
   * Resets the ladder back to Rung 1 for re-use or next task lifecycle.
   */
  public reset(newBaselineSha?: string): void {
    if (newBaselineSha !== undefined) {
      if (typeof newBaselineSha !== "string" || newBaselineSha.trim() === "") {
        throw new EscalationError("Cannot reset ladder: newBaselineSha must be a non-empty string.");
      }
      this._baselineSha = newBaselineSha.trim();
    }

    this._currentRung = ESCALATION_CONSTANTS.RUNG_1_LOCAL_RETRY;
    this._currentAttempt = ESCALATION_CONSTANTS.ZERO;
    this._status = ESCALATION_CONSTANTS.STATUS_IDLE;
    this._challengerReproScript = undefined;
    this._explorerRemediationPatch = undefined;
    this._decomposedSubtasks = [];
    this._blockedReason = undefined;

    this.emit("ladder:reset", {
      taskId: this._taskId,
      baselineSha: this._baselineSha,
    });
  }

  // --- Internal Transitions ---

  private _performRungAdvance(
    targetRung: EscalationRung,
    reason: string,
    failureReport?: FailureReport
  ): EscalationDecision {
    const fromRung = this._currentRung;
    this._currentRung = targetRung;
    this._currentAttempt = ESCALATION_CONSTANTS.INITIAL_ATTEMPT;

    if (targetRung === ESCALATION_CONSTANTS.RUNG_6_SENTINEL_ESCALATION) {
      return this.markBlocked(failureReport?.failureTrace ?? reason, failureReport);
    }

    const targetDef = getEscalationRungDefinition(targetRung);
    const maxAttempts = this.getMaxAttemptsForRung(targetRung);

    const enrichmentContext: PromptEnrichmentContext = {
      taskId: this._taskId,
      failureTrace: failureReport?.failureTrace,
      stdout: failureReport?.stdout,
      stderr: failureReport?.stderr,
      reproScript: this._challengerReproScript,
      remediationPatch: this._explorerRemediationPatch,
      baselineSha: this._baselineSha,
      attempt: this._currentAttempt,
      maxAttempts,
    };

    const promptEnrichment = buildRungPromptEnrichment(targetRung, enrichmentContext);
    const routing = failureReport ? this.routeFailure(failureReport) : undefined;

    const decision: EscalationDecision = {
      rung: targetRung,
      rungName: targetDef.name,
      targetRole: targetDef.targetRole,
      action: ESCALATION_CONSTANTS.ACTION_ADVANCE_RUNG,
      workingTreePolicy: targetDef.workingTreePolicy,
      shouldRollback: targetDef.requiresAtomicRollback,
      rollbackCommand: targetDef.requiresAtomicRollback ? this.getRollbackCommand() : undefined,
      fsmEvent: targetDef.fsmEvent,
      attempt: this._currentAttempt,
      maxAttempts,
      promptEnrichment,
      reproScript: this._challengerReproScript,
      remediationPatch: this._explorerRemediationPatch,
      explanation: `Advanced from Rung ${fromRung} to Rung ${targetRung} (${targetDef.title}): ${reason}`,
      routingTarget:
        routing?.target ??
        (targetDef.requiresAtomicRollback
          ? FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT
          : FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT),
      failureRouting: routing,
    };

    this._recordHistory(ESCALATION_CONSTANTS.ACTION_ADVANCE_RUNG, failureReport, reason, routing);

    if (targetDef.requiresAtomicRollback) {
      this.emit("ladder:rollback", {
        taskId: this._taskId,
        rung: targetRung,
        baselineSha: this._baselineSha,
        rollbackCommand: this.getRollbackCommand(),
      });
    }

    this.emit("ladder:rung_transition", {
      taskId: this._taskId,
      fromRung,
      toRung: targetRung,
      reason,
      decision,
    });

    return decision;
  }

  private _recordHistory(
    actionTaken: EscalationActionType,
    failureReport?: FailureReport,
    notes?: string,
    failureRouting?: FailureRoutingDecision
  ): void {
    const def = getEscalationRungDefinition(this._currentRung);
    const entry: EscalationHistoryEntry = {
      entryId: randomBytes(ESCALATION_CONSTANTS.HEX_BYTES_LENGTH).toString("hex"),
      rung: this._currentRung,
      rungName: def.name,
      attempt: this._currentAttempt,
      timestamp: new Date().toISOString(),
      actionTaken,
      workingTreePolicy: def.workingTreePolicy,
      failureReport,
      failureRouting,
      diagnosticArtifacts: {
        reproScript: this._challengerReproScript,
        remediationPatch: this._explorerRemediationPatch,
        subtaskIds: this._decomposedSubtasks.map((st) => st.id),
        blockedReason: this._blockedReason,
      },
      notes,
    };
    this._history.push(entry);
  }

  // --- Serialization ---

  /**
   * Serializes the ladder state into a plain object for context persistence.
   */
  public serialize(): SerializedEscalationLadder {
    return {
      taskId: this._taskId,
      baselineSha: this._baselineSha,
      currentRung: this._currentRung,
      currentAttempt: this._currentAttempt,
      status: this._status,
      activeWorkerId: this._activeWorkerId,
      challengerReproScript: this._challengerReproScript,
      explorerRemediationPatch: this._explorerRemediationPatch,
      decomposedSubtasks: [...this._decomposedSubtasks],
      blockedReason: this._blockedReason,
      history: [...this._history],
      maxLocalRetries: this._maxLocalRetries,
      maxChallengerAttempts: this._maxChallengerAttempts,
      maxExplorerAttempts: this._maxExplorerAttempts,
      maxWorkerReplacementAttempts: this._maxWorkerReplacementAttempts,
      maxRedecompositionAttempts: this._maxRedecompositionAttempts,
      metadata: { ...this._metadata },
    };
  }

  /**
   * Deserializes a saved state into a live DynamicEscalationLadder instance.
   */
  public static deserialize(data: SerializedEscalationLadder): DynamicEscalationLadder {
    const ladder = new DynamicEscalationLadder({
      taskId: data.taskId,
      baselineSha: data.baselineSha,
      initialRung: data.currentRung,
      maxLocalRetries: data.maxLocalRetries,
      maxChallengerAttempts: data.maxChallengerAttempts,
      maxExplorerAttempts: data.maxExplorerAttempts,
      maxWorkerReplacementAttempts: data.maxWorkerReplacementAttempts,
      maxRedecompositionAttempts: data.maxRedecompositionAttempts,
      activeWorkerId: data.activeWorkerId,
      metadata: data.metadata,
    });

    ladder._currentAttempt = data.currentAttempt;
    ladder._status = data.status;
    ladder._challengerReproScript = data.challengerReproScript;
    ladder._explorerRemediationPatch = data.explorerRemediationPatch;
    ladder._decomposedSubtasks = data.decomposedSubtasks ? [...data.decomposedSubtasks] : [];
    ladder._blockedReason = data.blockedReason;

    if (data.history && Array.isArray(data.history)) {
      ladder._history.push(...data.history);
    }

    return ladder;
  }
}

/**
 * Factory function to instantiate a new DynamicEscalationLadder.
 */
export function createDynamicEscalationLadder(
  options: EscalationLadderOptions
): DynamicEscalationLadder {
  return new DynamicEscalationLadder(options);
}

// -------------------------------------------------------------------------------------------------
// Orchestrator Context Succession Helpers & Engine (LOOPER-CORE-005 / Task 1.2)
// -------------------------------------------------------------------------------------------------

/**
 * Generates the deterministic successor Orchestrator ID given the current ID.
 * Examples:
 * - 'teamwork_preview_orchestrator_1' -> 'teamwork_preview_orchestrator_2'
 * - 'orchestrator_16' -> 'orchestrator_17'
 * - 'custom_orchestrator' -> 'custom_orchestrator_2'
 */
export function generateSuccessorOrchestratorId(currentId: string): string {
  const trimmed = currentId.trim();
  if (!trimmed) {
    return SUCCESSION_CONSTANTS.INITIAL_ORCHESTRATOR_ID;
  }
  const match = trimmed.match(/^(.*?)(\d+)$/);
  const prefix = match?.[SUCCESSION_CONSTANTS.REGEX_MATCH_PREFIX_GROUP];
  const digits = match?.[SUCCESSION_CONSTANTS.REGEX_MATCH_DIGITS_GROUP];
  if (prefix !== undefined && digits !== undefined) {
    const num = parseInt(digits, SUCCESSION_CONSTANTS.PARSE_INT_RADIX);
    const nextNum = num + SUCCESSION_CONSTANTS.INCREMENT_ONE;
    return `${prefix}${nextNum}`;
  }
  return `${trimmed}_${SUCCESSION_CONSTANTS.ORCHESTRATOR_ID_FALLBACK_INDEX}`;
}

/**
 * Parses the generation index from an Orchestrator ID.
 */
export function parseOrchestratorGeneration(orchestratorId: string): number {
  const trimmed = orchestratorId.trim();
  const match = trimmed.match(/(\d+)$/);
  const digits = match?.[SUCCESSION_CONSTANTS.ONE];
  if (digits !== undefined) {
    const parsed = parseInt(digits, SUCCESSION_CONSTANTS.PARSE_INT_RADIX);
    if (!Number.isNaN(parsed) && parsed > SUCCESSION_CONSTANTS.ZERO) {
      return parsed;
    }
  }
  return SUCCESSION_CONSTANTS.INITIAL_GENERATION;
}

/**
 * Pure evaluation function for orchestrator boundary thresholds.
 */
export function evaluateSuccessionBoundary(params: {
  spawnCount: number;
  maxSpawns?: number;
  tokenUtilizationPercent?: number;
  tokenWatermarkPercent?: number;
  warningSpawnOffset?: number;
  warningTokenPercent?: number;
}): SuccessionBoundaryEvaluation {
  const spawnCount = Math.max(SUCCESSION_CONSTANTS.ZERO, params.spawnCount);
  const maxSpawns = params.maxSpawns ?? SUCCESSION_CONSTANTS.DEFAULT_MAX_SPAWNS;
  const tokenUtilization = Math.max(
    SUCCESSION_CONSTANTS.MIN_PERCENT,
    Math.min(
      SUCCESSION_CONSTANTS.MAX_PERCENT,
      params.tokenUtilizationPercent ?? SUCCESSION_CONSTANTS.INITIAL_TOKEN_UTILIZATION
    )
  );
  const tokenWatermark =
    params.tokenWatermarkPercent ??
    SUCCESSION_CONSTANTS.DEFAULT_TOKEN_WATERMARK_PERCENT;
  const warningSpawnOffset =
    params.warningSpawnOffset ??
    SUCCESSION_CONSTANTS.DEFAULT_SPAWN_WARNING_OFFSET;
  const warningTokenPercent =
    params.warningTokenPercent ??
    SUCCESSION_CONSTANTS.DEFAULT_TOKEN_WARNING_PERCENT;

  const remainingSpawns = Math.max(
    SUCCESSION_CONSTANTS.ZERO,
    maxSpawns - spawnCount
  );
  const isSpawnLimitReached = spawnCount >= maxSpawns;
  const isTokenWatermarkReached = tokenUtilization >= tokenWatermark;
  const isSuccessionRequired = isSpawnLimitReached || isTokenWatermarkReached;

  let reason: SuccessionTriggerReason | undefined;
  if (isSpawnLimitReached) {
    reason = SUCCESSION_CONSTANTS.REASON_SPAWN_LIMIT;
  } else if (isTokenWatermarkReached) {
    reason = SUCCESSION_CONSTANTS.REASON_TOKEN_WATERMARK;
  }

  const isApproachingSpawnLimit =
    spawnCount >= maxSpawns - warningSpawnOffset && spawnCount < maxSpawns;
  const isApproachingTokenLimit =
    tokenUtilization >= warningTokenPercent && tokenUtilization < tokenWatermark;
  const isApproachingLimit =
    !isSuccessionRequired && (isApproachingSpawnLimit || isApproachingTokenLimit);

  let explanation: string;
  if (isSpawnLimitReached) {
    explanation = `Spawn limit reached (${spawnCount}/${maxSpawns} spawns). Orchestrator succession required.`;
  } else if (isTokenWatermarkReached) {
    explanation = `Token watermark threshold reached (${tokenUtilization}% >= ${tokenWatermark}%). Orchestrator succession required.`;
  } else if (isApproachingLimit) {
    explanation = `Approaching succession boundary (${spawnCount}/${maxSpawns} spawns, ${tokenUtilization}% tokens). Prepare for orchestrator rollover.`;
  } else {
    explanation = `Operating within safe limits (${spawnCount}/${maxSpawns} spawns, ${tokenUtilization}% tokens, ${remainingSpawns} remaining spawns).`;
  }

  return {
    isSuccessionRequired,
    isApproachingLimit,
    reason,
    spawnCount,
    maxSpawns,
    tokenUtilizationPercent: tokenUtilization,
    tokenWatermarkPercent: tokenWatermark,
    remainingSpawns,
    explanation,
  };
}

/**
 * Formulates the successor Orchestrator's initial BRIEFING.md content preserving the append-only 🔒 sections.
 */
export function buildSuccessionBriefing(params: {
  orchestratorId: string;
  generation: number;
  predecessorId?: string;
  handoffReportPath?: string;
  maxSpawns?: number;
  activeTasks?: readonly string[];
  completedTasks?: readonly string[];
}): string {
  const maxSpawns = params.maxSpawns ?? SUCCESSION_CONSTANTS.DEFAULT_MAX_SPAWNS;
  const predecessor = params.predecessorId ?? "(None - Initial Generation)";
  const handoffPath =
    params.handoffReportPath ?? SUCCESSION_CONSTANTS.HANDOFF_FILENAME;
  const activeCount = params.activeTasks?.length ?? SUCCESSION_CONSTANTS.ZERO;
  const completedCount =
    params.completedTasks?.length ?? SUCCESSION_CONSTANTS.ZERO;

  return [
    `# BRIEFING: Orchestrator Context Succession (Generation ${params.generation})`,
    "",
    "## 🔒 My Identity",
    `- **Agent ID**: \`${params.orchestratorId}\``,
    "- **Role**: Orchestrator",
    `- **Generation**: ${params.generation}`,
    `- **Predecessor**: \`${predecessor}\``,
    `- **Created**: ${new Date().toISOString()}`,
    "",
    "## 🔒 Key Constraints",
    `- **Spawn Limit**: ${maxSpawns} subagent dispatches per orchestrator lifetime.`,
    `- **16-Spawn Rule**: Automatic context succession triggered at ${maxSpawns} spawns or 80% token watermark.`,
    "- **Append-Only Contract**: Protected 🔒 sections must never be deleted or modified.",
    "- **Zero Dirty Repository History**: Unverified changes must never pollute the git working tree.",
    "- **Deterministic Oracle**: Verification gates (Gates 0-3) are the sole determinant of completion.",
    "",
    "## Orchestration State & Succession Telemetry",
    `- **Spawn Counter**: 0 / ${maxSpawns} (Reset for new generation)`,
    `- **Predecessor Soft Handoff**: \`${handoffPath}\``,
    `- **Active Tasks**: ${activeCount}`,
    `- **Completed Tasks**: ${completedCount}`,
    "- **Status**: ACTIVE",
    "",
    "## Protocol Instructions",
    "Read the predecessor handoff report to assimilate current DAG topological progress,",
    "verify the git working tree against baseline commit SHA, and resume execution cleanly.",
  ].join("\n");
}

/**
 * Autonomous Orchestrator Context Succession Engine.
 *
 * Enforces the 16-Spawn Succession Boundary and Token Watermark Invariant defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 5.3 and OpenSpec change Task 1.2.
 *
 * Responsibilities:
 * 1. Tracks subagent spawn counts per Orchestrator lifecycle (up to 16 spawns).
 * 2. Monitors token window utilization (triggers at 80% watermark).
 * 3. Pauses active dispatches at the succession boundary and emits telemetry events.
 * 4. Executes clean Orchestrator handover at safe task boundaries (`STATE_PLAN_DECOMPOSE`, `STATE_COMMIT_CHECKPOINT`).
 * 5. Supports Mid-Execution Succession Protection with uncommitted git diff stashing and atomic rollback isolation.
 * 6. Generates succession context snapshots and soft handoff reports.
 * 7. Initializes successor Orchestrator state with reset spawn counter and incremented generation.
 */
export class OrchestratorSuccessionManager extends EventEmitter {
  private _currentOrchestratorId: string;
  private _generation: number;
  private _spawnCount: number;
  private _maxSpawns: number;
  private _tokenUtilizationPercent: number;
  private _tokenWatermarkPercent: number;
  private _warningSpawnOffset: number;
  private _warningTokenPercent: number;
  private _status: SuccessionStatus;
  private _isDispatchesPaused: boolean;
  private readonly _history: SuccessionExecutionResult[];
  private readonly _metadata: Record<string, unknown>;

  constructor(options?: OrchestratorSuccessionOptions) {
    super();

    this._currentOrchestratorId =
      options?.currentOrchestratorId?.trim() ||
      SUCCESSION_CONSTANTS.INITIAL_ORCHESTRATOR_ID;
    this._generation =
      options?.initialGeneration ??
      parseOrchestratorGeneration(this._currentOrchestratorId);
    this._spawnCount = SUCCESSION_CONSTANTS.INITIAL_SPAWN_COUNT;
    this._maxSpawns =
      options?.maxSpawns ?? SUCCESSION_CONSTANTS.DEFAULT_MAX_SPAWNS;
    this._tokenUtilizationPercent =
      SUCCESSION_CONSTANTS.INITIAL_TOKEN_UTILIZATION;
    this._tokenWatermarkPercent =
      options?.tokenWatermarkPercent ??
      SUCCESSION_CONSTANTS.DEFAULT_TOKEN_WATERMARK_PERCENT;
    this._warningSpawnOffset =
      options?.warningSpawnOffset ??
      SUCCESSION_CONSTANTS.DEFAULT_SPAWN_WARNING_OFFSET;
    this._warningTokenPercent =
      options?.warningTokenPercent ??
      SUCCESSION_CONSTANTS.DEFAULT_TOKEN_WARNING_PERCENT;
    this._status = SUCCESSION_CONSTANTS.STATUS_ACTIVE;
    this._isDispatchesPaused = false;
    this._history = [];
    this._metadata = options?.metadata ? { ...options.metadata } : {};
  }

  // --- Getters ---

  public get currentOrchestratorId(): string {
    return this._currentOrchestratorId;
  }

  public get generation(): number {
    return this._generation;
  }

  public get spawnCount(): number {
    return this._spawnCount;
  }

  public get maxSpawns(): number {
    return this._maxSpawns;
  }

  public get tokenUtilizationPercent(): number {
    return this._tokenUtilizationPercent;
  }

  public get tokenWatermarkPercent(): number {
    return this._tokenWatermarkPercent;
  }

  public get warningSpawnOffset(): number {
    return this._warningSpawnOffset;
  }

  public get warningTokenPercent(): number {
    return this._warningTokenPercent;
  }

  public get status(): SuccessionStatus {
    return this._status;
  }

  public get isDispatchesPaused(): boolean {
    return this._isDispatchesPaused;
  }

  public get history(): ReadonlyArray<SuccessionExecutionResult> {
    return Object.freeze([...this._history]);
  }

  public get metadata(): Readonly<Record<string, unknown>> {
    return Object.freeze({ ...this._metadata });
  }

  // --- Telemetry & Evaluation ---

  public checkBoundaryEvaluation(): SuccessionBoundaryEvaluation {
    return evaluateSuccessionBoundary({
      spawnCount: this._spawnCount,
      maxSpawns: this._maxSpawns,
      tokenUtilizationPercent: this._tokenUtilizationPercent,
      tokenWatermarkPercent: this._tokenWatermarkPercent,
      warningSpawnOffset: this._warningSpawnOffset,
      warningTokenPercent: this._warningTokenPercent,
    });
  }

  public isSuccessionRequired(): boolean {
    return (
      this._spawnCount >= this._maxSpawns ||
      this._tokenUtilizationPercent >= this._tokenWatermarkPercent
    );
  }

  public isApproachingLimit(): boolean {
    const evaluation = this.checkBoundaryEvaluation();
    return evaluation.isApproachingLimit;
  }

  // --- Spawn & Token Tracking ---

  public recordSpawn(): number {
    this._spawnCount += SUCCESSION_CONSTANTS.SPAWN_INCREMENT;
    const evaluation = this.checkBoundaryEvaluation();

    if (evaluation.isSuccessionRequired) {
      this._isDispatchesPaused = true;
      this._status = SUCCESSION_CONSTANTS.STATUS_PAUSED;
      this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_LIMIT_REACHED, {
        spawnCount: this._spawnCount,
        maxSpawns: this._maxSpawns,
        orchestratorId: this._currentOrchestratorId,
        reason: evaluation.reason,
      });
      this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_PAUSED, {
        reason: evaluation.reason,
        spawnCount: this._spawnCount,
        orchestratorId: this._currentOrchestratorId,
      });
    } else if (evaluation.isApproachingLimit) {
      this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_WARNING, {
        spawnCount: this._spawnCount,
        maxSpawns: this._maxSpawns,
        remainingSpawns: evaluation.remainingSpawns,
        tokenUtilizationPercent: this._tokenUtilizationPercent,
        orchestratorId: this._currentOrchestratorId,
      });
    }

    return this._spawnCount;
  }

  public updateTokenUtilization(percent: number): void {
    if (
      percent < SUCCESSION_CONSTANTS.MIN_PERCENT ||
      percent > SUCCESSION_CONSTANTS.MAX_PERCENT ||
      Number.isNaN(percent)
    ) {
      throw new SuccessionError(
        `Token utilization percent must be between ${SUCCESSION_CONSTANTS.MIN_PERCENT} and ${SUCCESSION_CONSTANTS.MAX_PERCENT}. Received: ${percent}`
      );
    }

    this._tokenUtilizationPercent = percent;
    const evaluation = this.checkBoundaryEvaluation();

    if (evaluation.isSuccessionRequired) {
      this._isDispatchesPaused = true;
      this._status = SUCCESSION_CONSTANTS.STATUS_PAUSED;
      this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_TOKEN_WATERMARK, {
        tokenUtilizationPercent: this._tokenUtilizationPercent,
        tokenWatermarkPercent: this._tokenWatermarkPercent,
        orchestratorId: this._currentOrchestratorId,
      });
      this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_PAUSED, {
        reason: evaluation.reason,
        tokenUtilizationPercent: this._tokenUtilizationPercent,
        orchestratorId: this._currentOrchestratorId,
      });
    } else if (evaluation.isApproachingLimit) {
      this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_WARNING, {
        spawnCount: this._spawnCount,
        maxSpawns: this._maxSpawns,
        remainingSpawns: evaluation.remainingSpawns,
        tokenUtilizationPercent: this._tokenUtilizationPercent,
        orchestratorId: this._currentOrchestratorId,
      });
    }
  }

  public pauseDispatches(): void {
    this._isDispatchesPaused = true;
    this._status = SUCCESSION_CONSTANTS.STATUS_PAUSED;
    this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_PAUSED, {
      reason: SUCCESSION_CONSTANTS.REASON_MANUAL,
      spawnCount: this._spawnCount,
      orchestratorId: this._currentOrchestratorId,
    });
  }

  public resumeDispatches(): void {
    if (this.isSuccessionRequired()) {
      throw new SuccessionBoundaryError(
        `Cannot resume dispatches: orchestrator succession boundary reached (${this._spawnCount}/${this._maxSpawns} spawns, ${this._tokenUtilizationPercent}% tokens). Succession handover must be performed first.`,
        this._spawnCount,
        this._maxSpawns
      );
    }
    this._isDispatchesPaused = false;
    this._status = SUCCESSION_CONSTANTS.STATUS_ACTIVE;
    this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_RESUMED, {
      orchestratorId: this._currentOrchestratorId,
    });
  }

  // --- Succession Handover Execution ---

  public executeSuccession(
    params?: SuccessionExecutionParams
  ): SuccessionExecutionResult {
    const predecessorId = this._currentOrchestratorId;
    const successorId =
      params?.successorId?.trim() ||
      generateSuccessorOrchestratorId(predecessorId);

    const evaluation = this.checkBoundaryEvaluation();
    const reason =
      params?.reason ??
      evaluation.reason ??
      SUCCESSION_CONSTANTS.REASON_MANUAL;

    this._status = SUCCESSION_CONSTANTS.STATUS_HANDING_OVER;
    this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_HANDOVER_STARTED, {
      predecessorId,
      successorId,
      reason,
      spawnCount: this._spawnCount,
    });

    const snapshot = createSuccessionSnapshot({
      predecessorAgentId: predecessorId,
      successorAgentId: successorId,
      spawnCount: this._spawnCount,
      maxSpawns: this._maxSpawns,
      reason,
      activeTasks: params?.activeTasks,
      completedTasks: params?.completedTasks,
      predecessorSnapshot: params?.predecessorSnapshot,
      customNotes: params?.customNotes,
      metadata: params?.metadata,
    });

    const predecessorGen = this._generation;
    this._generation =
      predecessorGen + SUCCESSION_CONSTANTS.GENERATION_INCREMENT;
    const spawnCountAtHandover = this._spawnCount;
    this._currentOrchestratorId = successorId;
    this._spawnCount = SUCCESSION_CONSTANTS.INITIAL_SPAWN_COUNT;
    this._tokenUtilizationPercent =
      SUCCESSION_CONSTANTS.INITIAL_TOKEN_UTILIZATION;
    this._status = SUCCESSION_CONSTANTS.STATUS_ACTIVE;
    this._isDispatchesPaused = false;

    const result: SuccessionExecutionResult = {
      predecessorId,
      successorId,
      predecessorGeneration: predecessorGen,
      successorGeneration: this._generation,
      spawnCountAtHandover,
      reason,
      isMidExecution: false,
      snapshot,
      fsmEvent: LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE,
      timestamp: new Date().toISOString(),
    };

    this._history.push(result);
    this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_COMPLETED, result);

    return result;
  }

  public executeMidExecutionSuccession(
    params: MidExecutionSuccessionParams
  ): SuccessionExecutionResult {
    if (!params.activeWorkerId?.trim()) {
      throw new SuccessionError(
        "Active worker ID is required for mid-execution succession."
      );
    }
    if (!params.baselineSha?.trim()) {
      throw new SuccessionError(
        "Valid baseline SHA is required for mid-execution succession rollback isolation."
      );
    }

    const predecessorId = this._currentOrchestratorId;
    const successorId =
      params.successorId?.trim() ||
      generateSuccessorOrchestratorId(predecessorId);

    const rollbackCommand = buildRollbackCommand(params.baselineSha);
    const reason =
      params.reason ??
      (this._tokenUtilizationPercent >= this._tokenWatermarkPercent
        ? SUCCESSION_CONSTANTS.REASON_TOKEN_WATERMARK
        : this._spawnCount >= this._maxSpawns
          ? SUCCESSION_CONSTANTS.REASON_SPAWN_LIMIT
          : SUCCESSION_CONSTANTS.REASON_MANUAL);

    this._isDispatchesPaused = true;
    this._status = SUCCESSION_CONSTANTS.STATUS_HANDING_OVER;

    const midExecutionDetails = {
      predecessorId,
      successorId,
      activeWorkerId: params.activeWorkerId,
      baselineSha: params.baselineSha,
      stashedSha: params.stashedSha,
      rollbackCommand,
      reason,
    };

    this.emit(
      SUCCESSION_CONSTANTS.EVENT_SUCCESSION_MID_EXECUTION,
      midExecutionDetails
    );

    const customNotes = [
      `Mid-execution context succession triggered for active worker '${params.activeWorkerId}'.`,
      `Working tree rollback command formulated against baseline '${params.baselineSha}'.`,
      params.stashedSha
        ? `Uncommitted diff stashed at '${params.stashedSha}'.`
        : "No git stash recorded.",
      params.customNotes,
    ]
      .filter(Boolean)
      .join("\n");

    const snapshot = createSuccessionSnapshot({
      predecessorAgentId: predecessorId,
      successorAgentId: successorId,
      spawnCount: this._spawnCount,
      maxSpawns: this._maxSpawns,
      reason,
      activeTasks: params.activeTasks,
      completedTasks: params.completedTasks,
      stashedSha: params.stashedSha,
      predecessorSnapshot: params.predecessorSnapshot,
      customNotes,
      metadata: {
        ...params.metadata,
        activeWorkerId: params.activeWorkerId,
        baselineSha: params.baselineSha,
        stashedSha: params.stashedSha,
        rollbackCommand,
        isMidExecution: true,
      },
    });

    const predecessorGen = this._generation;
    this._generation =
      predecessorGen + SUCCESSION_CONSTANTS.GENERATION_INCREMENT;
    const spawnCountAtHandover = this._spawnCount;
    this._currentOrchestratorId = successorId;
    this._spawnCount = SUCCESSION_CONSTANTS.INITIAL_SPAWN_COUNT;
    this._tokenUtilizationPercent =
      SUCCESSION_CONSTANTS.INITIAL_TOKEN_UTILIZATION;
    this._status = SUCCESSION_CONSTANTS.STATUS_ACTIVE;
    this._isDispatchesPaused = false;

    const result: SuccessionExecutionResult = {
      predecessorId,
      successorId,
      predecessorGeneration: predecessorGen,
      successorGeneration: this._generation,
      spawnCountAtHandover,
      reason,
      isMidExecution: true,
      stashedSha: params.stashedSha,
      rollbackCommand,
      snapshot,
      fsmEvent: LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE,
      timestamp: new Date().toISOString(),
    };

    this._history.push(result);
    this.emit(SUCCESSION_CONSTANTS.EVENT_SUCCESSION_COMPLETED, result);

    return result;
  }

  public reset(initialId?: string): void {
    this._currentOrchestratorId =
      initialId?.trim() || SUCCESSION_CONSTANTS.INITIAL_ORCHESTRATOR_ID;
    this._generation = parseOrchestratorGeneration(this._currentOrchestratorId);
    this._spawnCount = SUCCESSION_CONSTANTS.INITIAL_SPAWN_COUNT;
    this._tokenUtilizationPercent =
      SUCCESSION_CONSTANTS.INITIAL_TOKEN_UTILIZATION;
    this._status = SUCCESSION_CONSTANTS.STATUS_ACTIVE;
    this._isDispatchesPaused = false;
    this._history.length = SUCCESSION_CONSTANTS.ZERO;
  }
}

/**
 * Factory function to instantiate a new OrchestratorSuccessionManager.
 */
export function createOrchestratorSuccessionManager(
  options?: OrchestratorSuccessionOptions
): OrchestratorSuccessionManager {
  return new OrchestratorSuccessionManager(options);
}

// -------------------------------------------------------------------------------------------------
// Autonomous Failure Classifier Engine (LOOPER-CORE-004 / Task 1.3)
// -------------------------------------------------------------------------------------------------

/**
 * Autonomous Failure Classifier Engine.
 *
 * Implements Task 1.3 of OpenSpec change `looper-core-router-escalation`.
 *
 * Evaluates failure reports from test runners, semantic reviewers, adversarial challengers,
 * and system processes, and dispatches them across three discrete routing targets:
 * 1. 'retry': Local mechanical retry preserving dirty diff for transient/assertion glitches within attempt budget.
 * 2. 'prompt_enrichment': Structured contextual prompt enrichment for compiler errors, reviewer critiques, and challenger breaks.
 * 3. 'forensic_audit': Gate 3 binary veto inspection, layout validation, and atomic rollback isolation for invariant breaches.
 */
export class FailureClassifier extends EventEmitter {
  private readonly _maxRetryAttempts: number;
  private readonly _customRules: FailureClassifierRule[];
  private readonly _metadata: Record<string, unknown>;

  constructor(options?: FailureClassifierOptions) {
    super();

    this._maxRetryAttempts =
      options?.maxRetryAttempts ??
      FAILURE_CLASSIFIER_CONSTANTS.DEFAULT_MAX_RETRY_ATTEMPTS;
    this._customRules = options?.customRules ? [...options.customRules] : [];
    this._metadata = options?.metadata ? { ...options.metadata } : {};
  }

  // --- Getters & Accessors ---

  public get maxRetryAttempts(): number {
    return this._maxRetryAttempts;
  }

  public get customRules(): ReadonlyArray<FailureClassifierRule> {
    return Object.freeze([...this._customRules]);
  }

  public get metadata(): Readonly<Record<string, unknown>> {
    return Object.freeze({ ...this._metadata });
  }

  // --- Rule Management ---

  public addCustomRule(rule: FailureClassifierRule): void {
    if (!rule.name || typeof rule.name !== "string" || rule.name.trim() === "") {
      throw new EscalationError("Cannot add custom rule: rule name must be a non-empty string.");
    }
    this._customRules.push(rule);
  }

  public removeCustomRule(ruleName: string): boolean {
    const idx = this._customRules.findIndex((r) => r.name === ruleName);
    if (idx >= FAILURE_CLASSIFIER_CONSTANTS.ZERO) {
      this._customRules.splice(idx, FAILURE_CLASSIFIER_CONSTANTS.ONE);
      return true;
    }
    return false;
  }

  // --- Classification & Routing Execution ---

  public classify(
    failure: FailureReport | string,
    context?: FailureRoutingContext
  ): FailureClassification {
    const classification = classifyFailure(
      failure,
      {
        maxRetryAttempts: this._maxRetryAttempts,
        customRules: this._customRules,
      },
      context
    );

    this.emit(FAILURE_CLASSIFIER_CONSTANTS.EVENT_CLASSIFIED, {
      failure,
      classification,
    });

    return classification;
  }

  public route(
    failure: FailureReport | string,
    context?: FailureRoutingContext
  ): FailureRoutingDecision {
    this.classify(failure, context);

    const decision = routeFailure(
      failure,
      {
        maxRetryAttempts: this._maxRetryAttempts,
        customRules: this._customRules,
      },
      context
    );

    this.emit(FAILURE_CLASSIFIER_CONSTANTS.EVENT_ROUTED, {
      failure,
      decision,
    });

    if (decision.target === FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT) {
      this.emit(FAILURE_CLASSIFIER_CONSTANTS.EVENT_FORENSIC_AUDIT_TRIGGERED, {
        failure,
        decision,
      });
    } else if (decision.target === FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT) {
      this.emit(FAILURE_CLASSIFIER_CONSTANTS.EVENT_PROMPT_ENRICHED, {
        failure,
        decision,
      });
    } else {
      this.emit(FAILURE_CLASSIFIER_CONSTANTS.EVENT_RETRY_DISPATCHED, {
        failure,
        decision,
      });
    }

    return decision;
  }

  public buildEnrichedPrompt(
    decision: FailureRoutingDecision,
    context?: FailureRoutingContext,
    failure?: FailureReport
  ): string {
    return buildFailureEnrichedPrompt(decision, context, failure);
  }

  public isForensicAuditRequired(
    failure: FailureReport | string,
    context?: FailureRoutingContext
  ): boolean {
    return this.route(failure, context).target === FAILURE_ROUTING_TARGETS.FORENSIC_AUDIT;
  }

  public isPromptEnrichmentRequired(
    failure: FailureReport | string,
    context?: FailureRoutingContext
  ): boolean {
    return this.route(failure, context).target === FAILURE_ROUTING_TARGETS.PROMPT_ENRICHMENT;
  }

  public isRetryEligible(
    failure: FailureReport | string,
    context?: FailureRoutingContext
  ): boolean {
    return this.route(failure, context).target === FAILURE_ROUTING_TARGETS.RETRY;
  }
}

/**
 * Factory function to instantiate a new FailureClassifier.
 */
export function createFailureClassifier(
  options?: FailureClassifierOptions
): FailureClassifier {
  return new FailureClassifier(options);
}
