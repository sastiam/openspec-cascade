---
name: sdd-verify
description: Surface-aware verification protocol for changes. Detects whether a diff touches frontend UI (rendering, console, network) or backend API (endpoints, status, payload shape) and executes targeted verification beyond unit tests.
---

# Surface-Aware Verification (sdd-verify)

Passing unit tests proves that isolated logic satisfies test assertions. Surface verification proves the feature actually works within the operational runtime environment.

---

## 1. Surface Classification (from git diff)

- **Frontend Surface:**
  - Touches `.vue`, `.tsx`, `.jsx`, `.svelte`, `.html`, `.css`, or UI components.
  - Verification: Launch dev server, navigate to route, inspect console errors, check network requests, and confirm visual rendering.

- **Backend / API Surface:**
  - Touches routes, controllers, middleware, RPC handlers, database queries, or schemas.
  - Verification: Execute targeted smoke scripts asserting HTTP status codes (e.g. `200`, `201`), contract schema compliance, and payload structure.

- **Internal Engine / Library Surface:**
  - Touches pure algorithms, core engines, adapters, or configuration.
  - Verification: Execute deterministic suite (`bun test`, `tsc --noEmit`, `eslint .`).

---

## 2. Execution Discipline
- Surface verification runs as a mandatory verification gate before PR creation.
- If a surface fails, capture stderr/stdout/screenshot traces and remediate root cause.
