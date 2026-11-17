# Design

## Context

- **Subcommands.** They are listed in `CLI_COMMAND_CONSTANTS.SUBCOMMANDS` (`src/config/constants.ts:491`) and dispatched by the switch in `runSubcommand` (`src/cli/commands.ts:249`). The newer ones (`spec-gate`, `lint-tasks`) live in their own module and export `run<Name>(argv, output = consoleOutput): number`. They parse with `node:util` `parseArgs` in strict mode, use `CliUsageError` and `consoleOutput` from `src/cli/change_args.ts`, and catch every error into exit 2.
- **Config file.** `.openspec-cascade.json` is validated by a strict Zod object (`CascadeFileConfigSchema`, `src/config/schemas.ts:483`), so `manifest` must be added there or loading fails.
- **doctor.** `runDoctor` (`src/cli/commands.ts:91-148`) returns `DoctorCheck {name, status, detail}` entries pushed inline.
- **Discovery.** No discovery code exists. `skills.ts` scans only in-repo skill folders.
- **Plugin commands.** They live in `plugins/cascade/commands/*.md`, and `test/plugin/egm_commands.test.ts` checks their content.
- **Real config shapes seen on the author's machine:**
  - `~/.claude/settings.json` has `enabledPlugins` keyed `name@marketplace`.
  - `~/.claude.json` has a top-level `mcpServers`, and per-project MCP servers sit under `projects[<abs path>].mcpServers`.
  - `~/.config/opencode/opencode.json` may have an `mcp` object.

## Goals / Non-Goals

**Goals:**
- A pure manifest module.
- Discovery that is testable with a fake home directory.
- A `setup` CLI.
- A plugin command for the conversation.
- doctor checks.

**Non-Goals:**
- Installing anything, or editing Claude Code or OpenCode config.
- Reading MCP secrets.
- Using the manifest during runs. Planning reads it in `cascade-explore`.
- Hooks.

## Decisions

- **Module layout.** Each file is pure where possible and takes paths as parameters, never `os.homedir()` directly:
  - `src/manifest/types.ts`: Zod schema for an entry and a layer.
  - `src/manifest/load.ts`: `loadGlobalLayer(paths)`, `loadProjectLayer(repo)` and `mergeLayers(global, project)`. The merge returns entries tagged with their layer.
  - `src/manifest/discover.ts`: `discover(paths, deps)`, where `paths` is `{home, xdgConfigHome, repo}` and `deps` is `{which}` for PATH lookup.
  - `src/manifest/rules.ts`: the rules template and `writeRules(configText)`. It returns the new text or a reason for refusing.

  `src/cli/setup.ts` resolves the real paths from `os.homedir()` and `process.env.XDG_CONFIG_HOME` and passes them in. Tests use temporary directories.
- **The project layer is a key in `.openspec-cascade.json`.** `manifest` is added to `CascadeFileConfigSchema` as an optional object `{entries}` with the same entry schema. `setup add` and `setup remove` read the JSON, change only `manifest.entries` and write it back with two-space indentation, keeping the other keys. If the file does not exist, `add --scope project` creates it with only the `manifest` key. Alternative considered: a separate `openspec/cascade-manifest.json`. Rejected because the author chose one project config file.
- **The global layer is its own file.** `setup add --scope global` creates the folder when it is missing. A future forja module can write the same file.
- **Discovery sources and parsing.** Each source is a small function that returns `{candidates, skipped?}`. A parse error becomes `skipped` with the reason, never an exception. The sources are:
  - **Claude Code MCP.** The keys of `mcpServers` at the top level of `~/.claude.json`, the keys of `projects[repo].mcpServers`, and the keys of `<repo>/.mcp.json` `mcpServers`. Only the keys are read.
  - **Claude Code skills.** The directory names of `~/.claude/skills/*/SKILL.md` and `<repo>/.claude/skills/*/SKILL.md`.
  - **Claude Code plugins.** The keys of `enabledPlugins` in `~/.claude/settings.json` whose value is true. The name is the part before `@`.
  - **OpenCode MCP.** The keys of `mcp` in `$XDG_CONFIG_HOME/opencode/opencode.json` (or `opencode.jsonc` with comments stripped), and in `<repo>/opencode.json`.
  - **OpenCode skills.** Directory names under the global and project `opencode` skill folders. Both `skill` and `skills` folder names are checked, because OpenCode versions differ.
  - **CLI tools.** `MANIFEST_CONSTANTS.KNOWN_CLI_TOOLS`: `rtk`, `gh`, `aws`, `greptile`, `opencode`, `engram`, `codebase-memory-mcp`, `openspec`, `docker`, `bun`. Each is looked up with the spawner's `which`.

  Candidates with the same name from several sources are merged into one candidate listing all its sources.
- **`whenToUse` is required on `add`.** The command decides nothing on its own: the plugin command asks the user for the sentence. `--required` and `--check` are optional, and `--check` is validated with `isSafeVerifyCommand`.
- **Rules writing is text append, not YAML rewrite.** The repo has no YAML writer, and rewriting would drop comments. `writeRules` first detects a top-level `rules:` key, with a regex at column 0 that ignores comment lines. If the key exists it refuses. Otherwise it appends a newline and the template block.
- **The plugin command is a conversation script.** `plugins/cascade/commands/cascade-setup.md`:
  1. Runs `openspec-cascade setup discover --json`.
  2. Groups the candidates by type.
  3. Proposes which to include, with a draft `whenToUse` sentence for each, for example "Watson: before proposing, to look up how other work repos solved it".
  4. Asks the user to confirm or edit, one question at a time.
  5. Calls `setup add` for each accepted entry with the chosen scope.
  6. Shows `setup rules` and runs it with `--write` only after the user confirms.

  Its frontmatter follows the other commands.
- **doctor.** It runs each check through the existing spawner, using the `check` command split into argv and no shell, with the command timeout. Status follows the spec.

## Risks / Trade-offs

- [Claude Code or OpenCode change their config shape] → That source reports `skipped` with a reason, and the other sources still work. The shapes are covered by fixture tests.
- [A check command has side effects] → It is validated to have no shell operators, but nothing stops a single command from writing. The docs and the plugin command say checks must be read-only. Some of this is enforced only by the prompt, and that is stated.
