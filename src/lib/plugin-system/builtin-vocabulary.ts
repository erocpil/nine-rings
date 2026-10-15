import { documentNavigation } from "./document-navigation";
import { readVocabularySort, sortVocabulary } from "../vocabulary-reading-state";
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
import type { Note } from "../../types/models";
export type VocabularyDocumentSummary = Pick<
  Note,
  "id" | "title" | "storagePath" | "created_at" | "updated_at"
>;
import { subscribeToDataChanges } from "../tab-coordination";
export const VOCABULARY_ID = "nine-rings.builtin-vocabulary";
export const VOCABULARY_VIEW = "builtin.vocabulary";
const KEY = "nr:pluginVocabulary";
const EVENT = "nr:plugin-vocabulary-change";
export const vocabularyListFonts = {
  interface: "界面字体",
  editor: "正文字体",
  sans: "无衬线字体",
  serif: "衬线字体",
  mono: "等宽字体",
} as const;
export interface VocabularyListAppearance {
  listFont: keyof typeof vocabularyListFonts;
  listFontSize: number;
  listLineHeight: number;
  listRowHeight: number;
}
export const defaultVocabularyListAppearance: VocabularyListAppearance = {
  listFont: "interface",
  listFontSize: 16,
  listLineHeight: 1.5,
  listRowHeight: 40,
};
function listAppearance(
  value: Partial<VocabularyListAppearance>,
): VocabularyListAppearance {
  const number = (
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
      ? value
      : fallback;
  return {
    listFont:
      typeof value.listFont === "string" &&
      Object.prototype.hasOwnProperty.call(vocabularyListFonts, value.listFont)
        ? value.listFont
        : "interface",
    listFontSize: number(value.listFontSize, 12, 28, 16),
    listLineHeight: number(value.listLineHeight, 1.2, 2.4, 1.5),
    listRowHeight: number(value.listRowHeight, 28, 72, 40),
  };
}
export interface VocabularyPreference extends VocabularyListAppearance {
  enabled: boolean;
  path: string;
  collapseExamples: boolean;
}
export const defaultVocabularyPreference: VocabularyPreference = {
  ...defaultVocabularyListAppearance,
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
        ...listAppearance(value),
        enabled: value.enabled,
        path: normalizeStoragePath(value.path),
        collapseExamples: value.collapseExamples,
      };
  } catch {
    /* Damaged preference falls back without granting access. */
  }
  return { ...defaultVocabularyPreference };
}
export function saveVocabularyPreference(
  value: Pick<VocabularyPreference, "enabled" | "path" | "collapseExamples"> &
    Partial<VocabularyListAppearance>,
) {
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
      ...listAppearance(value),
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
              mainViews.bind(owner.activation).register({
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
              documentNavigation.register(owner.activation, VOCABULARY_VIEW, {
                async list() {
                  return sortVocabulary(await vocabularyDocuments.list(), readVocabularySort()).map(note => ({ id: note.id, title: note.title || "无标题", scope: note.storagePath || "" }));
                },
                async open(id, currentId) {
                  const before = mainViews.getSnapshot();
                  if (before.suspended || before.current?.renderer !== "vocabulary" || before.current.data.documentId !== currentId) return;
                  const data = await vocabularyDocuments.read(id);
                  const after = mainViews.getSnapshot();
                  if (before.current !== after.current || after.suspended) return;
                  mainViews.bind(owner.activation).open(VOCABULARY_VIEW, data);
                },
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
  const identity = () => {
    const { enabled, path } = readVocabularyPreference();
    return JSON.stringify([enabled, path]);
  };
  let previousIdentity = identity();
  const preference = subscribeVocabulary(() => {
    const next = identity();
    if (next !== previousIdentity) {
      previousIdentity = next;
      reconcile();
    }
  });
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
    const summaries = await api.docs.summaries({ storagePath: path });
    pluginRuntime.assert(owner, "documents.vocabulary.read");
    return summaries
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
      .slice(0, 5000)
      .map(
        (note) =>
          ({
            id: note.id,
            title: note.title,
            storagePath: note.storagePath,
            created_at: note.created_at,
            updated_at: note.updated_at,
          }) satisfies VocabularyDocumentSummary,
      );
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
