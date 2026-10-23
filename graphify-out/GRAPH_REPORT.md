# Graph Report - openspec-cascade  (2026-10-23)

## Corpus Check
- 25 files · ~35,871 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .lock 1)

## Summary
- 182 nodes · 261 edges · 22 communities (12 shown, 10 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c41739c5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- cascade.ts
- opencode.ts
- ADDED Requirements
- package.json
- openspec-explore/SKILL.md
- opsx-explore.md
- compilerOptions
- Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`)
- Decisions
- printPlan
- Proposal: Add Antigravity CLI Engine
- openspec-cascade

## God Nodes (most connected - your core abstractions)
1. `runTask()` - 15 edges
2. `log()` - 11 edges
3. `say()` - 11 edges
4. `runClaude()` - 11 edges
5. `runOpenCode()` - 9 edges
6. `runChange()` - 9 edges
7. `main()` - 9 edges
8. `compilerOptions` - 9 edges
9. `printPlan()` - 8 edges
10. `commitTypeOf()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `5. Auditoría y Registro (Logging)` --references--> `commit()`  [INFERRED]
  docs/cli.md → cascade.ts
- `1. Principios de Diseño` --references--> `main()`  [INFERRED]
  docs/cli.md → cascade.ts
- `1. Antigravity Engine Module` --references--> `classifyFailure()`  [INFERRED]
  openspec/changes/add-antigravity-engine/tasks.md → opencode.ts
- ``cascade.ts` (Orquestador Principal)` --references--> `parseTasks()`  [INFERRED]
  docs/cli.md → cascade.ts
- ``cascade.ts` (Orquestador Principal)` --references--> `verifyCommands()`  [INFERRED]
  docs/cli.md → cascade.ts

## Import Cycles
- None detected.

## Communities (22 total, 10 thin omitted)

### Community 0 - "cascade.ts"
Cohesion: 0.12
Nodes (37): agentOptions(), blockingMeters(), changes, commit(), DEFAULT_VERIFY, DENIED_BASH, describeToolInput(), Fatal (+29 more)

### Community 1 - "opencode.ts"
Cohesion: 0.15
Nodes (15): 3. Componentes del Sistema, `opencode.ts` (Adaptador de Motor OpenCode), classifyFailure(), Hooks, OPENCODE_DEFAULT_MODEL, openCodeModelArg(), OpenCodeOutcome, openCodePermission() (+7 more)

### Community 2 - "ADDED Requirements"
Cohesion: 0.12
Nodes (16): ADDED Requirements, Purpose, Requirement: Engine Selection, Requirement: Event Stream Processing and Progress Logging, Requirement: Model and Effort Configuration, Requirement: Session Execution and Streaming, Scenario: Custom model and effort override, Scenario: Default model selection (+8 more)

### Community 3 - "package.json"
Cohesion: 0.13
Nodes (14): dependencies, @anthropic-ai/claude-agent-sdk, devDependencies, @types/bun, typescript, name, private, scripts (+6 more)

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
Cohesion: 0.20
Nodes (8): 1. Principios de Diseño, 2. Diagrama de Flujo y Arquitectura, 4. Referencia de Flags y Opciones, 5. Auditoría y Registro (Logging), 6. Personalización para otros Proyectos, Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`), Documentación de OpenSpec Cascade, Índice

### Community 8 - "Decisions"
Cohesion: 0.20
Nodes (9): 1. Module Structure: `antigravity.ts`, 2. Event Stream Mapping, 3. Session Resumption, 4. Error and Rate Limit Classification, Context, Decisions, Design: Antigravity CLI Engine Integration, Goals / Non-Goals (+1 more)

### Community 9 - "printPlan"
Cohesion: 0.44
Nodes (8): blockedReason(), commitsPerSection(), commitTypeOf(), isLastOfSection(), parseTasks(), printPlan(), verifyCommands(), `cascade.ts` (Orquestador Principal)

### Community 10 - "Proposal: Add Antigravity CLI Engine"
Cohesion: 0.25
Nodes (7): Capabilities, Impact, Modified Capabilities, New Capabilities, Proposal: Add Antigravity CLI Engine, What Changes, Why

### Community 11 - "openspec-cascade"
Cohesion: 0.25
Nodes (7): Adapting it, How it works, Known limits, openspec-cascade, Requirements, Tests, Usage

## Knowledge Gaps
- **2 isolated node(s):** `@types/bun`, `typescript`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 105 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@anthropic-ai/claude-agent-sdk` connect `package.json` to `cascade.ts`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **What connects `@types/bun`, `typescript` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `cascade.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11585365853658537 - nodes in this community are weakly interconnected._
- **Why does `main()` connect `cascade.ts` to `printPlan`, `openspec-cascade`, `Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`)`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Should `opencode.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14736842105263157 - nodes in this community are weakly interconnected._
- **Why does `Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`)` connect `Análisis de Arquitectura y Funcionamiento del CLI (`openspec-cascade`)` to `opencode.ts`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Should `ADDED Requirements` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._