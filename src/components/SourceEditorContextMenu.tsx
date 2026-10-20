import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { selectAll, redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { copyToClipboard } from "../lib/clipboard";
import { readClipboardContent } from "../lib/clipboard-content";

export interface SourceContextTarget {
  x: number;
  y: number;
  view: EditorView;
  readonly: boolean;
  trigger: HTMLElement;
}

export function SourceEditorContextMenu({ target, close }: {
  target: SourceContextTarget;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selection = target.view.state.selection.main;
  const canEdit = !target.readonly && !target.view.state.readOnly;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [target]);
  useEffect(() => {
    const outside = (event: Event) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); target.trigger.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("scroll", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("scroll", outside, true);
    };
  }, [close, target.trigger]);
  const run = (action: () => void) => { close(); action(); target.view.focus(); };
  const copy = () => {
    if (selection.empty) return;
    void copyToClipboard(target.view.state.sliceDoc(selection.from, selection.to));
  };
  const cut = () => {
    if (selection.empty || !canEdit) return;
    const text = target.view.state.sliceDoc(selection.from, selection.to);
    void copyToClipboard(text);
    target.view.dispatch({ changes: { from: selection.from, to: selection.to }, selection: { anchor: selection.from }, userEvent: "input" });
  };
  const paste = async () => {
    if (!canEdit) return;
    try {
      const { text } = await readClipboardContent();
      if (!text) return;
      const range = target.view.state.selection.main;
      target.view.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: range.from + text.length }, userEvent: "input" });
      target.view.focus();
    } catch { /* Clipboard permissions are controlled by the browser/OS. */ }
  };
  const actions: Array<{ label: string; disabled?: boolean; run: () => void }> = [
    { label: "撤销", disabled: !canEdit, run: () => { undo(target.view); } },
    { label: "重做", disabled: !canEdit, run: () => { redo(target.view); } },
    { label: "剪切", disabled: !canEdit || selection.empty, run: cut },
    { label: "复制", disabled: selection.empty, run: copy },
    { label: "粘贴", disabled: !canEdit, run: () => { void paste(); } },
    { label: "全选", run: () => { selectAll(target.view); } },
  ];
  return createPortal(<div ref={ref} className="doc-context-menu source-context-menu" role="menu" aria-label="源码编辑菜单" data-sidebar-owned
    style={{ left: target.x, top: target.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    {actions.map(action => <button key={action.label} type="button" role="menuitem" className="doc-context-item" disabled={action.disabled} onClick={() => run(action.run)}>{action.label}</button>)}
  </div>, document.body);
}
