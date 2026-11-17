# Spec Delta

## Purpose

Defines the `/cascade:explore` planning command: it turns a Linear issue or an idea into a brief inside the change, after read-only investigation that uses the project's manifest, and declares the change ready for an unattended run only when its tasks pass the lint.

## ADDED Requirements

### Requirement: Inputs and change folder
`/cascade:explore` SHALL take a kebab-case change name and an idea or a Linear issue link. It SHALL stop when the project has no OpenSpec root. It SHALL create the change with `openspec new change` only after a yes/no confirmation, and SHALL reuse an existing change folder when the user says so. Every artifact it writes SHALL be inside `openspec/changes/<change>/`, never in `docs/designs/`.

#### Scenario: Existing change
- **WHEN** `openspec/changes/<change>/` already exists
- **THEN** the command asks whether to reuse it and, on yes, writes `brief.md` there without running `openspec new change`

### Requirement: Linear issues are read through the MCP
When the input is a Linear issue link and the session has a Linear MCP, the command SHALL read the issue through it before asking anything. Without one, it SHALL ask the user to paste the issue text.

#### Scenario: Linear link with MCP
- **WHEN** the input is a Linear issue URL and a Linear MCP is available
- **THEN** the command reads the issue title, description and comments through the MCP and uses them as the starting intent

### Requirement: The manifest guides which helpers to use
The command SHALL load the merged manifest with `openspec-cascade setup show --json`. It SHALL consult each entry whose `whenToUse` applies to the change. It SHALL list in the brief every entry it consulted and every required entry it could not use, each with the reason. Without a manifest, it SHALL continue and say in the brief that none was found.

#### Scenario: Watson in the manifest
- **WHEN** the manifest has `watson` with `whenToUse` "before proposing, to look up how other work repos solved it"
- **THEN** the command queries Watson before writing the brief and lists it under "Sources consulted"

### Requirement: Investigate read-only before asking
Before asking the user a question, the command SHALL try to answer it read-only from the repository, the CLI tools and the MCP servers in the manifest. It SHALL ask only what remains unknown, one focused question per message. During explore it SHALL NOT run commands that deploy, write to cloud resources, push, or change files outside the change folder. For AWS it SHALL use only the profile declared in the manifest.

#### Scenario: CI question answered by reading
- **WHEN** the change touches a GitHub Actions deploy and the manifest declares `gh`
- **THEN** the command reads the workflow files and recent runs with `gh` before asking anything about CI

### Requirement: Brief format
The brief SHALL be `openspec/changes/<change>/brief.md`, written in English unless `openspec/config.yaml` `context` says otherwise. It SHALL contain these sections:
- Overview
- Sources consulted
- Findings
- Deploy and CI risks
- Manual steps
- Goals and Non-Goals
- Alternatives weighed
- Decisions
- Open questions

#### Scenario: Brief sections
- **WHEN** the command writes a brief
- **THEN** the brief has every section listed above, in that order

### Requirement: Deploy risks and manual steps are always addressed
The "Deploy and CI risks" section SHALL always be present, with one line explaining why when it does not apply. The "Manual steps" section SHALL list human-only steps for `manual.md`, each with a read-only check.

#### Scenario: Change without deploy impact
- **WHEN** a change only touches internal code with no deploy or CI effect
- **THEN** the brief still has "Deploy and CI risks", with one line saying why it does not apply

### Requirement: Goldfish review only on confirmation
The command SHALL summarize the working hypothesis and SHALL offer the EGM Goldfish review at a single readiness gate. It SHALL run the review only when the user confirms. It SHALL follow the installed EGM brainstorm skill by reading it, never through the Skill tool.

#### Scenario: User skips the review
- **WHEN** the user declines the Goldfish review at the gate
- **THEN** the command writes the brief without running reviewers and says so in the brief

### Requirement: Ready only when tasks pass the lint
After the hand-over to `/openspec-propose` (Claude Code) or `@openspec-propose` (OpenCode) produces the change's tasks, the command SHALL run `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`. It SHALL declare the change ready for an unattended run only when both pass. Otherwise it SHALL list the findings and the fix for each. The next gate it names SHALL be `/cascade-spec-review`.

#### Scenario: Manual step in tasks
- **WHEN** the generated tasks contain "Deploy to staging"
- **THEN** the command reports the `manual-step` finding, suggests moving it to `manual.md`, and does not declare the change ready

### Requirement: Brainstorm alias and review precondition
`/cascade-spec-brainstorm` SHALL point to `/cascade:explore` and SHALL do nothing else. `/cascade-spec-review` SHALL stop with the findings when `lint-tasks` fails for the change.

#### Scenario: Old command name
- **WHEN** the user runs `/cascade-spec-brainstorm`
- **THEN** it tells the user to use `/cascade:explore` with the same arguments
