// ── db-versions.ts：IndexedDB 版本历史存储 ──

import type { Note, NoteVersion } from "../../types/models";
import { uuid, now, extractPlainText, noteFromDB } from "./core";
import { withDB, getOne, getAll, getAllFromIndex, putRecord, delRecord } from "./db";

/** 保存笔记当前内容为版本快照，并裁剪至每笔记最多 30 个版本 */
export async function saveVersionSnapshot(store: IDBObjectStore, note: Note): Promise<void> {
  const ver: NoteVersion = {
    id: uuid(),
    note_id: note.id,
    title: note.title ?? "",
    content: note.content,
    tags: note.tags,
    pinned: note.pinned,
    sort_order: note.sort_order ?? 0,
    saved_at: now(),
  };
  await putRecord(store, ver);

  // Keep max 30 versions per note
  const allVersions = await getAllFromIndex<any>(store.index("note_id"), note.id);
  if (allVersions.length > 30) {
    allVersions.sort((a, b) => a.saved_at.localeCompare(b.saved_at));
    const excess = allVersions.slice(0, allVersions.length - 30);
    for (const v of excess) {
      await delRecord(store, v.id);
    }
  }
}

/** 为指定笔记创建版本 checkpoint — 保存当前内容为历史版本 */
export async function createNoteCheckpoint(noteId: string): Promise<void> {
  return withDB(async (db) => {
    const tx = db.transaction(["notes", "note_versions"], "readwrite");
    const noteStore = tx.objectStore("notes");
    const verStore = tx.objectStore("note_versions");

    const existing = await getOne<any>(noteStore, noteId);
    if (!existing) throw new Error(`Note ${noteId} not found`);

    // 去重：如果内容与最新版本相同，不创建 checkpoint
    const allVersions = await getAll<any>(verStore);
    const noteVersions = allVersions
      .filter((v: any) => v.note_id === noteId)
      .sort((a: any, b: any) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""));
    if (noteVersions.length > 0) {
      const latest = noteVersions[0];
      const latestContent = typeof latest.content === "string"
        ? latest.content
        : JSON.stringify(latest.content);
      const currentContent = JSON.stringify(noteFromDB(existing).content);
      if (latestContent === currentContent) return; // 相同内容，跳过
    }

    await saveVersionSnapshot(verStore, noteFromDB(existing));
  });
}

export async function getNoteVersions(noteId: string): Promise<NoteVersion[]> {
  return withDB(async (db) => {
    const index = db.transaction("note_versions", "readonly").objectStore("note_versions").index("note_id");
    const all = await getAllFromIndex<any>(index, noteId);
    return all.sort((a, b) => b.saved_at.localeCompare(a.saved_at)).map((v) => ({
      ...v,
      content: typeof v.content === "string" ? JSON.parse(v.content) : v.content,
      tags: typeof v.tags === "string" ? JSON.parse(v.tags) : v.tags,
    }));
  });
}

export async function restoreNoteVersion(versionId: string): Promise<Note> {
  return withDB(async (db) => {
    const tx = db.transaction(["notes", "note_versions"], "readwrite");
    const verStore = tx.objectStore("note_versions");
    const version = await getOne<any>(verStore, versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const noteStore = tx.objectStore("notes");
    const existing = await getOne<any>(noteStore, version.note_id);
    if (!existing) throw new Error(`Note ${version.note_id} not found`);

    // Save current as version first
    await saveVersionSnapshot(verStore, noteFromDB(existing));

    // Restore
    const restored: any = {
      ...existing,
      title: version.title ?? existing.title,
      content: typeof version.content === "string" ? JSON.parse(version.content) : version.content,
      tags: typeof version.tags === "string" ? JSON.parse(version.tags) : version.tags,
      sort_order: version.sort_order ?? existing.sort_order,
      updated_at: now(),
      search_text: extractPlainText(
        typeof version.content === "string" ? JSON.parse(version.content) : version.content
      ),
    };
    await putRecord(noteStore, restored);
    return noteFromDB(restored);
  });
}
