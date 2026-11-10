---
name: zero-magic-numbers-audit
description: Auditing and refactoring rules for eliminating magic numbers and uncentralized literals across openspec-cascade. Enforces centralized configuration in config.ts and typed constants objects.
---

# Zero Magic Numbers Audit & Guidelines

Hardcoded numeric literals and magic strings introduce subtle bugs, prevent configurability, and break architectural predictability. In `openspec-cascade`, zero magic numbers is a strictly enforced standard.

---

## 1. What Qualifies as a Magic Number?
Any raw numeric or temporal literal that conveys semantic meaning or policy:
- Millisecond timeouts (e.g. `5000`, `300000`, `900000`)
- Retry caps and turn limits (e.g. `3`, `12`, `16`)
- Budget caps and percentage thresholds (e.g. `0.95`, `10.0`)
- Port numbers (e.g. `3000`, `8080`)
- Buffer limits, line counts, or slice sizes (e.g. `25`, `40`, `1000`)
- HTTP status codes (e.g. `200`, `400`, `404`, `500`) when not typed

### Allowed Exceptions:
- Numbers `0`, `1`, `-1` used strictly for array indexing, loop increments, or empty checks (`length === 0`).
- Math formulas where coefficients are mathematical constants (e.g. `2 * Math.PI`).

---

## 2. Refactoring Procedure
1. Locate hardcoded literals in the target file.
2. Check `config.ts` to see if a canonical constant already exists:
   - `EXECUTION_CONSTANTS` (turns, retries, timeouts, budgets)
   - `STORAGE_CONSTANTS` (heartbeats, SLAs, line limits)
   - `GATE_CONSTANTS` (rubric weights, anticheat thresholds)
3. If absent, add the typed constant to `config.ts` under the appropriate namespace.
4. Import the constant in the target module and replace the literal.

```typescript
// ❌ BAD: Magic numbers
const timeout = 300000;
if (retries > 3) throw new Error("Max retries exceeded");

// ✅ GOOD: Centralized constants
import { EXECUTION_CONSTANTS } from "./config";

const timeout = EXECUTION_CONSTANTS.MAX_SESSION_TIMEOUT_MS;
if (retries > EXECUTION_CONSTANTS.MAX_TASK_RETRIES) {
  throw new TaskFailureError("Max retries exceeded");
}
```

---

## 3. Autonomous Verification Command
To verify compliance before finishing a task:
```bash
bun test lint.test.ts
bun run lint
```
