import { expect, it } from "vitest";
import {
  canonicalChildPath,
  parseDraftPath,
  protectedPathsOverlap,
} from "../../src/lib/local-files/workbench-path-protection";
it("compares canonical paths with component boundaries and conservative case folding", () => {
  expect(protectedPathsOverlap("/root/src", "/root/src/a.c")).toBe(true);
  expect(protectedPathsOverlap("/root/SRC/a.c", "/root/src")).toBe(true);
  expect(protectedPathsOverlap("/root/src", "/root/src-other")).toBe(false);
  expect(protectedPathsOverlap("C:\\root\\a.c", "c:/ROOT")).toBe(true);
  expect(protectedPathsOverlap("/", "/root/a.c")).toBe(true);
  expect(canonicalChildPath("/root/", "src/a.c")).toBe("/root/src/a.c");
  expect(canonicalChildPath("C:\\root", "src/a.c")).toBe("C:\\root/src/a.c");
  expect(canonicalChildPath("\\\\server\\share", "src/a.c")).toBe(
    "\\\\server\\share/src/a.c",
  );
  expect(() => canonicalChildPath("relative", "a.c")).toThrow();
  expect(() => canonicalChildPath("/root", "../a.c")).toThrow();
});
it("rejects ambiguous legacy draft identities rather than silently ignoring them", () => {
  expect(parseDraftPath("uuid:src/a.c")).toEqual({
    rootId: "uuid",
    node: "src/a.c",
  });
  for (const identity of [
    "",
    "no-root",
    ":a",
    "root:",
    "root:../a",
    "root:/a",
    "root:a:b",
  ])
    expect(() => parseDraftPath(identity)).toThrow();
});
