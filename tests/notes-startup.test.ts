/**
 * 启动恢复顺序测试
 *
 * 确保上次文档通过主键恢复后，不会在首屏前读取整天列表；列表由界面首次
 * 呈现后显式补齐。运行：npx tsx tests/notes-startup.test.ts
 */

import type { DailyPage, Note } from "../src/types/models";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    return;
  }
  failed++;
  console.error(`  FAIL: ${message}`);
}

async function main(): Promise<void> {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };

  const [{ api }, { useNotesStore }] = await Promise.all([
    import("../src/lib/api"),
    import("../src/stores/useNotesStore"),
  ]);

  const restored: Note = {
    id: "last-document",
    date: "2026-08-20",
    title: "上次文档",
    content: { ops: [{ insert: "正文\n" }] },
    tags: [],
    pinned: false,
    readonly: false,
    sort_order: 0,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    storagePath: "projects/startup",
  };
  const dailyPage: DailyPage = {
    date: restored.date,
    todos: [],
    todo_carryover: false,
    updated_at: restored.updated_at,
  };

  const originalGet = api.notes.get;
  const originalListByDate = api.notes.listByDate;
  const originalDailyGet = api.daily.get;
  let primaryLoads = 0;
  let dateListLoads = 0;
  let dailyLoads = 0;

  api.notes.get = async () => {
    primaryLoads++;
    return restored;
  };
  api.notes.listByDate = async () => {
    dateListLoads++;
    return [restored];
  };
  api.daily.get = async () => {
    dailyLoads++;
    return dailyPage;
  };

  try {
    console.log("\n── last document startup priority ──");
    await useNotesStore.getState().initialize(restored.id);
    let state = useNotesStore.getState();

    assert(primaryLoads === 1, "last document is restored with one primary-key read");
    assert(state.selectedNote?.id === restored.id, "last document is selected immediately");
    assert(state.startupReady, "primary UI is marked ready after the document read");
    assert(state.startupDateLoadPending, "secondary date data remains pending");
    assert(dateListLoads === 0 && dailyLoads === 0, "date list and Todo do not block first paint");

    await state.setDate(restored.date);
    state = useNotesStore.getState();
    assert(dateListLoads === 1 && dailyLoads === 1, "secondary data loads when hydration starts");
    assert(!state.startupDateLoadPending, "secondary hydration clears its pending marker");
    assert(state.selectedNote?.id === restored.id, "hydration preserves the restored document");
  } finally {
    api.notes.get = originalGet;
    api.notes.listByDate = originalListByDate;
    api.daily.get = originalDailyGet;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
