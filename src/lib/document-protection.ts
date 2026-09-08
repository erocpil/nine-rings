import type { DeltaOps, Note } from "../types/models";
import { createDocumentKey, decryptDocument, documentSessionKey, encryptDocument, isEncrypted, unlockDocument, type DocumentKey, type ProtectedPath } from "./document-crypto";
import { requestPassword } from "./password-request";
import { commitProtectionState, readProtectionState, withProtectionWrite, type ProtectionSnapshot, type ProtectionState } from "./storage/protection-state";
import { isPathUnder, normalizeStoragePath, now } from "./storage/core";
import { resolveImageRefs, cleanupProtectedImages } from "./storage/db-images";
import { invalidateWebSearchIndex } from "./web-search-index";
import { clearEditorSessionCache } from "./editor-session-cache";
import { broadcastDataChange } from "./tab-coordination";
import { isTauriRuntime } from "./runtime";

export const PROTECTION_NOTICE = "正文、正文书签和本地图片将加密，历史正文一并处理；标题、路径、标签、概念仍公开。密码遗失无法找回。已导出的明文备份、Git 历史、共享图片和外部图片原文件不会被追溯加密。";
export function pathProtection(paths: ProtectedPath[], path?: string): ProtectedPath | undefined {
  return path ? paths.find(p => isPathUnder(normalizeStoragePath(path), p.path)) : undefined;
}
export async function requestDocumentKey(content: DeltaOps, label: string, noteId?: string): Promise<DocumentKey> {
  const session = noteId ? documentSessionKey(noteId) : undefined;
  if (session) { await decryptDocument(content, session); return session; }
  return requestPassword({ title: "验证文档密码", description: label }, async password => (await unlockDocument(content, password)).key);
}
export async function requestPathKey(path: ProtectedPath): Promise<DocumentKey> {
  return requestPassword({ title: "验证路径密码", description: `${path.path}/\n此路径及其子文档共用此密码。` }, async password => (await unlockDocument(path.verifier, password)).key);
}
export async function sealContent(content: DeltaOps, key: DocumentKey): Promise<DeltaOps> {
  return encryptDocument(await resolveImageRefs(content), key);
}
export async function commitProtectedChanges(before: ProtectionSnapshot, after: ProtectionState): Promise<void> {
  await commitProtectionState(before, after);
  clearEditorSessionCache();
  invalidateWebSearchIndex();
  for (const note of after.notes) {
    if (JSON.stringify(note) !== JSON.stringify(before.notes.find(n => n.id === note.id))) broadcastDataChange({ type: "note-changed", noteId: note.id });
  }
  broadcastDataChange({ type: "data-imported" });
  // Only removes blobs no longer referenced by any plaintext current/history
  // record. Shared images deliberately remain with their other documents.
  if (isTauriRuntime()) {
    try { await cleanupProtectedImages(before, after); }
    catch { throw new Error("正文和历史已加密保存，但旧本地图片副本清理失败；请保留原数据并重试清理，不能视为图片保护已完成"); }
  }
}

async function rewriteNotes(state: ProtectionState, ids: Set<string>, nextKey: DocumentKey | null, keys: Map<string, DocumentKey>): Promise<void> {
  const rewrite = async (content: DeltaOps, note: Note): Promise<DeltaOps> => {
    let plain = content;
    if (isEncrypted(content)) {
      const id = content.encrypted.protectionId;
      let key = keys.get(id);
      if (!key) { key = await requestDocumentKey(content, note.title || note.id, note.id); keys.set(id, key); }
      plain = await decryptDocument(content, key);
    }
    return nextKey ? sealContent(plain, nextKey) : plain;
  };
  for (const note of state.notes) {
    if (!ids.has(note.id)) continue;
    note.content = await rewrite(note.content, note);
    note.updated_at = now();
    for (const version of state.versions.filter(v => v.note_id === note.id)) version.content = await rewrite(version.content, note);
  }
}

export async function setDocumentPassword(noteId: string, remove = false): Promise<void> {
  return withProtectionWrite(async () => {
    const before = await readProtectionState();
    const current = before.notes.find(n => n.id === noteId && !n.deleted_at);
    if (!current) throw new Error("文档不存在");
    const path = pathProtection(before.paths, current.storagePath);
    if (path) throw new Error(`此文档继承 ${path.path}/ 的密码，请在目录菜单中管理`);
    const keys = new Map<string, DocumentKey>();
    if (isEncrypted(current.content)) {
      // Explicit password verification is required even for an open editor when
      // changing/removing its protection.
      const key = await requestDocumentKey(current.content, `${current.title || "文档"}：请验证原密码`);
      keys.set(key.protectionId, key);
    } else if (remove) throw new Error("文档尚未加密");
    const key = remove ? null : await requestPassword({ title: "设置文档密码", description: PROTECTION_NOTICE, newPassword: true }, createDocumentKey);
    const after = structuredClone(before);
    await rewriteNotes(after, new Set([noteId]), key, keys);
    await commitProtectedChanges(before, after);
  });
}

export async function setPathPassword(input: string, remove = false): Promise<void> {
  const path = normalizeStoragePath(input);
  return withProtectionWrite(async () => {
    const before = await readProtectionState();
    const existing = before.paths.find(p => p.path === path);
    if (before.paths.some(p => p !== existing && (isPathUnder(path, p.path) || isPathUnder(p.path, path)))) throw new Error("暂不支持父子路径分别设置密码，请在已有加密路径上管理");
    if (remove && !existing) throw new Error("路径尚未加密");
    const keys = new Map<string, DocumentKey>();
    if (existing) { const key = await requestPathKey(existing); keys.set(key.protectionId, key); }
    const key = remove ? null : await requestPassword({ title: "设置路径密码", description: `${path}/\n全部子文档（包括回收站中的文档）共用此密码。删空后路径仍保留。\n${PROTECTION_NOTICE}`, newPassword: true }, createDocumentKey);
    const after = structuredClone(before);
    const ids = new Set(after.notes.filter(n => n.storagePath && isPathUnder(n.storagePath, path)).map(n => n.id));
    await rewriteNotes(after, ids, key, keys);
    after.paths = after.paths.filter(p => p.path !== path);
    if (key) after.paths.push({ id: key.protectionId, path, createdAt: existing?.createdAt ?? now(), updatedAt: now(), verifier: await encryptDocument({ ops: [{ insert: "nine-rings:path-verifier:v1" }] }, key) });
    await commitProtectedChanges(before, after);
  });
}
export async function removeEmptyProtectedPath(input: string): Promise<void> {
  return withProtectionWrite(async () => {
    const before = await readProtectionState();
    const existing = before.paths.find(p => p.path === normalizeStoragePath(input));
    if (!existing) throw new Error("加密路径不存在");
    if (before.notes.some(n => !n.deleted_at && n.storagePath && isPathUnder(n.storagePath, existing.path))) throw new Error("请先移走或删除此路径下的文档");
    await requestPathKey(existing);
    await commitProtectedChanges(before, { ...before, paths: before.paths.filter(p => p.id !== existing.id) });
  });
}

export async function moveProtectedDocuments(ids: string[], target: string, before: ProtectionSnapshot): Promise<void> {
  const after = structuredClone(before);
  const path = normalizeStoragePath(target);
  const protection = pathProtection(after.paths, path);
  const key = protection ? await requestPathKey(protection) : null;
  const keys = new Map<string, DocumentKey>();
  if (key) keys.set(key.protectionId, key);
  for (const id of ids) {
    const note = after.notes.find(n => n.id === id && !n.deleted_at);
    if (!note) throw new Error("移动的文档不存在");
    if (isEncrypted(note.content)) {
      if (!keys.has(note.content.encrypted.protectionId)) {
        const old = await requestDocumentKey(note.content, note.title || id, id);
        keys.set(old.protectionId, old);
      }
    }
    if (key && (!isEncrypted(note.content) || note.content.encrypted.protectionId !== key.protectionId)) await rewriteNotes(after, new Set([id]), key, keys);
    // Moving outside protection retains the document's ciphertext/password.
    note.storagePath = path;
  }
  await commitProtectedChanges(before, after);
}

export async function relocateProtectedFolder(source: string, target: string): Promise<number> {
  return withProtectionWrite(async () => {
    const from = normalizeStoragePath(source), to = normalizeStoragePath(target);
    if (isPathUnder(to, from)) throw new Error("不能移动到自身或子目录");
    const before = await readProtectionState();
    const after = structuredClone(before);
    const keys = new Map<string, DocumentKey>();
    const movedPaths = after.paths.filter(p => isPathUnder(p.path, from));
    for (const p of movedPaths) {
      const key = await requestPathKey(p); keys.set(key.protectionId, key);
      p.path = to + p.path.slice(from.length); p.updatedAt = now();
    }
    const moved = after.notes.filter(n => n.storagePath && isPathUnder(n.storagePath, from));
    for (const note of moved) {
      const next = to + note.storagePath!.slice(from.length);
      const destination = pathProtection(after.paths, next);
      if (isEncrypted(note.content) && !keys.has(note.content.encrypted.protectionId)) {
        const key = await requestDocumentKey(note.content, note.title || note.id, note.id); keys.set(key.protectionId, key);
      }
      if (destination && (!isEncrypted(note.content) || note.content.encrypted.protectionId !== destination.id)) {
        let key = keys.get(destination.id);
        if (!key) { key = await requestPathKey(destination); keys.set(key.protectionId, key); }
        await rewriteNotes(after, new Set([note.id]), key, keys);
      }
      note.storagePath = next;
    }
    await commitProtectedChanges(before, after);
    return moved.length;
  });
}
