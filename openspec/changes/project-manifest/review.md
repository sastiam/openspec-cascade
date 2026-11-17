---
egm: review
status: open
hash: 6c3886947a1356adc042a6eff4317044d02aa916f2d70bd5ff5adaeaf9053765
---
# Review: project-manifest (EGM stage 7)

Status: findings open, pending triage.

## Blockers
- No structured field for the read-only AWS profile (cascade-explore depends on it).
- `doctor` would run `check` commands from a cloned repo's `.openspec-cascade.json`; `isSafeVerifyCommand` allows `sh -c`, `node -e`, `rm -rf`. New code-execution path from repo content.
- No Alternatives section; the one rejection cites "the author chose".

## Major
- A bad `manifest` in the strict file schema breaks every run (contradicts "no change to runs"); validate it loosely in the run loader.
- `runDoctor` has no injected paths; a bad manifest would crash doctor instead of reporting one failing check.
- Check timeout would be the 30-minute command timeout; argv split rule undefined.
- `--json` shapes of `discover` and `show` undefined although explore and the plugin command consume them.
- Merge by name collides with different types (engram cli vs mcp).
- Discovery misses claude.ai connectors, project-level enabled plugins, and worktree/realpath keys under `projects`.
- JSONC comment stripping is fragile (URLs, trailing commas).
- Entries do not record which host (Claude Code / OpenCode) has the helper.
- Exit codes conflict (0/2 vs exit 1 for refused rules write); flag names for `add` not named; OpenCode skill paths not listed.

## Nits
- Atomic writes, rules edge cases, whenToUse length rule, OpenCode users need a CLI flow.
