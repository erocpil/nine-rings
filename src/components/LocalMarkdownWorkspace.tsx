import type { DocumentInfoCardProps } from "./DocumentInfoCard";
import { DocumentActiveBoundary } from "./RetainedDocument";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { AppConfig, DeltaOps, DocumentBookmark } from "../types/models";
import { markdownContentFingerprint } from "../lib/external-markdown-source";
import { writeDocumentSource } from "../lib/document-source";
import { closeHistory } from "@tiptap/pm/history";
import { deltaToProseMirror } from "../lib/delta-converter";
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import { DocumentResourceContext } from "./DocumentResourceContext";
import { documentBookmarkPluginKey, getDocumentBookmarks } from "../extensions/DocumentBookmarks";

const Workspace = lazy(() =>
  import("./RenderedDocumentWorkspace").then((module) => ({ default: module.RenderedDocumentWorkspace })),
);
export interface LocalRenderedFlush {
  flush: () => void;
  pending: () => boolean;
}
export interface LocalLineBookmark {
  id: string;
  offset: number;
  line: number;
  label: string;
}

function projectBookmarks(
  bookmarks: LocalLineBookmark[], navigation: SourceNavigationDocument,
): DocumentBookmark[] {
  return bookmarks.map(bookmark => ({
    id: bookmark.id,
    position: (navigation.blockAt(bookmark.offset)?.position ?? 0) + 1,
    label: bookmark.label,
    preview: bookmark.label,
    createdAt: "1970-01-01T00:00:00.000Z",
  }));
}

/** File adapter for the same rendered workspace used by database documents.
 * The raw source survives mounting, metadata changes and a complete undo. Only
 * actual edits are serialized; save/checkpoint can flush the pending reader. */
export function LocalMarkdownWorkspace({
  identity,
  source,
  title,
  modified,
  active,
  readonly,
  focusMode,
  fontSize,
  vimModeEnabled,
  useCustomContextMenu,
  showStatusBlockNumber,
  highlightActiveLine,
  showLineNumbers,
  showStatusBar,
  defaultCodeBlockWrap,
  cjkLatinSpacing,
  readonlyHeadingFoldInFocusMode,
  onEditorConfigChange,
  bookmarks,
  onBookmarksChange,
  onSourceChange,
  onPending,
  onRegisterFlush,
  onEditorReady,
  onSelectionChange,
  onClick,
  onOpenLink,
  canOpenLink,
  bindHeadingNavigation,
  onReadonlyChange,
  titleActions,
  viewToggle,
  navigationControls,
  resolveResource,
  saveStatus,
  onRename,
  onOpenProperties,
  info,
  titleRevealOnClick,
  separateTitle = false,
  pdfExport = true,
  onExportMarkdown,
  onError,
  onCreateDocument,
  createDocumentLabel,
}: {
  titleRevealOnClick?: boolean;
  separateTitle?: boolean;
  pdfExport?: boolean;
  onExportMarkdown?: () => Promise<void>;
  onError?: (message: string) => void;
  onCreateDocument?: () => void;
  createDocumentLabel?: string;
  identity: string;
  source: string;
  title: string;
  modified?: boolean;
  active: boolean;
  readonly: boolean;
  focusMode: boolean;
  fontSize: number;
  vimModeEnabled: boolean;
  useCustomContextMenu: boolean;
  showStatusBlockNumber: boolean;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
  showStatusBar: boolean;
  defaultCodeBlockWrap: boolean;
  cjkLatinSpacing: boolean;
  readonlyHeadingFoldInFocusMode: boolean;
  onEditorConfigChange?: (patch: Partial<AppConfig>) => Promise<void>;
  bookmarks: LocalLineBookmark[];
  onBookmarksChange: (items: LocalLineBookmark[]) => void;
  onSourceChange: (source: string) => void;
  onPending: () => void;
  onRegisterFlush: (flush: LocalRenderedFlush | null) => void;
  onEditorReady?: (editor: Editor | null) => void;
  onSelectionChange?: (selection: { from: number; to: number }) => void;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onOpenLink?: (href: string) => void;
  canOpenLink?: (href: string) => boolean;
  bindHeadingNavigation?: (navigate: ((fragment: string) => boolean) | null) => void;
  onReadonlyChange?: (readonly: boolean) => void;
  titleActions: ReactNode;
  viewToggle: ReactNode;
  navigationControls?: ReactNode;
  resolveResource: (source: string) => Promise<string | null>;
  saveStatus: "clean" | "dirty" | "saving" | "saved" | "error";
  onRename?: (title: string) => Promise<void>;
  onOpenProperties?: () => void;
  info?: DocumentInfoCardProps;
}) {
  const [initial] = useState(() => ({
    source,
    content: writeDocumentSource(source, "markdown"),
    revision: markdownContentFingerprint(source),
  }));
  const navigation = useMemo(
    () =>
      new SourceNavigationDocument(source, [], { sourceLanguage: "markdown" }),
    [source],
  );
  const content = useMemo(
    () => ({
      ...initial.content,
      metadata: {
        ...initial.content.metadata,
        bookmarks: projectBookmarks(bookmarks, navigation),
      },
    }),
    [initial, navigation, bookmarks],
  );
  const callbacks = useRef({
    onSourceChange,
    onBookmarksChange,
    onPending,
    onEditorReady,
    readonly,
    navigation,
  });
  callbacks.current = {
    onSourceChange,
    onBookmarksChange,
    onPending,
    onEditorReady,
    readonly,
    navigation,
  };
  const live = useRef({ source, active, bookmarks, navigation });
  live.current = { source, active, bookmarks, navigation };
  const instance = useRef<Editor | null>(null);
  const lastProjection = useRef(initial.source);
  const projectionActive = useRef(false);
  const projectedBookmarks = useRef(bookmarks);
  const projecting = useRef(false);
  const rawByDocument = useRef(new WeakMap<PMNode, string>());
  const canonical = useRef<{ source: string; text: string }>();
  const raw = useRef(source);
  raw.current = source;
  const initialDoc = useRef<PMNode | null>(null);
  const pending = useRef<{ read: () => DeltaOps; doc?: PMNode } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [error, setError] = useState("");
  const [projectionBlocked, setProjectionBlocked] = useState(false);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const edit = pending.current;
    if (!edit) return;
    try {
      const serialized = deltaToMarkdown(edit.read());
      const previous = lastProjection.current;
      const baseline = canonical.current?.source === previous
        ? canonical.current.text
        : deltaToMarkdown(previous === initial.source ? initial.content : writeDocumentSource(previous, "markdown"));
      // Folding and other presentation attributes must not canonicalize raw text.
      const next = edit.doc && rawByDocument.current.has(edit.doc)
        ? rawByDocument.current.get(edit.doc)!
        : edit.doc && initialDoc.current && edit.doc.eq(initialDoc.current)
          ? initial.source
          : serialized === baseline ? previous : serialized;
      canonical.current = { source: next, text: serialized };
      callbacks.current.onSourceChange(next);
      raw.current = next;
      lastProjection.current = next;
      pending.current = null;
      setError("");
    } catch (cause) {
      setError(`Markdown 转换失败，编辑仍保留：${String(cause)}`);
      throw cause;
    }
  }, [initial]);
  useEffect(() => {
    onRegisterFlush({ flush, pending: () => pending.current !== null });
    return () => {
      clearTimeout(timer.current);
      flush();
      onRegisterFlush(null);
    };
  }, [flush, onRegisterFlush]);
  const changed = (
    read: () => DeltaOps,
    options?: { metadataOnly?: boolean; batch?: object },
  ) => {
    if (projecting.current) return;
    if (options?.metadataOnly) {
      flush();
      const map = new SourceNavigationDocument(raw.current, [], {
        sourceLanguage: "markdown",
      });
      const items = read().metadata?.bookmarks ?? [];
      callbacks.current.onBookmarksChange(
        items.map((item) => {
          const offset = map.offsetAt(item.position);
          return {
            id: item.id,
            offset,
            line: raw.current.slice(0, offset).split("\n").length,
            label: item.label || item.preview,
          };
        }),
      );
      return;
    }
    if (callbacks.current.readonly) return;
    pending.current = { read, doc: options?.batch as PMNode | undefined };
    callbacks.current.onPending();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        flush();
      } catch {
        /* The pending reader remains available for save/recovery. */
      }
    }, 200);
  };
  // A parked rendered view is a projection of the host's latest raw text.
  // Rebase only when it becomes active, never parse on every source keystroke.
  const projectSource = useCallback(() => {
    const editor = instance.current;
    const current = live.current;
    if (!current.active) {
      projectionActive.current = false;
      return;
    }
    if (!editor || pending.current) return;
    const previousBookmarks = projectedBookmarks.current;
    const sourceChanged = current.source !== lastProjection.current;
    const bookmarksChanged = !projectionActive.current && (
      previousBookmarks.length !== current.bookmarks.length ||
      previousBookmarks.some((item, index) => {
        const next = current.bookmarks[index];
        return item.id !== next.id || item.offset !== next.offset || item.label !== next.label;
      })
    );
    projectionActive.current = true;
    projectedBookmarks.current = current.bookmarks;
    if (!sourceChanged && !bookmarksChanged) return;
    projecting.current = true;
    try {
      const transaction = editor.state.tr;
      if (sourceChanged) {
        const next = editor.schema.nodeFromJSON(deltaToProseMirror(writeDocumentSource(current.source, "markdown")));
        if (!editor.state.doc.eq(next)) {
          closeHistory(transaction).replaceWith(0, editor.state.doc.content.size, next.content).setMeta("preventUpdate", true);
        }
      }
      // Source edits also move or change bookmarks while this editor is parked.
      const existing = new Map(getDocumentBookmarks(editor).map(bookmark => [bookmark.id, bookmark]));
      transaction.setMeta(documentBookmarkPluginKey, {
        type: "transfer",
        removeIds: [...existing.keys()],
        add: projectBookmarks(current.bookmarks, current.navigation).map(bookmark => {
          const previous = existing.get(bookmark.id);
          return previous ? { ...bookmark, key: previous.key, createdAt: previous.createdAt } : bookmark;
        }),
      });
      editor.view.dispatch(transaction);
      rawByDocument.current.set(editor.state.doc, current.source);
      raw.current = current.source;
      lastProjection.current = current.source;
      setProjectionBlocked(false);
    } catch (cause) {
      setProjectionBlocked(true);
      setError(`Markdown 投影失败，请返回源码编辑；原始内容仍保留：${String(cause)}`);
    } finally { projecting.current = false; }
  }, []);
  useLayoutEffect(projectSource, [active, source, bookmarks, projectSource]);
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    if (active && !wasActive.current && instance.current) callbacks.current.onEditorReady?.(instance.current);
    wasActive.current = active;
  }, [active]);
  const bindEditor = useCallback((editor: Editor | null) => {
    instance.current = editor;
    if (editor && !initialDoc.current) {
      initialDoc.current = editor.state.doc;
      rawByDocument.current.set(editor.state.doc, initial.source);
    }
    projectSource();
    callbacks.current.onEditorReady?.(editor);
  }, [initial, projectSource]);
  useEffect(() => { if (error) onError?.(error); }, [error, onError]);
  return (
    <DocumentActiveBoundary active={active}>
      <DocumentResourceContext.Provider value={resolveResource}>
        {error && !onError && (
          <p role="alert" className="local-files-message">
            {error}
          </p>
        )}
        <Suspense fallback={<div role="status">正在加载文档工作区…</div>}>
          <Workspace
            onCreateDocument={onCreateDocument} createDocumentLabel={createDocumentLabel}
            noteId={`local-file:${identity}`}
            contentVersion={initial.revision}
            readingBlockVersion={initial.revision}
            title={title}
            content={content}
            tags={[]}
            workspaceHost={{
              origin: "local",
              modified,
              references: false,
              documentCache: false,
              pdfExport,
              exportMarkdown: onExportMarkdown,
              annotations: false,
              virtualReading: false,
              navigation: false,
              navigationControls,
              titleEditable: Boolean(onRename),
              titleRevealOnClick,
              onRename,
              onOpenProperties,
              info,
              embedImages: true,
              savedLabel: "已保存到磁盘；不参与数据库备份",
              titleActions,
              separateTitle,
              bodyClassName: "markdown-reading-view",
              bodyLabel: "Markdown 渲染",
              sourceCopy: {
                label: "复制 Markdown 原文",
                read: () => {
                  flush();
                  return raw.current;
                },
              },
              onClick,
              onOpenLink,
              canOpenLink,
              bindHeadingNavigation,
            }}
            documentViewToggle={viewToggle}
            unifiedTitleBar
            mobileTitleBar
            readonly={readonly || projectionBlocked}
            onReadonlyChange={onReadonlyChange}
            focusMode={focusMode}
            editorFontSize={fontSize}
            onEditorFontSizeChange={(size) => {
              void onEditorConfigChange?.({ note_font_size: size });
            }}
            showLineNumbers={showLineNumbers}
            showStatusBlockNumber={showStatusBlockNumber}
            showStatusBar={showStatusBar}
            readonlyHeadingFoldInFocusMode={readonlyHeadingFoldInFocusMode}
            vimModeEnabled={vimModeEnabled}
            defaultCodeBlockWrap={defaultCodeBlockWrap}
            highlightActiveLine={highlightActiveLine}
            useCustomContextMenu={useCustomContextMenu}
            cjkLatinSpacing={cjkLatinSpacing}
            onTitleChange={() => {}}
            onTagsChange={() => {}}
            onContentChange={changed}
            onEditorConfigChange={onEditorConfigChange}
            onHostEditorReady={bindEditor}
            onHostSelection={onSelectionChange}
            onFlush={async () => {
              flush();
            }}
            saveStatus={saveStatus}
          />
        </Suspense>
      </DocumentResourceContext.Provider>
    </DocumentActiveBoundary>
  );
}
