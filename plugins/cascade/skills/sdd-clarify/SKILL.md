---
name: sdd-clarify
description: Front door of the SDD flow. When receiving a feature or bug request, scans the codebase and prompt for load-bearing ambiguity across 6 dimensions before writing specs or code. Prompts with decision-tree-aware questions (recommended options first).
---

# SDD Clarify — Pre-Spec Ambiguity Resolution

The cheapest token is the one you don't spend re-doing work. A vague request implemented blind burns iterations. This skill resolves load-bearing ambiguity before writing specs or code.

---

## 1. Context Gathering (Cheap & Read-Only)
- Scan repository configuration, existing specs under `openspec/specs/`, and active changes under `openspec/changes/`.
- Never ask the user something the codebase already specifies.

---

## 2. The 6 Dimensions of Ambiguity
Scan the request across these dimensions:
1. **Functional Scope & Boundaries:** What is strictly in-scope vs explicitly out-of-scope?
2. **Data Model & Persistence:** Entity schemas, relationships, migrations, and storage strategy.
3. **Integration & Dependencies:** External APIs, message brokers, tools, environment variables.
4. **Edge Cases & Failure Behavior:** Timeouts, null values, rate limits, fail-open vs fail-closed.
5. **Non-Functional Requirements:** Latency budgets, concurrency guarantees, security constraints.
6. **Domain Terminology:** Disambiguate overloaded terms in the specific domain.

---

## 3. Decision-Tree Protocol
- Order questions by architectural impact (scope gates data model; data model gates interfaces).
- Present questions with 2-4 selectable options, placing the **(Recommended)** option first.
- If the request is already unambiguous, ask nothing and proceed directly to proposal authoring.
- Cap clarification at 1-2 concise rounds.
- Record every resolved ambiguity directly into the OpenSpec `proposal.md` and `design.md`.
