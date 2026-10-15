import { describe, expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import { markdownAST } from "../../src/lib/gfm-parser";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { deltaToProseMirror, proseMirrorToDelta } from "../../src/lib/delta-converter";

export const sample = "中文解释：Reference Ladder 由**长期保留的基线层级（persistent tiers）**和**层级之间的有效归因关系（attribution structure）**构成。它的核心是相同条件下的 *feature isolation*，但并非所有层级天然可比；若添加功能的同时改变协议分布、IP 范围或报文长度，就产生了混杂变量（confounders）。";
const bold = ["长期保留的基线层级（persistent tiers）", "层级之间的有效归因关系（attribution structure）"];
function check(source: string) {
  const delta = mdToDelta(source);
  expect(delta.ops.filter(op => op.attributes?.bold).map(op => op.insert)).toEqual(bold);
  expect(delta.ops.filter(op => op.attributes?.italic).map(op => op.insert)).toEqual(["feature isolation"]);
  expect(delta.ops.map(op => op.insert).join("")).not.toContain("*");
  return delta;
}
describe("CJK emphasis boundaries", () => {
  it("keeps the connecting Han text outside bold and consumes all emphasis markers", () => {
    const delta = check(sample);
    const saved = proseMirrorToDelta(deltaToProseMirror(delta));
    check(deltaToMarkdown(saved));
  });
  it.each([
    ["中**（重点）**文", "（重点）", "bold"],
    ["中*（重点）*文", "（重点）", "italic"],
    ["中***（重点）***文", "（重点）", "bold"],
    ["**中文。**后续", "中文。", "bold"],
  ])("supports punctuation bordering Han: %s", (source, text, mark) => {
    expect(mdToDelta(source).ops.some(op => op.insert === text && op.attributes?.[mark])).toBe(true);
  });
  it("preserves escapes, code, links, Latin intraword rules and unpaired markers", () => {
    for (const source of ["a**b)**c", "foo_bar_baz", "中文**未结束", "\\*feature isolation\\*"]) {
      expect(mdToDelta(source).ops.some(op => op.attributes?.bold || op.attributes?.italic)).toBe(false);
    }
    const code = mdToDelta("`中**（重点）**文`");
    expect(code.ops[0]).toEqual({ insert: "中**（重点）**文", attributes: { code: true } });
    const fenced = mdToDelta("```text\n中**（重点）**文\n```");
    expect(fenced.ops.some(op => op.attributes?.bold)).toBe(false);
    expect(mdToDelta("[链接](https://example.com/a**b**)").ops[0].attributes?.link).toBe("https://example.com/a**b**");
  });
  it("keeps original source offsets in the AST", () => {
    const root = markdownAST(sample);
    const paragraph = root.children[0];
    if (paragraph.type !== "paragraph") throw new Error("missing paragraph");
    const strong = paragraph.children.filter(node => node.type === "strong");
    expect(strong.map(node => sample.slice(node.position!.start.offset, node.position!.end.offset))).toEqual(bold.map(text => `**${text}**`));
  });
});
