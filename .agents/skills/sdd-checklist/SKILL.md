---
name: sdd-checklist
description: Generates a requirements-quality rubric for an OpenSpec change (proposal, design, tasks, delta specs) to validate completeness, clarity, consistency, and testability before approving implementation.
---

# SDD Requirements Quality Checklist

`--strict` validation proves that an OpenSpec change is syntactically well-formed; it does not prove it is well-specified. This skill validates specification quality before code implementation begins.

---

## 1. Quality Dimensions

1. **Completeness:**
   - Are error states, edge cases, and empty states specified alongside happy paths?
   - Are explicit non-goals stated?
   - Does every delta spec requirement map to at least one automatable task in `tasks.md`?

2. **Clarity:**
   - Are requirements unambiguous and testable, using `SHALL` or `MUST` on the first line?
   - Are boundary conditions defined with concrete numeric ranges rather than vague modifiers ("fast", "reasonable", "soon")?

3. **Consistency:**
   - Do `proposal.md`, `design.md`, `tasks.md`, and delta specs agree without contradiction?
   - Does any requirement contradict `openspec/project.md` (the Constitution)?

4. **Testability:**
   - Does each requirement have an associated verification command or test suite that fails if the requirement is broken?

---

## 2. Evaluation Output
Produce a concise markdown table with items graded `PASS`, `FAIL`, or `N/A`. List any `FAIL` items first with remediation suggestions before recommending approval.
