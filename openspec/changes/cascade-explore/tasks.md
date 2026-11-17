# Tasks

## Files

- Create: `plugins/cascade/commands/cascade-explore.md`.
- Modify: `plugins/cascade/commands/cascade-spec-brainstorm.md`, `plugins/cascade/commands/cascade-spec-review.md`, `test/plugin/egm_commands.test.ts`, `docs/cli.md`, `README.md`.
- Untouched: everything under `src/`, the installed OpenSpec skills.

## 1. Explore command

- [ ] 1.1 Test first, then write the command. In `test/plugin/egm_commands.test.ts`, add a describe block for `cascade-explore` that asserts: frontmatter name and description; OpenSpec skills named in both the slash and at forms with no old opsx commands; writes only inside the change folder; it reads the installed openspec-explore skill and the EGM brainstorm skill by reading files, never through the Skill tool; it names `setup show --json`, the Linear MCP, the read-only allowlist, `lint-tasks`, `openspec validate`, the next gate `/cascade-spec-review`, and every brief section from the `cascade-explore` spec delta in order. Run the plugin test file and see the new tests fail. Then write `plugins/cascade/commands/cascade-explore.md` with the sections and rules in design.md, moving the EGM overrides from the current brainstorm command.
  Verify: `bun test test/plugin` passes, `bun run typecheck` passes and `bun run lint` passes.

## 2. Alias, review precondition and docs

- [ ] 2.1 Test first, then edit. Reduce `cascade-spec-brainstorm.md` to its frontmatter plus a short body that points to `/cascade:explore` with the same arguments, and add the precondition to `cascade-spec-review.md` that `openspec-cascade lint-tasks --changes <change>` exits 0 before any reviewer starts. In `test/plugin/egm_commands.test.ts`, remove brainstorm from the EGM command table, add a test that the alias names `/cascade:explore`, and add a test that the review command names the lint-tasks precondition.
  Verify: `bun test test/plugin` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 2.2 Describe the planning flow in `README.md` (English) and `docs/cli.md` (Spanish): `/cascade:setup` once per project, then `/cascade:explore`, `/openspec-propose`, the readiness check, `/cascade-spec-review` and the unattended run. State that read-only investigation relies on the sandbox and on a read-only AWS profile declared in the manifest.
  Verify: `bun test` passes with zero failures, `bun run typecheck` passes and `bun run lint` passes.
