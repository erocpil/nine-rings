import { useRef, useState } from "react";
import { NotesContextMenu, type NotesMenuTarget } from "../../components/NotesContextMenu";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import type { WorkbenchEditorSession } from "./editor-window";

const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: "grapheme" }) => { segment: (text: string) => Iterable<{ segment: string }> } }).Segmenter;
const graphemes = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : undefined;

function shortName(name: string) {
  const characters = graphemes ? Array.from(graphemes.segment(name), part => part.segment) : Array.from(name);
  return characters.length <= 8 ? name : `${characters.slice(0, 8).join("")}…`;
}

export function EditorFileTabs({ files, current, dirty, select, close, discard }: {
  files: WorkbenchEditorSession[]; current: string | null; dirty: Record<string, boolean>;
  select: (id: string) => void; close: (id: string) => void; discard: (id: string) => void;
}) {
  const [menu, setMenu] = useState<NotesMenuTarget | null>(null);
  const root = useRef<HTMLDivElement>(null);
  return <>
    <div className="workbench-editor-tabs" ref={root} role="tablist" aria-label="编辑文件标签" onWheel={event => {
      if (!root.current || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      root.current.scrollLeft += event.deltaY;
    }} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !files.length) return;
      event.preventDefault();
      const index = Math.max(0, files.findIndex(item => item.id === current));
      const next = event.key === "Home" ? 0 : event.key === "End" ? files.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + files.length) % files.length;
      select(files[next].id);
    }}>
      {files.map(file => <div className="workbench-editor-tab" key={file.id} data-active={file.id === current || undefined}>
        <button role="tab" type="button" aria-selected={file.id === current} tabIndex={file.id === current ? 0 : -1}
          aria-label={`${dirty[file.id] ? "未保存 " : ""}${file.file.node.name}`}
          title={file.file.bufferPath ?? (file.file.untitled ? `${file.file.node.name}\n尚未选择保存位置` : file.id)} onClick={() => select(file.id)}
          onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close(file.id); } }}
          onContextMenu={event => { event.preventDefault(); setMenu({ id: file.id, x: event.clientX, y: event.clientY, title: file.file.node.name, trigger: event.currentTarget }); }}>
          {dirty[file.id] && <span aria-hidden="true">●</span>}<span className="workbench-editor-tab-name">{shortName(file.file.node.name)}</span>
        </button>
        <button type="button" className="btn-icon" aria-label={`关闭 ${file.file.node.name}`} onClick={() => close(file.id)}><ToolbarIcon name="close" /></button>
      </div>)}
    </div>
    {menu && <NotesContextMenu label="编辑文件标签菜单" target={menu} close={() => setMenu(null)} actions={[{ label: "关闭此文件", run: () => close(menu.id) }, ...(files.find(item => item.id === menu.id)?.file.bufferId ? [{ label: "删除本机编辑草稿…", run: () => discard(menu.id) }] : [])]} />}
  </>;
}
