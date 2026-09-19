import { expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToProseMirror } from "../../src/lib/delta-converter";
import { renderedTextblockMap } from "../../src/lib/markdown-view-position";
import { SourceNavigationSession } from "../../src/lib/markdown-source-navigation";

function fixture(source: string, target: string, occurrence = 0) {
  const content = mdToDelta(source);
  const block = renderedTextblockMap(deltaToProseMirror(content)).filter(
    (block) => block.text === target,
  )[occurrence];
  content.metadata = {
    author: "测试",
    bookmarks: [
      {
        id: "keep",
        key: "a",
        label: "我的书签",
        position: block.position + 1,
        preview: target,
        createdAt: "2026-01-01",
      },
    ],
  };
  return { content, session: new SourceNavigationSession(source, content) };
}

it("keeps unchanged rich metadata and extracts parsed headings, excluding fenced examples", () => {
  const source =
    "# **标题**\r\n\r\n````md\r\n# 代码里的假标题\r\n````\r\n\r\n## 后一章\r\n\r\n目标段落";
  const { session, content } = fixture(source, "目标段落");
  expect(session.current.read()).toBe(content);
  expect(session.current.outline.map((item) => item.text)).toEqual([
    "标题",
    "后一章",
  ]);
  expect(
    session.current.outline.map(
      (item) => source.slice(item.offset).split("\r\n")[0],
    ),
  ).toEqual(["# **标题**", "## 后一章"]);
  expect(session.current.bookmarks[0].offset).toBe(source.indexOf("目标段落"));
});

it("moves bookmarks through insertions and heading edits, refreshes preview and preserves identity", () => {
  const source = "# 起始\n\n开头\n\n## 下一章\n\n目标段落\n\n末尾";
  const { session, content } = fixture(source, "目标段落");
  const inserted = "# 新章\n\n新正文\n\n" + source;
  session.update(inserted);
  const changed = inserted
    .replace("目标段落", "目标段落改过了")
    .replace("## 下一章", "## 新标题");
  const revision = session.update(changed);
  expect(revision.outline.map((item) => item.text)).toEqual([
    "新章",
    "起始",
    "新标题",
  ]);
  const bookmark = revision.read().metadata!.bookmarks![0];
  expect(bookmark).toMatchObject({
    id: "keep",
    key: "a",
    label: "我的书签",
    preview: "目标段落改过了",
    createdAt: "2026-01-01",
  });
  const blocks = renderedTextblockMap(deltaToProseMirror(revision.read()));
  expect(
    blocks.find((block) => block.position + 1 === bookmark.position)?.text,
  ).toBe("目标段落改过了");
  expect(revision.read().metadata).toMatchObject({
    author: "测试",
    markdownSource: changed,
  });
  expect(session.update(source).read()).toBe(content);
});

it("maps repeated list/table paragraphs by position and restores intermediate undo/redo anchors", () => {
  const source =
    "# 章节\n\n- 重复\n  - 子项\n- 重复\n\n| A | B |\n| --- | --- |\n| 单元格 | 内容 |\n\n尾部";
  const { session } = fixture(source, "重复", 1);
  expect(session.current.bookmarks[0].offset).toBe(
    source.lastIndexOf("- 重复"),
  );
  const inserted = "前言\n\n" + source;
  const first = session.update(inserted);
  const deleted = inserted.replace("- 重复\n  - 子项\n", "");
  const from = inserted.indexOf("- 重复\n  - 子项\n");
  session
    .update(deleted, { from, to: from + "- 重复\n  - 子项\n".length })
    .read();
  const undo = session.update(inserted);
  expect(undo.bookmarks).toEqual(first.bookmarks);
  const redo = session.update(deleted);
  const bookmark = redo.bookmarks[0];
  expect(bookmark.preview).toBe("重复");
  expect(redo.source.slice(bookmark.offset)).toMatch(/^- 重复/);
  const table = fixture(source, "单元格");
  table.session.update("前言\n\n" + source);
  expect(table.session.current.bookmarks[0].preview).toBe("单元格");
});

it("retains bookmarks across rapid immutable autosave readers and empty documents", () => {
  const source = "# 标题\n\n目标";
  const { session } = fixture(source, "目标");
  const first = session.update("新增\n\n" + source);
  const second = session.update("再次新增\n\n" + first.source);
  expect(first.read().metadata?.markdownSource).toBe(first.source);
  expect(second.read().metadata?.markdownSource).toBe(second.source);
  const blank = session.update("");
  expect(blank.read().metadata?.bookmarks).toHaveLength(1);
  expect(blank.bookmarks[0].position).toBe(1);
  expect(session.update(source).bookmarks[0].preview).toBe("目标");
});

it("keeps the bookmarked table cell when earlier cells grow or contain Markdown marks", () => {
  const source = "| A | B |\n| --- | --- |\n| a | **b** |";
  const { session } = fixture(source, "b");
  const next = session.update(source.replace("| a |", "| xxxxxxxxxxxxx |"));
  expect(next.bookmarks[0].preview).toBe("b");
  const blocks = renderedTextblockMap(deltaToProseMirror(next.read()));
  expect(
    blocks.find((block) => block.position + 1 === next.bookmarks[0].position)
      ?.text,
  ).toBe("b");
});

it("keeps an unchanged bookmark between separate edits in a whole-buffer paste", () => {
  for (const length of [8, 1000]) {
    const source =
      "# 原标题\n\n" +
      Array.from({ length }, (_, index) => `正文${index}\n\n`).join("") +
      "原末尾";
    const target = `正文${Math.floor(length / 2)}`;
    const { session } = fixture(source, target);
    const updated =
      "很长的新增前言\n\n" +
      source.replace("# 原标题", "# 改名").replace("原末尾", "更新后的末尾");
    const revision = session.update(updated, { from: 0, to: source.length });
    expect(revision.bookmarks[0].preview).toBe(target);
    expect(revision.bookmarks[0].offset).toBe(updated.indexOf(target));
  }
});
