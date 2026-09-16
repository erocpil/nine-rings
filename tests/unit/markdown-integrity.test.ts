import { describe, expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";

const canonical = (source: string) =>
  proseMirrorToDelta(deltaToProseMirror(mdToDelta(source)));
describe("Markdown integrity", () => {
  it("keeps literal block prefixes and strike marks through serialization", () => {
    for (const text of [
      "# literal",
      "> literal",
      ">",
      ">literal",
      "- literal",
      "+ literal",
      "1. literal",
      "---",
      "`literal`",
      "~~literal~~",
    ]) {
      const delta = { ops: [{ insert: text }, { insert: "\n" }] };
      expect(mdToDelta(deltaToMarkdown(delta))).toEqual({
        ops: [{ insert: text }, { insert: "\n" }],
      });
    }
    const strike = {
      ops: [{ insert: "删除", attributes: { strike: true } }, { insert: "\n" }],
    };
    expect(mdToDelta(deltaToMarkdown(strike))).toEqual(strike);
  });
  for (const source of [
    "- 外层\n  3. 内层\n  4. 继续\n- 末项",
    "> 引用 **重点**\n> 第二段",
    "| 名称 | 值 |\n| :--- | ---: |\n| a\\|b | **重点** |",
    "````md\n```js\ncode\n```\n````",
    "~~~js\nconst a = 1;\n~~~",
    "```\n```",
    "代码 ``a`b`` 与 `` `边界` ``",
    String.raw`[\[链接\]](https://example.org/) 和 **\[强调\]**`,
  ])
    it(`round trips ${source.slice(0, 30)}`, () => {
      const expected = canonical(source);
      let current = expected;
      for (let index = 0; index < 8; index++) {
        current = canonical(deltaToMarkdown(current));
        expect(current).toEqual(expected);
      }
    });
  it("retains embedded fences and inline backticks as code", () => {
    expect(mdToDelta("````md\n```js\ncode\n```\n````").ops[0].insert).toBe(
      "```js\ncode\n```",
    );
    expect(mdToDelta("``a`b``").ops[0]).toEqual({
      insert: "a`b",
      attributes: { code: true },
    });
  });
});
