---
name: cascade-spec-review
description: Review an OpenSpec change with fresh-context EGM Goldfish reviewers before apply or night-run. Writes review.md inside the change and stamps it for the spec-gate check.
category: Planning
tags: [cascade, openspec, egm, review]
---

# /cascade-spec-review — Goldfish review of an OpenSpec change

Reviews the planning artifacts of one OpenSpec change with the EGM (Elephant-Goldfish Model) reviewers, so weak specs are fixed before `tasks.md` is executed. OpenSpec stays the source of truth: the report lives inside the change.

## Usage

```text
/cascade-spec-review <change>
```

`<change>` is required and must match a folder under `openspec/changes/`.

## Steps

1. **Preconditions.** Stop with a clear message if any of these fails:
   - `openspec/changes/<change>/design.md` exists. If not, tell the user to run `/opsx-propose` first.
   - The EGM plugin is installed: the glob `~/.claude/plugins/cache/egm/egm/*/skills/egm-review/SKILL.md` matches. If not, tell the user to run `claude plugin install egm@egm` and stop.
   - The session can create subagents. A review in the same context is not a Goldfish review.

2. **Optional first pass.** If the user has not run it, suggest `sdd-checklist` on the change: it is the cheap, same-context rubric. This command is the second, fresh-context pass.

3. **Load EGM.** Use the highest version matched by the glob. Read `docs/claude.md` of that plugin, then its `skills/egm-review/SKILL.md`, and follow that procedure in this thread. EGM skills refuse the Skill tool by design, so never invoke them with it. Read `agents/*.md` from the same plugin as that skill instructs.

4. **Overrides to the EGM procedure.** These win over the defaults in the EGM skill:
   - `EGM artifact directory: openspec/changes/<change>`. Every report goes there, never to the working directory, never to `docs/designs/`.
   - The document under review is `openspec/changes/<change>/design.md`. Give the reviewers `proposal.md`, `tasks.md` and every `specs/*/spec.md` of the same change as referenced source material.
   - The final report is `openspec/changes/<change>/review.md`. If EGM produces several files, `review.md` is the consolidated one and the others stay next to it.

5. **Triage with the user.** Present the findings and let the user choose which to address. Do not apply any finding unasked. Spec fixes go through `openspec-update-change`, never by editing artifacts freehand.

6. **Close the stage.** Run, from the repository root:
   - `openspec-cascade spec-gate stamp --stage review --change <change> --status resolved` when every finding is addressed or explicitly declined by the user.
   - `openspec-cascade spec-gate stamp --stage review --change <change> --status open` when findings remain.
   Stamp after the last spec edit: the stamp stores a hash of the change, and a later edit makes the review stale.

7. **Report.** Say the path of `review.md`, the stamp status, and that `openspec-cascade spec-gate check --stage review --changes <change>` must pass before a night run.
