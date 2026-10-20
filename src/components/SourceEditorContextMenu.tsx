import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { selectAll, redo, undo, undoDepth, redoDepth, indentMore, indentLess, toggleComment } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { copyToClipboard } from "../lib/clipboard";
import { readClipboardContent } from "../lib/clipboard-content";
import { sourceLineChange, sourceLineRange, type SourceLineAction } from "../lib/source-line-actions";

export interface SourceContextTarget {
  x: number;
  y: number;
  view: EditorView;
  readonly: boolean;
  trigger: HTMLElement;
  lineNumber?: number;
  onToggleBookmark?: () => void;
}

export function SourceEditorContextMenu({ target, close }: {
  target: SourceContextTarget;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const snapshot = useMemo(() => ({ active: true, doc: target.view.state.doc, selection: target.view.state.selection.main }), [target]);
  const selection = snapshot.selection;
  const lineNumber = target.lineNumber;
  const line = lineNumber === undefined ? null : snapshot.doc.line(lineNumber);
  const canEdit = !target.readonly && !target.view.state.readOnly && !target.view.composing;
  const canComment = line && target.view.state.languageDataAt<{ line?: string; block?: unknown }>("commentTokens", line.from).some(tokens => tokens.line || tokens.block);
  const canPaste = Boolean(navigator.clipboard?.readText || navigator.clipboard?.read);
  useLayoutEffect(() => {
    setBusy(false); setMessage("");
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [target]);
  useEffect(() => {
    snapshot.active = true;
    const outside = (event: Event) => {
      if (target.lineNumber !== undefined && event.target instanceof Element
        && event.target.closest(".cm-lineNumbers") && target.view.dom.contains(event.target)) return;
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); target.view.focus(); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    return () => {
      snapshot.active = false;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
    };
  }, [close, target, snapshot]);
  const finish = () => { close(); if (target.view.dom.isConnected) target.view.focus(); };
  const assertCurrent = (editing = false) => {
    if (!snapshot.active || !target.view.dom.isConnected || target.view.state.doc !== snapshot.doc
      || editing && (!canEdit || target.view.state.readOnly)) throw new Error("文档或编辑状态已变化，请重新打开菜单。");
  };
  const changeLine = (action: SourceLineAction, clipboard = "") => {
    assertCurrent(true);
    const change = sourceLineChange(target.view.state, lineNumber!, action, clipboard);
    if (change) target.view.dispatch(change);
  };
  const run = (action: () => void) => {
    try { assertCurrent(); action(); finish(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const clipboard = async (kind: "copy" | "cut" | "paste" | "paste-before" | "paste-after") => {
    setBusy(true); setMessage("");
    try {
      assertCurrent(kind !== "copy");
      if (kind === "copy" || kind === "cut") {
        await copyToClipboard(line ? `${line.text}\n` : snapshot.doc.sliceString(selection.from, selection.to), { reportFailure: true });
        assertCurrent(kind === "cut");
        if (kind === "cut") {
          if (line) changeLine("delete");
          else target.view.dispatch({ changes: { from: selection.from, to: selection.to }, selection: { anchor: selection.from }, userEvent: "input" });
        }
      } else {
        const { text } = await readClipboardContent();
        assertCurrent(true);
        if (!text) throw new Error("剪贴板中没有可粘贴的文本。");
        if (kind === "paste") target.view.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: { anchor: selection.from + text.length }, userEvent: "input" });
        else changeLine(kind, text);
      }
      finish();
    } catch (error) {
      if (snapshot.active) setMessage(error instanceof Error ? error.message : "无法访问剪贴板，请检查权限。");
    } finally { if (snapshot.active) setBusy(false); }
  };
  type Action = { label: string; disabled?: boolean; group?: boolean; run: () => void };
  const editLineCommand = (command: (view: EditorView) => boolean) => {
    assertCurrent(true);
    target.view.dispatch({ selection: { anchor: line!.from } });
    command(target.view);
  };
  const actions: Action[] = line ? [
    { label: "选择本行", run: () => run(() => { const range = sourceLineRange(target.view.state, lineNumber!); target.view.dispatch({ selection: { anchor: range.from, head: range.to } }); }) },
    { label: "复制行", run: () => { void clipboard("copy"); } },
    { label: "剪切行", disabled: !canEdit, run: () => { void clipboard("cut"); } },
    { label: "删除行", disabled: !canEdit, run: () => run(() => changeLine("delete")) },
    { label: "复制到下一行", disabled: !canEdit, run: () => run(() => changeLine("duplicate")) },
    { label: "在本行前粘贴", group: true, disabled: !canEdit || !canPaste, run: () => { void clipboard("paste-before"); } },
    { label: "在本行后粘贴", disabled: !canEdit || !canPaste, run: () => { void clipboard("paste-after"); } },
    { label: "在本行前插入空行", disabled: !canEdit, run: () => run(() => changeLine("blank-before")) },
    { label: "在本行后插入空行", disabled: !canEdit, run: () => run(() => changeLine("blank-after")) },
    { label: "上移一行", group: true, disabled: !canEdit || lineNumber === 1, run: () => run(() => changeLine("move-up")) },
    { label: "下移一行", disabled: !canEdit || lineNumber === snapshot.doc.lines, run: () => run(() => changeLine("move-down")) },
    { label: "增加缩进", disabled: !canEdit, run: () => run(() => editLineCommand(indentMore)) },
    { label: "减少缩进", disabled: !canEdit, run: () => run(() => editLineCommand(indentLess)) },
    { label: "切换注释", disabled: !canEdit || !canComment, run: () => run(() => editLineCommand(toggleComment)) },
    ...(target.onToggleBookmark ? [{ label: "添加/移除本行书签", group: true, run: () => run(target.onToggleBookmark!) }] : []),
  ] : [
    { label: "撤销", disabled: !canEdit || undoDepth(target.view.state) === 0, run: () => run(() => { undo(target.view); }) },
    { label: "重做", disabled: !canEdit || redoDepth(target.view.state) === 0, run: () => run(() => { redo(target.view); }) },
    { label: "剪切", disabled: !canEdit || selection.empty, run: () => { void clipboard("cut"); } },
    { label: "复制", disabled: selection.empty, run: () => { void clipboard("copy"); } },
    { label: "粘贴", disabled: !canEdit || !canPaste, run: () => { void clipboard("paste"); } },
    { label: "全选", run: () => run(() => { selectAll(target.view); }) },
  ];
  return createPortal(<div ref={ref} className="doc-context-menu source-context-menu" role="menu" aria-label={line ? "源码行菜单" : "源码编辑菜单"} data-sidebar-owned
    style={{ left: target.x, top: target.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    {line && <div className="source-line-menu-title">第 {lineNumber} 行</div>}
    {actions.map(action => <div key={action.label}>{action.group && <div className="source-line-menu-divider" role="separator" />}<button type="button" role="menuitem" className="doc-context-item" disabled={busy || action.disabled} onClick={action.run}>{action.label}</button></div>)}
    {message && <div className="source-line-menu-message" role="status">{message}</div>}
  </div>, document.body);
}
