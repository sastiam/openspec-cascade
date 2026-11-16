# Stage 7: Critic Review

Target: `design.md` (FeatureRange = whole file). Reviewers: `egm-design` (completed), `egm-structural` (completed), `egm-style` (completed). Direct dispatch, one round, no fixes applied (triage happens after Stage 9).

## egm-design — 0 blockers, 2 majors, 6 nits

- DC-7-1 🟡 Lines 20, 22: change names may contain `.` (`CHANGE_ID_PATTERN`, constants.ts:558). A regex built from the name would let `v1.2` match `2026-01-01-v1x2`, breaking the exact-match decision. State the method (check the date on the first 10 characters, `-` at index 10, compare the rest as a plain string, or escape the name) and add a dotted-name scenario.
- DC-7-2 🟡 Lines 19, 14, 27: the resolver cannot be pure and its location is unstated. An uncaught `readdirSync` error reaches the catch in `runSpecGate` and becomes a `USAGE:` line with exit 2, which breaks "same exit code". Either a pure matcher plus an I/O wrapper that treats read errors as an empty archive, or an I/O function with the try/catch inside; and say where it lives.
- DC-7-3 🟢 Line 19: "present" is not tied to a directory: a file at the path counts, `--changes archive` is evaluated as present and reported `review missing`, and archive entries are not filtered to directories.
- DC-7-4 🟢 Line 22: message wording and path form (relative to `--repo`) not pinned; keep the existing `<change>: ...` prefix.
- DC-7-5 🟢 Line 23: say whether any consumer (`forja wt night`, scripts) parses the stderr text.
- DC-7-6 🟢 Lines 13, 21, 23: missing alternatives (a distinct exit code; listing every archive; why an archived change still fails the gate).
- DC-7-7 🟢 Line 14: `stamp` keeps the same misleading message; give a reason or a follow-up.
- DC-7-8 🟢 Lines 19-20: on case-insensitive APFS, `existsSync` ignores case but the archive match does not (`Tasks-Lint`). Accept in Risks or require exact names in both checks.

## egm-structural — PASS (0 blockers, 0 majors, 4 nits)

- ST-7-1 🟢 Lines 21-23: uneven "Alternative: …; rejected, because …" pattern (most-recent and exit-code decisions lack it).
- ST-7-2 🟢 Lines 25-28: no security or scalability statement, not even "none" (names are validated before paths are built; one archive listing per change).
- ST-7-3 🟢 Line 22: the comments-in-function-bodies rule is unrelated to the constants decision.
- ST-7-4 🟢 Line 19: "pure" is inaccurate (deferred to content reviewers).

## egm-style — 0 blockers, 1 major, 5 nits

- SY-7-1 🟡 Line 28: "the message still says the folder does not exist, which stays true" over-claims: the spec asks the unknown message to name the change as not existing, which would be false for an archived change under a new naming. Make the message folder-scoped (and align spec line 23) or narrow the sentence.
- SY-7-2 🟢 Line 22: "forensic audit" undefined; the comments rule is noise here.
- SY-7-3 🟢 Line 20: `big-thing` would match `thing` is stated backwards.
- SY-7-4 🟢 Line 19: "small" is filler.
- SY-7-5 🟢 Line 19 vs spec/proposal: "present" vs "existing"; use one term.
- SY-7-6 🟢 Line 27: "never a crash" is an absolute claim; state the rule (archive read errors are caught and treated as no archive).

## Overlap with earlier stages

DC-7-2, ST-7-4 and SY-7-4 repeat ZO-5-1 / IC-5-1 / IC-5-2 (pure + placement). DC-7-4 repeats CO-6-2 and relates to IC-5-3 (line grammar). DC-7-3 extends CO-6-3. SY-7-2 and ST-7-3 repeat CO-6-7.
