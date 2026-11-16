# Goldfish Review Report: Stage 8 (Intermediate Zoom Out)

**Target:** `openspec/changes/tasks-lint/design.md` (whole file)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |

The reviewer read the Stage 5, 6 and 7 reports and asked whether the fixes they imply would grow the design. Findings from earlier stages are not repeated.

Severity breakdown: 0 Blockers on altitude, 5 Majors, 7 Nits. The reviewer confirms the Stage 7 blocker (B1: the preflight misses v2 and dry-run); the simplest fix is M2 below.

## Verdict

The core is at the right altitude: a pure `lintTasks`, a thin CLI, one facade preflight. The risk is that the accumulated fixes (a third rule, a shared tokenizer, a registry, a hardened marker, re-linting per task, a findings file) turn a small gate into a framework. Most of that goes away if one thing is removed: the skip marker.

## Major

### M1. Remove the skip marker instead of hardening it - Severity: Major
* **Affected Scope:** Decision 8, Risks, Open Questions, Migration step 2, tasks 1.3 and 3.1.
* **Discrepancy Description:** The marker brings a spec requirement with two scenarios, `hasSkipMarker`, a `skipped` output format, a 29-file edit to completed changes, a change in spec-gate hashes, and a test exemption that cannot be coded. Its bypass then invites hardening (ignore it when `review.md` exists, a fixed legacy list, a config allowlist), which is more machinery patching a hole the marker created. The claim in Open Questions that the choice "does not change the specs or tasks" is false.
* **Rationale & Recommendation:** Lint only unchecked (`- [ ]`) tasks, as already suggested in Stage 5. The runner executes only unchecked tasks, and all legacy changes are fully `[x]`, so they pass untouched. The "Checked task" scenario in the spec flips. First confirm that no legacy file contains a fence; if some do, restrict `no-code-block` to blocks belonging to unchecked tasks or accept a one-off cleanup. A config allowlist is the same machinery in another place.

### M2. Put the preflight at the runner's single choke point - Severity: Major
* **Affected Scope:** Decision 7 (line 38).
* **Discrepancy Description:** `runChange` serves v1 only; `execute()` routes v2 elsewhere.
* **Rationale & Recommendation:** One call to a `lintChanges(ctx)` in or next to the existing `preflight(ctx)`, before the v1/v2 split, looping over all `--changes`. That also fixes the Stage 7 finding that change B is linted after A has run. One call site, one facade test plus a v2 smoke test. Say that dry-run skips the lint (the cheaper choice).

### M3. Fix `parseTasks` instead of building a shared tokenizer or a divergence rule - Severity: Major
* **Affected Scope:** Decision 2 (line 28), Goals (line 15).
* **Discrepancy Description:** The earlier reports offer four options; a shared `scanTaskBlocks` or a "runner sees fewer tasks" finding adds an abstraction and widens scope.
* **Rationale & Recommendation:** Make `parseTasks` normalize `\r\n?` and strip a BOM (one small, low-risk change at the root component), and let `lintTasks` import the same normalization. Drop the lint's "heading of any level" clause: every heading is column 0 and already ends a block, which also removes the H1 disagreement. Keep the agreement test over LF, CRLF, CR and BOM and name its scope as "tasks with an ID". Do not make the lint reproduce parser quirks.

### M4. Do not add a rule for "Verify: has a runnable command" - Severity: Major
* **Affected Scope:** Decision 2, Risks.
* **Rationale & Recommendation:** Accept the loose rule and record the gap in Risks as one known-gap line. A third rule needs the runner's command pattern, `isSafeVerifyCommand`, a literal opt-out for prose checks and warning semantics, which goes against the "no warnings" non-goal. The runner falls back to `defaultVerify`, so this degrades gracefully. A rule registry waits until a third rule exists; replace "for now" at line 26 with that trigger.

### M5. Reject re-linting per task and the findings file - Severity: Major
* **Affected Scope:** Decision 7, Risks.
* **Rationale & Recommendation:** Re-linting every iteration adds a new mid-run `Fatal` mode and halts runs when agents reword tasks; mid-run edit detection was an explicit non-goal. A findings file is speculative, since stderr and `Fatal` carry the same information. Record both as rejected alternatives with one-line reasons so later reviewers do not reopen them.

## Nits

* Decisions 2 and 3 are in the weeds (exact regex, fence closer length, "one function per rule", "one pass"). The spec and tests own this; replace with short behavior statements. This removes the garbled "up to any leading whitespace".
* `change_args.ts` is justified. Keep it a pure move, rename `SpecGateOutput` to a neutral name, and avoid a new constants indirection.
* Decision 6 (separate subcommand) is sound; do not fold it into `spec-gate`.
* Decision 4: if the marker goes, `skipped` in the ok line goes too. Give the technical reason for exit 2 on a missing file (an input error, matching the `Fatal` that `runChange` already throws) and drop "the author's decision".
* Line 10: "All 29" goes stale; if the marker goes, this line and the 3.1 file edit go with it.
* Rollback (lines 48 and 55): both disappear if the marker is dropped.
* Context: add two sentences of problem statement (agents put code in `tasks.md`; a prompt rule can be ignored). Gloss or replace "Goldfish review" and "looper".

## Net effect if adopted

* Dropped: `hasSkipMarker`, the marker requirement and its two scenarios, the 29-file edit and the test exemption, migration step 2, the `skipped` output, the hardening open question, and a per-path facade preflight.
* Added: CRLF and BOM normalization in `parseTasks`, and one preflight call before the v1/v2 split.
* Result: fewer files touched, one trust boundary less and a smaller test matrix, with the same guarantee ("no engine session starts on a bad `tasks.md`"), now covering v1, v2 and every listed change.
