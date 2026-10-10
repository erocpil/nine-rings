import { expect, it } from "vitest";
import { compareDocumentMetadata } from "../../src/lib/storage/core";
it("document metadata sorts by descending revision time and stable ID without touching bodies", () => {
  const notes = [
    {
      id: "b",
      updated_at: "2026-10-11T10:00:00Z",
      get content(): never {
        throw new Error("body read");
      },
    },
    { id: "a", updated_at: "2026-10-11T10:00:00Z" },
    { id: "old", updated_at: "2026-10-10T10:00:00Z" },
    { id: "new", updated_at: "2026-10-12T10:00:00Z" },
  ];
  expect(
    [...notes].sort(compareDocumentMetadata).map((note) => note.id),
  ).toEqual(["new", "a", "b", "old"]);
  expect(
    [...notes]
      .reverse()
      .sort(compareDocumentMetadata)
      .map((note) => note.id),
  ).toEqual(["new", "a", "b", "old"]);
});
