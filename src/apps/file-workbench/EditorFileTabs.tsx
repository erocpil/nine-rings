import type { DiskChange } from "../../lib/local-files/disk-changes";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { NotesContextMenu, type NotesMenuTarget } from "../../components/NotesContextMenu";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import { copyToClipboard } from "../../lib/clipboard";
import type { WorkbenchEditorSession } from "./editor-window";

const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: "grapheme" }) => { segment: (text: string) => Iterable<{ segment: string }> } }).Segmenter;
const graphemes = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : undefined;

function shortName(name: string) {
  const characters = graphemes ? Array.from(graphemes.segment(name), part => part.segment) : Array.from(name);
  return characters.length <= 8 ? name : `${characters.slice(0, 8).join("")}…`;
}

function filePath({ id, file }: WorkbenchEditorSession) {
  return file.bufferId ? file.bufferPath : id;
}

type Drop = { anchor: string; after: boolean };
type Drag = { id: string; pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean; drop?: Drop };

export function EditorFileTabs({ files, current, dirty, changed, select, close, closeMany, discard, reorder, reveal, report }: {
  files: WorkbenchEditorSession[]; current: string | null; dirty: Record<string, boolean>; changed: DiskChange[];
  select: (id: string) => void; close: (id: string) => void; closeMany: (ids: string[]) => void;
  discard: (id: string) => void; reorder: (id: string, anchor: string, after: boolean) => void;
  reveal: (id: string) => void; report: (error: unknown) => void;
}) {
  const [menu, setMenu] = useState<NotesMenuTarget | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [drop, setDrop] = useState<Drop>();
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { cancelAnimationFrame(frame.current); clearTimeout(clickTimer.current); }, []);

  const locateDrop = (pointer: Drag, list: HTMLDivElement) => {
    const target = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>("[data-editor-tab-id]");
    let next: Drop | undefined;
    if (target?.parentElement === list && target.dataset.editorTabId && target.dataset.editorTabId !== pointer.id) {
      const bounds = target.getBoundingClientRect();
      const rightHalf = pointer.x >= bounds.left + bounds.width / 2;
      next = { anchor: target.dataset.editorTabId, after: rightHalf !== (getComputedStyle(list).direction === "rtl") };
    }
    if (next?.anchor !== pointer.drop?.anchor || next?.after !== pointer.drop?.after) {
      pointer.drop = next;
      setDrop(next);
    }
  };
  const tick = () => {
    const pointer = drag.current, list = root.current;
    if (!pointer?.moved || !list) return;
    const rect = list.getBoundingClientRect();
    if (pointer.y >= rect.top && pointer.y < rect.bottom && pointer.x >= rect.left && pointer.x < rect.right) {
      if (pointer.x < rect.left + 22) list.scrollLeft -= 8;
      else if (pointer.x > rect.right - 22) list.scrollLeft += 8;
    }
    locateDrop(pointer, list);
    frame.current = requestAnimationFrame(tick);
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const pointer = drag.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    cancelAnimationFrame(frame.current);
    if (pointer.moved && commit && root.current) {
      pointer.x = event.clientX; pointer.y = event.clientY;
      locateDrop(pointer, root.current);
      if (pointer.drop) reorder(pointer.id, pointer.drop.anchor, pointer.drop.after);
    }
    drag.current = null;
    setDrop(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clickTimer.current = setTimeout(() => { suppressClick.current = false; }, 0);
  };
  const menuIndex = files.findIndex(file => file.id === menu?.id);
  const menuFile = files[menuIndex];
  const path = menuFile && filePath(menuFile);
  const copy = (text: string) => { void copyToClipboard(text, { reportFailure: true }).catch(report); };
  return <>
    <div className="workbench-editor-tabs" ref={root} role="tablist" aria-label="编辑文件标签" onWheel={event => {
      if (!root.current || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      root.current.scrollLeft += event.deltaY;
    }} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !files.length || event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      const index = Math.max(0, files.findIndex(item => item.id === current));
      const next = event.key === "Home" ? 0 : event.key === "End" ? files.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + files.length) % files.length;
      select(files[next].id);
    }}>
      {files.map((file, index) => {
        const hasDiskChange = changed.some(item => item.id === file.id);
        return <div className="workbench-editor-tab" key={file.id} data-editor-tab-id={file.id}
          data-disk-changed={hasDiskChange || undefined} data-active={file.id === current || undefined} data-drop-edge={drop?.anchor === file.id ? (drop.after ? "after" : "before") : undefined}>
          <button role="tab" type="button" aria-selected={file.id === current} tabIndex={file.id === current ? 0 : -1}
            aria-description={hasDiskChange ? "磁盘版本有变更" : undefined}
            aria-label={`${dirty[file.id] ? "未保存 " : ""}${file.file.node.name}`}
            title={`${file.file.node.name}\n${filePath(file) ?? "尚未保存到磁盘"}`} data-tooltip-align="start" data-tooltip-wide="true"
            onPointerDown={event => {
              if (event.button !== 0 || event.pointerType === "touch") return;
              clearTimeout(clickTimer.current);
              suppressClick.current = false;
              drag.current = { id: file.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const pointer = drag.current;
              if (!pointer || pointer.pointerId !== event.pointerId || !(event.buttons & 1)) return;
              pointer.x = event.clientX; pointer.y = event.clientY;
              if (!pointer.moved && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 6) {
                pointer.moved = true;
                suppressClick.current = true;
                tick();
              }
            }}
            onPointerUp={event => finishDrag(event, true)}
            onPointerCancel={event => finishDrag(event, false)}
            onLostPointerCapture={event => finishDrag(event, false)}
            onClick={event => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); return; } select(file.id); }}
            onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close(file.id); } }}
            onKeyDown={event => {
              if (!event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const after = event.key === "ArrowRight";
              const neighbor = files[index + (after ? 1 : -1)];
              if (neighbor) reorder(file.id, neighbor.id, after);
            }}
            onContextMenu={event => { event.preventDefault(); setMenu({ id: file.id, x: event.clientX, y: event.clientY, title: file.file.node.name, trigger: event.currentTarget }); }}>
            {dirty[file.id] && <span aria-hidden="true">●</span>}{hasDiskChange && <span className="disk-change-badge" aria-hidden="true">↻</span>}<span className="workbench-editor-tab-name">{shortName(file.file.node.name)}</span>
          </button>
          <button type="button" className="btn-icon" aria-label={`关闭 ${file.file.node.name}`} onClick={() => close(file.id)}><ToolbarIcon name="close" /></button>
        </div>;
      })}
    </div>
    {menu && menuFile && <NotesContextMenu label="编辑文件标签菜单" target={menu} close={() => setMenu(null)} actions={[
      { label: "在文件浏览中显示", disabled: !path, run: () => reveal(menuFile.id) },
      { label: "复制文件名", run: () => copy(menuFile.file.node.name) },
      { label: "复制完整路径", disabled: !path, run: () => { if (path) copy(path); } },
      { label: "向左移动标签", separator: true, disabled: menuIndex === 0, run: () => reorder(menuFile.id, files[menuIndex - 1].id, false) },
      { label: "向右移动标签", disabled: menuIndex === files.length - 1, run: () => reorder(menuFile.id, files[menuIndex + 1].id, true) },
      { label: "关闭此文件", separator: true, run: () => close(menuFile.id) },
      { label: "关闭其它标签", disabled: files.length <= 1, run: () => closeMany(files.filter(file => file.id !== menuFile.id).map(file => file.id)) },
      { label: "关闭右侧标签", disabled: menuIndex === files.length - 1, run: () => closeMany(files.slice(menuIndex + 1).map(file => file.id)) },
      ...(menuFile.file.bufferId ? [{ label: "删除本机编辑草稿…", separator: true, danger: true, run: () => discard(menuFile.id) }] : []),
    ]} />}
  </>;
}
