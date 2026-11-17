# Design

## Problem

See [proposal.md](proposal.md). Planning has no record of which helpers (MCP servers, skills, plugins, CLI tools) a project uses or when to use them, so every explore session depends on the user's memory. This change adds that record and the commands to fill and check it. It does not change runs.

## Context

- **Subcommands.** They are listed in `CLI_COMMAND_CONSTANTS.SUBCOMMANDS` (`src/config/constants.ts:491`) and dispatched by the switch in `runSubcommand` (`src/cli/commands.ts:242-274`). The switch has no `default`, so adding a name to `SUBCOMMANDS` without a `case` fails the typecheck. The newer subcommands (`spec-gate`, `lint-tasks`) live in their own module and export `run<Name>(argv, output = consoleOutput): number`. They parse with `node:util` `parseArgs` in strict mode, throw `CliUsageError` from `src/cli/change_args.ts`, use `consoleOutput` from the same file, and turn errors into exit 2. `runSubcommand` prints `USAGE: cascade <name>: <message>` for usage errors and `STOPPED: <name> failed: <message>` for other failures.
- **Docs parity test.** `test/docs/cli_docs.test.ts` requires every `SUBCOMMANDS` entry to appear as `` `<name>` `` in `docs/cli.md` and as the literal `cascade.ts <name>` in `README.md`. So the task that adds `setup` to `SUBCOMMANDS` also adds the `docs/cli.md` table row and the `README.md` example line.
- **Config file.** `.openspec-cascade.json` is read by `readCascadeJsonFile` (`src/config/loader.ts:254`) and validated by the strict Zod object `CascadeFileConfigSchema` (`src/config/schemas.ts:483`). An unknown key makes loading fail, so every run would fail too.
- **doctor.** `runDoctor(repo, dependencies)` (`src/cli/commands.ts:91-148`) returns `DoctorCheck {name, status, detail}` entries pushed inline. Besides the new manifest checks it already calls the spawner for `git rev-parse --is-inside-work-tree`, calls `spawner.which` for `openspec` and each engine binary, and asks the Greptile client for its status. `SubcommandDependencies` (`src/cli/commands.ts:31`) injects the spawner, output, Greptile client and engine factory. `doctorCommand` exits 1 when any check is `fail`.
- **Spawner** (`src/runtime/types.ts`). `ISpawner.run(argv, options)` takes `cwd`, `env` and `timeoutMs` and resolves to `SpawnResult {exitCode, stdout, stderr, timedOut, aborted}`; a timeout gives `timedOut: true` and exit code 124. When the program cannot start (for example a missing binary) the promise rejects with `SpawnError`. `env`, when given, replaces the child's environment (`toDefinedEnv` in `src/runtime/process_control.ts` only drops `undefined` values); it is not merged with `process.env`. When `stdin` is omitted, the child's stdin is closed (`ignore`). `spawnSync(argv, options)` and `which(binary): string | null` are synchronous. The run timeout used elsewhere is `TIMEOUT_CONSTANTS.COMMAND_TIMEOUT_MS`, 30 minutes, which is far too long for a health check.
- **Shell guard.** `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` rejects `;`, `&`, `|`, backticks, redirections, line breaks, `$(` and `${`. `isSafeVerifyCommand` (`src/facade/tasks.ts:69`) still allows `sh -c ...`, so it is not used for checks.
- **Atomic writes.** `writeAtomic` in `src/storage/memory.ts:690` is async, creates parent folders and guards protected sections of `BRIEFING.md`. `setup` is synchronous (see below), so it cannot use it.
- **Static rules.** ESLint (`eslint.config.js`) enforces `@typescript-eslint/no-magic-numbers` with only `-1`, `0` and `1` ignored outside tests, and `explicit-module-boundary-types`, so every exported function needs an explicit return type and every other number needs a named constant. Exit codes come from `EXIT_CODE_CONSTANTS` (`src/config/constants.ts:9`).
- **Discovery.** No discovery code exists. `skills.ts`, at the repository root rather than under `src/`, scans only in-repo skill folders and is not reused.
- **Plugin commands.** They live in `plugins/cascade/commands/*.md` and are invoked as `/cascade:<file name>`. `test/plugin/egm_commands.test.ts` checks the content of the EGM commands.
- **Isolated CLI test environment.** `buildIsolatedEnv` in `test/e2e/helpers/cli_runner.ts` sets `HOME` and `XDG_CACHE_HOME` to a temporary folder but passes `XDG_CONFIG_HOME` through from the parent process. Without a change, an end-to-end `doctor` run would read the developer's real global manifest.
- **Real config shapes seen on the author's machine:**
  - `~/.claude/settings.json` has `enabledPlugins` keyed `name@marketplace`.
  - `~/.claude.json` has a top-level `mcpServers`, and per-project MCP servers sit under `projects[<abs path>].mcpServers`. The key is the path Claude Code was opened in, which may be a symlink, a worktree, or a folder that no longer exists.
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

- **Constants.** `MANIFEST_CONSTANTS` in `src/config/constants.ts` holds, with these exact names:
  - `GLOBAL_DIR: "openspec-cascade"`, `GLOBAL_FILE: "manifest.json"`, `PROJECT_KEY: "manifest"`;
  - `ENTRY_TYPES: ["mcp", "skill", "plugin", "cli"]`, `HOSTS: ["claude-code", "opencode"]`;
  - `WHEN_TO_USE_MAX_LENGTH: 200`, `PROFILE_PATTERN: /^[A-Za-z0-9._-]+$/`, `CHECK_TIMEOUT_MS: 15000`, `JSON_INDENT: 2`;
  - `KNOWN_CLI_TOOLS`, listed under "Discovery sources".

  Exit codes use `EXIT_CODE_CONSTANTS`. Every exported function has an explicit return type.
- **Module layout.** Each file takes paths as parameters, never `os.homedir()` or `process.env` directly:
  - `src/manifest/types.ts`: Zod schemas for an entry and a layer, the `ManifestEntry`, `MergedEntry` (an entry plus `layer`) and `ManifestPaths` (`{home, xdgConfigHome}`) types.
  - `src/manifest/load.ts`:
    - `resolveManifestPaths(env, home): ManifestPaths`, pure. `xdgConfigHome` is `env.XDG_CONFIG_HOME` when it is set and non-empty, otherwise `<home>/.config`. `realSetupDeps()` and `doctor` both call it with `process.env` and `os.homedir()`.
    - `loadGlobalLayer(paths): ManifestEntry[]`, reading `<xdgConfigHome>/<GLOBAL_DIR>/<GLOBAL_FILE>`.
    - `loadProjectLayer(repo): ManifestEntry[]`, reading the `PROJECT_KEY` key of `<repo>/.openspec-cascade.json`.
    - `mergeLayers(global, project): MergedEntry[]` and `loadManifest(paths, repo): MergedEntry[]`.
    - `ManifestError`, the only error these functions throw. Its message starts with `<layer> layer:` (`global layer:` or `project layer:`). When the problem is in one entry, the message then names it by `name` (with its type when known, for example `global layer: watson (mcp): whenToUse is longer than 200 characters`), or by `entry #<index>` (zero-based) when the entry has no usable name (for example `project layer: entry #2: name is required`). File-level problems name only the layer (for example `global layer: invalid JSON`). The parser's own message is never included.

    This is the only strict validation of the manifest. The merge returns entries tagged with their layer, sorted by name then type.
  - `src/manifest/jsonc.ts`: `stripJsonc(text): string`, a string-aware remover of `//` and `/* */` comments that also drops trailing commas before `}` or `]`.
  - `src/manifest/discover.ts`: `discover(paths, deps): DiscoveryResult`, synchronous. `paths` is `{home, xdgConfigHome, repo}`; `deps` is `{which(binary): string | null, gitCommonDir(repo): string | undefined}`. It calls `loadManifest` to fill `inManifest`, so an invalid manifest throws `ManifestError` and `setup discover` exits 2.
  - `src/manifest/rules.ts`: the constant `SUGGESTED_RULES_YAML` and `writeRules(configText): {text: string} | {refused: string}`, which returns the new text or the reason for refusing.
  - `src/manifest/write.ts`: `writeTextAtomic(path, text): void` and `writeJsonAtomic(path, value): void`. See "Atomic writes".

  `src/cli/setup.ts` exports `runSetup(argv, output = consoleOutput, deps = realSetupDeps()): number`, synchronous, and `realSetupDeps(): SetupDeps`. `SetupDeps` is `{home, xdgConfigHome, which, gitCommonDir}`. `realSetupDeps()` takes `home` from `os.homedir()` and `xdgConfigHome` from `resolveManifestPaths(process.env, home)`; `which` is the default spawner's `which`; `gitCommonDir(repo)` runs `spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd: repo})` and returns the trimmed stdout on exit 0, otherwise `undefined`. The dispatch calls `runSetup(argv, output)`. Tests pass temporary directories and fakes.
- **Why `setup` is synchronous.** Every step is a small file read or write, plus `which` and one `git rev-parse`, all of which have synchronous forms (`ISpawner.which`, `ISpawner.spawnSync`). A synchronous `runSetup` keeps the module like `runSpecGate` and `runLintTasks`, and the dispatch returns its value directly.
- **Atomic writes.** `writeAtomic` from `src/storage/memory.ts` is not reused: it is async, which does not fit the synchronous `setup`, and it carries the `BRIEFING.md` guard, which does not apply here. `src/manifest/write.ts` is a small synchronous helper instead. `writeTextAtomic(path, text)` writes `text` with `writeFileSync` to a temporary file in the same folder (`<name>.<random suffix>.tmp`), then `renameSync`s it over the target, and removes the temporary file if the write or the rename throws. It does not create folders; `setup add --scope global` creates the global folder first with `mkdirSync(..., {recursive: true})`. `writeJsonAtomic(path, value)` calls `writeTextAtomic(path, JSON.stringify(value, null, MANIFEST_CONSTANTS.JSON_INDENT) + "\n")`. `.openspec-cascade.json` and the global manifest use `writeJsonAtomic`; `openspec/config.yaml` uses `writeTextAtomic`.
- **Entry schema.** Fields and rules:
  - `name`: non-empty, one line.
  - `type`: one of `ENTRY_TYPES`.
  - `whenToUse`: non-empty, one line, at most `WHEN_TO_USE_MAX_LENGTH` (200) characters.
  - `required`: boolean, default false.
  - `check`: optional. It must be non-empty after trimming and must contain no quote (`'` or `"`), no `$`, and nothing matched by `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN`. Its argv is `check.trim().split(/\s+/)`.
  - `profile`: optional, matching `PROFILE_PATTERN`. It is a name, never a key.
  - `hosts`: optional list of `HOSTS` values, without duplicates.

  Entries are strict objects, so unknown fields fail. Entries are unique by (`name`, `type`) within a layer. A project entry replaces the global entry with the same (`name`, `type`); `engram` as `cli` and `engram` as `mcp` are two entries.
- **The run loader accepts any `manifest`.** `CascadeFileConfigSchema` gains `manifest: z.unknown().optional()`. A broken manifest therefore never stops a run. Strict validation happens only in `src/manifest/load.ts`, which `setup` and `doctor` call.
- **The project layer is a key in `.openspec-cascade.json`.** `setup add` and `setup remove` read the JSON, change only `manifest.entries`, validate the result, and write the whole file back with `writeJsonAtomic`. Other keys keep their values; formatting is normalized to two-space JSON. If the file does not exist, `add --scope project` creates it with only the `manifest` key. If the file is not valid JSON or its manifest is invalid, the command exits 2 and leaves it unchanged.
- **The global layer is its own file,** `{"entries": [...]}`. `setup add --scope global` creates the folder when it is missing. A future forja module can write the same file.
- **CLI shape of `setup`.**
  - Common flag: `--repo <path>`, default the current folder.
  - `discover [--json]`.
  - `add --scope project|global --name <n> --type <t> --when <sentence> [--required] [--check <command>] [--profile <name>] [--host claude-code|opencode]...`. It upserts by (`name`, `type`): an existing entry is replaced at its position in `entries`, a new one is appended at the end.
  - `remove --scope project|global --name <n> --type <t>`. A missing entry exits 2.
  - `show [--json]`.
  - `rules [--write]`.
  - Exit codes: 0 success, 1 refused write (rules already present), 2 usage error or invalid manifest (including on `discover` and `show`).
  - Errors: `runSetup` never throws. A `CliUsageError` prints `USAGE: cascade setup: <message>` on stderr. Any other failure, including `ManifestError` and an invalid `.openspec-cascade.json`, prints `STOPPED: setup: <message>` on stderr, like `runSubcommand`. Both exit 2.
- **JSON outputs.** Both are sorted so tests and `cascade-explore` get stable text, and printed with `MANIFEST_CONSTANTS.JSON_INDENT` (two spaces).
  - `show --json`: `{"entries":[{name, type, whenToUse, required, check?, profile?, hosts?, layer}]}`. `layer` is `global` or `project`. `required` is always present; unset optional fields are left out.
  - `discover --json`: `{"candidates":[{name, type, sources, hosts, inManifest}], "skipped":[{source, reason}]}`. `sources` and `hosts` are sorted lists. `inManifest` is `null`, `global` or `project` (project when both layers have it).
- **Plain-text outputs.** On stdout unless noted. Tests assert the lines that have an example below:
  - `show`: one line per merged entry, `<layer> <type> <name>: <whenToUse>`, for example `project mcp stitch: Before UI tasks, fetch the screen design`. No entries prints nothing and exits 0.
  - `discover` without `--json`: free-form and untested. Callers that parse it use `--json`.
  - `add`: `added <name> (<type>) to the <scope> layer`, or `updated <name> (<type>) in the <scope> layer` when it replaced an entry.
  - `remove`: `removed <name> (<type>) from the <scope> layer`.
  - `rules` without `--write`: the `SUGGESTED_RULES_YAML` text, unchanged.
  - `rules --write`: `wrote rules to openspec/config.yaml`. A refusal prints `REFUSED: openspec/config.yaml already has a rules key` on stderr and exits 1. A missing file prints `STOPPED: setup: openspec/config.yaml not found; run openspec init first` on stderr and exits 2.
- **Discovery sources and parsing.** Each source is a small function that returns `{candidates, skipped}`. A missing file or folder is ignored. A file that cannot be read or parsed becomes one `skipped` item with a fixed reason (`unreadable`, `invalid JSON`, `invalid JSONC`, `unexpected shape`). The parser's own message is never shown, because it can quote file content. A source is shown as a path with `~` for the home folder and `<repo>` for the repository, or `PATH`. Global OpenCode labels are built from `paths.xdgConfigHome`: `~/…` when it is inside `paths.home`, its absolute path otherwise. The sources are:
  - **Claude Code MCP** (host `claude-code`).
    - The keys of top-level `mcpServers` in `~/.claude.json`.
    - The keys of `projects[key].mcpServers` for every `key` whose real path equals the real path of the repository or of the main worktree root. The main worktree root is the parent folder of `gitCommonDir(repo)`; when `gitCommonDir` returns `undefined`, only the repository is matched. A `key` whose real path cannot be resolved (for example a deleted folder) is ignored silently, without a `skipped` item.
    - The keys of `mcpServers` in `<repo>/.mcp.json`.
  - **Claude Code skills** (host `claude-code`). The folder names of `~/.claude/skills/*/SKILL.md` and `<repo>/.claude/skills/*/SKILL.md`.
  - **Claude Code plugins** (host `claude-code`). `enabledPlugins` from `~/.claude/settings.json`, `<repo>/.claude/settings.json` and `<repo>/.claude/settings.local.json`, later files overriding earlier ones per key. A plugin is listed when its final value is true. The name is the part before `@`.
  - **OpenCode MCP** (host `opencode`). The keys of `mcp` in `$XDG_CONFIG_HOME/opencode/opencode.json` or `opencode.jsonc`, and in `<repo>/opencode.json` or `<repo>/opencode.jsonc`. When both exist in one place, `.json` wins and `.jsonc` is not read. `.jsonc` text goes through `stripJsonc` first.
  - **OpenCode skills** (host `opencode`). The folder names of `$XDG_CONFIG_HOME/opencode/skill/*/SKILL.md`, `$XDG_CONFIG_HOME/opencode/skills/*/SKILL.md`, `<repo>/.opencode/skill/*/SKILL.md` and `<repo>/.opencode/skills/*/SKILL.md`. Both folder names are checked because OpenCode versions differ.
  - **CLI tools** (no host). `MANIFEST_CONSTANTS.KNOWN_CLI_TOOLS`: `rtk`, `gh`, `aws`, `greptile`, `opencode`, `engram`, `codebase-memory-mcp`, `openspec`, `docker`, `bun`. Each is looked up with `deps.which`; a non-null result means found.

  Candidates with the same (`name`, `type`) are merged into one, listing all its sources and hosts. Only key names and folder names are read into candidates; `env`, `headers`, `url`, `command` and `args` are never copied.
- **`whenToUse` is required on `add`.** The command decides nothing on its own: the plugin command or the person at the terminal writes the sentence.
- **Rules template.** `src/manifest/rules.ts` exports `SUGGESTED_RULES_YAML`, exactly this text, ending with a line break:

  ```yaml
  rules:
    tasks:
      - Every task is a step an agent can do and verify with a command; steps only a person can do go in manual.md.
      - Before delegating anything to a person, investigate read-only first (logs, list and describe calls, the read-only profile from the manifest).
      - When a helper from openspec-cascade setup show applies, name it in the task.
    design:
      - State the layers, the allowed dependency direction between them, and how dependencies are injected.
  ```

  Two top-level keys under `rules`: `tasks` with three items and `design` with one. It is valid YAML: no item contains `: ` or ` #`.
- **Rules writing is a text append, not a YAML rewrite.** The repo has no YAML writer, and rewriting would drop comments. `writeRules` detects a top-level key with a regex at column 0 that accepts `rules:`, `"rules":` and `'rules':`. A commented-out key does not count. If the key exists, it refuses and the command exits 1. Otherwise it appends a line break when the file lacks a final one, then `SUGGESTED_RULES_YAML`, and the command writes the result with `writeTextAtomic`. If `openspec/config.yaml` does not exist, the command exits 2 with the hint "run openspec init first".
- **The plugin command is a conversation script.** `plugins/cascade/commands/setup.md`, invoked as `/cascade:setup`. Its file starts with a `---` frontmatter whose first line is `name: setup`, followed by a `description`, like the other commands. Its steps:
  1. Run `openspec-cascade setup discover --json`.
  2. Group the candidates by type.
  3. Propose which to include, with a draft `whenToUse` sentence for each, for example "Watson: before proposing, to look up how other work repos solved it".
  4. Let the user confirm or edit each one, one question at a time, including scope, `required`, a `check` that must be read-only (the step uses the word `read-only`) and, for AWS, the read-only `profile`.
  5. Ask whether any helper is missing, such as a claude.ai connector, which discovery cannot see, and register it too.
  6. Call `setup add` for each accepted entry.
  7. Show `setup rules` and run it with `--write` only after the user confirms.
- **OpenCode users use the CLI.** There is no OpenCode command file in this change. OpenCode users run `setup discover`, `setup add`, `setup show` and `setup rules` directly. The docs show this flow.
- **doctor.** `SubcommandDependencies` gains `manifestPaths?: ManifestPaths`. When it is absent, `runDoctor` uses `resolveManifestPaths(process.env, os.homedir())`. `runDoctor(repo, dependencies, options = {})` takes `options.runProjectChecks`, set by `doctor --run-project-checks`. It loads the manifest with `loadManifest`:
  - If loading fails, it adds one check `manifest` with status `fail` and the `ManifestError` message, and no entry checks. The other doctor checks still run.
  - Otherwise it adds one check per entry, named `manifest:<layer>:<name> (<type>)`, so the output shows each layer.
  - An entry without `check` is `ok`, "declared, no check".
  - A project entry with `check` and no `--run-project-checks` is `ok`, "check not run; use --run-project-checks".
  - Every other check runs through `spawner.run(check.trim().split(/\s+/), options)`: no shell, no `stdin` (so it is closed), `cwd` the repository, `timeoutMs` `MANIFEST_CONSTANTS.CHECK_TIMEOUT_MS`, and `env: { ...process.env, AWS_PAGER: "" }`. The whole environment is spread because the spawner's `env` replaces it.
  - Exit 0 is `ok` with detail "check passed". Otherwise the status is `fail` for a required entry and `warn` for an optional one, with detail `timed out` when `result.timedOut` is true, `not found` when the promise rejects with `SpawnError`, and `exit <code>` for any other non-zero exit. Command output is not shown.

## Alternatives Considered

- **Project layer as a key vs a separate file** (`openspec/cascade-manifest.json`). A separate file would keep `.openspec-cascade.json` untouched and avoid the loader issue. A key keeps one project config file to find, copy and review, and the loose `z.unknown()` field removes the loader risk. Cost of the key: `setup` rewrites the whole file and normalizes its formatting. Chosen: the key.
- **Own global file vs reusing Claude Code or OpenCode config.** Storing entries inside `~/.claude.json` or `opencode.json` would avoid a new file, but those files belong to other tools, change shape between versions, and hold secrets. One file per host would also duplicate entries. Cost of our own file: one more path to know. Chosen: our own file under `$XDG_CONFIG_HOME`.
- **Discovery vs manual entry only.** Manual entry with `add` is simpler and has no parsing risk. Discovery finds helpers the user forgot, which is the original problem, but must track other tools' file shapes. Fixture tests and the `skipped` list contain that risk, and `add` remains for what discovery misses. Chosen: both.
- **Text append vs a YAML library for rules.** A YAML library would allow merging into an existing `rules` key, but adds a dependency and drops comments on rewrite. A text append keeps the file byte for byte and refuses when `rules` exists. Cost: no merge. Chosen: text append.
- **Reusing `writeAtomic` vs a small sync helper.** Reusing it would avoid a second atomic writer, but would force `setup` to be async and bring the `BRIEFING.md` guard along. Cost of the helper: about twenty lines and one test file. Chosen: the helper.
- **doctor running checks vs only declaring them.** Declaring only is safest, but then doctor cannot tell whether `aws` or `gh` is logged in, which is the main value. Running every check would execute commands from a cloned repository. Chosen: run global checks by default, project checks only with `--run-project-checks`, both without a shell and with a short timeout.
- **A `hosts` field vs not recording the host.** Without it, planning in OpenCode could be told to use a Claude Code plugin it does not have. Recording it costs one optional field that `add` and discovery fill. Chosen: the optional field.

## Risks / Trade-offs

- [Claude Code or OpenCode change their config shape] → That source reports `skipped` with a fixed reason, and the other sources still work. The shapes are covered by fixture tests.
- [A check command has side effects] → Validation removes shells, quotes, `$` and control operators, but a single command such as `rm -rf x` still passes. Read-only behavior of a check is not enforced; it is only asked for in the docs and the plugin command. Project checks need `--run-project-checks`, so a cloned repository cannot run them on a plain `doctor`.
- [A check sees the whole environment] → The spawner's `env` replaces the environment, so the check gets `process.env` plus `AWS_PAGER=""`. That is what `aws` and `gh` need to find their credentials; nothing in the environment is printed.
- [`setup` normalizes `.openspec-cascade.json` formatting] → Values and key order are kept; only whitespace changes. The write is atomic, so a crash leaves the old file.
- [claude.ai connectors are invisible to discovery] → The plugin command asks for missing helpers and registers them with `setup add`.
- [Stale `projects` keys in `~/.claude.json`] → Keys whose folder no longer exists are ignored without noise, so old projects do not fill the `skipped` list.
