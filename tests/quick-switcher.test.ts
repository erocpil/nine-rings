import {
  filterQuickSwitcherNotes,
  rankQuickSwitcherNotes,
  readRecentNoteIds,
  rememberRecentNote,
} from "../src/lib/quick-switcher";
import type { Note } from "../src/types/models";

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

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
