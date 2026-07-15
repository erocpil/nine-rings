/**
 * IndexedDB 适配器完整单元测试
 *
 * 用法：npx tsx tests/idb-adapter.test.ts
 *
 * 覆盖 StorageAdapter 全部接口：
 * - Note CRUD、软删除/回收站、每日页面&待办
 * - 标签系统、路径树&文档系统、导出/导入
 * - 批量操作、版本历史、配置
 */

import "fake-indexeddb/auto";
// @ts-ignore — fake-indexeddb 没有完整 localStorage，mock 它
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import type { Note, DailyPage, Todo, CreateNoteInput, PathNode } from "../src/types/models";
import { idbAdapter } from "../src/lib/storage/idb";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; return; }
  console.error(`  FAIL: ${msg}`);
  failed++;
}

async function deleteDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("nine_rings");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

async function runTests() {
  await deleteDB();

  // ═══════════════════════════════════════════════════════════════
  // 1. createNote
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── createNote ──");
    const note = await idbAdapter.createNote({ date: "2026-07-15", title: "Test Note", tags: ["test", "demo"], pinned: false });
    assert(!!note.id, "has id");
    assert(note.title === "Test Note", "title preserved");
    assert(note.date === "2026-07-15", "date preserved");
    assert(note.tags.sort().join(",") === "demo,test", "tags preserved");
    assert(note.pinned === false, "pinned=false");
    assert(!!note.created_at, "created_at assigned");
    assert(!note.deleted_at, "deleted_at is null");
    assert(!note.storagePath, "storagePath is undefined (essay)");

    const doc = await idbAdapter.createNote({ date: "2026-07-15", title: "My Doc", storagePath: "projects/test", docType: "how-to" });
    assert(doc.storagePath === "projects/test", "doc storagePath preserved");
    assert(doc.docType === "how-to", "doc docType preserved");
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. getNote
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── getNote ──");
    const created = await idbAdapter.createNote({ date: "2026-07-15", title: "Find Me" });
    const found = await idbAdapter.getNote(created.id);
    assert(!!found, "getNote returns note");
    assert(found!.title === "Find Me", "title matches");
    const missing = await idbAdapter.getNote("nonexistent");
    assert(missing === null, "nonexistent → null");
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. getNotesByDate
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── getNotesByDate ──");
    await idbAdapter.createNote({ date: "2026-07-16", title: "Day A1", pinned: false });
    await idbAdapter.createNote({ date: "2026-07-16", title: "Day A2", pinned: true });
    const notes = await idbAdapter.getNotesByDate("2026-07-16");
    assert(notes.length >= 2, ">= 2 notes");
    // pinned 排前面
    assert(notes[0].pinned === true, "pinned first");
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. updateNote
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── updateNote ──");
    const note = await idbAdapter.createNote({ date: "2026-07-15", title: "Original" });
    const updated = await idbAdapter.updateNote(note.id, { title: "Updated" });
    assert(updated.title === "Updated", "title updated");
    const reRead = await idbAdapter.getNote(note.id);
    assert(reRead!.title === "Updated", "persisted");
    // partial update
    const partial = await idbAdapter.updateNote(note.id, { pinned: true });
    assert(partial.pinned === true, "pinned updated");
    assert(partial.title === "Updated", "title unchanged");
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. updateNoteOrder
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── updateNoteOrder ──");
    const note = await idbAdapter.createNote({ date: "2026-07-15", title: "Reorder" });
    const reordered = await idbAdapter.updateNoteOrder(note.id, 99);
    assert(reordered.sort_order === 99, "sort_order=99");
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. 软删除
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Soft delete ──");
    const note = await idbAdapter.createNote({ date: "2026-07-15", title: "To Delete" });
    await idbAdapter.deleteNote(note.id);
    const deleted = await idbAdapter.getNote(note.id);
    assert(deleted === null, "getNote → null for soft-deleted");
    const dayNotes = await idbAdapter.getNotesByDate("2026-07-15");
    assert(!dayNotes.some((n: Note) => n.id === note.id), "excluded from getNotesByDate");
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. 回收站
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Trash ──");
    const deletedNotes = await idbAdapter.getDeletedNotes();
    assert(deletedNotes.length >= 1, "getDeletedNotes returns items");
    // 恢复
    const toRestore = deletedNotes[0];
    await idbAdapter.restoreNote(toRestore.id);
    const restored = await idbAdapter.getNote(toRestore.id);
    assert(!!restored, "restored visible");
    // 永久删除
    await idbAdapter.deleteNote(toRestore.id);
    await idbAdapter.permanentlyDeleteNote(toRestore.id);
    const cleaned = await idbAdapter.cleanOldDeleted(0);
    assert(typeof cleaned === "number", "cleanOldDeleted returns number");
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. upsertNote
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── upsertNote ──");
    // 同 storagePath + 同 title → 更新
    const n1 = await idbAdapter.upsertNote({ date: "2026-07-20", title: "Upsert Test", storagePath: "projects/upsert" });
    const n2 = await idbAdapter.upsertNote({ date: "2026-07-20", title: "Upsert Test", storagePath: "projects/upsert" });
    assert(n2.id === n1.id, "same (storagePath, title) → update");
    // 同 storagePath + 不同 title → 新建
    const n3 = await idbAdapter.upsertNote({ date: "2026-07-20", title: "Upsert Different", storagePath: "projects/upsert" });
    assert(n3.id !== n1.id, "same storagePath, different title → create new");
    assert(n3.title === "Upsert Different", "new doc title correct");
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. 每日页面
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Daily page ──");
    const page = await idbAdapter.getDailyPage("2026-07-25");
    assert(page.date === "2026-07-25", "date correct");
    assert(Array.isArray(page.todos), "todos is array");

    const todos: Todo[] = [
      { id: "t1", text: "Task 1", done: false, order: 0, tags: [] },
      { id: "t2", text: "Task 2", done: true, order: 1, tags: ["urgent"] },
    ];
    const updated = await idbAdapter.updateTodos({ date: "2026-07-25", todos, todo_carryover: true });
    assert(updated.todos.length === 2, "2 todos");
    assert(updated.todos[0].text === "Task 1", "todo text preserved");
    assert(updated.todo_carryover === true, "carryover=true");

    const all = await idbAdapter.getAllDailyPages();
    assert(all.length >= 1, "getAllDailyPages returns pages");
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. 标签
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Tags ──");
    await idbAdapter.createNote({ date: "2026-07-15", title: "Tagged A", tags: ["alpha", "beta"] });
    await idbAdapter.createNote({ date: "2026-07-15", title: "Tagged B", tags: ["beta", "gamma"] });
    const tags = await idbAdapter.getAllTags();
    assert(tags.includes("alpha"), "alpha found");
    assert(tags.includes("beta"), "beta found");
    const betaNotes = await idbAdapter.getNotesByTag("beta");
    assert(betaNotes.length >= 2, ">=2 notes with beta tag");
  }

  // ═══════════════════════════════════════════════════════════════
  // 11. 全文搜索
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Search ──");
    // fake-indexeddb 不支持高级搜索，只验证不抛错
    const results = await idbAdapter.searchNotes("nonexistent12345");
    assert(Array.isArray(results), "search returns array");
  }

  // ═══════════════════════════════════════════════════════════════
  // 12. 路径树
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Path tree ──");
    await idbAdapter.createNote({ date: "2026-07-15", title: "Project A", storagePath: "projects/alpha", docType: "how-to" });
    await idbAdapter.createNote({ date: "2026-07-15", title: "Project B", storagePath: "projects/alpha", docType: "reference" });
    const tree = await idbAdapter.getPathTree();
    const projFolder = tree.find((n: PathNode) => n.path === "projects" && n.type === "folder");
    assert(projFolder!.count! >= 2, "projects/ count>=2");
    const alphaFolder = tree.find((n: PathNode) => n.path === "projects/alpha" && n.type === "folder");
    assert(alphaFolder?.count === 2, "projects/alpha/ count=2");
    const docA = tree.find((n: PathNode) => n.path.startsWith("projects/alpha/") && n.type === "document" && n.name === "Project A");
    assert(!!docA, "document node exists");
    const dailyFolder = tree.find((n: PathNode) => n.path === "daily" && n.type === "folder");
    assert(!!dailyFolder, "daily/ folder exists");
  }

  // ═══════════════════════════════════════════════════════════════
  // 13. getNotesByPath + searchDocs + getAllConcepts
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Docs API ──");
    const alphaNotes = await idbAdapter.getNotesByPath("projects/alpha");
    assert(alphaNotes.length >= 2, "projects/alpha → >=2 docs");
    const howtoDocs = await idbAdapter.searchDocs({ docType: "how-to" });
    assert(howtoDocs.length >= 1, "docType filter works");
    const concepts = await idbAdapter.getAllConcepts();
    assert(Array.isArray(concepts), "getAllConcepts returns array");
  }

  // ═══════════════════════════════════════════════════════════════
  // 14. 导出/导入
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Export/Import ──");
    const json = await idbAdapter.exportData();
    assert(typeof json === "string" && json.length > 10, "export → non-empty JSON");
    const parsed = JSON.parse(json);
    assert(parsed.version === 1, "version=1");
    assert(Array.isArray(parsed.notes), "notes array");
    const importResult = await idbAdapter.importData(json);
    assert(typeof importResult.notes_imported === "number", "import returns count");
  }

  // ═══════════════════════════════════════════════════════════════
  // 15. 批量操作
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Batch ops ──");
    const n1 = await idbAdapter.createNote({ date: "2026-07-30", title: "Batch 1" });
    const n2 = await idbAdapter.createNote({ date: "2026-07-30", title: "Batch 2" });
    await idbAdapter.batchSetReadonly([n1.id, n2.id], true);
    const r1 = await idbAdapter.getNote(n1.id);
    assert(r1!.readonly === true, "batch readonly=true");
    await idbAdapter.batchDelete([n1.id, n2.id]);
    const d1 = await idbAdapter.getNote(n1.id);
    assert(d1 === null, "batch delete → null");
  }

  // ═══════════════════════════════════════════════════════════════
  // 16. 版本历史
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Version history ──");
    const note = await idbAdapter.createNote({ date: "2026-07-15", title: "Version Test", content: { ops: [{ insert: "v1" }] } });
    await idbAdapter.updateNote(note.id, { title: "Version Test v2", content: { ops: [{ insert: "v2" }] } });
    const versions = await idbAdapter.getNoteVersions(note.id);
    assert(versions.length >= 1, "version snapshot exists");
    if (versions.length > 0) {
      const restored = await idbAdapter.restoreNoteVersion(versions[0].id);
      assert(!!restored, "restored note returned");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 17. 配置
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Config ──");
    const cfg = await idbAdapter.getConfig();
    assert(cfg.theme != null, "config has theme");
    const updated = await idbAdapter.setConfig({ theme: "dark", note_font_size: 18 });
    assert(updated.theme === "dark", "theme=dark");
    const reRead = await idbAdapter.getConfig();
    assert(reRead.theme === "dark", "persisted");
  }

  // ═══════════════════════════════════════════════════════════════
  // 18. getRecentDates
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── getRecentDates ──");
    const dates = await idbAdapter.getRecentDates();
    assert(Array.isArray(dates), "returns array");
    assert(dates.length >= 1, "has dates");
  }

  // ═══════════════════════════════════════════════════════════════
  // 19. snake_case import (Rust serde 兼容性)
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n── Snake_case import ──");

    // 模拟 Rust serde 导出的 JSON（字段名 snake_case）
    const rustExport = {
      version: 1,
      exported_at: "2026-07-15T00:00:00Z",
      notes: [
        {
          id: "rust-doc-1",
          date: "2026-07-15",
          title: "Rust Doc",
          content: { ops: [{ insert: "hello" }] },
          search_text: "hello",
          tags: ["rust"],
          pinned: false,
          sort_order: 0,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-07-15T00:00:00Z",
          storage_path: "projects/rust-lib",    // snake_case
          doc_type: "explanation",               // snake_case
          concepts: ["systems", "networking"],
          linked_doc_ids: ["other-doc"],         // snake_case
          readonly: false,
        },
        {
          id: "rust-essay-1",
          date: "2026-07-15",
          title: "Rust Essay",
          content: { ops: [{ insert: "note" }] },
          search_text: "note",
          tags: [],
          pinned: false,
          sort_order: 1,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-07-15T00:00:00Z",
          // 无 storage_path → 随笔
        },
      ],
      daily_pages: [],
    };

    const result = await idbAdapter.importData(JSON.stringify(rustExport));
    assert(result.notes_imported === 2, "2 notes imported");

    // 验证文档笔记：应该能读到 storagePath 等字段
    const doc = await idbAdapter.getNote("rust-doc-1");
    assert(doc!.storagePath === "projects/rust-lib", "snake_case storage_path → storagePath");
    assert(doc!.docType === "explanation", "snake_case doc_type → docType");
    assert(doc!.concepts!.length === 2, "concepts preserved");
    assert(doc!.linkedDocIds!.includes("other-doc"), "snake_case linked_doc_ids → linkedDocIds");

    // 验证随笔：无 storagePath
    const essay = await idbAdapter.getNote("rust-essay-1");
    assert(!essay!.storagePath, "essay has no storagePath");

    // 路径树应该包含新导入的文档
    const tree = await idbAdapter.getPathTree();
    const rustFolder = tree.find((n: PathNode) => n.path === "projects/rust-lib" && n.type === "folder");
    assert(!!rustFolder, "rust-lib/ folder in tree after snake_case import");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
