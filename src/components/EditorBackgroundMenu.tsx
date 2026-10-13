import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { ToolbarIcon } from "./ToolbarIcon";
import { preserveReadingPositions } from "../lib/reading-position";
const colors = ["#d6a348", "#c27565", "#83a66e", "#63a2b8", "#a088b5", "#999999"];
export function EditorBackgroundMenu({ editor, readonly }: { editor: Editor; readonly?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const cell = editor.isActive("table") && (editor.state.selection instanceof CellSelection || editor.state.selection.empty);
  const apply = (color: string | null) => {
    if (readonly || !editor.isEditable) return;
    preserveReadingPositions(() => {
      if (cell) editor.chain().focus(undefined, { scrollIntoView: false }).setCellAttribute("backgroundColor", color).run();
      else if (color) editor.chain().focus(undefined, { scrollIntoView: false }).setMark("inlineHighlight", { backgroundColor: color }).run();
      else editor.chain().focus(undefined, { scrollIntoView: false }).unsetMark("inlineHighlight").run();
    });
  };
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); event.preventDefault(); event.stopPropagation(); } };
    document.addEventListener("click", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="menu-dropdown" ref={root} data-toolbar-tool="background">
    <button className="menu-btn" type="button" title={cell ? "单元格背景色" : "文字背景色"} aria-label={cell ? "单元格背景色" : "文字背景色"} aria-expanded={open} disabled={readonly}
      onClick={event => { event.stopPropagation(); setOpen(value => !value); }}><ToolbarIcon name="highlight" /></button>
    {open && <div className="menu-dropdown-list color-grid" aria-label="背景色选择">
      {colors.map(color => <button key={color} type="button" className="color-swatch" style={{ backgroundColor: color }} title={color} aria-label={`背景色 ${color}`} onClick={() => { apply(color); setOpen(false); }} />)}
      <label className="menu-dropdown-control">自定义背景色<input type="color" aria-label="自定义背景色" defaultValue="#d6a348" onChange={event => apply(event.target.value)} /></label>
      <button className="menu-dropdown-item" type="button" onClick={() => { apply(null); setOpen(false); }}>清除背景色</button>
    </div>}
  </div>;
}
