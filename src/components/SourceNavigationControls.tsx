import { useState, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { jumpSourceStructure } from "../lib/source-structural-navigation";
import { jumpSourceMark, repeatSourceEdit, selectSourceObject, setSourceMark, sourceMarks } from "../lib/source-navigation-actions";
import { ToolbarIcon } from "./ToolbarIcon";
import { WorkspaceDialog } from "./WorkspaceDialog";

export function SourceNavigationControls({ editorRef, onMessage }: { editorRef: MutableRefObject<EditorView | null>; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [revision, setRevision] = useState(0);
  const act = (command: (view: EditorView) => boolean) => {
    const view = editorRef.current;
    if (!view || !command(view)) onMessage("当前位置没有可用目标或可安全重复的编辑。");
    view?.focus();
  };
  const buttons = [
    ["上一同级或外层行", "chevronLeft", (v: EditorView) => jumpSourceStructure(v, -1)],
    ["下一同级或外层行", "chevronRight", (v: EditorView) => jumpSourceStructure(v, 1)],
    ["跳到外层缩进", "indent", (v: EditorView) => jumpSourceStructure(v, -1, true)],
    ["选择括号内文本", "code", (v: EditorView) => selectSourceObject(v, "brackets")],
    ["选择引号内文本", "quote", (v: EditorView) => selectSourceObject(v, "quote")],
    ["选择整个函数", "formatSelection", (v: EditorView) => selectSourceObject(v, "function")],
    ["重复上次简单编辑", "redo", repeatSourceEdit],
  ] as const;
  return <>
    {buttons.map(([label, icon, command]) => <button type="button" key={label} title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={() => act(command)}><ToolbarIcon name={icon} /></button>)}
    <button type="button" title="临时位置标记（仅当前文档会话）" aria-label="临时位置标记" onMouseDown={event => event.preventDefault()} onClick={() => setOpen(true)}><ToolbarIcon name="bookmark" /></button>
    {open && <WorkspaceDialog title="临时位置标记" onClose={() => setOpen(false)}>
      <form className="source-format-config" data-revision={revision} onSubmit={event => { event.preventDefault(); const view = editorRef.current; if (view && setSourceMark(view, name.trim())) { setName(""); setRevision(value => value + 1); } else onMessage("标记名称需为 1～32 个文字、数字、下划线或连字符。"); }}>
        <p>标记跟随编辑移动；仅在当前文档编辑会话内保留，不写入正文或持久书签。</p>
        <label>名称<input aria-label="临时标记名称" value={name} maxLength={32} onChange={event => setName(event.target.value)} /></label>
        <button className="menu-btn" type="submit" disabled={!name.trim()}>保存当前位置</button>
        {editorRef.current && sourceMarks(editorRef.current).map(([label, position]) => <button className="menu-btn" type="button" key={label} onClick={() => { act(view => jumpSourceMark(view, label)); setOpen(false); }}>{label} · Ln {editorRef.current!.state.doc.lineAt(position).number}</button>)}
      </form>
    </WorkspaceDialog>}
  </>;
}
