# DISPATCH — Auditor M2.1: Final Acceptance & Forensic Integrity Auditor

## Identity
- Role: Final Acceptance & Forensic Integrity Auditor
- TypeName: teamwork_preview_auditor
- Working Directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/auditor_m2_1
- Parent Orchestrator: teamwork_preview_orchestrator_1 (Conv ID: 6d20d99d-2183-4d1a-ad2e-afc1d559cde6)

## Mandatory Inputs
- Original Request: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md
- Master Technical Specification: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md
- Tasks Catalog (JSON): /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/tasks_catalog.json
- Tasks Catalog (Markdown): /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/tasks_catalog.md
- Verification Harness: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/verify_project_items.ts
- Worker M2.1 Handoff: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1/handoff.md

## Objective & Forensic Audit Checks
Perform an independent, empirical forensic integrity audit of all deliverables against the original acceptance criteria:
1. **Technical Specification Verification**:
   - Verify `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md` exists and contains complete architecture, provider abstraction contracts (Claude, Antigravity, OpenCode), and 4-tier verification loop lifecycle.
   - Verify formatting: balanced code fences, no stray syntax, no unrendered markdown.
2. **GitHub Project #4 Audit**:
   - Query GitHub Project #4 live using `gh api graphql` or `gh project item-list 4 --owner sastiam --format json`.
   - Confirm all 16 created items exist in Project #4 (`PVT_kwHOA0KY4s4Boie_`).
   - Confirm 100% of created items contain all 4 mandatory Spanish sections:
     1. Propósito de la tarea
     2. Qué se espera lograr
     3. Goal de la tarea
     4. Criterios de completitud / Definition of Done
3. **Local Catalog & Verification Harness Audit**:
   - Verify `tasks_catalog.json` and `tasks_catalog.md` exist in `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/`.
   - Run `bun run projects/agnostic_looper/verify_project_items.ts` independently and confirm exit code 0 and 100% compliance output.
4. **Anti-Cheat & Repository Health Check**:
   - Verify no dummy implementations, fake network calls, or hardcoded pass assertions.
   - Verify `bun test` passes cleanly.
5. **Verdict**: Declare `CLEAN` or `INTEGRITY VIOLATION`.

Deliver your forensic audit report to `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/auditor_m2_1/handoff.md`.
Send a message to the orchestrator when complete.

## 2026-10-24T15:20:44Z
You are Auditor M2.1 (Final Acceptance & Forensic Integrity Auditor).
Working directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/auditor_m2_1.
Read your dispatch instructions in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/auditor_m2_1/DISPATCH.md and the original user request in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md.
Also inspect the deliverables in /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/ (SPECIFICATION.md, tasks_catalog.json, tasks_catalog.md, verify_project_items.ts) and the handoff from Worker M2.1 (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m2_1/handoff.md).

Perform an independent forensic audit:
1. Verify SPECIFICATION.md completeness and format integrity.
2. Query GitHub Project #4 live (gh api graphql or gh project item-list 4 --owner sastiam) to verify all 16 created items exist and strictly contain all 4 Spanish sections (Propósito de la tarea, Qué se espera lograr, Goal de la tarea, Criterios de completitud / Definition of Done).
3. Run bun run projects/agnostic_looper/verify_project_items.ts to verify structural validation passes 100%.
4. Verify tasks_catalog.json and tasks_catalog.md are accurate and complete.
5. Check for any dummy implementations, fake network responses, or cheated tests.
6. Deliver your verdict (CLEAN or INTEGRITY VIOLATION) in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/auditor_m2_1/handoff.md and send a message when complete.
