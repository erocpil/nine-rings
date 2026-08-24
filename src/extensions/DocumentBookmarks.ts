import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { DocumentBookmark } from "../types/models";
import { headingFoldPluginKey } from "./HeadingFold";

interface BookmarkState {
  bookmarks: DocumentBookmark[];
  decorations: DecorationSet;
}

type BookmarkMeta =
  | { type: "toggle"; position: number }
  | { type: "set-named"; key: string; position: number }
  | { type: "remove"; id: string }
  | { type: "rename"; id: string; label?: string };

interface BookmarkOptions {
  initialBookmarks: DocumentBookmark[];
  onChange?: (bookmarks: DocumentBookmark[], doc: ProseMirrorNode) => void;
}

export const documentBookmarkPluginKey = new PluginKey<BookmarkState>("nineRingsDocumentBookmarks");

function bookmarkId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `bookmark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function textblockAt(doc: ProseMirrorNode, position: number) {
  const clamped = Math.max(0, Math.min(doc.content.size, position));
  const $position = doc.resolve(clamped);
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.isTextblock) {
      return {
        node,
        nodePos: $position.before(depth),
        position: $position.start(depth),
      };
    }
  }
  let match: { node: ProseMirrorNode; nodePos: number; position: number } | null = null;
  doc.descendants((node, pos) => {
    if (match || !node.isTextblock) return true;
    if (pos >= clamped || pos + node.nodeSize >= clamped) {
      match = { node, nodePos: pos, position: pos + 1 };
      return false;
    }
    return true;
  });
  return match;
}

function previewAt(doc: ProseMirrorNode, position: number): string {
  const text = textblockAt(doc, position)?.node.textContent.trim() ?? "";
  return text ? text.slice(0, 80) : "空白段落";
}

function normalizeBookmarks(doc: ProseMirrorNode, bookmarks: DocumentBookmark[]): DocumentBookmark[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const normalized: DocumentBookmark[] = [];
  for (const bookmark of bookmarks) {
    if (!bookmark || typeof bookmark.id !== "string" || seenIds.has(bookmark.id)) continue;
    const key = typeof bookmark.key === "string" && /^[a-z]$/.test(bookmark.key) ? bookmark.key : undefined;
    if (key && seenKeys.has(key)) continue;
    const block = textblockAt(doc, Number(bookmark.position));
    if (!block) continue;
    seenIds.add(bookmark.id);
    if (key) seenKeys.add(key);
    normalized.push({
      id: bookmark.id,
      position: block.position,
      preview: bookmark.preview?.trim() || previewAt(doc, block.position),
      createdAt: bookmark.createdAt || new Date().toISOString(),
      ...(key ? { key } : {}),
      ...(bookmark.label?.trim() ? { label: bookmark.label.trim() } : {}),
    });
  }
  return normalized.sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
}

function sameBookmarks(left: DocumentBookmark[], right: DocumentBookmark[]): boolean {
  return left.length === right.length && left.every((bookmark, index) => {
    const other = right[index];
    return bookmark.id === other.id
      && bookmark.position === other.position
      && bookmark.preview === other.preview
      && bookmark.key === other.key
      && bookmark.label === other.label;
  });
}

function buildDecorations(doc: ProseMirrorNode, bookmarks: DocumentBookmark[]): DecorationSet {
  const decorated = new Set<number>();
  const decorations: Decoration[] = [];
  for (const bookmark of bookmarks) {
    const block = textblockAt(doc, bookmark.position);
    if (!block || decorated.has(block.nodePos)) continue;
    decorated.add(block.nodePos);
    decorations.push(Decoration.node(block.nodePos, block.nodePos + block.node.nodeSize, {
      class: "editor-bookmarked-block",
      "data-bookmarked": "true",
    }));
  }
  return DecorationSet.create(doc, decorations);
}

function createBookmark(doc: ProseMirrorNode, position: number, key?: string): DocumentBookmark | null {
  const block = textblockAt(doc, position);
  if (!block) return null;
  return {
    id: bookmarkId(),
    position: block.position,
    preview: previewAt(doc, block.position),
    createdAt: new Date().toISOString(),
    ...(key ? { key } : {}),
  };
}

export const DocumentBookmarks = Extension.create<BookmarkOptions>({
  name: "documentBookmarks",

  addOptions() {
    return { initialBookmarks: [] };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () => toggleBookmark(this.editor),
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin<BookmarkState>({
      key: documentBookmarkPluginKey,
      state: {
        init: (_, state) => {
          const bookmarks = normalizeBookmarks(state.doc, options.initialBookmarks);
          return { bookmarks, decorations: buildDecorations(state.doc, bookmarks) };
        },
        apply(transaction, previous, _oldState, nextState) {
          const meta = transaction.getMeta(documentBookmarkPluginKey) as BookmarkMeta | undefined;
          if (transaction.docChanged && previous.bookmarks.length === 0 && !meta) return previous;
          let bookmarks = previous.bookmarks;
          if (transaction.docChanged) {
            bookmarks = normalizeBookmarks(nextState.doc, bookmarks.map((bookmark) => {
              const position = transaction.mapping.map(bookmark.position, -1);
              return {
                ...bookmark,
                position,
                ...(position !== bookmark.position ? { preview: previewAt(nextState.doc, position) } : {}),
              };
            }));
          }
          if (meta?.type === "toggle") {
            const block = textblockAt(nextState.doc, meta.position);
            if (block) {
              const existing = bookmarks.find((bookmark) => bookmark.position === block.position);
              bookmarks = existing
                ? bookmarks.filter((bookmark) => bookmark.id !== existing.id)
                : [...bookmarks, createBookmark(nextState.doc, block.position)!];
            }
          } else if (meta?.type === "set-named") {
            const next = createBookmark(nextState.doc, meta.position, meta.key);
            if (next) bookmarks = [...bookmarks.filter((bookmark) => bookmark.key !== meta.key), next];
          } else if (meta?.type === "remove") {
            bookmarks = bookmarks.filter((bookmark) => bookmark.id !== meta.id);
          } else if (meta?.type === "rename") {
            bookmarks = bookmarks.map((bookmark) => bookmark.id === meta.id
              ? { ...bookmark, ...(meta.label?.trim() ? { label: meta.label.trim() } : { label: undefined }) }
              : bookmark);
          }
          bookmarks = normalizeBookmarks(nextState.doc, bookmarks);
          if (sameBookmarks(bookmarks, previous.bookmarks)) {
            if (!transaction.docChanged) return previous;
            return {
              bookmarks: previous.bookmarks,
              decorations: previous.decorations.map(transaction.mapping, transaction.doc),
            };
          }
          return { bookmarks, decorations: buildDecorations(nextState.doc, bookmarks) };
        },
      },
      props: {
        decorations(state) {
          return documentBookmarkPluginKey.getState(state)?.decorations ?? null;
        },
      },
      view(view) {
        let previous = documentBookmarkPluginKey.getState(view.state)?.bookmarks ?? [];
        return {
          update(view) {
            const bookmarks = documentBookmarkPluginKey.getState(view.state)?.bookmarks ?? [];
            if (bookmarks === previous) return;
            previous = bookmarks;
            options.onChange?.(bookmarks, view.state.doc);
          },
        };
      },
    })];
  },
});

function dispatchMeta(view: EditorView, meta: BookmarkMeta): boolean {
  if (!documentBookmarkPluginKey.getState(view.state)) return false;
  view.dispatch(view.state.tr.setMeta(documentBookmarkPluginKey, meta));
  return true;
}

export function getDocumentBookmarks(editor: Editor): DocumentBookmark[] {
  return documentBookmarkPluginKey.getState(editor.state)?.bookmarks ?? [];
}

export function toggleBookmark(editor: Editor): boolean {
  return dispatchMeta(editor.view, { type: "toggle", position: editor.state.selection.head });
}

export function removeBookmark(editor: Editor, id: string): boolean {
  return dispatchMeta(editor.view, { type: "remove", id });
}

export function renameBookmark(editor: Editor, id: string, label?: string): boolean {
  return dispatchMeta(editor.view, { type: "rename", id, label });
}

export function setNamedBookmarkInView(view: EditorView, key: string): boolean {
  if (!/^[a-z]$/.test(key)) return false;
  return dispatchMeta(view, { type: "set-named", key, position: view.state.selection.head });
}

export function jumpToNamedBookmarkInView(view: EditorView, key: string): boolean {
  const bookmark = documentBookmarkPluginKey.getState(view.state)?.bookmarks.find((item) => item.key === key);
  if (!bookmark) return false;
  const position = Math.max(0, Math.min(view.state.doc.content.size, bookmark.position));
  view.dispatch(view.state.tr
    .setSelection(TextSelection.near(view.state.doc.resolve(position), 1))
    .setMeta(headingFoldPluginKey, { type: "expand-at", position })
    .scrollIntoView());
  view.focus();
  return true;
}
