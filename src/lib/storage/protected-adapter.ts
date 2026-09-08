import type { StorageAdapter } from "./types";
import type { CreateNoteInput, Note, UpdateNoteInput, PathNode, NoteVersion } from "../../types/models";
import { decryptDocument, isEncrypted, validateEncryptedContent, type ProtectedPath } from "../document-crypto";
import { listProtectedPaths, readProtectionState, withProtectionWrite, validateProtectionState } from "./protection-state";
import { commitProtectedChanges, moveProtectedDocuments, pathProtection, relocateProtectedFolder, requestDocumentKey, requestPathKey, sealContent } from "../document-protection";
import { isPathUnder, normalizeStoragePath, now } from "./core";
import { validateBackup } from "../backup-validation";
import { snakeImportToCamel } from "./normalize";

/** All normal reads stay ciphertext, including when an editor is unlocked. */
export function protectedAdapter(raw: StorageAdapter): StorageAdapter {
  const prepareCreate = async (data: CreateNoteInput): Promise<CreateNoteInput> => {
    const path = pathProtection(await listProtectedPaths(), data.storagePath);
    if (!path) return data;
    const key = await requestPathKey(path);
    let content = data.content ?? { ops: [] };
    if (isEncrypted(content)) {
      const old = await requestDocumentKey(content, data.title || "导入文档");
      content = await decryptDocument(content, old);
    }
    return { ...data, storagePath: normalizeStoragePath(data.storagePath!), content: await sealContent(content, key) };
  };
  const update = async (id: string, data: UpdateNoteInput): Promise<Note> => {
    const note = await raw.getNote(id);
    if (!note) throw new Error("文档不存在");
    if (data.storagePath !== undefined && data.storagePath !== note.storagePath) {
      const before = await readProtectionState();
      if (isEncrypted(note.content) || pathProtection(before.paths, data.storagePath) || pathProtection(before.paths, note.storagePath)) {
        // Property editing must use the same atomic boundary transition as DnD.
        if (data.content !== undefined) throw new Error("请先保存正文，再单独移动加密文档");
        await moveProtectedDocuments([id], data.storagePath, before);
      }
    }
    let content = data.content;
    if (isEncrypted(note.content) && content !== undefined) {
      if (isEncrypted(content)) {
        validateEncryptedContent(content);
        if (content.encrypted.protectionId !== note.content.encrypted.protectionId || content.encrypted.salt !== note.content.encrypted.salt) throw new Error("不能直接替换文档密码，请使用加密管理");
      } else content = await sealContent(content, await requestDocumentKey(note.content, note.title || id, id));
    }
    const path = pathProtection(await listProtectedPaths(), data.storagePath ?? note.storagePath);
    if (path && !isEncrypted(content ?? note.content)) throw new Error("此文档位于加密路径，请重新打开后保存");
    return raw.updateNote(id, { ...data, ...(content ? { content } : {}) });
  };

  const adapter: StorageAdapter = {
    ...raw,
    createNote: data => withProtectionWrite(async () => raw.createNote(await prepareCreate(data))),
    upsertNote: data => withProtectionWrite(async () => {
      // Preserve the matched document's password even when importing Markdown
      // into an individually protected (not path-protected) document.
      const candidates = data.storagePath ? await raw.getNotesByPath(data.storagePath) : await raw.getNotesByDate(data.date);
      const existing = candidates.filter(n => n.title === data.title && (n.storagePath ?? "") === (data.storagePath ?? ""))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (existing && isEncrypted(existing.content)) return update(existing.id, data);
      return raw.upsertNote(await prepareCreate(data));
    }),
    updateNote: (id, data) => withProtectionWrite(() => update(id, data)),
    deleteNote: id => withProtectionWrite(() => raw.deleteNote(id)),
    batchDelete: ids => withProtectionWrite(() => raw.batchDelete(ids)),
    updateNoteOrder: (id, order) => withProtectionWrite(() => raw.updateNoteOrder(id, order)),
    batchSetReadonly: (ids, readonly) => withProtectionWrite(() => raw.batchSetReadonly(ids, readonly)),
    restoreNote: id => withProtectionWrite(async () => {
      const before = await readProtectionState();
      const note = before.notes.find(n => n.id === id);
      if (note && isEncrypted(note.content)) await requestDocumentKey(note.content, note.title || id);
      validateProtectionState(before);
      return raw.restoreNote(id);
    }),
    permanentlyDeleteNote: id => withProtectionWrite(() => raw.permanentlyDeleteNote(id)),
    cleanOldDeleted: days => withProtectionWrite(() => raw.cleanOldDeleted(days)),
    createNoteCheckpoint: id => withProtectionWrite(() => raw.createNoteCheckpoint(id)),
    restoreNoteVersion: id => withProtectionWrite(async () => {
      const before = await readProtectionState();
      const v = before.versions.find(v => v.id === id);
      const note = before.notes.find(n => n.id === v?.note_id);
      if (!v || !note) throw new Error("历史版本不存在");
      if (!isEncrypted(note.content) && !isEncrypted(v.content)) return raw.restoreNoteVersion(id);
      const key = await requestDocumentKey(note.content, note.title || note.id, note.id);
      await decryptDocument(v.content, key);
      const after = structuredClone(before);
      after.versions.push({ id: crypto.randomUUID(), note_id: note.id, title: note.title, content: note.content, tags: note.tags, pinned: note.pinned, sort_order: note.sort_order, saved_at: now() });
      const restored = { ...note, title: v.title, content: v.content, tags: v.tags, updated_at: now() };
      after.notes = after.notes.map(n => n.id === note.id ? restored : n);
      await commitProtectedChanges(before, after);
      return restored;
    }),
    getPathTree: async includeDaily => {
      const [nodes, paths] = await Promise.all([raw.getPathTree(includeDaily), listProtectedPaths()]);
      const folders = new Map(nodes.filter(n => n.type === "folder").map(n => [n.path, n]));
      for (const p of paths) {
        const parts = p.path.split("/");
        for (let i = 1; i <= parts.length; i++) {
          const path = parts.slice(0, i).join("/");
          if (!folders.has(path)) {
            const node: PathNode = { type: "folder", path, name: parts[i - 1], count: 0 };
            nodes.push(node); folders.set(path, node);
          }
        }
      }
      return nodes.map(n => ({ ...n, protected: paths.some(p => isPathUnder(n.path, p.path)), protectionRoot: paths.some(p => n.path === p.path) }));
    },
    moveDocument: (id, target) => withProtectionWrite(async () => {
      const before = await readProtectionState();
      await moveProtectedDocuments([id], target, before); return 1;
    }),
    batchMoveDocuments: (ids, target) => withProtectionWrite(async () => moveProtectedDocuments(ids, target, await readProtectionState())),
    relocateFolder: relocateProtectedFolder,
    renameFolder: relocateProtectedFolder,
    exportNoteMarkdown: async id => {
      const note = await raw.getNote(id);
      if (isEncrypted(note?.content)) throw new Error("加密文档不能从列表导出明文，请先输入密码打开文档后使用编辑器导出");
      return raw.exportNoteMarkdown(id);
    },
    importData: (json, mode = "merge") => withProtectionWrite(async () => {
      const bundle = JSON.parse(json);
      validateBackup(bundle);
      const before = await readProtectionState();
      const incomingPaths = (bundle.protected_paths ?? []) as ProtectedPath[];
      if (mode === "replace" && before.paths.some(p => !incomingPaths.some(n => n.id === p.id && n.path === p.path))) throw new Error("覆盖备份缺少现有加密路径；请先明确解除或删除相应路径保护，再恢复旧备份");
      const paths = mode === "replace" ? incomingPaths : [...new Map([...before.paths, ...incomingPaths].map(p => [p.id, p])).values()];
      const incoming = bundle.notes.map(n => snakeImportToCamel(n) as unknown as Note);
      const versions = (bundle.protected_versions ?? []) as NoteVersion[];
      for (const note of incoming) {
        const old = before.notes.find(n => n.id === note.id);
        const path = pathProtection(paths, note.storagePath);
        if (!isEncrypted(note.content) && (path || isEncrypted(old?.content))) {
          const key = path ? await requestPathKey(path) : await requestDocumentKey(old!.content, old!.title || old!.id);
          note.content = await sealContent(note.content, key);
        }
        if (isEncrypted(note.content) && mode === "merge") {
          for (const v of before.versions.filter(v => v.note_id === note.id && !versions.some(n => n.id === v.id))) {
            if (!isEncrypted(v.content) || v.content.encrypted.protectionId !== note.content.encrypted.protectionId || v.content.encrypted.salt !== note.content.encrypted.salt) {
              const newKey = await requestDocumentKey(note.content, `${note.title || note.id}：验证备份密码以保护本地历史`);
              const plain = isEncrypted(v.content) ? await decryptDocument(v.content, await requestDocumentKey(v.content, "验证本地旧历史密码")) : v.content;
              versions.push({ ...v, content: await sealContent(plain, newKey) });
            }
          }
        }
      }
      const mergedNotes = mode === "replace" ? incoming : [...new Map([...before.notes, ...incoming].map(n => [n.id, n])).values()];
      const mergedVersions = mode === "replace" ? versions : [...new Map([...before.versions, ...versions].map(v => [v.id, v])).values()];
      validateProtectionState({ notes: mergedNotes, versions: mergedVersions, paths });
      return raw.importData(JSON.stringify({ ...bundle, notes: incoming, protected_paths: paths, protected_versions: versions }), mode);
    }),
  };
  return adapter;
}
