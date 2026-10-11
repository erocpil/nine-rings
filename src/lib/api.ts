import { normalizeStoragePath } from "./storage/core";
import { conceptSearchKey } from "./concept-identity";
import { mergeDocumentConcepts } from "./document-protection";
import { pathNormalizationCollisions } from "./path-normalization";
import type { StorageAdapter, DocSearchQuery } from "./storage/types";
import { getAdapter } from "./storage";
import type { AppConfig, CreateNoteInput, UpdateNoteInput, Note } from "../types/models";
import { broadcastDataChange } from "./tab-coordination";
import { invalidateWebSearchIndex, removeFromWebSearchIndex, searchWebNotes, searchWebNoteSummaries, searchDocumentSummaries, updateWebSearchIndex } from "./web-search-index";
import { addFrontendSettingsToBackup, withFrontendSettings } from "./backup-user-settings";
import { parseJsonAsync, stringifyJsonAsync } from "./data-transform-client";
import { validateBackup } from "./backup-validation";
import { assertRestoreContext, withBackupRestore, type RestoreContext } from "./backup-restore-coordination";
import { coordinateDocumentUpdate, coordinateDocumentReplacement, coordinateStorageReplacement, coordinateStorageMutation, coordinateDocumentCheckpoint } from "./document-write-coordinator";
import type { SearchOptions } from "./search-matching";
import { compareDocumentMetadata } from "./storage/core";

/**
 * API 层 — 统一接口，底层自动适配 Tauri IPC / IndexedDB
 *
 * 所有 store/component 只通过此模块访问数据，不直接引用 storage adapter。
 */

let _adapterPromise: Promise<StorageAdapter> | null = null;
function adapter(): Promise<StorageAdapter> {
  if (!_adapterPromise) {
    _adapterPromise = getAdapter();
  }
  return _adapterPromise;
}

/** Bulk writes can partially succeed; invalidate even when the operation fails. */
async function withSearchRefresh<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  finally {
    invalidateWebSearchIndex();
    broadcastDataChange({ type: "data-imported" });
  }
}

export const api = {
  notes: {
    listByDate: (date: string) =>
      adapter().then((a) => a.getNotesByDate(date)),

    get: (id: string) =>
      adapter().then((a) => a.getNote(id)),

    /** 获取全部未删除文档，按日期倒序 */
    all: () =>
      adapter().then((a) => a.getAllNotes()),

    create: async (data: CreateNoteInput) => {
      const note = await adapter().then((a) => a.createNote(data));
      updateWebSearchIndex(note);
      broadcastDataChange({ type: "note-changed", noteId: note.id });
      return note;
    },

    /** Repeated source imports never silently replace an edited document. */
    importText: (data: CreateNoteInput) => coordinateStorageMutation(async () => {
      const input = structuredClone(data);
      input.storagePath = normalizeStoragePath(input.storagePath || "references");
      const filename = input.content?.metadata?.originalFileName;
      const rows = await adapter().then(a => a.getDocumentSummaries());
      const candidates = rows.filter(note => note.storagePath === input.storagePath &&
        (filename && note.originalFileName ? note.originalFileName === filename : note.title === input.title));
      if (candidates.length > 1) throw new Error("存在多份同来源或同名文档，请先明确导入目标");
      if (candidates.length === 1) {
        const existing = await api.notes.get(candidates[0].id);
        if (!existing) throw new Error("导入目标已变化，请重试");
        if (JSON.stringify(existing.content) === JSON.stringify(input.content)) return { status: "skipped" as const, note: existing };
        throw new Error(`来源或同名文档冲突：${existing.title || filename}，现有内容已保留，请另选路径或明确替换`);
      }
      return { status: "created" as const, note: await api.notes.create(input) };
    }),

    upsert: async (data: CreateNoteInput) => {
      const input = structuredClone(data);
      const note = await coordinateDocumentReplacement(() => adapter().then((a) => a.upsertNote(input)));
      updateWebSearchIndex(note);
      broadcastDataChange({ type: "note-changed", noteId: note.id });
      return note;
    },

    /** Trusted host replacement; deliberately absent from the plugin SDK. */
    replaceContent: async (id: string, content: Note["content"]) => {
      const snapshot = structuredClone(content);
      const note = await coordinateDocumentReplacement(() => adapter().then(a => a.updateNote(id, { content: snapshot })));
      updateWebSearchIndex(note);
      broadcastDataChange({ type: "note-changed", noteId: note.id });
      return note;
    },

    update: async (id: string, data: UpdateNoteInput) => {
      const note = await coordinateDocumentUpdate(id, data, snapshot => adapter().then((a) => a.updateNote(id, snapshot)));
      updateWebSearchIndex(note);
      broadcastDataChange({ type: "note-changed", noteId: id });
      return note;
    },

    updateOrder: (id: string, sort_order: number) =>
      coordinateDocumentUpdate(id, { sort_order }, snapshot => adapter().then((a) => a.updateNote(id, snapshot))).then(() => {}),

    delete: async (id: string) => {
      await coordinateStorageMutation(() => adapter().then((a) => a.deleteNote(id)));
      removeFromWebSearchIndex(id);
      broadcastDataChange({ type: "note-deleted", noteId: id });
    },

    search: (query: string) =>
      adapter().then((a) => searchWebNotes(a, query)),
    searchSummaries: (query: string, options?: SearchOptions) => adapter().then((a) => searchWebNoteSummaries(a, query, options)),

    listByTag: (tag: string) =>
      adapter().then((a) => a.getNotesByTag(tag)),
  },

  tags: {
    listAll: () =>
      adapter().then((a) => a.getAllTags()),

    /** 重命名标签（跨所有笔记） */
    rename: async (oldName: string, newName: string) => {
      if (oldName === newName || !newName.trim()) return { affected: 0 };
      const ad = await adapter();
      const notes = await ad.getNotesByTag(oldName);
      let affected = 0;
      for (const n of notes) {
        const updatedTags = n.tags
          .filter((t) => t !== oldName)
          .concat(newName);
        const updated = await coordinateDocumentUpdate(n.id, { tags: updatedTags }, snapshot => ad.updateNote(n.id, snapshot));
        updateWebSearchIndex(updated);
        broadcastDataChange({ type: "note-changed", noteId: n.id });
        affected++;
      }
      return { affected };
    },

    /** 合并标签：将 sourceName 合并到 targetName，移除 sourceName */
    merge: async (sourceName: string, targetName: string) => {
      if (sourceName === targetName || !sourceName.trim()) return { affected: 0 };
      const ad = await adapter();
      const notes = await ad.getNotesByTag(sourceName);
      let affected = 0;
      for (const n of notes) {
        const updatedTags = n.tags
          .filter((t) => t !== sourceName)
          .concat(targetName);
        const updated = await coordinateDocumentUpdate(n.id, { tags: updatedTags }, snapshot => ad.updateNote(n.id, snapshot));
        updateWebSearchIndex(updated);
        broadcastDataChange({ type: "note-changed", noteId: n.id });
        affected++;
      }
      return { affected };
    },

    /** 从所有笔记中移除指定标签 */
    remove: async (name: string) => {
      if (!name.trim()) return { affected: 0 };
      const ad = await adapter();
      const notes = await ad.getNotesByTag(name);
      let affected = 0;
      for (const n of notes) {
        const updatedTags = n.tags.filter((t) => t !== name);
        const updated = await coordinateDocumentUpdate(n.id, { tags: updatedTags }, snapshot => ad.updateNote(n.id, snapshot));
        updateWebSearchIndex(updated);
        broadcastDataChange({ type: "note-changed", noteId: n.id });
        affected++;
      }
      return { affected };
    },
  },

  export: {
    data: async () => addFrontendSettingsToBackup(await adapter().then((a) => a.exportData())),

    import: async (json: string, mode: "merge" | "replace" = "merge", context?: RestoreContext) => {
      const bundle = await parseJsonAsync<unknown>(json);
      validateBackup(bundle);
      const settings = bundle.user_settings as { values?: Record<string, unknown> } | undefined;
      const legacyTemplates = settings?.values?.["nine-rings:templates"];
      if (bundle.templates === undefined && legacyTemplates !== undefined) {
        bundle.templates = typeof legacyTemplates === "string" ? JSON.parse(legacyTemplates) : legacyTemplates;
        validateBackup(bundle);
        json = await stringifyJsonAsync(bundle);
      }
      // Templates belong to the adapter transaction, including legacy Web→Tauri imports.
      if (settings?.values && bundle.templates !== undefined) delete settings.values["nine-rings:templates"];
      const commit = async (operation: RestoreContext) => coordinateStorageReplacement(async () => {
        assertRestoreContext(operation);
        operation.setPhase("applying");
        const result = await withFrontendSettings(settings, async (settingsImported) => {
          const imported = await adapter().then((a) => a.importData(json, mode));
          if (settingsImported > 0) imported.configs_imported = (imported.configs_imported ?? 0) + settingsImported;
          return imported;
        });
        operation.markDataCommitted();
        invalidateWebSearchIndex();
        broadcastDataChange({ type: "data-imported" });
        return result;
      });
      return context ? commit(context) : withBackupRestore("file", mode, commit);
    },

    noteMarkdown: (noteId: string) =>
      adapter().then((a) => a.exportNoteMarkdown(noteId)),
  },

  recycle: {
    list: () => adapter().then((a) => a.getDeletedNotes()),

    restore: (id: string) =>
      withSearchRefresh(coordinateStorageMutation(() => adapter().then((a) => a.restoreNote(id)))),

    permanentlyDelete: (id: string) =>
      coordinateStorageMutation(() => adapter().then((a) => a.permanentlyDeleteNote(id))),

    cleanOld: (older_than_days: number) =>
      coordinateStorageMutation(() => adapter().then((a) => a.cleanOldDeleted(older_than_days))),

    batch: {
      delete: (ids: string[]) => {
        const targets = [...ids];
        return withSearchRefresh(coordinateStorageMutation(() => adapter().then((a) => a.batchDelete(targets))));
      },

      setReadonly: (ids: string[], readonly: boolean) => {
        const targets = [...ids];
        return withSearchRefresh(coordinateStorageMutation(() => adapter().then((a) => a.batchSetReadonly(targets, readonly))));
      },
    },
  },

  versions: {
    list: (noteId: string) =>
      adapter().then((a) => a.getNoteVersions(noteId)),

    restore: (versionId: string) =>
      withSearchRefresh(coordinateDocumentReplacement(() => adapter().then((a) => a.restoreNoteVersion(versionId)))),

    checkpoint: (noteId: string) =>
      coordinateDocumentCheckpoint(noteId, () => adapter().then((a) => a.createNoteCheckpoint(noteId))),
  },

  // ── Config ──
  config: {
    get: () => adapter().then((a) => a.getConfig()),
    set: (partial: Partial<AppConfig>) => adapter().then((a) => a.setConfig(partial)),
  },

  // ── Doc Tree（v2 文档分类系统）──
  docs: {
    mergeConcepts: (sources: string[], target: string) => withSearchRefresh(mergeDocumentConcepts(sources, target)),
    pathNormalizationReport: () => adapter().then(a => a.getPathTree()).then(nodes => pathNormalizationCollisions(nodes.filter(node => node.type === "folder").map(node => node.path))),
    summaries: (query: Pick<DocSearchQuery, "storagePath" | "docType" | "concept" | "staleBefore"> = {}) =>
      adapter().then(a => a.getDocumentSummaries()).then(notes => notes.filter(note =>
        (!query.storagePath || note.storagePath === query.storagePath || note.storagePath?.startsWith(`${query.storagePath}/`))
        && (!query.docType || note.docType === query.docType)
        && (!query.concept || note.concepts?.some(value => conceptSearchKey(value) === conceptSearchKey(query.concept!)))
        && (!query.staleBefore || Date.parse(note.updated_at) < Date.parse(query.staleBefore)))),
    tree: () =>
      adapter().then((a) => a.getPathTree()),

    listByPath: (pathPrefix: string) =>
      adapter().then((a) => a.getNotesByPath(pathPrefix)).then(notes => [...notes].sort(compareDocumentMetadata)),

    renameFolder: (oldPath: string, newPath: string) =>
      withSearchRefresh(coordinateStorageMutation(() => adapter().then((a) => a.renameFolder(oldPath, newPath)))),

    moveDocument: (noteId: string, targetFolderPath: string) =>
      withSearchRefresh(coordinateStorageMutation(() => adapter().then((a) => a.moveDocument(noteId, targetFolderPath)))),

    batchMoveDocuments: (noteIds: string[], targetFolderPath: string) => {
      const targets = [...noteIds];
      return withSearchRefresh(coordinateStorageMutation(() => adapter().then((a) => a.batchMoveDocuments(targets, targetFolderPath))));
    },

    relocateFolder: (sourcePath: string, targetPath: string) =>
      withSearchRefresh(coordinateStorageMutation(() => adapter().then((a) => a.relocateFolder(sourcePath, targetPath)))),

    search: (query: DocSearchQuery) =>
      adapter().then((a) => a.searchDocs({ ...query, concept: undefined })).then(notes => notes.filter(note => !query.concept || note.concepts?.some(value => conceptSearchKey(value) === conceptSearchKey(query.concept!))).sort(compareDocumentMetadata)),

    searchSummaries: (query: DocSearchQuery) =>
      adapter().then((a) => searchDocumentSummaries(a, query)),

    allConcepts: () =>
      adapter().then((a) => a.getAllConcepts()),
  },
};
