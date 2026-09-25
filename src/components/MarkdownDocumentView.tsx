import { MarkdownSplitPreview } from "./MarkdownSplitPreview";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { NavigationButtons } from "./NavigationButtons";
import { useNavigationStore } from "../stores/useNavigationStore";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NoteEditorProps } from "./NoteEditor";
import type { DeltaOps } from "../types/models";
import { deltaToMarkdownAsync } from "../lib/data-transform-client";
import { SourceNavigationSession, type SourceEditRange } from "../lib/markdown-source-navigation";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import type { EditorState } from "@codemirror/state";
import { MarkdownSourceWorkspace } from "./MarkdownSourceWorkspace";
import { invalidateEditorDocument } from "../lib/editor-session-cache";
import { deltaToProseMirror, isProseMirror, proseMirrorToDelta } from "../lib/delta-converter";
import { ToolbarIcon } from "./ToolbarIcon";
import { DocumentTitlePreview } from "./DocumentTitlePreview";
import { MarkdownEscapeRepair } from "./MarkdownEscapeRepair";
import { api } from "../lib/api";
import { useMarkdownViewPosition } from "../hooks/useMarkdownViewPosition";
import { patchReadingState, readReadingState } from "../lib/reading-state";

/** One visible editing surface, one canonical autosave stream for both views. */
export function MarkdownDocumentView({ props, render }: { props: NoteEditorProps; render: (props: NoteEditorProps) => ReactNode }) {
  const navigationTarget = useNavigationStore(state => state.target?.noteId === props.noteId ? state.target : null);
  const mobile = useMobileViewport();
  const [preview, setPreview] = useState(() => localStorage.getItem("nr:markdownSplitPreview") === "true");
  const [source, setSource] = useState<string | null>(null);
  const viewPosition = useMarkdownViewPosition(props.noteId, source !== null, props.sensitive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<{ base: DeltaOps; content: DeltaOps } | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;
  const latestReader = useRef<(() => DeltaOps) | null>(null);
  const initial = useRef<{ text: string; content: DeltaOps } | null>(null);
  const sourceSession = useRef<SourceNavigationSession | null>(null);
  const sourceEditorState = useRef<EditorState | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const supported = props.content.metadata?.sourceFormat !== "text" && !props.pdfExcerptSource && !props.epubExcerptSource;
  const editSource = (text: string, range?: SourceEditRange) => {
    setSource(text);
    const revision = sourceSession.current?.update(text, range);
    if (!revision) return;
    const read = () => revision.read();
    invalidateEditorDocument(props.noteId);
    latestReader.current = read;
    props.onContentChange(read);
  };
  const changeView = async (restoreSourceTop?: number) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await latestProps.current.onFlush?.();
      if (!alive.current) return;
      // Read after the awaited save: input typed while storage was busy must
      // also be included before the rich editor is unmounted.
      const raw = latestReader.current?.() ?? latestProps.current.content;
      const content: DeltaOps = isProseMirror(raw) ? { ...proseMirrorToDelta(raw), metadata: raw.metadata } : raw;
      if (source === null) {
        const originalSource = content.metadata?.markdownSource;
        const text = typeof originalSource === "string" ? originalSource : await deltaToMarkdownAsync(content);
        if (!alive.current) return;
        // An edit during the worker conversion must never be replaced by its stale result.
        if ((latestReader.current?.() ?? latestProps.current.content) !== raw) throw new Error("转换期间正文已变化，请再次切换");
        initial.current = { text, content };
        sourceSession.current = new SourceNavigationSession(text, content);
        viewPosition.toSource(text, deltaToProseMirror(content), restoreSourceTop);
        setSource(text);
      } else {
        // A bookmark destination takes priority over the source viewport.
        if (latestProps.current.searchTarget?.bookmarkId) viewPosition.cancelHandoff();
        else viewPosition.toRendered(source, deltaToProseMirror(content));
        invalidateEditorDocument(props.noteId);
        setSnapshot({ base: latestProps.current.content, content });
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
    const saved = props.sensitive ? null : readReadingState(props.noteId);
    if (!useNavigationStore.getState().target && !props.searchTarget?.bookmarkId && supported && saved?.view === "source" && saved.source) void restoreViewRef.current(saved.source.scrollTop);
  }, [props.noteId, props.sensitive, props.searchTarget?.bookmarkId, supported]);
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
    if (!target?.bookmarkId || source === null || busy || bookmarkViewRequest.current === target.requestId) return;
    bookmarkViewRequest.current = target.requestId;
    const bookmark = sourceSession.current?.current.bookmarks.find(item => item.id === target.bookmarkId);
    if (bookmark) jumpSourceRef.current(bookmark.offset);
    onSearchTargetConsumed?.(target.requestId);
  }, [props.searchTarget, onSearchTargetConsumed, source, busy]);
  const historyViewRequest = useRef<number>();
  useEffect(() => {
    if (navigationTarget && source !== null && !busy && historyViewRequest.current !== navigationTarget.requestId) {
      historyViewRequest.current = navigationTarget.requestId;
      jumpSourceRef.current(sourceSession.current?.current.offsetAt(navigationTarget.from) ?? 0, false);
      useNavigationStore.getState().consumed(navigationTarget.requestId);
    }
  }, [navigationTarget, source, busy]);
  useEffect(() => {
    // Source cleanup runs before this effect; explicit return to rendered wins.
    if (source === null && !props.sensitive && initial.current) patchReadingState(props.noteId, { view: "rendered" });
  }, [source, props.noteId, props.sensitive]);
  if (!supported) return render(props);
  const toggle = <button type="button" className="markdown-view-toggle" disabled={busy}
    title={source === null ? "切换到 Markdown 源码" : "切换到渲染视图"}
    aria-busy={busy} onClick={() => void changeView()}>{source === null ? "源码" : "渲染"}</button>;
  return <div className="markdown-document-view" ref={viewPosition.host}>
    {error && <div role="alert" className="markdown-source-hint">{error}</div>}
    {source === null ? render({
      ...props,
      documentViewToggle: toggle,
      content: snapshot?.base === props.content ? snapshot.content : props.content,
      onContentChange: reader => {
        let cached: DeltaOps | undefined;
        const read = () => {
          if (cached) return cached;
          const content = reader();
          const metadata = { ...content.metadata };
          // Rendered edits invalidate the original spelling/spacing, not other metadata.
          delete metadata.markdownSource;
          cached = { ...content, metadata };
          return cached;
        };
        latestReader.current = read;
        props.onContentChange(read);
      },
    }) : <MarkdownSourceWorkspace revision={sourceSession.current!.current} areaRef={viewPosition.area} onJump={offset => jumpSourceRef.current(offset)}>{controls => <>
      <div className="note-title-row markdown-source-title-row">
        {props.titleSecurityAction}
        {props.onReadonlyChange && <button type="button" className="note-readonly-badge note-readonly-action" disabled={busy}
          aria-label={props.readonly ? "切换为可编辑" : "设置只读"} title={props.readonly ? "切换为可编辑" : "设置只读"}
          onClick={() => props.onReadonlyChange?.(!props.readonly)}><ToolbarIcon name={props.readonly ? "lock" : "unlock"} /></button>}
        <div className="note-title-field"><DocumentTitlePreview title={props.title || "无标题"} /></div>
        {toggle}
        {!mobile && <button type="button" className="markdown-view-toggle" aria-pressed={preview} onClick={() => { setPreview(!preview); localStorage.setItem("nr:markdownSplitPreview", String(!preview)); }}>并排预览</button>}
        {controls}
        <NavigationButtons />
        {props.onFocusModeChange && <button type="button" className="focus-btn" aria-label={props.focusMode ? "退出专注模式" : "专注模式"}
          onClick={() => props.onFocusModeChange?.(!props.focusMode)}><ToolbarIcon name={props.focusMode ? "compress" : "expand"} /></button>}
      </div>
      <div className="markdown-source-hint"><span role="status">{busy ? "正在同步…" : props.saveStatus === "error" ? "保存失败" : props.saveStatus === "dirty" || props.saveStatus === "saving" ? "待保存" : "已同步"}</span> · 修改源码后按 Markdown 保存，不保留字体、颜色等额外富文本样式；仅切换视图不会改写内容。</div>
      <MarkdownEscapeRepair source={source} disabled={busy || Boolean(props.readonly)} onApply={async (before, after) => {
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
      }} />
      <MarkdownSplitPreview enabled={preview && !mobile} revision={sourceSession.current!.current} areaRef={viewPosition.area} fontSize={props.editorFontSize}>
      <MarkdownSourceEditor value={source} readonly={Boolean(props.readonly) || busy}
        areaRef={viewPosition.area} session={sourceEditorState} onChange={editSource}
        showLineNumbers={props.showLineNumbers} fontSize={props.editorFontSize} highlightActiveLine={props.highlightActiveLine} />
      </MarkdownSplitPreview>
    </>}</MarkdownSourceWorkspace>}
  </div>;
}
