# Design: Milestone M3 — Greptile CLI Integration

## Context

Documented Greptile CLI v3 surface (greptile.com/docs, CLI reference v3.2.3, evaluate-with-cli): `greptile review [-b/--branch <base>] --json` prints one review object (`summary`, `confidence`, `comments[]`) on stdout with progress on stderr; `greptile review status [--commit <sha>] --json` exits `0` completed, `1` none/signed-out, `2` invalid, `3` running, `4` failed, `5` cancelled; `greptile whoami` reports authentication; `GREPTILE_API_KEY` authenticates CI. Reviews cover committed changes only. No REST endpoint, `query` or `index` command is documented.

## Decisions

### Decision 1: Review Uncommitted Work Through a Detached Shadow Worktree
- **Structure:** `ShadowCommitManager.withShadowWorktree(repo, fn)` creates the shadow commit, runs `git worktree add --detach <tmp> <sha>`, invokes `fn(worktreePath)` and always runs `git worktree remove --force` + `git worktree prune`, deletes the shadow ref and the temp index.
- **Rationale:** The CLI reviews the checked-out HEAD; a detached worktree gives it a committed snapshot without moving the user's HEAD, index or branch.

### Decision 2: Lenient, Validated JSON Parsing
- **Structure:** A Zod schema accepts the documented fields, tolerates unknown fields, and normalizes `severity` (missing → `medium`, `securityIssue: true` → at least `high`). Non-JSON stdout raises `GreptileError(kind: "invalid_output")`.
- **Rationale:** The CLI is evolving (v3.2 → v3.8 in the docs); validation must not break on additive changes yet must fail closed on garbage.

### Decision 3: Error Taxonomy From Exit Codes and stderr
- **Structure:** `SpawnError` → `not_installed`; timeout → `timeout`; stderr matching `AUTH_FAILURE_PATTERN` → `auth`; `RATE_LIMIT_PATTERN` → `rate_limit`; other non-zero exits → `command_failed`. Only `rate_limit` and `timeout` are retryable.
- **Rationale:** Mirrors the PAL error model so the escalation ladder can treat review failures like engine failures.

### Decision 4: Query as Relevance Ranking Over Findings
- **Structure:** `query({ question, findings })` scores each finding by term overlap (terms ≥ `QUERY_MIN_TERM_LENGTH`) across path and body, weighted by severity, and returns the ranked subset with scores.
- **Rationale:** No query command exists; ranking real findings for a task is the useful, honest equivalent for prompt injection.

### Decision 5: Cache Keyed on Merge-Base, Diff Hash and Query
- **Structure:** The bridge caches the verified review under `cacheKey({ baseSha: mergeBase, diffHash: sha256(patch), query: "__review__" })`. A cache hit returns the stored verification with `cached: true` and never re-runs the stale-response guard.
- **Rationale:** Identical merge-base + identical patch means an identical review input; the `< 10s` guard targets Greptile's server-side stale cache, not this local, content-addressed one.

### Decision 6: Token-Budgeted Context
- **Structure:** Findings are sorted by severity rank then path/line, rendered as Markdown bullets, and appended while `ceil(chars / CHARS_PER_TOKEN)` stays within budget; an omission line reports the remainder.
- **Rationale:** Deterministic, bounded prompt injection for `HarnessInjector` (M4).
