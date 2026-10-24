# Graph Report - openspec-cascade  (2026-10-23)

## Corpus Check
- 66 files · ~120,501 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .lock 1)

## Summary
- 431 nodes · 793 edges · 36 communities (26 shown, 10 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7a797816`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- cascade.ts
- engine.ts
- ADDED Requirements
- package.json
- openspec-explore/SKILL.md
- opsx-explore.md
- compilerOptions
- Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`)
- Decisions
- platform.ts
- Proposal: Add Antigravity CLI Engine
- openspec-cascade
- skills.ts
- qa.ts
- antigravity.ts
- config.ts
- Decisions
- OpenSpec Cascade Agent Guidelines & Quality Standards
- Requirement: Cross-Platform Process Keep-Alive
- Proposal: Cross-Platform Keep-Alive and Engine Integration
- Proposal: In-Repo Skills & Context Engine
- ADDED Requirements
- Design: Centralized Configuration & Engine Adapters
- ADDED Requirements
- ADDED Requirements
- Design: QA Stage, Auto-Diagrams & 24/7 Resilience

## God Nodes (most connected - your core abstractions)
1. `runTask()` - 20 edges
2. `EngineAdapter` - 19 edges
3. `CONSTANTS` - 14 edges
4. `RollbackStateBuffer` - 13 edges
5. `startKeepAlive()` - 12 edges
6. `log()` - 11 edges
7. `say()` - 10 edges
8. `runSession()` - 10 edges
9. `taskPrompt()` - 10 edges
10. `runChange()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Goals / Non-Goals` --references--> `runAntigravitySession()`  [INFERRED]
  openspec/changes/add-antigravity-engine/design.md → antigravity.ts
- `1. Principios de Diseño` --references--> `main()`  [INFERRED]
  docs/cli.md → cascade.ts
- `2. Clean Code & Well-Architected Principles` --references--> `EngineAdapter`  [INFERRED]
  .agents/skills/openspec-cascade-runner/SKILL.md → engine.ts
- `Decisions` --references--> `EngineAdapter`  [INFERRED]
  openspec/changes/well-architecture-config/design.md → engine.ts
- `2. Lifecycle & Signal Hooks` --references--> `startKeepAlive()`  [INFERRED]
  openspec/changes/cross-platform-keep-alive/design.md → platform.ts

## Import Cycles
- None detected.

## Communities (36 total, 10 thin omitted)

### Community 0 - "cascade.ts"
Cohesion: 0.09
Nodes (48): blockedReason(), blockingMeters(), commit(), commitsPerSection(), commitTypeOf(), config, isLastOfSection(), log() (+40 more)

### Community 1 - "engine.ts"
Cohesion: 0.08
Nodes (33): claudeAdapter, claudeAgentOptions(), readClaudeUsage(), runClaudeSession(), toEpochMs(), CascadeConfig, CONSTANTS, EngineType (+25 more)

### Community 2 - "ADDED Requirements"
Cohesion: 0.12
Nodes (16): ADDED Requirements, Purpose, Requirement: Engine Selection, Requirement: Event Stream Processing and Progress Logging, Requirement: Model and Effort Configuration, Requirement: Session Execution and Streaming, Scenario: Custom model and effort override, Scenario: Default model selection (+8 more)

### Community 3 - "package.json"
Cohesion: 0.08
Nodes (21): dependencies, @anthropic-ai/claude-agent-sdk, devDependencies, eslint, @eslint/js, @types/bun, typescript, typescript-eslint (+13 more)

### Community 4 - "openspec-explore/SKILL.md"
Cohesion: 0.17
Nodes (11): Check for context, Ending Discovery, Guardrails, Handling Different Entry Points, OpenSpec Awareness, Planning a Change, The Stance, What You Don't Have To Do (+3 more)

### Community 5 - "opsx-explore.md"
Cohesion: 0.18
Nodes (10): Check for context, Ending Discovery, Guardrails, OpenSpec Awareness, Planning a Change, The Stance, What You Don't Have To Do, What You Might Do (+2 more)

### Community 6 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, module, moduleResolution, noEmit, noUncheckedIndexedAccess, skipLibCheck, strict, target (+2 more)

### Community 7 - "Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`)"
Cohesion: 0.22
Nodes (7): 1. Principios de Diseño, 2. Diagrama de Flujo y Arquitectura, 4. Referencia de Flags y Opciones, 6. Personalización para otros Proyectos, Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`), Documentación de OpenSpec Cascade, Índice

### Community 8 - "Decisions"
Cohesion: 0.20
Nodes (9): 1. Module Structure: `antigravity.ts`, 2. Event Stream Mapping, 3. Session Resumption, 4. Error and Rate Limit Classification, Context, Decisions, Design: Antigravity CLI Engine Integration, Goals / Non-Goals (+1 more)

### Community 9 - "platform.ts"
Cohesion: 0.12
Nodes (26): attachSignalHandlers(), buildKeepAliveArgs(), CAFFEINATE_BIN, CAFFEINATE_FLAG_IDLE, CAFFEINATE_FLAG_WAIT_PID, canRunSystemdInhibit(), DEFAULT_SYSTEMD_INHIBIT_PATH, EXIT_CODE_SIGINT (+18 more)

### Community 10 - "Proposal: Add Antigravity CLI Engine"
Cohesion: 0.25
Nodes (7): Capabilities, Impact, Modified Capabilities, New Capabilities, Proposal: Add Antigravity CLI Engine, What Changes, Why

### Community 11 - "openspec-cascade"
Cohesion: 0.25
Nodes (7): Adapting it, Cross-platform keep-alive, How it works, Known limits, openspec-cascade, Requirements, Tests

### Community 22 - "skills.ts"
Cohesion: 0.09
Nodes (30): taskPrompt(), ArchifyTarget, buildArchifyCommand(), BuildArchifyCommandOptions, discoverArchifyTargets(), resolveArchifyBin(), syncDiagrams(), 1. Skill Discovery & Data Model (+22 more)

### Community 23 - "qa.ts"
Cohesion: 0.14
Nodes (15): QA_VERIFY_COMMANDS, Definition of Done, Proposal: QA Verification Stage, Auto-Diagrams & 24/7 Resilience, What Changes, Why, 1. QA Stage, Auto-Diagrams & 24/7 Resilience, Tasks, CommandRunnerResult (+7 more)

### Community 24 - "antigravity.ts"
Cohesion: 0.13
Nodes (21): ANTIGRAVITY_DEFAULT_MODEL, antigravityAdapter, antigravityEffortArg(), antigravityModelArg(), AntigravityOutcome, AntigravityTokenUsage, buildAntigravityArgs(), classifyFailure() (+13 more)

### Community 25 - "config.ts"
Cohesion: 0.29
Nodes (10): FULL_VERIFY, getDefaultConfig(), isKeepAliveEnabled(), loadConfig(), LoadConfigOptions, parseBoolean(), parseCliArgs(), ParsedCliOptions (+2 more)

### Community 26 - "Decisions"
Cohesion: 0.15
Nodes (10): 1. `KeepAliveController` Abstraction (`platform.ts`), 2. Lifecycle & Signal Hooks, 3. CLI Integration in `cascade.ts`, 4. Cross-Platform Path Normalization, Context, Decisions, Design: Cross-Platform Keep-Alive & Engine Integration, 1. Platform Keep-Alive Implementation (+2 more)

### Community 27 - "OpenSpec Cascade Agent Guidelines & Quality Standards"
Cohesion: 0.29
Nodes (6): 1. Planning & Conceptual Understanding First, 2. Clean Code & Well-Architected Principles, 3. In-Repo Skills & Directives Compliance, 4. Cross-Platform Safety (macOS & Linux), 5. Autonomous QA Stage & Self-Verification, OpenSpec Cascade Agent Guidelines & Quality Standards

### Community 28 - "Requirement: Cross-Platform Process Keep-Alive"
Cohesion: 0.33
Nodes (5): ADDED Requirements, Platform Runner Specification, Requirement: Cross-Platform Process Keep-Alive, Scenario: Running cascade on Linux, Scenario: Running cascade on macOS

### Community 29 - "Proposal: Cross-Platform Keep-Alive and Engine Integration"
Cohesion: 0.40
Nodes (4): Definition of Done, Proposal: Cross-Platform Keep-Alive and Engine Integration, What Changes, Why

### Community 30 - "Proposal: In-Repo Skills & Context Engine"
Cohesion: 0.40
Nodes (4): Definition of Done, Proposal: In-Repo Skills & Context Engine, What Changes, Why

### Community 31 - "ADDED Requirements"
Cohesion: 0.40
Nodes (4): ADDED Requirements, In-Repo Skills Specification, Requirement: In-Repo Skill Discovery and Injection, Scenario: Session initialization

### Community 32 - "Design: Centralized Configuration & Engine Adapters"
Cohesion: 0.50
Nodes (3): Context, Decisions, Design: Centralized Configuration & Engine Adapters

### Community 33 - "ADDED Requirements"
Cohesion: 0.25
Nodes (7): ADDED Requirements, QA Verification Stage Specification, Requirement: 24/7 Failure Resilience and Git Rollback State Buffer, Requirement: Autonomous QA Verification with Feedback Loop, Scenario: Resilient 24/7 autonomous mode, Scenario: Task exhausts maximum attempts, Scenario: Verification failure

### Community 34 - "ADDED Requirements"
Cohesion: 0.40
Nodes (4): ADDED Requirements, Centralized Config Specification, Requirement: Typed Centralized Configuration, Scenario: Config loading

### Community 35 - "Design: QA Stage, Auto-Diagrams & 24/7 Resilience"
Cohesion: 0.50
Nodes (3): Context, Decisions, Design: QA Stage, Auto-Diagrams & 24/7 Resilience

## Knowledge Gaps
- **3 isolated node(s):** `@eslint/js`, `@types/bun`, `typescript`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 180 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `EngineAdapter` connect `engine.ts` to `antigravity.ts`, `cascade.ts`, `Design: Centralized Configuration & Engine Adapters`, `OpenSpec Cascade Agent Guidelines & Quality Standards`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `runTask()` (e.g. with `log()` and `say()`) actually correct?**
  _`runTask()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@eslint/js`, `@types/bun`, `typescript` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `cascade.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08725542041248018 - nodes in this community are weakly interconnected._
- **Why does `@anthropic-ai/claude-agent-sdk` connect `package.json` to `engine.ts`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `EngineAdapter` (e.g. with `2. Clean Code & Well-Architected Principles` and `Decisions`) actually correct?**
  _`EngineAdapter` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Should `engine.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07616892911010557 - nodes in this community are weakly interconnected._