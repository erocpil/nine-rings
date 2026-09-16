import { describe, expect, it } from "vitest";
import { resolveFolderRename } from "../../src/lib/folder-rename";

describe("folder rename", () => {
  it("only replaces the leaf, trimming surrounding whitespace", () => {
    expect(resolveFolderRename("projects/old", " 新名称 ")).toBe("projects/新名称");
    expect(resolveFolderRename("projects", "new-root")).toBe("new-root");
  });
  it("rejects paths and invalid or reserved names", () => {
    for (const name of ["", " ", ".", "..", "a/b", "a\\b", "bad\u0000", "a".repeat(129)]) {
      expect(() => resolveFolderRename("projects/old", name)).toThrow();
    }
    expect(() => resolveFolderRename("projects", "daily")).toThrow();
    expect(() => resolveFolderRename("daily/2026-09-16", "name")).toThrow();
  });
});
