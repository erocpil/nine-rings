/**
 * 对拍测试：验证 idb-driver.ts（Op 抽象）与 idb.ts（原始实现）的语义等价性。
 *
 * 用法：npx tsx src/lib/storage/idb-driver.test.ts
 *
 * 策略：
 * 1. 用 idbAdapter（旧实现）创建测试数据。
 * 2. 分别用新旧实现读回，比较结果。
 * 3. 交叉验证：新实现在旧数据上读写、旧实现在新数据上读写。
 *
 * 环境要求：fake-indexeddb（Node.js IndexedDB polyfill）
 */

import "fake-indexeddb/auto";
import type { Note, CreateNoteInput, PathNode } from "../../types/models";
import { idbAdapter } from "./idb";
import { idbDriver, type DriverContext } from "./idb-driver";
import { buildDocTree, type FlatDocRecord, type FlatDailyRecord } from "./core";

// ═══════════════════════════════════════════════════════════════════
// 测试辅助
// ═══════════════════════════════════════════════════════════════════

const DB_NAME = "nine_rings";
const DB_VERSION = 3;

function openTestDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("notes")) {
        const store = db.createObjectStore("notes", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("deleted_at", "deleted_at", { unique: false });
        store.createIndex("tags", "tags", { unique: false });
        store.createIndex("pinned_sort", ["pinned", "sort_order"], { unique: false });
      }
      if (db.objectStoreNames.contains("notes")) {
        const tx = req.transaction!;
        const store = tx.objectStore("notes");
        if (!store.indexNames.contains("storagePath")) {
          store.createIndex("storagePath", "storagePath", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains("daily_pages")) {
        db.createObjectStore("daily_pages", { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains("note_versions")) {
        const store = db.createObjectStore("note_versions", { keyPath: "id" });
        store.createIndex("note_id", "note_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** 标准化 Note 用于比较（去除不可比较字段） */
function normalizeNote(n: Note): Record<string, any> {
  return {
    id: n.id,
    date: n.date,
    title: n.title,
    tags: [...(n.tags ?? [])].sort(),
    pinned: n.pinned,
    readonly: n.readonly,
    sort_order: n.sort_order,
    storagePath: n.storagePath,
    docType: n.docType,
    concepts: n.concepts ? [...n.concepts].sort() : undefined,
    linkedDocIds: n.linkedDocIds ? [...n.linkedDocIds].sort() : undefined,
    // 不比较时间戳（两边生成时间可能差几 ms）
    has_content: n.content?.ops !== undefined,
  };
}

function normalizeTree(node: PathNode): Record<string, any> {
  return {
    path: node.path,
    name: node.name,
    type: node.type,
    noteId: node.noteId,
    docType: node.docType,
    count: node.count,
    readonly: node.readonly,
  };
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ═══════════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════════

async function runTests() {
  let passed = 0;
  let failed = 0;

  // ── Setup ──
  await deleteDB();
  const ctx: DriverContext = { db: await openTestDB() };

  // ═══════════════════════════════════════════════════════════════
  // 1. createNote — 新旧交叉验证
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("── Test: createNote ──");

    // 旧实现创建
    const inputA: CreateNoteInput = {
      date: "2026-07-15",
      title: "Alpha",
      tags: ["test", "alpha"],
      pinned: false,
      storagePath: "projects/test",
      docType: "how-to",
    };
    const oldNote = await idbAdapter.createNote(inputA);

    // 新实现读回（验证跨实现兼容）
    const newRead = await idbDriver.getNotesByDate(ctx, "2026-07-15");
    const found = newRead.find((n) => n.id === oldNote.id);
    assert(!!found, "createNote: new driver can read old adapter's note");
    assert(found!.title === "Alpha", "createNote: title matches");
    assert(found!.storagePath === "projects/test", "createNote: storagePath matches");
    passed++;

    // 新实现创建
    const inputB: CreateNoteInput = {
      date: "2026-07-15",
      title: "Beta",
      tags: ["beta"],
      pinned: true,
    };
    const newNote = await idbDriver.createNote(ctx, inputB);

    // 旧实现读回（验证跨实现兼容）
    const oldRead = await idbAdapter.getNote(newNote.id);
    assert(!!oldRead, "createNote: old adapter can read new driver's note");
    assert(oldRead!.title === "Beta", "createNote: cross-read title matches");
    assert(oldRead!.pinned === true, "createNote: cross-read pinned matches");
    passed++;
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. getNotesByDate — 同数据源对拍
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("── Test: getNotesByDate ──");

    // 旧实现读取
    const oldNotes = await idbAdapter.getNotesByDate("2026-07-15");
    const oldNormalized = oldNotes.map(normalizeNote).sort((a, b) => a.title.localeCompare(b.title));

    // 新实现读取
    const newNotes = await idbDriver.getNotesByDate(ctx, "2026-07-15");
    const newNormalized = newNotes.map(normalizeNote).sort((a, b) => a.title.localeCompare(b.title));

    assert(
      oldNormalized.length === newNormalized.length,
      `getNotesByDate: count matches (${oldNormalized.length} vs ${newNormalized.length})`,
    );
    for (let i = 0; i < oldNormalized.length; i++) {
      assert(
        deepEqual(oldNormalized[i], newNormalized[i]),
        `getNotesByDate: note[${i}] "${oldNormalized[i].title}" matches`,
      );
    }
    passed++;


    // 验证排序（pinned 优先）
    assert(
      newNotes[0].pinned === true,
      "getNotesByDate: pinned note is first",
    );
    passed++;
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. updateNote — 增量更新验证
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("── Test: updateNote ──");

    // 获取 Alpha 笔记（由旧实现创建）
    const notes = await idbAdapter.getNotesByDate("2026-07-15");
    const alpha = notes.find((n) => n.title === "Alpha")!;
    assert(!!alpha, "updateNote: found Alpha note");

    const oldTags = [...alpha.tags];

    // 新实现更新（只改 title，不改 tags）
    const updated = await idbDriver.updateNote(ctx, alpha.id, { title: "Alpha Updated" });

    // 验证：title 变了，tags 没变
    assert(updated.title === "Alpha Updated", "updateNote: title updated");
    assert(
      JSON.stringify(updated.tags.sort()) === JSON.stringify(oldTags.sort()),
      "updateNote: tags unchanged (partial update)",
    );

    // 旧实现读回验证
    const oldReRead = await idbAdapter.getNote(alpha.id);
    assert(oldReRead!.title === "Alpha Updated", "updateNote: old adapter sees updated title");
    assert(
      JSON.stringify(oldReRead!.tags.sort()) === JSON.stringify(oldTags.sort()),
      "updateNote: old adapter sees unchanged tags",
    );
    passed++;
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. deleteNote — 软删除
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("── Test: deleteNote ──");

    // 创建一个待删除笔记
    const note = await idbAdapter.createNote({ date: "2026-07-16", title: "To Delete" });

    // 新实现软删除
    await idbDriver.deleteNote(ctx, note.id);

    // 旧实现验证：getNote 应返回 null（软删除过滤）
    const oldRead = await idbAdapter.getNote(note.id);
    assert(oldRead === null, "deleteNote: old adapter getNote returns null for soft-deleted");

    // 旧实现验证：getDeletedNotes 应包含
    const deletedNotes = await idbAdapter.getDeletedNotes();
    const found = deletedNotes.find((n) => n.id === note.id);
    assert(!!found, "deleteNote: old adapter getDeletedNotes includes the note");

    // 新实现验证：getNotesByDate 不包含已删除
    const newNotes = await idbDriver.getNotesByDate(ctx, "2026-07-16");
    const newFound = newNotes.find((n) => n.id === note.id);
    assert(!newFound, "deleteNote: new driver getNotesByDate excludes soft-deleted");
    passed++;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. getPathTree — 树构建对拍
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("── Test: getPathTree ──");

    // 在现有数据基础上新增结构化的文档树数据
    await idbAdapter.createNote({
      date: "2026-07-20",
      title: "Doc A",
      storagePath: "projects/alpha",
      docType: "how-to",
    });
    await idbAdapter.createNote({
      date: "2026-07-20",
      title: "Doc B",
      storagePath: "projects/beta",
      docType: "reference",
    });
    await idbAdapter.createNote({
      date: "2026-07-20",
      title: "Doc C",
      storagePath: "projects/alpha",
      docType: "tutorial",
    });

    // 创建每日随笔（无 storagePath）
    await idbAdapter.createNote({ date: "2026-07-20", title: "Daily X" });
    await idbAdapter.createNote({ date: "2026-07-21", title: "Daily Y" });

    // 旧实现读取
    const oldTree = await idbAdapter.getPathTree();
    const oldNormalized = oldTree.map(normalizeTree).sort((a, b) => a.path.localeCompare(b.path));

    // 新实现读取（复用同一个 ctx，共享 DB）
    const newTree = await idbDriver.getPathTree(ctx);
    const newNormalized = newTree.map(normalizeTree).sort((a, b) => a.path.localeCompare(b.path));

    assert(
      oldNormalized.length === newNormalized.length,
      `getPathTree: node count matches (${oldNormalized.length} vs ${newNormalized.length})`,
    );
    for (let i = 0; i < oldNormalized.length; i++) {
      assert(
        deepEqual(oldNormalized[i], newNormalized[i]),
        `getPathTree: node "${oldNormalized[i].path}" type=${oldNormalized[i].type} matches`,
      );
    }
    passed++;

    // 验证核心结构：daily/ 文件夹存在
    const hasDaily = newTree.some((n) => n.path === "daily" && n.type === "folder");
    assert(hasDaily, "getPathTree: daily/ folder exists");
    const dailyFolder = newTree.find((n) => n.path === "daily" && n.type === "folder");
    assert(dailyFolder?.count != null && dailyFolder!.count! >= 1,
      `getPathTree: daily/ count=${dailyFolder?.count} (expected >=1)`);
    passed++;

    // 验证 projects/ 文件夹 count（含之前测试创建的 projects/test 笔记）
    const projFolder = newTree.find((n) => n.path === "projects" && n.type === "folder");
    assert(projFolder?.count != null, "getPathTree: projects/ folder exists");
    // 至少包含本次创建的 3 个文档 + 之前可能存在的 projects/ 笔记
    assert(projFolder!.count! >= 3, `getPathTree: projects/ count=${projFolder!.count} (expected >=3)`);
    passed++;

    // 验证 projects/alpha/ 子文件夹
    const alphaFolder = newTree.find((n) => n.path === "projects/alpha" && n.type === "folder");
    assert(alphaFolder?.count === 2, `getPathTree: projects/alpha/ count=${alphaFolder?.count} (expected 2)`);
    passed++;
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. buildDocTree 纯函数单元测试
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("── Test: buildDocTree (pure function) ──");

    const docs: FlatDocRecord[] = [
      { id: "doc-1", title: "How to X", storage_path: "guides", doc_type: "how-to", updated_at: "2026-01-01T00:00:00Z", readonly: false },
      { id: "doc-2", title: "Ref Y", storage_path: "guides/nested", doc_type: "reference", updated_at: "2026-01-02T00:00:00Z", readonly: true },
    ];

    const dailies: FlatDailyRecord[] = [
      { id: "daily-1", date: "2026-07-20", title: "Today's note", updated_at: "2026-07-20T12:00:00Z" },
    ];

    const tree = buildDocTree(docs, dailies);

    // 验证文件夹
    const guidesFolder = tree.find((n) => n.path === "guides" && n.type === "folder");
    assert(guidesFolder?.count === 2, "buildDocTree: guides/ count=2 (nested doc counted)");

    const nestedFolder = tree.find((n) => n.path === "guides/nested" && n.type === "folder");
    assert(nestedFolder?.count === 1, "buildDocTree: guides/nested/ count=1");

    const dailyFolder = tree.find((n) => n.path === "daily" && n.type === "folder");
    assert(dailyFolder?.count === 1, "buildDocTree: daily/ count=1");

    const dateFolder = tree.find((n) => n.path === "daily/2026-07-20" && n.type === "folder");
    assert(dateFolder?.count === 1, "buildDocTree: daily/2026-07-20/ count=1");

    // 验证文档节点
    const doc1 = tree.find((n) => n.path === "guides/doc-1" && n.type === "document");
    assert(!!doc1, "buildDocTree: doc-1 document node exists");
    assert(doc1!.docType === "how-to", "buildDocTree: docType preserved");

    const dailyDoc = tree.find((n) => n.path === "daily/2026-07-20/daily-1" && n.type === "document");
    assert(!!dailyDoc, "buildDocTree: daily document node exists");
    assert(dailyDoc!.readonly === false, "buildDocTree: daily doc readonly=false");
    passed++;

    // 无 daily 时不应有 daily/ 节点
    const treeNoDailies = buildDocTree(docs, []);
    assert(
      !treeNoDailies.some((n) => n.path.startsWith("daily")),
      "buildDocTree: no daily/ nodes when dailies is empty",
    );
    passed++;
  }

  // ═══════════════════════════════════════════════════════════════
  // Results
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
