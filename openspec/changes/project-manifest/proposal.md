# Proposal

## Why

Planning and execution need to know what each project can use and when to use it:
- global helpers (Watson, EGM, codebase-memory, engram, rtk, gh, the AWS CLI);
- project-only helpers (Stitch and the design-system MCP for a frontend, a read-only AWS profile for a backend).

Today nothing records this. Each explore session relies on the user remembering to say "consult Watson" or "follow the Stitch design", and the frontend case showed that this is not enough. Roadmap piece 5 defines the answer: a manifest with a global layer and a project layer, and a `setup` that discovers and registers but never installs.

## What Changes

- **Manifest, two layers.**
  - Global: `$XDG_CONFIG_HOME/openspec-cascade/manifest.json` (default `~/.config/openspec-cascade/manifest.json`).
  - Project: a `manifest` key in `.openspec-cascade.json`.
  - Both hold `entries`. Each entry has `name`, `type` (`mcp`, `skill`, `plugin`, `cli`), `whenToUse` (one sentence), `required` (default false) and an optional read-only `check` command.
  - A project entry replaces a global entry with the same name. No secrets: only names.
- **`openspec-cascade setup`**, a new subcommand. It discovers and registers, and never installs. Its actions:
  - `discover` lists candidates from:
    - Claude Code: MCP servers in `~/.claude.json` and the project's `.mcp.json`; skills in `~/.claude/skills` and `.claude/skills`; enabled plugins in `~/.claude/settings.json`.
    - OpenCode: MCP servers in `opencode.json`, global and project; skills in its skill folders.
    - A fixed list of CLI tools found on PATH.

    It marks which candidates are already in the manifest. It reads names only, never values.
  - `add` and `remove` write one entry to the project or global layer.
  - `show` prints the merged manifest, as text or JSON.
  - `rules` prints suggested `rules` for `openspec/config.yaml`, and with `--write` adds them when the file has no `rules` key. The rules say three things: tasks must be things an agent can do and verify; investigate read-only before delegating to a human; and design.md states layers and dependency injection.
- **`/cascade:setup`**, a Claude Code plugin command. It runs `discover`, proposes what to include, lets the user choose and write a `whenToUse` for each, calls `add`, and then offers `rules`.
- **`doctor`** reports each manifest entry that has a `check`: failing required entries are `fail`, failing optional entries are `warn`.

## Capabilities

### New Capabilities
- `project-manifest`: the global and project manifest, its discovery, its registration commands and its doctor checks.

### Modified Capabilities

None.

## Impact

- New: `src/manifest/` (types, load and merge, discovery, rules template), `src/cli/setup.ts`, `plugins/cascade/commands/cascade-setup.md`, tests under `test/manifest/` and `test/cli/setup.test.ts`.
- Modified:
  - `src/config/schemas.ts`: `manifest` key in the strict file schema.
  - `src/config/constants.ts`: `setup` subcommand, paths, CLI tool list.
  - `src/cli/commands.ts`: dispatch, doctor checks.
  - `docs/cli.md`, `README.md`.
- No change to runs. The manifest is read by planning (`cascade-explore`) and by `doctor`.
