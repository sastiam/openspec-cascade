# Design

## Problem Statement

Planning sessions ask questions the agent could answer by looking, miss the deploy and CI path, ignore the project's helpers, and produce tasks with manual steps (see [proposal.md](proposal.md)). This design defines one planning command, `/cascade:explore`, whose prompt contract fixes those four gaps and ends with a mechanical readiness check.

## Context

- **Command names.** Plugin commands are Markdown prompts in `plugins/cascade/commands/` and are invoked as `/cascade:<file name>`. The new file is `explore.md` (`/cascade:explore`). The existing review command is `/cascade:cascade-spec-review`, the brainstorm command is `/cascade:cascade-spec-brainstorm`, and the setup command from `project-manifest` is `/cascade:setup`.
- **Existing brainstorm command.** `cascade-spec-brainstorm.md` already wraps EGM's brainstorm: preconditions, scaffold after a yes/no, read the EGM skill (never through the Skill tool), write `brief.md` in the change, and hand over to `/openspec-propose`.
- **Content tests.** `test/plugin/egm_commands.test.ts` checks the commands' content: the frontmatter; OpenSpec skills named in both the `/` and `@` forms, with no `/opsx`; writes only inside the change folder; the EGM skill is read, not invoked. Brainstorm-only tests check the reuse-folder skip, subagents, the `sdd-clarify` mention, and the forbidden "Publish concepts_brief.md as RFC" option and `SITEMAP.md`.
- **The installed OpenSpec explore skill.** Claude Code installs it at `~/.claude/skills/openspec-explore/SKILL.md`. Roadmap rule 7 says cascade wraps it and never edits it. It calls itself "a stance, not a workflow", says to avoid a fixed question format, to keep decisions in the conversation rather than files, and never to create an artifact the schema does not define.
- **Manifest.** `openspec-cascade setup show --json` prints `{"entries":[{"name","type","whenToUse","required","check"?,"profile"?,"hosts"?,"layer"}]}`. The AWS read-only profile is the `profile` field of the aws entry.
- **Dependencies.** `project-manifest` provides `setup show --json`. `tasks-contract` provides the tasks linter (`openspec-cascade lint-tasks`, exit 0 clean, 1 findings, 2 usage or tooling error), its `manual-step` rule, and the `manual.md` format: top-level list items, each with an indented `Check:` line, no checkboxes.

## Goals / Non-Goals

**Goals:**
- One planning command with a testable prompt contract.
- Explicit precedence between the cascade overrides and the two skills the command follows.
- A read-only allowlist that excludes secret-bearing and file-writing calls.
- A readiness check decided by exit codes, reachable in the same thread and on re-entry.
- The brainstorm command reduced to a delegating alias; the review command gains a tasks precondition.

**Non-Goals:**
- Runtime code, including a hook that enforces the allowlist.
- Reading Linear without an MCP.
- Enforcing read-only access by code. The hard limits are the IAM policy of the declared AWS profile and the sandbox; the prompt states the rule.
- Changing `openspec-propose`, `openspec-explore` or the EGM skills.
- Supporting the command in OpenCode. It is Claude Code only; OpenCode users follow the docs.

## Decisions

- **Command structure.** `explore.md` has these sections, in order:
  1. Usage, including re-entry.
  2. Preconditions.
  3. Precedence and overrides.
  4. Load context: the explore skill, the manifest, Linear.
  5. Read-only investigation, with the allowlist and the deploy and CI inventory.
  6. Hypothesis and the single readiness gate, with the optional Goldfish review.
  7. Write `brief.md`.
  8. Propose: follow the `openspec-propose` skill and write `manual.md`.
  9. Readiness check and fix loop.
  10. Report.
- **Precedence.** Cascade overrides > EGM brainstorm skill > `openspec-explore` skill. The EGM overrides of the brainstorm command are copied into `explore.md` unchanged: the artifact directory is the change, the brief is `brief.md`, there is no `egm-draft`, and the "Publish concepts_brief.md as RFC" option is forbidden. Known conflicts with the explore skill and how each is overridden:
  - "Avoid a fixed question format" and "no mandatory outputs": the brief has a fixed section list; the conversation itself stays open-ended.
  - "Never create an artifact the schema does not define" and "track decisions in the conversation, not in files": `brief.md` and `manual.md` are allowed as non-schema files inside the change folder.
  - Confirmation before each write-capable action: the command uses a single gate. One yes/no covers `openspec new change`, `brief.md`, the propose step and `manual.md`, all inside the change folder. Fixes after a failed readiness check need their own yes.
- **Preconditions.** Checked in this order:
  - An OpenSpec root: `openspec list --json` returns a root; otherwise stop, never `openspec init`.
  - The explore skill is present at `~/.claude/skills/openspec-explore/SKILL.md`; otherwise stop and name the path.
  - `openspec-cascade setup show --json` runs; if not, continue and note "no manifest" in the brief.
  - The EGM glob `~/.claude/plugins/cache/egm/egm/*/skills/egm-brainstorm/SKILL.md` is checked at the gate, before the review is offered; if it does not match, the review is not offered and the brief says why.
  - Subagent support is checked only if the user accepts the review.
- **Read-only allowlist.** The command file has a heading "Read-only allowlist" listing what investigation may run:
  - AWS only when the manifest has an aws entry with a `profile`, always with `--profile <profile>`, and only `describe-*`, `list-*` and `get-*` verbs. Excluded even when the verb matches: `secretsmanager`, `ssm` with `--with-decryption`, `kms decrypt`, `sts assume-role`, and any call that writes a local file (`s3api get-object`, `--output-file` style arguments). Without such an entry it makes no AWS calls and records that in the brief.
  - MCP only through tools whose names start with `get_`, `list_`, `search_`, `read_`, `fetch`, `query` or `view`; never write tools.
  - `gh run list --limit`, `gh run view --log-failed`, `gh workflow view`.
  - Read-only git commands (`git log`, `git show`, `git diff`, `git status`, `git blame`).
  - Reading files in the repository.

  A separate heading "The command's own writes" lists the only writes: `openspec new change` after the yes/no, files inside `openspec/changes/<change>/`, and the propose and update-change skills. An allowlist is easier for a model to follow than a denylist.
- **Deploy and CI inventory is mandatory.** The command always reads `.github/workflows/*`, deploy scripts and IaC in the repo, whether or not `gh` is in the manifest. "Deploy and CI risks" cites the inspected files and runs even when it says the section does not apply.
- **Sources consulted.** It lists every manifest entry as used, not applicable (one-line reason) or unavailable, and every CLI command run.
- **Context budget.** Prefer `--limit`, `--log-failed`, AWS `--query` and `--max-items`. Summarize findings into the brief as they arrive instead of keeping raw output. Restate the overrides before writing the brief. Redact account IDs, ARNs and secrets from the brief.
- **Questions go one per message, open-ended.** No multiple-choice tools during investigation; they are allowed only at the readiness gate, matching EGM's own rule.
- **Explore runs propose inline.** After the brief, the command reads and follows the installed `openspec-propose` skill in the same thread (`/openspec-propose` in Claude Code, `@openspec-propose` in OpenCode docs), skipping its creation step because the change exists. During this step it writes `manual.md` from the brief's "Manual steps" in the `tasks-contract` format. Control stays in the explore thread, so the readiness check always runs.
- **The readiness check runs commands, not judgment.** It runs `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`. On failure it shows the findings, fixes the tasks through the `openspec-update-change` skill when the user agrees, and re-runs both, at most 3 rounds. It declares "ready for an unattended run" only from the exit codes of the last run. After 3 failed rounds it stops and lists what is left.
- **Re-entry.** `/cascade:explore <change>` on a change that already has `tasks.md` skips investigation, the brief and propose, and goes straight to the readiness check.
- **Brainstorm alias delegates.** `cascade-spec-brainstorm.md` keeps its frontmatter name; its description becomes "Deprecated alias for /cascade:explore" and its body tells the agent to run `/cascade:explore $ARGUMENTS`. The brainstorm-only content tests move to the explore block in `test/plugin/egm_commands.test.ts`.
- **Review precondition.** In `cascade-spec-review.md`, before any reviewer starts: no `tasks.md` → stop and point to `/openspec-propose` (`@openspec-propose`); `openspec-cascade lint-tasks --changes <change>` exit 1 → show the findings and stop; exit 2 or command not found → report a tooling problem with an upgrade hint for `openspec-cascade`. There is no override.

## Alternatives Considered

- **Extend brainstorm in place vs a new command.** Extending `cascade-spec-brainstorm.md` keeps one file but keeps a name that describes only part of the flow, and `/cascade:cascade-spec-brainstorm` is long. Chosen: a new `explore.md`, with brainstorm as an alias.
- **Runtime guard hook vs prompt rules.** A PreToolUse hook could block non-allowlisted AWS and MCP calls, but it is runtime code, differs between Claude Code and OpenCode, and duplicates IAM. Chosen: prompt rules, with IAM on the profile and the sandbox as the hard limits.
- **Explore calls propose inline vs manual hand-over.** A hand-over loses control, so the readiness check may never run. Chosen: inline, in the same thread.
- **Tasks linter check only in review vs in both.** Checking only in review finds problems one step late. Chosen: both; explore fixes, review guards.
- **Alias delegating vs redirecting.** A redirect that only prints the new name breaks muscle memory and scripts. Chosen: delegate, so the old name keeps working.

## Migration Plan

- The alias ships in this change. Old invocations of `/cascade:cascade-spec-brainstorm <change> <idea>` run `/cascade:explore` with the same arguments.
- Existing changes with a `brief.md` from brainstorm are compatible: explore reuses the folder on a yes, or re-enters at the readiness check when `tasks.md` exists.
- Rollback: restore the previous `cascade-spec-brainstorm.md` and drop `explore.md`; no data or config migrates.
- Removing the alias is a later change once the docs have pointed to `/cascade:explore` for one release.

## Risks / Trade-offs

- [AWS or `gh` output leaks into the brief: account IDs, ARNs, secrets in logs] → Secret-bearing calls are excluded, logs are limited with `--log-failed`, and the brief redacts account IDs, ARNs and secrets. Residual risk: a secret printed in a CI log line can still reach the conversation context, though not the brief.
- [The model ignores the allowlist] → IAM on the declared profile and the sandbox are the real limits. "Sources consulted" lists every command run, so a violation shows up in review.
- [Missing tools: no manifest, no aws entry, no `gh`, no Linear MCP, no EGM] → Each case has a stated fallback (continue with a note, make no AWS calls, ask for text, skip the review offer), and "Sources consulted" marks the entry unavailable.
- [The fix loop does not converge] → Bounded at 3 rounds; after that the command stops without declaring ready.
- [The OpenSpec explore skill changes shape] → The command says "read and follow it" plus its own overrides, so changes flow through; a new conflicting rule is caught by the precedence order.
