---
name: pre-pr-review
description: Pre-PR review protocol enforcing diff-match verification against git merge-base (preventing stale cache hits), finding triage, and bounded fix loops before creating a pull request.
---

# Pre-PR Review & Diff-Match Verification

Before a change is committed or submitted as a Pull Request, it must undergo automated review and diff-match verification to prevent stale review results, regressions, and security oversights.

---

## 1. Fork-Point Diff Resolution
- Reviews must be computed against the fork point (`git merge-base <base> HEAD`), NOT against the head of the base branch. This avoids polluting the diff with unrelated upstream commits.
- Review file set must include committed branch changes PLUS uncommitted working tree modifications (`git status --porcelain`).

---

## 2. Stale Cache-Hit Guard
- **Mandatory verification:** Compare files referenced in review findings against `git diff <base>...HEAD --name-only`.
- If review files do not overlap with the branch diff, or if the review returned suspiciously fast (sub-10s cache hit from an external service), flag it as **STALE** and re-run.
- Never accept findings or recommendations from an unverified or mismatched review.

---

## 3. Finding Triage & Bounded Fix Loops
- **Mechanical Findings** (formatting, missing null-guard, typo, unused import): Fix immediately.
- **Risky Findings** (concurrency, security, crypto, data loss, API contract alteration): Propose solution with rationale.
- **False Positives / Nits:** Document reason for dismissal in PR notes; do not degrade code clarity for noise.
- **Bounded Iteration:** Maximum 2 fix rounds. If blocking defects persist, halt and escalate.
- Re-run deterministic test floor (`bun test`, `tsc --noEmit`, `eslint .`) following any fix.
