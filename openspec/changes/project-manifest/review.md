---
egm: review
status: open
hash: 6c3886947a1356adc042a6eff4317044d02aa916f2d70bd5ff5adaeaf9053765
---
# Review: project-manifest (EGM stage 7)

Status: triaged; all findings addressed or withdrawn.

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

## Stage 9 (implementation readiness, codebase details, style)

Findings were applied to the artifacts on 2026-11-17. Main points:
- Regression-guard tests are exempt from the red-first rule; behavior-changing tests must fail first.
- Every subcommand or flag is documented in the same task that adds it (docs-parity test), and the last code task runs the whole suite.
- Verify lines use only commands the harness runs (`bun ...`); doc content checks use `bun -e`, not grep.
- Exact literals, fixtures and helper names are given in design.md and tasks.md; ESLint rules (no magic numbers, explicit return types) are stated.

## Triage resolution

- Stage 7 decisions taken by the author on 2026-11-17: v1 only (v2 is being deprecated); read-only investigation with a declared AWS profile and MCP read verbs; manifest with `profile` and `hosts`; doctor runs project checks only with `--run-project-checks`; manifest validated loosely during runs; explore runs propose inline; narrowed manual-step phrases.
- Decision "checkbox plus checks for tasks without Verify" was withdrawn: the preflight lint already rejects such tasks, so the case cannot occur in real runs.
- All remaining findings were addressed in the artifacts; none were declined.
