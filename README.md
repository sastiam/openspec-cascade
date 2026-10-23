# openspec-cascade

Runs [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes autonomously, one task per agent session, until
every task in `tasks.md` is done. The harness, not the model, decides whether a task is finished: it runs the
task's checks itself, feeds failures back for a retry, and commits only verified work.

Engines: the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/agent-loop) (default), the
[OpenCode](https://opencode.ai) CLI, or the Google [Antigravity](https://antigravity.google) CLI (`agy`).

## How it works

- **Cascade:** changes run in the order given; a change finishes before the next one starts.
- **One fresh session per task.** State lives in `tasks.md` and git, so an interrupted run resumes at the first
  unchecked task.
- **Checks are the oracle.** A task containing `Verify:` or "full verification" gets its commands run by the
  harness (backticked `bun …` spans plus shorthand like "lint", "build", "both tsc", "E2E"). Up to 3 attempts per
  task; each retry receives the failing output.
- **Commits:** a task that names a type (``Commit `fix(deps)` ``) is committed with that type. In changes that
  name no types, one commit per section. The agent can never commit, push, reset, checkout, stash or run
  migrations.
- **Human tasks** (opening a PR, deciding delivery) are skipped and listed at the end. A real
  `BLOCKED: <reason>` from the agent stops the cascade.
- **Plan usage guard (Claude only):** before each task it reads `/usage`; at 95% on any meter it sleeps until
  that meter resets. A `rate_limit_event` mid-session aborts, sleeps and resumes the same session.
- **Cross-platform keep-alive:** automatically prevents system idle sleep during runs (`caffeinate` on macOS,
  `systemd-inhibit` on Linux, with graceful fallback in containers/WSL).

## Requirements

- [Bun](https://bun.sh) 1.4+
- Claude engine: a Claude Code login (plan usage meters need a claude.ai credential).
- OpenCode engine: `opencode` CLI 2.x, authenticated with the provider of the chosen model.
- Antigravity engine: `agy` CLI installed in PATH and authenticated.
- Linux keep-alive (optional): `systemd-inhibit` (pre-installed on systemd distributions; gracefully skipped if missing).

```bash
bun install
```

## Usage

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
```

| Flag / env | Meaning |
| :--- | :--- |
| `--repo` | Target repository (defaults to the current directory) |
| `--changes` | Comma-separated OpenSpec change names, in cascade order |
| `--dry-run` | Print the plan and usage; change nothing |
| `--full-gate` | Committing tasks also run the full verification suite |
| `--engine` | `claude` (default), `opencode`, or `antigravity` (`agy`) |
| `--no-keep-alive` | Disable automatic OS sleep inhibitor (`caffeinate` / `systemd-inhibit`) |
| `--allow-dirty` | Start with a dirty tree; those files land in the first commit |
| `CASCADE_MODEL` | Model alias or ID (OpenCode: `provider/model[#variant]`, Antigravity: `gemini-3.8-flash-high`) |
| `CASCADE_EFFORT` | `low`…`max`, or `none` to omit it |

Refuses to run on `stable`, `main` or `master`. Logs go to `logs/*.jsonl`.

## Cross-platform keep-alive

`cascade.ts` includes built-in sleep inhibition to ensure long runs proceed without OS sleep interruption:

- **macOS (`darwin`)**: Spawns `caffeinate -i -w <pid>` bound to the harness process PID (`process.pid`), ensuring caffeinate exits if the harness terminates.
- **Linux (`linux`)**: Automatically detects and invokes `systemd-inhibit --what=idle:sleep` to block system idle and sleep states.
- **Graceful fallback**: If `systemd-inhibit` is unavailable or fails permissions (such as in headless Docker containers or WSL), a warning is logged and execution proceeds uninterrupted using a no-op fallback.
- **Lifecycle cleanup**: Signal listeners (`SIGINT`, `SIGTERM`, and process `exit`) automatically stop background inhibitors cleanly.
- **Opt-out**: Pass `--no-keep-alive` to disable sleep inhibitors.

## Adapting it

The verification commands (`FULL_VERIFY`, `TSC_SERVER`, `TSC_APP`, `DEFAULT_VERIFY`) and limits (budget, turns,
attempts) are constants at the top of `cascade.ts`; they currently target a Nuxt + Bun project.

## Known limits

- OpenCode's JSON output carries no cost, so the total budget cap does not apply there; there is also no plan
  usage meter (a rate-limit error pauses 30 minutes) and no turn limit (sessions are cut at 45 minutes).
- OpenCode loads your global `~/.config/opencode` configuration; the Claude engine loads only project settings.

## Tests

```bash
bun test && bunx tsc --noEmit
```
