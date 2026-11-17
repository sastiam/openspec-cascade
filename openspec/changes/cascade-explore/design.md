# Design

## Context

- **Existing commands.** Plugin commands are Markdown prompts in `plugins/cascade/commands/`. `cascade-spec-brainstorm.md` already wraps EGM's brainstorm: preconditions, scaffold after a yes/no, read the EGM skill (never through the Skill tool), write `brief.md` in the change, and hand over to `/openspec-propose`.
- **Content tests.** `test/plugin/egm_commands.test.ts` checks the commands' content:
  - the frontmatter;
  - OpenSpec skills named in both the `/` and `@` forms, with no `/opsx`;
  - writes only inside the change folder;
  - the EGM skill is read, not invoked.
- **The installed OpenSpec explore skill.** It lives in `~/.claude/skills/openspec-explore/SKILL.md`. Roadmap rule 7 says cascade wraps it and never edits it.
- **Dependencies.** `project-manifest` provides `setup show --json`, and `tasks-contract` provides the `manual-step` rule.

## Goals / Non-Goals

**Goals:**
- One planning command with a testable prompt contract.
- The brainstorm command reduced to an alias.
- The review command gains a lint precondition.

**Non-Goals:**
- Runtime code.
- Reading Linear without an MCP.
- Enforcing read-only access by code. It is enforced by the prompt, by the sandbox, and by the read-only AWS profile the user declares.
- Changing `/openspec-propose`.

## Decisions

- **Explore wraps OpenSpec explore and absorbs the brainstorm steps.** The command file has these sections, in order:
  1. Usage.
  2. Preconditions: an OpenSpec root, a change name, and subagents available only if the Goldfish review is taken.
  3. Load context: read the installed `openspec-explore` skill and follow it; load the manifest; read Linear.
  4. Investigate before asking, with the read-only rules.
  5. Hypothesis and the single readiness gate, with the Goldfish review on confirmation, following the EGM brainstorm skill as the current command does.
  6. Write `brief.md` with the fixed sections.
  7. Hand over to propose.
  8. Readiness check: `openspec validate --strict` and `lint-tasks`.
  9. Report.

  The EGM overrides of the current brainstorm command move here unchanged: the artifact directory is the change, the brief is `brief.md`, there is no `egm-draft`, and the RFC publish option is forbidden.
- **The read-only rules are written as an allowlist.** Read files. Query MCP servers. Run CLI tools from the manifest only with read verbs: `aws … describe*`, `list*` and `get*` with the declared profile, and `gh run list`, `gh run view` and `gh workflow view`. Edit nothing outside the change folder. An allowlist is easier for a model to follow than a denylist.
- **Questions go one per message, open-ended.** The command does not use multiple-choice tools during the investigation. It may use them only at the readiness gate, matching EGM's own rule.
- **The readiness check runs commands, not judgment.** After propose, the command runs `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`. It quotes their output and fixes the tasks with `openspec-update-change` when the user agrees. The exit codes decide "ready".
- **The brainstorm alias keeps the old name working.** `cascade-spec-brainstorm.md` keeps its frontmatter, and its body is reduced to one paragraph pointing to `/cascade:explore`. `test/plugin/egm_commands.test.ts` drops brainstorm from its EGM command table and adds an alias test. A new describe block covers `cascade-explore` with the shared checks plus explore-specific ones: it names `setup show --json`, `lint-tasks`, the brief sections and `openspec-explore`.
- **The review precondition is one bullet in the existing list.** In `cascade-spec-review.md`, `openspec-cascade lint-tasks --changes <change>` must exit 0. Otherwise the command stops and prints the findings.

## Risks / Trade-offs

- [The model ignores the read-only allowlist] → The sandbox and a read-only AWS profile are the real limits. The prompt states the rule, and the brief must list every command used under "Sources consulted", so a violation shows up in review.
- [The OpenSpec explore skill changes shape] → The command only says "read and follow it" plus its own overrides, so changes in the skill flow through.
