import { describe, expect, test } from "bun:test";
import { GUARDRAIL_CONSTANTS } from "../../../src/config/constants";
import { redactSensitiveData } from "../../../src/config/guardrails";

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD";

describe("Tier 5: redaction bombs", () => {
  test("a 20k-level nested payload is capped at maxDepth without stack overflow", () => {
    let bomb: Record<string, unknown> = { leaf: TOKEN };
    for (let depth = 0; depth < 20_000; depth++) bomb = { next: bomb };
    const redacted = JSON.stringify(redactSensitiveData(bomb));
    expect(redacted).toContain(GUARDRAIL_CONSTANTS.MAX_DEPTH_MARKER);
    expect(redacted).not.toContain(TOKEN);
  });

  test("cycles across arrays, maps, sets and error causes are broken without leaking secrets", () => {
    const root: Record<string, unknown> = { password: "hunter2" };
    const list: unknown[] = [root];
    const map = new Map<string, unknown>([["self", map0()], ["list", list]]);
    function map0(): unknown {
      return root;
    }
    const set = new Set<unknown>([root, list]);
    const error = new Error(`request failed with token ${TOKEN}`);
    Object.assign(error, { cause: root });
    root.list = list;
    root.map = map;
    root.set = set;
    root.error = error;
    list.push(list);
    const redacted = redactSensitiveData(root);
    const serialized = JSON.stringify(redacted, (_key, value: unknown) => {
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return [...value];
      if (value instanceof Error) return { message: value.message };
      return value;
    });
    expect(serialized).toContain(GUARDRAIL_CONSTANTS.CIRCULAR_REF_MARKER);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain(TOKEN);
    expect(redacted).toBeInstanceOf(Object);
  });

  test("__proto__ keys do not pollute prototypes and a 100k-element token array is fully redacted", () => {
    const polluted = JSON.parse(`{"__proto__": {"polluted": true}, "api_key": "${TOKEN}"}`) as Record<string, unknown>;
    const redacted = redactSensitiveData(polluted) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
    expect(redacted.api_key).toBe(GUARDRAIL_CONSTANTS.REDACTED_VALUE);
    const tokens = Array.from({ length: 100_000 }, (_, index) => `Bearer ${TOKEN}${index}`);
    const output = redactSensitiveData(tokens);
    expect(output).toHaveLength(tokens.length);
    expect(output.some((value) => value.includes(TOKEN))).toBe(false);
  });

  test("URL credentials and PEM blocks embedded in log strings are scrubbed", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    const redacted = redactSensitiveData({ message: `clone https://user:s3cr3t@example.invalid/repo.git then ${pem}` });
    expect(redacted.message).not.toContain("s3cr3t");
    expect(redacted.message).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
  });
});
