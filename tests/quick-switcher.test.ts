import {
  filterQuickSwitcherNotes,
  rankQuickSwitcherNotes,
  readRecentNoteIds,
  rememberRecentNote,
} from "../src/lib/quick-switcher";
import type { Note } from "../src/types/models";
import { DOCUMENT_FAVORITES_KEY, documentFolderPaths, readDocumentFavorites, toggleDocumentFavorite } from "../src/lib/document-favorites";

let passed = 0;
let failed = 0;
const assert = (condition: boolean, label: string) => {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
};

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
};

const note = (id: string, title: string, updated_at: string, extra: Partial<Note> = {}): Note => ({
  id,
  title,
  date: "2026-08-22",
  content: { ops: [] },
  tags: [],
  pinned: false,
  readonly: false,
  sort_order: 0,
  created_at: updated_at,
  updated_at,
  ...extra,
});

console.log("\n── 快速切换：最近访问与检索 ──");
rememberRecentNote("a", storage);
rememberRecentNote("b", storage);
rememberRecentNote("a", storage);
assert(readRecentNoteIds(storage).join(",") === "a,b", "重复访问置顶且不产生重复项");

const notes = [
  note("a", "网络手册", "2026-08-20T00:00:00Z", { storagePath: "references/network", concepts: ["DPDK"] }),
  note("b", "今日随笔", "2026-08-22T00:00:00Z", { tags: ["review"] }),
  note("c", "旧文档", "2026-08-01T00:00:00Z"),
];
assert(rankQuickSwitcherNotes(notes, ["a"])[0].id === "a", "最近访问优先于更新时间");
assert(filterQuickSwitcherNotes(notes, "network DPDK")[0]?.id === "a", "可组合匹配路径与概念");
assert(filterQuickSwitcherNotes(notes, "review")[0]?.id === "b", "可按标签匹配");
assert(filterQuickSwitcherNotes(notes, "不存在").length === 0, "无匹配时返回空列表");

assert(toggleDocumentFavorite("a", storage).join() === "a", "文档收藏保存 ID");
assert(toggleDocumentFavorite("b", storage).join() === "a,b", "可收藏多个文档");
assert(toggleDocumentFavorite("a", storage).join() === "b", "取消收藏不影响其他文档");
assert(readRecentNoteIds(storage).join() === "a,b", "收藏不改变最近访问顺序");
storage.setItem(DOCUMENT_FAVORITES_KEY, '["b","b",null,{},"bad/id"]');
assert(readDocumentFavorites(storage).join() === "b", "收藏读取过滤无效 ID 和重复项");
storage.setItem(DOCUMENT_FAVORITES_KEY, "invalid json");
assert(readDocumentFavorites(storage).length === 0, "损坏收藏不阻断浏览");
let writeFailed = false;
try { toggleDocumentFavorite("a", { getItem: () => null, setItem: () => { throw new Error("quota"); } }); }
catch { writeFailed = true; }
assert(writeFailed, "收藏写入失败向界面报告");
assert(documentFolderPaths(["areas/private/empty", "areas/private", "projects", "areas/private/empty"]).join() === "areas,areas/private,areas/private/empty,projects", "路径补齐祖先且保留空目录，不重复");

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
