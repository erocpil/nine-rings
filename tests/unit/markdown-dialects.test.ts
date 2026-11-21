import { expect, test } from "vitest";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { renderedNodeText } from "../../src/lib/markdown-view-position";

test("Typora table of contents shorthand only matches an unescaped standalone line", () => {
  const source = "[TOC]\n\n## Heading\n\n\\[toc] and `[toc]`";
  const model = deltaToProseMirror(mdToDelta(source));
  expect(model.content?.[0]).toMatchObject({
    type: "codeBlock",
    attrs: { language: "toc", meta: "[TOC]" },
  });
  expect(deltaToMarkdown(proseMirrorToDelta(model))).toBe(source);
  model.content![0].content = [{ type: "text", text: "levels: 2,3" }];
  expect(deltaToMarkdown(proseMirrorToDelta(model))).toMatch(
    /^\x60{3}toc\nlevels: 2,3/,
  );
});

test("Obsidian callouts keep title, type and initial fold across rendered edits", () => {
  const source =
    "> [!question]- 自定义 **标题**\n> 第一段。\n>\n> > [!tip]+\n> > 第二段。";
  const model = deltaToProseMirror(mdToDelta(source));
  const quote = model.content?.[0];
  expect(quote?.attrs).toMatchObject({
    alert: "NOTE",
    collapsed: true,
    callout: { type: "question", title: "自定义 **标题**", fold: "-" },
  });
  expect(renderedNodeText(model)).toBe("第一段。第二段。");
  expect(quote?.content?.[1].attrs?.callout).toEqual({
    type: "tip",
    title: "",
    fold: "+",
  });
  quote!.attrs!.collapsed = false;
  const markdown = deltaToMarkdown(proseMirrorToDelta(model));
  expect(markdown).toContain("> [!question]- 自定义 **标题**");
  expect(
    deltaToProseMirror(mdToDelta(markdown)).content?.[0].attrs?.collapsed,
  ).toBe(true);
});
