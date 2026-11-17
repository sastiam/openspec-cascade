# Spec Delta

## Purpose

Records which MCP servers, skills, plugins and CLI tools a project uses and when to use them, in a global layer and a project layer, so that planning can rely on them without the user repeating it.

## ADDED Requirements

### Requirement: Manifest locations
The global manifest SHALL be read from `$XDG_CONFIG_HOME/openspec-cascade/manifest.json`, or from `~/.config/openspec-cascade/manifest.json` when `XDG_CONFIG_HOME` is unset or empty. The project manifest SHALL be read from the `manifest` key of `.openspec-cascade.json`. Both SHALL hold a list `entries`.

#### Scenario: XDG config home
- **WHEN** `XDG_CONFIG_HOME` is `/tmp/cfg` and `/tmp/cfg/openspec-cascade/manifest.json` has one entry
- **THEN** the global layer has that entry

#### Scenario: Empty XDG config home
- **WHEN** `XDG_CONFIG_HOME` is the empty string and the home folder is `/tmp/home`
- **THEN** the global manifest is read from `/tmp/home/.config/openspec-cascade/manifest.json`

### Requirement: Manifest merge
The merged manifest SHALL contain every entry from both layers, sorted by name then type, each tagged with its layer. A project entry SHALL replace the global entry with the same `name` and `type`. A missing global file or a missing `manifest` key SHALL count as an empty layer.

#### Scenario: Project overrides global
- **WHEN** the global layer has `watson` of type `mcp` with one `whenToUse` and the project layer has `watson` of type `mcp` with another
- **THEN** the merged manifest has one `watson` `mcp` entry, with the project's `whenToUse` and layer `project`

#### Scenario: Same name, different type
- **WHEN** the global layer has `engram` of type `cli` and the project layer has `engram` of type `mcp`
- **THEN** the merged manifest has both entries

#### Scenario: Missing layers
- **WHEN** there is no global file and no `manifest` key
- **THEN** the merged manifest is empty and no error is raised

### Requirement: Manifest entry fields
Each entry SHALL have `name` (non-empty, one line), `type` (`mcp`, `skill`, `plugin` or `cli`), `whenToUse` (non-empty, one line, at most 200 characters) and `required` (boolean, default false). It MAY have `check` (one command), `profile` (a non-secret name of letters, digits, `.`, `_` or `-`) and `hosts` (a list of `claude-code` and `opencode` without duplicates). Unknown fields SHALL be rejected.

#### Scenario: Unknown type
- **WHEN** a global entry `watson` has type `service`
- **THEN** loading fails with an error that starts with `global layer:` and names `watson`

#### Scenario: whenToUse too long
- **WHEN** a project entry `stitch`'s `whenToUse` has 201 characters
- **THEN** loading fails with an error that starts with `project layer:` and names `stitch`

#### Scenario: Profile and hosts
- **WHEN** an entry is `aws` of type `cli` with `profile` `readonly` and `hosts` `["claude-code"]`
- **THEN** loading succeeds and the merged entry keeps both fields

### Requirement: Manifest load errors
A manifest that fails to load SHALL raise an error whose message starts with `global layer:` or `project layer:`. When the problem is in one entry, the message SHALL name it by its `name`, or by `entry #<index>` (zero-based) when it has no usable name. The message SHALL NOT include the JSON parser's own text.

#### Scenario: Entry without a name
- **WHEN** the third entry of the project layer has no `name`
- **THEN** loading fails with an error that starts with `project layer:` and contains `entry #2`

#### Scenario: Invalid JSON file
- **WHEN** the global manifest file is not valid JSON
- **THEN** loading fails with an error that starts with `global layer:`

### Requirement: Manifest entry uniqueness
Entries SHALL be unique by `name` and `type` within a layer. A duplicate SHALL make loading fail with an error naming the layer and the entry.

#### Scenario: Duplicate in one layer
- **WHEN** the project layer has two `stitch` entries of type `mcp`
- **THEN** loading fails with an error naming the project layer and `stitch`

### Requirement: Check command rules
A `check` SHALL be trimmed and split on runs of whitespace into a program and its arguments. A `check` that is blank, or contains a quote, a `$`, or a shell control operator (`;`, `&`, `|`, a backtick, `<`, `>` or a line break), SHALL make loading fail with an error naming the layer and the entry.

#### Scenario: Unsafe check command
- **WHEN** an entry's `check` is `aws sts get-caller-identity; rm -rf x`
- **THEN** loading fails with an error naming the entry

#### Scenario: Quoted check command
- **WHEN** an entry's `check` is `sh -c "id"`
- **THEN** loading fails with an error naming the entry

### Requirement: Runs ignore the manifest
The run configuration loader SHALL accept any value under the `manifest` key of `.openspec-cascade.json` without validating it. Strict manifest validation SHALL happen only in `setup` and `doctor`.

#### Scenario: Broken manifest during a run
- **WHEN** `.openspec-cascade.json` has a valid run configuration and `manifest` is `{"entries": 5}`
- **THEN** loading the run configuration succeeds

### Requirement: Claude Code discovery sources
`setup discover` SHALL list MCP server keys from the top-level `mcpServers` of `~/.claude.json`, from `projects[key].mcpServers` where the real path of `key` equals the real path of the repository or of its main worktree root, and from `<repo>/.mcp.json`. It SHALL list skills in `~/.claude/skills` and `<repo>/.claude/skills`.

#### Scenario: Project key through a symlink
- **WHEN** `~/.claude.json` has `projects` keyed by a symlink to the repository, with MCP server `stitch`
- **THEN** discovery lists `stitch` of type `mcp`

#### Scenario: Project key of the main worktree
- **WHEN** discovery runs in a linked worktree and `projects` is keyed by the main worktree root, with MCP server `stitch`
- **THEN** discovery lists `stitch` of type `mcp`

### Requirement: Claude Code project key matching
When the git common folder of the repository cannot be found, discovery SHALL match `projects` keys against the repository only. A `projects` key whose real path cannot be resolved SHALL be ignored without a skipped item.

#### Scenario: No git common folder
- **WHEN** the git common folder cannot be found and `projects` is keyed by another folder, with MCP server `stitch`
- **THEN** discovery does not list `stitch`

#### Scenario: Stale project key
- **WHEN** `projects` has a key for a folder that no longer exists, with MCP server `ghost`
- **THEN** discovery does not list `ghost`, reports nothing skipped for it, and exits 0

### Requirement: Claude Code plugin discovery
`setup discover` SHALL read `enabledPlugins` from `~/.claude/settings.json`, `<repo>/.claude/settings.json` and `<repo>/.claude/settings.local.json`, in that order, a later file overriding an earlier one for the same key. It SHALL list each plugin whose final value is true, named by the part of its key before `@`.

#### Scenario: Project-enabled plugin
- **WHEN** only `<repo>/.claude/settings.local.json` enables `design@market`
- **THEN** discovery lists `design` of type `plugin`

#### Scenario: Project disables a global plugin
- **WHEN** `~/.claude/settings.json` enables `egm@market` and `<repo>/.claude/settings.json` sets it to false
- **THEN** discovery does not list `egm` as a plugin

### Requirement: OpenCode discovery sources
`setup discover` SHALL list keys of `mcp` in `$XDG_CONFIG_HOME/opencode/opencode.json` or `opencode.jsonc` and in `<repo>/opencode.json` or `<repo>/opencode.jsonc`; when both exist in one place, `.json` SHALL win. It SHALL list skills in `$XDG_CONFIG_HOME/opencode/skill(s)/*/SKILL.md` and `<repo>/.opencode/skill(s)/*/SKILL.md`.

#### Scenario: OpenCode skill
- **WHEN** the project has `.opencode/skills/design-review/SKILL.md`
- **THEN** discovery lists `design-review` of type `skill` with host `opencode`

#### Scenario: JSONC with a URL and a trailing comma
- **WHEN** `opencode.jsonc` has comments, an MCP server `docs` whose `url` is `https://example.com/mcp`, and a trailing comma
- **THEN** discovery lists `docs` of type `mcp` and its output does not contain `example.com`

### Requirement: CLI tool discovery
`setup discover` SHALL look up each tool of a fixed list on PATH and list each one found as type `cli`.

#### Scenario: gh on PATH
- **WHEN** `gh` is on PATH and `docker` is not
- **THEN** discovery lists `gh` of type `cli` and does not list `docker`

### Requirement: Discovery output
`setup discover --json` SHALL print, as JSON indented with two spaces, `{"candidates":[...],"skipped":[...]}`. Each candidate SHALL have `name`, `type`, `sources`, `hosts` and `inManifest` (`null`, `global` or `project`), merged by `name` and `type`. Each skipped item SHALL have `source` and `reason`.

#### Scenario: Same helper in two hosts
- **WHEN** MCP server `watson` is in `~/.claude.json` and in the global `opencode.json`
- **THEN** discovery prints one `watson` `mcp` candidate whose `hosts` are `claude-code` and `opencode` and whose `sources` list both files

#### Scenario: Already registered
- **WHEN** `gh` of type `cli` is in the global layer and on PATH
- **THEN** its candidate has `inManifest` `global`

#### Scenario: Invalid manifest on discover
- **WHEN** the global manifest has an entry of type `service` and `setup discover` runs
- **THEN** it exits 2 and names the global layer

### Requirement: Discovery source labels
Each discovery source SHALL be shown as a path with `~` for the home folder and `<repo>` for the repository, or `PATH`. A global OpenCode source SHALL be shown under `~` only when `$XDG_CONFIG_HOME` is inside the home folder, and as its absolute path otherwise.

#### Scenario: XDG outside home
- **WHEN** `XDG_CONFIG_HOME` is `/tmp/cfg` and `/tmp/cfg/opencode/opencode.json` declares MCP server `watson`
- **THEN** the source of `watson` is `/tmp/cfg/opencode/opencode.json`

### Requirement: Discovery reads names, never values
Discovery SHALL NOT print environment values, headers, URLs or command arguments of MCP servers, including in error reasons. A source that cannot be read or parsed SHALL be reported as skipped with a fixed reason and SHALL NOT fail the command. A missing source SHALL be ignored.

#### Scenario: MCP server with secrets
- **WHEN** `~/.claude.json` declares an MCP server `watson` with an `env` holding the token `FAKE_TOKEN_1`
- **THEN** discovery lists `watson` of type `mcp` and the output does not contain `FAKE_TOKEN_1`

#### Scenario: Unreadable source
- **WHEN** `opencode.json` is not valid JSON and contains the token `FAKE_TOKEN_2`
- **THEN** discovery still lists the other sources, reports that source as skipped, and the output does not contain `FAKE_TOKEN_2`

### Requirement: Discovery does not see claude.ai connectors
Discovery SHALL NOT claim to find claude.ai connectors. The `/cascade:setup` command SHALL ask whether any helper is missing and register it with `setup add`.

#### Scenario: Missing connector
- **WHEN** the user names a claude.ai connector that discovery did not list
- **THEN** `/cascade:setup` registers it with `setup add`

### Requirement: setup actions
`openspec-cascade setup` SHALL provide `discover`, `add`, `remove`, `show` and `rules`, and accept `--repo`. `discover` and `show` SHALL accept `--json`. `setup` SHALL never install software, edit Claude Code or OpenCode configuration, or store secrets.

#### Scenario: Unknown action
- **WHEN** `setup install` runs
- **THEN** it exits 2 and changes no file

### Requirement: setup add and remove
`setup add` SHALL take `--scope project|global`, `--name`, `--type` and `--when`, all required, and optional `--required`, `--check`, `--profile` and repeatable `--host`. It SHALL upsert by `name` and `type`, replacing an existing entry at its position and appending a new one. `setup remove` SHALL take `--scope`, `--name` and `--type`, and exit 2 when the entry does not exist.

#### Scenario: Add to the project layer
- **WHEN** `setup add --scope project --name stitch --type mcp --when "Before UI tasks, fetch the screen design"` runs
- **THEN** `.openspec-cascade.json` gains that entry under `manifest.entries`, and the other keys keep their values

#### Scenario: Add replaces in place
- **WHEN** the project layer has `aws`, `stitch` and `gh`, and `setup add` runs for `stitch` of type `mcp` with a new `--when`
- **THEN** the entries stay in the order `aws`, `stitch`, `gh` and `stitch` has the new `whenToUse`

#### Scenario: Add without when
- **WHEN** `setup add --scope global --name gh --type cli` runs
- **THEN** it exits 2 and changes no file

#### Scenario: Add creates the global file
- **WHEN** the global manifest folder does not exist and `setup add --scope global --name gh --type cli --when "For CI runs"` runs
- **THEN** the folder and `manifest.json` are created with that entry

### Requirement: setup writes
Every JSON file written by `setup` (`.openspec-cascade.json` and the global manifest) SHALL be written atomically, through a temporary file in the same folder renamed over the target, as two-space JSON with a final line break. `setup rules --write` SHALL write `openspec/config.yaml` atomically in the same way, as its existing text followed by the rules block. When the target file is invalid JSON or holds an invalid manifest, `setup add` and `setup remove` SHALL exit 2 and leave it unchanged.

#### Scenario: Invalid project file
- **WHEN** `.openspec-cascade.json` is not valid JSON and `setup add --scope project ...` runs
- **THEN** it exits 2 and the file is unchanged

### Requirement: setup show
`setup show --json` SHALL print, as JSON indented with two spaces, `{"entries":[...]}`, each entry with its fields and `layer` (`global` or `project`), sorted by name then type. `required` SHALL always be present. Without `--json` it SHALL print one line per entry, `<layer> <type> <name>: <whenToUse>`. An invalid manifest SHALL exit 2.

#### Scenario: Show merged JSON
- **WHEN** `setup show --json` runs with entries in both layers
- **THEN** it prints the merged entries, each with the layer it came from

#### Scenario: Show as text
- **WHEN** the project layer has `stitch` of type `mcp` with `whenToUse` `Before UI tasks, fetch the screen design` and `setup show` runs
- **THEN** it prints the line `project mcp stitch: Before UI tasks, fetch the screen design`

### Requirement: setup exit codes
`setup` SHALL exit 0 on success, 1 when a write is refused because rules already exist, and 2 for a usage error or an invalid manifest. A usage error SHALL print a line starting with `USAGE:` and any other failure a line starting with `STOPPED:`, both on stderr.

#### Scenario: Invalid manifest on show
- **WHEN** the global manifest has an entry of type `service` and `setup show` runs
- **THEN** it exits 2 and prints a `STOPPED:` line naming the global layer

### Requirement: Suggested OpenSpec rules
`setup rules` SHALL print suggested `rules` for `openspec/config.yaml`. The `tasks` rules SHALL require steps an agent can do and verify, send manual steps to `manual.md`, and require read-only investigation before delegating to a human. The `design` rules SHALL require stating the layers, the allowed dependency direction and how dependencies are injected.

#### Scenario: Print rules
- **WHEN** `setup rules` runs without `--write`
- **THEN** it prints a YAML `rules` block with `tasks` and `design` keys that mentions `manual.md`, and changes no file

### Requirement: Writing suggested rules
With `--write`, `setup rules` SHALL append the rules only when `openspec/config.yaml` has no top-level `rules` key, keeping the rest of the file byte for byte. A quoted `rules` key SHALL count as present; a commented-out one SHALL NOT. When the key exists it SHALL leave the file unchanged and exit 1. When the file is missing it SHALL exit 2 with a hint.

#### Scenario: Config without rules
- **WHEN** `openspec/config.yaml` has only comments and `schema: spec-driven`, and `setup rules --write` runs
- **THEN** the file keeps its existing lines and ends with the suggested `rules` block

#### Scenario: Config with rules
- **WHEN** `openspec/config.yaml` already has a `rules` key and `setup rules --write` runs
- **THEN** the file is unchanged and the command exits 1

#### Scenario: Quoted rules key
- **WHEN** `openspec/config.yaml` has a line starting with `"rules":` and `setup rules --write` runs
- **THEN** the file is unchanged and the command exits 1

#### Scenario: Commented-out rules key
- **WHEN** `openspec/config.yaml` has only `# rules:` and `setup rules --write` runs
- **THEN** the rules block is appended and the command exits 0

#### Scenario: Missing config
- **WHEN** `openspec/config.yaml` does not exist and `setup rules --write` runs
- **THEN** it exits 2 with a hint to run `openspec init`

### Requirement: doctor reports manifest entries
`doctor` SHALL report one check per merged entry, whose name shows the entry's layer. An entry without `check` SHALL be `ok` with detail "declared, no check". A failing check SHALL be `fail` when the entry is required and `warn` otherwise. If the manifest fails to load, `doctor` SHALL report one `manifest` check with status `fail` and the reason, and SHALL NOT crash.

#### Scenario: Required entry fails
- **WHEN** a required global entry's check exits non-zero
- **THEN** doctor reports that entry as `fail` and exits 1

#### Scenario: Optional entry fails
- **WHEN** an optional global entry's check exits non-zero
- **THEN** doctor reports it as `warn` and the entry alone does not make doctor exit 1

#### Scenario: Broken manifest
- **WHEN** the global manifest is not valid JSON
- **THEN** doctor reports a `manifest` check with status `fail` and still reports its other checks

### Requirement: doctor runs project checks only on request
`doctor` SHALL run the `check` of global entries by default. It SHALL run the `check` of project entries only with `--run-project-checks`; otherwise it SHALL report them `ok` with a detail saying the check was not run.

#### Scenario: Project check without the flag
- **WHEN** a project entry has a `check` and `doctor` runs without `--run-project-checks`
- **THEN** the check command is not started and the entry is reported with a detail saying it was not run

#### Scenario: Project check with the flag
- **WHEN** the same `doctor` runs with `--run-project-checks`
- **THEN** the check command is started

### Requirement: doctor check execution
Each check SHALL run without a shell, with stdin closed, with the current environment plus `AWS_PAGER` set to empty, in the repository folder, and with a 15-second timeout. A timeout (detail `timed out`), a missing program (detail `not found`) or a non-zero exit (detail `exit <code>`) SHALL count as a failing check. `doctor` SHALL NOT enforce that a check is read-only.

#### Scenario: Check times out
- **WHEN** a required entry's check does not finish within 15 seconds
- **THEN** doctor stops it and reports the entry as `fail` with detail "timed out"

#### Scenario: Missing program
- **WHEN** an optional global entry's check names a program that does not exist
- **THEN** doctor reports the entry as `warn` with detail `not found`

#### Scenario: Check environment
- **WHEN** an entry's check runs
- **THEN** the spawner receives the split argv, no stdin, an environment where `AWS_PAGER` is empty and `PATH` equals the current `PATH`, and a 15-second timeout

### Requirement: doctor manifest paths are injected
`runDoctor` SHALL take the manifest paths `{home, xdgConfigHome}` from its dependencies and SHALL read the real home folder and `XDG_CONFIG_HOME` only when none are given.

#### Scenario: Injected paths
- **WHEN** a test calls `runDoctor` with manifest paths in a temporary folder
- **THEN** doctor reads the global manifest from that folder only
