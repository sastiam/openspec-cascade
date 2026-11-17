# Proposal

## Why

The main source of rework is weak planning. The OpenSpec explore session:
- asks questions the agent could have answered itself by looking (the repo, the AWS account read-only, GitHub Actions runs, Watson);
- forgets the deploy and CI path. The SDK docs migration failed again and again at the GitHub Actions deploy;
- does not use the project's helpers unless the user remembers to name them (Watson, Stitch, the design-system MCP);
- produces tasks with manual steps.

The user wants one planning command that does this well, absorbs the existing `/cascade-spec-brainstorm`, and only declares a change ready for an unattended run once its tasks pass the lint. This is roadmap piece 3.

## What Changes

- New plugin command `/cascade:explore <change> <idea or Linear link>`.
  - It reads and follows the installed OpenSpec explore skill (`openspec-explore`), with overrides, and never edits that skill.
  - It loads the merged manifest (`openspec-cascade setup show --json`, from `project-manifest`) and consults each entry when its `whenToUse` applies. Watson and EGM are planning aids.
  - Given a Linear link, it reads the issue through the Linear MCP when the session has it, and otherwise asks for the text.
  - It investigates read-only before asking. It reads the repo, the CLI tools in the manifest (for example the AWS CLI with the declared read-only profile, and `gh run list` / `gh run view` for CI), and MCP servers. It then asks only what it could not find, one focused question at a time.
  - It writes `openspec/changes/<change>/brief.md` with a fixed set of sections. They always include "Sources consulted", "Deploy and CI risks" and "Manual steps", the last one destined for `manual.md`.
  - At the readiness gate it offers the EGM Goldfish review and runs it only when the user confirms.
  - It hands over to `/openspec-propose`. Once the tasks exist, it runs `openspec validate --strict` and `openspec-cascade lint-tasks`, and calls the change ready for an unattended run only when both pass. The next gate is `/cascade-spec-review`.
- `/cascade-spec-brainstorm` becomes a short alias that points to `/cascade:explore`.
- `/cascade-spec-review` gains one precondition: `lint-tasks` passes for the change.
- Docs: `README.md` and `docs/cli.md` describe the planning flow.

## Capabilities

### New Capabilities
- `cascade-explore`: the planning command's contract. It covers inputs, read-only investigation, the use of the manifest, the brief format, the review gate and the readiness check.

### Modified Capabilities

None.

## Impact

- New: `plugins/cascade/commands/cascade-explore.md`, and content tests in `test/plugin/`.
- Modified: `plugins/cascade/commands/cascade-spec-brainstorm.md` (alias), `plugins/cascade/commands/cascade-spec-review.md` (lint precondition), `test/plugin/egm_commands.test.ts`, `docs/cli.md`, `README.md`.
- Depends on `project-manifest` for `setup show --json` and on `tasks-contract` for the lint rules. This change is ordered after both.
- No runtime code changes. The command is a prompt, so its contract is verified by content tests, as the other plugin commands are.
