# Design

## Problem

See [proposal.md](proposal.md). Planning has no record of which helpers (MCP servers, skills, plugins, CLI tools) a project uses or when to use them, so every explore session depends on the user's memory. This change adds that record and the commands to fill and check it. It does not change runs.

## Context

- **Subcommands.** They are listed in `CLI_COMMAND_CONSTANTS.SUBCOMMANDS` (`src/config/constants.ts:491`) and dispatched by the switch in `runSubcommand` (`src/cli/commands.ts:242-274`). The newer ones (`spec-gate`, `lint-tasks`) live in their own module and export `run<Name>(argv, output = consoleOutput): number`. They parse with `node:util` `parseArgs` in strict mode, throw `CliUsageError` from `src/cli/change_args.ts`, use `consoleOutput` from the same file, and turn errors into exit 2.
- **Config file.** `.openspec-cascade.json` is read by `readCascadeJsonFile` (`src/config/loader.ts:254`) and validated by the strict Zod object `CascadeFileConfigSchema` (`src/config/schemas.ts:483`). An unknown key makes loading fail, so every run would fail too.
- **doctor.** `runDoctor(repo, dependencies)` (`src/cli/commands.ts:91-148`) returns `DoctorCheck {name, status, detail}` entries pushed inline. `SubcommandDependencies` (`src/cli/commands.ts:31`) injects the spawner, output, Greptile client and engine factory. `doctorCommand` exits 1 when any check is `fail`.
- **Spawner.** `ISpawner.run(argv, options)` takes `cwd`, `env` and `timeoutMs`. When `stdin` is omitted, the child's stdin is closed (`ignore`). The run timeout used elsewhere is `TIMEOUT_CONSTANTS.COMMAND_TIMEOUT_MS`, 30 minutes, which is far too long for a health check.
- **Shell guard.** `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` rejects `;`, `&`, `|`, backticks, redirections, line breaks, `$(` and `${`. `isSafeVerifyCommand` (`src/facade/tasks.ts:69`) still allows `sh -c ...`, so it is not used for checks.
- **Discovery.** No discovery code exists. `skills.ts` scans only in-repo skill folders.
- **Plugin commands.** They live in `plugins/cascade/commands/*.md` and are invoked as `/cascade:<file name>`. `test/plugin/egm_commands.test.ts` checks the content of the EGM commands.
- **Real config shapes seen on the author's machine:**
  - `~/.claude/settings.json` has `enabledPlugins` keyed `name@marketplace`.
  - `~/.claude.json` has a top-level `mcpServers`, and per-project MCP servers sit under `projects[<abs path>].mcpServers`. The key is the path Claude Code was opened in, which may be a symlink or a worktree.
  - `~/.config/opencode/opencode.json` may have an `mcp` object.

## Goals / Non-Goals

**Goals:**
- A pure manifest module with strict validation.
- Discovery that is testable with a fake home directory and never prints values.
- A `setup` CLI usable from Claude Code and OpenCode.
- A plugin command for the conversation in Claude Code.
- doctor checks that do not run repository-supplied commands by default.

**Non-Goals:**
- Installing anything, or editing Claude Code or OpenCode config.
- Reading MCP secrets.
- Using the manifest during runs. Only `doctor` and `cascade-explore` read it.
- Discovering claude.ai connectors. They are not in any local file.
- Hooks.

## Decisions

- **Module layout.** Each file takes paths as parameters, never `os.homedir()` directly:
  - `src/manifest/types.ts`: Zod schemas for an entry and a layer, and the `ManifestPaths` type `{home, xdgConfigHome}`.
  - `src/manifest/load.ts`: `loadGlobalLayer(paths)`, `loadProjectLayer(repo)`, `mergeLayers(global, project)` and `loadManifest(paths, repo)`. This is the only strict validation of the manifest. The merge returns entries tagged with their layer, sorted by name then type.
  - `src/manifest/jsonc.ts`: `stripJsonc(text)`, a string-aware remover of `//` and `/* */` comments that also drops trailing commas before `}` or `]`.
  - `src/manifest/discover.ts`: `discover(paths, deps)`, where `paths` is `{home, xdgConfigHome, repo}` and `deps` is `{which, gitCommonDir}`.
  - `src/manifest/rules.ts`: the rules template and `writeRules(configText)`. It returns the new text or a reason for refusing.
  - `src/manifest/write.ts`: `writeJsonAtomic(path, value)`. It writes two-space JSON with a final newline to a temporary file in the same folder, then renames it over the target.

  `src/cli/setup.ts` exports `runSetup(argv, output = consoleOutput, deps = realSetupDeps())`. `realSetupDeps()` resolves `home` from `os.homedir()`, `xdgConfigHome` from `XDG_CONFIG_HOME` or `<home>/.config`, and uses the default spawner. The dispatch calls `runSetup(argv, output)`. Tests pass temporary directories.
- **Entry schema.** Fields and rules:
  - `name`: non-empty, one line.
  - `type`: `mcp`, `skill`, `plugin` or `cli`.
  - `whenToUse`: non-empty, one line, at most `MANIFEST_CONSTANTS.WHEN_TO_USE_MAX_LENGTH` (200) characters.
  - `required`: boolean, default false.
  - `check`: optional. It must be non-empty and must contain no quote (`'` or `"`), no `$`, and nothing matched by `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN`. It is split on whitespace into argv.
  - `profile`: optional, matching `MANIFEST_CONSTANTS.PROFILE_PATTERN` (letters, digits, `.`, `_`, `-`). It is a name, never a key.
  - `hosts`: optional list of `claude-code` and `opencode`, without duplicates.

  Entries are strict objects, so unknown fields fail. Entries are unique by (`name`, `type`) within a layer. A project entry replaces the global entry with the same (`name`, `type`); `engram` as `cli` and `engram` as `mcp` are two entries.
- **The run loader accepts any `manifest`.** `CascadeFileConfigSchema` gains `manifest: z.unknown().optional()`. A broken manifest therefore never stops a run. Strict validation happens only in `src/manifest/load.ts`, which `setup` and `doctor` call.
- **The project layer is a key in `.openspec-cascade.json`.** `setup add` and `setup remove` read the JSON, change only `manifest.entries`, validate the result, and write the whole file back with `writeJsonAtomic`. Other keys keep their values; formatting is normalized to two-space JSON. If the file does not exist, `add --scope project` creates it with only the `manifest` key. If the file is not valid JSON or its manifest is invalid, the command exits 2 and leaves it unchanged.
- **The global layer is its own file,** `{"entries": [...]}`. `setup add --scope global` creates the folder when it is missing. A future forja module can write the same file.
- **CLI shape of `setup`.**
  - Common flag: `--repo <path>`, default the current folder.
  - `discover [--json]`.
  - `add --scope project|global --name <n> --type <t> --when <sentence> [--required] [--check <command>] [--profile <name>] [--host claude-code|opencode]...`. It upserts by (`name`, `type`).
  - `remove --scope project|global --name <n> --type <t>`. A missing entry exits 2.
  - `show [--json]`.
  - `rules [--write]`.
  - Exit codes: 0 success, 1 refused write (rules already present), 2 usage error or invalid manifest. Usage errors are `CliUsageError`.
- **JSON outputs.** Both are sorted so tests and `cascade-explore` get stable text.
  - `show --json`: `{"entries":[{name, type, whenToUse, required, check?, profile?, hosts?, layer}]}`. `layer` is `global` or `project`. `required` is always present; unset optional fields are left out.
  - `discover --json`: `{"candidates":[{name, type, sources, hosts, inManifest}], "skipped":[{source, reason}]}`. `sources` and `hosts` are sorted lists. `inManifest` is `null`, `global` or `project` (project when both layers have it).
- **Discovery sources and parsing.** Each source is a small function that returns `{candidates, skipped}`. A missing file or folder is ignored. A file that cannot be read or parsed becomes one `skipped` item with a fixed reason (`unreadable`, `invalid JSON`, `invalid JSONC`, `unexpected shape`). The parser's own message is never shown, because it can quote file content. A source is shown as a path with `~` for the home folder and `<repo>` for the repository, or `PATH`. The sources are:
  - **Claude Code MCP** (host `claude-code`). The keys of top-level `mcpServers` in `~/.claude.json`; the keys of `projects[key].mcpServers` for every `key` whose real path equals the real path of the repository or of the main worktree root (the parent of `gitCommonDir(repo)`, which runs `git rev-parse --git-common-dir`); and the keys of `mcpServers` in `<repo>/.mcp.json`.
  - **Claude Code skills** (host `claude-code`). The folder names of `~/.claude/skills/*/SKILL.md` and `<repo>/.claude/skills/*/SKILL.md`.
  - **Claude Code plugins** (host `claude-code`). `enabledPlugins` from `~/.claude/settings.json`, `<repo>/.claude/settings.json` and `<repo>/.claude/settings.local.json`, later files overriding earlier ones per key. A plugin is listed when its final value is true. The name is the part before `@`.
  - **OpenCode MCP** (host `opencode`). The keys of `mcp` in `$XDG_CONFIG_HOME/opencode/opencode.json` or `opencode.jsonc`, and in `<repo>/opencode.json` or `<repo>/opencode.jsonc`. When both exist in one place, `.json` wins and `.jsonc` is not read. `.jsonc` text goes through `stripJsonc` first.
  - **OpenCode skills** (host `opencode`). The folder names of `$XDG_CONFIG_HOME/opencode/skill/*/SKILL.md`, `$XDG_CONFIG_HOME/opencode/skills/*/SKILL.md`, `<repo>/.opencode/skill/*/SKILL.md` and `<repo>/.opencode/skills/*/SKILL.md`. Both folder names are checked because OpenCode versions differ.
  - **CLI tools** (no host). `MANIFEST_CONSTANTS.KNOWN_CLI_TOOLS`: `rtk`, `gh`, `aws`, `greptile`, `opencode`, `engram`, `codebase-memory-mcp`, `openspec`, `docker`, `bun`. Each is looked up with `deps.which`.

  Candidates with the same (`name`, `type`) are merged into one, listing all its sources and hosts. Only key names and folder names are read into candidates; `env`, `headers`, `url`, `command` and `args` are never copied.
- **`whenToUse` is required on `add`.** The command decides nothing on its own: the plugin command or the person at the terminal writes the sentence.
- **Rules writing is a text append, not a YAML rewrite.** The repo has no YAML writer, and rewriting would drop comments. `writeRules` detects a top-level key with a regex at column 0 that accepts `rules:`, `"rules":` and `'rules':`. A commented-out key does not count. If the key exists, it refuses and the command exits 1. Otherwise it appends a line break when the file lacks a final one, then the template block, and writes atomically. If `openspec/config.yaml` does not exist, the command exits 2 with the hint "run openspec init first".
- **The plugin command is a conversation script.** `plugins/cascade/commands/setup.md`, invoked as `/cascade:setup`:
  1. Runs `openspec-cascade setup discover --json`.
  2. Groups the candidates by type.
  3. Proposes which to include, with a draft `whenToUse` sentence for each, for example "Watson: before proposing, to look up how other work repos solved it".
  4. Lets the user confirm or edit each one, one question at a time, including scope, `required`, a read-only `check` and, for AWS, the read-only `profile`.
  5. Asks whether any helper is missing, such as a claude.ai connector, which discovery cannot see, and registers it too.
  6. Calls `setup add` for each accepted entry.
  7. Shows `setup rules` and runs it with `--write` only after the user confirms.

  Its frontmatter has `name: setup` and a `description`, like the other commands.
- **OpenCode users use the CLI.** There is no OpenCode command file in this change. OpenCode users run `setup discover`, `setup add`, `setup show` and `setup rules` directly. The docs show this flow.
- **doctor.** `SubcommandDependencies` gains `manifestPaths?: ManifestPaths`. When it is absent, the real paths are resolved as in `setup`. `runDoctor(repo, dependencies, options = {})` takes `options.runProjectChecks`, set by `doctor --run-project-checks`. It loads the manifest with `loadManifest`:
  - If loading fails, it adds one check `manifest` with status `fail` and the reason, and no entry checks.
  - Otherwise it adds one check per entry, named `manifest:<layer>:<name> (<type>)`, so the output shows each layer.
  - An entry without `check` is `ok`, "declared, no check".
  - A project entry with `check` and no `--run-project-checks` is `ok`, "check not run; use --run-project-checks".
  - Every other check runs through the spawner: argv from the whitespace split, no shell, stdin closed, the current environment with `AWS_PAGER` set to empty, `cwd` the repository, and `timeoutMs` `MANIFEST_CONSTANTS.CHECK_TIMEOUT_MS` (15 seconds). Exit 0 is `ok`. A non-zero exit, a timeout or a missing binary is `fail` for a required entry and `warn` otherwise. The detail gives the exit code or "timed out"; command output is not shown.

## Alternatives Considered

- **Project layer as a key vs a separate file** (`openspec/cascade-manifest.json`). A separate file would keep `.openspec-cascade.json` untouched and avoid the loader issue. A key keeps one project config file to find, copy and review, and the loose `z.unknown()` field removes the loader risk. Cost of the key: `setup` rewrites the whole file and normalizes its formatting. Chosen: the key.
- **Own global file vs reusing Claude Code or OpenCode config.** Storing entries inside `~/.claude.json` or `opencode.json` would avoid a new file, but those files belong to other tools, change shape between versions, and hold secrets. One file per host would also duplicate entries. Cost of our own file: one more path to know. Chosen: our own file under `$XDG_CONFIG_HOME`.
- **Discovery vs manual entry only.** Manual entry with `add` is simpler and has no parsing risk. Discovery finds helpers the user forgot, which is the original problem, but must track other tools' file shapes. Fixture tests and the `skipped` list contain that risk, and `add` remains for what discovery misses. Chosen: both.
- **Text append vs a YAML library for rules.** A YAML library would allow merging into an existing `rules` key, but adds a dependency and drops comments on rewrite. A text append keeps the file byte for byte and refuses when `rules` exists. Cost: no merge. Chosen: text append.
- **doctor running checks vs only declaring them.** Declaring only is safest, but then doctor cannot tell whether `aws` or `gh` is logged in, which is the main value. Running every check would execute commands from a cloned repository. Chosen: run global checks by default, project checks only with `--run-project-checks`, both without a shell and with a short timeout.
- **A `hosts` field vs not recording the host.** Without it, planning in OpenCode could be told to use a Claude Code plugin it does not have. Recording it costs one optional field that `add` and discovery fill. Chosen: the optional field.

## Risks / Trade-offs

- [Claude Code or OpenCode change their config shape] → That source reports `skipped` with a fixed reason, and the other sources still work. The shapes are covered by fixture tests.
- [A check command has side effects] → Validation removes shells, quotes, `$` and control operators, but a single command such as `rm -rf x` still passes. Read-only behavior of a check is not enforced; it is only asked for in the docs and the plugin command. Project checks need `--run-project-checks`, so a cloned repository cannot run them on a plain `doctor`.
- [`setup` normalizes `.openspec-cascade.json` formatting] → Values and key order are kept; only whitespace changes. The write is atomic, so a crash leaves the old file.
- [claude.ai connectors are invisible to discovery] → The plugin command asks for missing helpers and registers them with `setup add`.
