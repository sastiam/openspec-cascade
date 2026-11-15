# Proposal: Milestone M3 — Greptile CLI Integration

## Why

The pre-PR review loop (`src/sdd/review_verifier.ts`) verifies findings against the branch diff, but nothing produces those findings: there is no Greptile integration, no isolation of uncommitted work, no cache, and no way to feed review context into agent prompts. The Greptile CLI v3 (`greptile review --json`, `greptile review status --json`, `greptile whoami`, `GREPTILE_API_KEY`) reviews only committed changes on the checked-out branch and exposes no `query`/`index` commands, so the integration must snapshot uncommitted work without mutating the user's repository and must build query/context capabilities on top of review findings.

## What Changes

1. **F10 — `src/integration/greptile/client.ts`**: `IGreptileClient` (`checkStatus`, `review`, `reviewStatus`, `query`) implemented by `GreptileCliClient` over `ISpawner`, with Zod-validated parsing of the documented `comments[]` JSON (`path`, `startLine`, `endLine`, `severity`, `securityIssue`, `body`) and a typed error taxonomy (`not_installed`, `auth`, `rate_limit`, `timeout`, `invalid_output`, `command_failed`). `query` ranks the findings of a review by lexical relevance to a question, because the CLI has no query command.
2. **F11 — `src/integration/greptile/shadow.ts`**: `ShadowCommitManager` snapshots the working tree through an isolated `GIT_INDEX_FILE` (`read-tree`, `add -A`, `write-tree`, `commit-tree`), pins it with a private `refs/cascade/shadow/*` ref, exposes it through a temporary detached worktree, and removes index, ref and worktree in `finally`.
3. **F12 — `src/integration/greptile/cache.ts`**: `GreptileCache` stores results under `.cascade/cache/greptile/` keyed by `SHA-256(baseSha, diffHash, query)` with TTL, atomic writes and `fail-open` / `fail-closed` policies.
4. **F13 — `src/integration/greptile/{search,bridge}.ts`**: `formatGreptileContext(findings, tokenBudget)` produces a severity-ordered, token-budgeted prompt block; `GreptileReviewBridge.review()` composes shadow worktree → merge-base diff → cache → client → `verifyReviewFindings` (stale `< 10s` guard, diff-match) and returns verification, findings and context. `review_verifier.ts` gains `reviewFilesFromFindings` and path normalization shared with the bridge.
5. `PROJECT.md` interface contract is updated to the real CLI surface (`reviewStatus` replaces `index`).

## Definition of Done

- `bunx openspec validate cascade-m3-greptile-integration --strict` exits `0`.
- `bun test`, `bunx tsc --noEmit`, `bunx eslint .`, `bun run scripts/forensic_audit.ts` and `npm run test:node` exit `0`.
- Shadow-commit tests prove `HEAD`, the index, branches, refs and the working tree are byte-identical before and after.
