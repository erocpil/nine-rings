import { describe, expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";

describe("Markdown continuous plain-text runs", () => {
  it("preserves long Unicode text, tabs and interior spaces", () => {
    const text = "中文 😀 é  English\t内容。".repeat(10000);
    expect(mdToDelta(text).ops).toEqual([{ insert: text }, { insert: "\n" }]);
  });

  it("stops at every supported inline marker", () => {
    expect(
      mdToDelta(
        "前文 **粗体** 中间 *斜体* 和 `code` [链接](https://example.com) 后文",
      ).ops,
    ).toEqual([
      { insert: "前文 " },
      { insert: "粗体", attributes: { bold: true } },
      { insert: " 中间 " },
      { insert: "斜体", attributes: { italic: true } },
      { insert: " 和 " },
      { insert: "code", attributes: { code: true } },
      { insert: " " },
      { insert: "链接", attributes: { link: "https://example.com" } },
      { insert: " 后文" },
      { insert: "\n" },
    ]);
  });

  it("keeps incomplete markers literal and still recognizes later images", () => {
    expect(
      mdToDelta("前 ! [broken] *unclosed `literal ![图片](image.png) 后").ops,
    ).toEqual([
      { insert: "前 ! [broken] *unclosed `literal " },
      { insert: { image: "image.png" } },
      { insert: " 后" },
      { insert: "\n" },
    ]);
  });
});
