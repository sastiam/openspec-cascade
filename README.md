# openspec-cascade

Runs [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes autonomously, one task per agent session, until
every task in `tasks.md` is done. The harness, not the model, decides whether a task is finished: it runs the
task's checks itself, feeds failures back for a retry, and commits only verified work.

Engines: the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/agent-loop) (default) or the
[OpenCode](https://opencode.ai) CLI.

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

## Requirements

- [Bun](https://bun.sh) 1.4+
- Claude engine: a Claude Code login (plan usage meters need a claude.ai credential).
- OpenCode engine: `opencode` CLI 2.x, authenticated with the provider of the chosen model.

```bash
bun install
```

## Usage

```bash
# Preview the plan: pending tasks, detected checks, commit types, current usage
bun run cascade.ts --repo <path> --changes change-a,change-b --dry-run

# Run (caffeinate keeps macOS awake during long runs)
caffeinate -i bun run cascade.ts --repo <path> --changes change-a,change-b

# Dependency/toolchain changes: every committing task also runs the full suite
caffeinate -i bun run cascade.ts --repo <path> --changes upgrade-deps --full-gate

# OpenCode engine (default model: opencode/deepseek-v4.1-flash#high)
caffeinate -i bun run cascade.ts --repo <path> --changes upgrade-deps --engine opencode
```

| Flag / env | Meaning |
| :--- | :--- |
| `--repo` | Target repository (defaults to the current directory) |
| `--changes` | Comma-separated OpenSpec change names, in cascade order |
| `--dry-run` | Print the plan and usage; change nothing |
| `--full-gate` | Committing tasks also run the full verification suite |
| `--engine` | `claude` (default) or `opencode` |
| `--allow-dirty` | Start with a dirty tree; those files land in the first commit |
| `CASCADE_MODEL` | Model alias or ID (OpenCode: `provider/model[#variant]`) |
| `CASCADE_EFFORT` | `low`…`max`, or `none` to omit it |

Refuses to run on `stable`, `main` or `master`. Logs go to `logs/*.jsonl`.

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
