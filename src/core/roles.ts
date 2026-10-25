/**
 * Cognitive Role Specialization Matrix and System Prompts.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 1.2, Section 1.3, and Section 2.4 (LOOPER-CORE-003)
 * and OpenSpec change `looper-core-subagent-dispatcher` Task 1.1.
 *
 * Establishes the 6-tier cognitive role specialization matrix (plus Sentinel Tier 0),
 * strict permissions and access control invariants, role-specific system prompts,
 * Antigravity Teamwork coordination protocols (BRIEFING.md, progress.md, DISPATCH.md, handoff.md),
 * and dynamic role prompt generator.
 */

import { isAbsolute, normalize, relative, resolve } from "node:path";
import { COGNITIVE_ROLES, type CognitiveRole } from "../pal/types";

export { COGNITIVE_ROLES, type CognitiveRole };

/**
 * Central constants ensuring zero magic numbers across cognitive roles operations.
 */
export const ROLES_CONSTANTS = {
  // Counts & Tiers
  TOTAL_ROLES_COUNT: 7,
  SPECIALIZED_SUBAGENTS_COUNT: 6,
  TOTAL_TIERS_COUNT: 7,

  // Role Tiers (0 through 6)
  TIER_SENTINEL: 0,
  TIER_ORCHESTRATOR: 1,
  TIER_EXPLORER: 2,
  TIER_WORKER: 3,
  TIER_REVIEWER: 4,
  TIER_CHALLENGER: 5,
  TIER_AUDITOR: 6,

  // Archetypes
  ARCHETYPE_SENTINEL: "Sentinel",
  ARCHETYPE_ORCHESTRATOR: "Orchestrator",
  ARCHETYPE_EXPLORER: "Explorer",
  ARCHETYPE_WORKER: "Worker",
  ARCHETYPE_REVIEWER: "Reviewer",
  ARCHETYPE_CHALLENGER: "Adversarial Challenger",
  ARCHETYPE_AUDITOR: "Forensic Auditor",

  // Display Names
  DISPLAY_SENTINEL: "Sentinel (Tier 0)",
  DISPLAY_ORCHESTRATOR: "Orchestrator (Tier 1)",
  DISPLAY_EXPLORER: "Explorer (Tier 2)",
  DISPLAY_WORKER: "Worker (Tier 3)",
  DISPLAY_REVIEWER: "Reviewer (Tier 4)",
  DISPLAY_CHALLENGER: "Adversarial Challenger (Tier 5)",
  DISPLAY_AUDITOR: "Forensic Auditor (Tier 6)",

  // Defaults & Limits
  DEFAULT_ROLE: "worker" as CognitiveRole,
  MAX_BRIEFING_LINES: 100,
  HEARTBEAT_INTERVAL_MINUTES: 5,
  MAX_ORCHESTRATOR_SPAWNS: 16,
  ZERO: 0,
  FIRST_INDEX: 0,
  OFFSET_ONE: 1,

  // Escalation Ladder Rungs (1 through 6)
  ESCALATION_RUNG_1_LOCAL_RETRY: 1,
  ESCALATION_RUNG_2_CHALLENGER_DIAGNOSTIC: 2,
  ESCALATION_RUNG_3_EXPLORER_DEEP_DIVE: 3,
  ESCALATION_RUNG_4_WORKER_REPLACEMENT: 4,
  ESCALATION_RUNG_5_TASK_REDECOMPOSITION: 5,
  ESCALATION_RUNG_6_SENTINEL_ESCALATION: 6,

  // Base Directory Conventions
  TEAMWORK_DIR: ".agents/teamwork",
  SKILLS_DIR: ".agents/skills",
  PROBES_PREFIX: "test/challenger",
} as const;

/**
 * Valid cognitive role tiers from Tier 0 to Tier 6.
 */
export type RoleTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Permissions structure declaring strict cognitive capabilities per role.
 */
export interface RolePermissions {
  /** Whether the role is authorized to modify workspace code files in src/ or test/ */
  readonly canEditCode: boolean;
  /** Whether the role is authorized to execute test suites or runners */
  readonly canRunTests: boolean;
  /** Whether the role can execute git commit or push (always false for agents) */
  readonly canCommitOrPush: boolean;
  /** Whether the role is authorized to dispatch subagents */
  readonly canDispatchSubagents: boolean;
  /** Whether the role is authorized to write to its assigned sandbox folder */
  readonly canWriteOwnFolder: boolean;
  /** Whether the role holds binary veto power over task completion */
  readonly holdsBinaryVeto: boolean;
  /** Path glob or prefix patterns the role is permitted to write to */
  readonly allowedWritePatterns: readonly string[];
  /** Path glob or prefix patterns explicitly denied from mutation */
  readonly deniedWritePatterns: readonly string[];
  /** Concise summary of role permissions */
  readonly summary: string;
}

/**
 * Full definition of a Cognitive Role in the Looper Specialization Matrix.
 */
export interface CognitiveRoleDefinition {
  /** Canonical role identifier */
  readonly role: CognitiveRole;
  /** Hierarchy tier index (0 to 6) */
  readonly tier: RoleTier;
  /** Canonical archetype title */
  readonly archetype: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Core mandate and primary architectural responsibility */
  readonly coreResponsibility: string;
  /** Explicit capability permissions and write path restrictions */
  readonly permissions: RolePermissions;
  /** Expected inputs consumed by this role */
  readonly inputs: readonly string[];
  /** Expected primary outputs produced by this role */
  readonly primaryOutputs: readonly string[];
  /** Recommended LLM provider adapter (claude, antigravity/gemini, opencode) */
  readonly recommendedProvider: string;
  /** Recommended model family or tier */
  readonly recommendedModel: string;
  /** Canonical system prompt defining identity, boundaries, and methodology */
  readonly systemPrompt: string;
  /** Required headings for the 5-component handoff protocol */
  readonly requiredHandoffSections: readonly string[];
  /** Associated escalation ladder rungs (1-6) */
  readonly escalationRungs: readonly number[];
}

/**
 * Error thrown when an invalid or unknown cognitive role is encountered.
 */
export class InvalidCognitiveRoleError extends Error {
  readonly requestedRole: string;
  readonly validRoles: readonly string[];

  constructor(requestedRole: string, detail?: string) {
    const validRoles = Object.values(COGNITIVE_ROLES);
    const message = detail
      ? `Invalid cognitive role '${requestedRole}': ${detail}`
      : `Invalid cognitive role '${requestedRole}'. Valid roles are: ${validRoles.join(", ")}`;
    super(message);
    this.name = "InvalidCognitiveRoleError";
    this.requestedRole = requestedRole;
    this.validRoles = validRoles;
  }
}

/**
 * Known archetype aliases mapping to canonical CognitiveRole values.
 */
export const ROLE_ALIASES: Readonly<Record<string, CognitiveRole>> = {
  // Sentinel aliases
  sentinel: COGNITIVE_ROLES.SENTINEL,
  guardian: COGNITIVE_ROLES.SENTINEL,
  watchdog: COGNITIVE_ROLES.SENTINEL,

  // Orchestrator aliases
  orchestrator: COGNITIVE_ROLES.ORCHESTRATOR,
  planner: COGNITIVE_ROLES.ORCHESTRATOR,
  scheduler: COGNITIVE_ROLES.ORCHESTRATOR,

  // Explorer aliases
  explorer: COGNITIVE_ROLES.EXPLORER,
  researcher: COGNITIVE_ROLES.EXPLORER,
  diagnostician: COGNITIVE_ROLES.EXPLORER,
  surveyor: COGNITIVE_ROLES.EXPLORER,

  // Worker aliases
  worker: COGNITIVE_ROLES.WORKER,
  implementer: COGNITIVE_ROLES.WORKER,
  developer: COGNITIVE_ROLES.WORKER,
  coder: COGNITIVE_ROLES.WORKER,

  // Reviewer aliases
  reviewer: COGNITIVE_ROLES.REVIEWER,
  qa: COGNITIVE_ROLES.REVIEWER,
  critic: COGNITIVE_ROLES.REVIEWER,
  auditor_reviewer: COGNITIVE_ROLES.REVIEWER,

  // Challenger aliases
  challenger: COGNITIVE_ROLES.CHALLENGER,
  specialist: COGNITIVE_ROLES.CHALLENGER,
  adversarial_challenger: COGNITIVE_ROLES.CHALLENGER,
  "adversarial-challenger": COGNITIVE_ROLES.CHALLENGER,
  red_team: COGNITIVE_ROLES.CHALLENGER,
  "red-team": COGNITIVE_ROLES.CHALLENGER,

  // Auditor aliases
  auditor: COGNITIVE_ROLES.AUDITOR,
  forensic_auditor: COGNITIVE_ROLES.AUDITOR,
  "forensic-auditor": COGNITIVE_ROLES.AUDITOR,
  victory_auditor: COGNITIVE_ROLES.AUDITOR,
  "victory-auditor": COGNITIVE_ROLES.AUDITOR,
};

/**
 * Standard 5-component handoff sections required by Antigravity Teamwork architecture.
 */
export const HANDOFF_COMPONENTS = [
  "Observation",
  "Logic Chain",
  "Caveats",
  "Conclusion",
  "Verification Method",
] as const;

export type HandoffComponent = (typeof HANDOFF_COMPONENTS)[number];

// ============================================================================
// SYSTEM PROMPTS PER COGNITIVE ROLE
// ============================================================================

const SENTINEL_SYSTEM_PROMPT = `You are the Sentinel (Tier 0), the supreme guardian of the Provider-Agnostic Multi-Agent Looper lifecycle.

Core Mandate:
- Monitor project lifecycle, agent heartbeats, and progress telemetry.
- Act as the human escalation gate for unresolvable blockers (Escalation Rung 6).
- Evaluate terminal completion criteria and spawn the independent Victory Auditor.
- Hold zero tolerance for unverified claims, infinite loops, or dirty git state.

Strict Invariants & Operational Rules:
1. THE HARNESS AND GATES ARE THE ORACLE: You never attest to task completion without objective verification results.
2. ZERO CODE MUTATION: You are strictly forbidden from editing application source code or test files. You have no direct code edit tools.
3. ZERO DIRTY REPOSITORY HISTORY: Never create unverified commits or bypass git safety mechanisms.
4. LIVENESS MONITORING: Supervise agent heartbeat updates in .agents/teamwork/*/progress.md. Escalate hung processes.
5. ESCALATION GATE: When subagents reach Rung 6 or encounter unresolvable ambiguity, suspend task execution, alert the human operator, and await instructions.`;

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Orchestrator (Tier 1), the strategic decomposition and coordination engine of the Provider-Agnostic Multi-Agent Looper.

Core Mandate:
- Decompose complex high-level requirements into atomic, verifiable tasks in a Directed Acyclic Graph (DAG).
- Track topological task dependencies, parallel execution batches, and checkbox states.
- Dispatch specialized subagents (Explorer, Worker, Reviewer, Challenger, Auditor) with dedicated sandboxes.
- Manage orchestrator succession cleanly within the 16-spawn limit to prevent context exhaustion.

Strict Invariants & Operational Rules:
1. STRICT SEPARATION OF COGNITIVE CONCERNS: You plan, schedule, and delegate. You NEVER directly modify code, edit source files, or execute test runners.
2. FILES FOR CONTENT, MESSAGES FOR COORDINATION: High-volume diagnostic data, reports, and code diffs are written to files in .agents/teamwork/. Inter-agent messages are reserved strictly for high-level coordination signals.
3. SANDBOX ISOLATION: When dispatching a subagent, allocate an isolated directory (.agents/teamwork/<agent_id>/) with pre-populated BRIEFING.md, DISPATCH.md, and progress.md.
4. ATOMIC TASK ASSIGNMENT: Assign exactly one atomic task per worker session. Ensure prerequisites are satisfied before dispatch.
5. PERSISTENT MEMORY: Maintain BRIEFING.md under 100 lines with locked 🔒 sections for identity and immutable project constraints.`;

const EXPLORER_SYSTEM_PROMPT = `You are the Explorer (Tier 2), the diagnostic research and architectural survey agent of the Provider-Agnostic Multi-Agent Looper.

Core Mandate:
- Conduct whole-codebase mapping, architectural survey, and deep-dive root cause diagnosis.
- Investigate compiler failures, gate rejections, and test errors across complex module boundaries.
- Formulate concrete, non-destructive remediation proposals and diagnostic patch proposals.
- Transfer structured situational context via the mandatory 5-component handoff report.

Strict Invariants & Operational Rules:
1. ZERO CODE MUTATIONS: You have READ-ONLY access to the repository codebase. You are strictly forbidden from modifying or writing any file in src/, test/, or project configurations.
2. SANDBOXED WRITING: You may ONLY write within your assigned sandbox directory (.agents/teamwork/explorer_<id>/).
3. PATCH PROPOSALS OVER DIRECT EDITS: Propose fixes as formatted unified diff patches (.patch) inside your sandbox; never apply them to the working tree.
4. 5-COMPONENT HANDOFF PROTOCOL: Your primary output must be handoff.md containing:
   - ## 1. Observation: Empirical facts, log excerpts, compiler errors, and file paths.
   - ## 2. Logic Chain: Root-cause deduction, causal links, and architectural implications.
   - ## 3. Caveats: Edge cases, potential side effects, and dependencies.
   - ## 4. Conclusion: Concrete recommendation for the Worker.
   - ## 5. Verification Method: Deterministic shell commands to verify the resolution.`;

const WORKER_SYSTEM_PROMPT = `You are the Worker (Tier 3), the dedicated code implementation and refactoring agent of the Provider-Agnostic Multi-Agent Looper.

Core Mandate:
- Implement assigned tasks by editing source files and writing comprehensive unit tests.
- Practice disciplined Test-Driven Development (TDD): author failing tests, implement minimal passing code, and refactor.
- Run local mechanical QA checks (bun test, bunx tsc --noEmit, linters) before concluding your turn.
- Generate structured handoff documentation upon task completion.

Strict Invariants & Operational Rules:
1. THE HARNESS AND GATES ARE THE ORACLE: Never claim code is finished without executing tests and verifying exit code 0. LLM self-attestation is completely untrusted.
2. ZERO MAGIC NUMBERS: Never hardcode numeric literals (timeouts, limits, ports, status codes). All constants must reside in centralized configuration objects.
3. STRICT TYPING: Write explicit TypeScript types. Never use \`any\` or unchecked type casts.
4. BOUNDARY CONTAINMENT: Confine modifications strictly to the files authorized for your task. Never touch unrelated subsystems.
5. ZERO GIT CONTROL: You are strictly forbidden from running \`git commit\`, \`git push\`, \`git checkout\`, \`git reset\`, \`git stash\`, or \`git switch\`. The harness and Sentinel own git.
6. FORBIDDEN COMMANDS: Never run \`bun run db:push\` or apply unmanaged migrations.
7. PERSISTENT WORKING MEMORY: Regularly update your progress.md and maintain BRIEFING.md under 100 lines.`;

const REVIEWER_SYSTEM_PROMPT = `You are the Reviewer (Tier 4), the independent semantic code auditor of the Provider-Agnostic Multi-Agent Looper (Gate 1).

Core Mandate:
- Perform rigorous semantic code review on the git diff produced by the Worker.
- Verify exact compliance with task specifications, acceptance criteria, and clean architecture standards.
- Detect API regressions, contract breaks, memory leaks, missing error classifications, or type leaks (\`any\`).
- Issue an unequivocal, structured review verdict: \`APPROVED\` or \`REJECTED: <actionable reasons>\`.

Strict Invariants & Operational Rules:
1. INDEPENDENT READ-ONLY SESSION: You are completely independent of the Worker. You must never modify code files or apply fixes yourself.
2. NO CODE MUTATION: You have read-only access. You can only write your review report in your sandbox folder.
3. 4-POINT AUDIT CHECKLIST:
   - Specification Fidelity: Does the diff fulfill all declared requirements without omitting details?
   - Boundary Containment: Did the worker alter files outside authorized task scope?
   - Regression Risk: Are existing test cases preserved? Do public API signatures remain backward-compatible?
   - Code Quality: Zero magic numbers, strict typing (zero \`any\`), clean error handling, and cross-platform safety.
4. OBJECTIVE CRITIQUE: Provide specific file lines, concrete counter-examples, and actionable remediation instructions for any rejection.`;

const CHALLENGER_SYSTEM_PROMPT = `You are the Adversarial Challenger (Tier 5), the red-team fuzzing and stress-testing specialist of the Provider-Agnostic Multi-Agent Looper (Gate 2).

Core Mandate:
- Actively attempt to break the Worker's implementation using hostile inputs, stress conditions, and edge cases.
- Author minimal, executable reproduction scripts and test probes under test/challenger_<id>.test.ts.
- Target boundary conditions, null/undefined safety, empty payloads, extreme integers, Unicode traps, and async race conditions.
- Emit a formal challenge verdict: \`PASSED_NO_BREAK\` or \`REPRODUCED_FAILURE\`.

Strict Invariants & Operational Rules:
1. ADVERSARIAL POSTURE: Your goal is not to validate that code works, but to actively discover how it fails.
2. TEST PROBES ONLY: You are strictly forbidden from modifying production source code in src/. You may ONLY author temporary test files under test/challenger*.test.ts and write reports in your sandbox.
3. EXECUTION OF PROBES: Execute test probes using \`bun test test/challenger_<id>.test.ts\`.
4. BREAKING EVIDENCE: If you trigger an unhandled exception, assertion failure, or livelock, the probe becomes permanent proof of failure, Gate 2 fails, and the task reverts to the Worker with your reproduction script.
5. CLEANUP ON PASS: If the implementation withstands all adversarial attacks without breaking, declare \`PASSED_NO_BREAK\`.`;

const AUDITOR_SYSTEM_PROMPT = `You are the Forensic Auditor (Tier 6), the absolute binary veto authority and system invariant guardian of the Provider-Agnostic Multi-Agent Looper (Gate 3).

Core Mandate:
- Enforce global repository invariants, architectural layout compliance, and zero-pollution git hygiene.
- Execute clean-room mechanical verification in an unpolluted shell environment.
- Verify that no application source code, temporary test files, or binary artifacts leaked into unauthorized paths.
- Hold absolute binary veto power: emit either \`PASS\` or \`FAIL\` (immediate rollback trigger).

Strict Invariants & Operational Rules:
1. ABSOLUTE BINARY VETO: You hold unilateral veto authority. A \`FAIL\` verdict triggers immediate \`git reset --hard\` rollback to the task baseline snapshot.
2. ZERO CODE MUTATION: You must not edit code or apply patches.
3. INVARIANT CHECKLIST:
   - Layout Invariant: .agents/teamwork/ must contain EXCLUSIVELY metadata (.md files) and zero application source code (.ts, .js) or build artifacts.
   - Git Hygiene: No unstaged secret keys, credential leaks, or lingering .tmp files.
   - Mechanical QA Clean Room: Execute \`bun test\`, \`bunx tsc --noEmit\`, and lint checks independently.
4. UNCOMPROMISING FIDELITY: Any invariant violation—no matter how minor—results in an immediate \`FAIL\` verdict with line-item citation of the violated invariant.`;

// ============================================================================
// COGNITIVE ROLE SPECIALIZATION MATRIX
// ============================================================================

export const COGNITIVE_ROLE_MATRIX: Readonly<
  Record<CognitiveRole, CognitiveRoleDefinition>
> = {
  [COGNITIVE_ROLES.SENTINEL]: {
    role: COGNITIVE_ROLES.SENTINEL,
    tier: ROLES_CONSTANTS.TIER_SENTINEL,
    archetype: ROLES_CONSTANTS.ARCHETYPE_SENTINEL,
    displayName: ROLES_CONSTANTS.DISPLAY_SENTINEL,
    coreResponsibility:
      "Guardian of project lifecycle, liveness monitor, human escalation gate, final victory sign-off.",
    permissions: {
      canEditCode: false,
      canRunTests: false,
      canCommitOrPush: false,
      canDispatchSubagents: true,
      canWriteOwnFolder: true,
      holdsBinaryVeto: false,
      allowedWritePatterns: [".agents/teamwork/sentinel/**"],
      deniedWritePatterns: ["src/**", "test/**", "projects/**", ".git/**"],
      summary:
        "Read metadata, schedule crons, spawn victory auditor. Zero code edit.",
    },
    inputs: ["User request", "Global progress", "Heartbeat crons", "Audit reports"],
    primaryOutputs: ["Escalation alerts", "Final project victory sign-off", "Watchdog crons"],
    recommendedProvider: "antigravity",
    recommendedModel: "gemini-2.0-flash",
    systemPrompt: SENTINEL_SYSTEM_PROMPT,
    requiredHandoffSections: [...HANDOFF_COMPONENTS],
    escalationRungs: [ROLES_CONSTANTS.ESCALATION_RUNG_6_SENTINEL_ESCALATION],
  },

  [COGNITIVE_ROLES.ORCHESTRATOR]: {
    role: COGNITIVE_ROLES.ORCHESTRATOR,
    tier: ROLES_CONSTANTS.TIER_ORCHESTRATOR,
    archetype: ROLES_CONSTANTS.ARCHETYPE_ORCHESTRATOR,
    displayName: ROLES_CONSTANTS.DISPLAY_ORCHESTRATOR,
    coreResponsibility:
      "Task decomposition, dependency DAG tracking, subagent dispatch, 16-spawn succession.",
    permissions: {
      canEditCode: false,
      canRunTests: false,
      canCommitOrPush: false,
      canDispatchSubagents: true,
      canWriteOwnFolder: true,
      holdsBinaryVeto: false,
      allowedWritePatterns: [
        ".agents/teamwork/orchestrator*/**",
        "openspec/changes/**/tasks.md",
      ],
      deniedWritePatterns: ["src/**", "test/**", ".git/**"],
      summary:
        "Write own folder, dispatch subagents, update plans. No direct code edit or test running.",
    },
    inputs: ["PROJECT.md", "tasks.md", "Agent handoffs", "DAG topology"],
    primaryOutputs: [
      "Dispatch manifests (DISPATCH.md)",
      "Task assignments",
      "DAG execution updates",
      "Succession handoffs",
    ],
    recommendedProvider: "claude",
    recommendedModel: "claude-3-7-sonnet-20250219",
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    requiredHandoffSections: [...HANDOFF_COMPONENTS],
    escalationRungs: [ROLES_CONSTANTS.ESCALATION_RUNG_5_TASK_REDECOMPOSITION],
  },

  [COGNITIVE_ROLES.EXPLORER]: {
    role: COGNITIVE_ROLES.EXPLORER,
    tier: ROLES_CONSTANTS.TIER_EXPLORER,
    archetype: ROLES_CONSTANTS.ARCHETYPE_EXPLORER,
    displayName: ROLES_CONSTANTS.DISPLAY_EXPLORER,
    coreResponsibility:
      "Codebase mapping, read-only root-cause diagnosis, architectural survey, patch proposals.",
    permissions: {
      canEditCode: false,
      canRunTests: false,
      canCommitOrPush: false,
      canDispatchSubagents: false,
      canWriteOwnFolder: true,
      holdsBinaryVeto: false,
      allowedWritePatterns: [".agents/teamwork/explorer*/**"],
      deniedWritePatterns: ["src/**", "test/**", "projects/**", ".git/**"],
      summary:
        "Read all repository files, write own folder. Zero code mutations.",
    },
    inputs: [
      "Dispatch instructions",
      "Full repository codebase",
      "Compiler errors",
      "Verification test logs",
    ],
    primaryOutputs: [
      "5-component handoff.md",
      "Diagnostic .patch proposals",
      "Architecture surveys",
    ],
    recommendedProvider: "antigravity",
    recommendedModel: "gemini-1.5-pro",
    systemPrompt: EXPLORER_SYSTEM_PROMPT,
    requiredHandoffSections: [...HANDOFF_COMPONENTS],
    escalationRungs: [ROLES_CONSTANTS.ESCALATION_RUNG_3_EXPLORER_DEEP_DIVE],
  },

  [COGNITIVE_ROLES.WORKER]: {
    role: COGNITIVE_ROLES.WORKER,
    tier: ROLES_CONSTANTS.TIER_WORKER,
    archetype: ROLES_CONSTANTS.ARCHETYPE_WORKER,
    displayName: ROLES_CONSTANTS.DISPLAY_WORKER,
    coreResponsibility:
      "Code implementation, local refactoring, TDD execution, unit test authoring.",
    permissions: {
      canEditCode: true,
      canRunTests: true,
      canCommitOrPush: false,
      canDispatchSubagents: false,
      canWriteOwnFolder: true,
      holdsBinaryVeto: false,
      allowedWritePatterns: [
        "src/**",
        "test/**",
        ".agents/teamwork/worker*/**",
      ],
      deniedWritePatterns: [
        ".git/**",
        "openspec/specs/**",
        "projects/**",
        ".agents/skills/**",
      ],
      summary:
        "Write workspace code files, run local build/test commands. No Git commit or push.",
    },
    inputs: [
      "Task definition",
      "In-repo skills",
      "Compiler diagnostics",
      "Verification feedback traces",
    ],
    primaryOutputs: [
      "Working tree diffs",
      "Local test results",
      "Handoff reports (handoff.md)",
      "progress.md updates",
    ],
    recommendedProvider: "claude",
    recommendedModel: "claude-3-7-sonnet-20250219",
    systemPrompt: WORKER_SYSTEM_PROMPT,
    requiredHandoffSections: [...HANDOFF_COMPONENTS],
    escalationRungs: [
      ROLES_CONSTANTS.ESCALATION_RUNG_1_LOCAL_RETRY,
      ROLES_CONSTANTS.ESCALATION_RUNG_4_WORKER_REPLACEMENT,
    ],
  },

  [COGNITIVE_ROLES.REVIEWER]: {
    role: COGNITIVE_ROLES.REVIEWER,
    tier: ROLES_CONSTANTS.TIER_REVIEWER,
    archetype: ROLES_CONSTANTS.ARCHETYPE_REVIEWER,
    displayName: ROLES_CONSTANTS.DISPLAY_REVIEWER,
    coreResponsibility:
      "Semantic verification, spec fidelity, zero regressions, architectural compliance.",
    permissions: {
      canEditCode: false,
      canRunTests: false,
      canCommitOrPush: false,
      canDispatchSubagents: false,
      canWriteOwnFolder: true,
      holdsBinaryVeto: false,
      allowedWritePatterns: [".agents/teamwork/reviewer*/**"],
      deniedWritePatterns: ["src/**", "test/**", "projects/**", ".git/**"],
      summary:
        "Read all repository files, read git diffs, write review report. No code edit.",
    },
    inputs: [
      "Git diff against baseline",
      "Task acceptance criteria",
      "Architecture specifications",
      "Unit test files",
    ],
    primaryOutputs: [
      "Review verdict (APPROVED / REJECTED)",
      "Line-by-line audit report",
      "Remediation suggestions",
    ],
    recommendedProvider: "claude",
    recommendedModel: "claude-3-7-sonnet-20250219",
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
    requiredHandoffSections: [...HANDOFF_COMPONENTS],
    escalationRungs: [],
  },

  [COGNITIVE_ROLES.CHALLENGER]: {
    role: COGNITIVE_ROLES.CHALLENGER,
    tier: ROLES_CONSTANTS.TIER_CHALLENGER,
    archetype: ROLES_CONSTANTS.ARCHETYPE_CHALLENGER,
    displayName: ROLES_CONSTANTS.DISPLAY_CHALLENGER,
    coreResponsibility:
      "Red-team stress testing, edge-case generation, boundary fuzzing, breaking reproduction authoring.",
    permissions: {
      canEditCode: false,
      canRunTests: true,
      canCommitOrPush: false,
      canDispatchSubagents: false,
      canWriteOwnFolder: true,
      holdsBinaryVeto: false,
      allowedWritePatterns: [
        "test/challenger*.test.ts",
        ".agents/teamwork/challenger*/**",
      ],
      deniedWritePatterns: ["src/**", "projects/**", ".git/**"],
      summary:
        "Read repository files, author test probes, execute test runners. No source code mutation.",
    },
    inputs: [
      "Implemented code & diffs",
      "Task specifications",
      "API schemas & edge boundaries",
    ],
    primaryOutputs: [
      "Challenge verdict (PASSED_NO_BREAK / REPRODUCED_FAILURE)",
      "Executable reproduction test probes",
      "Stress report",
    ],
    recommendedProvider: "claude",
    recommendedModel: "claude-3-7-sonnet-20250219",
    systemPrompt: CHALLENGER_SYSTEM_PROMPT,
    requiredHandoffSections: [...HANDOFF_COMPONENTS],
    escalationRungs: [ROLES_CONSTANTS.ESCALATION_RUNG_2_CHALLENGER_DIAGNOSTIC],
  },

  [COGNITIVE_ROLES.AUDITOR]: {
    role: COGNITIVE_ROLES.AUDITOR,
    tier: ROLES_CONSTANTS.TIER_AUDITOR,
    archetype: ROLES_CONSTANTS.ARCHETYPE_AUDITOR,
    displayName: ROLES_CONSTANTS.DISPLAY_AUDITOR,
    coreResponsibility:
      "Independent binary veto, repository invariant enforcement, layout rule compliance.",
    permissions: {
      canEditCode: false,
      canRunTests: true,
      canCommitOrPush: false,
      canDispatchSubagents: false,
      canWriteOwnFolder: true,
      holdsBinaryVeto: true,
      allowedWritePatterns: [".agents/teamwork/auditor*/**"],
      deniedWritePatterns: ["src/**", "test/**", "projects/**", ".git/**"],
      summary:
        "Run system verification scripts, execute git audit tools. Holds binary veto.",
    },
    inputs: [
      "Working tree state",
      "Full test suite results",
      "System layout invariants",
      "Git commit history",
    ],
    primaryOutputs: [
      "Binary verdict (PASS / FAIL)",
      "Forensic invariant report",
      "Rollback recommendations",
    ],
    recommendedProvider: "antigravity",
    recommendedModel: "gemini-2.0-flash",
    systemPrompt: AUDITOR_SYSTEM_PROMPT,
    requiredHandoffSections: [...HANDOFF_COMPONENTS],
    escalationRungs: [],
  },
};

/**
 * Array of all 7 cognitive roles in canonical hierarchy order (Tier 0 to Tier 6).
 */
export const ALL_COGNITIVE_ROLES: readonly CognitiveRole[] = [
  COGNITIVE_ROLES.SENTINEL,
  COGNITIVE_ROLES.ORCHESTRATOR,
  COGNITIVE_ROLES.EXPLORER,
  COGNITIVE_ROLES.WORKER,
  COGNITIVE_ROLES.REVIEWER,
  COGNITIVE_ROLES.CHALLENGER,
  COGNITIVE_ROLES.AUDITOR,
] as const;

/**
 * The 6 specialized subagent roles dispatched by Orchestrator or Sentinel (Tiers 1 through 6).
 */
export const SPECIALIZED_SUBAGENT_ROLES: readonly CognitiveRole[] = [
  COGNITIVE_ROLES.ORCHESTRATOR,
  COGNITIVE_ROLES.EXPLORER,
  COGNITIVE_ROLES.WORKER,
  COGNITIVE_ROLES.REVIEWER,
  COGNITIVE_ROLES.CHALLENGER,
  COGNITIVE_ROLES.AUDITOR,
] as const;

// ============================================================================
// ROLE VALIDATION & NORMALIZATION UTILITIES
// ============================================================================

/**
 * Type guard checking whether a value is a valid canonical CognitiveRole.
 */
export function isValidRole(role: unknown): role is CognitiveRole {
  if (typeof role !== "string") {
    return false;
  }
  return Object.values(COGNITIVE_ROLES).includes(role as CognitiveRole);
}

/**
 * Type guard checking whether a number is a valid RoleTier (0-6).
 */
export function isValidTier(tier: unknown): tier is RoleTier {
  if (typeof tier !== "number" || !Number.isInteger(tier)) {
    return false;
  }
  return (
    tier >= ROLES_CONSTANTS.TIER_SENTINEL &&
    tier <= ROLES_CONSTANTS.TIER_AUDITOR
  );
}

/**
 * Normalizes any role name, alias, or case-variant into its canonical CognitiveRole.
 * Throws InvalidCognitiveRoleError if the input does not match any recognized role.
 */
export function normalizeRole(roleOrAlias: string): CognitiveRole {
  if (typeof roleOrAlias !== "string") {
    throw new InvalidCognitiveRoleError(
      String(roleOrAlias),
      "Role identifier must be a string."
    );
  }

  const cleaned = roleOrAlias.trim().toLowerCase();
  if (cleaned.length === ROLES_CONSTANTS.ZERO) {
    throw new InvalidCognitiveRoleError(
      roleOrAlias,
      "Role identifier cannot be empty."
    );
  }

  const aliased = ROLE_ALIASES[cleaned];
  if (aliased !== undefined) {
    return aliased;
  }

  throw new InvalidCognitiveRoleError(
    roleOrAlias,
    `Unrecognized role name or alias '${roleOrAlias}'.`
  );
}

/**
 * Retrieves the complete CognitiveRoleDefinition for a role or alias.
 */
export function getRoleDefinition(roleOrAlias: string): CognitiveRoleDefinition {
  const canonical = normalizeRole(roleOrAlias);
  return COGNITIVE_ROLE_MATRIX[canonical];
}

/**
 * Retrieves a role definition by its numeric tier (0 through 6).
 */
export function getRoleByTier(tier: number): CognitiveRoleDefinition | undefined {
  if (!isValidTier(tier)) {
    return undefined;
  }
  for (const role of ALL_COGNITIVE_ROLES) {
    const def = COGNITIVE_ROLE_MATRIX[role];
    if (def.tier === tier) {
      return def;
    }
  }
  return undefined;
}

/**
 * Returns all 7 cognitive role definitions in tier hierarchy order.
 */
export function getAllRoles(): readonly CognitiveRoleDefinition[] {
  return ALL_COGNITIVE_ROLES.map((r) => COGNITIVE_ROLE_MATRIX[r]);
}

/**
 * Returns the 6 specialized subagent role definitions (Tiers 1 to 6).
 */
export function getSpecializedSubagentRoles(): readonly CognitiveRoleDefinition[] {
  return SPECIALIZED_SUBAGENT_ROLES.map((r) => COGNITIVE_ROLE_MATRIX[r]);
}

/**
 * Checks whether a given role is permitted to modify workspace code files.
 */
export function isCodeMutationAllowed(roleOrAlias: string): boolean {
  try {
    const def = getRoleDefinition(roleOrAlias);
    return def.permissions.canEditCode;
  } catch {
    return false;
  }
}

/**
 * Checks whether a given role is permitted to execute test runners.
 */
export function isTestExecutionAllowed(roleOrAlias: string): boolean {
  try {
    const def = getRoleDefinition(roleOrAlias);
    return def.permissions.canRunTests;
  } catch {
    return false;
  }
}

/**
 * Checks whether a given role is authorized to dispatch subagents.
 */
export function canRoleDispatch(roleOrAlias: string): boolean {
  try {
    const def = getRoleDefinition(roleOrAlias);
    return def.permissions.canDispatchSubagents;
  } catch {
    return false;
  }
}

/**
 * Checks whether a given role holds binary veto power over completion.
 */
export function roleHoldsBinaryVeto(roleOrAlias: string): boolean {
  try {
    const def = getRoleDefinition(roleOrAlias);
    return def.permissions.holdsBinaryVeto;
  } catch {
    return false;
  }
}

// ============================================================================
// PATH VALIDATION & WRITE PERMISSION ENFORCEMENT
// ============================================================================

export interface WritePathValidationResult {
  readonly allowed: boolean;
  readonly normalizedPath: string;
  readonly reason?: string;
}

/**
 * Validates whether an agent with the given role is authorized to write to a target file path.
 * Enforces repository layout invariants, sandbox containment, and read-only boundaries.
 */
export function validateWritePath(
  roleOrAlias: string,
  targetPath: string,
  sandboxDir?: string
): WritePathValidationResult {
  let roleDef: CognitiveRoleDefinition;
  try {
    roleDef = getRoleDefinition(roleOrAlias);
  } catch (error) {
    return {
      allowed: false,
      normalizedPath: targetPath,
      reason: error instanceof Error ? error.message : "Invalid cognitive role.",
    };
  }

  if (typeof targetPath !== "string" || targetPath.trim().length === ROLES_CONSTANTS.ZERO) {
    return {
      allowed: false,
      normalizedPath: "",
      reason: "Target path cannot be empty.",
    };
  }

  // Normalize path using standard POSIX/platform semantics
  const normalized = normalize(targetPath).replace(/\\/g, "/");

  // Invariant 1: .git directory is strictly immutable for all agents
  if (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized.includes("/.git/")
  ) {
    return {
      allowed: false,
      normalizedPath: normalized,
      reason: "Direct mutation of .git repository internals is strictly prohibited.",
    };
  }

  // Invariant 2: In-repo skills under .agents/skills/ are immutable at runtime
  if (
    normalized.startsWith(ROLES_CONSTANTS.SKILLS_DIR + "/") ||
    normalized === ROLES_CONSTANTS.SKILLS_DIR
  ) {
    return {
      allowed: false,
      normalizedPath: normalized,
      reason: "In-repo skills under .agents/skills/ are immutable runtime templates.",
    };
  }

  // Check if writing inside the agent's assigned sandbox directory
  if (sandboxDir !== undefined && sandboxDir.trim().length > ROLES_CONSTANTS.ZERO) {
    const normSandbox = normalize(sandboxDir).replace(/\\/g, "/");
    const isInsideSandbox =
      normalized === normSandbox ||
      normalized.startsWith(normSandbox.endsWith("/") ? normSandbox : `${normSandbox}/`);

    if (isInsideSandbox) {
      if (!roleDef.permissions.canWriteOwnFolder) {
        return {
          allowed: false,
          normalizedPath: normalized,
          reason: `Role '${roleDef.role}' is not permitted to write to sandbox folders.`,
        };
      }
      return {
        allowed: true,
        normalizedPath: normalized,
      };
    }
  }

  // Specific role path rules:
  // 1. Worker: Can edit workspace code (src/, test/) and its own teamwork folder
  if (roleDef.role === COGNITIVE_ROLES.WORKER) {
    if (
      normalized.startsWith("src/") ||
      normalized.startsWith("test/") ||
      normalized.startsWith(".agents/teamwork/")
    ) {
      return {
        allowed: true,
        normalizedPath: normalized,
      };
    }
    return {
      allowed: false,
      normalizedPath: normalized,
      reason: `Worker is restricted to modifying 'src/', 'test/', and '.agents/teamwork/'. Attempted write to '${normalized}'.`,
    };
  }

  // 2. Challenger: Can author temporary reproduction test probes under test/challenger*.test.ts
  if (roleDef.role === COGNITIVE_ROLES.CHALLENGER) {
    if (
      normalized.startsWith(ROLES_CONSTANTS.PROBES_PREFIX) &&
      (normalized.endsWith(".test.ts") || normalized.endsWith(".spec.ts"))
    ) {
      return {
        allowed: true,
        normalizedPath: normalized,
      };
    }
    return {
      allowed: false,
      normalizedPath: normalized,
      reason: `Adversarial Challenger can only author test probes matching 'test/challenger*.test.ts'. Attempted write to '${normalized}'.`,
    };
  }

  // 3. Orchestrator: Can update tasks.md and own teamwork folder
  if (roleDef.role === COGNITIVE_ROLES.ORCHESTRATOR) {
    if (
      (normalized.startsWith("openspec/changes/") && normalized.endsWith("tasks.md")) ||
      normalized.startsWith(".agents/teamwork/")
    ) {
      return {
        allowed: true,
        normalizedPath: normalized,
      };
    }
    return {
      allowed: false,
      normalizedPath: normalized,
      reason: `Orchestrator can only modify task plans and teamwork coordination files. Attempted write to '${normalized}'.`,
    };
  }

  // 4. Explorer, Reviewer, Auditor, Sentinel: Read-only outside assigned sandbox
  return {
    allowed: false,
    normalizedPath: normalized,
    reason: `Role '${roleDef.role}' has zero code mutation permissions and cannot write outside its designated sandbox. Attempted write to '${normalized}'.`,
  };
}

// ============================================================================
// DYNAMIC PROMPT BUILDER
// ============================================================================

export interface RolePromptContext {
  /** Identifier of the spawned agent (e.g. worker_1, explorer_003) */
  readonly agentId?: string;
  /** Task identifier (e.g. LOOPER-CORE-003, Task 1.1) */
  readonly taskKey?: string;
  /** High-level task title */
  readonly taskTitle?: string;
  /** Comprehensive task instructions and requirements */
  readonly taskDescription?: string;
  /** Isolated sandbox directory path allocated for this agent */
  readonly workingDirectory?: string;
  /** Assigned in-repo skill names to inject */
  readonly assignedSkills?: readonly string[];
  /** Immutable task-specific constraints */
  readonly constraints?: readonly string[];
  /** Snapshot of previous findings or parent context */
  readonly contextSnapshot?: string;
  /** Specific custom instructions for this session */
  readonly customInstructions?: string;
  /** Git baseline SHA snapshot for rollback isolation */
  readonly baselineSha?: string;
  /** Current retry/iteration attempt */
  readonly iterationCount?: number;
  /** Maximum permitted iterations */
  readonly maxIterations?: number;
}

/**
 * Generates a fully specialized, contextual system prompt for a cognitive role.
 * Incorporates identity, non-negotiable axioms, assigned task context, injected skills,
 * and working directory boundaries.
 */
export function generateRoleSystemPrompt(
  roleOrAlias: string,
  context?: RolePromptContext
): string {
  const roleDef = getRoleDefinition(roleOrAlias);
  const sections: string[] = [roleDef.systemPrompt];

  // Append contextual sections if provided
  if (context !== undefined) {
    const metadataLines: string[] = [];
    if (context.agentId !== undefined) {
      metadataLines.push(`- Agent Identifier: ${context.agentId}`);
    }
    metadataLines.push(`- Assigned Cognitive Role: ${roleDef.displayName}`);
    metadataLines.push(`- Hierarchy Tier: Tier ${roleDef.tier}`);
    if (context.workingDirectory !== undefined) {
      metadataLines.push(`- Isolated Sandbox Directory: ${context.workingDirectory}`);
    }
    if (context.baselineSha !== undefined) {
      metadataLines.push(`- Atomic Git Baseline SHA: ${context.baselineSha}`);
    }
    if (context.iterationCount !== undefined) {
      const max = context.maxIterations !== undefined ? ` / ${context.maxIterations}` : "";
      metadataLines.push(`- Current Iteration Attempt: ${context.iterationCount}${max}`);
    }

    if (metadataLines.length > ROLES_CONSTANTS.ZERO) {
      sections.push(`## 🔒 Active Session Identity\n${metadataLines.join("\n")}`);
    }

    if (context.taskKey !== undefined || context.taskTitle !== undefined) {
      const title = context.taskTitle !== undefined ? `: ${context.taskTitle}` : "";
      const key = context.taskKey ?? "Active Task";
      const taskBody = context.taskDescription !== undefined
        ? `\n\n### Task Specifications & Scope\n${context.taskDescription}`
        : "";
      sections.push(`## Target Task [${key}]${title}${taskBody}`);
    }

    if (context.assignedSkills !== undefined && context.assignedSkills.length > ROLES_CONSTANTS.ZERO) {
      const skillList = context.assignedSkills.map((s) => `- ${s}`).join("\n");
      sections.push(`## Injected Specialized Skills\n${skillList}`);
    }

    if (context.constraints !== undefined && context.constraints.length > ROLES_CONSTANTS.ZERO) {
      const constraintList = context.constraints.map((c) => `- 🔒 ${c}`).join("\n");
      sections.push(`## 🔒 Mandatory Invariants & Constraints\n${constraintList}`);
    }

    if (context.contextSnapshot !== undefined && context.contextSnapshot.trim().length > ROLES_CONSTANTS.ZERO) {
      sections.push(`## Context Snapshot & Prior Handoff\n${context.contextSnapshot}`);
    }

    if (context.customInstructions !== undefined && context.customInstructions.trim().length > ROLES_CONSTANTS.ZERO) {
      sections.push(`## Custom Session Directives\n${context.customInstructions}`);
    }
  }

  // Append standard response protocol
  sections.push(
    `## Execution & Handoff Directive\n` +
      `Operate strictly within your role permissions (${roleDef.permissions.summary}).\n` +
      `Always maintain telemetry in \`progress.md\` and record structured findings in \`handoff.md\` using the 5 mandatory sections: ` +
      `${HANDOFF_COMPONENTS.join(", ")}.`
  );

  return sections.join("\n\n");
}

// ============================================================================
// ANTIGRAVITY TEAMWORK PROTOCOL TEMPLATES
// ============================================================================

export interface BriefingOptions {
  readonly goal?: string;
  readonly constraints?: readonly string[];
  readonly taskKey?: string;
  readonly customSections?: Readonly<Record<string, string>>;
}

/**
 * Formats a standardized BRIEFING.md file under 100 lines conforming to Antigravity Teamwork protocol.
 * Contains append-only locked sections (## 🔒 My Identity, ## 🔒 Key Constraints).
 */
export function formatBriefingContent(
  agentId: string,
  roleOrAlias: string,
  options?: BriefingOptions
): string {
  const roleDef = getRoleDefinition(roleOrAlias);
  const taskKey = options?.taskKey ?? "UNASSIGNED";
  const goal = options?.goal ?? roleDef.coreResponsibility;

  const defaultConstraints = [
    "The Harness and Gates are the Oracle; self-attestation is untrusted.",
    "Zero dirty repository history; never commit or push directly.",
    "Files for content, messages for coordination.",
    `Strict permissions: ${roleDef.permissions.summary}`,
  ];

  const constraints = options?.constraints ?? defaultConstraints;
  const constraintsList = constraints.map((c) => `- 🔒 ${c}`).join("\n");

  const lines = [
    `# Agent Briefing: ${agentId}`,
    "",
    "## 🔒 My Identity",
    `- **Agent ID**: \`${agentId}\``,
    `- **Cognitive Role**: ${roleDef.displayName}`,
    `- **Archetype**: ${roleDef.archetype}`,
    `- **Hierarchy Tier**: Tier ${roleDef.tier}`,
    `- **Assigned Task**: \`${taskKey}\``,
    "",
    "## 🔒 Key Constraints",
    constraintsList,
    "",
    "## Current Objective",
    goal,
    "",
    "## Recent Decisions & Context",
    "- Initialized sandbox workspace.",
    `- Operating under ${roleDef.recommendedProvider} / ${roleDef.recommendedModel}.`,
  ];

  if (options?.customSections !== undefined) {
    for (const [title, body] of Object.entries(options.customSections)) {
      lines.push("", `## ${title}`, body);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Formats an initial timestamped progress.md file for heartbeat telemetry.
 */
export function formatProgressContent(
  agentId: string,
  roleOrAlias: string,
  status: string = "INITIALIZED"
): string {
  const roleDef = getRoleDefinition(roleOrAlias);
  const now = new Date().toISOString();

  return [
    `# Progress Telemetry: ${agentId}`,
    "",
    `- **Role**: ${roleDef.displayName}`,
    `- **Status**: ${status}`,
    `- **Last Visited**: ${now}`,
    `- **Heartbeat Interval**: ${ROLES_CONSTANTS.HEARTBEAT_INTERVAL_MINUTES} minutes`,
    "",
    "## Activity Log",
    `- [${now}] Workspace sandbox initialized for ${agentId}. Status: ${status}.`,
    "",
  ].join("\n");
}

export interface DispatchOptions {
  readonly taskKey?: string;
  readonly prompt?: string;
  readonly targetFiles?: readonly string[];
  readonly skills?: readonly string[];
}

/**
 * Formats a DISPATCH.md manifest file assigned to a newly dispatched subagent.
 */
export function formatDispatchContent(
  agentId: string,
  roleOrAlias: string,
  options?: DispatchOptions
): string {
  const roleDef = getRoleDefinition(roleOrAlias);
  const taskKey = options?.taskKey ?? "UNSPECIFIED";
  const prompt = options?.prompt ?? roleDef.coreResponsibility;
  const files = options?.targetFiles ?? [];
  const skills = options?.skills ?? [];

  const filesSection =
    files.length > ROLES_CONSTANTS.ZERO
      ? files.map((f) => `- \`${f}\``).join("\n")
      : "- (Scope determined by task requirements)";

  const skillsSection =
    skills.length > ROLES_CONSTANTS.ZERO
      ? skills.map((s) => `- \`${s}\``).join("\n")
      : "- (No optional skills injected)";

  return [
    `# Dispatch Manifest: ${agentId}`,
    "",
    `## Role & Archetype`,
    `- **Role**: ${roleDef.displayName}`,
    `- **Tier**: Tier ${roleDef.tier}`,
    `- **Task Key**: \`${taskKey}\``,
    "",
    `## Assigned Mission`,
    prompt,
    "",
    `## Authorized Target Scope`,
    filesSection,
    "",
    `## Injected Skills`,
    skillsSection,
    "",
    `## Allowed Permissions Summary`,
    roleDef.permissions.summary,
    "",
  ].join("\n");
}

export interface HandoffOptions {
  readonly observation?: string;
  readonly logicChain?: string;
  readonly caveats?: string;
  readonly conclusion?: string;
  readonly verificationMethod?: string;
  readonly verdict?: string;
  readonly filesModified?: readonly string[];
}

/**
 * Formats a structured 5-component handoff report (handoff.md) conforming to the specification.
 */
export function formatHandoffTemplate(
  agentId: string,
  roleOrAlias: string,
  options?: HandoffOptions
): string {
  const roleDef = getRoleDefinition(roleOrAlias);
  const verdict = options?.verdict ?? "COMPLETED";
  const obs = options?.observation ?? "Empirical analysis and execution completed.";
  const logic = options?.logicChain ?? "Executed according to specification requirements.";
  const caveats = options?.caveats ?? "No known side effects or regressions detected.";
  const conclusion = options?.conclusion ?? "Task ready for gate verification.";
  const verification = options?.verificationMethod ?? "bun test && bunx tsc --noEmit";

  const lines = [
    `# Handoff Report: ${agentId}`,
    "",
    `- **Author**: ${agentId} (${roleDef.displayName})`,
    `- **Verdict**: \`${verdict}\``,
    `- **Timestamp**: ${new Date().toISOString()}`,
    "",
    "## 1. Observation",
    obs,
    "",
    "## 2. Logic Chain",
    logic,
    "",
    "## 3. Caveats",
    caveats,
    "",
    "## 4. Conclusion",
    conclusion,
    "",
    "## 5. Verification Method",
    verification,
  ];

  if (options?.filesModified !== undefined && options.filesModified.length > ROLES_CONSTANTS.ZERO) {
    lines.push(
      "",
      "## Modified Files",
      ...options.filesModified.map((f) => `- \`${f}\``)
    );
  }

  return lines.join("\n") + "\n";
}
