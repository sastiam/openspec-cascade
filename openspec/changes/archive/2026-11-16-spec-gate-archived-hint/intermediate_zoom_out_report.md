# Stage 8: Intermediate Zoom Out Review

Target: `design.md` (full file), with the Stage 5-7 reports. Reviewer: `egm-zoom-out` (completed). No fixes applied yet.

## Verdict

The design is in proportion to a message-only change. The risk is triage: accepting every Stage 5-7 finding would turn a 28-line design into a glossary, a two-layer resolver and an edge-case list. Three real problems need fixing, each with one clause or example line.

## Simpler shape that resolves the majors together

One small function: the change folder exists if `changeDirOf` is a directory; otherwise list `openspec/changes/archive/` (missing or unreadable = no archive) and match entries by plain string comparison, not a regex. Archived and unknown changes reuse the existing failure line `<change>: <stage> <reason> (<path>)` with two new reason tokens. Resolves DC-7-1, DC-7-2, ZO-5-3, IC-5-2, ST-7-4, SY-7-4, SY-7-6, CO-6-2, CO-6-3, IC-5-3, DC-7-4, SY-7-1.

## Findings (0 blockers, 3 majors, 6 nits)

- IZ-8-1 🟡 Lines 20, 22 (DC-7-1): state the match: first 10 characters match the date, character 11 is `-`, the rest equals the change name as a string. Add a dotted-name test. No regex escaping utility.
- IZ-8-2 🟡 Lines 19, 23, 27 (DC-7-2 and duplicates): drop "pure"/"small"; archive read errors are caught inside the function and treated as no archive. Reject the reader/classifier split (IC-5-2) as a second abstraction for ~10 lines.
- IZ-8-3 🟡 Lines 22, 23, 28 (CO-6-2, IC-5-3, DC-7-4, SY-7-1): show two example lines using the existing grammar with folder-scoped reasons, e.g. `tasks-lint: review archived (openspec/changes/archive/2026-11-16-tasks-lint)` and `foo: review no change folder (openspec/changes/foo/)`; check they satisfy spec lines 14 and 23. DC-7-5 then needs no answer.
- IZ-8-4 🟢 Line 19 (CO-6-3, DC-7-3, SY-7-5): one clause: the folder exists = a directory at `changeDirOf`; an active folder wins over an archived copy. Use the spec's term. Reject archive-entry directory filtering and the `--changes archive` special case (pre-existing, not hit).
- IZ-8-5 🟢 Placement (IC-5-1): downgrade from major. A private helper in `spec_gate.ts` matches the proposal's Impact; moving it later is trivial. State the location.
- IZ-8-6 🟢 Context (CO-6-1 and the glossary findings): one sentence on what `spec-gate check` does; delete the comments clause on line 22; reject glossary entries.
- IZ-8-7 🟢 Line 14 (ZO-5-2, DC-7-7): one clause on why `stamp` is out (explicit message, exit 2, interactive).
- IZ-8-8 🟢 Line 20 (SY-7-3): name the folder, `2026-01-01-big-thing`.
- IZ-8-9 🟢 Reject outright: IC-5-4 (hints), DC-7-8 (APFS case), CO-6-6 (calendar dates), DC-7-6 and ST-7-1 (extra alternatives), ST-7-2 (optional one line at most), CO-6-4 and CO-6-5 (already answered by spec scenarios).
