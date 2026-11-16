# Goldfish Review Report: Stage 7 (Critic Review)

**Target:** `openspec/changes/tasks-lint/design.md` (whole file, 60 lines)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-design` | completed |
| `egm-structural` | completed |
| `egm-style` | completed |

Dispatched directly from the main context, one round, no automatic fixes applied. Severity breakdown after merging duplicates: 1 Blocker, 9 Majors, about 20 Nits.

## Blocker

### B1. The preflight does not cover `--mode v2` or the dry-run path - Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Decision 7 (line 38), spec requirement "Looper preflight", proposal.
* **Discrepancy Description:** `execute()` in `src/facade/cascade_facade.ts` sends `mode === "v2"` to `executeV2`, which calls `pipeline.runChange` and reads tasks with `readTasks`. It never calls the facade's `runChange`. `--dry-run` takes separate branches and never reaches `runChange` either. The default mode is v1, so the default path looks fine, but v2 runs the same `tasks.md` unlinted. The Context never says two execution paths exist.
* **Rationale & Recommendation:** Put the preflight in one place that runs before the v1/v2 split, for example in or right after `preflight(ctx)`. Add facade tests for v1, v2 and dry-run. Decide whether dry-run lints and say so in the spec.

## Major

### M1. A multi-change cascade lints change B only after change A finished - Severity: Major
* **Reviewer Lens:** `egm-design` (M1, M2)
* **Affected Scope:** Decision 7, Decision 8, Risks, spec "Looper preflight", proposal.
* **Discrepancy Description:** `execute()` loops over `--changes a,b,c`. "Once per change, before the task loop" means change B is linted after A's sessions are done, so the "no engine session starts" guarantee holds only for the first change. Worse, an agent working on A can add the skip marker to B's `tasks.md` before B is linted.
* **Rationale & Recommendation:** Lint every listed change before the first session. This also narrows the marker bypass for cascades. Correct the Decision 8 and Risks wording. Reconsider the hardening options (ignore the marker when `review.md` exists, fixed legacy list) as a real mitigation, since the only exemption mechanism sits in a file the gated agent can write.

### M2. The skip marker is a bypass in the file the agent controls - Severity: Major
* **Reviewer Lens:** `egm-style` (5), `egm-design` (A1), `egm-structural` (1)
* **Affected Scope:** Decision 8, Risks, Open Questions.
* **Discrepancy Description:** Already raised in Stage 5 (M1). New points: the open question has no owner or decision trigger and says it "does not change the specs", which is a claim, not a question. "`/cascade-spec-review` can flag it" is a capability no task or spec provides. Alternatives (fixed list, `review.md` check, `.openspec.yaml` flag, allowlist) are named but not evaluated and rejected.
* **Rationale & Recommendation:** Decide the question now, with a short alternatives list and reasons. If the marker stays, say "a reviewer can see it in the diff" and drop the claim about the review command.

### M3. The lint and the runner disagree on line endings and headings - Severity: Major
* **Reviewer Lens:** `egm-design` (M3), `egm-style` (1)
* **Affected Scope:** Goals, Decisions 1 and 2, task 1.4.
* **Discrepancy Description:** Same issue as Stage 5 (M2). New points: the agreement test in 1.4 does not say it runs on CRLF, CR or BOM input; "never looser" is a universal claim backed by one test; the lint ends a block at any heading while the runner recognizes only `##` and deeper (the design also says "any non-indented line" would be simpler, since every heading is column 0).
* **Rationale & Recommendation:** Normalize line endings in `parseTasks` (smallest change), or report a finding when the file has CR or a BOM, or run the agreement test across all variants and state the divergence. State the guarantee as tested: "every task the lint accepts has `Verify:` in the parsed text".

### M4. The `Verify:` form differs between design and spec - Severity: Major
* **Reviewer Lens:** `egm-design` (M4), `egm-style` (1)
* **Affected Scope:** Decision 2 (line 28) against spec "Every task needs a Verify line".
* **Discrepancy Description:** The design regex accepts an optional `-` or `*` marker; the spec says only "an indented line starting with `Verify:`" and has no scenario for the marker. The runner matches `\bVerify:` anywhere in the text.
* **Rationale & Recommendation:** Align the two: add a scenario for the marker form, or drop the marker. Refer to the regex only in the design; keep behavior in the spec.

### M5. The lint checks that a `Verify:` exists, not that it verifies anything - Severity: Major
* **Reviewer Lens:** `egm-design` (M5)
* **Affected Scope:** Decision 2, Risks.
* **Discrepancy Description:** Same as Stage 5 (M4). New: a task whose only command contains shell control characters is dropped by `isSafeVerifyCommand` and the runner falls back to `defaultVerify`, yet the lint passes it. The Risks do not list this gap.
* **Rationale & Recommendation:** Add it as a Risk or Non-Goal, or add a third rule that requires at least one backticked command the runner accepts.

### M6. Rationale is attributed to "the author" without a technical reason - Severity: Major
* **Reviewer Lens:** `egm-design` (M6), `egm-style` (3)
* **Affected Scope:** Decision 4 (line 32), Risks (line 47).
* **Discrepancy Description:** "A missing `tasks.md` is exit 2 (the author's decision)" and "accepted by the author" give no reason. The standard asks for concrete trade-offs and forbids attributing decisions without a link.
* **Rationale & Recommendation:** State the reason: a missing file is an input error, not a lint finding, and matches the Fatal already thrown by `runChange`. For the mid-run edit gap, give the cost of detecting it and note that the agent rewrites checkboxes in every run. Or cite `brief.md`.

### M7. Alternatives are not consolidated - Severity: Major
* **Reviewer Lens:** `egm-structural` (1), `egm-design` (A1)
* **Affected Scope:** Decisions 3, 4, 5, 8.
* **Discrepancy Description:** Decisions 1, 2, 6 and 7 name rejected options with reasons; 3, 4, 5 and 8 name none. Decision 8 matters most.
* **Rationale & Recommendation:** Add an "Alternatives Considered" section, or an "Alternatives" bullet per decision, with at least the skip marker and helper extraction covered.

### M8. The design is not readable alone and the Context has no problem statement - Severity: Major
* **Reviewer Lens:** `egm-structural` (2), `egm-style` (nit 14), `egm-design` (N6)
* **Affected Scope:** Context (lines 3-10).
* **Discrepancy Description:** Context points to `proposal.md` and `brief.md` and goes straight into code internals. `brief.md` exists in the change folder but was not part of the reviewers' material.
* **Rationale & Recommendation:** Add two or three sentences stating the problem, and define "looper" once as the `CascadeFacade.runChange` loop. Say "the review recorded in `brief.md`" instead of "Goldfish review".

### M9. Risks lack mitigation structure; decisions are dense - Severity: Major
* **Reviewer Lens:** `egm-structural` (3, 4), `egm-style` (1, 3, 6)
* **Affected Scope:** Risks (lines 42-48), Decisions 2, 4, 8.
* **Discrepancy Description:** Risks give no likelihood, no scalability or false-positive note, and two entries have no real mitigation. Decisions 2, 4 and 8 pack definition, behavior and rationale into single paragraphs. "All 29 files fail" is asserted with no source.
* **Rationale & Recommendation:** One short line per risk with mitigation or explicit acceptance; split decision paragraphs into labeled bullets or H3 headings; reference the task 3.1 test instead of asserting the 29 count, or say "29 files counted on 2026-11-16".

### M10. Migration side effects and the unimplementable "other than a new one" - Severity: Major
* **Reviewer Lens:** `egm-design` (A2), `egm-structural` (nit 7), `egm-style` (12)
* **Affected Scope:** Migration Plan step 2, task 3.1, line 48.
* **Discrepancy Description:** `tasks.md` is part of the spec-gate hash, so marking files changes hashes (no legacy change has a stamped report today, so nothing breaks). "Other than a new one" cannot be coded, and the test as worded would let an unmarked failing change slip through. Archived changes later moved to `openspec/changes/archive/` are not addressed.
* **Rationale & Recommendation:** Define the exemption in code (test every directory except `tasks-lint`, which must lint clean without the marker), mention the hash effect, and say what happens on archive.

## Nits

* Fence wording: "up to any leading whitespace" is garbled (design, structural, style). Say any amount, or give the limit; CommonMark treats four spaces as an indented code block.
* Fence edge cases to specify and test: a "```js" line inside a fence is not a closer; blank lines inside a fence in a task block versus the "ends at a blank line" block rule; an unclosed fence hides all later tasks.
* The inline-triple-backtick rule has no spec scenario. Either add one or call it an implementation detail covered by test 1.2.
* Decision 4: give the exact `skipped` line format or defer to the spec; replace "The docs say so" with "`docs/cli.md` records the difference (task 2.4)".
* Many findings in one `Fatal` message: an unmarked old-style file yields one finding per task. Cap or summarize.
* Decision 5: `SpecGateOutput` as a shared type is awkward; rename neutrally and say where `SPEC_GATE_CONSTANTS` values used by `changeDirOf` move. "Third copy" names no first two.
* Decision 7 mixes the facade choice and the night-run note; split. "Rare case" is unmeasured. Docs should not claim enforcement for v2 or dry-run until B1 is fixed.
* Capitalize "Decision 5" consistently; use the rule IDs `missing-verify` and `no-code-block` everywhere; align Non-Goals wording with the proposal ("manual verbs with checkboxes").
* Open Questions item duplicates Risks; rollback breaks the numbered migration steps and does not say whether the marker edits are reverted; the migration steps do not cite tasks groups 1-3.
* `Verify:` inside a fence appears in the spec (one finding per fence) but not in Decision 3; add a cross-reference.
* Rule registry: "for now" is a hedge; name the trigger (a third rule).
