import { expect, it } from "vitest";
import { vocabularyTree } from "../../src/lib/vocabulary-tree";
const word = (id: string, storagePath: string) => ({
  id,
  title: id,
  storagePath,
  created_at: "2026-10-15",
  updated_at: "2026-10-15",
});
it("groups nested vocabulary paths without losing provider ordering", () => {
  const root = "references/vocabulary";
  const tree = vocabularyTree(
    [
      word("z", `${root}/awl`),
      word("a", `${root}/awl`),
      word("deep", `${root}/awl/unit1`),
      word("root", root),
      word("excluded", `${root}-other`),
    ],
    root,
  );
  expect(tree.documents.map((n) => n.id)).toEqual(["root"]);
  expect(tree.folders.map((n) => n.name)).toEqual(["awl"]);
  expect(tree.folders[0].documents.map((n) => n.id)).toEqual(["z", "a"]);
  expect(tree.folders[0].folders[0].documents[0].id).toBe("deep");
});
it("root-wide search retains full ancestry and omits empty unrelated folders", () => {
  const root = "references/vocabulary";
  const tree = vocabularyTree(
    [
      word("Match", `${root}/awl/unit1`),
      word("Match", `${root}/other`),
      word("hide", `${root}/empty`),
    ],
    root,
    " match ",
  );
  expect(tree.folders.map((n) => n.name)).toEqual(["awl", "other"]);
  expect(tree.folders[0].folders[0].path).toBe(`${root}/awl/unit1`);
});
