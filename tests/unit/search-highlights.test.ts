import { describe, expect, it } from "vitest";
import {
  findMatchesInTextSegments,
  searchMatchIndexFromPosition,
} from "../../src/extensions/SearchHighlights";

describe("findMatchesInTextSegments", () => {
  it("returns every literal match with ProseMirror positions", () => {
    expect(
      findMatchesInTextSegments(
        [{ text: "关键词 and 关键词", from: 4 }],
        "关键词",
      ),
    ).toEqual([
      { from: 4, to: 7 },
      { from: 12, to: 15 },
    ]);
  });

  it("matches across adjacent text nodes split by marks", () => {
    expect(
      findMatchesInTextSegments(
        [
          { text: "search ", from: 1 },
          { text: "target", from: 8 },
        ],
        "SEARCH TARGET",
      ),
    ).toEqual([{ from: 1, to: 14 }]);
  });

  it("does not create a false match across block boundaries", () => {
    expect(
      findMatchesInTextSegments(
        [
          { text: "foo", from: 1 },
          { text: "bar", from: 6 },
        ],
        "foobar",
      ),
    ).toEqual([]);
  });

  it("ignores an empty query", () => {
    expect(
      findMatchesInTextSegments([{ text: "content", from: 1 }], "   "),
    ).toEqual([]);
  });
});

describe("searchMatchIndexFromPosition", () => {
  const matches = [
    { from: 3, to: 7 },
    { from: 13, to: 17 },
    { from: 23, to: 27 },
  ];

  it("starts next navigation at the first match after the caret and wraps", () => {
    expect(searchMatchIndexFromPosition(matches, 10, 1)).toBe(1);
    expect(searchMatchIndexFromPosition(matches, 30, 1)).toBe(0);
  });

  it("starts previous navigation at the first match before the caret and wraps", () => {
    expect(searchMatchIndexFromPosition(matches, 20, -1)).toBe(1);
    expect(searchMatchIndexFromPosition(matches, 1, -1)).toBe(2);
  });
});
