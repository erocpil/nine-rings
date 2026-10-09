import { describe, expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToProseMirror } from "../../src/lib/delta-converter";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";

const source =
  "GFM 扩展自动链接：https://github.github.com/gfm/、www.github.com，以及 demo@example.com。";
describe("Chinese bare autolink boundaries", () => {
  it("separates all three links while retaining every separator and Chinese word", () => {
    const content = mdToDelta(source);
    expect(
      content.ops
        .filter((op) => op.attributes?.link)
        .map((op) => op.attributes!.link),
    ).toEqual([
      "https://github.github.com/gfm/",
      "http://www.github.com",
      "mailto:demo@example.com",
    ]);
    expect(content.ops.map((op) => op.insert).join("")).toBe(source + "\n");
    const again = mdToDelta(deltaToMarkdown(content));
    expect(
      again.ops
        .filter((op) => op.attributes?.link)
        .map((op) => op.attributes!.link),
    ).toEqual([
      "https://github.github.com/gfm/",
      "http://www.github.com",
      "mailto:demo@example.com",
    ]);
  });
  it("preserves explicit destinations with Chinese paths and escaped punctuation", () => {
    const content = mdToDelta(
      "[说明](https://example.com/中文、路径) <https://example.com/中文>",
    );
    expect(
      content.ops
        .filter((op) => op.attributes?.link)
        .map((op) => op.attributes!.link),
    ).toEqual(["https://example.com/中文、路径", "https://example.com/中文"]);
    const doc = deltaToProseMirror(content);
    expect(
      doc.content![0].content!.flatMap(
        (child) =>
          child.marks
            ?.filter((mark) => mark.type === "link")
            .map((mark) => mark.attrs!.href) ?? [],
      ),
    ).toEqual(["https://example.com/中文、路径", "https://example.com/中文"]);
  });
  it("repairs previously persisted self-labelled merged links when hydrating", () => {
    const text = "https://github.github.com/gfm/、www.github.com，以及";
    const doc = deltaToProseMirror({
      ops: [
        { insert: text, attributes: { link: text, bold: true } },
        { insert: "\n" },
      ],
    });
    const children = doc.content![0].content!;
    expect(children.map((child) => child.text).join("")).toBe(text);
    expect(
      children.flatMap(
        (child) =>
          child.marks
            ?.filter((mark) => mark.type === "link")
            .map((mark) => mark.attrs!.href) ?? [],
      ),
    ).toEqual(["https://github.github.com/gfm/", "http://www.github.com"]);
    expect(
      children.every((child) =>
        child.marks?.some((mark) => mark.type === "bold"),
      ),
    ).toBe(true);
  });
});
