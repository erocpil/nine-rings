import { describe, expect, it } from "vitest";
import {
  localMarkdownLink,
  relativeMarkdownHref,
} from "../../src/lib/local-files/markdown-links";
import { markdownAnchorOffsets } from "../../src/lib/local-files/markdown-link-anchors";
import {
  applyMarkdownLinkEdits,
  markdownLinkDestinations,
  planMarkdownLinkEdits,
} from "../../src/lib/local-files/markdown-link-repair";
import { semanticMarkdownSourceHref } from "../../src/lib/markdown-source-link";
import { LinkHistory } from "../../src/apps/file-workbench/link-navigation";

describe("local Markdown links", () => {
  it("resolves nested relative paths and keeps escaped delimiters in filenames", () => {
    expect(
      localMarkdownLink(
        "practice/education/lesson.md",
        "../../IELTS_Core_Library.md#51-教育education",
      ),
    ).toEqual({ node: "IELTS_Core_Library.md", fragment: "51-教育education" });
    expect(
      localMarkdownLink("notes/source.md", "./A%23B%3F.md#%E7%9B%AE%E6%A0%87"),
    ).toEqual({ node: "notes/A#B?.md", fragment: "目标" });
    expect(relativeMarkdownHref("topic/source.md", "other/A#B?.md")).toBe(
      "../other/A%23B%3F.md",
    );
  });
  it("uses the rendered URL for source escapes and entities", () => {
    expect(semanticMarkdownSourceHref(String.raw`A\(B\).md`)).toBe("A(B).md");
    expect(semanticMarkdownSourceHref("A&amp;B.md#教育")).toBe("A&B.md#教育");
  });
  it("rejects attempts to escape the authorized directory", () => {
    for (const href of [
      "../../../../target.md",
      "/root/target.md",
      "file:///target.md",
      "%2e%2e/%2e%2e/target.md",
      "%2foutside.md",
      "abc%5cdef.md",
      "bad%GG.md",
    ]) {
      expect(() => localMarkdownLink("lesson/guide.md", href)).toThrow();
    }
  });
  it("indexes duplicate, nested and explicit anchors from precise source positions", () => {
    const source =
      '# 教育\n\n# 教育\n\n> ## 学校\n\n<a id="study"></a>\n\n```\n# 不是标题\n```';
    const anchors = markdownAnchorOffsets(source);
    expect(anchors.get("教育")).toBe(0);
    expect(anchors.get("教育-1")).toBe(source.indexOf("# 教育", 1));
    expect(anchors.get("学校")).toBe(source.indexOf("## 学校"));
    expect(anchors.get("study")).toBe(source.indexOf("<a"));
    expect(anchors.has("不是标题")).toBe(false);
  });
  it("previews inbound links and rebases the moved document's outgoing paths", () => {
    const source =
      '[核心库](<lib/old.md#教育> "标题")\n\n[引用][ref]\n\n[ref]: lib/old.md\n\n`[示例](lib/old.md)`';
    const changes = planMarkdownLinkEdits(source, "guide.md", [
      { from: "lib/old.md", to: "library/new book.md" },
    ]);
    expect(changes).toHaveLength(2);
    expect(applyMarkdownLinkEdits(source, changes)).toBe(
      '[核心库](<library/new%20book.md#教育> "标题")\n\n[引用][ref]\n\n[ref]: library/new%20book.md\n\n`[示例](lib/old.md)`',
    );
    const moved = "[共用](../shared.md)";
    expect(
      applyMarkdownLinkEdits(
        moved,
        planMarkdownLinkEdits(moved, "deep/notes/lesson.md", [
          { from: "notes", to: "deep/notes" },
        ]),
      ),
    ).toBe("[共用](../../shared.md)");
    expect(
      markdownLinkDestinations("[失效](missing.md)\n\n[ref]: unused.md"),
    ).toHaveLength(1);
  });
  it("truncates a forward branch only after recording a successful new jump", () => {
    const history = new LinkHistory<string>();
    const same = (a: string, b: string) => a === b;
    history.record(
      { file: "source" },
      { file: "destination", fragment: "目标" },
      same,
    );
    expect(history.target(-1)?.file).toBe("source");
    history.commit(-1, undefined, same);
    expect(history.target(1)?.fragment).toBe("目标");
    history.record({ file: "source" }, { file: "other" }, same);
    expect(history.forward).toBe(false);
    expect(history.back).toBe(true);
  });
});
