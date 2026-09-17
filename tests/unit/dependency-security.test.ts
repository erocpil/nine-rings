import { createRequire } from "node:module";
import { expect, test } from "vitest";

// Exercise the resolved transitive dependency, not just its version string.
const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  load(source: string, options: { maxTotalMergeKeys: number }): unknown;
};
const emptyMerges =
  "empty: &empty {}\nvalue:\n  <<: [*empty, *empty, *empty]\n";

test("YAML merge budget counts empty sources (GHSA-2883-xcg3-v3hh)", () => {
  expect(() => yaml.load(emptyMerges, { maxTotalMergeKeys: 2 })).toThrow(
    /maxTotalMergeKeys/,
  );
});

test("YAML merges within the budget remain valid", () => {
  expect(yaml.load(emptyMerges, { maxTotalMergeKeys: 3 })).toEqual({
    empty: {},
    value: {},
  });
  expect(
    yaml.load("base: &base {name: safe}\nvalue: {<<: *base}\n", {
      maxTotalMergeKeys: 3,
    }),
  ).toEqual({ base: { name: "safe" }, value: { name: "safe" } });
});
