# Tasks

## Files

- Create: `src/manifest/types.ts`, `src/manifest/load.ts`, `src/manifest/discover.ts`, `src/manifest/rules.ts`, `src/cli/setup.ts`, `plugins/cascade/commands/cascade-setup.md`, `test/manifest/load.test.ts`, `test/manifest/discover.test.ts`, `test/manifest/rules.test.ts`, `test/cli/setup.test.ts`.
- Modify: `src/config/schemas.ts`, `src/config/constants.ts`, `src/cli/commands.ts`, `test/plugin/egm_commands.test.ts` (or a new plugin command test file), `docs/cli.md`, `README.md`.

## 1. Manifest model

- [ ] 1.1 Test first, then implement. Create `src/manifest/types.ts` and `src/manifest/load.ts` as design.md describes, and add the optional `manifest` object to the strict file schema in `src/config/schemas.ts`. Put paths and file names in a new `MANIFEST_CONSTANTS` block in `src/config/constants.ts`. In `test/manifest/load.test.ts`, cover every scenario of the requirements "Manifest locations", "Manifest merge" and "Manifest entry shape", using temporary directories passed as parameters, never the real home directory.
  Verify: `bun test test/manifest/load.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 2. Discovery

- [ ] 2.1 Test first, then implement. Create `src/manifest/discover.ts` with one source function per source listed in design.md and the merge of same-name candidates. In `test/manifest/discover.test.ts`, write fixture files into a temporary home and repo: a `.claude.json` with a global and a per-project MCP server whose env holds a fake token, a project `.mcp.json`, global and project Claude skills, a `settings.json` with enabled and disabled plugins, an `opencode.json` with an `mcp` object, an OpenCode skill folder, and an invalid `opencode.json` in a second case. Cover every scenario of "Discovery sources" and "Discovery reads names, never values", and assert that the serialized output never contains the fake token. Use a fake `which` for CLI tools.
  Verify: `bun test test/manifest/discover.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 3. setup subcommand and rules

- [ ] 3.1 Test first, then implement. Create `src/manifest/rules.ts` with the rules template and `writeRules` as design.md describes. In `test/manifest/rules.test.ts`, cover "Print rules", both scenarios of "Writing suggested rules", and that a commented-out rules line does not count as an existing key.
  Verify: `bun test test/manifest/rules.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 3.2 Test first, then implement. Create `src/cli/setup.ts` exporting `runSetup(argv, output, deps)` with the actions discover, add, remove, show and rules, following the pattern of `src/cli/spec_gate.ts`. Register `setup` in the subcommand list and the dispatch switch. In `test/cli/setup.test.ts`, cover both scenarios of "setup subcommand", remove, an invalid entry exiting 2, and `rules --write` exiting 1 when rules already exist, all with injected temporary paths.
  Verify: `bun test test/cli/setup.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 4. doctor, plugin command and docs

- [ ] 4.1 Test first, then implement. In `runDoctor` (`src/cli/commands.ts`), add one check per merged manifest entry as the requirement "doctor checks manifest entries" says, running each check through the injected spawner. Cover both scenarios and the entry without a check in the existing doctor tests (or a new test file next to them).
  Verify: `bun test test/cli` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 4.2 Create `plugins/cascade/commands/cascade-setup.md` following the conversation steps in design.md and the frontmatter of the other commands. Add a content test next to `test/plugin/egm_commands.test.ts` asserting the file exists, has the frontmatter fields, and names the actions discover, add and rules. Document `setup`, the two manifest layers, the entry fields and `/cascade:setup` in `docs/cli.md` (Spanish) and `README.md` (English).
  Verify: `bun test` passes with zero failures, `bun run typecheck` passes and `bun run lint` passes.
