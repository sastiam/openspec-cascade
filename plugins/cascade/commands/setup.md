---
name: setup
description: Build the project manifest of helpers (MCP servers, skills, plugins, CLI tools) and when to use each, by discovering them and confirming each one with the user.
category: Planning
tags: [cascade, setup, manifest]
---

# /cascade:setup — Project helper manifest

Record which helpers this project uses and when to use them, so planning does not depend on the user's memory. Ask one question at a time.

## Steps

1. Run `openspec-cascade setup discover --json`. Read only the `candidates` and `skipped` lists.
2. Group the candidates by `type` (`mcp`, `skill`, `plugin`, `cli`).
3. Propose which to include, with a draft `whenToUse` sentence for each (one line, at most 200 characters), for example "Watson: before proposing, to look up how other work repos solved it". Skip candidates already in the manifest (`inManifest` is not null) unless the user wants to change them.
4. Let the user confirm or edit each one, one question at a time:
   - the `whenToUse` sentence;
   - the scope: `project` or `global`;
   - whether it is `required`;
   - an optional `check` command. It must be read-only: no side effects, no shell operators, no quotes and no `$`. Never accept a check that writes, deletes or deploys;
   - for AWS, the read-only `profile` name (a profile name, never a key or secret).
5. Ask whether any helper is missing, such as a claude.ai connector, which discovery cannot see, and register it too.
6. Call `openspec-cascade setup add --scope <project|global> --name <name> --type <type> --when "<sentence>"` for each accepted entry, adding `--required`, `--check`, `--profile` and `--host` as confirmed. Then run `openspec-cascade setup show` to confirm the result.
7. Show the output of `openspec-cascade setup rules`. Run `openspec-cascade setup rules --write` only after the user confirms. If it refuses because `rules` already exists, tell the user and leave the file alone.

Never read or print MCP secrets, tokens or environment values.
