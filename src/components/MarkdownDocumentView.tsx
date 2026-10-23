import { readDocumentSource, writeDocumentSource } from "../lib/document-source";
import { mapSourceReferences } from "../lib/markdown-source-navigation";
import { EditorStatusBar } from "./EditorStatusBar";
import { SourceTabWidthSelect } from "./SourceTabWidthSelect";
import { AUTO_DOCUMENT_LANGUAGE, DOCUMENT_LANGUAGE_OPTIONS, documentLanguageViewOptions, saveSourceViewLanguageOverride, sourceViewLanguageOverride } from "../lib/document-language";
import { documentSourceLanguage, documentLanguageCommand, documentHasPreview } from "../lib/document-language";
import { shortcutTitle } from "../lib/editor-shortcuts";
import { useFocusEditorTools } from "../stores/useFocusEditorTools";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { useStatusBarDisplay } from "../hooks/useStatusBarDisplay";
import { activeLinePluginKey } from "../extensions/EditorHighlights";
import { IMAGE_VIEW_EVENT } from "../lib/image-library/viewer-request";
import { documentImages } from "../lib/image-library/document-images";
import { renderedEditAdapter, sourceEditAdapter } from "../lib/plugin-system/editor-adapters";
import { BuiltinPluginTools } from "./BuiltinPluginTools";
import { runtimeKind } from "../lib/runtime";
import { flowHeadingLevel } from "../lib/flow-presentation";
import { useDocumentActive } from "./RetainedDocument";
import { MarkdownSplitPreview } from "./MarkdownSplitPreview";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { NavigationButtons } from "./NavigationButtons";
import { useNavigationStore } from "../stores/useNavigationStore";
import { Suspense, lazy, useEffect, useLayoutEffect, useCallback, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { NoteEditorProps } from "./NoteEditor";
import type { DeltaOps } from "../types/models";
import { deltaToMarkdownAsync } from "../lib/data-transform-client";
import { SourceNavigationSession, type SourceEditRange } from "../lib/markdown-source-navigation";
import type { EditorState } from "@codemirror/state";
import { MarkdownSourceWorkspace } from "./MarkdownSourceWorkspace";
import { invalidateEditorDocument } from "../lib/editor-session-cache";
import { deltaToProseMirror, isProseMirror, proseMirrorToDelta } from "../lib/delta-converter";
import { ToolbarIcon } from "./ToolbarIcon";
import { DocumentTitlePreview } from "./DocumentTitlePreview";
import { DocumentInfoCard } from "./DocumentInfoCard";
import { isPointerOverTitleText } from "../lib/document-title-hit-test";
import { MarkdownEscapeRepair } from "./MarkdownEscapeRepair";
import { api } from "../lib/api";
import { findTextMatches, initializeSearchRegex } from "../lib/search-matching";
import { useMarkdownViewPosition } from "../hooks/useMarkdownViewPosition";
import { patchReadingState, readReadingState } from "../lib/reading-state";
import { useDocumentOpenStore } from "../stores/useDocumentOpenStore";
import { useDocumentTitleDraft } from "../hooks/useDocumentTitleDraft";

const SourceDocumentPreview = lazy(() => import("./SourceDocumentPreview").then(module => ({ default: module.SourceDocumentPreview })));
const MarkdownSourceEditor = lazy(() => import("./MarkdownSourceEditor").then(module => ({ default: module.MarkdownSourceEditor })));

/** One visible editing surface, one canonical autosave stream for both views. */
export function MarkdownDocumentView({ props, render }: { props: NoteEditorProps; render: (props: NoteEditorProps) => ReactNode }) {
  const statusBar = useStatusBarDisplay(props.showStatusBar, props.focusMode);
  const active = useDocumentActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const storedDocumentLanguage = documentSourceLanguage(props.content.metadata);
  const languageOverrideIdentity = `document:${props.noteId}`;
  const [readonlyLanguageOverride, setReadonlyLanguageOverride] = useState<string | null>(() => sourceViewLanguageOverride(languageOverrideIdentity));
  const [documentLanguage, setDocumentLanguage] = useState(() => props.readonly ? readonlyLanguageOverride ?? storedDocumentLanguage : storedDocumentLanguage);
  const documentLanguageRef = useRef(documentLanguage);
  documentLanguageRef.current = documentLanguage;
  useEffect(() => {
    const override = sourceViewLanguageOverride(languageOverrideIdentity);
    setReadonlyLanguageOverride(override);
    setDocumentLanguage(props.readonly ? override ?? storedDocumentLanguage : storedDocumentLanguage);
  }, [languageOverrideIdentity, props.readonly, storedDocumentLanguage]);
  const moreToolsPreference = useFocusEditorTools(state => state.expanded);
  const setMoreTools = useFocusEditorTools(state => state.setExpanded);
  const moreTools = moreToolsPreference ?? !props.focusMode;
  const sourceOpenTarget = useDocumentOpenStore(state => state.target?.noteId === props.noteId ? state.target : null);
  const navigationTarget = useNavigationStore(state => state.target?.noteId === props.noteId ? state.target : null);
  const mobile = useMobileViewport();
  const [preview, setPreview] = useState(() => localStorage.getItem("nr:markdownSplitPreview") === "true");
  const [sourceStatusTarget, setSourceStatusTarget] = useState<HTMLDivElement | null>(null);
  const [sourceToolbarTarget, setSourceToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [previewSync, setPreviewSync] = useState(() => localStorage.getItem("nr:markdownPreviewSync") !== "false");
  const hostOwner = useRef({});
  const renderedHost = useRef<Parameters<NonNullable<NoteEditorProps["onHostEditorReady"]>>[0]>(null);
  const [initialReading] = useState(() => props.sensitive ? null : readReadingState(props.noteId));
  const [initialRaw] = useState(() => storedDocumentLanguage !== "markdown" ? readDocumentSource(props.content) : null);
  const hasPreview = documentHasPreview(documentLanguage);
  const [source, setSource] = useState<string | null>(initialRaw);

  const viewPosition = useMarkdownViewPosition(props.noteId, source !== null, props.sensitive);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [error, setError] = useState("");
  const [sourceInfoOpen, setSourceInfoOpen] = useState(false);
  const sourceTitleInput = useRef<HTMLInputElement>(null);
  const sourceTitleDraft = useDocumentTitleDraft(props.title, sourceTitleInput);
  const sourceInfoTimer = useRef<number | null>(null);
  const clearSourceInfoTimer = () => {
    if (sourceInfoTimer.current !== null) window.clearTimeout(sourceInfoTimer.current);
    sourceInfoTimer.current = null;
  };
  const closeSourceInfoLater = () => {
    clearSourceInfoTimer();
    sourceInfoTimer.current = window.setTimeout(() => setSourceInfoOpen(false), 180);
  };
  const handleSourceTitlePointer = (event: PointerEvent<HTMLDivElement>) => {
    clearSourceInfoTimer();
    if (event.pointerType === "touch") return;
    if (isPointerOverTitleText(event.currentTarget, event.clientX)) setSourceInfoOpen(true);
    else if (sourceInfoOpen) closeSourceInfoLater();
  };
  useEffect(() => () => clearSourceInfoTimer(), []);
  const sourceTitle = <>
    <div className="note-title-field"
      onPointerEnter={handleSourceTitlePointer}
      onPointerMove={handleSourceTitlePointer}
      onPointerLeave={closeSourceInfoLater}
      onFocusCapture={() => { clearSourceInfoTimer(); setSourceInfoOpen(false); }}>
      {props.readonly
        ? <DocumentTitlePreview title={props.title || "无标题"} onOpenProperties={props.onOpenProperties} />
        : <input ref={sourceTitleInput} type="text" className="note-title" aria-label="文档标题" placeholder="输入文档标题" value={sourceTitleDraft.draft} onBlur={sourceTitleDraft.finish} onChange={event => { sourceTitleDraft.setDraft(event.target.value); props.onTitleChange(event.target.value); }} onKeyDown={event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          viewPosition.sourceHandle?.focus();
        }} />}
    </div>
    {sourceInfoOpen && props.documentCreatedAt && props.documentUpdatedAt && <DocumentInfoCard
      className="document-info-card-title-hover"
      title={props.title || "无标题"}
      content={props.content}
      createdAt={props.documentCreatedAt}
      updatedAt={props.documentUpdatedAt}
      lastAccessedAt={props.documentLastAccessedAt}
      readonly={props.readonly}
      docType={props.documentType}
      tags={props.tags}
      path={props.documentPath}
      onPointerEnter={clearSourceInfoTimer}
      onPointerLeave={closeSourceInfoLater}
    />}
  </>;
  const [snapshot, setSnapshot] = useState<{ base: DeltaOps; content: DeltaOps } | null>(null);
  const [, forceSourceMetadataUpdate] = useState(0);
  const latestProps = useRef(props);
  latestProps.current = props;
  const latestReader = useRef<(() => DeltaOps) | null>(null);
  const initial = useRef<{ text: string; content: DeltaOps } | null>(null);
  const sourceSession = useRef<SourceNavigationSession | null>(null);
  if (initialRaw !== null && !sourceSession.current) sourceSession.current = new SourceNavigationSession(initialRaw, props.content);
  const sourceEditorState = useRef<EditorState | null>(null);
  const rawRestoreTop = useRef(initialRaw !== null ? initialReading?.source?.scrollTop : undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!props.readonly || source !== null || documentHasPreview(documentLanguage)) return;
    let cancelled = false;
    const current = latestReader.current?.() ?? props.content;
    const preserved = current.metadata?.sourceText ?? current.metadata?.markdownSource;
    void (typeof preserved === "string" || current.metadata?.sourceFormat === "text"
      ? Promise.resolve(readDocumentSource(current))
      : deltaToMarkdownAsync(current))
      .then(text => {
        if (cancelled || !alive.current) return;
        sourceSession.current = new SourceNavigationSession(text, current);
        setSource(text);
      })
      .catch(cause => {
        if (!cancelled && alive.current) setError(`只读查看格式加载失败：${cause instanceof Error ? cause.message : String(cause)}`);
      });
    return () => { cancelled = true; };
  }, [documentLanguage, props.content, props.readonly, source]);
  useEffect(() => props.documentSessions?.retain(props.noteId), [props.documentSessions, props.noteId]);
  const hostView = source === null ? "rendered" : "source";
  useLayoutEffect(() => {
    props.documentSessions?.activate(props.noteId, hostOwner.current, hostView, active);
  }, [props.documentSessions, props.noteId, hostView, active]);
  const renderedSelection = useRef<number>();
  const hostSelection = (selection: { from: number; to: number }) => {
    if (source === null) renderedSelection.current = selection.from;
    props.documentSessions?.select(props.noteId, hostOwner.current, source === null ? "rendered" : "source", selection);
  };
  const onSourceReady = viewPosition.onSourceReady;
  const hostSourceReady = useCallback((handle: import("../lib/source-editor-handle").SourceEditorHandle | null) => {
    onSourceReady(handle);
    if (handle && rawRestoreTop.current !== undefined) {
      const top = rawRestoreTop.current;
      const view = handle.view;
      view.requestMeasure({ read: () => top, write: value => {
        if (handle.view !== view || !view.dom.isConnected) return;
        handle.scrollTop = value;
        rawRestoreTop.current = undefined;
      } });
    }
    props.documentSessions?.bind(props.noteId, hostOwner.current, "source", handle ? sourceEditAdapter(handle, () => Boolean(latestProps.current.readonly) || busyRef.current) : null);
  }, [onSourceReady, props.documentSessions, props.noteId]);
  const supported = !props.pdfExcerptSource && !props.epubExcerptSource;
  const editSource = (text: string, range?: SourceEditRange) => {
    setSource(text);
    const revision = sourceSession.current?.update(text, range);
    if (!revision) return;
    const language = documentLanguageRef.current;
    let cached: DeltaOps | undefined;
    const read = () => {
      if (cached) return cached;
      const content = revision.read();
      return (cached = { ...content, metadata: { ...content.metadata, sourceLanguage: language } });
    };
    invalidateEditorDocument(props.noteId);
    latestReader.current = read;
    props.onContentChange(read, { batch: revision });
  };
  const { noteId: sourceBookmarkNoteId, onContentChange: saveSourceBookmark, onBookmarkCountChange: updateBookmarkCount } = props;
  const mutateSourceBookmark = useCallback((mutate: (session: SourceNavigationSession) => void) => {
    const session = sourceSession.current;
    if (!session) return;
    mutate(session);
    const revision = session.current;
    const language = documentLanguageRef.current;
    let cached: DeltaOps | undefined;
    const read = () => cached ??= (() => {
      const content = revision.read();
      return { ...content, metadata: { ...content.metadata, sourceLanguage: language } };
    })();
    invalidateEditorDocument(sourceBookmarkNoteId);
    latestReader.current = read;
    saveSourceBookmark(read, { metadataOnly: true });
    updateBookmarkCount?.(revision.bookmarks.length);
    forceSourceMetadataUpdate(value => value + 1);
  }, [sourceBookmarkNoteId, saveSourceBookmark, updateBookmarkCount]);
  useEffect(() => {
    if (source === null || !active) return;
    const toggleAtSelection = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || !event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "m") return;
      const handle = viewPosition.sourceHandle;
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      mutateSourceBookmark(session => { session.toggleBookmarkAt(handle.selectionStart); });
    };
    window.addEventListener("keydown", toggleAtSelection, true);
    return () => window.removeEventListener("keydown", toggleAtSelection, true);
  }, [source, active, viewPosition.sourceHandle, mutateSourceBookmark]);
  const changeView = async (restoreSourceTop?: number) => {
    if (busy || !hasPreview) return;
    setBusy(true); setError("");
    try {
      await latestProps.current.onFlush?.();
      if (!alive.current) return;
      // Read after the awaited save: input typed while storage was busy must
      // also be included before the rich editor is unmounted.
      const raw = latestReader.current?.() ?? latestProps.current.content;
      const content: DeltaOps = isProseMirror(raw) ? { ...proseMirrorToDelta(raw), metadata: raw.metadata } : raw;
      if (source === null) {
        const originalSource = content.metadata?.sourceText ?? content.metadata?.markdownSource;
        const text = typeof originalSource === "string" ? originalSource : await deltaToMarkdownAsync(content);
        if (!alive.current) return;
        // An edit during the worker conversion must never be replaced by its stale result.
        if ((latestReader.current?.() ?? latestProps.current.content) !== raw) throw new Error("转换期间正文已变化，请再次切换");
        initial.current = { text, content };
        sourceSession.current = new SourceNavigationSession(text, content);
        if (documentLanguage === "markdown") viewPosition.toSource(text, deltaToProseMirror(content), restoreSourceTop, (renderedHost.current ? activeLinePluginKey.getState(renderedHost.current.state)?.readingBlockPosition ?? renderedHost.current.state.selection.from : renderedSelection.current));
        setSource(text);
      } else {
        // A bookmark destination takes priority over the source viewport.
        if (latestProps.current.searchTarget?.bookmarkId || latestProps.current.searchTarget?.referenceId) viewPosition.cancelHandoff();
        else if (documentLanguage === "markdown") viewPosition.toRendered(source, deltaToProseMirror(content));
        invalidateEditorDocument(props.noteId);
        setSnapshot({ base: latestProps.current.content, content });
        if (documentLanguage !== "markdown" && !props.sensitive) patchReadingState(props.noteId, { view: "rendered" });
        setSource(null);
      }
      // Keep the handoff snapshot even if React has not received the saved
      // content prop yet (e.g. an immediate toggle back after a slow save).
      latestReader.current = () => content;
    } catch (cause) {
      if (alive.current) setError(`切换失败，当前内容已保留：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { if (alive.current) setBusy(false); }
  };
  const restoreViewRef = useRef(changeView);
  restoreViewRef.current = changeView;
  const restoredView = useRef(false);
  useEffect(() => {
    if (restoredView.current) return;
    restoredView.current = true;
    const saved = initialReading;
    if (initialRaw !== null) {
      if (documentHasPreview(storedDocumentLanguage) && saved?.view === "rendered") void restoreViewRef.current();
      return;
    }
    if (useDocumentOpenStore.getState().target?.noteId === props.noteId) return;
    if (!useNavigationStore.getState().target && !props.searchTarget?.bookmarkId && !props.searchTarget?.referenceId && supported && saved?.view === "source" && saved.source) void restoreViewRef.current(saved.source.scrollTop);
  }, [props.noteId, props.sensitive, props.searchTarget?.bookmarkId, props.searchTarget?.referenceId, supported, storedDocumentLanguage, initialRaw, initialReading]);
  const handledSourceOpen = useRef<number>();
  useEffect(() => {
    if (!active || !sourceOpenTarget || busy) return;
    const { requestId } = sourceOpenTarget;
    if (!supported || source !== null) {
      useDocumentOpenStore.getState().consumed(requestId);
    } else if (handledSourceOpen.current !== requestId) {
      handledSourceOpen.current = requestId;
      // Reuse the normal save/conversion boundary, including cached instances.
      void restoreViewRef.current().finally(() => useDocumentOpenStore.getState().consumed(requestId));
    }
  }, [active, sourceOpenTarget, busy, source, supported]);
  const bookmarkViewRequest = useRef<number>();
  const onSearchTargetConsumed = props.onSearchTargetConsumed;
  const jumpSourceRef = useRef<(offset: number, record?: boolean) => void>(() => {});
  jumpSourceRef.current = (offset, record = true) => {
    const area = viewPosition.area.current, revision = sourceSession.current?.current;
    if (!area || !revision) return;
    viewPosition.cancelHandoff();
    const target = Math.max(0, Math.min(revision.source.length, offset));
    if (record) {
      const history = useNavigationStore.getState();
      const before = (revision.blockAt(area.selectionStart)?.position ?? 0) + 1;
      const after = (revision.blockAt(target)?.position ?? 0) + 1;
      history.record({ noteId: props.noteId, from: before, to: before });
      history.record({ noteId: props.noteId, from: after, to: after }, true);
    }
    area.focus();
    area.setSelectionRange(target, target);
    area.scrollToOffset(target, true);
  };
  useEffect(() => {
    const target = props.searchTarget;
    if ((!target?.bookmarkId && !target?.referenceId) || source === null || busy || bookmarkViewRequest.current === target.requestId) return;
    bookmarkViewRequest.current = target.requestId;
    const bookmark = sourceSession.current?.current.bookmarks.find(item => item.id === target.bookmarkId);
    const offset = target.referenceId ? sourceSession.current?.current.referenceOffset(target.referenceId) : bookmark?.offset;
    if (offset !== undefined) jumpSourceRef.current(offset);
    else setError("引用目标已删除或不存在");
    onSearchTargetConsumed?.(target.requestId);
  }, [props.searchTarget, onSearchTargetConsumed, source, busy]);
  const sourceSearchRequest = useRef<number>();
  useEffect(() => {
    const target = props.searchTarget;
    if (!target || target.noteId !== props.noteId || target.bookmarkId || target.referenceId || source === null || busy || !viewPosition.sourceHandle || sourceSearchRequest.current === target.requestId) return;
    let cancelled = false;
    void (async () => {
      if (target.options?.regex) await initializeSearchRegex();
      if (cancelled) return;
      const text = sourceSession.current?.current.source;
      if (text === undefined) return;
      let matches = findTextMatches(text, target.query, target.options);
      if (!matches.length && !target.options?.regex) {
        const terms = [...new Set(target.query.trim().split(/\s+/).filter(Boolean))];
        if (terms.length > 1) matches = terms.flatMap(term => findTextMatches(text, term, target.options)).sort((a, b) => a.from - b.from);
      }
      sourceSearchRequest.current = target.requestId;
      if (matches[0]) jumpSourceRef.current(matches[0].from);
      onSearchTargetConsumed?.(target.requestId);
    })().catch(error => {
      if (!cancelled) {
        sourceSearchRequest.current = target.requestId;
        setError(`无法定位搜索结果：${error instanceof Error ? error.message : String(error)}`);
        onSearchTargetConsumed?.(target.requestId);
      }
    });
    return () => { cancelled = true; };
  }, [props.searchTarget, props.noteId, onSearchTargetConsumed, source, busy, viewPosition.sourceHandle]);
  const historyViewRequest = useRef<number>();
  useEffect(() => {
    if (active && navigationTarget && source !== null && !busy && historyViewRequest.current !== navigationTarget.requestId) {
      historyViewRequest.current = navigationTarget.requestId;
      jumpSourceRef.current(sourceSession.current?.current.offsetAt(navigationTarget.from) ?? 0, false);
      useNavigationStore.getState().consumed(navigationTarget.requestId);
    }
  }, [navigationTarget, source, busy, active]);
  useEffect(() => {
    // Source cleanup runs before this effect; explicit return to rendered wins.
    if (source === null && !props.sensitive && (initial.current || initialRaw !== null)) patchReadingState(props.noteId, { view: "rendered" });
  }, [source, props.noteId, props.sensitive, initialRaw]);
  const applyEscapeRepair = async (before: string, after: string) => {
    if (before !== source || busy || latestProps.current.readonly) throw new Error("文档状态已变化，请重新扫描");
    if (!latestProps.current.onFlush) throw new Error("无法确认保存状态，已取消修复");
    setBusy(true);
    try {
      await latestProps.current.onFlush?.();
      if (!alive.current || latestProps.current.readonly) throw new Error("文档已关闭或设为只读");
      await api.versions.checkpoint(props.noteId);
      if (!alive.current || latestProps.current.readonly) throw new Error("文档已关闭或设为只读");
      editSource(after);
      await latestProps.current.onFlush?.();
    } finally { if (alive.current) setBusy(false); }
  };
  const hostRenderedReady: NonNullable<NoteEditorProps["onHostEditorReady"]> = editor => {
    renderedHost.current = editor;
    viewPosition.onRenderedReady(editor);
    props.documentSessions?.bind(props.noteId, hostOwner.current, "rendered", editor ? renderedEditAdapter(editor, () => Boolean(latestProps.current.readonly)) : null);
  };
  useEffect(() => {
    if (!active) return;
    const enrich = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.image || detail.image.rootId || detail.images?.length > 1) return;
      const images = documentImages(renderedHost.current && !renderedHost.current.isDestroyed ? renderedHost.current.getJSON() : latestReader.current?.() ?? latestProps.current.content);
      if (images.length) detail.images = images;
    };
    window.addEventListener(IMAGE_VIEW_EVENT, enrich, true);
    return () => window.removeEventListener(IMAGE_VIEW_EVENT, enrich, true);
  }, [active]);
  const changeDocumentLanguage = async (language: string) => {
    if (language === documentLanguageRef.current || busyRef.current || latestProps.current.readonly || !DOCUMENT_LANGUAGE_OPTIONS.some(option => option.value === language)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await latestProps.current.onFlush?.();
      if (!alive.current || !activeRef.current || latestProps.current.readonly) return;
      const current = latestReader.current?.() ?? latestProps.current.content;
      const preserved = current.metadata?.sourceText ?? current.metadata?.markdownSource;
      const text = source !== null ? viewPosition.area.current?.value ?? source
        : typeof preserved === "string" || current.metadata?.sourceFormat === "text" ? readDocumentSource(current)
        : await deltaToMarkdownAsync(current);
      if (!alive.current || !activeRef.current || latestProps.current.readonly) return;
      if ((latestReader.current?.() ?? latestProps.current.content) !== current) throw new Error("转换期间正文已变化，请重新选择文件格式");
      const next = writeDocumentSource(text, language, current.metadata);
      if (current.metadata?.referenceAnchors?.length || current.metadata?.bookmarks?.length) {
        const before = deltaToProseMirror(current), after = deltaToProseMirror(next);
        if (current.metadata.referenceAnchors?.length) next.metadata!.referenceAnchors = mapSourceReferences(before, after, current.metadata.referenceAnchors);
        if (current.metadata.bookmarks?.length) next.metadata!.bookmarks = current.metadata.bookmarks.map(bookmark => {
          const [mapped] = mapSourceReferences(before, after, [{ id: bookmark.id, kind: "position", from: bookmark.position, to: bookmark.position, preview: bookmark.preview }]);
          return { ...bookmark, position: mapped.from };
        });
      }
      sourceSession.current = new SourceNavigationSession(text, next);
      setSource(documentHasPreview(language) && source === null ? null : text);
      setSnapshot({ base: latestProps.current.content, content: next });
      invalidateEditorDocument(props.noteId);
      documentLanguageRef.current = language;
      setDocumentLanguage(language);
      latestReader.current = () => next;
      latestProps.current.onContentChange(() => next);
    } catch (cause) {
      setError(`文件格式设置失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const changeReadonlyViewLanguage = async (language: string) => {
    if (!props.readonly || busyRef.current) return;
    const override = language === AUTO_DOCUMENT_LANGUAGE ? null : language;
    if (override !== null && !DOCUMENT_LANGUAGE_OPTIONS.some(option => option.value === override)) return;
    const effective = override ?? storedDocumentLanguage;
    busyRef.current = true;
    setBusy(true);
    try {
      if (source === null && !documentHasPreview(effective)) {
        const current = latestReader.current?.() ?? latestProps.current.content;
        const preserved = current.metadata?.sourceText ?? current.metadata?.markdownSource;
        const text = typeof preserved === "string" || current.metadata?.sourceFormat === "text"
          ? readDocumentSource(current)
          : await deltaToMarkdownAsync(current);
        if (!alive.current || !latestProps.current.readonly) return;
        sourceSession.current = new SourceNavigationSession(text, current);
        setSource(text);
      }
      saveSourceViewLanguageOverride(languageOverrideIdentity, override);
      setReadonlyLanguageOverride(override);
      setDocumentLanguage(effective);
      setError("");
    } catch (cause) {
      setError(`只读查看格式设置失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const languageProps = { documentLanguage, onDocumentLanguageChange: busy ? undefined : props.readonly ? (language: string) => { void changeReadonlyViewLanguage(language); } : (language: string) => { void changeDocumentLanguage(language); } };
  const languageSelectionValue = props.readonly ? readonlyLanguageOverride ?? AUTO_DOCUMENT_LANGUAGE : documentLanguage;
  const languageOptions = props.readonly ? documentLanguageViewOptions(storedDocumentLanguage) : DOCUMENT_LANGUAGE_OPTIONS;
  useNativeMenuActions({
    ...Object.fromEntries(DOCUMENT_LANGUAGE_OPTIONS.map(option => [documentLanguageCommand(option.value), { run: () => props.readonly ? void changeReadonlyViewLanguage(option.value) : void changeDocumentLanguage(option.value), checked: documentLanguage === option.value, enabled: !busy }])),
    "view.tools": { run: () => setMoreTools(!moreTools), checked: moreTools, enabled: !props.readonly || source !== null },
    "document.source": { run: () => changeView(), checked: source !== null, enabled: supported && hasPreview && !busy },
    "document.readonly": { run: () => props.onReadonlyChange?.(!props.readonly), checked: Boolean(props.readonly), enabled: Boolean(props.onReadonlyChange) && !busy },
  }, active);
  if (!supported) return render({ ...props, ...languageProps, onHostSelection: hostSelection, onHostEditorReady: hostRenderedReady });
  const toggle = <>{hasPreview && <button type="button" className="markdown-view-toggle" disabled={busy}
    title={shortcutTitle("document.source", source === null ? "切换到源码" : "切换到渲染视图")}
    aria-label={source === null ? "源码" : "渲染"}
    aria-busy={busy} onClick={() => void changeView()}><ToolbarIcon name={source === null ? "code" : "document"} /></button>}
    {props.documentSessions && <BuiltinPluginTools onOpenNote={props.onOpenLinkedNote} sessions={props.documentSessions} active={active} disabled={busy} readonly={Boolean(props.readonly) || source === null && documentLanguage !== "markdown"} onFocusEditor={() => { if (source !== null) viewPosition.sourceHandle?.focus(); else renderedHost.current?.view.focus(); }} context={{ platform: runtimeKind(), view: props.readonly || source === null && documentLanguage !== "markdown" ? "readonly" : source === null ? "render" : "source", documentId: props.noteId }} />}</>;
  return <div className="markdown-document-view" data-tools-hidden={!moreTools || undefined} ref={viewPosition.host}>
    {error && <div role="alert" className="markdown-source-hint">{error}</div>}
    {source === null && documentLanguage !== "markdown" ? <>
      <div className="note-title-row markdown-source-title-row">
        {props.titleSecurityAction}
        {props.onReadonlyChange && <button type="button" className="note-readonly-badge note-readonly-action" data-document-readonly={props.readonly === true} disabled={busy} aria-label={props.readonly ? "切换为可编辑" : "设置只读"} title={props.readonly ? "切换为可编辑" : "设置只读"} onClick={() => props.onReadonlyChange?.(!props.readonly)}><ToolbarIcon name={props.readonly ? "lock" : "unlock"} /></button>}
        {sourceTitle}
        {toggle}
      </div>
      <Suspense fallback={<div role="status">正在加载预览…</div>}>
        <SourceDocumentPreview language={documentLanguage} source={sourceSession.current?.current.source ?? readDocumentSource(props.content)} fontSize={props.editorFontSize} />
      </Suspense>
      <EditorStatusBar enabled={props.showStatusBar} focusMode={props.focusMode} saveStatus={props.saveStatus} onCreateDocument={props.onCreateDocument} sourceIndentControls={<span className="source-indentation-controls"><SourceTabWidthSelect /></span>} documentLanguage={documentLanguage} documentLanguageValue={languageSelectionValue} documentLanguageOptions={languageOptions} onDocumentLanguageChange={languageProps.onDocumentLanguageChange} />
    </> : source === null ? render({
      ...props,
      ...languageProps,
      documentViewToggle: toggle,
      onHostSelection: hostSelection,
      onHostEditorReady: hostRenderedReady,
      content: snapshot?.base === props.content ? snapshot.content : props.content,
      onContentChange: (reader, options) => {
        const originalSource = options?.metadataOnly
          ? (latestReader.current?.() ?? latestProps.current.content).metadata?.markdownSource
          : undefined;
        const language = documentLanguageRef.current;
        let cached: DeltaOps | undefined;
        const read = () => {
          if (cached) return cached;
          const content = reader();
          const metadata = { ...content.metadata, sourceLanguage: language };
          // Rendered edits invalidate the original spelling/spacing, not other metadata.
          if (typeof originalSource === "string") metadata.markdownSource = originalSource;
          else delete metadata.markdownSource;
          cached = { ...content, metadata };
          return cached;
        };
        latestReader.current = read;
        props.onContentChange(read, options);
      },
    }) : <MarkdownSourceWorkspace revision={sourceSession.current!.current} areaRef={viewPosition.area} sourceHandle={viewPosition.sourceHandle}
      onJump={offset => jumpSourceRef.current(offset)}
      onToggleBookmark={offset => mutateSourceBookmark(session => { session.toggleBookmarkAt(offset); })}
      onRemoveBookmark={id => mutateSourceBookmark(session => { session.removeBookmark(id); })}
      onRenameBookmark={(id, label) => mutateSourceBookmark(session => { session.renameBookmark(id, label); })}>{controls => <>
      <div className="note-title-row markdown-source-title-row">
        {props.titleSecurityAction}
        {props.onReadonlyChange && <button type="button" className="note-readonly-badge note-readonly-action" data-document-readonly={props.readonly === true} aria-pressed={props.readonly === true} disabled={busy}
          aria-label={props.readonly ? "切换为可编辑" : "设置只读"} title={props.readonly ? "切换为可编辑" : "设置只读"}
          onClick={() => props.onReadonlyChange?.(!props.readonly)}><ToolbarIcon name={props.readonly ? "lock" : "unlock"} /></button>}
        {sourceTitle}
        {toggle}
        {(!props.readonly || source !== null) && <button type="button" className="markdown-view-toggle" title={shortcutTitle("view.tools", "更多工具")} aria-label="更多工具" aria-expanded={moreTools} onClick={() => setMoreTools(!moreTools)}><ToolbarIcon name="annotate" /></button>}
        {!mobile && hasPreview && <button type="button" className="markdown-view-toggle" title="并排预览" aria-label="并排预览" aria-pressed={preview} onClick={() => { setPreview(!preview); localStorage.setItem("nr:markdownSplitPreview", String(!preview)); }}><ToolbarIcon name="panel" /></button>}
        {!mobile && hasPreview && preview && <label className="markdown-preview-sync"><input type="checkbox" checked={previewSync} onChange={event => { setPreviewSync(event.target.checked); localStorage.setItem("nr:markdownPreviewSync", String(event.target.checked)); }} />同步滚动</label>}
        {controls}
        {!(statusBar.navigationInStatus) && <NavigationButtons />}
        {mobile && props.onFocusModeChange && <button type="button" className="focus-btn document-focus-toggle" aria-label={props.focusMode ? "退出专注模式" : "专注模式"}
          onClick={() => props.onFocusModeChange?.(!props.focusMode)}><ToolbarIcon name={props.focusMode ? "compress" : "expand"} /></button>}
      </div>
      <div className="markdown-source-toolbar-host" ref={setSourceToolbarTarget} />
      <MarkdownSplitPreview highlightActiveLine={props.highlightActiveLine} flowLevel={flowHeadingLevel(props.content.metadata)} enabled={hasPreview && preview && !mobile} sync={previewSync} revision={sourceSession.current!.current} areaRef={viewPosition.area} fontSize={props.editorFontSize}>
      <Suspense fallback={<div className="markdown-source-loading" role="status">正在加载源码编辑器…</div>}>
      <MarkdownSourceEditor documentLanguage={documentLanguage} documentLanguageValue={languageSelectionValue} documentLanguageOptions={languageOptions} onDocumentLanguageChange={languageProps.onDocumentLanguageChange} onCreateDocument={props.onCreateDocument} statusTarget={sourceStatusTarget} focusMode={props.focusMode} showStatusBar={props.showStatusBar} saveStatus={props.saveStatus} toolbarTarget={sourceToolbarTarget} value={source} readonly={Boolean(props.readonly)} editingDisabled={busy}
        areaRef={viewPosition.area} onReady={hostSourceReady} onSelectionChange={hostSelection} session={sourceEditorState} onChange={editSource}
        onEditorConfigChange={props.onEditorConfigChange}
        showLineNumbers={props.showLineNumbers} fontSize={props.editorFontSize} highlightActiveLine={props.highlightActiveLine}
        escapeRepair={documentLanguage === "markdown" ? <MarkdownEscapeRepair source={source} disabled={busy || Boolean(props.readonly)} onApply={applyEscapeRepair} /> : undefined} />
      </Suspense>
      </MarkdownSplitPreview>
      <div className="markdown-source-status-host" ref={setSourceStatusTarget} />
    </>}</MarkdownSourceWorkspace>}
  </div>;
}
