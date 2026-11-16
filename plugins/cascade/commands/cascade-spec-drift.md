---
name: cascade-spec-drift
description: Compare the specs and design of an OpenSpec change with the implemented code using EGM drift detection, after apply and before archive. Writes drift.md inside the change and stamps it for the spec-gate check.
category: Verification
tags: [cascade, openspec, egm, drift]
---

# /cascade-spec-drift — Spec vs code drift for an OpenSpec change

Checks that what a change specified is what the code now does. `sdd-verify` tests runtime behavior of the diff; this command compares the written specification with the code. Run it after `apply` and before `/opsx:archive` (Claude Code) or `/opsx-archive` (other agents).

## Usage

```text
/cascade-spec-drift <change>
```

`<change>` is required and must match a folder under `openspec/changes/`.

## Steps

1. **Preconditions.** Stop with a clear message if any of these fails:
   - `openspec/changes/<change>/design.md` and at least one `openspec/changes/<change>/specs/*/spec.md` exist.
   - The EGM plugin is installed: the glob `~/.claude/plugins/cache/egm/egm/*/skills/egm-drift-report/SKILL.md` matches. If not, tell the user to run `claude plugin install egm@egm` and stop.

2. **Load EGM.** Use the highest version matched by the glob. Read `docs/claude.md` of that plugin, then its `skills/egm-drift-report/SKILL.md`, and follow that procedure in this thread. EGM skills refuse the Skill tool by design, so never invoke them with it.

3. **Overrides to the EGM procedure.** These win over the defaults in the EGM skill:
   - `EGM artifact directory: openspec/changes/<change>`. The report goes there, never to the working directory, never to `docs/designs/`.
   - The target documents are `openspec/changes/<change>/design.md` and every `openspec/changes/<change>/specs/*/spec.md`, not a whole directory of designs. Source files are located from the symbols and paths those documents name.
   - Keep the strict EGM report format: only divergences, or `No drift detected`. The report is `openspec/changes/<change>/drift.md`, written with the file-writing tool, not pasted in chat.

4. **Mark the report open.** Immediately after `drift.md` is written or updated, run `openspec-cascade spec-gate stamp --stage drift --change <change> --status open`, even when an older `resolved` stamp exists: a re-run must never leave an old `resolved` stamp on fresh, untriaged divergences.

5. **Triage with the user.** For each divergence the user decides whether to fix the code or update the spec. Spec updates go through `openspec-update-change`; code fixes are a new task or change, never an unrequested edit made here.

6. **Close the stage.** Run, from the repository root:
   - `openspec-cascade spec-gate stamp --stage drift --change <change> --status resolved` when the report says `No drift detected` or every divergence is resolved or explicitly accepted by the user.
   - Leave the stamp `open` otherwise.
   Stamp after the last spec edit: a later edit to proposal, design, tasks or specs makes the stamp stale.

7. **Report.** Say the path of `drift.md`, the stamp status, and that `openspec-cascade spec-gate check --stage drift --changes <change>` must pass before `/opsx:archive` (Claude Code) or `/opsx-archive` (other agents).
