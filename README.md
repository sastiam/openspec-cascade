# openspec-cascade

Runs [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes autonomously, one task per agent session, until
every task in `tasks.md` is done. The harness, not the model, decides whether a task is finished: it runs the
task's checks itself, feeds failures back for a retry, and commits only verified work.

Engines: the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/agent-loop) (default), the
[OpenCode](https://opencode.ai) CLI, the Google [Antigravity](https://antigravity.google) CLI (`agy`, alias `gemini`),
or Google Jules (`jules`). The same TypeScript sources run on **Bun 1.4+** and **Node.js 24 LTS**.

Full CLI reference (Spanish): [`docs/cli.md`](docs/cli.md).

## How it works

- **Cascade:** changes run in the order given; a change finishes before the next one starts.
- **One fresh session per task.** State lives in `tasks.md` and git, so an interrupted run resumes at the first
  unchecked task.
- **Checks are the oracle.** Only a task's Verify segment produces checks: it starts at the indented
  `Verify:` line (optional list marker; the same rule `lint-tasks` enforces), or, as a compatibility fallback, at
  the first `Verify:` on the task line outside backticks. Backticked `bun …` spans there (plus shorthand like
  "lint", "build", "both tsc", "E2E") are run by the harness; commands written before the marker are ignored and
  reported in the run log and the dry-run plan. Up to 3 attempts per task; each retry receives the failing output.
  `alwaysVerify` (config file only, empty by default, v1 only) lists extra commands such as an architecture
  check; they run exactly as written (shell operators are rejected at load) and once as a baseline before the
  first task.
- **Commits:** a task that names a type (``Commit `fix(deps)` ``) is committed with that type. In changes that
  name no types, one commit per section. The agent can never commit, push, reset, checkout, stash or run
  migrations.
- **Human tasks** (opening a PR, deciding delivery) are skipped and listed at the end. Human-only steps go in `manual.md` (each with an indented `Check:` line, no checkbox); the `manual-step` rule rejects them in `tasks.md`, and they are listed at the end of a v1 run. A real
  `BLOCKED: <reason>` from the agent stops the cascade.
- **In-repo skills & directives:** automatically discovers skills in `.agents/skills/` and `.claude/skills/`,
  plus root directive files (`AGENTS.md`, `CLAUDE.md`), injecting an indexed catalog and project constraints
  into initial session prompts across all engines (Claude, OpenCode, Antigravity).
- **Plan usage guard (Claude only):** before each task it reads `/usage`; at 95% on any meter it sleeps until
  that meter resets. A `rate_limit_event` mid-session aborts, sleeps and resumes the same session.
- **Cross-platform keep-alive:** automatically prevents system idle sleep during runs (`caffeinate` on macOS,
  `systemd-inhibit` on Linux, with graceful fallback in containers/WSL).
- **Two pipelines:** `--mode v1` (default) is the sequential loop above. `--mode v2` drives each task through a
  finite-state machine: Analyze → SDD gate → task DAG → worker session → Gate 0 (mechanical checks) → Gate 1
  (semantic review) → Gate 2 (adversarial probes, with `--full-gate`) → Gate 3 (forensic anti-cheat audit) →
  checkpoint commit, with failure escalation and git rollback. Gates review the complete working-tree diff,
  including new untracked files.
- **Resilient engines:** every engine is wrapped with retries (exponential backoff + jitter), a circuit breaker
  and per-session telemetry (latency, cost, tokens, retries, error category).
- **Self-improvement:** failures are recorded (secrets redacted) in `.cascade/telemetry/*.jsonl`; recurring
  failure signatures become up to 5 remediation directives injected into later prompts.
- **Spec review with EGM (optional):** with the [EGM plugin](https://github.com/google/elephant-goldfish-model)
  installed, `/cascade:explore`, `/cascade:cascade-spec-review` and `/cascade:cascade-spec-drift` add fresh-context
  reviewers before and after a run, and `spec-gate check` refuses changes whose review is open or stale.
  `/cascade:explore <change> <idea>` investigates, writes the brief, runs propose and ends with a readiness
  check; re-running it on a change that has `tasks.md` goes straight to that check.
  `/cascade:cascade-spec-brainstorm` is a deprecated alias. Read-only investigation is a prompt rule; the hard
  limits are the IAM policy of the declared AWS profile and the sandbox. In OpenCode, run `@openspec-propose`,
  then `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`.
  See [`docs/cli.md`](docs/cli.md).
- **Pre-PR review:** `review --base <branch>` runs a Greptile review on a shadow snapshot of your working tree,
  auto-fixes mechanical findings and stops on risky ones, bounded to 3 rounds.

## Requirements

- [Bun](https://bun.sh) 1.4+ (recommended) or Node.js 24 LTS (dependencies are installed with Bun)
- Claude engine: a Claude Code login (plan usage meters need a claude.ai credential).
- OpenCode engine: `opencode` CLI 2.x, authenticated with the provider of the chosen model.
- Antigravity engine: `agy` CLI installed in PATH and authenticated.
- Jules engine: `jules` CLI (`npm install -g @google/jules`) authenticated with `jules login` (interactive).
- Pre-PR review (optional): Greptile CLI v3 (`npm install -g greptile`), authenticated with `greptile login` or
  `GREPTILE_API_KEY`.
- Linux keep-alive (optional): `systemd-inhibit` (pre-installed on systemd distributions; gracefully skipped if missing).

```bash
bun install
```

## Installation (global command)

Link the package once to use `openspec-cascade` from any project directory:

```bash
bun link
openspec-cascade --repo <path> --changes change-a,change-b
openspec-cascade --help
```

`bun link` registers the `openspec-cascade` bin entry (`cascade.ts`, which runs under Bun) in `~/.bun/bin`;
make sure that directory is on your `PATH`. Run `bun install` in this repository first so the engines'
dependencies are available.

## Usage

The examples below use `bun run cascade.ts`; after `bun link` you can substitute `openspec-cascade`.

```bash
# Preview the plan: pending tasks, detected checks, commit types, current usage
bun run cascade.ts --repo <path> --changes change-a,change-b --dry-run

# Run (keep-alive prevents system sleep automatically on macOS and Linux)
bun run cascade.ts --repo <path> --changes change-a,change-b

# Dependency/toolchain changes: every committing task also runs the full suite
bun run cascade.ts --repo <path> --changes upgrade-deps --full-gate

# OpenCode engine (default model: opencode/deepseek-v4.1-flash#high)
bun run cascade.ts --repo <path> --changes upgrade-deps --engine opencode

# Antigravity engine (default model: gemini-3.8-flash-high)
bun run cascade.ts --repo <path> --changes upgrade-deps --engine antigravity

# Run without keep-alive
bun run cascade.ts --repo <path> --changes change-a --no-keep-alive

# v2 pipeline (FSM + Gates 0-3); --full-gate also enables Gate 2 adversarial probes
bun run cascade.ts --repo <path> --changes change-a --mode v2

# Same CLI on Node.js 24 LTS
node --import ./scripts/node_ts_register.mjs cascade.ts --repo <path> --changes change-a --dry-run

# Integration subcommands
bun run cascade.ts doctor --repo <path>
bun run cascade.ts setup discover --repo <path>
bun run cascade.ts review --repo <path> --base main
bun run cascade.ts catalog --sync --owner <org> --project <n> --owner-type organization
bun run cascade.ts drift --catalog projects/agnostic_looper/tasks_catalog.json --owner <org> --project <n>
bun run cascade.ts spec-gate check --repo <path> --stage review --changes change-a,change-b
bun run cascade.ts lint-tasks --repo <path> --changes change-a,change-b
```

| Flag / env | Meaning |
| :--- | :--- |
| `--repo` | Target repository (defaults to the current directory) |
| `--changes` | Comma-separated OpenSpec change names, in cascade order |
| `--dry-run` | Print the plan and usage; change nothing |
| `--full-gate` | Committing tasks also run the full verification suite |
| `--engine` | `claude` (default), `opencode`, `antigravity` (`agy`, `gemini`) or `jules` |
| `--mode` | `v1` (sequential loop, default) or `v2` (FSM pipeline with Gates 0-3) |
| `--budget`, `--total-budget` | Per-session and total USD caps (fail closed at `>=`) |
| `--max-attempts`, `--max-turns` | Attempts per task, turns per session |
| `--resilient` | Continue with the next task after a failed (rolled back) task |
| `--settings` | Extra Claude Code settings file for every session (Claude engine only), e.g. a sandbox for unattended runs |
| `--no-keep-alive` | Disable automatic OS sleep inhibitor (`caffeinate` / `systemd-inhibit`) |
| `--allow-dirty` | Start with a dirty tree; those files land in the first commit |
| `--log-dir` | Directory for run logs (see [Logs](#logs)) |
| `--help`, `-h` | Print all flags, environment variables and examples, then exit |
| `CASCADE_MODEL` | Model alias or ID (OpenCode: `provider/model[#variant]`, Antigravity: `gemini-3.8-flash-high`) |
| `CASCADE_EFFORT` | `low`…`max`, or `none` to omit it |
| `CASCADE_LOG_DIR` | Same as `--log-dir`; the flag takes precedence |
| `CASCADE_SETTINGS` | Same as `--settings`; the flag takes precedence |

All flags, environment variables and subcommands: `--help` or [`docs/cli.md`](docs/cli.md).

Refuses to run on `stable`, `main` or `master` (except `--dry-run`). Change ids must be plain directory names
(`[A-Za-z0-9][A-Za-z0-9._-]*`), and task `Verify:` commands containing shell operators (`;`, `&`, `|`, `$(`,
redirections) are ignored.

### Helper manifest (`setup`)

The manifest records which helpers (MCP servers, skills, plugins, CLI tools) a project can use and when. `setup` discovers and registers them; it never installs anything. Runs do not read it: only `doctor` and `/cascade:explore` do.

```bash
bun run cascade.ts setup discover --json --repo <path>
bun run cascade.ts setup add --scope project --name stitch --type mcp --when "Before UI tasks, fetch the screen design" --host opencode
bun run cascade.ts setup remove --scope project --name stitch --type mcp
bun run cascade.ts setup show --json --repo <path>
bun run cascade.ts setup rules --write --repo <path>
```

- **Actions.** `discover [--json]`, `add --scope project|global --name --type --when [--required] [--check] [--profile] [--host]...` (upsert by name and type; `--host` repeats), `remove --scope --name --type`, `show [--json]`, `rules [--write]` (appends suggested `rules` to `openspec/config.yaml` only if it has no `rules` key; otherwise exit 1). Exit `2` on usage errors or an invalid manifest.
- **Two layers.** Global: `$XDG_CONFIG_HOME/openspec-cascade/manifest.json` (default `~/.config/openspec-cascade/manifest.json`). Project: the `manifest` key of `.openspec-cascade.json`. Both hold `{"entries": [...]}`; a project entry replaces the global one with the same (`name`, `type`). No secrets, only names.
- **Entry fields.** `name`; `type` (`mcp`, `skill`, `plugin`, `cli`); `whenToUse` (required, one line, max 200 chars); `required` (boolean, default false); `check` (optional single command); `profile` (optional non-secret name, e.g. an AWS profile, passed as `--profile`); `hosts` (optional, `claude-code` and/or `opencode`).
- **`show --json`.** `{"entries":[{name, type, whenToUse, required, check?, profile?, hosts?, layer}]}`, sorted by name then type; `layer` is `global` or `project`; unset optional fields are omitted.
- **`discover --json`.** `{"candidates":[{name, type, sources, hosts, inManifest}], "skipped":[{source, reason}]}`; `inManifest` is `null`, `global` or `project`. Only names are read, never values.
- **`doctor`.** Adds one check per entry. It runs the `check` of global entries by default and the `check` of project entries only with `--run-project-checks`, because the project layer comes from the repository. A failing required entry is `fail`, an optional one `warn`; an invalid manifest is one failing `manifest` check.
- **Read-only is not enforced.** A `check` runs exactly as written; keeping it read-only is up to whoever writes it.
- **claude.ai connectors** cannot be discovered; register them by hand with `setup add`.
- **Claude Code:** run `/cascade:setup`. It runs `discover`, proposes helpers, lets you pick them and write a `whenToUse` for each, asks about missing ones, calls `add`, and offers `rules`.
- **OpenCode:** there is no command file; run the CLI actions above directly (`discover`, `add`, `show`, `rules`).

### Logs

Each run writes a JSON Lines file named `<timestamp>.jsonl`. The directory is chosen in this order:

1. `--log-dir <path>`
2. `CASCADE_LOG_DIR`
3. `~/.cache/openspec-cascade/logs/<repo name>/` (the default; `<repo name>` is the basename of `--repo`)

Relative paths are resolved against the current directory. The directory and file are created on the first
write, and `--dry-run` writes no log at all.

## Cross-platform keep-alive

`cascade.ts` includes built-in sleep inhibition to ensure long runs proceed without OS sleep interruption:

- **macOS (`darwin`)**: Spawns `caffeinate -i -w <pid>` bound to the harness process PID (`process.pid`), ensuring caffeinate exits if the harness terminates.
- **Linux (`linux`)**: Automatically detects and invokes `systemd-inhibit --what=idle:sleep` to block system idle and sleep states.
- **Graceful fallback**: If `systemd-inhibit` is unavailable or fails permissions (such as in headless Docker containers or WSL), a warning is logged and execution proceeds uninterrupted using a no-op fallback.
- **Lifecycle cleanup**: Signal listeners (`SIGINT`, `SIGTERM`, and process `exit`) automatically stop background inhibitors cleanly.
- **Opt-out**: Pass `--no-keep-alive` to disable sleep inhibitors.

## In-repo skills & project directives

`cascade.ts` automatically discovers repository-specific skills and architectural directives, injecting them into initial task prompts to ensure consistent agent behavior and guideline compliance across all execution engines:

- **Skill discovery**: Scans `.agents/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md` in the target repository. Parses YAML frontmatter (`name`, `description`) without external dependencies.
- **Indexed catalog**: Formats discovered skills into an XML catalog (`<skills>`) containing skill names, relative paths, and descriptions. This preserves context token budget while allowing agents to inspect full skill bodies on demand using file reading tools.
- **Project directives**: Discovers root `AGENTS.md` and `CLAUDE.md` files and injects their contents under `<project-directives>` as project-wide constraints.
- **Cross-engine parity**: Centralized in `taskPrompt()`, guaranteeing identical context injection for Claude, OpenCode, and Antigravity.

## Adapting it

Every limit and default lives in `src/config/constants.ts` and can be overridden through flags, `CASCADE_*`
variables or a `.openspec-cascade.json` file in the target repo. Verification commands adapt to the detected
package manager (`bun`, `pnpm`, `yarn`, `npm`); Nuxt programs are only added when a Nuxt project is detected.

## Architecture

| Layer | Location |
|---|---|
| Configuration, Zod schemas, guardrails | `src/config/` |
| Isomorphic process runtime (`ISpawner`, Bun + Node) | `src/runtime/` |
| Engine factory, PAL adapters and bridge | `src/pal/` |
| Resilience and telemetry decorators | `src/decorators/` |
| Orchestration (`CascadeFacade`, v2 pipeline, task helpers) | `src/facade/` |
| Harness injector, self-improver, pre-PR loop, FSM, DAG, dispatcher, escalation | `src/core/` |
| Gates 0-3 | `src/gates/` |
| Greptile client, shadow commits, cache, bridge | `src/integration/greptile/` |
| Catalog, drift and GitHub Project integration | `src/integration/` |
| CLI subcommands | `src/cli/` |
| Claude Code plugin (commands, skills, SDD hooks) | `plugins/cascade/` |

## Known limits

- OpenCode's JSON output carries no cost, so the total budget cap does not apply there; there is also no plan
  usage meter (a rate-limit error pauses 30 minutes) and no turn limit (sessions are cut at 45 minutes).
- OpenCode loads your global `~/.config/opencode` configuration; the Claude engine loads only project settings,
  plus the file passed with `--settings` (the flag settings layer, above project settings). Use it to run every
  session inside the Claude Code sandbox:

  ```json
  { "sandbox": { "enabled": true, "failIfUnavailable": true, "allowUnsandboxedCommands": false,
                 "network": { "allowedDomains": ["github.com"] } } }
  ```

  Verification commands and commits run in the cascade process itself, outside that sandbox.
- Jules has no documented headless login for its CLI; unattended runs need a pre-authenticated machine.
- Gate 2 adversarial probes run test files with Bun; on Node-only machines Gate 2 is skipped and logged.
- The Greptile CLI reviews committed work only; `review` therefore snapshots your working tree into a temporary
  shadow worktree (your HEAD, index and branches are never modified).

## Tests and CI

```bash
bunx tsc --noEmit && bunx eslint .
bun run scripts/forensic_audit.ts        # zero any, zero comments in function bodies, zero E2E mocks
bun run scripts/sync_plugin.ts --check   # plugin SDD hook rules match the TypeScript constants
bunx openspec validate --all --strict
bun test                                 # unit, integration and E2E Tiers 1-5
npm run test:node                        # Node.js 24 parity suite
```

The CI workflow (Bun job + Node 24 job) is versioned at `ci/github-workflows/ci.yml`. Install it with
`mkdir -p .github/workflows && cp ci/github-workflows/ci.yml .github/workflows/ci.yml` using a GitHub credential
that has the `workflow` scope.
