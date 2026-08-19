import { describe, expect, it } from "vitest";
import { findMatchesInTextSegments } from "../../src/extensions/SearchHighlights";

describe("findMatchesInTextSegments", () => {
  it("returns every literal match with ProseMirror positions", () => {
    expect(findMatchesInTextSegments([{ text: "关键词 and 关键词", from: 4 }], "关键词")).toEqual([
      { from: 4, to: 7 },
      { from: 12, to: 15 },
    ]);
  });

  it("matches across adjacent text nodes split by marks", () => {
    expect(findMatchesInTextSegments([
      { text: "search ", from: 1 },
      { text: "target", from: 8 },
    ], "SEARCH TARGET")).toEqual([{ from: 1, to: 14 }]);
  });

  it("does not create a false match across block boundaries", () => {
    expect(findMatchesInTextSegments([
      { text: "foo", from: 1 },
      { text: "bar", from: 6 },
    ], "foobar")).toEqual([]);
  });

  it("ignores an empty query", () => {
    expect(findMatchesInTextSegments([{ text: "content", from: 1 }], "   ")).toEqual([]);
  });
});
