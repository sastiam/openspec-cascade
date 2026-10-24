---
name: openspec-cascade-runner
description: Quality standards, architecture principles, in-repo skill usage, and QA verification rules for AI agents executing within openspec-cascade.
---

# OpenSpec Cascade Agent Guidelines & Quality Standards

When executing task sessions within `openspec-cascade`, follow these non-negotiable rules for engineering quality, architecture, cross-platform safety, and autonomous verification.

---

## 1. Planning & Conceptual Understanding First
- **Explore Dependencies:** Consult `graphify-out/GRAPH_REPORT.md` and use `graphify god-nodes` or `graphify query "<feature>"` to understand the codebase structure before editing code.
- **Inspect Architecture:** Check interactive diagrams under `.archify/` when refactoring core interfaces or module boundaries.
- **OpenSpec Protocol:** Read `proposal.md`, `design.md`, and `specs/` in the target change directory before modifying files.

---

## 2. Clean Code & Well-Architected Principles
- **Zero Magic Numbers:** Never hardcode numeric literals (e.g. timeouts, retry counts, port numbers, budget limits, status codes). Move all constants to centralized configuration modules (`config.ts`).
- **Strict Typing:** Write explicit TypeScript types. Avoid `any` or loose type assertions (`as any`).
- **Hexagonal / Modular Boundaries:** Keep engine runners (`Claude`, `OpenCode`, `Antigravity`) decoupled from the task harness (`cascade.ts`) using explicit interfaces (`EngineAdapter`).
- **Clean Error Handling:** Catch specific error instances, classify failures cleanly (`fatal`, `paused`, `error`), and avoid silent catch blocks.

---

## 3. In-Repo Skills & Directives Compliance
- **Honor Project Directives:** Always load and follow directives specified in `AGENTS.md`, `CLAUDE.md`, and skills located in `.agents/skills/`.
- **In-Repo Skill Loading:** When working on specific subsystems, check if a dedicated skill exists under `.agents/skills/<skill-name>/SKILL.md` and adhere to its instructions.

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
  bunx tsc --noEmit
  bun run lint
  bun run build
  ```
- **Error Feedback Loops:** If a verification step fails, analyze the full stdout/stderr stack trace, fix the underlying root cause, and re-run verification before finishing the turn.
