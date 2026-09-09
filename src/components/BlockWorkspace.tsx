import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Step, StepMap } from "@tiptap/pm/transform";
import { closeHistory } from "@tiptap/pm/history";
import { OPEN_BLOCK_WORKSPACE, takeBlockWorkspace } from "../lib/block-workspace";
import { clipboardSliceToPlainText } from "../lib/clipboard-plain-text";
import { copyToClipboard } from "../lib/clipboard";
import { ToolbarIcon } from "./ToolbarIcon";
import "./block-workspace.css";

type Request = { position: number; trigger: HTMLElement };
type Props = { source: Editor; noteId?: string; readonly?: boolean; saveStatus?: string; onFlush?: () => Promise<void> };

export function BlockWorkspaceHost(props: Props) {
  const [request, setRequest] = useState<Request | null>(null);
  const close = useCallback(() => setRequest(null), []);
  useEffect(() => {
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const request = event.detail as Request;
      const node = props.source.state.doc.nodeAt(request.position);
      if (node && ["codeBlock", "blockquote"].includes(node.type.name)) setRequest(request);
    };
    const dom = props.source.view.dom;
    dom.addEventListener(OPEN_BLOCK_WORKSPACE, open);
    const pending = props.noteId ? takeBlockWorkspace(props.noteId) : undefined;
    if (pending !== undefined) {
      const node = props.source.view.nodeDOM(pending);
      const trigger = node instanceof HTMLElement ? node.querySelector<HTMLElement>(".block-workspace-open") : null;
      if (trigger) setRequest({ position: pending, trigger });
    }
    return () => dom.removeEventListener(OPEN_BLOCK_WORKSPACE, open);
  }, [props.source, props.noteId]);
  return request && <BlockWorkspace {...props} request={request} onClose={close} />;
}

/** A scoped view of the original block. Edits are mapped into the source
 * transaction stream; only the source owns undo history and persistence. */
function BlockWorkspace({ source, readonly, saveStatus, onFlush, request, onClose }: Props & { request: Request; onClose: () => void }) {
  const initial = useMemo(() => source.state.doc.nodeAt(request.position)!, [source, request]);
  const position = useRef(request.position);
  const currentNode = useRef(initial);
  const bridging = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const editable = mode === "edit" && !readonly;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice.startsWith("已复制")) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [closing, setClosing] = useState(false);
  const [color, setColor] = useState("#333333");
  const rootType = initial.type.name;
  const name = rootType === "codeBlock" ? "代码块" : "引用块";
  const extensions = useMemo(() => [
    ...source.extensionManager.extensions.filter(extension =>
      extension.type === "node" || extension.type === "mark" || ["blockIndent", "fontSize", "orderedListLayout"].includes(extension.name),
    ).map(extension => extension.name === "doc"
      ? extension.extend({ content: rootType })
      : extension.configure({ ...extension.options })),
    Extension.create({
      name: "blockWorkspaceScope",
      addKeyboardShortcuts: () => ({
        "Mod-z": () => { if (editableRef.current) source.commands.undo(); return true; },
        "Mod-Shift-z": () => { if (editableRef.current) source.commands.redo(); return true; },
        "Mod-y": () => { if (editableRef.current) source.commands.redo(); return true; },
      }),
      addProseMirrorPlugins: () => [new Plugin({
        filterTransaction: transaction => !transaction.docChanged || Boolean(transaction.getMeta("workspace-sync")) || (
          editableRef.current && transaction.doc.childCount === 1 && transaction.doc.firstChild?.type.name === rootType
        ),
      })],
    }),
  ], [source, rootType]);
  const editor = useEditor({
    extensions,
    content: { type: "doc", content: [initial.toJSON()] },
    editable: false,
    editorProps: { attributes: { "aria-label": "块内容", tabindex: "0" }, clipboardTextSerializer: clipboardSliceToPlainText },
    onUpdate: ({ editor: local, transaction }) => {
      if (!transaction.docChanged || bridging.current || !editableRef.current || !source.isEditable) return;
      const sourceNode = source.state.doc.nodeAt(position.current);
      if (!sourceNode || sourceNode !== currentNode.current) { setNotice("原块已发生变化，请关闭后重新打开。"); return; }
      try {
        const mapped = source.state.tr;
        for (const step of transaction.steps) {
          const translated = Step.fromJSON(source.schema, step.toJSON()).map(StepMap.offset(position.current));
          if (!translated) throw new Error("无法映射编辑位置");
          mapped.step(translated);
        }
        mapped.setSelection(TextSelection.near(mapped.doc.resolve(position.current + local.state.selection.from)));
        bridging.current = true;
        source.view.dispatch(mapped);
        currentNode.current = source.state.doc.nodeAt(position.current)!;
      } catch { setNotice("同步原块失败，请关闭并检查原文，勿继续编辑。"); local.setEditable(false); }
      finally { bridging.current = false; }
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor) return;
    const onTransaction = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
      if (bridging.current || !transaction.docChanged) return;
      const mapped = transaction.mapping.mapResult(position.current, 1);
      if (mapped.deleted) { onClose(); return; }
      position.current = mapped.pos;
      const node = source.state.doc.nodeAt(mapped.pos);
      if (!node || node.type.name !== rootType) { onClose(); return; }
      currentNode.current = node;
      const next = editor.schema.nodeFromJSON({ type: "doc", content: [node.toJSON()] });
      const start = editor.state.doc.content.findDiffStart(next.content);
      if (start === null) return;
      const end = editor.state.doc.content.findDiffEnd(next.content)!;
      const overlap = start - Math.min(end.a, end.b);
      const tr = editor.state.tr.replace(start, end.a + Math.max(0, overlap), next.slice(start, end.b + Math.max(0, overlap)));
      bridging.current = true;
      editor.view.dispatch(tr.setMeta("workspace-sync", true).setMeta("addToHistory", false));
      bridging.current = false;
    };
    source.on("transaction", onTransaction);
    source.view.dispatch(closeHistory(source.state.tr));
    return () => { source.off("transaction", onTransaction); if (!source.isDestroyed) source.view.dispatch(closeHistory(source.state.tr)); };
  }, [editor, source, rootType, onClose]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = request.trigger;
    const scroller = source.view.dom.closest(".note-editor-scroll");
    const scrollTop = scroller?.scrollTop;
    const resize = () => {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const rect = source.view.dom.closest(".note-editor")?.getBoundingClientRect();
      const left = Math.max(x, rect?.left ?? x), top = Math.max(y, rect?.top ?? y);
      const right = Math.min(x + width, rect?.right ?? x + width), bottom = Math.min(y + height, rect?.bottom ?? y + height);
      Object.assign(element.style, { left: `${left + 8}px`, top: `${top + 8}px`, width: `${Math.max(1, right - left - 16)}px`, height: `${Math.max(1, bottom - top - 16)}px` });
    };
    resize();
    element.showModal();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      element.close();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      if (scroller && scrollTop !== undefined) scroller.scrollTop = scrollTop;
      if (opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [source, request]);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    try { await onFlush?.(); onClose(); }
    catch { setNotice("保存失败，内容仍保留在原文中，请重试保存。"); }
    finally { setClosing(false); }
  };
  const copy = async () => {
    if (!editor) return;
    const slice = editor.state.doc.slice(0);
    const text = clipboardSliceToPlainText(slice);
    try {
      const { dom } = editor.view.serializeForClipboard(slice);
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([dom.innerHTML], { type: "text/html" }) })]);
      setNotice("已复制块（保留格式）");
    } catch {
      try { await copyToClipboard(text, { reportFailure: true }); setNotice("已复制块（纯文本）"); }
      catch { setNotice("复制失败，请检查剪贴板权限。"); }
    }
  };
  const iconButton = (label: string, icon: Parameters<typeof ToolbarIcon>[0]["name"], run: () => void) =>
    <button type="button" title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={run}><ToolbarIcon name={icon} /></button>;

  return createPortal(<dialog ref={dialog} className="block-workspace" aria-label={`${name}工作区`}
    onCancel={event => { event.preventDefault(); if (!editor?.view.composing) void close(); }}
    onClick={event => { if (event.target === event.currentTarget && !editable) void close(); }}
    onKeyDown={event => { event.stopPropagation(); }}>
    <header className="block-workspace-header">
      <strong>{name}</strong>
      <div role="group" aria-label="块模式">
        <button type="button" aria-pressed={!editable} onClick={() => setMode("read")}>阅读</button>
        {!readonly && <button type="button" aria-pressed={editable} onClick={() => setMode("edit")}>编辑</button>}
      </div>
      <span className="block-workspace-save" role="status">{saveStatus === "error" ? "保存失败" : saveStatus === "saving" || saveStatus === "dirty" ? "保存中…" : "已保存"}</span>
      {iconButton("复制块", "copy", () => void copy())}
      <button type="button" aria-label="关闭块工作区" title="关闭" disabled={closing} onClick={() => void close()}><ToolbarIcon name="compress" /></button>
    </header>
    {editable && editor && <div className="block-workspace-tools" role="toolbar" aria-label="块编辑工具">
      {iconButton("撤销", "undo", () => { source.commands.undo(); })}
      {iconButton("重做", "redo", () => { source.commands.redo(); })}
      {iconButton("减少缩进", "outdent", () => { editor.chain().focus().outdentBlocks().run(); })}
      {iconButton("增加缩进", "indent", () => { editor.chain().focus().indentBlocks().run(); })}
      {rootType === "blockquote" && <>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} title="粗体"><strong>B</strong></button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体"><em>I</em></button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线"><s>S</s></button>
        {iconButton("无序列表", "bullet", () => { editor.chain().focus().toggleBulletList().run(); })}
        {iconButton("有序列表", "ordered", () => { editor.chain().focus().toggleOrderedList().run(); })}
        {iconButton("块内换行", "lineBreak", () => { editor.chain().focus().setHardBreak().run(); })}
        <label>文字颜色<input type="color" value={color} onChange={event => { setColor(event.target.value); editor.chain().focus().setColor(event.target.value).run(); }} /></label>
        {iconButton("清除文字颜色", "erase", () => { editor.chain().focus().unsetColor().run(); })}
        <select aria-label="文字字号" defaultValue="" onChange={event => editor.chain().focus().setMark("textStyle", { fontSize: event.target.value || null }).run()}>
          <option value="">默认字号</option>{[12, 14, 16, 18, 20, 24, 32].map(size => <option key={size} value={size}>{size}</option>)}
        </select>
      </>}
    </div>}
    {notice && <div className="block-workspace-notice" role="status">{notice}</div>}
    <div ref={body} className="block-workspace-body editor-content" onPasteCapture={event => { if (!editable) event.preventDefault(); }} onBeforeInputCapture={event => { if (!editable) event.preventDefault(); }}>
      <EditorContent editor={editor} />
    </div>
  </dialog>, document.body);
}
