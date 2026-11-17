# Design

## Problem Statement

Planning sessions ask questions the agent could answer by looking, miss the deploy and CI path, ignore the project's helpers, and produce tasks with manual steps (see [proposal.md](proposal.md)). This design defines one planning command, `/cascade:explore`, whose prompt contract fixes those four gaps and ends with a mechanical readiness check.

## Context

- **Command names.** Plugin commands are Markdown prompts in `plugins/cascade/commands/` and are invoked as `/cascade:<file name>`. The new file is `explore.md` (`/cascade:explore`). The existing review command is `/cascade:cascade-spec-review`, the brainstorm command is `/cascade:cascade-spec-brainstorm`, and the setup command from `project-manifest` is `/cascade:setup`.
- **Existing brainstorm command.** `cascade-spec-brainstorm.md` already wraps EGM's brainstorm: preconditions, scaffold after a yes/no, read the EGM skill (never through the Skill tool), write `brief.md` in the change, and hand over to `/openspec-propose`.
- **Content tests.** `test/plugin/egm_commands.test.ts` runs shared checks on every row of its `COMMANDS` table, inside `describe.each`:
  - frontmatter starts with `name: <file name>` and has a description;
  - no `/opsx`, and every `/openspec-<name>` occurrence anywhere in the file, including paths such as `skills/openspec-explore/SKILL.md`, also appears as `@openspec-<name>`;
  - the text contains `openspec/changes/<change>/` and the output file name, and every line that mentions `docs/designs/` contains the lowercase word `never`;
  - the text contains `skills/<egm skill>/SKILL.md`, `docs/claude.md`, `egm@egm` and `EGM artifact directory: openspec/changes/<change>`.
  Command-specific tests sit in `if (command.name === "...")` blocks inside the same `describe.each`. The file reads each command at collection time, so a `COMMANDS` row whose file does not exist makes the whole test file fail to load.
- **The installed OpenSpec skills.** Claude Code installs them at `~/.claude/skills/openspec-explore/SKILL.md` and `~/.claude/skills/openspec-propose/SKILL.md`. Roadmap rule 7 says cascade wraps them and never edits them. The explore skill calls itself "a stance, not a workflow", avoids a fixed question format, keeps decisions in the conversation rather than files, only creates change artifacts the schema defines, asks for confirmation before the first write-capable action and again before expanding the confirmed scope, and hands off to `openspec-propose` instead of running it. The propose skill stops after the planning artifacts and waits for a new user request, ends with a prompt to start the apply workflow, and asks whether to continue or create a new change when the change already exists.
- **Manifest.** `openspec-cascade setup show --json` prints `{"entries":[{"name","type","whenToUse","required","check"?,"profile"?,"hosts"?,"layer"}]}`. The aws entry is the entry whose `name` is `aws` and whose `type` is `cli`, and it counts only when it has a `profile`.
- **Dependencies.** `project-manifest` provides `setup show --json`. `tasks-contract` provides the tasks linter (`openspec-cascade lint-tasks --changes <change> [--repo <path>]`, exit 0 clean, 1 findings, 2 usage or tooling error), its `manual-step` rule, and the `manual.md` format: top-level list items, each with an indented `Check:` line, no checkboxes.

## Goals / Non-Goals

**Goals:**
- One planning command with a testable prompt contract.
- Explicit precedence between the cascade overrides and the three skills the command follows.
- A read-only allowlist that excludes secret-bearing, credential-minting, environment-returning and file-writing calls.
- A readiness check decided by exit codes, reachable in the same thread and on re-entry.
- The brainstorm command reduced to a delegating alias; the review command gains a tasks precondition.

**Non-Goals:**
- Runtime code, including a hook that enforces the allowlist.
- Reading Linear without an MCP.
- Enforcing read-only access by code. The hard limits are the IAM policy of the declared AWS profile and the sandbox; the prompt states the rule.
- Changing `openspec-propose`, `openspec-explore`, `openspec-update-change` or the EGM skills.
- Supporting the command in OpenCode. It is Claude Code only; OpenCode users follow the docs.

## Decisions

- **Command structure.** `explore.md` has a frontmatter with `name: explore`, a description, `category` and `tags`, and no `disable-model-invocation` key. Its body has exactly these `##` sections, in this order:
  1. `## Usage`: the usage line `/cascade:explore <change> <idea or Linear link>`; re-entry on a change that already has tasks.md; "Claude Code only", with the OpenCode flow named (`@openspec-explore`, then `@openspec-propose`, then the two readiness commands); `sdd-clarify` as the lighter option for small changes; `/cascade:cascade-spec-brainstorm` as a deprecated alias.
  2. `## Preconditions`.
  3. `## Precedence and overrides`.
  4. `## Load context`: the explore skill, `openspec/config.yaml`, the manifest, Linear.
  5. `## Read-only investigation`, with two `###` subsections, `### Read-only allowlist` and `### The command's own writes`, plus the deploy and CI inventory.
  6. `## Readiness gate`: hypothesis, "Load EGM", the optional Goldfish review and the single yes/no.
  7. `## Write brief.md`: the brief template as one fenced `markdown` block.
  8. `## Propose`: follow the `openspec-propose` skill and write `manual.md`.
  9. `## Readiness check and fix loop`.
  10. `## Report`.

  The brief headings exist only inside the fenced template in `## Write brief.md`, so each appears exactly once in the file. Every other section names a brief section in quotes without `##`, for example "Sources consulted".
- **Literals required by the shared checks.** Adding `explore` to `COMMANDS` makes the shared checks require these literals in `explore.md`, placed as follows:
  - `@openspec-explore` in `## Usage` (the OpenCode flow), matching `skills/openspec-explore/SKILL.md` in `## Preconditions`.
  - `@openspec-propose` next to every `/openspec-propose` (`## Usage`, `## Precedence and overrides`, `## Propose`).
  - `@openspec-update-change` next to every `/openspec-update-change` (`## Readiness check and fix loop`).
  - No other `/openspec-<name>` text in the file.
  - `openspec/changes/<change>/` and `brief.md` in `## Precedence and overrides` (the EGM overrides) and `## Write brief.md`.
  - `EGM artifact directory: openspec/changes/<change>` in `## Precedence and overrides`, copied from the brainstorm overrides.
  - `skills/egm-brainstorm/SKILL.md`, `docs/claude.md` and `egm@egm` in `## Readiness gate`: "Load EGM" checks the glob `~/.claude/plugins/cache/egm/egm/*/skills/egm-brainstorm/SKILL.md`, uses the highest version, reads that plugin's `docs/claude.md` and then the skill, and never invokes EGM through the Skill tool. When the glob does not match, the command does not offer the review, suggests `claude plugin install egm@egm` and records why in the brief. This is not blocking.
  - Every line that mentions `docs/designs/` contains the lowercase word `never`.
- **Precedence.** The order is: Cascade overrides > EGM brainstorm skill > openspec-propose skill > openspec-explore skill. `explore.md` states it on one line in exactly that form. The EGM overrides of the brainstorm command are copied into `explore.md` unchanged: the artifact directory is the change, the brief is `brief.md`, no Goldfish reviewers start until the user confirms, there is no `egm-draft`, and the "Publish concepts_brief.md as RFC" option is forbidden. Known conflicts and how each is overridden:
  - Explore, "avoid a fixed question format" and "no mandatory outputs": the brief has a fixed section list; the conversation itself stays open-ended.
  - Explore, "track decisions in the conversation, not in files" and "only create change artifacts the schema defines": `brief.md` and `manual.md` are allowed as non-schema files inside the change folder.
  - Explore, confirmation before the first write-capable action and again before expanding the confirmed scope: the command uses a single gate. One yes/no covers `openspec new change`, `brief.md`, the propose step and `manual.md`, all inside the change folder. Fixes after a failed readiness check need their own yes.
  - Explore, "hand off to openspec-propose, do not run it": the command runs propose inline, in the same thread.
  - Propose, "stop after the planning artifacts and wait for a new user request": `Do not stop after the artifacts`; run the readiness check.
  - Propose, the final prompt to start the apply workflow: `Do not present the apply prompt`; the next gate is `/cascade:cascade-spec-review`.
  - Propose, "a change with that name already exists, ask whether to continue it or create a new one": continue it, without asking, and skip its creation step.
- **Preconditions.** Checked in this order:
  - An OpenSpec root: `openspec list --json` returns a root; otherwise stop, never `openspec init`.
  - The explore skill is present at `~/.claude/skills/openspec-explore/SKILL.md`; otherwise stop and name the path.
  - `openspec-cascade setup show --json` runs; if not, continue and note "no manifest" in the brief.
  - `tasks.md` exists in the change: go to `## Readiness check and fix loop` (re-entry).
  - The change folder exists without `tasks.md`: ask whether to reuse it; on yes, write `brief.md` there without running `openspec new change`, because that command fails when the change already exists.
  - The EGM glob and subagent support are not preconditions: the glob is checked at the gate, and subagents ("create subagents") only if the user accepts the review.
- **Load context.** Read `openspec/config.yaml` `context` (it also sets the brief language). Load the manifest. Given a Linear link and a Linear MCP in the session, read the issue title, description and comments through it before asking anything; without one, ask the user to paste the issue text.
- **Read-only allowlist.** `### Read-only allowlist` lists what investigation may run:
  - AWS only when the manifest has an aws entry (`name` `aws`, `type` `cli`, with a `profile`), always with `--profile <profile>`, and only `describe-*`, `list-*` and `get-*` verbs. Excluded even when the verb matches:
    - secret-bearing: anything under `secretsmanager`, `ssm` with `--with-decryption`, `kms decrypt`;
    - credential-minting: any operation containing `authorization-token` or `login-password` (for example ECR and CodeArtifact), any `sts get-*` call, `sts assume-role`;
    - environment-returning: `lambda get-function`, `lambda get-function-configuration`, `ecs describe-task-definition`;
    - file-writing: `s3api get-object` and any call with an output-file argument.
    Without an aws entry it makes no AWS calls and records that in the brief.
  - MCP only through tools whose names start with `get_`, `list_`, `search_`, `read_`, `fetch`, `query` or `view`; never write tools.
  - `gh run list --limit`, `gh run view --log-failed`, `gh workflow view`.
  - Read-only git commands (`git log`, `git show`, `git diff`, `git status`, `git blame`).
  - Reading files in the repository.

  `### The command's own writes` lists the only writes: `openspec new change` after the gate yes, files inside `openspec/changes/<change>/`, and the propose and update-change skills. It states that the hard limits are the IAM policy of the declared profile and the sandbox, and that the prompt states the rule. An allowlist is easier for a model to follow than a denylist.
- **Deploy and CI inventory is mandatory.** The command always reads `.github/workflows/*`, deploy scripts and IaC in the repo, whether or not `gh` is in the manifest. "Deploy and CI risks" cites the inspected files and runs even when it says the section does not apply.
- **Sources consulted.** It lists every manifest entry as used, not applicable (one-line reason) or unavailable, and every CLI command run.
- **Context budget.** Prefer `--limit`, `--log-failed`, AWS `--query` and `--max-items`. Summarize findings into the brief as they arrive instead of keeping raw output. Restate the overrides before writing the brief. Redact account IDs, ARNs and secrets from the brief.
- **Questions go one per message, open-ended.** No multiple-choice tools during investigation; they are allowed only at the readiness gate, matching EGM's own rule.
- **Brief template.** `## Write brief.md` holds one fenced `markdown` block with these headings, in order: `## Overview`, `## Sources consulted`, `## Findings`, `## Deploy and CI risks`, `## Manual steps`, `## Goals and Non-Goals`, `## Alternatives weighed`, `## Decisions`, `## Open questions`. The brief is in English unless `openspec/config.yaml` `context` says otherwise.
- **Explore runs propose inline.** After the brief, the command reads and follows the installed `openspec-propose` skill in the same thread (`/openspec-propose` in Claude Code, `@openspec-propose` in OpenCode), continuing the existing change and skipping its creation step. During this step it writes `manual.md` from the brief's "Manual steps" in the `tasks-contract` format. Control stays in the explore thread, so the readiness check always runs.
- **The readiness check runs commands, not judgment.** From the repository root, or with `--repo <path>` on the tasks linter when not at the root, it runs `openspec validate <change> --strict` and then `openspec-cascade lint-tasks --changes <change>`.
  - Both exit 0: declare the change "ready for an unattended run" and name `/cascade:cascade-spec-review` as the next gate.
  - Exit 1 from either: enter the fix loop. Show the findings; when the user agrees, fix them through the `openspec-update-change` skill (`/openspec-update-change`, `@openspec-update-change`). Validate findings may need edits in any artifact of the change; tasks linter findings are in `tasks.md`, and a `manual-step` finding moves the step to `manual.md`. Re-run both commands. At most 3 rounds; after the third failed round, stop, list what is left and do not declare the change ready.
  - Exit 2 or command not found from the tasks linter: stop, report a tooling problem and print exactly "Update openspec-cascade (forja apply looper) and run /cascade:explore <change> again." This uses no fix round and does not declare the change ready.
- **Re-entry.** `/cascade:explore <change>` on a change that already has `tasks.md` skips investigation, the brief and propose, and goes straight to the readiness check.
- **Brainstorm alias delegates.** `cascade-spec-brainstorm.md` keeps its frontmatter `name`, `category` and `tags`; its description becomes "Deprecated alias for /cascade:explore", and its body is exactly one sentence that tells the agent to run `/cascade:explore $ARGUMENTS`, with no headings. The brainstorm-only content tests are replaced by the explore tests and an alias test.
- **Review precondition.** In `cascade-spec-review.md`, step 1 gets a second bullet right after the `design.md` check and before the EGM check. In this order: if `tasks.md` is missing, stop and point to `/openspec-propose` (`@openspec-propose`); run `openspec-cascade lint-tasks --changes <change>` from the repository root, and on exit 1 show the findings and stop; on exit 2 or command not found, stop, report a tooling problem and print exactly "Update openspec-cascade (forja apply looper) and run /cascade:cascade-spec-review <change> again." There is no override.
- **Docs.** In `docs/cli.md` (Spanish), the EGM flow block gains `/cascade:setup` as its first line, its brainstorm line is replaced by `/cascade:explore <change> <idea>` with its outputs (brief, artifacts, `manual.md`, readiness check), and the `/openspec-propose` line is dropped because explore runs propose inline. A bullet after the block gives the OpenCode flow: `@openspec-propose`, then `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`. Short command names in the block and in the plugin command list are converted to the `/cascade:` form, and `explore` joins that list. In `README.md` (English) the bullet naming `/cascade-spec-brainstorm` is rewritten around `/cascade:explore`, `/cascade:cascade-spec-review` and `/cascade:cascade-spec-drift`, with brainstorm named as a deprecated alias. Both docs say that re-running `/cascade:explore <change>` on a change with `tasks.md` goes straight to the readiness check, and that read-only investigation is a prompt rule whose hard limits are the IAM policy of the declared AWS profile and the sandbox. Doc checks use `bun -e` with `includes`, because the harness never runs `grep`.

## Alternatives Considered

- **Extend brainstorm in place vs a new command.** Extending `cascade-spec-brainstorm.md` keeps one file but keeps a name that describes only part of the flow, and `/cascade:cascade-spec-brainstorm` is long. Chosen: a new `explore.md`, with brainstorm as an alias.
- **Runtime guard hook vs prompt rules.** A PreToolUse hook could block non-allowlisted AWS and MCP calls, but it is runtime code, differs between Claude Code and OpenCode, and duplicates IAM. Chosen: prompt rules, with IAM on the profile and the sandbox as the hard limits.
- **Explore calls propose inline vs a hand-over.** A hand-over loses control, so the readiness check may never run. Chosen: inline, in the same thread.
- **Tasks linter check only in review vs in both.** Checking only in review finds problems one step late. Chosen: both; explore fixes, review guards.
- **Alias delegating vs redirecting.** A redirect that only prints the new name breaks muscle memory and scripts. Chosen: delegate, so the old name keeps working.
- **Brief headings in prose vs in a fenced template.** Headings written as live `##` lines would collide with the command's own sections. Chosen: one fenced template, with other sections quoting the names.

## Migration Plan

- The alias ships in this change. Old invocations of `/cascade:cascade-spec-brainstorm <change> <idea>` run `/cascade:explore` with the same arguments.
- Existing changes with a `brief.md` from brainstorm are compatible: explore reuses the folder on a yes, or re-enters at the readiness check when `tasks.md` exists.
- Rollback: restore the previous `cascade-spec-brainstorm.md` and drop `explore.md`; no data or config migrates.
- Removing the alias is a later change once the docs have pointed to `/cascade:explore` for one release.

## Risks / Trade-offs

- [AWS or `gh` output leaks into the brief: account IDs, ARNs, secrets in logs or environment variables] → Secret-bearing, credential-minting and environment-returning calls are excluded, logs are limited with `--log-failed`, and the brief redacts account IDs, ARNs and secrets. Residual risk: a secret printed in a CI log line can still reach the conversation context, though not the brief.
- [The model ignores the allowlist] → IAM on the declared profile and the sandbox are the real limits. "Sources consulted" lists every command run, so a violation shows up in review.
- [Missing tools: no manifest, no aws entry, no `gh`, no Linear MCP, no EGM] → Each case has a stated fallback (continue with a note, make no AWS calls, ask for pasted text, skip the review offer and suggest `claude plugin install egm@egm`), and "Sources consulted" marks the entry unavailable.
- [Outdated `openspec-cascade` without `lint-tasks`] → Exit 2 or command not found is a tooling problem with a fixed upgrade sentence, never a fix round.
- [The fix loop does not converge] → Bounded at 3 rounds; after that the command stops without declaring ready.
- [The OpenSpec skills change shape] → The command says "read and follow them" plus its own overrides, so changes flow through; a new conflicting rule is caught by the precedence order.
- [Content tests couple to literals] → The literals are listed in tasks.md and placed by this design, so a rewording that breaks a test is visible in the same change.
