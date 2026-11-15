# Tasks: Deterministic Forensic Audit Tooling

## 1. Auditor Library
- [x] 1.1 Implement `src/audit/forensic.ts` with `auditSource`, `auditFiles`, `FORENSIC_AUDIT_SCOPE`, and the four AST rules.
- [x] 1.2 Add `test/audit/forensic.test.ts` covering positive, negative, and fixture-string cases for every rule.

## 2. CLI Gate
- [x] 2.1 Implement `scripts/forensic_audit.ts` exiting via `EXIT_CODE_CONSTANTS` and include `scripts/**/*.ts` in `tsconfig.json`.
- [x] 2.2 Run the audit over the M1 + E2E Phase A scope and record the verdict in the M1/E2E gate status files.
