import { expect, it } from "vitest";
import vectors from "../../schema/sync/fixtures/canonical-v1.json";
import cases from "../../schema/sync/fixtures/strict-json-v1.json";
import { parseSyncJson } from "../../src/lib/sync/strict-json";
import { canonicalJson } from "../../src/lib/sync/canonical-codec";

it.each(cases)("shared strict input: $source", ({ source, allowed }) => {
  if (allowed)
    expect(canonicalJson(parseSyncJson(source))).toBe(
      canonicalJson(JSON.parse(source)),
    );
  else expect(() => parseSyncJson(source)).toThrow("同步 JSON 无效");
});

it.each(vectors.vectors)(
  "strict parser preserves the frozen value: $name",
  ({ input, canonical }) => {
    expect(canonicalJson(parseSyncJson(JSON.stringify(input)))).toBe(canonical);
  },
);
it.each([
  '{"same":1,"same":2}',
  '{"a":1,"\\u0061":2}',
  '{"nested":{"same":1,"same":2}}',
  '[{"same":1,"same":2}]',
  "9007199254740993",
  "1e400",
  "-1e400",
  "1e16",
  "01",
  "-01",
  "1.",
  ".1",
  "+1",
  "[1,]",
  '{"a":1,}',
  "{a:1}",
  "true false",
  '"\\x00"',
  '"raw\nline"',
  '"unterminated',
  "\ufeff{}",
  "\v{}",
])("rejects ambiguous or malformed input without echoing it", (source) => {
  expect(() => parseSyncJson(source)).toThrow("同步 JSON 无效");
});
it("keeps null/absence, negative zero and decoded keys distinct without prototype assignment", () => {
  const result = parseSyncJson(
    ' {"__proto__":{"sentinel":1},"constructor":null,"negative":-0,"empty":[],"bool":false} ',
  ) as Record<string, unknown>;
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
  expect(result.constructor).toBeNull();
  expect(Object.is(result.negative, -0)).toBe(true);
  expect(result.empty).toEqual([]);
  expect(result.bool).toBe(false);
});
it("bounds recursive input and never includes private source in errors", () => {
  expect(() =>
    parseSyncJson("[".repeat(102) + "null" + "]".repeat(102)),
  ).toThrow("同步 JSON 无效");
  try {
    parseSyncJson('{"PRIVATE_TOKEN":false,"PRIVATE_TOKEN":true}');
  } catch (error) {
    expect((error as Error).message).not.toContain("PRIVATE");
  }
});
