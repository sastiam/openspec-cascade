# Goldfish Review Report: Stage 5 (Initial Zoom Out)

**Target:** `openspec/changes/tasks-lint/design.md` (whole file)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |
| `egm-inventive-catalyst` | completed |

The first attempt through `egm-synthesizer` ended before its reviewers returned and wrote no report. The two reviewers were then dispatched directly and this report was written by the main context.

Severity breakdown: 0 Blockers, 6 Majors (3 distinct after merging), 12 Nits.

## Prioritized Findings

### M1. The skip marker lets an author or agent bypass the gate - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` (M2), `egm-inventive-catalyst` (M1)
* **Affected Scope:** Decision 8, Risks, Open Questions, migration step 2
* **Discrepancy Description:** The marker sits in the same `tasks.md` the lint protects. The "adding it mid-run changes nothing" argument covers only the current run. A new `tasks.md` written with the marker, a previous run, or an edit to another change's file all bypass the gate. "Visible in review" is the same kind of prose control the proposal rejects. The open question is not deferrable: it changes the migration and the skip requirement in the spec.
* **Rationale & Recommendation:** Both reviewers prefer dropping the marker and linting only what the runner executes, which is unchecked tasks. All 29 legacy changes are fully `[x]`, so they pass with no marker and no edits to completed changes. This removes `hasSkipMarker`, the skip requirement, migration step 2 and task 3.1. The scenario "Checked task" in the spec would change. Alternative: keep an exemption list outside the agent-edited file (committed allowlist in config). The author chose opt-out with a marker earlier; this finding asks to revisit that choice.

### M2. "Lint agrees with the runner" is false for CRLF, CR, BOM and H1 headings - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` (M1), `egm-inventive-catalyst` (M3, N1)
* **Affected Scope:** Goals, Decision 1, Decision 2, spec requirement "Findings are stable and ordered", task 1.4
* **Discrepancy Description:** `parseTasks` splits only on `\n`, and its task regex ends in `(.*)$`, where `.` does not match `\r`. A CRLF `tasks.md` gives the runner zero tasks while the lint normalizes line endings and passes it. CR-only and BOM input differ the same way. The runner ends a block only at headings of level two or deeper; the lint ends it at any heading. Task 1.4 would fail on CRLF or pass with zero tasks.
* **Rationale & Recommendation:** Choose one: share one normalizing and block-splitting step between `parseTasks` and `lintTasks` (for example a `scanTaskBlocks` in `src/sdd/` that `parseTasks` filters and maps); or fix `parseTasks` to normalize line endings; or make the lint report a finding when the runner would see fewer tasks than the lint does; or narrow the CRLF/CR scenarios. At minimum task 1.4 must run over LF, CRLF, CR and BOM variants and over an H1 heading. Changing `parseTasks` changes runner behavior for existing CRLF files.

### M3. A file edited during a run is not linted, though re-linting is nearly free - Severity: Major
* **Reviewer Lens:** `egm-inventive-catalyst` (M2)
* **Affected Scope:** Decision 7, Risks, Non-Goals
* **Discrepancy Description:** The design treats "lint once" against "catch mid-run edits" as a trade-off. `lintTasks` is pure and the runner already re-reads `tasks.md` before every task, so linting that same text costs almost nothing and needs no hash.
* **Rationale & Recommendation:** Lint the text the loop re-reads and throw `Fatal` before the next engine session. Checkbox toggles do not trigger findings. Side effect: an agent that legitimately edits its own task text may halt the run. The author decided earlier on once per change; this is a request to reconsider. It disappears as a concern if M1 drops the marker only partly: the marker question and this one are independent.

### M4. Any text after `Verify:` passes, but the runner executes only backticked package-manager commands - Severity: Major
* **Reviewer Lens:** `egm-inventive-catalyst` (M4)
* **Affected Scope:** Decision 2, rule `missing-verify`
* **Discrepancy Description:** `Verify: it works` passes the lint but gives `verifyCommands` no command, so the runner falls back to the default verify. The aim "every task is verifiable" is not enforced.
* **Rationale & Recommendation:** Either require at least one backtick span matching the runner's command pattern (and add a literal opt-out for prose checks), or keep the rule loose and accept the fallback. The first contradicts the "no warnings" non-goal and widens scope; decide deliberately. The command pattern should live in one place if the lint depends on it.

### Nits
* **N1 (zoom-out).** Decisions 2 and 3 carry code-level detail (the exact regex, fence closer length); the spec already holds the behavior. The phrase "up to any leading whitespace" in Decision 3 is garbled.
* **N2 (zoom-out).** "One function per rule" and "scan fence state in one pass" in Decision 1 are internal structure. The rule IDs `no-code-block` and `missing-verify` are named only in the proposal; state them in the design.
* **N3 (zoom-out).** `SpecGateOutput` is a spec-gate name; move the output type into `change_args.ts` under a neutral name. `changeDirOf` uses `SPEC_GATE_CONSTANTS`; say where those constants move so the shared module does not depend on spec-gate.
* **N4 (zoom-out).** "All 29" in the Context goes stale; say "every existing change" and let the task 3.1 test enforce it.
* **N5 (zoom-out).** Confirm that `src/facade` importing from `src/sdd` follows the existing layering.
* **N6 (zoom-out, catalyst N3).** Missing `tasks.md` is exit 2 here and exit 1 in `spec-gate check`. State why in the design and in `docs/cli.md`: this lint's input is required, `spec-gate` checks a generated report.
* **N7 (zoom-out).** An ID-less task fails the lint but is never seen by the runner. The message should say so.
* **N8 (catalyst N2).** Fence detection: a one-line tilde fence is a valid CommonMark opener, and a fence inside a blockquote is missed. Add both to the known gaps.
* **N9 (catalyst N4).** Optional: write findings to a file in the change so a human sees them after an unattended run.
* **N10 (catalyst N5).** Rollback reverts the preflight but leaves the marker edits; say whether to revert them too.

## Reuse check
Both reviewers found no false compromise in the pure rule function, the separate subcommand (Decision 6) and the shared helpers (Decision 5). The rule registry was correctly rejected.
