import { expect, it } from "vitest";
import { mergeDocumentMetadata } from "../../src/lib/document-metadata";

it("presentation changes retain current bookmarks and do not resurrect invalidated original Markdown", () => {
  const base = { markdownSource: "original", author: "A" };
  const latest = {
    author: "A",
    bookmarks: [{ id: "b", title: "bookmark", position: 1 }],
  };
  expect(
    mergeDocumentMetadata(
      base,
      { ...base, presentationMode: "flow", flowHeadingLevel: 2 },
      latest,
    ),
  ).toEqual({ ...latest, presentationMode: "flow", flowHeadingLevel: 2 });
  expect(base.markdownSource).toBe("original");
});
it("explicit edits and removals are applied without replacing unrelated live metadata", () => {
  expect(
    mergeDocumentMetadata(
      { presentationMode: "flow", author: "A" },
      { author: "B" },
      { presentationMode: "flow", author: "A", version: "2" },
    ),
  ).toEqual({ author: "B", version: "2" });
});
