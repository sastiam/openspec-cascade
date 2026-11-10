# Design: OpenSpec Cascade v2 Spec-Driven Development Framework

## Context

Cascade automates task execution using AI agent sessions. In v1, task execution assumed pre-authored tasks and relied on after-the-fact test verification. By integrating the proven Spec-Driven Development (SDD) patterns from `agentic-sdd-kit`, Cascade v2 achieves full lifecycle autonomy: intake → clarify → spec gate → analyze → implement → surface validate → pre-pr review → ship.

## Decisions

1. **PreToolUse SDD Gate (`src/sdd/sdd_gate.ts`):**
   - *Rationale:* AI agents occasionally attempt to jump directly to coding before creating or validating an OpenSpec change. The SDD gate intercepts file modifications (`Edit`, `Write`) and blocks edits to production source files (`.ts`, `.js`, `.py`, `.vue`) unless an active change exists with pending tasks in `tasks.md`.
   - *Exemptions:* Documentation (`docs/`), specifications (`openspec/`), tests (`test/`, `*.test.ts`), and configuration files are exempt to allow specification authoring and test setup.

2. **Cross-Artifact Analyze Gate (`src/sdd/analyze.ts`):**
   - *Rationale:* Strict YAML and markdown formatting checks do not verify semantic integrity. The Analyze gate cross-checks `proposal.md`, `design.md`, `tasks.md`, and delta specs to guarantee 100% requirement coverage, flag orphan tasks, check internal consistency, and assert compliance with `openspec/project.md`.

3. **Surface-Aware Verification Protocol (`src/sdd/surface_verifier.ts`):**
   - *Rationale:* Unit test passing alone is insufficient for UI or API features. The surface verifier inspects `git diff` to determine whether frontend surfaces (requiring dev server check, console analysis, visual confirmation) or API surfaces (requiring endpoint contract checks) were affected.

4. **Diff-Match Pre-PR Review & Stale Cache Guard (`src/sdd/review_verifier.ts`):**
   - *Rationale:* Automated review tools can return cached reviews from earlier runs or different branches if not verified. The review verifier computes diffs against `git merge-base`, checks that findings reference files actually modified in the branch, and flags sub-10s cache hits.

5. **Zero Magic Numbers & Centralized Configuration:**
   - *Rationale:* All timeouts, thresholds, retry limits, and status codes are registered in `config.ts` under typed constants.
