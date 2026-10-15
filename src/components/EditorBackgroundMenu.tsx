import { applyToolbarColor } from "../lib/toolbar-color";
import { useToolbarColor } from "../hooks/useToolbarColor";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { ToolbarIcon } from "./ToolbarIcon";
import { preserveReadingPositions } from "../lib/reading-position";
const colors = ["#d6a348", "#c27565", "#83a66e", "#63a2b8", "#a088b5", "#999999"];
export function EditorBackgroundMenu({ editor, readonly, open, setOpen, onToggle }: { editor: Editor; readonly?: boolean; open: boolean; setOpen: (open: boolean) => void; onToggle: () => void }) {
  const [lastColor, rememberColor] = useToolbarColor("background", "#d6a348");
  const cell = editor.isActive("table") && (editor.state.selection instanceof CellSelection || editor.state.selection.empty);
  const apply = (color: string | null) => {
    if (readonly || !editor.isEditable) return;
    if (color) rememberColor(color);
    preserveReadingPositions(() => {
      if (cell) editor.chain().focus(undefined, { scrollIntoView: false }).setCellAttribute("backgroundColor", color).run();
      else applyToolbarColor(editor, "background", color);
    });
  };
  return <div className="menu-dropdown toolbar-split-button" data-toolbar-tool="background">
    <button className="menu-btn" type="button" title={cell ? "单元格背景色" : "文字背景色"} aria-label={cell ? "单元格背景色" : "文字背景色"} disabled={readonly}
      onClick={() => { apply(lastColor); setOpen(false); }}><ToolbarIcon name="highlight" /><span className="color-preview" style={{ backgroundColor: lastColor }} /></button>
    <button className="menu-btn toolbar-split-caret" type="button" title="选择背景色" aria-label="选择背景色" aria-expanded={open} disabled={readonly} onClick={event => { event.stopPropagation(); onToggle(); }}><span className="toolbar-dropdown-caret" aria-hidden="true"><span className="toolbar-solid-caret" /></span></button>
    {open && <div className="menu-dropdown-list color-grid" aria-label="背景色选择">
      <div className="color-swatches">{colors.map(color => <button key={color} type="button" className="color-swatch" style={{ backgroundColor: color }} title={color} aria-label={`背景色 ${color}`} onClick={() => { apply(color); setOpen(false); }} />)}</div>
      <label className="menu-dropdown-control">自定义背景色<input type="color" aria-label="自定义背景色" value={lastColor} onChange={event => apply(event.target.value)} /></label>
      <button className="menu-dropdown-item" type="button" onClick={() => { apply(null); setOpen(false); }}>清除背景色</button>
    </div>}
  </div>;
}
