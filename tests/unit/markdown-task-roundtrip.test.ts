import { describe, expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";

describe("Markdown task list round trips", () => {
  it("keeps empty task items and does not interpret markers in code blocks", () => {
    const source = "- [ ]\n- [x]\n\n```\n- [ ] literal\\[code\\]\n```";
    const delta = mdToDelta(source);
    expect(
      delta.ops
        .filter((op) => op.insert === "\n")
        .slice(0, 2)
        .map((op) => op.attributes?.taskChecked),
    ).toEqual([false, true]);
    const result = deltaToMarkdown(
      proseMirrorToDelta(deltaToProseMirror(delta)),
    );
    expect(result).toContain("- [ ]\n- [x]");
    expect(result).toContain("- [ ] literal\\[code\\]");
  });

  it("keeps escaped closing markers and link labels stable", () => {
    let source = String.raw`- [ ] *文字 \* 星号* 和 [\[标签\]](https://example.org/)`;
    const expected = mdToDelta(source);
    expect(expected.ops).toContainEqual({
      insert: "文字 * 星号",
      attributes: { italic: true },
    });
    expect(expected.ops).toContainEqual({
      insert: "[标签]",
      attributes: { link: "https://example.org/" },
    });
    for (let i = 0; i < 6; i++) {
      source = deltaToMarkdown(mdToDelta(source));
      expect(mdToDelta(source)).toEqual(expected);
    }
  });
  it("preserves task state, nesting and inline marks across repeated editor/source conversions", () => {
    let source =
      "- [ ] 待办 **重点**\n  - [x] 已完成\n- [X] 大写标记\n- 普通列表\n1. [ ] 有序任务";
    for (let i = 0; i < 6; i++) {
      const delta = proseMirrorToDelta(deltaToProseMirror(mdToDelta(source)));
      expect(
        delta.ops
          .filter((op) => op.insert === "\n")
          .map((op) => op.attributes?.taskChecked),
      ).toEqual([false, true, true, undefined, false]);
      source = deltaToMarkdown(delta);
      expect(source).toBe(
        "- [ ] 待办 **重点**\n  - [x] 已完成\n- [x] 大写标记\n- 普通列表\n1. [ ] 有序任务",
      );
    }
  });

  it("decodes escapes once but leaves code and non-punctuation backslashes untouched", () => {
    const source =
      String.raw`普通 \[文字\] \*星号\* C:\notes 和 ` + "`\\[code\\]`";
    const initial = mdToDelta(source);
    expect(initial.ops[0].insert).toBe("普通 [文字] *星号* C:\\notes 和 ");
    expect(initial.ops[1]).toEqual({
      insert: "\\[code\\]",
      attributes: { code: true },
    });
    let delta = initial;
    for (let i = 0; i < 6; i++) delta = mdToDelta(deltaToMarkdown(delta));
    expect(delta).toEqual(initial);
  });

  it("keeps escaped task markers literal and preserves escapes inside emphasis", () => {
    let source = String.raw`- \[ \] 不是任务 **\[重点\]**`;
    for (let i = 0; i < 6; i++) {
      const delta = mdToDelta(source);
      expect(delta.ops.at(-1)?.attributes?.taskChecked).toBeUndefined();
      expect(delta.ops[0].insert).toBe("[ ] 不是任务 ");
      expect(delta.ops[1]).toEqual({
        insert: "[重点]",
        attributes: { bold: true },
      });
      source = deltaToMarkdown(delta);
    }
  });
});
