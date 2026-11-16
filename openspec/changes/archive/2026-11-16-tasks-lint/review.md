---
egm: review
status: resolved
hash: c0e8f73262746f346249cf529afc0bd6ba3b024e7c953123d514a0a36f524b6e
---
# Review: tasks-lint

Consolidated EGM review of `design.md` and, in Stage 9, `tasks.md`. Stage reports live next to this file.

## Stages

| Stage | Report | Status |
| --- | --- | --- |
| 5. Initial Zoom Out | `zoom_out_report.md` | completed, triaged |
| 6. Comprehension | `comprehension_report.md` | completed, triaged |
| 7. Critic Review | `critic_report.md` | completed, triaged |
| 8. Intermediate Zoom Out | `intermediate_zoom_out_report.md` | completed, triaged |
| 9. Implementation Readiness | `implementation_readiness_report.md` | completed, triaged |

Stage reports were written from the artifacts as they were before triage, so they describe the old text.

## Triage (the author accepted every proposed disposition)

| Finding group | Disposition | Where applied |
| --- | --- | --- |
| Skip marker is a bypass in a file the agent controls (S5 M1, S7 M2, S8 M1, S9 M2) | Accepted: marker removed; only unchecked tasks are linted for `missing-verify`; existing changes pass untouched | proposal, design decisions 2, spec, tasks (no marker task) |
| Preflight misses v2, dry-run and later changes (S7 B1, M1; S9 M1, B1) | Accepted: one `lintChanges` call inside `preflight`, all listed changes, before the v1/v2 split; dry-run does not lint | design decision 7, spec "Preflight before any engine session", tasks 3.1, 3.2 |
| Lint and runner disagree on CRLF, CR, BOM, headings (S5 M2, S7 M3, S9 M6) | Accepted: `parseTasks` normalizes line endings and BOM; heading clause dropped; agreement test over four variants | design decision 3, spec, tasks 1.3, 1.5 |
| Existing facade and e2e fixtures break (S9 B1) | Accepted: fixtures updated in the same task as the preflight | design decision 8, tasks 3.2 |
| `Verify:` with no runnable command (S5 M4, S7 M5) | Declined: recorded as a known gap and Non-Goal | proposal, design Non-Goals and Risks |
| Re-lint before every task; findings file (S5 M3, N9) | Declined: recorded as rejected alternatives with reasons | design decision 7 |
| Exact file list, rule definitions, test case table, phase order, docs wording, constants values (S9 B2, M2-M11) | Accepted | tasks (Files section, 1.1, 1.2, 2.3, 3.2, 3.3), spec |
| Problem statement, alternatives, risks, "the author's decision" wording, looper and Goldfish terms, exit code reason (S6, S7 M6-M9) | Accepted | design Context, Decisions, Risks |
| Style and wording nits | Accepted where still applicable; items that depended on the marker are gone | all artifacts |

## State

`openspec validate tasks-lint --strict` passes. `tasks.md` has no fenced block and every unchecked task has an indented `Verify:` line, so it satisfies the rules it introduces. The stamp stays `open` until the author confirms that the edited artifacts address the findings.
