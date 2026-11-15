# Tier 5 — Adversarial Hardening Slot (Phase 2 / M6)

This directory is reserved for **Phase 2 / Milestone M6 Adversarial Hardening** once Milestones M1–M5 mark `DONE` in `PROJECT.md`.

Planned adversarial suites:
- Circular-reference and deeply nested `redactSensitiveData` payloads (`F03`)
- NaN / Infinity / overflow budget enforcement probes (`F02`, `F03`)
- Path traversal and symlink escape probes against `ISpawner` & `ShadowCommitManager` (`F06`, `F11`)
- Process-group `SIGTERM`/`SIGKILL` orphan prevention probes (`F06`, `F08`)
- Anti-cheat evasion and stale-cache bypass attempts (`F12`, `F13`, `F20`)
