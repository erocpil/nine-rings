import { useEffect, useRef, useState } from "react";
import { browserLocation } from "../lib/local-files/browser-state";
import { MAX_BROWSER_TABS, type BrowserTabGroup } from "../lib/local-files/browser-tabs";
import type { FileRoot } from "../lib/local-files/service";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";

type Action = "pin" | "others" | "right" | "restore" | "left" | "next";
export function FileBrowserTabs({ group, roots, side, onSelect, onAdd, onAction, onReorder }: {
  group: BrowserTabGroup; roots: FileRoot[]; side: 0 | 1;
  onSelect: (index: number, close?: boolean) => void; onAdd: () => void;
  onAction: (id: string, action: Action) => void; onReorder: (id: string, targetId: string) => void;
}) {
  const [menu, setMenu] = useState<NotesMenuTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const pointer = useRef<{ id: string; x: number; y: number; moved: boolean; lastTarget?: string } | null>(null), suppressClick = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const index = group.tabs.findIndex(tab => tab.tabId === menu?.id), tab = group.tabs[index];
  return <div className="file-browser-tabs" role="tablist" aria-label={side === 0 ? "左栏目录标签" : "右栏目录标签"}>
    {group.tabs.map((tab, index) => {
      const location = browserLocation(tab), label = location?.node.split("/").pop() || roots.find(root => root.id === location?.rootId)?.name || "目录";
      return <div key={tab.tabId} className="file-browser-tab" data-tab-id={tab.tabId} data-pinned={Boolean(tab.pinned)} data-drop-target={dropTarget === tab.tabId}>
        <button role="tab" type="button" tabIndex={index === group.active ? 0 : -1} aria-label={label} aria-description={tab.pinned ? "固定标签" : undefined} aria-selected={index === group.active} title={location ? `${roots.find(root => root.id === location.rootId)?.name ?? location.rootId}/${location.node}` : label}
          onDoubleClick={event => { event.preventDefault(); if (!tab.pinned && group.tabs.length > 1) onSelect(index, true); }}
          onPointerDown={event => { if (event.button !== 0 || event.pointerType !== "mouse") return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); clearTimeout(timer.current); suppressClick.current = false; pointer.current = { id: tab.tabId, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => {
            const current = pointer.current;
            if (!current || current.id !== tab.tabId || !(event.buttons & 1)) return;
            if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
            current.moved = true; suppressClick.current = true; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-tab-id]");
            const id = target?.parentElement === event.currentTarget.closest("[role=tablist]") && target.dataset.tabId !== tab.tabId ? target.dataset.tabId : undefined;
            current.lastTarget = id; setDropTarget(id ?? null);
          }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); const current = pointer.current; if (current?.moved && current.lastTarget) onReorder(current.id, current.lastTarget); pointer.current = null; setDropTarget(null); timer.current = setTimeout(() => { suppressClick.current = false; }, 0); }}
          onPointerCancel={() => { setDropTarget(null); pointer.current = null; suppressClick.current = false; }}
          onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ id: tab.tabId, title: label, x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
          onKeyDown={event => {
            if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onAction(tab.tabId, event.key === "ArrowLeft" ? "left" : "next"); return; }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault(); event.stopPropagation(); const count = group.tabs.length;
            onSelect(event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + count) % count);
          }} onClick={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; return; } onSelect(index); }}>{tab.pinned && <span aria-label="固定">◆ </span>}{label}</button>
      </div>;
    })}
    <button type="button" aria-label="新建目录标签" title="新建目录标签" disabled={group.tabs.length >= MAX_BROWSER_TABS} onClick={onAdd}>＋</button>
    <button type="button" aria-label="恢复关闭的目录标签" title="恢复最近关闭的目录标签" disabled={!group.closed?.length || group.tabs.length >= MAX_BROWSER_TABS} onClick={() => onAction(group.tabs[group.active].tabId, "restore")}>↶</button>
    {menu && tab && <NotesContextMenu label="目录标签菜单" target={menu} close={() => setMenu(null)} actions={[
      { label: tab.pinned ? "取消固定标签" : "固定标签", run: () => onAction(tab.tabId, "pin") },
      { label: "向左移动标签", disabled: index === 0, run: () => onAction(tab.tabId, "left") },
      { label: "向右移动标签", disabled: index === group.tabs.length - 1, run: () => onAction(tab.tabId, "next") },
      { label: "关闭标签", disabled: tab.pinned || group.tabs.length === 1, run: () => onSelect(index, true) },
      { label: "关闭其它标签", disabled: !group.tabs.some(other => other !== tab && !other.pinned), run: () => onAction(tab.tabId, "others") },
      { label: "关闭右侧标签", disabled: !group.tabs.slice(index + 1).some(other => !other.pinned), run: () => onAction(tab.tabId, "right") },
      { label: "恢复关闭的标签", disabled: !group.closed?.length || group.tabs.length >= MAX_BROWSER_TABS, run: () => onAction(tab.tabId, "restore") },
    ]} />}
  </div>;
}
