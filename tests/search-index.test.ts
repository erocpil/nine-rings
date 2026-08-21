import assert from "node:assert/strict";
import test from "node:test";
import { NoteSearchIndex } from "../src/lib/search-index-core";
import type { Note } from "../src/types/models";

const note = (id: string, title: string, body: string, updated = "2026-01-01T00:00:00Z"): Note => ({
  id, date: "2026-01-01", title, content: { ops: [{ insert: body }] }, tags: [], pinned: false,
  readonly: false, sort_order: 0, created_at: updated, updated_at: updated,
});

test("搜索索引支持中文、多关键词与增量更新删除", () => {
  const index = new NoteSearchIndex();
  index.rebuild([note("1", "项目计划", "完成搜索索引"), note("2", "会议", "讨论发布流程")]);
  assert.deepEqual(index.search("搜索 索引").map((item) => item.id), ["1"]);
  index.upsert(note("2", "Linux 发布", "搜索索引已经完成", "2026-01-02T00:00:00Z"));
  assert.deepEqual(index.search("搜索索引").map((item) => item.id), ["2", "1"]);
  index.remove("1");
  assert.deepEqual(index.search("搜索索引").map((item) => item.id), ["2"]);
});

test("搜索索引使用 NFKC 规范化并优先标题命中", () => {
  const index = new NoteSearchIndex();
  index.rebuild([note("body", "其他", "ＡＢＣ"), note("title", "ABC", "正文")]);
  assert.deepEqual(index.search("abc").map((item) => item.id), ["title", "body"]);
});
