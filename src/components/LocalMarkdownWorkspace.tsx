import type { DocumentInfoCardProps } from "./DocumentInfoCard";
import { DocumentActiveBoundary } from "./RetainedDocument";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
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
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import { DocumentResourceContext } from "./DocumentResourceContext";

const Workspace = lazy(() =>
  import("./NoteEditor").then((module) => ({ default: module.RenderedDocumentWorkspace })),
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
  onClick,
  onReadonlyChange,
  titleActions,
  viewToggle,
  resolveResource,
  saveStatus,
  onRename,
  info,
}: {
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
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onReadonlyChange: (readonly: boolean) => void;
  titleActions: ReactNode;
  viewToggle: ReactNode;
  resolveResource: (source: string) => Promise<string | null>;
  saveStatus: "clean" | "dirty" | "saving" | "saved" | "error";
  onRename?: (title: string) => Promise<void>;
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
  const raw = useRef(source);
  raw.current = source;
  const initialDoc = useRef<PMNode | null>(null);
  const pending = useRef<{ read: () => DeltaOps; doc?: PMNode } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [error, setError] = useState("");
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const edit = pending.current;
    if (!edit) return;
    try {
      const next =
        edit.doc && initialDoc.current && edit.doc.eq(initialDoc.current)
          ? initial.source
          : deltaToMarkdown(edit.read());
      callbacks.current.onSourceChange(next);
      raw.current = next;
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
              annotations: false,
              virtualReading: false,
              navigation: false,
              titleEditable: Boolean(onRename),
              onRename,
              info,
              embedImages: true,
              savedLabel: "已保存到磁盘；不参与数据库备份",
              titleActions,
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
            readonly={readonly}
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
            onHostEditorReady={(editor) => {
              if (editor && !initialDoc.current)
                initialDoc.current = editor.state.doc;
              callbacks.current.onEditorReady?.(editor);
            }}
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
