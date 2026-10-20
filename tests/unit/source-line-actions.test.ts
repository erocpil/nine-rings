import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import {
  sourceLineChange,
  sourceLineRange,
  type SourceLineAction,
} from "../../src/lib/source-line-actions";

function apply(doc: string, line: number, action: SourceLineAction, text = "") {
  const state = EditorState.create({ doc });
  const spec = sourceLineChange(state, line, action, text);
  return spec ? state.update(spec).state.doc.toString() : doc;
}

describe("源码行菜单编辑边界", () => {
  it("删除首行、末行和唯一一行，不合并相邻行或遗留多余空行", () => {
    expect(apply("a\nb\nc", 1, "delete")).toBe("b\nc");
    expect(apply("a\nb\nc", 2, "delete")).toBe("a\nc");
    expect(apply("a\nb\nc", 3, "delete")).toBe("a\nb");
    expect(apply("a", 1, "delete")).toBe("");
    expect(apply("a\n", 2, "delete")).toBe("a");
    expect(apply("", 1, "delete")).toBe("");
  });
  it("按行插入多行剪贴板，兼容 CRLF、无尾换行与文件末尾", () => {
    expect(apply("a\nb", 2, "paste-before", "x\r\ny")).toBe("a\nx\ny\nb");
    expect(apply("a\nb", 1, "paste-after", "x\ny\n")).toBe("a\nx\ny\nb");
    expect(apply("a\nb", 2, "paste-after", "x\ny")).toBe("a\nb\nx\ny");
    expect(apply("a", 1, "paste-after", "x\n")).toBe("a\nx\n");
    expect(apply("a", 1, "paste-before", "")).toBe("a");
  });
  it("复制、空行插入和上下移动保留行边界", () => {
    expect(apply("a\nb", 1, "duplicate")).toBe("a\na\nb");
    expect(apply("a\nb", 2, "duplicate")).toBe("a\nb\nb");
    expect(apply("a\nb", 2, "blank-before")).toBe("a\n\nb");
    expect(apply("a\nb", 1, "blank-after")).toBe("a\n\nb");
    expect(apply("a\nb\nc", 2, "move-up")).toBe("b\na\nc");
    expect(apply("a\nb\nc", 2, "move-down")).toBe("a\nc\nb");
    expect(apply("a\nb", 1, "move-up")).toBe("a\nb");
    expect(apply("a\nb", 2, "move-down")).toBe("a\nb");
  });
  it("行编辑可一步撤销，并拒绝只读修改", () => {
    let state = EditorState.create({
      doc: "first\nlast",
      extensions: [history()],
    });
    state = state.update(sourceLineChange(state, 1, "duplicate")!).state;
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    });
    expect(state.doc.toString()).toBe("first\nlast");
    const readonly = EditorState.create({
      doc: "first",
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(sourceLineChange(readonly, 1, "delete")).toBeNull();
    expect(sourceLineRange(EditorState.create({ doc: "one\ntwo" }), 1)).toEqual(
      { from: 0, to: 4 },
    );
  });
});
