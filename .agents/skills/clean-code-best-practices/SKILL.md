---
name: clean-code-best-practices
description: Non-negotiable Clean Code rules, architectural discipline, and refactoring guidelines for AI agents developing in openspec-cascade. Enforces zero inline comments, strict typing, hexagonal boundaries, and fail-open/fail-closed error handling.
---

# Clean Code & Engineering Best Practices

When writing or refactoring code in `openspec-cascade`, adhere strictly to these principles.

---

## 1. Zero Inline Function Comments
- **Rule:** Never place comments inside function bodies explaining *what* an expression or statement does.
- **Why:** Code that requires inline explanation is insufficiently expressive. Refactor by extracting well-named helper functions or explanatory variables.
- **Docstrings for WHY only:** JSDoc/TSDoc comments at class, method, or interface declarations are reserved for explaining *why* a particular architectural choice, algorithm, or edge-case handling exists.

```typescript
// ❌ BAD: Explaining what the code does
function computeTimeout(retries: number): number {
  // Multiply retries by base backoff
  const backoff = retries * 1000;
  // Return capped value
  return Math.min(backoff, 30000);
}

// ✅ GOOD: Intention-revealing code + constants from config
/**
 * Computes exponential backoff delay capped at maximum retry duration.
 */
function computeTimeout(retries: number): number {
  const backoffMs = retries * TIMEOUT_CONSTANTS.BASE_BACKOFF_MS;
  return Math.min(backoffMs, TIMEOUT_CONSTANTS.MAX_RETRY_TIMEOUT_MS);
}
```

---

## 2. 100% Strict Typing (Zero `any`)
- Never use `any` or loose type assertions (`as any`).
- Use discriminated unions, generics, `unknown` with type guards, and `zod` or schema parsers for unknown data boundaries.
- Ensure every exported function, parameter, and return value has an explicit type annotation.

---

## 3. Single Responsibility & Modular Boundaries
- Keep functions under 40 lines where feasible.
- Modules must have a single clear responsibility. Keep orchestrators separate from domain models and storage engines.
- Decouple external third-party SDKs using interface ports (`IPalProvider`, `EngineAdapter`).

---

## 4. Error Handling Taxonomy
- Never swallow exceptions with empty `catch {}` blocks.
- Throw custom, typed error classes (`StorageError`, `PalError`, `GateError`, `TaskFailureError`) with explicit error codes.
- Distinguish between **recoverable errors** (retry with exponential backoff) and **fatal errors** (trigger rollback buffer and fail closed).
