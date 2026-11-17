# Proposal

## Why

The main source of rework is weak planning. The OpenSpec explore session:
- asks questions the agent could have answered itself by looking (the repo, the AWS account read-only, GitHub Actions runs, Watson);
- forgets the deploy and CI path. The SDK docs migration failed again and again at the GitHub Actions deploy;
- does not use the project's helpers unless the user remembers to name them (Watson, Stitch, the design-system MCP);
- produces tasks with manual steps.

The user wants one planning command that does this well, absorbs the existing `/cascade:cascade-spec-brainstorm`, and only declares a change ready for an unattended run once its tasks pass the tasks linter. This is roadmap piece 3.

## What Changes

- New plugin command file `plugins/cascade/commands/explore.md`, invoked as `/cascade:explore <change> <idea or Linear link>` (frontmatter name `explore`).
  - It reads and follows the installed OpenSpec explore skill (`openspec-explore`), the OpenSpec propose skill (`openspec-propose`) and the EGM brainstorm skill. Precedence: cascade overrides > EGM brainstorm > `openspec-propose` > `openspec-explore`. It never edits any of them.
  - It loads the merged manifest with `openspec-cascade setup show --json` (from `project-manifest`) and consults each entry when its `whenToUse` applies. Watson and EGM are planning aids.
  - Given a Linear link, it reads the issue through the Linear MCP when the session has it, and otherwise asks for the text.
  - It investigates read-only before asking, under a written allowlist: AWS only with the `profile` of the manifest's aws entry (`name` `aws`, `type` `cli`) and only `describe-*`, `list-*` and `get-*` verbs, minus secret-bearing, credential-minting, environment-returning and file-writing calls; MCP tools with read-only name prefixes; `gh run list`, `gh run view --log-failed`, `gh workflow view`; read-only git. It always inventories the repo's CI workflows, deploy scripts and IaC. It then asks only what it could not find, one focused question at a time.
  - It writes `openspec/changes/<change>/brief.md` with a fixed set of sections, including "Sources consulted" (every manifest entry and every CLI command run), "Deploy and CI risks" and "Manual steps".
  - At the single readiness gate it offers the EGM Goldfish review and runs it only when the user confirms. Without EGM it skips the offer, suggests `claude plugin install egm@egm` and continues.
  - It then follows the installed `openspec-propose` skill in the same thread without stopping after the artifacts, writes `manual.md` from the brief's manual steps, and runs the readiness check: `openspec validate <change> --strict` and `openspec-cascade lint-tasks --changes <change>`. Exit 1 enters a fix loop of at most 3 rounds; exit 2 or a missing `lint-tasks` is a tooling problem with a fixed upgrade sentence. It calls the change ready only when the last run of both exits 0. The next gate is `/cascade:cascade-spec-review`.
  - Running `/cascade:explore <change>` on a change that already has `tasks.md` skips straight to the readiness check.
- `/cascade:cascade-spec-brainstorm` becomes a deprecated alias: one sentence that delegates to `/cascade:explore $ARGUMENTS`.
- `/cascade:cascade-spec-review` gains one precondition right after its `design.md` check: `tasks.md` exists and `openspec-cascade lint-tasks --changes <change>` exits 0, with a tooling-problem message on exit 2 or command not found.
- Docs: `README.md` and `docs/cli.md` describe the planning flow (`/cascade:setup`, then `/cascade:explore`), the OpenCode flow, and use the `/cascade:` command form.

## Capabilities

### New Capabilities
- `cascade-explore`: the planning command's contract. It covers inputs, preconditions, precedence of overrides, read-only investigation, the use of the manifest, the brief format, the review gate, the propose step and the readiness check.

### Modified Capabilities

None.

## Impact

- New: `plugins/cascade/commands/explore.md`, and content tests in `test/plugin/egm_commands.test.ts`.
- Modified: `plugins/cascade/commands/cascade-spec-brainstorm.md` (alias), `plugins/cascade/commands/cascade-spec-review.md` (tasks precondition), `test/plugin/egm_commands.test.ts`, `docs/cli.md`, `README.md`.
- Depends on `project-manifest` for `setup show --json` (including the `profile` field of an entry) and on `tasks-contract` for the tasks linter rules and the `manual.md` format. This change is ordered after both.
- No runtime code changes. The command is a prompt, so its contract is verified by content tests, as the other plugin commands are. Read-only access is a prompt rule; the hard limits are the IAM policy of the declared AWS profile and the sandbox.
