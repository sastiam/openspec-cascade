# OpenSpec Cascade Constitution

The non-negotiable principles, architectural conventions, and quality standards governing all changes in `openspec-cascade`.

---

## 1. Purpose & Scope

`openspec-cascade` is an autonomous, multi-engine task execution harness and Spec-Driven Development (SDD) platform. It executes OpenSpec changes task-by-task using isolated agent sessions, deterministic verification gates, multi-engine adapters (Claude, OpenCode, Antigravity/Gemini, Jules), and 24/7 failure resilience.

---

## 2. Tech Stack & Toolchain

- **Runtime:** Bun (v1.4+) with Node.js 24 LTS compatibility.
- **Language:** TypeScript 5.9+ with strict mode enabled (`noImplicitAny`, strict null checks).
- **Testing:** `bun test` built-in test runner with `expect()` assertions.
- **Linter & Formatting:** ESLint 10 with typescript-eslint. Zero warnings allowed.
- **Specification Engine:** OpenSpec CLI (`@fission-ai/openspec`) with `--strict` validation.
- **Cross-Platform:** Full compatibility across Linux (Debian, Fedora, Ubuntu) and macOS (Darwin).

---

## 3. Non-Negotiable Core Principles

1. **Spec Before Code (SDD Discipline):**
   - Never write or edit production source code without an approved, `--strict`-validated OpenSpec change.
   - Requirements must use `SHALL` or `MUST` on the first line of the requirement body.
   - Every requirement in a delta spec MUST map to at least one automatable task in `tasks.md`.

2. **Zero Magic Numbers:**
   - No hardcoded numeric or string literals for timeouts, retry counts, port numbers, budget limits, status codes, or interval timers.
   - Every configurable value MUST be defined in centralized, typed configuration modules (`config.ts`) with clear JSDoc documentation.

3. **Strict Typing & Hexagonal Boundaries:**
   - 100% TypeScript type safety. Never use `any` or loose type assertions (`as any`).
   - Domain logic (`src/core/`, `src/gates/`) must remain decoupled from infrastructure and external engines through explicit interfaces (`EngineAdapter`, `IPalProvider`, `MemoryStorage`).

4. **Clean Code & Comments Rule:**
   - Code must be self-documenting through clear, intention-revealing names.
   - NEVER write comments inside function bodies explaining *WHAT* the code does. Comments are reserved for docstrings explaining *WHY* (rationale, architectural constraints, non-obvious invariants).
   - No temporary ticket tags, TODOs without issue tracking, or commented-out dead code.

5. **Deterministic Verification Over Promises:**
   - An AI agent or subagent must never declare a task complete based on belief or assumptions.
   - The harness, not the model, determines completion by executing deterministic verification commands (`bun test`, `tsc --noEmit`, `eslint .`). Exit code must be `0`.

6. **24/7 Resilience & Self-Healing:**
   - All failures must be categorized (`fatal`, `paused`, `retryable`, `forensic`).
   - Max 3 retry attempts per task. If exhausted, the harness automatically engages a Git Rollback Buffer (`git reset --hard` & `git clean -fd`) to prevent repository contamination.
   - Victory livelock prevention: cycles in state transitions or repetitive failure signatures trigger immediate escalation rather than infinite loops.

7. **Surface-Aware Verification:**
   - Changes touching frontend UI surfaces must verify rendering, network calls, and console logs.
   - Changes touching backend/API surfaces must verify contracts and endpoint status codes.
   - Pure library/tooling changes must pass the full unit and typecheck suite.

8. **Secure Git Operations:**
   - Never run or allow operations on protected branches (`main`, `master`, `stable`).
   - All commits must be signed and use Conventional Commits format.
   - Pre-PR reviews must verify diff matching against `git merge-base` to prevent stale cache hits.
