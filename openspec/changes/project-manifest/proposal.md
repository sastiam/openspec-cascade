# Proposal

## Why

Planning and execution need to know what each project can use and when to use it:
- global helpers (Watson, EGM, codebase-memory, engram, rtk, gh, the AWS CLI);
- project-only helpers (Stitch and the design-system MCP for a frontend, a read-only AWS profile for a backend).

Today nothing records this. Each explore session relies on the user remembering to say "consult Watson" or "follow the Stitch design", and the frontend case showed that this is not enough. Roadmap piece 5 defines the answer: a manifest with a global layer and a project layer, and a `setup` command that discovers and registers helpers but never installs them.

## What Changes

- **Manifest, two layers.**
  - Global: `$XDG_CONFIG_HOME/openspec-cascade/manifest.json` (default `~/.config/openspec-cascade/manifest.json`).
  - Project: a `manifest` key in `.openspec-cascade.json`.
  - Both hold `entries`. Each entry has:
    - `name`;
    - `type`: `mcp`, `skill`, `plugin` or `cli`;
    - `whenToUse`: non-empty, one line, at most 200 characters;
    - `required`: boolean, default false;
    - `check`: optional, a single command;
    - `profile`: optional, a non-secret name such as an AWS profile, which planning passes as `--profile`;
    - `hosts`: optional list of `claude-code` and `opencode`.
  - Entries are unique by (`name`, `type`) within a layer. A project entry replaces the global entry with the same (`name`, `type`). No secrets: only names.
- **`openspec-cascade setup`**, a new subcommand. It discovers and registers, and never installs. Its actions:
  - `discover` lists candidates from:
    - Claude Code: MCP servers in `~/.claude.json` (top level and the entry for this project) and the project's `.mcp.json`; skills in `~/.claude/skills` and `.claude/skills`; enabled plugins in `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json`.
    - OpenCode: MCP servers in the global and project `opencode.json` or `opencode.jsonc`; skills in the global and project `skill` and `skills` folders.
    - A fixed list of CLI tools found on PATH.

    It merges candidates by (`name`, `type`) and marks which are already in the manifest. It reads names only, never values.
  - `add` and `remove` write one entry to the project or global layer.
  - `show` prints the merged manifest, as text or JSON.
  - `rules` prints suggested `rules` for `openspec/config.yaml`, and with `--write` adds them when the file has no `rules` key. The rules say three things: tasks must be things an agent can do and verify; investigate read-only before delegating to a human; and design.md states layers and dependency injection.
- **`/cascade:setup`**, a Claude Code plugin command in `plugins/cascade/commands/setup.md`. It runs `discover`, proposes what to include, lets the user choose and write a `whenToUse` for each, asks whether any helper is missing (claude.ai connectors cannot be discovered), calls `add`, and then offers `rules`. OpenCode users run the same `setup` actions from the CLI.
- **`doctor`** reports each manifest entry. It runs the `check` of global entries by default, and the `check` of project entries only with `--run-project-checks`, because the project layer comes from the repository. Failing required entries are `fail`, failing optional entries are `warn`. A manifest that fails to load is one failing `manifest` check, not a crash.

## Capabilities

### New Capabilities
- `project-manifest`: the global and project manifest, its discovery, its registration commands and its doctor checks.

### Modified Capabilities

None.

## Impact

- New: `src/manifest/` (types, load and merge, discovery, JSONC reader, rules template), `src/cli/setup.ts`, `plugins/cascade/commands/setup.md`, tests under `test/manifest/`, `test/cli/setup.test.ts` and `test/plugin/setup_command.test.ts`.
- Modified:
  - `src/config/schemas.ts`: an optional `manifest` key accepted as any value, so runs never fail on it.
  - `src/config/constants.ts`: the `setup` subcommand and a `MANIFEST_CONSTANTS` block (paths, CLI tool list, check timeout, limits).
  - `src/cli/commands.ts`: dispatch, injected manifest paths, doctor checks and `--run-project-checks`.
  - `docs/cli.md`, `README.md`.
- No change to runs: nothing in a run reads the manifest. The only readers are `doctor` and `cascade-explore`, a later change in the same PR that consumes `setup show --json`.
