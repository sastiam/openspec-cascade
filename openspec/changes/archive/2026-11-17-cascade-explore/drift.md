---
egm: drift
status: resolved
hash: ac063e6318a73e41d2730b76a3dd3b4486485abeaff6e9f788c9dc1a9e4fb5cc
---
## design.md

- **The docs still use a command name that does not exist.** The design names the command `/cascade:explore`, in `explore.md` (design.md:9). Two doc lines still say the manifest is read by `cascade-explore`, which is neither the file name nor the slash command:
  - `docs/cli.md:147`: "solo lo leen `doctor` y `cascade-explore`"
  - `README.md:156`: "only `doctor` and `cascade-explore` do"
- **One short command name is left in the plugin command list in `docs/cli.md`.** The design says short command names "in the plugin command list are converted to the `/cascade:` form" (design.md:103). `docs/cli.md:263` still lists the bare `/cascade` (from `cascade.md`) next to the converted `/cascade:setup` and `/cascade:explore`.
- **The `/openspec-propose` locations in the design do not match the file.**
  - design.md:54 says `/openspec-propose` appears in `## Usage`, `## Precedence and overrides` and `## Propose`.
  - In `explore.md`, `## Usage` has only `@openspec-propose` (explore.md:21). `/openspec-propose` appears only at explore.md:48 (Precedence) and explore.md:155 (Propose).
- **`/openspec-explore` appears in more sections than the design places it.**
  - design.md:53 places `@openspec-explore` in `## Usage` and the `skills/openspec-explore/SKILL.md` path in `## Preconditions`.
  - The file also has `@openspec-explore` in Preconditions (explore.md:30) and the `skills/openspec-explore/SKILL.md` path in `## Load context` (explore.md:63).
- **The workflow path has a different literal.** The design says `.github/workflows/*` (design.md:90). The command says `.github/workflows/` (explore.md:72).
- **The command has behavior the design does not describe:**
  - **Subagent fallback.** explore.md:107: "if it cannot, say so and continue without the review". The design only says subagent support is checked after the user accepts (design.md:75) and gives no fallback.
  - **No `manual.md` when there are no manual steps.** explore.md:164: "When the brief has no manual steps, write no `manual.md`." The design (design.md:95) has no such rule.
  - **Brief fill rule.** explore.md:111: "Fill every section; write 'Not applicable' with a one-line reason instead of dropping one". The design does not state this.
  - **Report contents.** explore.md:181-186 lists the files written, the readiness result, open questions and manual steps, and the next gate. The design names `## Report` with no contents (design.md:49).
  - **Missing tools in "Sources consulted".** explore.md:151 adds a rule to note missing manifest, aws entry, `gh`, Linear MCP or EGM there. The design mentions this only as a risk mitigation (design.md:125), not as a command instruction.
  - **`sdd-clarify` description.** explore.md:22 adds "1-2 rounds of questions, no investigation, no reviewers". The design names only "sdd-clarify as the lighter option" (design.md:40).
  - **Extra wording in Load context.** explore.md:65 adds "Watson and EGM are planning aids" and a design-system MCP example. The design does not include these.
  - **The single yes/no names files and offers the review.** explore.md:106: "name the files you will write. Offer the Goldfish review in the same question". The design (design.md:45, 64) does not specify this.
- **The review command uses two forms of its own name.** design.md:9 says the review command is `/cascade:cascade-spec-review`.
  - `cascade-spec-review.md:8` and `:15` (title and usage) still say `/cascade-spec-review`.
  - The upgrade sentence added at `cascade-spec-review.md:24` uses `/cascade:cascade-spec-review`.
- **The doc changes have no automated test.** design.md:103 says doc checks use `bun -e` with `includes`. No test under `test/` checks the `docs/cli.md` or `README.md` content that this change requires: the `/cascade:setup` first line, the explore line, the OpenCode bullet, re-entry, IAM/sandbox, and the deprecated alias. The only tests in `test/plugin/` are `egm_commands.test.ts` and `setup_command.test.ts`.

## specs/cascade-explore/spec.md

- **The command's exclusion rule is narrower than the spec.** spec.md:84 forbids "any call that writes a local file". explore.md:84 forbids only "any call with an output-file argument".
- **The workflow path differs.** The spec says `.github/workflows/*` (spec.md:109). The command says `.github/workflows/` (explore.md:72).
- **The command adds behavior the spec does not describe:**
  - **Subagent fallback.** explore.md:107 continues without the review when subagents are unavailable. spec.md:31 only requires that subagent support be checked after acceptance.
  - **No `manual.md` when there are no manual steps.** explore.md:164 skips `manual.md` when the brief has no manual steps. spec.md:137 does not cover this.
  - **Brief fill rule.** explore.md:111 requires "Not applicable" instead of dropping a section. spec.md:123 does not state this.
  - **Report contents.** explore.md:181-186 defines the report. No requirement in spec.md covers it.
- **Scenarios with no test.** These scenarios have no assertion in `test/plugin/egm_commands.test.ts` that checks their behavior:
  - **"Watson in the manifest"** (spec.md:58-60). No test mentions `Watson` or `whenToUse`. The manifest test (egm_commands.test.ts:123-125) checks only `openspec/config.yaml`, `Linear MCP` and `paste`.
  - **"Entry not applicable"** (spec.md:65-67). No test checks for "not applicable" or "one-line reason" in "Sources consulted". egm_commands.test.ts:190-215 checks only that the heading exists.
  - **"Fact found in the repo"** (spec.md:72-74). No test checks the instruction to answer read-only before asking (explore.md:70). egm_commands.test.ts:159 checks only "one question per message".
  - **"MCP write tool available"** (spec.md:97-99). No test checks `create_issue` or "Never call write tools" (explore.md:87). egm_commands.test.ts:148-150 checks only the `get_`, `list_` and `search_` prefixes. The `read_`, `fetch`, `query` and `view` prefixes are not checked either.
  - **"Manual step in tasks"** (spec.md:157-159). No test checks `manual-step` or "moves the step to `manual.md`" (explore.md:176). See egm_commands.test.ts:223-241.
  - **"User skips the review"** (spec.md:132-134). No test checks the decline path, "When the user declines, write the brief without running reviewers and say so" (explore.md:107). egm_commands.test.ts:164-175 checks only "confirms" and "Goldfish".
  - **"EGM not installed"** (spec.md:33-35). egm_commands.test.ts:164-175 checks only `egm@egm`. Three parts of the scenario are unchecked: "do not offer the review"; "record why in the brief"; the non-blocking continue (explore.md:105).
- **Scenarios with only partial coverage.** The test checks the topic but not the THEN clause:
  - **"No AWS profile declared"** (spec.md:79-81). "make no AWS calls and record that in the brief" (explore.md:86) is not checked.
  - **"Credential-minting call"** (spec.md:86-88). "record the gap in the brief" (explore.md:86) is not checked.
  - **"Change without deploy impact"** (spec.md:111-113). Only `.github/workflows/` is checked. The rule to cite the inspected files even when the section does not apply is not.
  - **"ARN in a finding"** (spec.md:118-120). Only "ARNs" and "account IDs" are checked. "refer to a resource by name" (explore.md:74) is not.
  - **"Linear link with MCP"** (spec.md:51-53). Reading the "title, description and comments" through the MCP before asking (explore.md:66) is not checked.
  - **"Explore skill says to hand off"** (spec.md:44-46). There is no assertion on running propose inline or in this thread (explore.md:48, 155).
  - **"Brief with a manual step"** (spec.md:139-141). "Manual steps never go into `tasks.md`" (explore.md:164) is not checked.
  - **"Existing change"** (spec.md:12-14). "ask whether to reuse it" (explore.md:33) is not checked.
  - **"Change already has tasks"** (spec.md:19-21). "go straight to the readiness check" and the skipping of the brief are not checked. Only the "already has tasks.md" literal is.

## Triage (2026-11-17)

- Fixed (task 3.1, ed1ad1e): the AWS exclusion covers any call that writes a local file; regression guards for write tools, review decline, missing EGM, subagent fallback and manual steps.
- Fixed (task 3.2): `/cascade:explore` in README.md and docs/cli.md, `/cascade:cascade` in the plugin command list, `/cascade:cascade-spec-review` in its own title and usage.
- Spec and design updated to match the command: subagent fallback, no `manual.md` without manual steps, "Not applicable" fill rule, report contents, single yes/no naming files, missing tools in "Sources consulted".
- Accepted without change: `.github/workflows/` vs `.github/workflows/*`, locations of `/openspec-propose` and `@openspec-explore` across sections, extra wording in Load context and the `sdd-clarify` description, no automated test for doc content beyond the `bun -e` checks, and the other partly tested scenarios.
