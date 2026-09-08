import type { Note, NoteVersion } from "../../types/models";
import type { ProtectedPath } from "../document-crypto";
import { isEncrypted, validateEncryptedContent } from "../document-crypto";
import { isTauriRuntime } from "../runtime";
import { withDB, getAll, putRecord, delRecord } from "./db";
import { extractPlainText, isPathUnder, normalizeStoragePath, noteFromDB, noteToDB, type StoredNote } from "./core";

export interface ProtectionState { notes: Note[]; versions: NoteVersion[]; paths: ProtectedPath[] }
export interface ProtectionSnapshot extends ProtectionState { revision: string }
export const PROTECTION_WRITE_LOCK = "nine-rings:document-protection-write:v1";
let queue: Promise<unknown> = Promise.resolve();
export function withProtectionWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => globalThis.navigator?.locks
    ? await navigator.locks.request(PROTECTION_WRITE_LOCK, task) : await task();
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
type StoredVersion = Omit<NoteVersion, "content" | "tags"> & { content: NoteVersion["content"] | string; tags: string[] | string };
async function readState(tx: IDBTransaction): Promise<ProtectionState> {
  const [notes, versions, paths] = await Promise.all([
    getAll<StoredNote>(tx.objectStore("notes")), getAll<StoredVersion>(tx.objectStore("note_versions")),
    getAll<ProtectedPath>(tx.objectStore("protected_paths")),
  ]);
  return {
    notes: notes.map(noteFromDB),
    versions: versions.map(v => ({ ...v, content: typeof v.content === "string" ? JSON.parse(v.content) : v.content, tags: typeof v.tags === "string" ? JSON.parse(v.tags) : v.tags })),
    paths,
  };
}
function revision(state: ProtectionState): string {
  return JSON.stringify([state.notes, state.versions, state.paths].map(rows => [...rows].sort((a, b) => a.id.localeCompare(b.id))));
}
export async function readProtectionState(): Promise<ProtectionSnapshot> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ProtectionSnapshot>("protection_snapshot");
  }
  const state = await withDB(db => readState(db.transaction(["notes", "note_versions", "protected_paths"])));
  return { ...state, revision: revision(state) };
}
export function validateProtectionState(state: ProtectionState): void {
  const ids = new Set<string>();
  for (const path of state.paths) {
    if (!path.id || ids.has(path.id) || normalizeStoragePath(path.path) !== path.path) throw new Error("加密路径记录无效");
    ids.add(path.id);
    validateEncryptedContent(path.verifier);
    if (path.verifier.encrypted.protectionId !== path.id) throw new Error("加密路径身份不匹配");
    if (state.paths.some(other => other.id !== path.id && (isPathUnder(path.path, other.path) || isPathUnder(other.path, path.path)))) throw new Error("暂不支持重叠的加密路径，请统一使用父路径密码");
  }
  for (const note of state.notes) {
    if (isEncrypted(note.content)) validateEncryptedContent(note.content);
    const path = state.paths.find(p => note.storagePath && isPathUnder(note.storagePath, p.path));
    if (path && (!isEncrypted(note.content) || note.content.encrypted.protectionId !== path.id || note.content.encrypted.salt !== path.verifier.encrypted?.salt)) {
      throw new Error(`文档“${note.title || note.id}”未使用所在加密路径的密码，请先解锁路径再导入或移动`);
    }
  }
  for (const version of state.versions) {
    const note = state.notes.find(n => n.id === version.note_id);
    if (isEncrypted(version.content)) validateEncryptedContent(version.content);
    if (note && isEncrypted(note.content) && (!isEncrypted(version.content) || version.content.encrypted.protectionId !== note.content.encrypted.protectionId || version.content.encrypted.salt !== note.content.encrypted.salt)) {
      throw new Error("加密文档的历史版本保护不一致");
    }
  }
}
export async function commitProtectionState(before: ProtectionSnapshot, after: ProtectionState): Promise<void> {
  validateProtectionState(after);
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("protection_commit", { revision: before.revision, data: { ...after, notes: after.notes.map(n => ({ ...n, search_text: extractPlainText(n.content) })) } });
    return;
  }
  await withDB(async db => {
    const tx = db.transaction(["notes", "note_versions", "protected_paths", "images"], "readwrite");
    const current = await readState(tx);
    if (revision(current) !== before.revision) throw new Error("文档或路径已被其他窗口修改，请重新操作；本次未写入数据");
    const nextNotes = new Map(after.notes.map(n => [n.id, n]));
    // Protection operations do not physically delete documents or history.
    if (before.notes.some(n => !nextNotes.has(n.id)) || before.versions.some(v => !after.versions.some(n => n.id === v.id))) throw new Error("加密事务不能删除正文或历史");
    for (const note of after.notes) {
      if (JSON.stringify(note) !== JSON.stringify(before.notes.find(n => n.id === note.id))) await putRecord(tx.objectStore("notes"), noteToDB(note));
    }
    for (const version of after.versions) {
      if (JSON.stringify(version) !== JSON.stringify(before.versions.find(v => v.id === version.id))) await putRecord(tx.objectStore("note_versions"), version);
    }
    tx.objectStore("protected_paths").clear();
    for (const path of after.paths) await putRecord(tx.objectStore("protected_paths"), path);
    const imageRefs = (value: unknown) => new Set(JSON.stringify(value).match(/nr-image:\/\/[a-zA-Z0-9-]+/g) ?? []);
    const oldRefs = imageRefs([before.notes, before.versions]);
    const keepRefs = imageRefs([after.notes, after.versions]);
    for (const ref of oldRefs) if (!keepRefs.has(ref)) await delRecord(tx.objectStore("images"), ref.slice("nr-image://".length));
  });
}
export async function listProtectedPaths(): Promise<ProtectedPath[]> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ProtectedPath[]>("protected_paths_list");
  }
  return withDB(db => getAll<ProtectedPath>(db.transaction("protected_paths").objectStore("protected_paths")));
}
