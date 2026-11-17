# Spec Delta

## Purpose

Defines the `/cascade:explore` planning command (`plugins/cascade/commands/explore.md`): it turns a Linear issue or an idea into a brief inside the change after read-only investigation that uses the project's manifest, follows the propose skill in the same thread, and declares the change ready for an unattended run only when its tasks pass the tasks linter.

## ADDED Requirements

### Requirement: Inputs and change folder
`/cascade:explore` SHALL take a kebab-case change name and an idea or a Linear issue link. It SHALL create the change with `openspec new change` only after a yes/no confirmation, and SHALL reuse an existing change folder when the user says so. Every file it writes SHALL be inside `openspec/changes/<change>/`, never in `docs/designs/`.

#### Scenario: Existing change
- **WHEN** `openspec/changes/<change>/` already exists without `tasks.md`
- **THEN** the command asks whether to reuse it and, on yes, writes `brief.md` there without running `openspec new change`

### Requirement: Re-entry at the readiness check
When `openspec/changes/<change>/tasks.md` already exists, `/cascade:explore <change>` SHALL skip investigation, the brief and the propose step, and SHALL go straight to the readiness check.

#### Scenario: Change already has tasks
- **WHEN** the user runs `/cascade:explore <change>` and the change has `tasks.md`
- **THEN** the command runs the readiness check without writing a new brief

### Requirement: Preconditions
The command SHALL stop when the project has no OpenSpec root, and SHALL stop naming `~/.claude/skills/openspec-explore/SKILL.md` when that skill is missing. When `openspec-cascade setup show --json` fails it SHALL continue and note "no manifest" in the brief. It SHALL state that it is Claude Code only and that OpenCode users follow the docs.

#### Scenario: Manifest command fails
- **WHEN** `openspec-cascade setup show --json` exits non-zero
- **THEN** the command continues and the brief says no manifest was found

### Requirement: Review tooling checked late
The command SHALL check the EGM brainstorm glob at the readiness gate, before offering the Goldfish review, and SHALL NOT offer the review when it does not match. It SHALL check subagent support only after the user accepts the review.

#### Scenario: EGM not installed
- **WHEN** the EGM brainstorm glob does not match at the gate
- **THEN** the command does not offer the review and records why in the brief

### Requirement: Precedence of instructions
The command SHALL apply cascade overrides first, then the EGM brainstorm skill, then the `openspec-explore` skill. Its overrides SHALL allow a fixed brief format, allow `brief.md` and `manual.md` as non-schema files in the change, and use a single readiness gate. It SHALL read both skills, never edit them, and never invoke EGM through the Skill tool.

#### Scenario: Conflicting skill rule
- **WHEN** the explore skill says to avoid fixed formats and the command writes the brief
- **THEN** the brief uses the fixed section list, because cascade overrides win

### Requirement: Linear issues are read through the MCP
When the input is a Linear issue link and the session has a Linear MCP, the command SHALL read the issue through it before asking anything. Without one, it SHALL ask the user to paste the issue text.

#### Scenario: Linear link with MCP
- **WHEN** the input is a Linear issue URL and a Linear MCP is available
- **THEN** the command reads the issue title, description and comments through the MCP and uses them as the starting intent

### Requirement: The manifest guides which helpers to use
The command SHALL load the merged manifest with `openspec-cascade setup show --json` and SHALL consult each entry whose `whenToUse` applies to the change.

#### Scenario: Watson in the manifest
- **WHEN** the manifest has `watson` with `whenToUse` "before proposing, to look up how other work repos solved it"
- **THEN** the command queries Watson before writing the brief and lists it under "Sources consulted" as used

### Requirement: Sources consulted
The brief's "Sources consulted" section SHALL list every manifest entry marked used, not applicable with a one-line reason, or unavailable, and SHALL list every CLI command the command ran.

#### Scenario: Entry not applicable
- **WHEN** the manifest has a design-system MCP and the change has no UI
- **THEN** "Sources consulted" lists it as not applicable with a one-line reason

### Requirement: Investigate read-only before asking
Before asking the user a question, the command SHALL try to answer it read-only from the repository and the manifest's tools. It SHALL ask only what remains unknown, one focused question per message. During investigation it SHALL run only what the read-only allowlist permits.

#### Scenario: Fact found in the repo
- **WHEN** the answer to a question is in the repository's config
- **THEN** the command reads it and does not ask the user

### Requirement: AWS allowlist
The command SHALL call AWS only with the `profile` of the manifest's aws entry and only `describe-*`, `list-*` and `get-*` verbs. It SHALL NOT call `secretsmanager`, `ssm` with `--with-decryption`, `kms decrypt`, `sts assume-role`, or any call that writes a local file. Without an aws entry that has a profile it SHALL make no AWS calls and record that in the brief.

#### Scenario: No AWS profile declared
- **WHEN** the manifest has no aws entry with a `profile`
- **THEN** the command makes no AWS calls and the brief says so

### Requirement: MCP, gh and git allowlist
The command SHALL call only MCP tools whose names start with `get_`, `list_`, `search_`, `read_`, `fetch`, `query` or `view`. For `gh` it SHALL use only `gh run list --limit`, `gh run view --log-failed` and `gh workflow view`. For git it SHALL use only read commands.

#### Scenario: MCP write tool available
- **WHEN** an MCP server offers a tool named `create_issue`
- **THEN** the command does not call it during investigation

### Requirement: The command's own writes
The command file SHALL list its own writes separately from the allowlist: `openspec new change` after the yes/no, files inside `openspec/changes/<change>/`, and the propose and update-change skills. It SHALL state that the hard limits are the IAM policy of the profile and the sandbox, and that the prompt states the rule.

#### Scenario: Writes listed apart
- **WHEN** a reader opens the command file
- **THEN** the allowlist and the command's own writes are under separate headings

### Requirement: Deploy and CI inventory
The command SHALL always read `.github/workflows/*`, deploy scripts and IaC in the repository, whether or not `gh` is in the manifest. The "Deploy and CI risks" section SHALL cite the inspected files and runs, including when it says the section does not apply.

#### Scenario: Change without deploy impact
- **WHEN** a change only touches internal code with no deploy or CI effect
- **THEN** "Deploy and CI risks" says why it does not apply and cites the workflow files inspected

### Requirement: Context budget and redaction
The command SHALL prefer bounded output (`--limit`, `--log-failed`, AWS `--query` and `--max-items`), SHALL summarize findings into the brief as it goes, and SHALL restate the overrides before writing the brief. The brief SHALL NOT contain account IDs, ARNs or secrets.

#### Scenario: ARN in a finding
- **WHEN** an AWS describe call returns a resource ARN
- **THEN** the brief refers to the resource by name with the ARN redacted

### Requirement: Brief format
The brief SHALL be `openspec/changes/<change>/brief.md`, in English unless `openspec/config.yaml` `context` says otherwise, with these sections in order: Overview, Sources consulted, Findings, Deploy and CI risks, Manual steps, Goals and Non-Goals, Alternatives weighed, Decisions, Open questions.

#### Scenario: Brief sections
- **WHEN** the command writes a brief
- **THEN** the brief has every section listed above, in that order

### Requirement: Goldfish review only on confirmation
The command SHALL summarize the working hypothesis and SHALL offer the EGM Goldfish review at the single readiness gate. It SHALL run the review only when the user confirms.

#### Scenario: User skips the review
- **WHEN** the user declines the Goldfish review at the gate
- **THEN** the command writes the brief without running reviewers and says so in the brief

### Requirement: Propose in the same thread
After the brief, the command SHALL read and follow the installed `openspec-propose` skill in the same thread, skipping its creation step because the change exists. During that step it SHALL write `manual.md` from the brief's manual steps: top-level list items, each with an indented `Check:` line, no checkboxes.

#### Scenario: Brief with a manual step
- **WHEN** the brief lists a manual step
- **THEN** `manual.md` has it as a top-level item with an indented `Check:` line, and `tasks.md` does not

### Requirement: Ready only when tasks pass the tasks linter
After propose, the command SHALL run `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`. It SHALL declare the change ready for an unattended run only when the last run of both exits 0, and SHALL name `/cascade:cascade-spec-review` as the next gate.

#### Scenario: Both checks pass
- **WHEN** both commands exit 0
- **THEN** the command declares the change ready and names `/cascade:cascade-spec-review`

### Requirement: Bounded fix loop
When a readiness command fails, the command SHALL show the findings, fix the tasks through the `openspec-update-change` skill only when the user agrees, and re-run both commands, at most 3 rounds. After the third failed round it SHALL stop without declaring the change ready.

#### Scenario: Manual step in tasks
- **WHEN** the generated tasks contain "Deploy to staging"
- **THEN** the command reports the `manual-step` finding, offers to move it to `manual.md`, and does not declare the change ready until a re-run passes

### Requirement: Brainstorm alias
`cascade-spec-brainstorm.md` SHALL have the description "Deprecated alias for /cascade:explore" and its body SHALL run `/cascade:explore $ARGUMENTS` and do nothing else.

#### Scenario: Old command name
- **WHEN** the user runs `/cascade:cascade-spec-brainstorm <change> <idea>`
- **THEN** the agent runs `/cascade:explore` with the same arguments

### Requirement: Review precondition on tasks
Before any reviewer starts, `/cascade:cascade-spec-review` SHALL stop and point to `/openspec-propose` when `tasks.md` is missing, SHALL show the findings and stop when `openspec-cascade lint-tasks --changes <change>` exits 1, and SHALL report a tooling problem with an upgrade hint when it exits 2 or is not found. There is no override.

#### Scenario: Old binary without lint-tasks
- **WHEN** `openspec-cascade lint-tasks` is not found
- **THEN** the review stops and reports a tooling problem with an upgrade hint
