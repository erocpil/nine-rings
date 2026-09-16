import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NoteEditorProps } from "./NoteEditor";
import type { DeltaOps } from "../types/models";
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { mdToDelta } from "../lib/md-parser";
import { invalidateEditorDocument } from "../lib/editor-session-cache";
import { isProseMirror, proseMirrorToDelta } from "../lib/delta-converter";

/** One visible editing surface, one canonical autosave stream for both views. */
export function MarkdownDocumentView({ props, render }: { props: NoteEditorProps; render: (props: NoteEditorProps) => ReactNode }) {
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<{ base: DeltaOps; content: DeltaOps } | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;
  const latestReader = useRef<(() => DeltaOps) | null>(null);
  const initial = useRef<{ text: string; content: DeltaOps } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const supported = props.content.metadata?.sourceFormat !== "text" && !props.pdfExcerptSource && !props.epubExcerptSource;
  const changeView = async () => {
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
        const text = typeof originalSource === "string" ? originalSource : deltaToMarkdown(content);
        initial.current = { text, content };
        setSource(text);
      } else {
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
  if (!supported) return render(props);
  return <div className="markdown-document-view">
    <div className="markdown-view-toolbar" role="toolbar" aria-label="文档显示方式">
      <button type="button" disabled={busy || source === null} aria-pressed={source === null} onClick={() => void changeView()}>渲染</button>
      <button type="button" disabled={busy || source !== null} aria-pressed={source !== null} onClick={() => void changeView()}>源码</button>
      {busy && <span role="status">正在同步…</span>}
      {source !== null && <>
        <button type="button" disabled={busy} onClick={() => props.onReadonlyChange?.(!props.readonly)}>{props.readonly ? "切换为可编辑" : "设置只读"}</button>
        {props.onFocusModeChange && <button type="button" onClick={() => props.onFocusModeChange?.(!props.focusMode)}>{props.focusMode ? "退出专注模式" : "专注模式"}</button>}
        <span>{props.saveStatus === "error" ? "保存失败" : props.saveStatus === "dirty" || props.saveStatus === "saving" ? "待保存" : "已同步"}</span>
      </>}
    </div>
    {error && <div role="alert" className="markdown-source-hint">{error}</div>}
    {source === null ? render({
      ...props,
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
    }) : <section className="note-editor markdown-source-editor" aria-label="Markdown 源码编辑区">
      <div className="markdown-source-hint">{props.title || "无标题"} · 修改源码后按 Markdown 保存，不保留字体、颜色等额外富文本样式；仅切换视图不会改写内容。</div>
      <textarea aria-label="Markdown 源码" value={source} readOnly={Boolean(props.readonly) || busy} spellCheck={false}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.key.toLowerCase() === "a") {
            event.preventDefault(); event.stopPropagation(); event.currentTarget.select();
          }
        }}
        onChange={event => {
          const text = event.target.value;
          setSource(text);
          const original = initial.current!;
          let cached: DeltaOps | undefined;
          const read = () => {
            if (cached) return cached;
            if (text === original.text) return original.content;
            const metadata = { ...latestProps.current.content.metadata, sourceFormat: "markdown" as const, markdownSource: text };
            // Positions in the old rich document no longer identify the same blocks.
            delete metadata.bookmarks;
            cached = { ...mdToDelta(text), metadata };
            invalidateEditorDocument(props.noteId);
            return cached;
          };
          latestReader.current = read;
          props.onContentChange(read);
        }} />
    </section>}
  </div>;
}
