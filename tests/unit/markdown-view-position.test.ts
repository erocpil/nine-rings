import { expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToProseMirror } from "../../src/lib/delta-converter";
import {
  sourcePositionMap,
  sourceOffsetToWeight,
  weightToSourceOffset,
  renderedPositionMap,
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
