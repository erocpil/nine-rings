import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorToolbarProps } from "./EditorToolbarContents";
import { selectWholeDocument } from "../extensions/BlockSelectAll";
import { DisclosureIcon } from "./DisclosureIcon";
import { editorCommandGroups, readEditorCommands, invokeEditorCommand, type EditorSurfaceCommand } from "../lib/editor-command-surface";

interface EditorContextMenuProps {
  editor: Editor;
  toolbarRef: RefObject<HTMLDivElement>;
  readonly?: boolean;
  active?: boolean;
  contextMenu: { x: number; y: number } | null;
  contextMenuRef: RefObject<HTMLDivElement>;
  setContextMenu: (position: { x: number; y: number } | null) => void;
  contextSubmenu: string | null;
  setContextSubmenu: Dispatch<SetStateAction<string | null>>;
  hasCurrentBookmark: boolean;
  bookmarkCount: number;
  annotationSelectionAvailable?: boolean;
  onAnnotateSelection?: () => void;
  onCopyReference?: (kind: "block" | "position") => Promise<void>;
  sourceCopy?: { label: string; run: () => void };
  bookmarksAvailable?: boolean;
  actions: Pick<EditorToolbarProps["actions"], "hasSelection" | "handleCopy" | "handleCopyBlock" | "openDocumentBookmarks" | "toggleCurrentBookmark"> & Partial<EditorToolbarProps["actions"]>;
}

/** Grouped projection of the same live commands used by the toolbar and selection surface. */
export function EditorContextMenu({ editor, toolbarRef, readonly, active = true, contextMenu, contextMenuRef, setContextMenu, contextSubmenu, setContextSubmenu, hasCurrentBookmark, bookmarkCount, annotationSelectionAvailable = false, onAnnotateSelection, actions, onCopyReference, sourceCopy, bookmarksAvailable = true }: EditorContextMenuProps) {
  const [commands, setCommands] = useState<EditorSurfaceCommand[]>([]);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!contextMenu || !toolbar) { setCommands([]); return; }
    const refresh = () => setCommands(readEditorCommands(toolbar));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(toolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "class", "aria-pressed", "aria-expanded", "title", "aria-label", "hidden"] });
    return () => observer.disconnect();
  }, [contextMenu, toolbarRef]);
  useEffect(() => {
    if (!contextMenu || !active) return;
    const close = () => { setContextMenu(null); setContextSubmenu(null); };
    const outside = (event: Event) => { if (!contextMenuRef.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("blur", close);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", key, true); window.removeEventListener("scroll", outside, true); window.removeEventListener("blur", close); };
  }, [contextMenu, contextMenuRef, setContextMenu, setContextSubmenu, active]);
  useLayoutEffect(() => {
    const element = contextMenuRef.current;
    if (!contextMenu || !element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))}px`;
  }, [contextMenu, contextSubmenu, commands, contextMenuRef]);
  useEffect(() => { if (!active) { setContextMenu(null); setContextSubmenu(null); } }, [active, setContextMenu, setContextSubmenu]);
  if (!contextMenu || !active) return null;
  const run = (action: () => void) => { action(); setContextMenu(null); };
  return createPortal(<div ref={contextMenuRef} className="editor-context-menu" role="menu" aria-label="正文操作" style={{ left: contextMenu.x, top: contextMenu.y }}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => event.stopPropagation()}>
    <button className="editor-context-item" onClick={() => run(() => selectWholeDocument(editor))}>全选</button>
    {readonly && <>
      {annotationSelectionAvailable && <button className="editor-context-item" onClick={() => run(() => onAnnotateSelection?.())}>选中文字并添加阅读标注</button>}
      <button className="editor-context-item" disabled={!actions.hasSelection()} onClick={() => run(() => { void actions.handleCopy(); })}>复制</button>
      <button className="editor-context-item" onClick={() => run(() => { void actions.handleCopyBlock(); })}>复制块</button>
      {onCopyReference && <button className="editor-context-item" onClick={() => run(() => { void onCopyReference("block"); })}>复制块引用</button>}
      {onCopyReference && <button className="editor-context-item" onClick={() => run(() => { void onCopyReference("position"); })}>{actions.hasSelection() ? "复制选中文字引用" : "复制此处引用"}</button>}
      {sourceCopy && <button className="editor-context-item" onClick={() => run(sourceCopy.run)}>{sourceCopy.label}</button>}
    </>}
    {bookmarksAvailable && <button className="editor-context-item" onClick={() => run(actions.toggleCurrentBookmark)}>{hasCurrentBookmark ? "取消当前位置书签" : "添加当前位置书签"}</button>}
    {bookmarksAvailable && bookmarkCount > 0 && <button className="editor-context-item" onClick={() => run(actions.openDocumentBookmarks)}>打开书签列表 <span>{bookmarkCount}</span></button>}
    {editorCommandGroups.map(group => {
      if (readonly && group !== "编辑" && group !== "文档") return null;
      const items = commands.filter(command => command.group === group && command.label !== "全选" && !(readonly && command.label === "复制"));
      if (!items.length) return null;
      return <div key={group}>
        <button className="editor-context-item editor-context-parent" aria-expanded={contextSubmenu === group}
          onClick={() => setContextSubmenu(current => current === group ? null : group)}>{group}<DisclosureIcon expanded={contextSubmenu === group} /></button>
        {contextSubmenu === group && <div className="editor-context-submenu" role="group" aria-label={group}>
          {items.map(command => <button key={command.id} title={command.source.title} className={`editor-context-item editor-context-subitem ${command.active ? "active" : ""}`} disabled={command.disabled}
            onClick={event => { invokeEditorCommand(command, event.currentTarget); setContextMenu(null); }}>
            {command.label}{command.submenu && <DisclosureIcon expanded={false} />}
          </button>)}
        </div>}
      </div>;
    })}
  </div>, document.body);
}
