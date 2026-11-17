# Spec Delta

## Purpose

Records which MCP servers, skills, plugins and CLI tools a project uses and when to use them, in a global layer and a project layer, so that planning can rely on them without the user repeating it.

## ADDED Requirements

### Requirement: Manifest locations
The global manifest SHALL be read from `$XDG_CONFIG_HOME/openspec-cascade/manifest.json`. When `XDG_CONFIG_HOME` is unset, it SHALL be read from `~/.config/openspec-cascade/manifest.json`. The project manifest SHALL be read from the `manifest` key of `.openspec-cascade.json`. Both hold a list `entries`.

#### Scenario: XDG config home
- **WHEN** `XDG_CONFIG_HOME` is `/tmp/cfg` and `/tmp/cfg/openspec-cascade/manifest.json` has one entry
- **THEN** the global layer has that entry

### Requirement: Manifest merge
The merged manifest SHALL contain every entry from both layers. A project entry SHALL replace the global entry with the same name. A missing global file or a missing `manifest` key SHALL count as an empty layer.

#### Scenario: Project overrides global
- **WHEN** the global layer has `watson` with one `whenToUse` and the project layer has `watson` with another
- **THEN** the merged manifest has one `watson` entry, with the project's `whenToUse`

#### Scenario: Missing layers
- **WHEN** there is no global file and no `manifest` key
- **THEN** the merged manifest is empty and no error is raised

### Requirement: Manifest entry shape
Each entry SHALL have:
- `name`: non-empty, unique within its layer;
- `type`: one of `mcp`, `skill`, `plugin` or `cli`;
- `whenToUse`: one non-empty sentence;
- `required`: a boolean that defaults to false;
- `check`: optional, a single command without shell control operators.

An entry that breaks these rules SHALL make loading fail with an error naming the layer and the entry.

#### Scenario: Unsafe check command
- **WHEN** an entry's `check` is `aws sts get-caller-identity; rm -rf x`
- **THEN** loading fails with an error naming the entry

#### Scenario: Unknown type
- **WHEN** an entry has type `service`
- **THEN** loading fails with an error naming the entry

### Requirement: Discovery sources
`setup discover` SHALL list candidates found in:
- Claude Code: MCP servers in `~/.claude.json` (global and current project) and the project `.mcp.json`; skills in the global and project `skills` folders; enabled plugins in `~/.claude/settings.json`.
- OpenCode: MCP servers in its global and project `opencode.json`; skills in its global and project skill folders.
- CLI tools from a fixed list, looked up on PATH.

#### Scenario: OpenCode skill
- **WHEN** the project has an OpenCode skill folder with `design-review/SKILL.md`
- **THEN** discovery lists `design-review` of type `skill` from OpenCode

### Requirement: Discovery reads names, never values
Each candidate SHALL report its name, type, source, and the manifest layer it is already in, if any. Discovery SHALL NOT output environment values, headers, URLs, or command arguments of MCP servers. A missing or unreadable source SHALL be reported as skipped and SHALL NOT fail the command.

#### Scenario: MCP server with secrets
- **WHEN** `~/.claude.json` declares an MCP server `watson` with an `env` holding a token
- **THEN** discovery lists `watson` of type `mcp` from Claude Code and the output contains no part of the token

#### Scenario: Unreadable source
- **WHEN** `opencode.json` is not valid JSON
- **THEN** discovery still lists the other sources and reports that source as skipped

### Requirement: setup subcommand
`openspec-cascade setup` SHALL provide these actions:
- `discover`
- `add`: upsert one entry into `--scope project` or `--scope global`
- `remove`: one entry, by name and scope
- `show`: the merged manifest
- `rules`

`discover` and `show` SHALL accept `--json`. Exit codes SHALL be 0 on success and 2 for invalid usage or an invalid manifest. `setup` SHALL never install software, edit Claude Code or OpenCode configuration, or store secrets.

#### Scenario: Add to the project layer
- **WHEN** `setup add --scope project --name stitch --type mcp --when "Before UI tasks, fetch the screen design"` runs
- **THEN** `.openspec-cascade.json` gains that entry under `manifest.entries`, and the other keys are preserved

#### Scenario: Show merged JSON
- **WHEN** `setup show --json` runs with entries in both layers
- **THEN** it prints the merged entries as JSON, each with the layer it came from

### Requirement: Suggested OpenSpec rules
`setup rules` SHALL print suggested `rules` for `openspec/config.yaml`. The `tasks` rules SHALL require steps an agent can do and verify, send manual steps to `manual.md`, and require read-only investigation before delegating to a human. The `design` rules SHALL require stating the layers, the allowed dependency direction and how dependencies are injected.

#### Scenario: Print rules
- **WHEN** `setup rules` runs without `--write`
- **THEN** it prints a YAML `rules` block with `tasks` and `design` entries and changes no file

### Requirement: Writing suggested rules
With `--write`, `setup rules` SHALL add the rules only when `openspec/config.yaml` has no `rules` key, and SHALL keep the rest of the file byte for byte. When a `rules` key exists, it SHALL leave the file unchanged, explain why, and exit 1.

#### Scenario: Config without rules
- **WHEN** `openspec/config.yaml` has only comments and `schema: spec-driven`, and `setup rules --write` runs
- **THEN** the file keeps its existing lines and ends with the suggested `rules` block

#### Scenario: Config with rules
- **WHEN** `openspec/config.yaml` already has a `rules` key and `setup rules --write` runs
- **THEN** the file is unchanged and the command exits 1

### Requirement: doctor checks manifest entries
`doctor` SHALL run the `check` of each merged manifest entry that has one. A failing check SHALL be reported as `fail` when the entry is required and as `warn` otherwise. An entry without a `check` SHALL be reported as `ok`, with the detail "declared, no check".

#### Scenario: Required entry fails
- **WHEN** a required entry's check exits non-zero
- **THEN** doctor reports that entry as `fail` and exits 1

#### Scenario: Optional entry fails
- **WHEN** an optional entry's check exits non-zero
- **THEN** doctor reports it as `warn` and the entry alone does not make doctor exit 1
