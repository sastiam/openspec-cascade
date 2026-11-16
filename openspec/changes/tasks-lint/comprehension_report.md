**What this proposes**

Add a linter for `tasks.md` files. It is a pure function, `lintTasks(markdown)`, in `src/sdd/tasks_lint.ts`. It returns findings, each with a line, a rule ID and a message. There are two rules. One requires every task to have an indented `Verify:` line. The other is a fence rule, which is only partly specified (see Findings). The linter is exposed as a new CLI subcommand, `cascade lint-tasks`. It is also run as a preflight in `CascadeFacade.runChange`, which throws `Fatal` before the task loop if there are findings. The 29 existing `tasks.md` files would fail, so they get a skip marker on their first line. Helpers shared with `spec_gate.ts` move into `src/cli/change_args.ts`.

**How the existing system works, per this document**

`CascadeFacade.runChange` loops over tasks and already checks that `tasks.md` exists. `parseTasks` defines a task as a column-0 checkbox line, usually followed by an ID. Its text is the task line plus the indented lines after it. A blank or non-indented line ends the task. `verifyCommands` looks for `Verify:` in that text. `spec-gate` is an existing CLI that checks hash-stamped report freshness and requires `--stage`. `night-run` is documentation prose, not code. The 29 legacy `tasks.md` files write "verify with ..." in lowercase prose.

**Findings**

Reviewer: `egm-comprehension`, reading `design.md` alone. Status: completed.

1. **Blocker.** Scope: Decisions 1 and 3, "two rules" and rule IDs. The reader could not paraphrase the second rule's purpose. Decision 1 says there are two rules and Decision 3 gives fence handling, but the design never says what a fence finding is: any fence, or only unclosed fences, or fences inside a task block. Rule IDs are never named in the design, and the Non-Goals mention a deferred "manual-verb rule". The reader cannot tell which rule produces which finding.

2. **Major.** Scope: Context and Decision 2, "missing-verify rule". The name appears in the Context with no definition and has to be pieced together from Decision 2. A short definition near the top would help.

3. **Major.** Scope: Decision 8, skip marker and `hasSkipMarker`. The exact text of the marker is never given, so a reader cannot implement or check it from the design.

4. **Major.** Scope: Context, "See proposal.md" and `brief.md`. The design depends on the proposal for motivation and on "the Goldfish review" in `brief.md` for reasoning, and cites "the author's decision" (Decision 4) and a "known gap, recorded in the proposal". None of this is summarized, so the document is not self-contained. "Goldfish" is not defined.

5. **Major.** Scope: Decision 3, fence opener definition. "Up to any leading whitespace" is ambiguous. The rule that a task or `Verify:` inside a fence "counts for nothing" is hard to reconcile with Decision 2, where `Verify:` must be on an indented line, because indented fences are allowed. The design does not say how an indented fence interacts with block termination, or that a column-0 fence closes the block.

6. **Major.** Scope: Decision 7, `Fatal`, and the Migration Plan. The design does not say what happens to a run that hits the preflight, or how the facade and the `cascade-looper` command prompt relate. `cascade-looper` is undefined. "The agent could skip it" refers to an agent the document never introduces. Migration step 2 says "other than a new one"; "a new one" is not defined.

7. **Nit.** Scope: Decision 4. Exit 1 and exit 2 are explained only by contrast with `spec-gate check`; exit 0 and exit 1 are not stated for `lint-tasks`. `SpecGateOutput`, `EXIT_CODE_CONSTANTS` and `HARDENING_CONSTANTS` are named without definitions. The `skipped` entry in the ok line is explained only by Decision 8, which comes later.

8. **Nit.** Scope: Decision 2, "stricter in coverage, never looser". The phrase is vague. The guard test ("every task the lint accepts has `Verify:` in the text `parseTasks` produces") cannot hold for ID-less tasks, because `parseTasks` drops them. State the scope of the test.

9. **Nit.** Scope: Open Questions and Risks. `/cascade-spec-review` and `review.md` are mentioned without definition, and `review.md` appears only in Risks.
