# Brief: lint-tasks

Author: Sebastian Chota
Date: 2026-11-16
Mode: BRAINSTORM

## Concept

`openspec-cascade lint-tasks --changes <change>` is a new CLI subcommand. For each change it reads `openspec/changes/<change>/tasks.md` and passes the text to `lintTasks(markdown)`. This is a pure function that returns findings with line numbers for two rules:

1. Any fenced code block (three backticks or three tildes) anywhere in tasks.md is a finding, including one inside a `Verify:` line. Inline backtick code is not a finding, because `Verify:` lines normally hold a command in backticks.
2. Every task line (`- [ ]` or `- [x]`) needs an indented `Verify:` line inside its block. The block runs from the task line to the next task or heading.

The command prints findings to stderr. It exits 0 when there are no findings, 1 when there are findings, and 2 for invalid usage (missing `--changes`, invalid change name, or missing tasks.md). This mirrors `spec-gate check`. The cascade looper or night-run is meant to run it before each task and stop on a non-zero exit. The lint only runs on the changes passed in `--changes`, so the roughly 30 old completed changes are tolerated. Manual verbs and `manual.md` are out of scope.

Motivation: the roadmap says tasks.md must hold only what an agent can do and verify (expected outcome and `Verify:`, never lines of code). A rule inside a prompt can be ignored by the agent. A command with an exit code cannot.

## Reviewer status

| Lens | Status |
| --- | --- |
| egm-design | completed |
| egm-codebase-details | completed |
| egm-zoom-out | completed |
| egm-comprehension | completed |
| egm-implementation-readiness | completed |
| egm-structural | completed |
| egm-inventive-catalyst | completed |

## Severity breakdown

Blockers: 2. Majors: 8. Nits: 6.

## Blockers

### B1. The looper has no hook point, so "stops before each task" is not enforceable as written
Raised by design, codebase-details, implementation-readiness and zoom-out.

- `plugins/cascade/workflows/cascade-looper.mjs` is only a three-phase prompt workflow (inspect, execute, verify). It has no per-task loop.
- The real per-task loop is `CascadeFacade` in `src/facade/cascade_facade.ts` (roughly lines 640-761). It already fails with `Fatal` or `TaskFailureError`.
- `night-run` is not code in this repo. `docs/cli.md:142` only says it "must invoke" `spec-gate check`. That is prose, and it is the same "rule in a prompt" weakness the motivation wants to remove.
- Decision needed. The recommended option is to call the pure `lintTasks` in-process from the facade and throw `Fatal` on findings. A shell-out from a prompt is rejected, because the agent could skip it.
- Second decision: lint once per change before the loop, or before every task. `markDone` rewrites tasks.md after each task, so a per-task lint would also catch an agent editing tasks.md mid-run. A single preflight is cheaper. A cheap compromise is to lint once and re-lint only when the hash of tasks.md changes (`computeChangeHash` exists).
- Night-run stays a documentation and command-prompt edit, and the spec should say so.

### B2. Legacy tolerance is accidental, and every legacy file fails rule 2
Raised by codebase-details, design and implementation-readiness.

- There are 29 legacy tasks.md files with 165 task lines. None contains a literal `Verify:`. They use lowercase prose such as "verify with ..." (for example `looper-core-fsm/tasks.md:8`). No legacy file contains a fenced block.
- So rule 2 fails 29 of 29 if anything ever lints them. Tolerance comes only from `--changes` scoping.
- Decision needed. Either accept scoping as the whole mechanism and say so in the spec, with a test that a legacy-style file fails when passed, or add an explicit signal. Candidates raised: a lint marker written at stamp time, a first-line opt-out comment, or an "only lint changes without review.md" rule. Keep this policy in the CLI or facade layer, never inside `lintTasks`.
- The new `tasks-lint` change has no tasks.md yet. Its own tasks.md should pass the lint it introduces (dogfood).

## Majors

### M1. Two definitions of "task" and "block" would coexist
`src/facade/tasks.ts` already has `parseTasks`. Its task regex needs an ID and a column-0 line (`^- \[([ xX])\] ...`), it accepts uppercase `[X]`, it ends a block at a blank or non-indented line, and it treats only `##` and deeper as headings. `verifyCommands` (line 83) finds `Verify:` in the joined task text. The lint's "until next task or heading" differs. A `Verify:` the lint accepts but the parser drops would do nothing at run time.
Recommendation: define the lint's task-line pattern explicitly as a named constant. Either share one tokenizer with `parseTasks` or add a test that the two agree on what counts as a Verify line. State the choice on ID-less tasks, uppercase `[X]`, and `#` level-one headings.

### M2. Fence semantics are underspecified
Pin these before writing tests:
- The opener is three or more backticks or tildes, indented up to three spaces (indent inside list items is debated; allow leading whitespace).
- The closer uses the same character and is at least as long. A tilde block containing backticks is one finding.
- An unclosed fence is reported once, at its opening line.
- Task lines and headings inside a fence are ignored for rule 2. A `Verify:` inside a fence does not satisfy rule 2.
- Triple backticks on a single line (inline) are not a fence.
- Report the opening line only, one finding per block.
- Fences in non-task sections (prose, headings) are findings too, as the concept says.

### M3. The exact form of `Verify:` is undefined
Decide: case-sensitive or not; need a list marker or plain indent; bold `**Verify:**` accepted or not; empty `Verify:` with no text after the colon is a finding or not; minimum indent (one space, two spaces, tab, relative to the task line); same-line form on the task line itself. Suggested grammar: a line matching `^\s+(?:[-*]\s+)?Verify:\s*\S` inside the block.

### M4. Nested subtasks and block boundaries
An indented `  - [ ]` line: its own task needing its own `Verify:`, or part of the parent block, or rejected? What do blank lines, plain paragraphs and non-task bullets at column 0 do to a block? Does a parent need its own `Verify:` when only its child has one? The parser today treats a nested line as continuation text. Pin this down with tests.

### M5. CLI contract gaps
- `--changes` in `spec-gate` accepts repeated flags and comma lists. The concept writes a single name. Say whether the list form is supported (recommended: yes, reuse the parsing) and whether all failing changes are reported.
- `--repo` is supported by `spec-gate`. Say whether it is supported here.
- Success output: `spec-gate` prints an ok line on stdout. Propose `lint-tasks: ok (<names>)` on stdout and findings on stderr.
- Finding format: `<change>: tasks.md:<line>: <rule-id> <message>` with stable rule IDs and a one-line fix hint.
- Error prefix: `USAGE: cascade lint-tasks: ...`.
- A missing tasks.md is exit 2 here, while `spec-gate` exits 1 for a missing report. Document the difference.
- Every finding is blocking. There are no warnings.
- Line numbers are 1-based (`Task.line` in the parser is 0-based).

### M6. Plumbing is private in spec_gate.ts
`validChangeName`, `changeDirOf`, `parseOptions`, the comma-split in `--changes` and the usage error class are not exported. Copying about 40 lines will drift. Options: extract a small shared module (for example `src/cli/change_args.ts`), or export the helpers. Reuse the existing `SpecGateOutput` / `CliOutput` shape rather than adding a third copy. The usage error class is not shareable as is, so use a shared CLI usage error.

### M7. Separate subcommand versus a spec-gate action
Zoom-out argues for `spec-gate lint-tasks` as a third action. That reuses the plumbing and "mirrors spec-gate by construction". Design argues for a separate subcommand: spec-gate checks hash-stamped report freshness, while this lint is a pure function of one file with no stamp, and mixing them couples unrelated exit semantics. The agreed concept is a separate subcommand, so keep it, but the proposal should record the reasoning. Whichever is chosen, `spec-gate`'s required `--stage` makes the action option awkward.

### M8. "No code in tasks.md" versus indented code and multi-line commands
Fences are banned and `Verify:` holds inline commands, so an agent may hide code in indented (four-space) code blocks or very long one-liners. Decide whether indented code blocks are out of scope (recommended for the first slice, noted as a known gap) or a third rule. Also decide whether a `Verify:` with no backtick command is a finding (not in the first slice).

## Nits

- N1. Module layout: put the pure `lintTasks` in `src/sdd/tasks_lint.ts` (next to `spec_marker.ts`) with `{ line, rule, message }` findings, and the CLI wrapper in `src/cli/lint_tasks.ts`. Inside the module, scan fence state first, then run one function per rule.
- N2. Constants: add `TASKS_LINT_CONSTANTS` next to `SPEC_GATE_CONSTANTS` for the file name, `Verify:` token, fence pattern, task and heading patterns, line split, line number base (1), rule IDs and message templates. Add `"lint-tasks"` to `CLI_COMMAND_CONSTANTS.SUBCOMMANDS` (`constants.ts:491`) and a case in `commands.ts` near line 259 (the switch has no default, so tsc forces it).
- N3. Docs: `test/docs/cli_docs.test.ts` requires `` `lint-tasks` `` in `docs/cli.md` and `cascade.ts lint-tasks` in `README.md`. Update the table (near line 122) and add a section in Spanish, matching the file. Update the roadmap (line ~80), which lists three lint rules, to say manual verbs are deferred.
- N4. Tests to write first: clean file; backtick and tilde fences; fence inside `Verify:`; inline backticks; unclosed fence; mixed-character fences; CRLF and lone CR give the same line numbers as LF; BOM; tab indentation; nested subtasks; heading boundary; next-task boundary; last task at end of file with no newline; checked tasks still need `Verify:`; empty file; headings with no checkboxes; a `Verify:` with no task; findings sorted by line; legacy-style file fails. CLI tests mirror `test/cli/spec_gate.test.ts` (exit 0, 1, 2, several changes, unknown flag). Build fixtures from string arrays, because the content contains backticks.
- N5. A rule registry (`{id, check}`) is cheap and leaves room for the deferred manual-verb rule, but is optional for the first slice.
- N6. The proposal artifact set: `proposal.md`, `design.md` (open questions above), `specs/tasks-lint/spec.md` (one capability, looper integration as a requirement), and `tasks.md` that passes its own lint.

## Decisions by the author (2026-11-16)

- B1 accepted: `CascadeFacade` calls the pure `lintTasks` in-process and throws `Fatal` on findings. The lint runs once per change, before the task loop. The hash-based re-lint is rejected. Known gap: an edit to the content of tasks.md during a run is not detected. Night-run stays a documentation and command-prompt edit.
- B2 accepted with an explicit signal, opt-out. Every tasks.md is linted unless its first line is a skip marker (proposed form: `<!-- lint-tasks: skip -->`). The 29 legacy tasks.md files get the marker. The skip check lives in the CLI and facade layer, never inside `lintTasks`. A test must show that a legacy-style file without the marker fails.
- M8 accepted: indented (four-space) code blocks and long one-line commands are out of scope for the first slice and are recorded as a known gap.
- Open, for the proposal: who may add the skip marker. If the agent can add it to its own tasks.md, the gate can be bypassed. Options: the lint ignores the marker when the change already has a review.md, or the skip is a fixed list of legacy change names in constants. The author has not chosen yet.
- All other Majors (M1-M7) and Nits are carried into `/opsx:propose` as design questions, with the reviewers' recommendations as defaults.

## Contradictions and resolutions

- Strict gate versus tolerating legacy: keep `lintTasks` free of policy and decide scope in the caller (B2).
- Lint before every task versus cost: lint once per change (author decision; hash re-lint rejected) (B1).
- Ban code versus commands in `Verify:`: inline backticks only, with multi-step checks moved to a referenced script (M8).
- A rule in a prompt versus an exit code: only holds if code calls the lint, so wire it in the facade (B1).

## Suggested order of work

1. Constants and the pure `lintTasks` with unit tests (tests first).
2. CLI wrapper, shared helper extraction and registration.
3. `docs/cli.md`, `README.md` and the roadmap note.
4. Facade preflight that throws `Fatal` on findings, with a facade test that the engine session does not start when the lint fails. Update `plugins/cascade/commands/cascade-looper.md` and the night-run prompt.
5. Run `lint-tasks` on this change's own tasks.md.

## Smallest valuable slice

Pure `lintTasks` plus the CLI subcommand with its tests and docs, and a single in-process preflight in the facade. Everything else (registry, hash-based re-lint, indented-code rule) is optional.
