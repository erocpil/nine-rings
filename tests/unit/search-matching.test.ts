import { beforeAll, describe, expect, it } from "vitest";
import {
  findTextMatches,
  initializeSearchRegex,
  searchPatternError,
  searchReplacement,
} from "../../src/lib/search-matching";
import { findMatchesInTextSegments } from "../../src/extensions/SearchHighlights";
import { snippetParts } from "../../src/lib/storage/idb-snippet";
import { NoteSearchIndex } from "../../src/lib/search-index-core";

beforeAll(() => initializeSearchRegex());
describe("Perl-compatible search", () => {
  it("keeps UTF-16 positions and Unicode whole-word boundaries", () => {
    expect(
      findTextMatches("password WORD word word_ word2 中文", "word", {
        wholeWord: true,
      }),
    ).toEqual([
      { from: 9, to: 13 },
      { from: 14, to: 18 },
    ]);
    const matches = findTextMatches("😀 foo123 中文", String.raw`foo\K\d+`, {
      regex: true,
    });
    expect(matches.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 6, to: 9 },
    ]);
    expect(findTextMatches("中文 中文字", "中文", { wholeWord: true })).toEqual(
      [{ from: 0, to: 2 }],
    );
  });
  it("supports Perl inline flags, quoting, branch reset and lookbehind", () => {
    expect(
      findTextMatches("FOO foo", "(?i)foo", {
        regex: true,
        caseSensitive: true,
      }),
    ).toHaveLength(2);
    expect(
      findTextMatches("a.* a123", String.raw`\Qa.*\E`, { regex: true })[0]
        .captures?.[0],
    ).toBe("a.*");
    expect(
      findTextMatches("a1 b2", String.raw`(?|a(\d)|b(\d))`, {
        regex: true,
      }).map((match) => match.captures?.[1]),
    ).toEqual(["1", "2"]);
    expect(
      findTextMatches("foo bar", "(?<=foo )bar", { regex: true }),
    ).toHaveLength(1);
  });
  it("handles anchors, empty assertions, malformed patterns and backtracking limits", () => {
    expect(
      findTextMatches("foo\nbar\nfoo", "^foo$", { regex: true }),
    ).toHaveLength(2);
    expect(findTextMatches("😀a", "^|$", { regex: true })).toEqual([]);
    expect(findTextMatches("a", "|a", { regex: true })).toHaveLength(1);
    expect(searchPatternError("[", { regex: true })).toContain("无效");
    expect(findTextMatches("x", "[", { regex: true })).toEqual([]);
    expect(() =>
      findTextMatches("a".repeat(40) + "!", "^(a+)+$", { regex: true }),
    ).toThrow();
  });
  it("preserves marked runs and does not match across structural boundaries", () => {
    expect(
      findMatchesInTextSegments(
        [
          { from: 1, text: "foo" },
          { from: 4, text: "123" },
        ],
        String.raw`foo\K\d+`,
        false,
        false,
        { regex: true },
      )[0].from,
    ).toBe(4);
    expect(
      findMatchesInTextSegments(
        [
          { from: 1, text: "foo" },
          { from: 6, text: "bar" },
        ],
        "foo.*bar",
        false,
        false,
        { regex: true },
      ),
    ).toEqual([]);
  });
  it("expands numbered and named captures only in regex mode", () => {
    const match = findTextMatches("item42", String.raw`(?<name>item)(\d+)`, {
      regex: true,
    })[0];
    expect(searchReplacement("${name}-$2-$&-$$", match, { regex: true })).toBe(
      "item-42-item42-$",
    );
    expect(searchReplacement("$1", match)).toBe("$1");
  });
  it("does not reinterpret line anchors or lookbehind in cropped excerpts", () => {
    const text = "x".repeat(100) + "\nfoo123\n";
    expect(
      snippetParts(text, String.raw`^foo\K\d+$`, { regex: true })
        .filter((part) => part.match)
        .map((part) => part.text),
    ).toEqual(["123"]);
  });
  it("uses case and word options in the global index while keeping default AND search", () => {
    const index = new NoteSearchIndex();
    const base = {
      date: "2026-10-08",
      created_at: "2026-10-08",
      updated_at: "2026-10-08",
      tags: [],
      storagePath: "ideas/test",
      title: "测试",
      deleted_at: null,
      pinned: false,
    };
    index.rebuild([
      { ...base, id: "1", search_text: "WORD and foo123" },
      { ...base, id: "2", search_text: "password and foo456" },
    ] as Parameters<NoteSearchIndex["rebuild"]>[0]);
    expect(index.search("word foo").map((note) => note.id)).toEqual(["1", "2"]);
    expect(
      index.search("word", { wholeWord: true }).map((note) => note.id),
    ).toEqual(["1"]);
    expect(
      index.search("word", { caseSensitive: true }).map((note) => note.id),
    ).toEqual(["2"]);
    const results = index.search(String.raw`foo\K123`, { regex: true });
    expect(results.map((note) => note.id)).toEqual(["1"]);
    expect(
      results[0].search_parts
        ?.filter((part) => part.match)
        .map((part) => part.text),
    ).toEqual(["123"]);
  });
});
