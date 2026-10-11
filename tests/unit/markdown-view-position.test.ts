import { expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToProseMirror } from "../../src/lib/delta-converter";
import {
  sourcePositionMap,
  sourceOffsetToWeight,
  weightToSourceOffset,
  renderedPositionMap,
  renderedTextblockMap,
} from "../../src/lib/markdown-view-position";

it("maps duplicate text by document order across lists, quotes, fences and CRLF", () => {
  const source =
    "# 标题\r\n\r\n重复\r\n\r\n- [ ] 重复\r\n  - 子项\r\n\r\n> 引用\r\n\r\n````js\r\na\r\n```\r\n````\r\n\r\n重复";
  const sourceMap = sourcePositionMap(source);
  const rendered = renderedPositionMap(deltaToProseMirror(mdToDelta(source)));
  expect(sourceMap.at(-1)?.weightTo).toBe(rendered.at(-1)?.to);
  const offset = source.lastIndexOf("重复");
  const weight = sourceOffsetToWeight(source, offset);
  expect(weightToSourceOffset(source, weight)).toBe(offset);
  expect(
    sourceMap.find((item) =>
      source.slice(item.from, item.to).startsWith("````"),
    ),
  ).toBeDefined();
});

it("indexes nested list and quote paragraphs independently without losing document order", () => {
  const source =
    "- 短\n  - 较长的子列表正文\n- 最后一项\n\n> 引用首段\n>\n> 引用末段";
  const doc = deltaToProseMirror(mdToDelta(source));
  const blocks = renderedTextblockMap(doc);
  expect(blocks.length).toBeGreaterThan(renderedPositionMap(doc).length);
  expect(blocks.at(-1)?.to).toBe(renderedPositionMap(doc).at(-1)?.to);
  for (const label of ["短", "较长的子列表正文", "最后一项", "引用末段"]) {
    const weight = sourceOffsetToWeight(source, source.indexOf(label));
    const block = blocks.find((entry) => entry.to > weight)!;
    expect(block.textblock).not.toBeNull();
    expect(block.position).toBeGreaterThanOrEqual(1);
  }
  const map = sourcePositionMap(source);
  expect(sourceOffsetToWeight(source, 8, map)).toBe(
    sourceOffsetToWeight(source, 8),
  );
  expect(weightToSourceOffset(source, 8, map)).toBe(
    weightToSourceOffset(source, 8),
  );
});
it("handles table embeds, blank text and empty documents without NaN", () => {
  for (const source of [
    "",
    "\n\n",
    "| A | B |\n| --- | --- |\n| **C** | D |\n\n尾部",
  ]) {
    const sourceMap = sourcePositionMap(source);
    const rendered = renderedPositionMap(deltaToProseMirror(mdToDelta(source)));
    expect(sourceMap.at(-1)?.weightTo ?? 0).toBe(rendered.at(-1)?.to ?? 0);
    expect(Number.isFinite(sourceOffsetToWeight(source, 1000))).toBe(true);
    expect(Number.isFinite(weightToSourceOffset(source, 1000))).toBe(true);
  }
});

it("maps caret blocks independently from a viewport at the document start, including a toc fence", async () => {
  const { sourceOffsetToRenderedPosition, renderedPositionToWeight } =
    await import("../../src/lib/markdown-view-position");
  const source =
    "# 开始\n\n```toc\nlevels: 1,2,3\n```\n\n## 中间\n\n普通正文\n\n### 远处标题\n\n结束";
  const doc = deltaToProseMirror(mdToDelta(source));
  const position = sourceOffsetToRenderedPosition(
    source,
    doc,
    source.indexOf("### 远处标题"),
  );
  const block = renderedTextblockMap(doc).find(
    (entry) => entry.text === "远处标题",
  )!;
  expect(position).toBe(block.position + 1);
  expect(renderedPositionToWeight(doc, position)).toBe(block.from);
});

it("the full Markdown demo retains the image-section caret after all preceding GFM extensions", async () => {
  const { default: source } =
    await import("../../src/lib/markdown-demo.md?raw");
  const { sourceOffsetToRenderedPosition } =
    await import("../../src/lib/markdown-view-position");
  const doc = deltaToProseMirror(mdToDelta(source));
  const offset = source.indexOf("### 图片与替代文本");
  const target = renderedTextblockMap(doc).find(
    (block) => block.text === "图片与替代文本",
  )!;
  expect(sourceOffsetToRenderedPosition(source, doc, offset)).toBe(
    target.position + 1,
  );
});
