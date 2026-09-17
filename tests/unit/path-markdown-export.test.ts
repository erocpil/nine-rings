import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import type { Note } from "../../src/types/models";
import {
  buildPathMarkdownFiles,
  safeExportName,
} from "../../src/lib/path-markdown-export";

function doc(
  folder: string,
  title: string,
  content: Note["content"] = { ops: [{ insert: "正文\n第二行\n" }] },
) {
  const note: Note = {
    id: title,
    title,
    content,
    date: "2026-09-17",
    tags: [],
    pinned: false,
    readonly: false,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    storagePath: folder,
  };
  return { folder, note };
}

describe("路径 Markdown ZIP", () => {
  it("递归保留相对目录并默认使用 md，原始 Markdown 不被二次转义", () => {
    const source = "- [ ] 任务\n\n第二段\n";
    const files = unzipSync(
      zipSync(
        buildPathMarkdownFiles("projects/资料", [
          doc("projects/资料", "说明.txt"),
          doc("projects/资料/子目录/深层", "任务.md", {
            ops: [],
            metadata: { markdownSource: source },
          }),
        ]),
      ),
    );
    expect(Object.keys(files)).toEqual([
      "资料/说明.md",
      "资料/子目录/深层/任务.md",
    ]);
    expect(strFromU8(files["资料/子目录/深层/任务.md"])).toBe(source);
    expect(strFromU8(files["资料/说明.md"])).toContain("第二行");
  });
  it("同名、大小写、清洗后的目录及文件名冲突都不会覆盖", () => {
    const files = buildPathMarkdownFiles("projects/test", [
      doc("projects/test/a:b", "Same"),
      doc("projects/test/a?b", "Same"),
      doc("projects/test", "same"),
      doc("projects/test", "SAME.md"),
      doc("projects/test/same.md", "child"),
      doc("projects/test", "same"),
    ]);
    expect(Object.keys(files)).toEqual([
      "test/a-b/Same.md",
      "test/a-b (2)/Same.md",
      "test/same (2).md",
      "test/SAME (3).md",
      "test/same.md/child.md",
      "test/same (4).md",
    ]);
  });
  it("拒绝空目录、越界及路径穿越", () => {
    expect(() => buildPathMarkdownFiles("projects/a", [])).toThrow("没有");
    expect(() =>
      buildPathMarkdownFiles("projects/a", [doc("projects/abc", "x")]),
    ).toThrow("移出");
    expect(() =>
      buildPathMarkdownFiles("projects/a", [doc("projects/a/../b", "x")]),
    ).toThrow("无效");
    expect(safeExportName("../CON.txt")).not.toContain("/");
    expect(safeExportName("CON.txt")).toBe("_CON.txt");
    expect(safeExportName(".. ")).toBe("无标题");
  });
  it("包含加密正文时整个导出失败，不生成空白文件", () => {
    const encrypted = { ops: [], encrypted: {} } as Note["content"];
    expect(() =>
      buildPathMarkdownFiles("projects/a", [
        doc("projects/a", "普通"),
        doc("projects/a", "机密", encrypted),
      ]),
    ).toThrow("加密文档");
  });
});
