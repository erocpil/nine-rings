import { describe, expect, it } from "vitest";
import { codeIndentChanges } from "../../src/lib/code-indent";

function apply(text: string, from: number, to: number, outdent = false) {
  for (const change of codeIndentChanges(text, from, to, outdent).reverse()) {
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  }
  return text;
}

describe("code indentation", () => {
  it("inserts at a collapsed caret without replacing adjacent text", () => {
    expect(apply("ab", 1, 1)).toBe("a\tb");
    expect(apply("", 0, 0)).toBe("\t");
  });
  it("indents complete selected lines but excludes a trailing line boundary", () => {
    expect(apply("one\ntwo\nthree", 1, 8)).toBe("\tone\n\ttwo\nthree");
    expect(apply("\none", 0, 1)).toBe("\t\none");
  });
  it("removes one indentation level and leaves unindented lines intact", () => {
    expect(apply("\tone\n    two\nthree", 0, 18, true)).toBe("one\ntwo\nthree");
    expect(apply("  one", 3, 3, true)).toBe("one");
    expect(apply("one", 0, 0, true)).toBe("one");
  });
});
