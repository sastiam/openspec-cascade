# Proposal: OpenSpec Cascade v2 Spec-Driven Development Framework

## Why

OpenSpec Cascade v1 provides task-level autonomous execution loops, multi-engine runner adapters, and verification gates. However, scaling to complex, continuous 24/7 feature development requires:
1. **Upfront Spec Discipline & Clarification:** Preventing hallucinated or ambiguous code by front-loading clarification across 6 dimensions before specs or code are generated.
2. **Deterministic Pre-Tool & Stop Gates:** Blocking production code modifications if no active, approved OpenSpec change exists, and preventing session completion on red tests or linter failures.
3. **Cross-Artifact Consistency & Coverage Analysis (`Analyze` Gate):** Formally verifying that every delta spec requirement maps to an automatable task, eliminating orphan tasks, and enforcing adherence to `openspec/project.md` (the Constitution).
4. **Surface-Aware Verification & Pre-PR Review Guards:** Differentiating frontend UI vs API/backend verification, and verifying review diff matching against `git merge-base` to prevent stale cache hits.

## What Changes

- Create `src/sdd/` module providing:
  - `sdd_gate.ts`: PreToolUse enforcement guard ensuring spec-first discipline.
  - `analyze.ts`: Cross-artifact consistency, orphan detection, and coverage validator.
  - `surface_verifier.ts`: Surface-aware end-to-end verifier (frontend UI, backend API, library floor).
  - `review_verifier.ts`: Pre-PR review verifier with diff-match validation against `git merge-base` and stale cache guards.
- Integrate centralized SDD constants into `config.ts` enforcing zero magic numbers.
- Add suite of in-repo agent skills (`clean-code-best-practices`, `zero-magic-numbers-audit`, `sdd-clarify`, `sdd-constitution`, `sdd-checklist`, `sdd-verify`, `pre-pr-review`).
- Establish `openspec/project.md` as the non-negotiable repository constitution.
- Update `cascade.ts` and `run_looper.sh` to support v2 continuous 24/7 autonomous looping with model tiering and self-healing resilience.

## Definition of Done

- All new SDD modules (`sdd_gate`, `analyze`, `surface_verifier`, `review_verifier`) implemented in TypeScript with zero `any` and zero magic numbers.
- Comprehensive unit tests covering all SDD components with 100% pass rate.
- In-repo skills discoverable via `skills.ts`.
- Full project verification suite passes (`bun test`, `bun run typecheck`, `bun run lint`).
- OpenSpec change passes `openspec validate cascade-v2-sdd-framework --strict`.
