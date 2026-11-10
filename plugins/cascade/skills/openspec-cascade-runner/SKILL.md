---
name: openspec-cascade-runner
description: Quality standards, architecture principles, in-repo skill usage, and QA verification rules for AI agents executing within openspec-cascade v2.
---
# OpenSpec Cascade Agent Guidelines & Quality Standards (v2)

When executing task sessions within `openspec-cascade`, follow these non-negotiable rules for engineering quality, architecture, cross-platform safety, and autonomous verification.

---

## 1. Planning, Constitution & Conceptual Understanding First
- **Honor Project Constitution:** Read `openspec/project.md` before altering architecture or adding dependencies. It defines immutable project invariants.
- **Explore Dependencies:** Consult `graphify-out/GRAPH_REPORT.md` and use `graphify god-nodes` or `graphify query "<feature>"` to understand the codebase structure before editing code.
- **Inspect Architecture:** Check interactive diagrams under `.archify/` when refactoring core interfaces or module boundaries.
- **OpenSpec Protocol & Analyze Gate:** Read `proposal.md`, `design.md`, and `specs/` in the target change directory. Ensure 100% requirement-to-task coverage before writing code.

---

## 2. Clean Code & Zero Magic Numbers Standards
- **Zero Magic Numbers:** Never hardcode numeric literals (timeouts, retry counts, port numbers, budget limits, status codes). Import all constants from `config.ts` (consult `.agents/skills/zero-magic-numbers-audit/SKILL.md`).
- **Clean Code & Comments:** Self-documenting code. Never write inline comments inside function bodies explaining *what* the code does; docstrings are for *why* only (consult `.agents/skills/clean-code-best-practices/SKILL.md`).
- **Strict Typing:** Write explicit TypeScript types. Avoid `any` or loose type assertions (`as any`).
- **Hexagonal / Modular Boundaries:** Keep engine runners (`Claude`, `OpenCode`, `Antigravity`, `Jules`) decoupled from the task harness (`cascade.ts`) using explicit interfaces (`EngineAdapter`, `IPalProvider`).
- **Clean Error Handling:** Catch specific error instances, classify failures cleanly (`fatal`, `paused`, `error`, `forensic`), and avoid silent catch blocks.

---

## 3. In-Repo Skills & Directives Compliance
- **Honor Project Directives:** Always load and follow directives specified in `AGENTS.md`, `CLAUDE.md`, and skills located in `.agents/skills/`.
- **In-Repo Skill Catalog:**
  - `clean-code-best-practices`: Code styling, comment bans, single responsibility.
  - `zero-magic-numbers-audit`: Constant extraction and audit commands.
  - `sdd-clarify`: Pre-spec ambiguity resolution across 6 dimensions.
  - `sdd-constitution`: Invariant enforcement against `openspec/project.md`.
  - `sdd-checklist`: Pre-approval specification quality rubric.
  - `sdd-verify`: Surface-aware verification for UI and API changes.
  - `pre-pr-review`: Diff-match verification against `git merge-base` and stale cache guards.

---

## 4. Cross-Platform Safety (macOS & Linux)
- **Path Separation & OS Normalization:** Never hardcode `/` or `\` path string concatenations; use `node:path` (`join`, `resolve`).
- **Shell Commands:** Ensure shell scripts and commands run seamlessly on both **macOS (Darwin)** and **Linux (Fedora/Debian)**. Avoid macOS-only or Linux-only tools without explicit platform checks (`process.platform`).
- **Process Management:** Handle process termination signals (`SIGINT`, `SIGTERM`) cleanly across platforms.

---

## 5. Autonomous QA Stage & Self-Verification
- **Verification Over Promises:** An AI agent must never declare a task complete based on assumption. You MUST execute verification commands and verify passing exit codes (`0`).
- **Standard Verification Suite:**
  ```bash
  bun test
  bun run typecheck
  bun run lint
  ```
- **Error Feedback Loops:** If a verification step fails, analyze the full stdout/stderr stack trace, fix the underlying root cause, and re-run verification before finishing the turn.
