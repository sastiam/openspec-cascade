# Graph Report - openspec-cascade  (2026-11-16)

## Corpus Check
- Large corpus: 458 files · ~550,661 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3937 nodes · 11002 edges · 170 communities (153 shown, 17 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 537 edges (avg confidence: 0.89)
- Token cost: 1,630,366 input · 0 output

## Community Hubs (Navigation)
- Gate 2 Adversarial Challenger
- Gate 1 Semantic Review
- PAL Canonical Types
- Config Loader & CLI Entry
- PAL MCP & OpenCode Adapter
- Jules Adapter
- Storage Memory & Briefing
- Gate 0 Mechanical QA
- Gemini/Antigravity Adapter
- Catalog Generator
- Claude Adapter Core
- E2E Test Helpers
- GitHub Projects Integration
- M6 Hardening & SDD Specs
- Cascade Facade & Tasks
- Cross-Platform Keep-Alive
- Pre-PR Loop & Greptile
- Adapter Capabilities
- Dispatcher Snapshots
- Gate 3 Audit Runner
- Archify Diagram Sync
- In-Repo Skills Discovery
- GitHub Project Errors
- Catalog Drift Assertions
- DAG Core Graph
- Failure Escalation Core
- Subagent Dispatcher
- Looper FSM Guards
- MCP Tool Bridge
- DAG Concurrent Executor
- Antigravity Engine
- Dynamic Escalation Ladder
- Spec Gate CLI
- Looper Architecture Designs
- PAL Adapter Specs
- Resilient Engine Decorator
- Cognitive Roles
- Orchestrator Succession
- CLI Reference Docs
- Facade & CLI Tests
- OpenSpec Propose Workflow
- Gate 3 Anti-Cheat Scanner
- Tasks-Lint Drift Review
- CLI Commands
- CI Workflow Config
- Facade Session Budget
- V2 Pipeline Harness
- DAG Batch Resolver
- Greptile CLI Client
- Runtime Spawner Base
- Guardrails & Budget
- Engine Test Doubles
- FSM Default Guards
- Engine Adapters (Legacy)
- Greptile Review Cache
- Telemetry Metrics
- Gemini Stream Parsing
- Heartbeat Watchdog
- Antigravity Adapter Options
- OpenCode Engine
- Dispatcher Errors
- Tasks Lint CLI
- FSM Dispatch
- Bun/Node Spawners
- Forensic Audit
- Git Rollback Buffer
- M2 Runtime PAL Design
- FSM Transition Table
- Gate 3 Auditor Checks
- Lint & Package Config
- Victory Livelock Breaker
- Anti-Cheat Rule Engine
- M3 Greptile Design
- EGM Review Reports
- Failure Classifier
- Rollback Audit Logs
- Agnostic Looper Workflow Diagram
- M5 Self-Improving CI Design
- Core Agent Skills
- Installer Script
- Tasks-Lint Review Stages
- Forensic Audit Rules
- Self-Improver
- OpenSpec Sync & Apply Skills
- Cascade Architecture Diagram
- Antigravity Engine Design
- M1 Config Guardrails Design
- Project Inventory & Milestones
- Tasks-Lint Brief & Findings
- Core FSM Proposal
- Escalation Ladder Actions
- FSM Guard Evaluation
- Shadow Commit Manager
- SDD Gate
- README Principles
- M4 Harness Design
- Gate 2/3 Specs
- Well-Architected Config
- Pre-PR Review Skill
- Dependabot Config
- M3 Greptile Error Design
- Harness Injector Specs
- DAG Scheduler Proposal
- Catalog Sync Proposal
- Project Core Components
- Process Control
- SDD Analyze & Surface
- TypeScript Config
- Gate 1 Proposal
- Spec-Gate Archived Hint Design
- Tasks-Lint Spec & Commands
- SDD Constitution & Constants
- PAL Specification
- Runtime Parity Test
- Runtime Process Types
- M1 Config Constants
- Looper Hexagonal Designs
- QA Stage & Diagrams
- Spec-Gate Hint Review
- SDD Gate Hook (CJS)
- Escalation Router Proposal
- Gate 0 Proposal
- Gate 3 Proposal
- Package Scripts
- Project Items Verifier
- Plugin Sync & Hook Rules
- Import Cycle Test
- Lint Tasks Test
- Docs Fast-Track
- PAL Engine Factory Spec
- Router & Dispatcher Designs
- Gate 2 Proposal
- Claude Adapter Proposal
- Spec-Gate & Drift Commands
- Spec-Gate Hint Scenarios
- Plugin Manifest
- Looper Recovery & Handoff
- Schema Validator
- Spec Gate Tests
- Dispatcher Proposal
- Node TS Register Hook
- Looper Master Architecture
- PAL Engine Bridge
- Generated Hook Rules
- PAL Schema & Claude Specs
- Spec Brainstorm & Review
- SDD Verify & Gate 0
- Harness Injector Test
- CI Workflow Test
- No Direct Bun API Test
- Succession & Handoff Spec
- Runtime Dependencies
- FSM & Escalation Concepts
- PAL Provider Concepts
- DAG Snapshot & Validation
- EGM Commands Test
- Watchdog & Jules Polling
- Cascade Looper Workflow
- Package Bin
- Package Engines
- SDD Clarify Skill
- Role Routing Policy
- Looper Shell Script
- Docs Fast-Track Bypass
- Red-Team Injector
- Session Budget Enforcement
- DAG Scheduler Task
- Security Policy

## God Nodes (most connected - your core abstractions)
1. `LooperFSM` - 74 edges
2. `SubagentDispatcher` - 59 edges
3. `PalError` - 55 edges
4. `getDefaultSpawner()` - 55 edges
5. `LooperEvent` - 51 edges
6. `GitHubProjectService` - 50 edges
7. `IPalProvider` - 48 edges
8. `DirectedAcyclicGraph` - 47 edges
9. `PalStreamEvent` - 45 edges
10. `LooperState` - 44 edges

## Surprising Connections (you probably didn't know these)
- `antigravityModelArg()` --implements--> `Requirement: Model and Effort Configuration (gemini-3.8-flash-high default)`  [INFERRED]
  antigravity.ts → openspec/changes/add-antigravity-engine/specs/engine-antigravity/spec.md
- `classifyFailure()` --implements--> `Failure classification fatal / paused / error`  [INFERRED]
  antigravity.ts → openspec/changes/add-antigravity-engine/design.md
- `isDocsOnly()` --semantically_similar_to--> `isFastTrackCandidate()`  [INFERRED] [semantically similar]
  fast_track.ts → src/gates/gate0_policy.ts
- `Docs-only fast-track implementation plan` --references--> `selectVerifyChecks()`  [EXTRACTED]
  docs/superpowers/plans/2026-11-16-docs-only-fast-track.md → fast_track.ts
- `runLintTasks()` --implements--> `lint-tasks subcommand`  [INFERRED]
  src/cli/lint_tasks.ts → docs/cli.md

## Import Cycles
- 2-file cycle: `src/gates/gate3_scanner.ts -> src/gates/gate3_types.ts -> src/gates/gate3_scanner.ts`
- 2-file cycle: `src/gates/gate2_injector.ts -> src/gates/gate2_types.ts -> src/gates/gate2_injector.ts`

## Hyperedges (group relationships)
- **OpenSpec change lifecycle (explore -> propose -> apply -> sync -> archive)** — _agents_skills_openspec_explore_skill_openspec_explore, _agents_skills_openspec_propose_skill_openspec_propose, _agents_skills_openspec_apply_change_skill_openspec_apply_change, _agents_skills_openspec_update_change_skill_openspec_update_change, _agents_skills_openspec_sync_specs_skill_openspec_sync_specs, _agents_skills_openspec_archive_change_skill_openspec_archive_change [INFERRED 0.85]
- **Greptile pre-PR review flow** — project_greptilereviewbridge, project_shadowcommitmanager, project_greptilecache, project_igreptileclient, readme_pre_pr_review [EXTRACTED 1.00]
- **In-repo SDD quality skill catalog** — _agents_skills_sdd_clarify_skill_sdd_clarify, _agents_skills_sdd_constitution_skill_sdd_constitution, _agents_skills_sdd_checklist_skill_sdd_checklist, _agents_skills_sdd_verify_skill_sdd_verify, _agents_skills_pre_pr_review_skill_pre_pr_review, _agents_skills_clean_code_best_practices_skill_clean_code_best_practices, _agents_skills_zero_magic_numbers_audit_skill_zero_magic_numbers_audit [EXTRACTED 1.00]
- **Cascade task execution pipeline (dispatch, verify, commit, record)** — _archify_architecture_openspec_cascade_openspec_cascade_architecture_harness, _archify_architecture_openspec_cascade_openspec_cascade_architecture_engine_claude, _archify_architecture_openspec_cascade_openspec_cascade_architecture_engine_opencode, _archify_architecture_openspec_cascade_openspec_cascade_architecture_engine_antigravity, _archify_architecture_openspec_cascade_openspec_cascade_architecture_verifier, _archify_architecture_openspec_cascade_openspec_cascade_architecture_committer, _archify_architecture_openspec_cascade_openspec_cascade_architecture_tasks_state [EXTRACTED 1.00]
- **Pluggable autonomous AI engines** — _archify_architecture_openspec_cascade_openspec_cascade_architecture_engine_claude, _archify_architecture_openspec_cascade_openspec_cascade_architecture_engine_opencode, _archify_architecture_openspec_cascade_openspec_cascade_architecture_engine_antigravity [EXTRACTED 1.00]
- **Agnostic looper task execution pipeline** — _archify_workflow_agnostic_looper_agnostic_looper_workflow_dag_scheduler, _archify_workflow_agnostic_looper_agnostic_looper_workflow_fsm_engine, _archify_workflow_agnostic_looper_agnostic_looper_workflow_pal_normalizer, _archify_workflow_agnostic_looper_agnostic_looper_workflow_provider_adapter, _archify_workflow_agnostic_looper_agnostic_looper_workflow_subagent_sandbox, _archify_workflow_agnostic_looper_agnostic_looper_workflow_tool_execution, _archify_workflow_agnostic_looper_agnostic_looper_workflow_gate0_qa, _archify_workflow_agnostic_looper_agnostic_looper_workflow_gate3_forensic, _archify_workflow_agnostic_looper_agnostic_looper_workflow_github_sync [EXTRACTED 1.00]
- **Veto, rollback and retry loop** — _archify_workflow_agnostic_looper_agnostic_looper_workflow_gate3_forensic, _archify_workflow_agnostic_looper_agnostic_looper_workflow_rollback_buffer, _archify_workflow_agnostic_looper_agnostic_looper_workflow_subagent_sandbox, _archify_workflow_agnostic_looper_agnostic_looper_workflow_tool_execution, _archify_workflow_agnostic_looper_agnostic_looper_workflow_gate0_qa [EXTRACTED 1.00]
- **OpenSpec opsx workflows sharing store selection and project check** — _agents_workflows_opsx_propose_document, _agents_workflows_opsx_sync_document, _agents_workflows_opsx_update_document, _agents_workflows_opsx_propose_project_check, _agents_workflows_opsx_propose_store_selection [INFERRED 0.85]
- **spec-gate stamp/check marker flow** — src_cli_spec_gate_runspecgate, src_sdd_spec_marker_computechangehash, src_sdd_spec_marker_parsemarker, src_sdd_spec_marker_rendermarker, src_sdd_spec_marker_evaluatestage [EXTRACTED 1.00]
- **tasks-lint EGM review artifacts shaping the design** — openspec_changes_archive_2026_11_16_tasks_lint_brief_document, openspec_changes_archive_2026_11_16_tasks_lint_comprehension_report_document, openspec_changes_archive_2026_11_16_tasks_lint_critic_report_document, openspec_changes_archive_2026_11_16_tasks_lint_design_document [INFERRED 0.85]
- **tasks-lint EGM review pipeline (stages 5-9 and drift)** — openspec_changes_archive_2026_11_16_tasks_lint_zoom_out_report_stage5_zoom_out, openspec_changes_archive_2026_11_16_tasks_lint_intermediate_zoom_out_report_stage8_intermediate_zoom_out, openspec_changes_archive_2026_11_16_tasks_lint_implementation_readiness_report_stage9_implementation_readiness, openspec_changes_archive_2026_11_16_tasks_lint_review_tasks_lint_review, openspec_changes_archive_2026_11_16_tasks_lint_drift_tasks_lint_drift [EXTRACTED 1.00]
- **M2 composed engine stack (spawner, factory, decorators, facade)** — openspec_changes_cascade_m2_runtime_pal_facade_design_ispawner, openspec_changes_cascade_m2_runtime_pal_facade_design_enginefactory, openspec_changes_cascade_m2_runtime_pal_facade_design_resilientenginedecorator, openspec_changes_cascade_m2_runtime_pal_facade_design_telemetrymetricsdecorator, openspec_changes_cascade_m2_runtime_pal_facade_design_cascadefacade [EXTRACTED 1.00]
- **Fail-closed errors mapped to exit code 2** — openspec_changes_cascade_m1_config_guardrails_proposal_configvalidationerror, openspec_changes_cascade_m1_config_guardrails_tasks_budgetexceedederror, openspec_changes_cascade_m1_config_guardrails_tasks_protectedbrancherror, openspec_changes_cascade_m2_runtime_pal_facade_design_cascadefacade [EXTRACTED 1.00]
- **Greptile pre-PR review pipeline (shadow worktree, cache, client, verify)** — openspec_changes_cascade_m3_greptile_integration_proposal_greptilereviewbridge, openspec_changes_cascade_m3_greptile_integration_proposal_shadowcommitmanager, openspec_changes_cascade_m3_greptile_integration_proposal_greptilecache, openspec_changes_cascade_m3_greptile_integration_proposal_greptilecliclient, openspec_changes_cascade_m3_greptile_integration_proposal_verifyreviewfindings [EXTRACTED 1.00]
- **V2 FSM-driven task execution with escalation and rollback** — openspec_changes_cascade_m4_harness_v2_wiring_proposal_v2pipeline, openspec_changes_cascade_m4_harness_v2_wiring_proposal_looperfsm, openspec_changes_cascade_m4_harness_v2_wiring_proposal_gates_0_3, openspec_changes_cascade_m4_harness_v2_wiring_proposal_routefailure, openspec_changes_cascade_m4_harness_v2_wiring_proposal_rollbackstatebuffer, openspec_changes_cascade_m4_harness_v2_wiring_proposal_memorystorage [EXTRACTED 1.00]
- **Telemetry to directives to harness prompt loop** — openspec_changes_cascade_m5_self_improving_ci_proposal_selfimprover, openspec_changes_cascade_m5_self_improving_ci_proposal_remediationdirective, openspec_changes_cascade_m4_harness_v2_wiring_proposal_harnessinjector, openspec_changes_cascade_m4_harness_v2_wiring_proposal_cascadefacade [INFERRED 0.85]
- **M6 adversarial hardening controls** — openspec_changes_cascade_m6_hardening_certification_proposal_change_id_validation, openspec_changes_cascade_m6_hardening_certification_proposal_verify_command_hardening, openspec_changes_cascade_m6_hardening_certification_proposal_forensic_alias_detection, openspec_changes_cascade_m6_hardening_certification_proposal_sdd_path_normalization, openspec_changes_cascade_m6_hardening_certification_proposal_shadowcommitmanager_workingtreediff, openspec_changes_cascade_m6_hardening_certification_proposal_tier5_adversarial_suite [EXTRACTED 1.00]
- **Cascade v2 SDD lifecycle gates** — openspec_changes_cascade_v2_sdd_framework_design_sdd_gate, openspec_changes_cascade_v2_sdd_framework_design_analyze_gate, openspec_changes_cascade_v2_sdd_framework_design_surface_verifier, openspec_changes_cascade_v2_sdd_framework_design_review_verifier [EXTRACTED 1.00]
- **Keep-alive controller mechanisms** — openspec_changes_cross_platform_keep_alive_design_caffeinate, openspec_changes_cross_platform_keep_alive_design_systemd_inhibit, openspec_changes_cross_platform_keep_alive_design_noop_fallback, openspec_changes_cross_platform_keep_alive_design_keepalivecontroller [EXTRACTED 1.00]
- **Looper Verification Gate Pipeline (Gate 0/1/2)** — openspec_changes_looper_gate0_mechanical_qa_proposal_gate0_mechanical_qa_capability, openspec_changes_looper_gate1_semantic_review_proposal_gate1_semantic_review_capability, openspec_changes_looper_gate2_adversarial_challenger_proposal_gate2_adversarial_challenger_capability [INFERRED 0.85]
- **Agnostic Looper Core Engine (FSM, Router, Dispatcher)** — openspec_changes_looper_core_fsm_proposal_core_fsm_capability, openspec_changes_looper_core_router_escalation_proposal_core_router_escalation_capability, openspec_changes_looper_core_subagent_dispatcher_proposal_core_subagent_dispatcher_capability [INFERRED 0.85]
- **Shared design template (hexagonal placement + autonomous verification)** — openspec_changes_looper_core_router_escalation_design_design, openspec_changes_looper_core_subagent_dispatcher_design_design, openspec_changes_looper_gate0_mechanical_qa_design_design, openspec_changes_looper_gate1_semantic_review_design_design, openspec_changes_looper_gate2_adversarial_challenger_design_design [EXTRACTED 1.00]
- **Looper verification gates (adversarial + forensic audit -> project sync)** — openspec_changes_looper_gate2_adversarial_challenger_specs_gate2_adversarial_challenger_spec_adversarial_robustness_testing, openspec_changes_looper_gate3_forensic_audit_specs_gate3_forensic_audit_spec_forensic_integrity_and_veto, openspec_changes_looper_gate3_forensic_audit_tasks_gate3auditor, openspec_changes_looper_integration_github_project_specs_integration_github_project_spec_status_done_after_gate3 [INFERRED 0.85]
- **Provider Abstraction Layer (canonical schema + adapters)** — openspec_changes_looper_pal_canonical_schema_proposal_pal_canonical_schema, src_pal_normalizer, openspec_changes_looper_pal_claude_adapter_proposal_claudeadapter, openspec_changes_looper_pal_claude_adapter_tasks_provideradapter [INFERRED 0.85]
- **GitHub Project #4 synchronization** — openspec_changes_looper_integration_github_project_proposal_githubprojectservice, src_integration_catalog_generator, openspec_changes_looper_integration_catalog_sync_proposal_drift_detector, openspec_changes_looper_integration_catalog_sync_specs_integration_catalog_sync_spec_github_project_4 [INFERRED 0.85]
- **PAL provider adapters implementing ProviderAdapter** — openspec_changes_looper_pal_gemini_adapter_proposal_geminiadapter, openspec_changes_looper_pal_jules_adapter_proposal_julesadapter, openspec_changes_looper_pal_opencode_adapter_proposal_opencodeadapter, openspec_changes_looper_pal_jules_adapter_design_provideradapter [INFERRED 0.85]
- **spec-gate check change resolution flow** — openspec_changes_spec_gate_archived_hint_design_runcheck, openspec_changes_spec_gate_archived_hint_design_change_folder_resolver, openspec_changes_spec_gate_archived_hint_design_changedirof, openspec_changes_spec_gate_archived_hint_design_evaluatestage, openspec_changes_spec_gate_archived_hint_design_openspec_archive [EXTRACTED 1.00]
- **EGM reviewers of spec-gate-archived-hint design** — openspec_changes_spec_gate_archived_hint_comprehension_report_egm_comprehension, openspec_changes_spec_gate_archived_hint_critic_report_egm_design, openspec_changes_spec_gate_archived_hint_critic_report_egm_structural, openspec_changes_spec_gate_archived_hint_critic_report_egm_style [EXTRACTED 1.00]
- **EGM review stages 5-9 consolidated into review.md** — openspec_changes_spec_gate_archived_hint_zoom_out_report, openspec_changes_spec_gate_archived_hint_intermediate_zoom_out_report, openspec_changes_spec_gate_archived_hint_implementation_readiness_report, openspec_changes_spec_gate_archived_hint_review [EXTRACTED 1.00]
- **Change lifecycle: brainstorm, review, run, drift gated by spec-gate** — plugins_cascade_commands_cascade_spec_brainstorm, plugins_cascade_commands_cascade_spec_review, plugins_cascade_commands_cascade, plugins_cascade_commands_cascade_spec_drift, openspec_changes_spec_gate_archived_hint_proposal_spec_gate_capability [INFERRED 0.85]
- **Agent quality standards: no magic numbers, no inline comments, verification suite** — plugins_cascade_agents_cascade_runner, plugins_cascade_skills_openspec_cascade_runner_skill_zero_magic_numbers, plugins_cascade_skills_clean_code_best_practices_skill_zero_inline_comments, plugins_cascade_skills_openspec_cascade_runner_skill_standard_verification_suite [INFERRED 0.85]
- **Objective 4-Tier Verification Gates** — projects_agnostic_looper_specification_gate_0_mechanical_qa, projects_agnostic_looper_specification_gate_1_semantic_review, projects_agnostic_looper_specification_gate_2_adversarial_challenger, projects_agnostic_looper_specification_gate_3_forensic_auditor, projects_agnostic_looper_specification_harness_as_oracle [EXTRACTED 1.00]
- **PAL Turn Normalizer Invariants** — projects_agnostic_looper_specification_palturnnormalizer, projects_agnostic_looper_specification_turn_folding_invariant, projects_agnostic_looper_specification_atomic_tool_batch_invariant, projects_agnostic_looper_specification_formatgeminiresponse, projects_agnostic_looper_specification_thinking_signature_contract [EXTRACTED 1.00]
- **Cascade SDD Skill Flow (clarify, constitution, verify)** — plugins_cascade_skills_sdd_clarify_skill_sdd_clarify, plugins_cascade_skills_sdd_constitution_skill_sdd_constitution, plugins_cascade_skills_sdd_verify_skill_sdd_verify, plugins_cascade_skills_zero_magic_numbers_audit_skill_zero_magic_numbers_audit [INFERRED 0.75]

## Communities (170 total, 17 thin omitted)

### Community 0 - "Gate 2 Adversarial Challenger"
Cohesion: 0.05
Nodes (74): createGate2Challenger(), defaultProbeRunner(), escapeXml(), extractProbeErrorTrace(), formatChallengeReportMarkdown(), formatChallengerPrompt(), Gate2Challenger, Gate2ChallengerError (+66 more)

### Community 1 - "Gate 1 Semantic Review"
Cohesion: 0.06
Nodes (79): classifyFindingPriority(), createPassFeedback(), createRejectionFeedback(), createRevisionFeedback(), escapeXml(), escapeXmlAttr(), formatGate1MarkdownFeedback(), formatGate1WorkerPrompt() (+71 more)

### Community 2 - "PAL Canonical Types"
Cohesion: 0.05
Nodes (72): Tool call and response block normalizers, appendContentBlock(), runOpenCodeSubprocess(), DEFAULT_IMAGE_MIME_TYPE, formatGeminiResponse(), fromClaudeResponse(), fromGeminiResponse(), fromOpenAiResponse() (+64 more)

### Community 3 - "Config Loader & CLI Entry"
Cohesion: 0.06
Nodes (78): main(), runCli(), BUDGET_CONSTANTS, CLI_COMMAND_CONSTANTS, DIAGRAM_CONSTANTS, ENGINE_CONSTANTS, ENGINE_TELEMETRY_CONSTANTS, FORMAT_CONSTANTS (+70 more)

### Community 4 - "PAL MCP & OpenCode Adapter"
Cohesion: 0.06
Nodes (69): GitHub Issue #20 (LOOPER-PAL-001), pal-canonical-schema capability, Turn folding for strict turn alternation, ActiveStreamingToolCall, buildOpenCodeCliArgs(), classifyOpenCodeFailure(), createOpenCodeAdapter(), formatOpenAiToolChoice() (+61 more)

### Community 5 - "Jules Adapter"
Cohesion: 0.05
Nodes (54): buildJulesPrompt(), describeTransitionStatus(), formatJulesPrompt(), isJulesAuthFailure(), isSpawnNotFoundError(), JULES_ADAPTER_CONSTANTS, JULES_AWAITING_INPUT_POLICIES, JULES_BATCH_OUTCOMES (+46 more)

### Community 6 - "Storage Memory & Briefing"
Cohesion: 0.05
Nodes (46): GitHub Issue #28 (LOOPER-INT-001), storage-memory capability, AgentRegistrationOptions, AgentWorkspaceInfo, assertProtectedSectionsPreserved(), extractSignificantLines(), fileExists(), formatHeartbeatContent() (+38 more)

### Community 7 - "Gate 0 Mechanical QA"
Cohesion: 0.09
Nodes (61): escapeXml(), escapeXmlAttr(), formatFailureXml(), formatGate0Feedback(), isInternalPath(), isProjectPath(), normalizeFilePath(), parseGate0Trace() (+53 more)

### Community 8 - "Gemini/Antigravity Adapter"
Cohesion: 0.06
Nodes (53): accumulateNdjsonTokenUsage(), ANTIGRAVITY_RATE_LIMIT_REGEX, ANTIGRAVITY_UNRECOVERABLE_REGEX, AntigravityCliArgsOptions, antigravityEffortArg(), antigravityModelArg(), AntigravitySpawnedProcess, AntigravitySubprocessOptions (+45 more)

### Community 9 - "Catalog Generator"
Cohesion: 0.11
Nodes (57): atomicWriteFile(), CatalogGenerationResult, CatalogMetadata, computeWorkstreamSummaries(), formatCatalogJson(), formatCatalogMarkdown(), generateCatalogFiles(), sortCatalogItems() (+49 more)

### Community 10 - "Claude Adapter Core"
Cohesion: 0.08
Nodes (30): ActiveContentBlock, calculateClaudeTokenUsage(), CLAUDE_ADAPTER_CONSTANTS, ClaudeAdapter, claudePalAdapter, ClaudeStreamChunkParser, ClaudeStreamChunkParserOptions, countCacheBreakpoints() (+22 more)

### Community 11 - "E2E Test Helpers"
Cohesion: 0.10
Nodes (38): createMemoryStorage(), FACADE, buildIsolatedEnv(), buildMergedPath(), CliRunOptions, CliRunResult, executeSubprocess(), INHERITED_ENV_BLOCKLIST (+30 more)

### Community 12 - "GitHub Projects Integration"
Cohesion: 0.05
Nodes (52): Exponential backoff for rate limits and transient errors, GitHub Projects V2 GraphQL API, Typed mutations for Status/Priority/Size, BackoffOptions, calculateExponentialBackoffDelay(), createDefaultGhCliExecutor(), createGitHubProjectService(), executeWithRetry() (+44 more)

### Community 13 - "M6 Hardening & SDD Specs"
Cohesion: 0.05
Nodes (47): Design: Milestone M6, HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN, Change-id validation (CascadeConfigSchema, CHANGE_ID_PATTERN), Docs & scripts update (README.md, docs/cli.md, run_looper.sh), Forensic alias detection (e2e-stub rule), HARDENING_CONSTANTS, Proposal: Milestone M6 Adversarial Hardening, Documentation & Dual-Runtime Certification, SDD path normalization (trailing dots/spaces) (+39 more)

### Community 14 - "Cascade Facade & Tasks"
Cohesion: 0.09
Nodes (42): isNuxtProject(), KeepAliveOptions, tryDetectPackageManager(), formatVerificationFeedback(), runVerificationPhase(), TaskFailureError, V2_PIPELINE_CONSTANTS, RemediationDirective (+34 more)

### Community 15 - "Cross-Platform Keep-Alive"
Cohesion: 0.06
Nodes (45): caffeinate -i -w <pid> (macOS), Design: Cross-Platform Keep-Alive & Engine Integration, KeepAliveController, --no-keep-alive CLI flag, startKeepAlive(), systemd-inhibit (Linux), --engine antigravity / --engine agy flags, Proposal: Cross-Platform Keep-Alive and Engine Integration (+37 more)

### Community 16 - "Pre-PR Loop & Greptile"
Cohesion: 0.07
Nodes (38): GREPTILE_CONSTANTS, PRE_PR_CONSTANTS, PrePrFixer, PrePrLoopOptions, PrePrLoopResult, PrePrReviewSnapshot, PrePrRoundRecord, PrePrStatus (+30 more)

### Community 17 - "Adapter Capabilities"
Cohesion: 0.07
Nodes (14): ClaudeAdapterOptions, GeminiAdapter, GeminiAdapterOptions, calculateOpenAiTokenUsage(), isRecord(), OpenCodeAdapter, OpenCodeSubprocessOptions, parseOpenAiError() (+6 more)

### Community 18 - "Dispatcher Snapshots"
Cohesion: 0.10
Nodes (38): SandboxCleanupOptions, SubagentDispatcherOptions, SubagentLogEntry, SuccessionTriggerEvent, WorkspaceMode, HandoffComponent, RolePermissions, AgentContextSnapshot (+30 more)

### Community 19 - "Gate 3 Audit Runner"
Cohesion: 0.13
Nodes (31): createSubagentDispatcher(), RollbackResult, createGate3Auditor(), defaultGate3CommandRunner(), formatAuditorReportMarkdown(), Gate3AuditorError, Gate3InvariantViolationError, Gate3RollbackError (+23 more)

### Community 20 - "Archify Diagram Sync"
Cohesion: 0.08
Nodes (36): ArchifyTarget, buildArchifyCommand(), BuildArchifyCommandOptions, DiagramStepResult, DiagramSyncOptions, DiagramSyncResult, discoverArchifyTargets(), resolveArchifyBin() (+28 more)

### Community 21 - "In-Repo Skills Discovery"
Cohesion: 0.08
Nodes (39): AGENTS.md / CLAUDE.md project directives, Design: In-Repo Skills & Context Engine, discoverSkills(repoRoot), formatSkillsPrompt(), InRepoSkill, Proposal: In-Repo Skills & Context Engine, Requirement: In-Repo Skill Discovery and Injection, In-Repo Skills Specification (+31 more)

### Community 23 - "Catalog Drift Assertions"
Cohesion: 0.15
Nodes (9): CatalogGeneratorOptions, TaskCatalogGenerator, CatalogTaskItem, CatalogDriftDetector, CatalogDriftReport, DriftDetectionOptions, ProjectV2Item, CatalogValidationReport (+1 more)

### Community 25 - "Failure Escalation Core"
Cohesion: 0.08
Nodes (41): AuditRequirements, buildSuccessionBriefing(), classifyFailure(), DecomposedSubtask, ESCALATION_CONSTANTS, ESCALATION_RUNG_DEFINITIONS, EscalationActionType, EscalationDecision (+33 more)

### Community 26 - "Subagent Dispatcher"
Cohesion: 0.10
Nodes (5): SubagentDispatcher, WritePathValidationResult, CreateHandoffOptions, formatHandoffMarkdown(), SnapshotCaptureOptions

### Community 27 - "Looper FSM Guards"
Cohesion: 0.10
Nodes (9): StandardGuardOptions, TransitionGuardEntry, LooperFSM, LooperFsmOptions, FsmTransitionGuard, FsmTransitionHook, FsmTransitionPayload, LooperState (+1 more)

### Community 28 - "MCP Tool Bridge"
Cohesion: 0.10
Nodes (10): McpToolBridge, PalToolDispatcher, PalToolDispatcherOptions, RegisteredMcpTool, RegisteredTool, PalToolCallContent, PalToolDefinition, PalToolExecutionContext (+2 more)

### Community 29 - "DAG Concurrent Executor"
Cohesion: 0.11
Nodes (3): DagExecutionError, DagLevelBatchResolver, DagNodeNotFoundError

### Community 30 - "Antigravity Engine"
Cohesion: 0.11
Nodes (32): ANTIGRAVITY_DEFAULT_MODEL, antigravityEffortArg(), antigravityModelArg(), AntigravityOutcome, AntigravityTokenUsage, buildAntigravityArgs(), classifyFailure(), describeToolInput() (+24 more)

### Community 31 - "Dynamic Escalation Ladder"
Cohesion: 0.09
Nodes (9): buildRungPromptEnrichment(), createDynamicEscalationLadder(), DynamicEscalationLadder, formatBlockedMarker(), getEscalationRungDefinition(), isForensicAuditRequired(), isPromptEnrichmentRequired(), isRetryEligible() (+1 more)

### Community 32 - "Spec Gate CLI"
Cohesion: 0.13
Nodes (31): EGM + openspec-cascade implementation plan, CliUsageError, consoleOutput, parseChangeNames(), validChangeName(), OPTIONS, parseOptions(), parseStage() (+23 more)

### Community 33 - "Looper Architecture Designs"
Cohesion: 0.06
Nodes (12): Provider-Agnostic Multi-Agent Looper SPECIFICATION.md, LOOPER-GATE-004, Provider-Agnostic Multi-Agent Looper SPECIFICATION.md, LOOPER-INT-003, Provider-Agnostic Multi-Agent Looper SPECIFICATION.md, LOOPER-INT-002, Provider-Agnostic Multi-Agent Looper SPECIFICATION.md, LOOPER-PAL-001 (+4 more)

### Community 34 - "PAL Adapter Specs"
Cohesion: 0.06
Nodes (26): GeminiAdapter, GitHub Issue #22 (LOOPER-PAL-003), pal-gemini-adapter capability, Requirement: Gemini / Antigravity Execution, Jules REST API v1alpha, Jules Session States (QUEUED..COMPLETED, AWAITING_*), JulesAuthError, PalEngineBridge (+18 more)

### Community 35 - "Resilient Engine Decorator"
Cohesion: 0.11
Nodes (12): RESILIENCE_CONSTANTS, EngineType, CircuitState, ResilientEngineDecorator, EngineAdapter, FATAL_PAL_ERROR_KINDS, PalEngineBridgeOptions, PAUSING_PAL_ERROR_KINDS (+4 more)

### Community 36 - "Cognitive Roles"
Cohesion: 0.13
Nodes (31): generateAgentId(), ALL_COGNITIVE_ROLES, BriefingOptions, canRoleDispatch(), COGNITIVE_ROLE_MATRIX, DispatchOptions, formatBriefingContent(), formatDispatchContent() (+23 more)

### Community 37 - "Orchestrator Succession"
Cohesion: 0.07
Nodes (9): buildRollbackCommand(), createOrchestratorSuccessionManager(), evaluateSuccessionBoundary(), generateSuccessorOrchestratorId(), InvalidSuccessionStateError, OrchestratorSuccessionManager, parseOrchestratorGeneration(), SuccessionBoundaryError (+1 more)

### Community 38 - "CLI Reference Docs"
Cohesion: 0.07
Nodes (25): resolveLogDir(), CLI reference and architecture (docs/cli.md), Gates 0-3 (mechanical, review, adversarial, audit), Greptile integration (ShadowCommitManager, cache), ISpawner port (BunSpawner / NodeSpawner), lint-tasks subcommand, Mode v2 FSM pipeline (Analyze, SDD gate, DAG, LooperFSM), review subcommand (Greptile pre-PR loop) (+17 more)

### Community 39 - "Facade & CLI Tests"
Cohesion: 0.11
Nodes (19): dirs, repos, dirs, repos, addOpenSpecChange(), createTempGitRepo(), runGitCommand(), runGitOrThrow() (+11 more)

### Community 40 - "OpenSpec Propose Workflow"
Cohesion: 0.08
Nodes (23): opsx-propose workflow, Store selection (sticky --store flag), Capability retirement (retire_capabilities: true), Delta spec format (ADDED/MODIFIED/REMOVED/RENAMED), opsx-sync workflow, Confirm and apply one artifact at a time, opsx-update workflow, Skill Registry (gentle-ai generated) (+15 more)

### Community 41 - "Gate 3 Anti-Cheat Scanner"
Cohesion: 0.12
Nodes (27): createGate3AntiCheatScanner(), DEFAULT_ANTI_CHEAT_RULES, formatAntiCheatReportMarkdown(), formatAntiCheatReportXml(), parseUnifiedDiff(), ruleAssertionSuppression, ruleCommentedAssertion, ruleDisabledTestSkip (+19 more)

### Community 42 - "Tasks-Lint Drift Review"
Cohesion: 0.11
Nodes (27): FATAL_HEADER, parseChangeNames duplicate removal drift, SpecGateOutput alias of CliOutput, tasks-lint drift report, Preflight at runner single choke point, src/cli/change_args.ts shared CLI helpers, CascadeFacade preflight lint, lint-tasks subcommand (+19 more)

### Community 43 - "CLI Commands"
Cohesion: 0.15
Nodes (21): CliOutput, catalogCommand(), CheckStatus, CliSubcommand, consoleOutput, DoctorCheck, doctorCommand(), driftCommand() (+13 more)

### Community 44 - "CI Workflow Config"
Cohesion: 0.08
Nodes (27): name, runs-on, steps, timeout-minutes, concurrency, cancel-in-progress, group, jobs (+19 more)

### Community 45 - "Facade Session Budget"
Cohesion: 0.21
Nodes (6): selectVerifyChecks(), KeepAliveController, Fatal, enforceSessionBudget(), CascadeFacade, CascadeFacade.runTask

### Community 46 - "V2 Pipeline Harness"
Cohesion: 0.15
Nodes (8): LoadConfigOptions, CascadeConfig, HarnessInjector, buildTaskDag(), EscalationSignal, RetrySignal, V2Pipeline, V2RunHooks

### Community 47 - "DAG Batch Resolver"
Cohesion: 0.12
Nodes (25): assertAcyclic(), createLevelBatchResolver(), DAG_CONSTANTS, DagExecutionResult, DagExecutionSnapshot, DagExecutionSummary, DagLevelBatch, DagNode (+17 more)

### Community 48 - "Greptile CLI Client"
Cohesion: 0.10
Nodes (21): classifyCliFailure(), GreptileCliClient, GreptileCliClientOptions, GreptileError, GreptileErrorKind, GreptileQueryOptions, GreptileReviewOptions, GreptileReviewResult (+13 more)

### Community 49 - "Runtime Spawner Base"
Cohesion: 0.16
Nodes (17): EXIT_CODE_CONSTANTS, defaultBunSpawn(), defaultBunSpawn(), BaseSpawner, detectRuntime(), BunSpawner, NodeSpawner, abortableSleep() (+9 more)

### Community 50 - "Guardrails & Budget"
Cohesion: 0.14
Nodes (20): GUARDRAIL_CONSTANTS, assertBranchSafety(), BudgetExceededError, BudgetScope, defineOwnEnumerableProperty(), evaluateProtectedBranchGuard(), isSensitiveKey(), normalizeMaxDepth() (+12 more)

### Community 51 - "Engine Test Doubles"
Cohesion: 0.14
Nodes (5): EngineOutcome, EngineSessionOptions, ScriptedEngine, WorkingEngine, ScriptedWorker

### Community 52 - "FSM Default Guards"
Cohesion: 0.26
Nodes (22): createDefaultFsmContext(), FSM_ENGINE_CONSTANTS, allTasksDoneGuard, createGate0ExhaustedGuard(), createGate0RetryGuard(), createGate1RejectGuard(), createGate1ReviseGuard(), createGate2BreakGuard() (+14 more)

### Community 53 - "Engine Adapters (Legacy)"
Cohesion: 0.17
Nodes (14): antigravityAdapter, ClaudeAdapter, claudeAdapter, claudeAgentOptions(), readClaudeUsage(), runClaudeSession(), toEpochMs(), engineAdapters (+6 more)

### Community 54 - "Greptile Review Cache"
Cohesion: 0.12
Nodes (15): Gate 2: Adversarial Challenger Red-Teaming, LOOPER-GATE-003 Gate 2 Challenger, CacheEntry, cacheKey(), CacheKeyComponents, CachePolicy, GreptileCache, GreptileCacheError (+7 more)

### Community 55 - "Telemetry Metrics"
Cohesion: 0.14
Nodes (12): computeBackoffDelay(), classifyEngineError(), EngineErrorCategory, extractTokenUsage(), increment(), numericField(), SessionTelemetryRecord, summarizeTelemetry() (+4 more)

### Community 56 - "Gemini Stream Parsing"
Cohesion: 0.13
Nodes (7): GeminiNdjsonReducerState, GeminiStreamChunkParser, parseGeminiStream(), OpenCodeStreamChunkParser, parseOpenAiStream(), PalFinishReason, PalTokenUsage

### Community 58 - "Antigravity Adapter Options"
Cohesion: 0.13
Nodes (11): AntigravityAdapter, AntigravityAdapterOptions, OpenCodeAdapterOptions, ShadowCommitManagerOptions, createClaudeAdapter(), AdapterSpawnOptions, createAdapterSpawnFn(), EngineFactory (+3 more)

### Community 59 - "OpenCode Engine"
Cohesion: 0.13
Nodes (16): classifyFailure(), FAILURE_PATTERNS, Hooks, isRecord(), OPENCODE_DEFAULT_MODEL, OpenCodeAdapter, openCodeModelArg(), OpenCodeOutcome (+8 more)

### Community 60 - "Dispatcher Errors"
Cohesion: 0.12
Nodes (17): AgentFilter, AgentNotFoundError, discoverAvailableSkills(), DISPATCHER_CONSTANTS, DispatcherError, InterAgentMessage, InvalidSubagentStateError, MaxConcurrencyExceededError (+9 more)

### Community 61 - "Tasks Lint CLI"
Cohesion: 0.15
Nodes (19): changeDirOf(), lintChange(), LintTasksOptions, OPTIONS, parseOptions(), runLintTasks(), TASKS_LINT_CONSTANTS, closesFence() (+11 more)

### Community 62 - "FSM Dispatch"
Cohesion: 0.17
Nodes (4): FsmSnapshot, InvalidStateTransitionError, isTerminalState(), LooperFsmContext

### Community 63 - "Bun/Node Spawners"
Cohesion: 0.21
Nodes (13): RUNTIME_PROCESS_CONSTANTS, asStream(), bunRuntime(), BunSubprocessView, spawnFailure(), errorCodeOf(), toWebStream(), emptyByteStream() (+5 more)

### Community 64 - "Forensic Audit"
Cohesion: 0.16
Nodes (19): report, scopeArguments, auditFiles(), auditSource(), callExpressionCalleeName(), collectCommentsFromTrivia(), collectStubAliases(), expandPath() (+11 more)

### Community 65 - "Git Rollback Buffer"
Cohesion: 0.24
Nodes (17): buildGitCleanCommand(), captureGitState(), CaptureGitStateOptions, CommandRunner, CommandRunnerResult, CommitOptions, CommitResult, defaultCommandRunner() (+9 more)

### Community 66 - "M2 Runtime PAL Design"
Cohesion: 0.14
Nodes (20): BunSpawner, EngineFactory / UnifiedEngine, ISpawner port, scripts/node_ts_register.mjs resolve hooks, NodeSpawner, PalEngineBridge, ResilientEngineDecorator, SpawnError (+12 more)

### Community 67 - "FSM Transition Table"
Cohesion: 0.19
Nodes (17): canTransition(), findTransitionRule(), FSM_ALLOWED_EVENTS, FSM_STATE_ADJACENCY, FSM_TRANSITION_MATRIX, FSM_TRANSITION_RULES, getAllowedEvents(), getAllowedNextStates() (+9 more)

### Community 68 - "Gate 3 Auditor Checks"
Cohesion: 0.17
Nodes (9): formatAuditorPrompt(), Gate3Auditor, resolveGate3RecommendedEvent(), verifyGitHygieneInvariant(), verifyLayoutInvariant(), walk(), Gate3AuditorOptions, Gate3ExecutionContext (+1 more)

### Community 69 - "Lint & Package Config"
Cohesion: 0.14
Nodes (16): devDependencies, eslint@^10.13.0, @eslint/js@^10.0.1, @fission-ai/openspec@^1.17.0, @types/bun@1.3.0, typescript@5.9.3, typescript-eslint@^8.72.0, name (+8 more)

### Community 70 - "Victory Livelock Breaker"
Cohesion: 0.14
Nodes (5): CircuitBreakerState, TriageEvaluationResult, VictoryAuditFailureRecord, VictoryAuditLivelockOptions, VictoryAuditLivelockPrevention

### Community 71 - "Anti-Cheat Rule Engine"
Cohesion: 0.25
Nodes (7): Gate3AntiCheatScanner, isProductionFile(), isTestFile(), AntiCheatRule, AntiCheatRuleContext, AntiCheatScanReport, AntiCheatViolation

### Community 72 - "M3 Greptile Design"
Cohesion: 0.15
Nodes (16): Proposal: M3 Greptile CLI Integration, formatGreptileContext, GreptileCache (F12), GreptileReviewBridge (F13), PROJECT.md Greptile interface contract, reviewFilesFromFindings, ShadowCommitManager (F11), verifyReviewFindings (+8 more)

### Community 73 - "EGM Review Reports"
Cohesion: 0.14
Nodes (14): egm-comprehension reviewer, Stage 6: Comprehension Test (spec-gate-archived-hint), CHANGE_ID_PATTERN (allows dots), egm-design reviewer, egm-structural reviewer, egm-style reviewer, Stage 7: Critic Review (spec-gate-archived-hint), changeDirOf (+6 more)

### Community 74 - "Failure Classifier"
Cohesion: 0.14
Nodes (4): buildFailureEnrichedPrompt(), createFailureClassifier(), FailureClassifier, routeFailure()

### Community 76 - "Agnostic Looper Workflow Diagram"
Cohesion: 0.22
Nodes (14): Agent Execution & Sandbox, DAG Scheduler (#17 Topo Sort), Agnostic Looper Autonomous Execution Workflow (Archify diagram), FS Memory (#28 Watchdog), Core FSM (#16 FSM & #19, 16 States), Gate 0-1 QA (#24 QA + #25, Mechanical), Gate 2-3 Audit (#26 + #27, Binary Veto), GitHub Sync (#29 & #30, GitHub Project #4) (+6 more)

### Community 77 - "M5 Self-Improving CI Design"
Cohesion: 0.18
Nodes (12): Stale / Mismatch Review Guard, CascadeFacade, Design: Milestone M5, CI workflow & repo hygiene (F19), CLI subcommands doctor/catalog/drift/review (F18), Proposal: M5 Self-Improving Looper, Pre-PR Loop, Integration CLI & CI, PrePrReviewLoop (F18), RemediationDirective (+4 more)

### Community 78 - "Core Agent Skills"
Cohesion: 0.17
Nodes (12): clean-code-best-practices skill, openspec-cascade-runner skill (agent guidelines v2), Spec-driven artifacts (proposal, specs, design, tasks), sdd-checklist skill, sdd-clarify skill, 6 dimensions of ambiguity, Analyze gate (constitution check), sdd-constitution skill (+4 more)

### Community 79 - "Installer Script"
Cohesion: 0.21
Nodes (14): ARGS, ask(), deriveRepoName(), detectConfigDir(), DRY, hasCli(), HOOK_BUNDLE, log() (+6 more)

### Community 80 - "Tasks-Lint Review Stages"
Cohesion: 0.20
Nodes (14): Facade/e2e tasks.md fixture breakage (B1), Stage 9 Implementation Readiness report, Stage 8 Intermediate Zoom Out report, missing-verify rule, parseTasks CRLF/CR/BOM normalization, tasks-lint consolidated EGM review, tasks-lint review triage dispositions, Requirement: Every unchecked task needs a Verify line (+6 more)

### Community 81 - "Forensic Audit Rules"
Cohesion: 0.18
Nodes (16): AST-driven forensic rules (TypeScript compiler API), e2e-stub rule, explicit-any rule, FORENSIC_AUDIT_SCOPE, inline-body-comment rule, placeholder-implementation rule, auditFiles(paths, options), auditSource(fileName, text, options) (+8 more)

### Community 82 - "Self-Improver"
Cohesion: 0.17
Nodes (9): SELF_IMPROVER_CONSTANTS, categorizeFailure(), FailureCategory, failureSignature(), isRunTelemetry(), normalizeFailureTrace(), RunTelemetry, SelfImprover (+1 more)

### Community 83 - "OpenSpec Sync & Apply Skills"
Cohesion: 0.19
Nodes (12): openspec-apply-change skill, OpenSpec store selection & project root check, Delta spec sync assessment before archive, openspec-archive-change skill, openspec-explore skill, openspec-propose skill, Capability retirement (retire_capabilities), openspec-sync-specs skill (+4 more)

### Community 84 - "Cascade Architecture Diagram"
Cohesion: 0.28
Nodes (12): Autonomous AI Execution Engines, CLI Trigger (caffeinate -i bun run cascade.ts), Git Committer (Conventional Commits & push), OpenSpec Cascade System Architecture Diagram, Antigravity Engine (agy CLI stream-json), Claude Engine (@anthropic-ai/claude-agent-sdk), OpenCode Engine (opencode CLI NDJSON stream), Rate & Usage Guard (plan headroom & rate limits) (+4 more)

### Community 85 - "Antigravity Engine Design"
Cohesion: 0.15
Nodes (13): Engines: claude, opencode, antigravity, jules, ResilientEngineDecorator + TelemetryMetricsDecorator, Design: Antigravity CLI engine integration, agy NDJSON event mapping (init, step_update, result), Failure classification fatal / paused / error, Session resumption via --conversation <id>, Proposal: Add Antigravity CLI engine, Capability: engine-antigravity (+5 more)

### Community 86 - "M1 Config Guardrails Design"
Cohesion: 0.22
Nodes (15): enforceSessionBudget(), evaluateProtectedBranchGuard(), redactSensitiveData(), strictFiniteNumber / strictBoolean preprocessors, CascadeConfigSchema (Zod), ConfigValidationError, Milestone M1 config guardrails proposal, parseCliArgs (strict) (+7 more)

### Community 87 - "Project Inventory & Milestones"
Cohesion: 0.16
Nodes (11): Feature Inventory F01-F20, Milestones M0-M6, openspec-cascade Looper v2 Enhancement, Coverage matrix F01-F20 across Tiers 1-4, E2E Test Infrastructure Architecture, Two-phase delivery gate (Phase A / Phase B), E2E Tier taxonomy (Tiers 1-5), E2E Test Readiness Report (+3 more)

### Community 88 - "Tasks-Lint Brief & Findings"
Cohesion: 0.19
Nodes (8): Brief: lint-tasks (EGM brainstorm), Comprehension report: tasks-lint design, Finding: fence rule underspecified, Critic review report (Stage 7): tasks-lint design, Shared CLI helpers (src/cli/change_args.ts), Design: tasks-lint, Lint rules no-code-block and missing-verify, lintChanges(ctx)

### Community 89 - "Core FSM Proposal"
Cohesion: 0.21
Nodes (13): Capability core-fsm, FSM 16-state types and transition matrix (src/core/fsm_types.ts), GitHub Issue #16 (LOOPER-CORE-001), LooperFSM (src/core/fsm.ts), Proposal: Core FSM and Livelock Prevention, Unit test suite test/core/fsm.test.ts, Requirement: Deterministic FSM Execution, ESCALATED state (circuit breaker) (+5 more)

### Community 90 - "Escalation Ladder Actions"
Cohesion: 0.16
Nodes (4): EscalationBlockedError, EscalationError, InvalidEscalationStateError, InvalidRungTransitionError

### Community 91 - "FSM Guard Evaluation"
Cohesion: 0.23
Nodes (4): RungDefinition, TransitionGuardError, FsmTransitionRule, LooperEvent

### Community 92 - "Shadow Commit Manager"
Cohesion: 0.27
Nodes (4): BranchDiff, ShadowCommitError, ShadowCommitManager, ShadowSnapshot

### Community 93 - "SDD Gate"
Cohesion: 0.23
Nodes (10): evaluateSddGate(), findActiveOpenSpecChange(), isGatedTool(), isProductionSourceFile(), SddGateInput, SddGateResult, dirs, HOOKS (+2 more)

### Community 94 - "README Principles"
Cohesion: 0.17
Nodes (10): HarnessInjector, redactSensitiveData, SelfImprover, Cross-platform keep-alive (caffeinate / systemd-inhibit), In-repo skills & project directives discovery, openspec-cascade README, Plan usage guard (Claude), Self-improvement telemetry & remediation directives (+2 more)

### Community 95 - "M4 Harness Design"
Cohesion: 0.22
Nodes (10): Design: Milestone M4, Gates 0-3 (Gate0MechanicalRunner, Gate1Reviewer, Gate2Challenger, Gate3Auditor), LooperFSM, MemoryStorage, RollbackStateBuffer, routeFailure escalation, V2Pipeline (F15), Spec: V2 Looper Pipeline (+2 more)

### Community 96 - "Gate 2/3 Specs"
Cohesion: 0.18
Nodes (9): Adversarial Robustness Testing (Gate 2), Scenario: candidate crashes on malformed payload, Forensic Integrity and Veto requirement, Scenario: agent commits mock responses in production code, VICTORY CONFIRMED verdict, GitHub Project #4, Local Catalog Maintenance requirement, GitHub Project V2 Synchronization requirement (+1 more)

### Community 97 - "Well-Architected Config"
Cohesion: 0.22
Nodes (11): Design: Centralized Configuration & Engine Adapters, config.ts single source of truth for runtime constants, EngineAdapter interface (runSession, getDefaultModel, supportsPlanMeters), Proposal: Well-Architected Centralized Configuration & Engine Adapters, Centralized Config Specification, Requirement: Typed Centralized Configuration, Tasks: Centralized Configuration & Engine Adapters, cascade-runner agent (+3 more)

### Community 98 - "Pre-PR Review Skill"
Cohesion: 0.18
Nodes (11): Finding triage & bounded fix loop, Fork-point diff resolution (git merge-base), pre-pr-review skill, GreptileCache, GreptileReviewBridge, IGreptileClient, ISpawner (BunSpawner / NodeSpawner), ShadowCommitManager (+3 more)

### Community 99 - "Dependabot Config"
Cohesion: 0.17
Nodes (11): prefix, dependency-type, dev-dependencies, interval, updates, commit-message, directory, groups (+3 more)

### Community 100 - "M3 Greptile Error Design"
Cohesion: 0.21
Nodes (8): PalError (rate_limit/auth/validation mapping), Design: M3 Greptile CLI Integration, Greptile CLI v3, GreptileCliClient (F10), IGreptileClient, ISpawner, Spec: Greptile CLI Client, GreptileError

### Community 101 - "Harness Injector Specs"
Cohesion: 0.21
Nodes (11): Proposal: M4 Harness Injector, Import Hygiene, V2 Pipeline & Plugin Sync, HarnessInjector (F14), Import Hygiene (F14), Plugin Sync (F16), Spec: Harness Injector, Spec: Import Hygiene, Tarjan Static Import Cycle Scan, Tasks: M4 (F14-F16) (+3 more)

### Community 102 - "DAG Scheduler Proposal"
Cohesion: 0.20
Nodes (12): core-dag-scheduler capability, src/core/dag.ts (Kahn's algorithm), GitHub Issue #17 (LOOPER-CORE-002), Proposal: DAG Task Scheduler and Topological Dependency Resolver, CircularDependencyError, Spec Delta: DAG Task Scheduler, Requirement: Topological Dependency Sorting, Task 1.1 DAG structure and topological sort (+4 more)

### Community 103 - "Catalog Sync Proposal"
Cohesion: 0.18
Nodes (9): Drift detector repo vs GitHub Project #4, integration-catalog-sync capability, GitHub Issue #30 (LOOPER-INT-003), Drift detection alerting, Schema validator for mandatory task sections, tasks_catalog.json / tasks_catalog.md, GitHubProjectService, integration-github-project capability (+1 more)

### Community 104 - "Project Core Components"
Cohesion: 0.18
Nodes (12): CascadeConfigSchema, CascadeFacade, EngineFactory, loadConfig (CLI > CASCADE_* env > .openspec-cascade.json > defaults), LooperFSM, ResilientEngineDecorator, RollbackStateBuffer, TelemetryMetricsDecorator (+4 more)

### Community 105 - "Process Control"
Cohesion: 0.23
Nodes (7): isMissingProcessError(), KillOptions, safelyKillProcess(), superviseProcess(), Supervision, SupervisionInput, ProcessSignal

### Community 106 - "SDD Analyze & Surface"
Cohesion: 0.29
Nodes (7): AnalysisFinding, analyzeChangeArtifacts(), extractRequirementsFromSpec(), extractTasks(), classifySurfaces(), SurfaceReport, cleanups

### Community 107 - "TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, erasableSyntaxOnly, module, moduleResolution, noEmit, noUncheckedIndexedAccess, skipLibCheck, strict (+3 more)

### Community 108 - "Gate 1 Proposal"
Cohesion: 0.24
Nodes (11): Objective acceptance-criteria evaluation rubric, Capability gate1-semantic-review, Gate1Reviewer (src/gates/gate1_review.ts), GitHub Issue #25 (LOOPER-GATE-002), Proposal: Gate 1 Semantic Code Reviewer Subagent, Unit test suite test/gates/gate1.test.ts, Requirement: Gate 1 Semantic Review, REVISE verdict with line citations (+3 more)

### Community 109 - "Spec-Gate Archived Hint Design"
Cohesion: 0.25
Nodes (8): Stage 8 Intermediate Zoom Out Report (spec-gate-archived-hint), Proposal: spec-gate-archived-hint, Failure line format <change>: <stage> <reason> (<path>), A4 private resolver in src/cli/spec_gate.ts; read errors mean no archive, Stage 5 Initial Zoom Out Report (spec-gate-archived-hint), IC-5-1 place resolver next to changeDirOf in change_args.ts, IC-5-2 split reader and pure classifier, ZO-5-3 missing vs unreadable archive

### Community 110 - "Tasks-Lint Spec & Commands"
Cohesion: 0.20
Nodes (11): tasks-lint Specification, Task parser and lint agree on LF/CRLF/CR and BOM, lint-tasks subcommand (output, exit codes 0/1/2), Rule no-code-block (fenced code blocks are findings), Preflight lint before any engine session, /cascade command (autonomous task execution), /cascade-looper command (24/7 looper), Git rollback buffer (reset --hard and clean after 3 retries) (+3 more)

### Community 111 - "SDD Constitution & Constants"
Cohesion: 0.18
Nodes (10): Analyze Gate (constitution check), Project Constitution (openspec/project.md), sdd-constitution Skill, EXECUTION_CONSTANTS (config.ts), GATE_CONSTANTS (config.ts), STORAGE_CONSTANTS (config.ts), zero-magic-numbers-audit Skill, Gate 1: Semantic Code Review (+2 more)

### Community 112 - "PAL Specification"
Cohesion: 0.22
Nodes (9): formatGeminiResponse (Protobuf Struct Invariant), IPalProvider (PAL Port), PalError / PalErrorKind Taxonomy, PalMessage / PalContentBlock Canonical Model, PalTurnNormalizer, Extended Thinking Cryptographic Signature Contract, LOOPER-PAL-001 Canonical Schema & Normalizer, LOOPER-PAL-002 Claude Adapter (+1 more)

### Community 113 - "Runtime Parity Test"
Cohesion: 0.20
Nodes (6): CASCADE_ENTRY, createRepoWithChange(), git(), REGISTER_HOOK, ROOT, spawner

### Community 114 - "Runtime Process Types"
Cohesion: 0.27
Nodes (6): collectProcess(), ProcessEnv, SpawnedProcess, SpawnOptions, SpawnResult, StdioMode

### Community 115 - "M1 Config Constants"
Cohesion: 0.24
Nodes (10): Drifting constant reconciliation, Lazy CLI config loading in cascade.ts, hasLockfile / tryDetectPackageManager stack detection, Modular src/config package with config.ts facade, EXIT_CODE_CONSTANTS, Requirement: Centralized Immutable Constants Registry, Requirement: Layered Dynamic Stack Configuration Loader and Lazy CLI Entrypoint, assertNonEmptyExplicitString() (+2 more)

### Community 116 - "Looper Hexagonal Designs"
Cohesion: 0.24
Nodes (4): projects/agnostic_looper/SPECIFICATION.md (LOOPER-CORE-002), Design: DAG Task Scheduler and Topological Dependency Resolver, projects/agnostic_looper/SPECIFICATION.md (LOOPER-CORE-001), Design: Central Engine FSM and Livelock Prevention

### Community 117 - "QA Stage & Diagrams"
Cohesion: 0.20
Nodes (7): .agents/teamwork/ directory tree, Requirement: State Scaffolding and Atomic Writes, runVerificationPhase, Requirement: Autonomous QA Verification with Feedback Loop, Requirement: 24/7 Failure Resilience and Git Rollback State Buffer, Resilient Mode (--resilient / CASCADE_RESILIENT), QA Stage, Auto-Diagrams & 24/7 Resilience Tasks

### Community 118 - "Spec-Gate Hint Review"
Cohesion: 0.29
Nodes (9): Stage 9 Implementation Readiness Report (spec-gate-archived-hint), CD-9-5 strip anchored date prefix and compare as string, IR-9-3 red-test Verify cannot be judged mechanically, Review: spec-gate-archived-hint (EGM consolidated), A1 keep every backticked Verify command green; merge red-test into implementation task, A2 archive match by anchored YYYY-MM-DD- prefix, plain string, directories only, Tasks: spec-gate-archived-hint, Task 2.1 update docs/cli.md spec-gate reasons (+1 more)

### Community 119 - "SDD Gate Hook (CJS)"
Cohesion: 0.31
Nodes (9): evaluate(), findActiveChange(), fs, isProductionSourceFile(), loadRules(), main(), path, RULES_FILE (+1 more)

### Community 120 - "Escalation Router Proposal"
Cohesion: 0.33
Nodes (8): 6-rung escalation ladder (src/core/escalation.ts), Capability core-router-escalation, GitHub Issue #19 (LOOPER-CORE-004), Proposal: Autonomous Router, 6-Rung Escalation Ladder and Succession, Unit test suite test/core/escalation.test.ts, Requirement: Context Succession and Escalation, Spec Delta: Autonomous Router, 6-Rung Escalation Ladder and Succession, Tasks: Autonomous Router, 6-Rung Escalation Ladder and Succession

### Community 121 - "Gate 0 Proposal"
Cohesion: 0.31
Nodes (9): Capability gate0-mechanical-qa, Gate 0 QA oracle (src/gates/gate0_qa.ts), GitHub Issue #24 (LOOPER-GATE-001), Proposal: Gate 0 Mechanical QA Runner and Trace Formatter, Unit test suite test/gates/gate0.test.ts, XML-formatted error trace feedback (tsc, bun test, ESLint), Requirement: Gate 0 Oracle Verification, Spec Delta: Gate 0 Mechanical QA Runner and Trace Formatter (+1 more)

### Community 122 - "Gate 3 Proposal"
Cohesion: 0.25
Nodes (7): Atomic Git rollback buffer with pre-execution snapshot, Anti-cheat detectors (empty stubs, excessive mocks, test omission), gate3-forensic-audit capability, GitHub Issue #27 (LOOPER-GATE-004), Anti-cheat scanners (placeholders, disabled assertions, mocked suites), Gate3Auditor (binary veto), Rollback via git reset --hard & git clean -fd preserving audit logs

### Community 123 - "Package Scripts"
Cohesion: 0.22
Nodes (9): scripts, audit, cascade:looper, install:claude, lint, start, test, test:node (+1 more)

### Community 124 - "Project Items Verifier"
Cohesion: 0.31
Nodes (7): CatalogTaskEntry, extractTaskKey(), fetchProjectItems(), ProjectItem, runVerification(), validateItem(), ValidationResult

### Community 125 - "Plugin Sync & Hook Rules"
Cohesion: 0.25
Nodes (7): checkOnly, expected, target, HARDENING_CONSTANTS, buildSddHookRules(), SDD_HOOK_CONSTANTS, SddHookRules

### Community 126 - "Import Cycle Test"
Cohesion: 0.28
Nodes (7): ALLOWED_TYPE_ONLY_EDGES, buildGraph(), Edge, isTypeOnlyImport(), resolveSpecifier(), ROOT, sourceFiles()

### Community 127 - "Lint Tasks Test"
Cohesion: 0.22
Nodes (6): CLEAN, dirs, lint(), NO_VERIFY, OLD_STYLE, WITH_FENCE

### Community 128 - "Docs Fast-Track"
Cohesion: 0.25
Nodes (5): Docs fast-track (skip typecheck/test/build for docs-only), Mode v1 sequential task loop, Docs-only fast-track implementation plan, Piece 0: docs fast-track in runTask, Docs-only fast-track design (port v2 to v1)

### Community 129 - "PAL Engine Factory Spec"
Cohesion: 0.32
Nodes (8): ConfigValidationError (exit 2), Spec: PAL Engine Factory, EngineAdapter contract, EngineFactory.create, IPalProvider, Jules Headless Authentication (looper-pal-jules-adapter), PalEngineBridge, UnifiedEngine

### Community 130 - "Router & Dispatcher Designs"
Cohesion: 0.54
Nodes (6): Provider-Agnostic Multi-Agent Looper SPECIFICATION.md, Design: Autonomous Router, 6-Rung Escalation Ladder and Succession, Design: Cognitive Role Dispatcher and Sandbox Manager, Design: Gate 0 Mechanical QA Runner and Trace Formatter, Design: Gate 1 Semantic Code Reviewer Subagent, Design: Gate 2 Fuzzing and Red-Team Adversarial Challenger

### Community 131 - "Gate 2 Proposal"
Cohesion: 0.36
Nodes (8): Cognitive roles (Explorer, Worker, Challenger, Auditor), Capability gate2-adversarial-challenger, Gate2Challenger (src/gates/gate2_challenger.ts), GitHub Issue #26 (LOOPER-GATE-003), Proposal: Gate 2 Fuzzing and Red-Team Adversarial Challenger, Unit test suite test/gates/gate2.test.ts, Automated edge-case synthesis (nulls, boundaries, concurrency, timeouts), Tasks: Gate 2 Fuzzing and Red-Team Adversarial Challenger

### Community 132 - "Claude Adapter Proposal"
Cohesion: 0.29
Nodes (6): ClaudeAdapter, GitHub Issue #21 (LOOPER-PAL-002), pal-claude-adapter capability, Prompt caching and extended thinking tokens, ProviderAdapter interface, Streaming chunk parser for Anthropic content blocks

### Community 133 - "Spec-Gate & Drift Commands"
Cohesion: 0.29
Nodes (8): spec-gate capability (check and stamp gate), Spec Delta: spec-gate, /cascade-spec-drift command, drift.md report (No drift detected or divergences), spec-gate stamp open/resolved with change hash, pre-pr-review skill, Finding triage and bounded fix loops (max 2 rounds), Stale cache-hit guard and fork-point diff

### Community 134 - "Spec-Gate Hint Scenarios"
Cohesion: 0.25
Nodes (7): Scenario: Archived change (and archived more than once), Requirement: Check explains a change folder that does not exist, Scenario: Existing change is unaffected, Scenario: No change folder (incl. shared suffix and dotted name), Task 1.1 test-first then implement archived/no-folder check, clean-code-best-practices skill, Error handling taxonomy (typed errors, recoverable vs fatal)

### Community 135 - "Plugin Manifest"
Cohesion: 0.25
Nodes (7): author, name, description, keywords, name, $schema, version

### Community 136 - "Looper Recovery & Handoff"
Cohesion: 0.36
Nodes (7): Idempotent Crash Recovery & Heartbeat Watchdog, File-Based Memory Hierarchy (.agents/teamwork/), 5-Component Handoff Protocol, Gate 3: Forensic Auditor Binary Veto, RollbackStateBuffer (resilience.ts), LOOPER-GATE-004 Gate 3 Forensic Auditor & Rollback Buffer, LOOPER-INT-001 Memory Hierarchy & Heartbeat Watchdog

### Community 138 - "Spec Gate Tests"
Cohesion: 0.33
Nodes (5): OK(), detectSubcommand(), capture(), dirs, stamp()

### Community 139 - "Dispatcher Proposal"
Cohesion: 0.52
Nodes (7): Cognitive role matrix (src/core/roles.ts), Capability core-subagent-dispatcher, GitHub Issue #18 (LOOPER-CORE-003), Proposal: Cognitive Role Dispatcher and Sandbox Manager, SubagentDispatcher (src/core/dispatcher.ts), Unit test suite test/core/dispatcher.test.ts, Tasks: Cognitive Role Dispatcher and Sandbox Manager

### Community 140 - "Node TS Register Hook"
Cohesion: 0.33
Nodes (4): isRelativeSpecifier(), MODULE_NOT_FOUND_CODES, resolve(), TS_CANDIDATE_SUFFIXES

### Community 141 - "Looper Master Architecture"
Cohesion: 0.33
Nodes (7): Agnostic Looper Master Architecture Specification, Antigravity Teamwork (inspiration), GitHub Project #4 Governance (4 Spanish Sections), LOOPER-INT-002 GitHub Project #4 Service, LOOPER-INT-003 Catalog Generator & Sync, LOOPER-INT-004 Structural Validation Harness & CLI, Agnostic Looper Task Catalog (16 tasks)

### Community 143 - "Generated Hook Rules"
Cohesion: 0.33
Nodes (5): SDD_CONSTANTS, sdd_gate.mjs / sdd_gate.cjs hooks, sdd_rules.json, bin/install.mjs hook bundle verification, Spec: Plugin and Hook Synchronization

### Community 144 - "PAL Schema & Claude Specs"
Cohesion: 0.40
Nodes (4): Canonical Schema Normalization requirement, Preservation of cryptographic thought signatures & reasoning blocks, Claude Provider Interoperability requirement, Thinking tokens accumulated separately from completion tokens

### Community 145 - "Spec Brainstorm & Review"
Cohesion: 0.40
Nodes (6): /cascade-spec-brainstorm command, brief.md (agreed direction inside the change), /cascade-spec-review command, EGM Goldfish fresh-context review, sdd-checklist skill (requirements quality rubric), Quality dimensions: completeness, clarity, consistency, testability

### Community 146 - "SDD Verify & Gate 0"
Cohesion: 0.33
Nodes (5): sdd-verify Skill (Surface-Aware Verification), Surface Classification (Frontend / Backend API / Internal Engine), Gate 0: Mechanical QA, qa.ts (runVerificationPhase), LOOPER-GATE-001 Gate 0 QA Runner

### Community 147 - "Harness Injector Test"
Cohesion: 0.33
Nodes (3): HARNESS_CONSTANTS, HarnessInput, dirs

### Community 148 - "CI Workflow Test"
Cohesion: 0.33
Nodes (4): ACTIVE, ROOT, TEMPLATE, workflow

### Community 149 - "No Direct Bun API Test"
Cohesion: 0.33
Nodes (4): ALLOWED, FORBIDDEN_MEMBERS, productionFiles(), ROOT

### Community 150 - "Succession & Handoff Spec"
Cohesion: 0.40
Nodes (5): Succession snapshot, Spec Delta: Cognitive Role Dispatcher and Sandbox Manager, Structured handoff report, Requirement: Subagent Sandboxing, Context snapshotting and handoff payload generator

### Community 151 - "Runtime Dependencies"
Cohesion: 0.40
Nodes (5): dependencies, @anthropic-ai/claude-agent-sdk@0.3.309, zod@^4.6.7, @anthropic-ai/claude-agent-sdk, zod

### Community 152 - "FSM & Escalation Concepts"
Cohesion: 0.50
Nodes (3): 6-Rung Dynamic Escalation Ladder, Event-Driven Looper FSM, LOOPER-CORE-004 Router, Escalation Ladder & Succession

### Community 153 - "PAL Provider Concepts"
Cohesion: 0.60
Nodes (5): MCP Bridge, Provider Abstraction Layer (Hexagonal Ports & Adapters), ReAct Fallback Engine & Truncation Watchdog (JsonAutoRepair), Token Bucket Rate Limiter & FIFO Ticket Semaphore, LOOPER-PAL-004 OpenCode Adapter, MCP Bridge, ReAct & JSON Repair

### Community 155 - "EGM Commands Test"
Cohesion: 0.40
Nodes (3): COMMANDS, COMMANDS_DIR, EgmCommand

### Community 157 - "Cascade Looper Workflow"
Cohesion: 0.50
Nodes (3): CHANGES, meta, REPO

### Community 158 - "Package Bin"
Cohesion: 0.67
Nodes (3): bin, cascade-install, openspec-cascade

### Community 159 - "Package Engines"
Cohesion: 0.67
Nodes (3): engines, bun, node

### Community 161 - "Role Routing Policy"
Cohesion: 0.67
Nodes (3): CognitiveRole Specialization Matrix, TaskRoutingPolicy / Autonomous Task Router, LOOPER-CORE-003 Role Dispatcher & Sandboxes

## Ambiguous Edges - Review These
- `CascadeConfigSchema` → `Constants namespaces (EXECUTION/STORAGE/GATE_CONSTANTS)`  [AMBIGUOUS]
  .agents/skills/zero-magic-numbers-audit/SKILL.md · relation: conceptually_related_to
- `enforceSessionBudget()` → `ResilientEngineDecorator`  [AMBIGUOUS]
  openspec/changes/cascade-m2-runtime-pal-facade/design.md · relation: conceptually_related_to
- `Tier 5 Uses Production Code Only` → `startKeepAlive()`  [AMBIGUOUS]
  openspec/changes/cascade-m6-hardening-certification/design.md · relation: conceptually_related_to
- `Idempotent Crash Recovery & Heartbeat Watchdog` → `LOOPER-INT-001 Memory Hierarchy & Heartbeat Watchdog`  [AMBIGUOUS]
  projects/agnostic_looper/tasks_catalog.md · relation: conceptually_related_to

## Knowledge Gaps
- **169 isolated node(s):** `enforceSessionBudget`, `redactSensitiveData`, `ISpawner (BunSpawner / NodeSpawner)`, `ResilientEngineDecorator`, `TelemetryMetricsDecorator` (+164 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 930 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LooperFSM` connect `Looper FSM Guards` to `FSM Transition Table`, `Victory Livelock Breaker`, `SDD Analyze & Surface`, `Cascade Facade & Tasks`, `V2 Pipeline Harness`, `FSM Default Guards`, `FSM Guard Evaluation`, `FSM Dispatch`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `enforceSessionBudget`, `redactSensitiveData`, `ISpawner (BunSpawner / NodeSpawner)` to the rest of the system?**
  _169 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Gate 2 Adversarial Challenger` be split into smaller, more focused modules?**
  _Cohesion score 0.05247465712581992 - nodes in this community are weakly interconnected._
- **Why does `IPalProvider` connect `Resilient Engine Decorator` to `Gate 2 Adversarial Challenger`, `Gate 1 Semantic Review`, `PAL Canonical Types`, `Gate 3 Auditor Checks`, `PAL MCP & OpenCode Adapter`, `Facade & CLI Tests`, `Gemini/Antigravity Adapter`, `Claude Adapter Core`, `PAL Engine Bridge`, `Gate 3 Audit Runner`, `Engine Test Doubles`, `Engine Adapters (Legacy)`, `Telemetry Metrics`, `Antigravity Adapter Options`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Should `Gate 1 Semantic Review` be split into smaller, more focused modules?**
  _Cohesion score 0.055523199378761406 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `CascadeConfigSchema` and `Constants namespaces (EXECUTION/STORAGE/GATE_CONSTANTS)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `enforceSessionBudget()` and `ResilientEngineDecorator`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._