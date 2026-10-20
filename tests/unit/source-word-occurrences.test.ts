import { describe, expect, it } from "vitest";
import { findSourceWordMatches, sourceWordAt } from "../../src/lib/source-word-occurrences";

describe("源码全词匹配", () => {
  it("从光标位置取得完整标识符，包含下划线和数字", () => {
    const source = "foo foo_bar foo2\nbar";
    expect(sourceWordAt(source, 1)).toEqual({ from: 0, to: 3 });
    expect(sourceWordAt(source, 9)).toEqual({ from: 4, to: 11 });
    expect(sourceWordAt(source, 13)).toEqual({ from: 12, to: 16 });
    expect(sourceWordAt(source, source.length)).toBeNull();
  });

  it("按 grep -w 的边界规则查找，并返回行号与所在行", () => {
    const source = "foo foobar _foo foo_\n(foo)\nfoo";
    expect(findSourceWordMatches(source, "foo")).toEqual([
      { from: 0, to: 3, line: 1, text: "foo foobar _foo foo_" },
      { from: 22, to: 25, line: 2, text: "(foo)" },
      { from: 27, to: 30, line: 3, text: "foo" },
    ]);
  });
});
