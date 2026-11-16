---
name: cascade-spec-brainstorm
description: Brainstorm an idea with EGM before proposing an OpenSpec change. Scaffolds the change and writes the agreed direction to brief.md inside it, then hands over to /opsx-propose.
category: Planning
tags: [cascade, openspec, egm, brainstorm]
---

# /cascade-spec-brainstorm — Ideation with Goldfish stress-testing before the proposal

Turns a half-formed idea into a brief that survives fresh-context review, before any OpenSpec artifact exists. Use it for large or risky changes. For small changes, `sdd-clarify` is the lighter option (1-2 rounds of questions, no reviewers).

## Usage

```text
/cascade-spec-brainstorm <change> <idea>
```

`<change>` is a kebab-case name for the future change. `<idea>` is the idea in the user's words.

## Steps

1. **Preconditions.** Stop with a clear message if any of these fails:
   - The project uses OpenSpec: `openspec list --json` returns a root. If it does not, stop; never run `openspec init` here.
   - `openspec/changes/<change>/` does not exist yet. If it exists, ask whether to reuse it. If the user says yes, write `brief.md` into it and skip step 2: `openspec new change` fails on an existing directory.
   - The session can create subagents: the Goldfish reviewers need fresh contexts. If it cannot, stop and say so.
   - The EGM plugin is installed: the glob `~/.claude/plugins/cache/egm/egm/*/skills/egm-brainstorm/SKILL.md` matches. If not, tell the user to run `claude plugin install egm@egm` and stop.

2. **Scaffold the change.** Name the file you will write (`openspec/changes/<change>/brief.md`) and ask a yes/no question. After the user confirms, run `openspec new change "<change>"`. The brief lives inside the change so OpenSpec stays the only place with specs.

3. **Load EGM.** Use the highest version matched by the glob. Read `docs/claude.md` of that plugin, then its `skills/egm-brainstorm/SKILL.md`, and follow that procedure in this thread. EGM skills refuse the Skill tool by design, so never invoke them with it.

4. **Overrides to the EGM procedure.** These win over the defaults in the EGM skill:
   - `EGM artifact directory: openspec/changes/<change>`. Every artifact goes there, never to the working directory, never to `docs/designs/`.
   - The brief is `openspec/changes/<change>/brief.md`, not `concepts_brief.md`.
   - Do not start Goldfish reviewers until the user confirms that the working hypothesis is ready. This is EGM's own gate; keep it.
   - Do not run `egm-draft`: the design is written by OpenSpec in the next step, not as a separate design document.

5. **Hand over to OpenSpec.** Tell the user that the next step is `/opsx-propose <change>`, with `brief.md` as the source of intent. The change already exists, so `openspec new change` reports that it already exists: when running propose for this name, skip its creation step and continue at its next step, building the artifacts for the existing change. After the proposal exists, `/cascade-spec-review <change>` is the next gate.

6. **Report.** Say the path of `brief.md`, which findings the user accepted or rejected, and the next command.
