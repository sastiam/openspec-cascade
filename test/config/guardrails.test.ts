import { describe, expect, test } from "bun:test";
import {
  assertBranchSafety,
  BudgetExceededError,
  enforceSessionBudget,
  evaluateProtectedBranchGuard,
  ProtectedBranchError,
  redactSensitiveData,
} from "../../config";

describe("Security & Well-Architected Guardrails (F03)", () => {
  describe("enforceSessionBudget", () => {
    test("permits spending strictly below max budget", () => {
      expect(() => enforceSessionBudget(0, 10, "session")).not.toThrow();
      expect(() => enforceSessionBudget(9.99, 10, "session")).not.toThrow();
    });

    test("fails closed on >= boundary, NaN, Infinity, and negative/non-positive inputs", () => {
      expect(() => enforceSessionBudget(10, 10, "session")).toThrow(BudgetExceededError);
      expect(() => enforceSessionBudget(12.5, 10, "total")).toThrow(BudgetExceededError);
      expect(() => enforceSessionBudget(Number.NaN, 10, "session")).toThrow(BudgetExceededError);
      expect(() => enforceSessionBudget(Number.POSITIVE_INFINITY, 10, "session")).toThrow(BudgetExceededError);
      expect(() => enforceSessionBudget(-0.01, 10, "session")).toThrow(BudgetExceededError);
      expect(() => enforceSessionBudget(1, 0, "session")).toThrow(BudgetExceededError);
      expect(() => enforceSessionBudget(1, Number.NaN, "session")).toThrow(BudgetExceededError);
    });
  });

  describe("redactSensitiveData", () => {
    test("handles circular references in objects, arrays, maps, and sets without throwing", () => {
      const cyclicObj: Record<string, unknown> = {
        apiKey: "sk-ant-1234567890abcdef",
        nested: { safe: "ok" },
      };
      cyclicObj.self = cyclicObj;

      const cyclicArr: unknown[] = ["ghp_1234567890abcdef1234"];
      cyclicArr.push(cyclicArr);

      const cyclicMap = new Map<string, unknown>();
      cyclicMap.set("token", "secret-val");
      cyclicMap.set("loop", cyclicMap);

      const cyclicSet = new Set<unknown>();
      cyclicSet.add("Bearer my.jwt.token");
      cyclicSet.add(cyclicSet);

      const redactedObj = redactSensitiveData(cyclicObj);
      expect(redactedObj.apiKey).toBe("[REDACTED]");
      expect(redactedObj.self).toBe("[Circular]");
      expect(cyclicObj.apiKey).toBe("sk-ant-1234567890abcdef");

      const redactedArr = redactSensitiveData(cyclicArr);
      expect(redactedArr[0]).toBe("[REDACTED]");
      expect(redactedArr[1]).toBe("[Circular]");

      const redactedMap = redactSensitiveData(cyclicMap);
      expect(redactedMap).toBeInstanceOf(Map);
      expect(redactedMap.get("token")).toBe("[REDACTED]");
      expect(redactedMap.get("loop")).toBe("[Circular]");

      const redactedSet = redactSensitiveData(cyclicSet);
      expect(redactedSet).toBeInstanceOf(Set);
      expect(redactedSet.has("Bearer [REDACTED]")).toBe(true);
      expect(redactedSet.has("[Circular]")).toBe(true);
    });

    test("preserves shared sibling references while enforcing maxDepth", () => {
      const shared = { label: "shared-value" };
      const root = { a: shared, b: shared, deep: { l1: { l2: { l3: "hidden" } } } };

      const redacted = redactSensitiveData(root, 3);
      expect(redacted.a).toEqual({ label: "shared-value" });
      expect(redacted.b).toEqual({ label: "shared-value" });
      expect((redacted.deep as Record<string, unknown>).l1).toEqual({ l2: "[MaxDepth]" });
    });

    test("preserves Date, RegExp, and Error containers while redacting embedded secrets", () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const pattern = /hello/gi;
      const err = new Error("Auth failed for https://alice:supersecret@example.com with sk-1234567890abcdef");
      (err as unknown as Record<string, unknown>).authorization = "Bearer topsecret";

      const redacted = redactSensitiveData({ createdAt, pattern, err });
      expect(redacted.createdAt).toBeInstanceOf(Date);
      expect(redacted.createdAt.getTime()).toBe(createdAt.getTime());
      expect(redacted.pattern).toBeInstanceOf(RegExp);
      expect(redacted.pattern.source).toBe("hello");
      expect(redacted.err).toBeInstanceOf(Error);
      expect(redacted.err.message).not.toContain("supersecret");
      expect(redacted.err.message).not.toContain("sk-1234567890abcdef");
      expect(redacted.err.message).toContain("[REDACTED]");
      expect((redacted.err as unknown as Record<string, unknown>).authorization).toBe("[REDACTED]");
    });

    test("redacts PEM private keys and provider tokens in strings", () => {
      const pem = [
        "-----BEGIN RSA PRIVATE KEY-----",
        "MIIEowIBAAKCAQEA12345",
        "-----END RSA PRIVATE KEY-----",
      ].join("\n");
      const text = `key=${pem} github=github_pat_1234567890abcdef1234 google=AIzaSyA1234567890abcdef`;
      const redacted = redactSensitiveData(text);
      expect(redacted).not.toContain("MIIEowIBAAKCAQEA12345");
      expect(redacted).not.toContain("github_pat_1234567890abcdef1234");
      expect(redacted).not.toContain("AIzaSyA1234567890abcdef");
    });

    test("preserves __proto__ as an own enumerable property without mutating prototypes", () => {
      const payload = JSON.parse(
        '{"__proto__":{"apiKey":"sk-ant-1234567890abcdef","safe":"ok"},"normal":"val"}',
      ) as Record<string, unknown>;

      const redacted = redactSensitiveData(payload);
      expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
      expect(() => String(redacted)).not.toThrow();
      expect(Object.prototype.hasOwnProperty.call(redacted, "__proto__")).toBe(true);
      const protoProp = Object.getOwnPropertyDescriptor(redacted, "__proto__")?.value as Record<string, unknown>;
      expect(protoProp.apiKey).toBe("[REDACTED]");
      expect(protoProp.safe).toBe("ok");
      expect(({} as Record<string, unknown>).apiKey).toBeUndefined();

      const nullProto = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(nullProto, "__proto__", {
        value: { token: "secret-xyz" },
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const redactedNullProto = redactSensitiveData(nullProto);
      expect(Object.getPrototypeOf(redactedNullProto)).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(redactedNullProto, "__proto__")).toBe(true);
      const nullProtoProp = Object.getOwnPropertyDescriptor(redactedNullProto, "__proto__")?.value as Record<
        string,
        unknown
      >;
      expect(nullProtoProp.token).toBe("[REDACTED]");

      const err = new Error("boom");
      Object.defineProperty(err, "__proto__", {
        value: { token: "secret-abc" },
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const redactedErr = redactSensitiveData(err);
      expect(Object.getPrototypeOf(redactedErr)).toBe(Error.prototype);
      expect(Object.prototype.hasOwnProperty.call(redactedErr, "__proto__")).toBe(true);
      const errProto = Object.getOwnPropertyDescriptor(redactedErr, "__proto__")?.value as Record<string, unknown>;
      expect(errProto.token).toBe("[REDACTED]");
    });
  });

  describe("evaluateProtectedBranchGuard & assertBranchSafety", () => {
    const protectedBranches = ["main", "master", "stable"];

    test("blocks non-dry-run mutations on protected branches", () => {
      for (const branch of protectedBranches) {
        const decision = evaluateProtectedBranchGuard({
          branch,
          protectedBranches,
          dryRun: false,
        });
        expect(decision.allowed).toBe(false);
        expect(decision.isProtected).toBe(true);
        expect(decision.warning).toContain(branch);
        expect(() =>
          assertBranchSafety({ branch, protectedBranches, dryRun: false }),
        ).toThrow(ProtectedBranchError);
      }
    });

    test("allows dry-run preview on protected branches with a warning", () => {
      const decision = evaluateProtectedBranchGuard({
        branch: "main",
        protectedBranches,
        dryRun: true,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.isProtected).toBe(true);
      expect(decision.warning).toContain("--dry-run");
      expect(() =>
        assertBranchSafety({ branch: "main", protectedBranches, dryRun: true }),
      ).not.toThrow();
    });

    test("allows feature branches unconditionally", () => {
      const decision = evaluateProtectedBranchGuard({
        branch: "feat/cascade-looper-v2",
        protectedBranches,
        dryRun: false,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.isProtected).toBe(false);
      expect(decision.warning).toBeUndefined();
    });
  });
});
