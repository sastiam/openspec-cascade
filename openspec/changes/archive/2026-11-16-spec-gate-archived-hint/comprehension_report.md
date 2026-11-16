# Stage 6: Comprehension Test

Target: `design.md` alone (no other context). Reviewer: `egm-comprehension` (completed).

## What this proposes

Before the `check` subcommand of the spec-gate CLI evaluates any stage, it first looks up each change name. A new helper sorts each name into present, archived (with the matching archive folder) or unknown. `evaluateStage` runs only for present changes. An archived change matches only a folder named exactly `YYYY-MM-DD-<change>`; with several, the newest (greatest name) is used. Archived and unknown changes get their own message and still fail with exit code 1. The archive dir name, date pattern and message templates go into `SPEC_GATE_CONSTANTS`. A missing or unreadable archive folder makes the change unknown instead of crashing.

## How the existing system works, per this document

`runCheck` in `src/cli/spec_gate.ts` turns each change name into a folder with `changeDirOf` and calls `evaluateStage`, which reports `missing` when the stage report is absent. It never checks the change folder, so a missing change looks like a missing report. `openspec archive` moves a finished change to `openspec/changes/archive/YYYY-MM-DD-<change>/`. A repo rule (the forensic audit) forbids comments inside function bodies and magic strings.

## Findings (0 blockers, 3 majors, 7 nits)

- CO-6-1 🟡 Lines 5, 10, 13: the document never says what the spec gate checks or what a stage and a stage report are, so "passing the gate" (line 13) is opaque. One sentence would fix it.
- CO-6-2 🟡 Lines 13, 22, 28: the deliverable is a message, yet neither the current nor the new messages are shown; the archived message's content (folder? fix hint?) is not described.
- CO-6-3 🟡 Line 19: "present" is undefined (a directory at `changeDirOf`? a file there?), and precedence is unstated when a change is active and also has an older archived copy.
- CO-6-4 🟢 Lines 5, 10: with several names, does an archived or unknown one stop the run or are the rest still reported?
- CO-6-5 🟢 Line 21: what the chosen archive is used for (presumably the message path).
- CO-6-6 🟢 Line 20: `YYYY-MM-DD` as any `\d{4}-\d{2}-\d{2}` or a valid calendar date?
- CO-6-7 🟢 Line 22: "forensic audit" undefined (lint, CI, review?).
- CO-6-8 🟢 Lines 14-15: `stamp`, `lint-tasks`, stamps and hashes named but not defined.
- CO-6-9 🟢 Lines 5, 28: OpenSpec and `openspec archive` not introduced; whose naming convention it is.
- CO-6-10 🟢 Line 27: "the archive folder" could mean `openspec/changes/archive/` or a dated folder.
