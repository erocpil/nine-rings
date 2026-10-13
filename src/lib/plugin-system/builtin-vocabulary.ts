import { pluginRuntime, PluginHostError } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import { workspacePanels } from "./panel-registry";
import { mainViews } from "./main-view-registry";
import { api } from "../api";
import { isEncrypted } from "../document-crypto";
import {
  listProtectedPaths,
  withProtectionWrite,
} from "../storage/protection-state";
import { isPathUnder, normalizeStoragePath } from "../storage/core";
import { workspaceDocuments } from "../workspace-summary";
import { subscribeToDataChanges } from "../tab-coordination";
export const VOCABULARY_ID = "nine-rings.builtin-vocabulary";
export const VOCABULARY_VIEW = "builtin.vocabulary";
const KEY = "nr:pluginVocabulary";
const EVENT = "nr:plugin-vocabulary-change";
export interface VocabularyPreference {
  enabled: boolean;
  path: string;
  collapseExamples: boolean;
}
export const defaultVocabularyPreference: VocabularyPreference = {
  enabled: false,
  path: "references/vocabulary",
  collapseExamples: true,
};
export function vocabularySnapshot() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function readVocabularyPreference(): VocabularyPreference {
  try {
    const value = JSON.parse(vocabularySnapshot() ?? "null");
    if (
      value &&
      typeof value.path === "string" &&
      normalizeStoragePath(value.path) &&
      value.path.length <= 1024 &&
      typeof value.enabled === "boolean" &&
      typeof value.path === "string" &&
      typeof value.collapseExamples === "boolean"
    )
      return {
        enabled: value.enabled,
        path: normalizeStoragePath(value.path),
        collapseExamples: value.collapseExamples,
      };
  } catch {
    /* Damaged preference falls back without granting access. */
  }
  return { ...defaultVocabularyPreference };
}
export function saveVocabularyPreference(value: VocabularyPreference) {
  const path = normalizeStoragePath(value.path);
  if (
    !path ||
    path.length > 1024 ||
    typeof value.enabled !== "boolean" ||
    typeof value.collapseExamples !== "boolean"
  )
    throw new Error("请填写有效的词汇路径");
  localStorage.setItem(
    KEY,
    JSON.stringify({
      enabled: value.enabled,
      path,
      collapseExamples: value.collapseExamples,
    }),
  );
  window.dispatchEvent(new Event(EVENT));
}
export function subscribeVocabulary(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (!event.key || event.key === KEY) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
export function startBuiltinVocabulary() {
  let stopped = false,
    revision = 0,
    enabled = pluginRuntime.isEnabled();
  let queue = Promise.resolve();
  const reconcile = () => {
    const requested = ++revision;
    queue = queue
      .then(async () => {
        if (stopped || requested !== revision) return;
        await pluginLifecycle.deactivate(VOCABULARY_ID);
        if (
          stopped ||
          requested !== revision ||
          !pluginRuntime.isEnabled() ||
          !readVocabularyPreference().enabled
        )
          return;
        await pluginLifecycle.activate(
          VOCABULARY_ID,
          ["panels.present", "views.present", "documents.vocabulary.read"],
          {
            activate(owner) {
              mainViews
                .bind(owner.activation)
                .register({
                  id: VOCABULARY_VIEW,
                  label: "词汇学习",
                  renderer: "vocabulary",
                });
              workspacePanels.register(owner.activation, {
                id: "vocabulary",
                label: "词汇学习",
                renderer: "vocabulary-library",
                icon: "book",
              });
              owner.own(
                subscribeToDataChanges((event) => {
                  const current = mainViews.getSnapshot().current;
                  if (
                    current?.owner === owner.activation &&
                    current.renderer === "vocabulary" &&
                    (event.type === "data-imported" ||
                      event.noteId === current.data.documentId)
                  )
                    mainViews.close(current.id);
                }),
              );
            },
          },
        );
      })
      .catch(() => {
        /* Supervised lifecycle records failures; host remains usable. */
      });
  };
  const runtime = pluginRuntime.subscribe(() => {
    const next = pluginRuntime.isEnabled();
    if (next !== enabled) {
      enabled = next;
      reconcile();
    }
  });
  const preference = subscribeVocabulary(reconcile);
  reconcile();
  return () => {
    stopped = true;
    ++revision;
    runtime();
    preference();
    void pluginLifecycle.deactivate(VOCABULARY_ID).catch(() => {});
  };
}
/** Scoped host read service; no raw database or arbitrary document reads exposed. */
export const vocabularyDocuments = {
  async list() {
    const owner = workspacePanels.assert("vocabulary");
    const path = readVocabularyPreference().path;
    const protectedPaths = await listProtectedPaths();
    pluginRuntime.assert(owner, "documents.vocabulary.read");
    const tree = await api.docs.tree();
    pluginRuntime.assert(owner, "documents.vocabulary.read");
    return workspaceDocuments(tree)
      .filter(
        (note) =>
          isPathUnder(note.storagePath ?? "", path) &&
          !protectedPaths.some((item) =>
            isPathUnder(note.storagePath ?? "", item.path),
          ),
      )
      .sort(
        (a, b) =>
          (a.title ?? "").localeCompare(b.title ?? "") ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 5000);
  },
  async read(id: string) {
    const owner = workspacePanels.assert("vocabulary");
    return withProtectionWrite(async () => {
      pluginRuntime.assert(owner, "documents.vocabulary.read");
      const note = await api.notes.get(id);
      pluginRuntime.assert(owner, "documents.vocabulary.read");
      if (!note) throw new PluginHostError("STALE_TARGET", "词汇文档已不存在");
      if (
        !isPathUnder(note.storagePath ?? "", readVocabularyPreference().path) ||
        isEncrypted(note.content)
      )
        throw new PluginHostError(
          "PERMISSION_DENIED",
          "词汇插件不读取路径之外或受保护的正文",
        );
      const paths = await listProtectedPaths();
      pluginRuntime.assert(owner, "documents.vocabulary.read");
      if (paths.some((item) => isPathUnder(note.storagePath ?? "", item.path)))
        throw new PluginHostError(
          "PERMISSION_DENIED",
          "词汇插件不读取受保护路径",
        );
      const { noteToMarkdown } = await import("../markdown-serializer");
      const source = noteToMarkdown(note.title, note.content);
      pluginRuntime.assert(owner, "documents.vocabulary.read");
      if (source.length > 250000)
        throw new PluginHostError(
          "INVALID_ARGUMENT",
          "词汇文档过大，请使用普通文档查看",
        );
      return { documentId: note.id, title: note.title ?? "无标题", source };
    });
  },
};
