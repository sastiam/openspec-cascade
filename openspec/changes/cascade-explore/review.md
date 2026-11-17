---
egm: review
status: open
hash: 107c4895380e2be86fbb4ac39354c9e2fca93edfea91791a180fcf480fcf7fe4
---
# Review: cascade-explore (EGM stage 7)

Status: findings open, pending triage.

## Blockers
- Read-only rules are not safe: `aws ... get*` allows `get-secret-value`, SSM decryption, `s3api get-object`; MCP queries include write tools; the command's own writes are not separated.
- The AWS profile has no field in the manifest.
- No mechanism returns control to explore after `/openspec-propose`, so the readiness check may never run.
- Command naming: plugin commands are invoked as `/cascade:<file name>`, so `cascade-explore.md` is `/cascade:cascade-explore`; rename to `explore.md` (same for `setup.md`).
- No Alternatives section.

## Major
- Precedence between the installed openspec-explore skill, EGM brainstorm and the cascade overrides is undefined; the explore skill forbids fixed formats and non-schema artifacts.
- "Sources consulted" should list every manifest entry with used / not applicable / unavailable.
- Deploy and CI inventory must be mandatory (workflow files, deploy scripts), not conditional on `gh` in the manifest.
- Review precondition edge cases (no tasks yet, old binary, exit 2) undefined; fix loop and `manual.md` authoring undefined.
- Brainstorm-only content tests would be dropped; alias description stays stale.
- Missing preconditions (skill presence, binary version, EGM glob at the gate); context budget for large logs.
- Docs task verify cannot observe the docs.
