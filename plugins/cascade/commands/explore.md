---
name: explore
description: Plan an OpenSpec change end to end. Investigates read-only with the project's manifest, writes brief.md inside the change, runs the propose skill in the same thread and declares the change ready for an unattended run only when its tasks pass the tasks linter.
category: Planning
tags: [cascade, openspec, egm, explore, planning]
---

# /cascade:explore — Planning with read-only investigation and a mechanical readiness check

Turns a Linear issue or an idea into a change that is ready for an unattended run. It investigates before asking, writes the agreed direction to `brief.md`, runs the propose skill in this thread and ends with commands, not judgment.

## Usage

```text
/cascade:explore <change> <idea or Linear link>
```

`<change>` is a kebab-case name. `<idea or Linear link>` is the idea in the user's words or a Linear issue URL.

- Re-entry: when the change already has tasks.md, `/cascade:explore <change>` skips investigation, the brief and the propose step, and goes straight to the readiness check.
- Claude Code only. OpenCode users follow the docs: `@openspec-explore`, then `@openspec-propose`, then `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`.
- For small changes, `sdd-clarify` is the lighter option: 1-2 rounds of questions, no investigation, no reviewers.
- `/cascade:cascade-spec-brainstorm` is a deprecated alias of this command.

## Preconditions

Check in this order. Stop with a clear message when a stopping check fails.

1. The project uses OpenSpec: `openspec list --json` returns a root. If it does not, stop; never run `openspec init`.
2. The explore skill is present at `~/.claude/skills/openspec-explore/SKILL.md`. If it is missing, stop and name that path. It is `@openspec-explore` in OpenCode, and this command does not run there.
3. `openspec-cascade setup show --json` runs. If it fails, continue and note "no manifest" in the brief.
4. `openspec/changes/<change>/tasks.md` exists: go straight to the readiness check (re-entry) and skip everything else.
5. `openspec/changes/<change>/` exists without `tasks.md`: ask whether to reuse it. On yes, write `brief.md` there without running `openspec new change`, because that command fails when the change already exists.

The EGM glob and subagent support are not preconditions. The glob is checked at the readiness gate, and subagents only if the user accepts the review.

## Precedence and overrides

Read and follow the installed `openspec-explore`, `openspec-propose` and EGM brainstorm skills. Never edit them. When they conflict, the order is:

Cascade overrides > EGM brainstorm skill > openspec-propose skill > openspec-explore skill

Cascade overrides:

- Explore says to avoid a fixed question format and mandatory outputs: the brief has a fixed section list. The conversation itself stays open-ended.
- Explore says to track decisions in the conversation and to create only schema artifacts: `brief.md` and `manual.md` are allowed as non-schema files inside the change folder.
- Explore asks for confirmation before the first write-capable action and again before expanding scope: this command uses a single gate. One yes/no covers `openspec new change`, `brief.md`, the propose step and `manual.md`, all inside the change folder. Fixes after a failed readiness check need their own yes.
- Explore says to hand off to the propose skill instead of running it: this command runs propose inline, in this thread (`/openspec-propose` in Claude Code, `@openspec-propose` in OpenCode).
- Propose says to stop after the planning artifacts and wait: Do not stop after the artifacts. Run the readiness check.
- Propose ends with a prompt to start the apply workflow: Do not present the apply prompt. The next gate is `/cascade:cascade-spec-review`.
- Propose asks whether to continue or create a new change when the name exists: continue it, without asking, and skip its creation step.

EGM overrides, copied from the brainstorm command:

- `EGM artifact directory: openspec/changes/<change>`. Every artifact goes there, never to the working directory, never to `docs/designs/`.
- The brief is `openspec/changes/<change>/brief.md`, not `concepts_brief.md`.
- Do not start Goldfish reviewers until the user confirms that the working hypothesis is ready. This is EGM's own gate; keep it.
- Do not run `egm-draft`: the design is written by OpenSpec in the propose step, not as a separate design document.
- Do not offer or take the option "Publish concepts_brief.md as RFC for team feedback": it would write to `docs/designs/` (never allowed here) and register the RFC in `SITEMAP.md`, creating a second source of truth next to `openspec/`. In the closing question keep only the options that stay inside the change.

## Load context

1. Read the explore skill at `~/.claude/skills/openspec-explore/SKILL.md` and follow it with the overrides above.
2. Read `openspec/config.yaml` `context`. It also sets the language of the brief: English unless it says otherwise.
3. Load the merged manifest with `openspec-cascade setup show --json`. Consult each entry whose `whenToUse` applies to the change, for example Watson before proposing, or a design-system MCP when the change has UI. Watson and EGM are planning aids.
4. Given a Linear link and a Linear MCP in the session, read the issue title, description and comments through the Linear MCP before asking anything. Without one, ask the user to paste the issue text.

## Read-only investigation

Before asking the user a question, try to answer it read-only from the repository and the manifest's tools. Ask only what remains unknown, one question per message, open-ended and focused. Use no multiple-choice tools during investigation; they are allowed only at the readiness gate.

Always read `.github/workflows/`, deploy scripts and IaC in the repository, whether or not `gh` is in the manifest. "Deploy and CI risks" in the brief cites the inspected files and runs, even when it says the section does not apply.

Keep the context small. Prefer `--limit`, `--log-failed`, AWS `--query` and `--max-items`. Summarize findings into the brief as they arrive instead of keeping raw output. Restate the overrides before writing the brief. The brief never contains account IDs, ARNs or secrets: refer to a resource by name and redact the rest.

### Read-only allowlist

Investigation may run only this:

- AWS, only when the manifest has the aws entry: the entry whose `name` is `aws` and whose `type` is `cli`, with a `profile`. Always pass `--profile <profile>` and use only `describe-*`, `list-*` and `get-*` verbs. Even when the verb matches, never call:
  - secret-bearing calls: anything under `secretsmanager`, `ssm` with `--with-decryption`, `kms decrypt`;
  - credential-minting calls: any operation containing `authorization-token` or `login-password`, any `sts get-` call, `sts assume-role`;
  - environment-returning calls: `lambda get-function`, `lambda get-function-configuration`, `ecs describe-task-definition`;
  - file-writing calls: `s3api get-object` and any call that writes a local file (for example one with an output-file argument).

  Without an aws entry that has a profile, make no AWS calls and record that in the brief. When a needed call is excluded, record the gap in the brief.
- MCP tools whose names start with `get_`, `list_`, `search_`, `read_`, `fetch`, `query` or `view`. Never call write tools, for example `create_issue`.
- `gh run list --limit`, `gh run view --log-failed` and `gh workflow view`.
- Read-only git commands: `git log`, `git show`, `git diff`, `git status`, `git blame`.
- Reading files in the repository.

### The command's own writes

These are the only writes:

- `openspec new change` after the yes at the readiness gate.
- Files inside `openspec/changes/<change>/`: `brief.md`, `manual.md` and the planning artifacts.
- The propose and update-change skills, which write inside the same folder.

The hard limits are the IAM policy of the declared AWS profile and the sandbox. This prompt states the rule; it does not enforce it.

## Readiness gate

1. **Hypothesis.** Summarize the working hypothesis: what will change, what the investigation found, the manual steps and the open questions.
2. **Load EGM.** Check the glob `~/.claude/plugins/cache/egm/egm/*/skills/egm-brainstorm/SKILL.md` and use the highest version it matches. Read `docs/claude.md` of that plugin, then its `skills/egm-brainstorm/SKILL.md`, and follow that procedure in this thread. EGM skills refuse the Skill tool by design, so never invoke them with it. When the glob does not match, do not offer the review, suggest `claude plugin install egm@egm` and record why in the brief. This does not block the command.
3. **Single yes/no.** Ask once, and name the files you will write. Offer the Goldfish review in the same question when EGM is available. One yes covers the review if accepted, `openspec new change`, `brief.md`, the propose step and `manual.md`.
4. **Review only on confirmation.** Run the Goldfish review only when the user confirms it. Check then that the session can create subagents; if it cannot, say so and continue without the review. When the user declines, write the brief without running reviewers and say so in the brief.

## Write brief.md

Restate the overrides, then write `openspec/changes/<change>/brief.md` with this template, in the language set by `openspec/config.yaml` `context` (English unless it says otherwise). Fill every section; write "Not applicable" with a one-line reason instead of dropping one.

```markdown
## Overview

What the change is and why, in a few sentences.

## Sources consulted

Every manifest entry as used, not applicable (one-line reason) or unavailable, and every CLI command run.

## Findings

What the read-only investigation found, summarized, with account IDs, ARNs and secrets redacted.

## Deploy and CI risks

The inspected workflow, deploy and IaC files and the risks they show. Runs even when it says the section does not apply.

## Manual steps

Steps a person must do outside the repository, each with how to check it is done.

## Goals and Non-Goals

What the change does and what it leaves out.

## Alternatives weighed

Options considered and why each was kept or dropped.

## Decisions

What was decided, including the user's answers at the readiness gate.

## Open questions

What is still unknown. Say "none" when nothing is left.
```

When no manifest, no aws entry, no `gh`, no Linear MCP or no EGM was available, say so in "Sources consulted". When the user declined the review, say that no reviewers ran.

## Propose

After the brief, read and follow the installed `openspec-propose` skill in this thread (`/openspec-propose` in Claude Code, `@openspec-propose` in OpenCode). Continue the existing change without asking and skip its creation step. Do not stop after the artifacts and do not present the apply prompt.

During this step write `openspec/changes/<change>/manual.md` from the "Manual steps" section of the brief. Each manual step is a top-level list item with an indented `Check:` line, with no checkboxes:

```text
- Create the production secret in the console
  Check: the secret appears in the console list
```

Manual steps never go into `tasks.md`. When the brief has no manual steps, write no `manual.md`.

## Readiness check and fix loop

Run these commands, not judgment, from the repository root (add `--repo <path>` to the tasks linter when not at the root):

1. `openspec validate <change> --strict`
2. `openspec-cascade lint-tasks --changes <change>`

Decide by exit code:

- Both exit 0: declare the change ready for an unattended run and name `/cascade:cascade-spec-review` as the next gate.
- exit 1 from either: enter the fix loop. Show the findings. When the user agrees, fix them through the `openspec-update-change` skill (`/openspec-update-change` in Claude Code, `@openspec-update-change` in OpenCode). Validate findings may need edits in any artifact of the change. Tasks linter findings are in `tasks.md`, and a `manual-step` finding moves the step to `manual.md`. Then re-run both commands. Run at most 3 rounds; after the third failed round, stop, list what is left and do not declare the change ready.
- exit 2 or command not found from the tasks linter: stop and report a tooling problem. Print exactly "Update openspec-cascade (forja apply looper) and run /cascade:explore <change> again." This uses no fix round and does not declare the change ready.

## Report

End with a short report:

- The files written inside `openspec/changes/<change>/`.
- The result of the readiness check: ready for an unattended run, findings left after the fix rounds, or the tooling problem.
- The "Open questions" and "Manual steps" the user still has to handle.
- The next gate when the change is ready: `/cascade:cascade-spec-review <change>`.
