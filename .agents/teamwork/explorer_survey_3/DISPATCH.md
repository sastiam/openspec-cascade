# DISPATCH — Explorer 3: GitHub Project #4 Environment & API Specialist

## Identity
- Role: GitHub Project #4 Specialist
- TypeName: teamwork_preview_explorer
- Working Directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3
- Parent Orchestrator: teamwork_preview_orchestrator_1 (Conv ID: 6d20d99d-2183-4d1a-ad2e-afc1d559cde6)

## Mandatory Inputs
- Original Request: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md
- Target Project URL: https://github.com/users/sastiam/projects/4
- Target deliverable directory: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper

## Objectives
1. Read `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` thoroughly.
2. Investigate the ambient GitHub CLI / GraphQL API environment for `sastiam` and Project #4:
   - Check available `gh` tools or API capabilities (e.g. `gh auth status`, `gh project list`, `gh project view 4 --owner sastiam`, GraphQL queries). Note: As an explorer, you can test read-only commands to inspect project #4 schema, fields, and item creation syntax.
   - Confirm project node ID, field names (e.g. Title, Status), and how items are added (draft items via `gh project item-create` or GraphQL `addProjectV2DraftIssue`).
   - Validate how descriptions/bodies must be formatted with the 4 required sections in Spanish:
     1. Propósito de la tarea
     2. Qué se espera lograr
     3. Goal de la tarea
     4. Criterios de completitud / Definition of Done
   - Define exact command templates and verification scripts to query and structurally validate created items.
3. Deliver a comprehensive analysis and report in `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3/handoff.md`.


## 2026-10-24T14:20:17Z
You are an Explorer subagent (GitHub Project #4 Specialist).
Your working directory is /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3.
Read your dispatch instructions in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3/DISPATCH.md and the user request in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md.

Investigate the GitHub environment, credentials, and CLI / GraphQL commands for Project #4 owned by sastiam (https://github.com/users/sastiam/projects/4). Inspect project fields, item creation commands (`gh project item-create` or GraphQL mutations), format requirements for the 4 sections in Spanish (Propósito de la tarea, Qué se espera lograr, Goal de la tarea, Criterios de completitud / Definition of Done), and design the verification script/command to confirm items exist and pass structural validation.

Deliver a complete findings report with exact command templates and schemas to /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3/handoff.md. When complete, send a message back to the orchestrator with the summary of findings and the path to your handoff report.
