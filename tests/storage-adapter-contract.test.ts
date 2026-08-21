import { idbAdapter } from "../src/lib/storage/idb";
import { tauriAdapter } from "../src/lib/storage/tauri";
import type { StorageAdapter } from "../src/lib/storage/types";

const requiredMethods: Array<keyof StorageAdapter> = [
  "getNotesByDate", "getNote", "getAllNotes", "createNote", "upsertNote", "updateNote",
  "updateNoteOrder", "deleteNote", "searchNotes", "getNotesByTag", "getRecentDates",
  "getAllTags", "getDailyPage", "updateTodos", "getAllDailyPages", "exportData", "importData",
  "exportNoteMarkdown", "getDeletedNotes", "restoreNote", "permanentlyDeleteNote", "cleanOldDeleted",
  "batchDelete", "batchSetReadonly", "getNoteVersions", "restoreNoteVersion", "createNoteCheckpoint",
  "getConfig", "setConfig", "getPathTree", "getNotesByPath", "renameFolder", "moveDocument",
  "relocateFolder", "searchDocs", "getAllConcepts",
];

let passed = 0;
for (const method of requiredMethods) {
  if (typeof idbAdapter[method] !== "function") throw new Error(`IndexedDB 缺少契约方法: ${method}`);
  if (typeof tauriAdapter[method] !== "function") throw new Error(`Tauri 缺少契约方法: ${method}`);
  passed += 2;
}

const idbMethods = Object.keys(idbAdapter).sort();
const tauriMethods = Object.keys(tauriAdapter).sort();
if (JSON.stringify(idbMethods) !== JSON.stringify(tauriMethods)) {
  throw new Error(`适配器公开方法不一致\nIDB: ${idbMethods.join(", ")}\nTauri: ${tauriMethods.join(", ")}`);
}
passed++;

console.log(`${passed} passed, 0 failed`);
