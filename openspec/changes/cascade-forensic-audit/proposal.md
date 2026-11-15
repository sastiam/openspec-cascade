# Proposal: Deterministic Forensic Audit Tooling (M1 / E2E Phase A Closure)

## Why

The M1 and E2E Phase A gates were approved by Reviewers and Challengers, but the final Forensic Auditor pass (anti-stubs, zero `any`, zero inline function-body comments, zero placeholder implementations) was executed manually through ad-hoc `grep` commands that cannot distinguish string-literal fixtures from real code. A deterministic, AST-based audit is required so the closure of M1/E2E — and every later milestone (M2–M6) and the CI workflow (F19) — is reproducible by the harness rather than asserted by an agent.

## What Changes

1. Add `src/audit/forensic.ts`: an AST-based auditor (TypeScript compiler API) exposing `auditSource(fileName, text, options)` and `auditFiles(paths, options)` returning typed `ForensicViolation` records for four rules: `explicit-any`, `inline-body-comment`, `e2e-stub`, and `placeholder-implementation`.
2. Add `scripts/forensic_audit.ts`: a CLI that audits the curated, milestone-scoped path set (`FORENSIC_AUDIT_SCOPE`) and exits `0` on a clean audit or `1` with a redacted report otherwise.
3. Add `test/audit/forensic.test.ts` covering each rule's positive and negative cases, including string-literal fixtures that MUST NOT be flagged.
4. Extend `tsconfig.json` `include` with `scripts/**/*.ts` so the CLI is type-checked.

## Definition of Done

- `bunx openspec validate cascade-forensic-audit --strict` exits `0`.
- `bun run scripts/forensic_audit.ts` exits `0` over the M1 + E2E Phase A scope.
- `bun test`, `bunx tsc --noEmit`, and `bunx eslint .` exit `0`.
