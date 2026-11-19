import { CONTEXT_COMMAND_COMPLETE, editorContextContains } from "../lib/editor-context-chain";
import { anchoredMenuPosition } from "../lib/anchored-menu-position";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
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
  const owner = useId();
  const childCommand = useRef<{ command: EditorSurfaceCommand; trigger: HTMLElement } | null>(null);
  const closeChild = useCallback(() => {
    const child = childCommand.current;
    childCommand.current = null;
    if (child?.command.source.isConnected && child.command.source.getAttribute("aria-expanded") === "true") child.command.source.click();
  }, []);
  const openChild = (command: EditorSurfaceCommand, trigger: HTMLElement) => {
    if (command.disabled) return;
    if (childCommand.current?.command.source === command.source && command.source.getAttribute("aria-expanded") === "true") return;
    closeChild();
    childCommand.current = { command, trigger };
    invokeEditorCommand(command, trigger);
  };

  useEffect(() => { if (!contextMenu) closeChild(); }, [contextMenu, closeChild]);
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
    const root = contextMenuRef.current;
    const close = () => { closeChild(); setContextMenu(null); setContextSubmenu(null); };
    // The leaf menu already closed itself. Do not toggle its toolbar button
    // again: React may not have committed that close yet.
    const complete = () => { childCommand.current = null; setContextMenu(null); setContextSubmenu(null); };
    const outside = (event: Event) => { if (!root || !editorContextContains(root, event.target)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
      const target = event.target instanceof Element ? event.target : null;
      if (root && !root.contains(target) && editorContextContains(root, target)) {
        // BlockActionMenu owns its deeper flyouts and Escape/Left behavior.
        if (target?.closest(".block-action-menu")) return;
        const opener = childCommand.current?.trigger;
        event.preventDefault(); event.stopImmediatePropagation(); closeChild(); opener?.focus({ preventScroll: true }); return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      if (childCommand.current?.command.source.getAttribute("aria-expanded") === "true") {
        const opener = childCommand.current.trigger; closeChild(); opener.focus({ preventScroll: true });
      } else if (contextSubmenu) {
        setContextSubmenu(null);
        Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-context-group]") ?? [])
          .find(button => button.dataset.contextGroup === contextSubmenu)?.focus({ preventScroll: true });
      } else if (event.key === "Escape") close();
    };
    root?.addEventListener(CONTEXT_COMMAND_COMPLETE, complete);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("blur", close);
    return () => { root?.removeEventListener(CONTEXT_COMMAND_COMPLETE, complete); document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", key, true); window.removeEventListener("scroll", outside, true); window.removeEventListener("blur", close); };
  }, [contextMenu, contextMenuRef, setContextMenu, setContextSubmenu, active, contextSubmenu, closeChild]);
  useLayoutEffect(() => {
    if (contextMenu) contextMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [contextMenu, contextMenuRef]);
  useLayoutEffect(() => {
    const element = contextMenuRef.current;
    if (!contextMenu || !element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))}px`;
    const submenu = element.querySelector<HTMLElement>(".editor-context-submenu");
    const opener = element.querySelector<HTMLElement>('.editor-context-parent[aria-expanded="true"]');
    if (submenu && opener) {
      const parent = element.getBoundingClientRect(), item = opener.getBoundingClientRect();
      const position = anchoredMenuPosition({ left: parent.left, right: parent.right, top: item.top, bottom: item.bottom }, submenu.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, "side", 0);
      submenu.style.left = `${position.x}px`;
      submenu.style.top = `${position.y}px`;
    }
  }, [contextMenu, contextSubmenu, commands, contextMenuRef]);
  useEffect(() => { if (!active) { closeChild(); setContextMenu(null); setContextSubmenu(null); } }, [active, closeChild, setContextMenu, setContextSubmenu]);
  if (!contextMenu || !active) return null;
  const run = (action: () => void) => { closeChild(); action(); setContextMenu(null); setContextSubmenu(null); };
  return createPortal(<div ref={contextMenuRef} className="editor-context-menu" data-editor-context-root="true" data-editor-context-owner={owner} role="menu" aria-label="正文操作" style={{ left: contextMenu.x, top: contextMenu.y }}
    onPointerOver={event => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button");
      if (event.pointerType === "mouse" && button && !button.closest(".editor-context-submenu") && !button.hasAttribute("aria-haspopup")) {
        closeChild(); setContextSubmenu(null);
      }
    }}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>("button");
      if (event.key === "ArrowRight" && button) {
        event.preventDefault(); event.stopPropagation();
        if (button.dataset.contextGroup) {
          closeChild(); setContextSubmenu(button.dataset.contextGroup);
          requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLButtonElement>(".editor-context-submenu button:not(:disabled)")?.focus({ preventScroll: true }));
        } else if (button.getAttribute("aria-haspopup") === "menu") button.click();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const group = target.closest(".editor-context-submenu");
      const buttons = Array.from((group ?? contextMenuRef.current)?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
        .filter(item => group || !item.closest(".editor-context-submenu"));
      const index = buttons.indexOf(button!);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    }}>
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
        <button className="editor-context-item editor-context-parent" data-context-group={group} aria-haspopup="menu" aria-expanded={contextSubmenu === group}
          onPointerEnter={event => { if (event.pointerType === "mouse") { if (contextSubmenu !== group) closeChild(); setContextSubmenu(group); } }}
          onClick={() => { if (contextSubmenu !== group) closeChild(); setContextSubmenu(group); }}>{group}<DisclosureIcon expanded={contextSubmenu === group} /></button>
        {contextSubmenu === group && <div className="editor-context-submenu" style={{ position: "fixed", margin: 0, maxHeight: "calc(100vh - 16px)", overflowY: "auto" }} role="group" aria-label={group}>
          {items.map(command => <button key={command.id} title={command.source.title} className={`editor-context-item editor-context-subitem ${command.active ? "active" : ""}`} disabled={command.disabled} aria-haspopup={command.submenu ? "menu" : undefined} aria-expanded={command.submenu ? command.source.getAttribute("aria-expanded") === "true" : undefined}
            onPointerEnter={event => {
              if (event.pointerType !== "mouse") return;
              if (command.submenu && !command.disabled) openChild(command, event.currentTarget);
              else closeChild();
            }}
            onClick={event => { if (command.submenu) openChild(command, event.currentTarget); else { closeChild(); invokeEditorCommand(command, event.currentTarget); setContextMenu(null); setContextSubmenu(null); } }}>
            {command.label}{command.submenu && <DisclosureIcon expanded={false} />}
          </button>)}
        </div>}
      </div>;
    })}
  </div>, document.body);
}
