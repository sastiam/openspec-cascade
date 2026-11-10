---
name: sdd-constitution
description: Guidelines for authoring and enforcing the project's constitution at openspec/project.md. Checks non-negotiable architectural principles, conventions, and constraints during the Analyze gate.
---

# SDD Constitution Guidelines

The constitution (`openspec/project.md`) contains the immutable rules governing development within this repository.

---

## 1. When to Consult
- Before proposing any architectural change or creating a new OpenSpec proposal.
- During the **Analyze** gate: every proposal, design, and delta spec must be verified against `openspec/project.md`. Any violation is a blocking defect.

---

## 2. Core Sections of `openspec/project.md`
1. **Purpose & Scope:** Core problem domain and system boundaries.
2. **Tech Stack & Toolchain:** Languages, runtime versions, package managers, and mandatory commands.
3. **Non-Negotiable Principles:** The rules AI agents must never violate (e.g. Zero Magic Numbers, Strict Typing, No Inline Comments, Spec-Before-Code).
4. **Conventions:** Naming conventions, error handling taxonomies, and folder structure.
5. **Definition of Done:** Required test passing criteria, linter checks, and coverage gates.

---

## 3. Maintenance Rules
- Ground every principle in repository reality; never add hypothetical rules.
- Short and enforceable beats long and aspirational.
- Changes to `openspec/project.md` require explicit user consensus.
