# DISPATCH — Worker M2.1: GitHub Project #4 Task Breakdown & Population Specialist

## Identity
- Role: GitHub Project #4 Task Breakdown & Population Specialist
- TypeName: teamwork_preview_worker
- Working Directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1
- Parent Orchestrator: teamwork_preview_orchestrator_1 (Conv ID: 6d20d99d-2183-4d1a-ad2e-afc1d559cde6)

## Mandatory Inputs
- Original Request: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md
- Master Technical Specification: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md
- GitHub Environment & API Specifications: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3/handoff.md
- Auditor M1.2 Handoff: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/auditor_m1_2/handoff.md

## Exclusive Write Ownership
- `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md` (remove stray fence at line 768)
- `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/tasks_catalog.json`
- `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/tasks_catalog.md`
- `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/verify_project_items.ts`
- `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1/*`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Objective & Tasks
1. **Formatting Touchup**: Remove the stray backtick fence on line 768 of `SPECIFICATION.md` (identified in Auditor M1.2 report).
2. **Modular Engineering Task Breakdown (Requirement R2)**:
   Decompose the Agnostic Looper into modular engineering tasks across all 4 work streams defined in `SPECIFICATION.md` Section 6:
   - Stream 1: Core Looper Engine & FSM Lifecycle
   - Stream 2: Provider Abstraction Layer (PAL) & Normalizers (Claude, Antigravity, OpenCode)
   - Stream 3: Objective 4-Tier Verification Harness & Gates (Gate 0 QA to Gate 3 Forensic Veto)
   - Stream 4: CLI, Resilience, State Persistence & Local Integrations
   Aim for 12 to 16 well-scoped, modular engineering tasks.
3. **Populate GitHub Project #4**:
   Target: Project #4 of owner sastiam (Node ID: `PVT_kwHOA0KY4s4Boie_`, URL: `https://github.com/users/sastiam/projects/4`).
   Create each task as a distinct draft item in Project #4 using ambient CLI credentials (`gh project item-create 4 --owner sastiam --title "..." --body "..."`).
   **CRITICAL REQUIREMENT**: 100% of created items must strictly include all four required sections in Spanish:
   ```markdown
   ## 1. Propósito de la tarea
   ...
   ## 2. Qué se espera lograr
   ...
   ## 3. Goal de la tarea
   ...
   ## 4. Criterios de completitud / Definition of Done
   - [ ] ...
   ```
   For each created item, set Status to "Backlog" (`f75ad846`) and Priority to "P0" or "P1".
4. **Generate Local Catalog Files (Requirement R3)**:
   - `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/tasks_catalog.json`: Structured array of all created items with fields `task_key`, `project_item_id`, `title`, `workstream`, `status`, `priority`, `sections_present`, and `url`.
   - `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/tasks_catalog.md`: Markdown catalog listing all created items with their links, descriptions, and statuses.
5. **Create & Run Verification Harness**:
   - Write `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/verify_project_items.ts`.
   - The script must query GitHub Project #4 directly via `gh api graphql` or `gh project item-list`, match the newly created items, and programmatically verify that 100% of them exist and contain all 4 mandatory Spanish sections.
   - Run the verification script with `bun run projects/agnostic_looper/verify_project_items.ts` and capture output.

Deliver your handoff report to `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1/handoff.md`.
Send a message to the orchestrator when complete.


## 2026-10-24T15:08:58Z
You are Worker M2.1 (GitHub Project #4 Task Breakdown & Population Specialist).
Working directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1.
Read your dispatch instructions in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1/DISPATCH.md and the user request in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md.
Also read the Master Technical Specification (/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md) and Explorer 3 handoff (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3/handoff.md).

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Tasks to execute:
1. Touch up line 768 of projects/agnostic_looper/SPECIFICATION.md (delete the stray backtick line).
2. Decompose the Agnostic Looper into modular engineering tasks (12-16 tasks) across the 4 work streams (Core Engine, PAL, Verification Harness, CLI/Persistence).
3. Create each task directly as an item in GitHub Project #4 (https://github.com/users/sastiam/projects/4) using ambient CLI credentials (gh project item-create 4 --owner sastiam). Each created item must strictly include all four required sections in Spanish:
   ## 1. Propósito de la tarea
   ## 2. Qué se espera lograr
   ## 3. Goal de la tarea
   ## 4. Criterios de completitud / Definition of Done
   Set Status to Backlog (f75ad846) and Priority to P0/P1 on Project #4.
4. Generate the local catalog files: projects/agnostic_looper/tasks_catalog.json and projects/agnostic_looper/tasks_catalog.md.
5. Create and run projects/agnostic_looper/verify_project_items.ts to query Project #4 and assert that 100% of created items exist and pass structural validation.

Write your handoff report to /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1/handoff.md and send a message when complete.
