import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Step, StepMap } from "@tiptap/pm/transform";
import { closeHistory } from "@tiptap/pm/history";
import { OPEN_BLOCK_WORKSPACE, queueBlockWorkspace, takeBlockWorkspace } from "../lib/block-workspace";
import { clipboardSliceToPlainText } from "../lib/clipboard-plain-text";
import { copyToClipboard } from "../lib/clipboard";
import { ToolbarIcon } from "./ToolbarIcon";
import { CopyBlockNotice } from "./CopyBlockNotice";
import "./block-workspace.css";
import { WorkspaceWhitespace, setWorkspaceWhitespace } from "../extensions/WorkspaceWhitespace";
import type { WhitespaceMode } from "../lib/whitespace-markers";
import { SearchHighlights, findSearchMatches, setSearchHighlights } from "../extensions/SearchHighlights";
import { createReplacementTransaction } from "../lib/editor-replace";
import { blockWorkspacePreferences, saveBlockWorkspacePreferences } from "../lib/block-display-settings";
import { codeLineNumbersPluginKey } from "../extensions/CodeBlockLineNumbers";
import { storeImage } from "../lib/storage/db-images";
import { blobToBase64 } from "../lib/storage/core";
import { normalizePastedHTML, normalizeSingleParagraphPaste } from "../extensions/NormalizeSingleParagraphPaste";
import { CodeMirrorBlockEditor } from "./CodeMirrorBlockEditor";

type Request = { position: number; trigger: HTMLElement; restoreFocus?: boolean };
type Props = { source: Editor; noteId?: string; readonly?: boolean; sensitive?: boolean; saveStatus?: string; onFlush?: () => Promise<void> };

export function BlockWorkspaceHost(props: Props) {
  const [request, setRequest] = useState<Request | null>(null);
  const close = useCallback(() => setRequest(null), []);
  const navigate = useCallback((position: number) => {
    const node = props.source.view.nodeDOM(position);
    const trigger = node instanceof HTMLElement ? node.querySelector<HTMLElement>(".block-workspace-open") : null;
    if (trigger) setRequest({ position, trigger });
  }, [props.source]);
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
    let frame = 0;
    let delivered = false;
    if (pending !== undefined) {
      let attempts = 0;
      const openWhenMounted = () => {
        const node = props.source.view.nodeDOM(pending);
        const trigger = node instanceof HTMLElement ? node.querySelector<HTMLElement>(".block-workspace-open") : null;
        if (trigger) { delivered = true; setRequest({ position: pending, trigger }); }
        else if (++attempts < 30) frame = window.requestAnimationFrame(openWhenMounted);
      };
      frame = window.requestAnimationFrame(openWhenMounted);
    }
    return () => {
      dom.removeEventListener(OPEN_BLOCK_WORKSPACE, open);
      window.cancelAnimationFrame(frame);
      // React Strict Mode may replay this effect before NodeViews mount.
      if (!delivered && pending !== undefined && props.noteId) queueBlockWorkspace(props.noteId, pending);
    };
  }, [props.source, props.noteId]);
  return request && <BlockWorkspace key={request.position} {...props} request={request} onClose={close} onNavigate={navigate} />;
}

/** A scoped view of the original block. Edits are mapped into the source
 * transaction stream; only the source owns undo history and persistence. */
function BlockWorkspace({ source, readonly, sensitive, saveStatus, onFlush, request, onClose, onNavigate }: Props & { request: Request; onClose: () => void; onNavigate: (position: number) => void }) {
  const initial = useMemo(() => source.state.doc.nodeAt(request.position)!, [source, request]);
  const position = useRef(request.position);
  const currentNode = useRef(initial);
  const bridging = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const editable = mode === "edit" && !readonly;
  const [vimMode, setVimMode] = useState<"normal" | "insert">("normal");
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const [notice, setNotice] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  useEffect(() => {
    if (!copyNotice.startsWith("已复制")) return;
    const timer = window.setTimeout(() => setCopyNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);
  const [closing, setClosing] = useState(false);
  const [color, setColor] = useState("#333333");
  const [whitespace] = useState<WhitespaceMode>(() => blockWorkspacePreferences().whitespace ?? "off");
  const [tabSize] = useState(() => blockWorkspacePreferences().tabSize ?? 4);
  const [wrap] = useState(() => blockWorkspacePreferences().wrap ?? true);
  const [fontSize] = useState(() => blockWorkspacePreferences().fontSize ?? (Math.round(parseFloat(getComputedStyle(source.view.dom).fontSize)) || 16));
  const [lineNumbers, setLineNumbers] = useState(() => blockWorkspacePreferences().lineNumbers ?? codeLineNumbersPluginKey.getState(source.state) ?? false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [line, setLine] = useState("");
  const [insertKind, setInsertKind] = useState<"link" | "image" | null>(null);
  const [url, setUrl] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const rootType = initial.type.name;
  const name = rootType === "codeBlock" ? "代码块" : "引用块";
  const sourceDocument = source.state.doc;
  const peers = useMemo(() => {
    const positions: number[] = [];
    sourceDocument.descendants((node, position) => { if (node.type.name === rootType) positions.push(position); });
    return positions;
  }, [sourceDocument, rootType]);
  const peerIndex = peers.indexOf(position.current);
  const extensions = useMemo(() => [
    ...source.extensionManager.extensions.filter(extension =>
      extension.type === "node" || extension.type === "mark" || ["blockIndent", "fontSize", "orderedListLayout", "blockSelectAll"].includes(extension.name),
    ).map(extension => extension.name === "doc"
      ? extension.extend({ content: rootType })
      : extension.configure({ ...extension.options })),
    WorkspaceWhitespace, SearchHighlights,
    Extension.create({
      name: "blockWorkspaceScope",
      addKeyboardShortcuts: () => ({
        "Mod-z": () => { if (editableRef.current) source.commands.undo(); return true; },
        "Mod-Shift-z": () => { if (editableRef.current) source.commands.redo(); return true; },
        "Mod-y": () => { if (editableRef.current) source.commands.redo(); return true; },
      }),
      addProseMirrorPlugins: () => [new Plugin({
        filterTransaction: transaction => !transaction.docChanged || Boolean(transaction.getMeta("workspace-sync")) || (
          editableRef.current && source.isEditable && transaction.doc.childCount === 1 && transaction.doc.firstChild?.type.name === rootType
        ),
      })],
    }),
  ], [source, rootType]);
  const editor = useEditor({
    extensions,
    content: { type: "doc", content: [initial.toJSON()] },
    editable: false,
    editorProps: { attributes: { "aria-label": "块内容", tabindex: "0" }, clipboardTextSerializer: clipboardSliceToPlainText, transformPastedHTML: normalizePastedHTML, transformPasted: normalizeSingleParagraphPaste },
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

  const documentNode = editor?.state.doc;
  const matches = useMemo(() => documentNode && !sensitive ? findSearchMatches(documentNode, query, true) : [], [documentNode, query, sensitive]);
  useEffect(() => {
    if (editor) setSearchHighlights(editor, matches, Math.min(matchIndex, Math.max(0, matches.length - 1)));
  }, [editor, matches, matchIndex]);
  useEffect(() => { if (editor) setWorkspaceWhitespace(editor, editable ? "off" : whitespace); }, [editor, editable, whitespace]);

  const reveal = (pos: number) => {
    if (!editor || !body.current) return;
    const coordinates = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
    body.current.scrollTop += coordinates.top - body.current.getBoundingClientRect().top - 24;
  };
  const preservePosition = (change: () => void) => {
    const element = body.current;
    if (!element || !editor) { change(); return; }
    const rect = element.getBoundingClientRect();
    const pos = editor.view.posAtCoords({ left: rect.left + Math.min(80, rect.width / 2), top: rect.top + 8 })?.pos;
    const offset = pos === undefined ? 0 : editor.view.coordsAtPos(pos).top - rect.top;
    change();
    window.requestAnimationFrame(() => {
      if (editor.isDestroyed || pos === undefined || !element.isConnected) return;
      element.scrollTop += editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size)).top - element.getBoundingClientRect().top - offset;
    });
  };
  const navigateMatch = (direction: number) => {
    if (!matches.length) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next); reveal(matches[next].from);
  };
  const replace = (all: boolean) => {
    if (!editable || !editor) return;
    const result = createReplacementTransaction(editor.state, query, replacement, all ? undefined : matchIndex);
    if (result.count) editor.view.dispatch(result.transaction);
    setNotice(/[\r\n]/.test(replacement) ? "暂不支持跨行替换。" : `已替换当前块中的 ${result.count} 处`);
    setMatchIndex(0);
  };

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
      const safeTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0;
      // Reclaim a little of the source header area without entering the status
      // bar/notch. Leave more breathing room vertically, especially below.
      let left = Math.max(x, rect?.left ?? x), top = Math.max(y + safeTop, (rect?.top ?? y) - 24);
      let right = Math.min(x + width, rect?.right ?? x + width), bottom = Math.min(y + height, rect?.bottom ?? y + height);
      // A keyboard or a narrow desktop split can leave almost no editor area.
      // Keep the close/mode controls reachable using the visual viewport.
      if (right - left < 280) { left = x; right = x + width; }
      if (bottom - top < 160) { top = y + safeTop; bottom = y + height; }
      const topGap = 16, bottomGap = 36;
      Object.assign(element.style, { left: `${left + 8}px`, top: `${top + topGap}px`, width: `${Math.max(1, right - left - 16)}px`, height: `${Math.max(1, bottom - top - topGap - bottomGap)}px` });
    };
    resize();
    element.showModal();
    element.focus({ preventScroll: true });
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      element.close();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      if (scroller && scrollTop !== undefined) scroller.scrollTop = scrollTop;
      if (opener.isConnected && request.restoreFocus) opener.focus({ preventScroll: true });
      else if (document.activeElement === opener) opener.blur();
    };
  }, [source, request]);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    try { await onFlush?.(); onClose(); }
    catch { setNotice("保存失败，内容仍保留在原文中，请重试保存。"); }
    finally { setClosing(false); }
  };
  const nextBlock = async (direction: number) => {
    if (closing) return;
    setClosing(true);
    try {
      await onFlush?.();
      const target = peers[peerIndex + direction];
      if (target !== undefined && !source.isDestroyed) onNavigate(target);
    } catch { setNotice("保存失败，暂不切换块。请重试或复制内容备份。"); }
    finally { setClosing(false); }
  };
  const insertUrl = () => {
    if (!editor || !editable) return;
    const value = url.trim();
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(value) && !(insertKind === "image" && /^(nr-image:\/\/|data:image\/)/i.test(value))) {
      setNotice("请输入有效的链接或图片地址。"); return;
    }
    if (insertKind === "image") editor.chain().focus().setResizableImage({ src: value }).run();
    else if (editor.state.selection.empty) editor.chain().focus().insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href: value } }] }).run();
    else editor.chain().focus().setLink({ href: value }).run();
    setUrl(""); setInsertKind(null);
  };
  const copy = async () => {
    if (!editor) return;
    const slice = editor.state.doc.slice(0);
    const text = clipboardSliceToPlainText(slice);
    try {
      const { dom } = editor.view.serializeForClipboard(slice);
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([dom.innerHTML], { type: "text/html" }) })]);
      setCopyNotice("已复制块（保留格式）");
    } catch {
      try { await copyToClipboard(text, { reportFailure: true }); setCopyNotice("已复制块（纯文本）"); }
      catch { setCopyNotice("复制失败，请检查剪贴板权限。"); }
    }
  };
  const iconButton = (label: string, icon: Parameters<typeof ToolbarIcon>[0]["name"], run: () => void) =>
    <button type="button" title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={run}><ToolbarIcon name={icon} /></button>;

  return createPortal(<dialog ref={dialog} tabIndex={-1} className="block-workspace" data-block-type={rootType} role="dialog" aria-modal="true" aria-label={`${name}工作区`}
    onCancel={event => { event.preventDefault(); if (!editor?.view.composing) void close(); }}
    onKeyDownCapture={event => {
      if (event.target instanceof Element && event.target.closest(".cm-editor")) return;
      if (!editable) return;
      if (event.key === "Escape" && vimMode === "insert") {
        event.preventDefault(); event.stopPropagation(); setVimMode("normal"); return;
      }
      if (vimMode !== "normal") return;
      const key = event.key.toLowerCase();
      if (["i", "a", "o"].includes(key)) {
        event.preventDefault(); event.stopPropagation(); setVimMode("insert");
        window.requestAnimationFrame(() => editor?.commands.focus());
      } else if (["h", "j", "k", "l"].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        const command = key === "h" ? "ArrowLeft" : key === "j" ? "ArrowDown" : key === "k" ? "ArrowUp" : "ArrowRight";
        editor?.commands.keyboardShortcut(command);
      }
    }}
    onKeyDown={event => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (sensitive) { setNotice("加密正文不参与查找。"); return; }
        setFindOpen(true); window.requestAnimationFrame(() => searchInput.current?.focus());
      }
    }}>
    <header className="block-workspace-header">
      <strong>{name}</strong>
      {editable && <span className="block-workspace-vim-mode" role="status">VIM {vimMode === "normal" ? "NORMAL" : "INSERT"}</span>}
      <div role="group" aria-label="块模式">
        <button type="button" aria-pressed={!editable} onClick={() => preservePosition(() => setMode("read"))}>阅读</button>
        {!readonly && <button type="button" aria-pressed={editable} onClick={() => preservePosition(() => setMode("edit"))}>编辑</button>}
      </div>
      <span className="block-workspace-save" data-error={saveStatus === "error"} role="status" title="本机保存状态，不代表已完成备份">{saveStatus === "error" ? "保存失败" : saveStatus === "saving" || saveStatus === "dirty" ? "保存中…" : "已存本机"}</span>
      {iconButton("复制块", "copy", () => void copy())}
      {!sensitive && iconButton("块内查找", "search", () => { setFindOpen(!findOpen); window.requestAnimationFrame(() => searchInput.current?.focus()); })}
      {rootType === "codeBlock" && <button type="button" aria-label={lineNumbers ? "隐藏代码行号" : "显示代码行号"} aria-pressed={lineNumbers} title="代码行号" onMouseDown={event => event.preventDefault()} onClick={() => {
        preservePosition(() => { setLineNumbers(!lineNumbers); saveBlockWorkspacePreferences({ lineNumbers: !lineNumbers }); });
      }}>行号</button>}
      <button type="button" aria-label="关闭块工作区" title="关闭" disabled={closing} onClick={() => void close()}><ToolbarIcon name="compress" /></button>
    </header>
    {findOpen && !sensitive && <div className="block-workspace-find" role="search" aria-label="当前块查找">
      <input ref={searchInput} aria-label="在当前块查找" placeholder="在当前块查找" value={query} onChange={event => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); navigateMatch(event.shiftKey ? -1 : 1); } }} />
      <span>{matches.length ? `${Math.min(matchIndex + 1, matches.length)} / ${matches.length}` : "0 / 0"}</span>
      {iconButton("上一个匹配", "chevronLeft", () => navigateMatch(-1))}
      {iconButton("下一个匹配", "chevronRight", () => navigateMatch(1))}
      {editable && <>
        <input aria-label="当前块替换为" placeholder="替换为" value={replacement} onChange={event => setReplacement(event.target.value)} />
        <button type="button" onClick={() => replace(false)}>替换</button>
        <button type="button" onClick={() => replace(true)}>替换本块全部</button>
      </>}
    </div>}
    {findOpen && rootType === "codeBlock" && <div className="block-workspace-options"><form onSubmit={event => {
        event.preventDefault();
        const lines = editor?.state.doc.firstChild?.textContent.split("\n") ?? [];
        const number = Number(line);
        if (!Number.isInteger(number) || number < 1 || number > lines.length) { setNotice(`请输入 1–${lines.length} 的行号`); return; }
        reveal(1 + lines.slice(0, number - 1).reduce((length, text) => length + text.length + 1, 0));
      }}><input aria-label="跳转代码行" placeholder="行号" inputMode="numeric" value={line} onChange={event => setLine(event.target.value)} /><button type="submit">跳转</button></form>
    </div>}
    {editable && editor && <div className="block-workspace-tools" role="toolbar" aria-label="块编辑工具">
      {iconButton("撤销", "undo", () => { source.commands.undo(); })}
      {iconButton("重做", "redo", () => { source.commands.redo(); })}
      {iconButton("减少缩进", "outdent", () => { editor.chain().focus().updateAttributes(rootType, { indent: Math.max(0, Number(editor.state.doc.firstChild?.attrs.indent ?? 0) - 1) }).run(); })}
      {iconButton("增加缩进", "indent", () => { editor.chain().focus().updateAttributes(rootType, { indent: Math.min(8, Number(editor.state.doc.firstChild?.attrs.indent ?? 0) + 1) }).run(); })}
      {rootType === "blockquote" && <>
        <select aria-label="段落样式" defaultValue="paragraph" onChange={event => {
          if (event.target.value === "paragraph") editor.chain().focus().setParagraph().run();
          else editor.chain().focus().setHeading({ level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        }}><option value="paragraph">正文</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>H{level}</option>)}</select>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} title="粗体"><strong>B</strong></button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体"><em>I</em></button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线"><s>S</s></button>
        {iconButton("无序列表", "bullet", () => { editor.chain().focus().toggleBulletList().run(); })}
        {iconButton("有序列表", "ordered", () => { editor.chain().focus().toggleOrderedList().run(); })}
        {iconButton("块内换行", "lineBreak", () => { editor.chain().focus().setHardBreak().run(); })}
        {iconButton("行内代码", "code", () => { editor.chain().focus().toggleCode().run(); })}
        {iconButton("插入代码块", "note", () => { editor.chain().focus().setNode("codeBlock").run(); })}
        {iconButton("插入表格", "table", () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); })}
        {iconButton("添加或编辑链接", "link", () => { setInsertKind("link"); setUrl(String(editor.getAttributes("link").href ?? "")); })}
        {iconButton("移除链接", "erase", () => { editor.chain().focus().unsetLink().run(); })}
        {iconButton("插入图片地址", "image", () => { setInsertKind("image"); setUrl(""); })}
        {iconButton("上传图片", "plus", () => imageInput.current?.click())}
        <input ref={imageInput} type="file" accept="image/*" hidden onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file || !file.type.startsWith("image/")) return;
          const selection = editor.state.selection.getBookmark();
          const documentBeforeUpload = editor.state.doc;
          try {
            const src = await (sensitive ? blobToBase64(file) : storeImage(file));
            if (editor.isDestroyed || !editableRef.current || !source.isEditable) return;
            if (editor.state.doc !== documentBeforeUpload) { setNotice("图片读取期间内容已改变，请在新位置重新插入。"); return; }
            editor.view.dispatch(editor.state.tr.setSelection(selection.resolve(editor.state.doc)));
            editor.chain().focus().setResizableImage({ src }).run();
          } catch { setNotice("图片插入失败，请重试。"); }
        }} />
        <label>文字颜色<input type="color" value={color} onChange={event => { setColor(event.target.value); editor.chain().focus().setColor(event.target.value).run(); }} /></label>
        {iconButton("清除文字颜色", "erase", () => { editor.chain().focus().unsetColor().run(); })}
        <select aria-label="文字字号" defaultValue="" onChange={event => editor.chain().focus().setMark("textStyle", { fontSize: event.target.value || null }).run()}>
          <option value="">默认字号</option>{[12, 14, 16, 18, 20, 24, 32].map(size => <option key={size} value={size}>{size}</option>)}
        </select>
      </>}
    </div>}
    {insertKind && editable && <form className="block-workspace-options" onSubmit={event => { event.preventDefault(); insertUrl(); }}>
      <input aria-label={insertKind === "link" ? "链接地址" : "图片地址"} placeholder="https://…" value={url} onChange={event => setUrl(event.target.value)} autoFocus />
      <button type="submit">插入</button><button type="button" onClick={() => setInsertKind(null)}>取消</button>
    </form>}
    {notice && <div className="block-workspace-notice" data-error={notice.includes("失败")} role="status">{notice}</div>}
    <CopyBlockNotice message={copyNotice} onClose={() => setCopyNotice("")} withinDialog />
    <div ref={body} className="block-workspace-body editor-content" style={{ fontSize: `${fontSize}px`, tabSize }} onPasteCapture={event => { if (!editable) event.preventDefault(); }} onBeforeInputCapture={event => { if (!editable) event.preventDefault(); }}>
      {editable && rootType === "codeBlock" ? (
        <CodeMirrorBlockEditor
          value={initial.textContent}
          wrap={wrap}
          onModeChange={setVimMode}
          onChange={(value) => {
            const node = source.state.doc.nodeAt(position.current);
            if (!node || node.textContent === value) return;
            source.view.dispatch(source.state.tr.replaceWith(
              position.current + 1,
              position.current + node.nodeSize - 1,
              source.schema.text(value),
            ));
          }}
        />
      ) : <EditorContent editor={editor} />}
    </div>
    {peers.length > 1 && <nav className="block-workspace-navigation" aria-label="同类块导航">
      <button type="button" disabled={closing || peerIndex <= 0} onClick={() => void nextBlock(-1)}><ToolbarIcon name="chevronLeft" />上一个{name}</button>
      <span>{peerIndex + 1} / {peers.length}</span>
      <button type="button" disabled={closing || peerIndex >= peers.length - 1} onClick={() => void nextBlock(1)}>下一个{name}<ToolbarIcon name="chevronRight" /></button>
    </nav>}
  </dialog>, document.body);
}
