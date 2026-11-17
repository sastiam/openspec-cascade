import { describe, expect, test } from "bun:test";
import { stripJsonc } from "../../src/manifest/jsonc";

describe("stripJsonc", () => {
  test("removes line and block comments", () => {
    const text = '{\n  // line\n  "a": 1, /* block */ "b": 2\n}';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 1, b: 2 });
  });

  test("keeps comment markers inside strings", () => {
    const text = '{"url": "https://example.com/mcp", "glob": "/* x */"}';
    expect(JSON.parse(stripJsonc(text))).toEqual({ url: "https://example.com/mcp", glob: "/* x */" });
  });

  test("keeps escaped quotes inside strings", () => {
    const text = '{"a": "say \\"// hi\\""} // tail';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 'say "// hi"' });
  });

  test("drops trailing commas before } and ]", () => {
    const text = '{"a": [1, 2,], "b": {"c": 3,\n // note\n},}';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  test("keeps commas inside strings", () => {
    expect(JSON.parse(stripJsonc('{"a": "x,]"}'))).toEqual({ a: "x,]" });
  });
});
