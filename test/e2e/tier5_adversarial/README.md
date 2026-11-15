# Tier 5 — Adversarial Hardening (M6)

Every probe runs against production modules, the real `cascade.ts` CLI, the real plugin hooks and real `git` repositories. No mocks, stubs or reference harnesses (enforced by `scripts/forensic_audit.ts`).

| Suite | Probes |
|---|---|
| `input_injection.test.ts` | Change-id traversal (`../`, separators, leading dots), verify-command chaining/piping/redirection/substitution, budget `NaN`/`Infinity`/overflow/hex/empty via CLI and env, strict `>=` session budget |
| `redaction_bombs.test.ts` | 20k-level nesting, cycles across arrays/maps/sets/error causes, `__proto__` pollution, 100k-token arrays, URL credentials and PEM blocks |
| `filesystem_and_process.test.ts` | Symlink-to-secret in shadow commits, hostile cache keys, harness traversal, SDD gate bypass paths (trailing dot/space, case, backslash, `..`) on the TS gate and both hooks, SIGTERM-ignoring process trees and mid-run aborts on Bun and Node spawners |
| `anticheat_and_audit_evasion.test.ts` | Aliased/namespaced mocks, comments smuggled into bodies, hidden `any`, Gate 3 veto of cheating in untracked files via the complete working-tree diff, stale-review latency, forged cache entries |

Findings fixed by M6 (see `openspec/changes/cascade-m6-hardening-certification`): change-id traversal, verify-command injection, aliased-mock audit evasion, trailing-dot SDD bypass, and gates reviewing an incomplete diff (untracked files).
