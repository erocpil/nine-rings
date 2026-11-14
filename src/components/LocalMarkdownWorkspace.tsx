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
import type { AppConfig, DeltaOps } from "../types/models";
import { markdownContentFingerprint } from "../lib/external-markdown-source";
import { writeDocumentSource } from "../lib/document-source";
import { closeHistory } from "@tiptap/pm/history";
import { deltaToProseMirror } from "../lib/delta-converter";
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import { DocumentResourceContext } from "./DocumentResourceContext";

const Workspace = lazy(() =>
  import("./RenderedDocumentWorkspace").then((module) => ({ default: module.RenderedDocumentWorkspace })),
);
export interface LocalRenderedFlush {
  flush: () => void;
  pending: () => boolean;
}
export interface LocalLineBookmark {
  offset: number;
  line: number;
  label: string;
}

/** File adapter for the same rendered workspace used by database documents.
 * The raw source survives mounting, metadata changes and a complete undo. Only
 * actual edits are serialized; save/checkpoint can flush the pending reader. */
export function LocalMarkdownWorkspace({
  identity,
  source,
  title,
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
  onReadonlyChange,
  titleActions,
  viewToggle,
  navigationControls,
  resolveResource,
  saveStatus,
  onRename,
  onOpenProperties,
  info,
  separateTitle = false,
  pdfExport = true,
  onExportMarkdown,
}: {
  separateTitle?: boolean;
  pdfExport?: boolean;
  onExportMarkdown?: () => Promise<void>;
  identity: string;
  source: string;
  title: string;
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
        bookmarks: bookmarks.map((bookmark) => ({
          id: String(bookmark.offset),
          position: (navigation.blockAt(bookmark.offset)?.position ?? 0) + 1,
          label: bookmark.label,
          preview: bookmark.label,
          createdAt: "1970-01-01T00:00:00.000Z",
        })),
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
  const live = useRef({ source, active });
  live.current = { source, active };
  const instance = useRef<Editor | null>(null);
  const lastProjection = useRef(initial.source);
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
    if (!editor || !current.active || current.source === lastProjection.current || pending.current) return;
    projecting.current = true;
    try {
      const next = editor.schema.nodeFromJSON(deltaToProseMirror(writeDocumentSource(current.source, "markdown")));
      if (!editor.state.doc.eq(next)) editor.view.dispatch(closeHistory(editor.state.tr).replaceWith(0, editor.state.doc.content.size, next.content).setMeta("preventUpdate", true));
      rawByDocument.current.set(editor.state.doc, current.source);
      lastProjection.current = current.source;
      setProjectionBlocked(false);
    } catch (cause) {
      setProjectionBlocked(true);
      setError(`Markdown 投影失败，请返回源码编辑；原始内容仍保留：${String(cause)}`);
    } finally { projecting.current = false; }
  }, []);
  useLayoutEffect(projectSource, [active, source, projectSource]);
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
  return (
    <DocumentActiveBoundary active={active}>
      <DocumentResourceContext.Provider value={resolveResource}>
        {error && (
          <p role="alert" className="local-files-message">
            {error}
          </p>
        )}
        <Suspense fallback={<div role="status">正在加载文档工作区…</div>}>
          <Workspace
            noteId={`local-file:${identity}`}
            contentVersion={initial.revision}
            readingBlockVersion={initial.revision}
            title={title}
            content={content}
            tags={[]}
            workspaceHost={{
              origin: "local",
              references: false,
              documentCache: false,
              pdfExport,
              exportMarkdown: onExportMarkdown,
              annotations: false,
              virtualReading: false,
              navigation: false,
              navigationControls,
              titleEditable: Boolean(onRename),
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
