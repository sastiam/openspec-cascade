---
egm: review
status: open
hash: 8582911cc12a431ef039be36f7937809b3c23060657c34cbb85d66e2c4ea632b
---
# Review: run-outcome (EGM stage 7)

Status: findings open, pending triage.

## Blockers
- Section-commit mode: when a task parks, earlier verified tasks of the section stay uncommitted; later commits (`git add -A`, summary, code review) sweep them in, or the next run fails preflight with a dirty tree.
- The code-review stamp is written into the file after the commit, leaving every reviewed run dirty.
- `minConfidence` cannot work: Greptile confidence is dropped in `bridge.ts` and never reaches `PrePrLoopResult`; tasks forbid touching those files.
- No Alternatives section.

## Major
- Restoring the tree with `checkout-index` does not delete files deleted before the task; use `read-tree -u --reset`.
- Parking with rollback off is undefined; it must be a config error or always roll back.
- Code-review stamp freshness ignores source code; key it to the reviewed HEAD.
- Review fixer sessions bypass the run's budget, settings and engine, and may commit despite the prompt.
- Stale parked files (renumbered or edited task) are not handled.
- No summary is written when the run stops on a run-level error.
- Scope differs from the brainstorm brief without a recorded reason; brief items dropped (base commit, retry/skip answers).
- Committed patches can leak secrets (`.env*` not in neverCommit); facade would depend on `src/core` scheduled for pruning.
- Undefined: `partial`, round format, failure cap value, exclude lists, `gatherFacts` is not pure, injection point for the fake Greptile client.

## Nits
- Temp index location, resumed task commit in section mode, failure text without verification output, ignored files not reverted, per-change duplication of the review, summary commit on no-op runs.
