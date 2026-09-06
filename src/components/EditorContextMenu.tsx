import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorToolbarProps } from "./EditorToolbarContents";

interface EditorContextMenuProps {
  editor: Editor;
  readonly?: boolean;
  contextMenu: { x: number; y: number } | null;
  contextMenuRef: RefObject<HTMLDivElement>;
  setContextMenu: (position: { x: number; y: number } | null) => void;
  contextSubmenu: "format" | "paragraph" | "insert" | null;
  setContextSubmenu: Dispatch<SetStateAction<"format" | "paragraph" | "insert" | null>>;
  hasCurrentBookmark: boolean;
  bookmarkCount: number;
  actions: Pick<EditorToolbarProps["actions"], "hasSelection" | "handleCut" | "handleClipboardPaste" | "handleCopy" | "openDocumentBookmarks" | "toggleCurrentBookmark" | "convertSelectionFromMarkdown" | "changeSelectedBlockIndent" | "setLinkDialogUrl" | "setLinkDialog" | "setImageDialog">;
}

/** Presentation only; dismissal/positioning and the live selection stay in NoteEditor. */
export function EditorContextMenu({ editor, readonly, contextMenu, contextMenuRef, setContextMenu, contextSubmenu, setContextSubmenu, hasCurrentBookmark, bookmarkCount, actions }: EditorContextMenuProps) {
  const { hasSelection, handleCut, handleClipboardPaste, handleCopy, openDocumentBookmarks, toggleCurrentBookmark, convertSelectionFromMarkdown, changeSelectedBlockIndent, setLinkDialogUrl, setLinkDialog, setImageDialog } = actions;
  return (<>
    {/* ── 正文右键菜单 ── */}
    {contextMenu && (
      <div
        ref={contextMenuRef}
        className="editor-context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onMouseDown={(e) => {
          // 菜单依赖 ProseMirror 当前选区。阻止按钮在按下时夺走焦点，
          // 这样关闭菜单后 Vim 可立即继续接收 h/j/k/l 等命令。
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {!readonly && (
          <>
            <button
              className="editor-context-item"
              disabled={!editor.can().undo()}
              onClick={() => { editor.chain().focus().undo().run(); setContextMenu(null); }}
            >撤销</button>
            <button
              className="editor-context-item"
              disabled={!editor.can().redo()}
              onClick={() => { editor.chain().focus().redo().run(); setContextMenu(null); }}
            >重做</button>
            <div className="editor-context-sep" />
            <button
              className="editor-context-item"
              disabled={!hasSelection()}
              onClick={() => { handleCut(); setContextMenu(null); }}
            >剪切</button>
            <button
              className="editor-context-item"
              onClick={() => { handleClipboardPaste(); setContextMenu(null); }}
            >粘贴</button>
          </>
        )}
        <button
          className="editor-context-item"
          disabled={!hasSelection()}
          onClick={() => { handleCopy(); setContextMenu(null); }}
        >复制</button>
        <button
          className="editor-context-item"
          onClick={() => { editor.chain().focus().selectAll().run(); setContextMenu(null); }}
        >全选</button>
        {bookmarkCount > 0 && (
          <button
            className="editor-context-item"
            onClick={() => { openDocumentBookmarks(); setContextMenu(null); }}
          >打开书签列表 <span>{bookmarkCount}</span></button>
        )}
        <div className="editor-context-sep" />
        <button
          className="editor-context-item"
          onClick={() => { toggleCurrentBookmark(); setContextMenu(null); }}
        >{hasCurrentBookmark ? "取消当前位置书签" : "添加当前位置书签"} <span>Ctrl+Shift+M</span></button>
        {!readonly && (
          <>
            <button
              className="editor-context-item editor-context-parent"
              aria-expanded={contextSubmenu === "format"}
              onClick={() => setContextSubmenu((current) => current === "format" ? null : "format")}
            ><span>格式</span><span aria-hidden="true">{contextSubmenu === "format" ? "▾" : "▸"}</span></button>
            {contextSubmenu === "format" && (
              <div className="editor-context-submenu" role="group" aria-label="格式">
                <button
                  className="editor-context-item editor-context-subitem"
                  disabled={!hasSelection()}
                  onClick={() => { editor.chain().focus().toggleBold().run(); setContextMenu(null); }}
                >粗体 <span>Ctrl+B</span></button>
                <button
                  className="editor-context-item editor-context-subitem"
                  disabled={!hasSelection()}
                  onClick={() => { editor.chain().focus().toggleItalic().run(); setContextMenu(null); }}
                >斜体 <span>Ctrl+I</span></button>
                <button
                  className="editor-context-item editor-context-subitem"
                  disabled={!hasSelection()}
                  onClick={() => { editor.chain().focus().toggleStrike().run(); setContextMenu(null); }}
                >删除线</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  disabled={!hasSelection()}
                  onClick={() => { editor.chain().focus().toggleCode().run(); setContextMenu(null); }}
                >行内代码</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  disabled={!hasSelection()}
                  onClick={() => { editor.chain().focus().unsetAllMarks().run(); setContextMenu(null); }}
                >清除文本格式</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  disabled={!hasSelection()}
                  onClick={convertSelectionFromMarkdown}
                >转换所选 Markdown</button>
              </div>
            )}
            <button
              className="editor-context-item editor-context-parent"
              aria-expanded={contextSubmenu === "paragraph"}
              onClick={() => setContextSubmenu((current) => current === "paragraph" ? null : "paragraph")}
            ><span>段落</span><span aria-hidden="true">{contextSubmenu === "paragraph" ? "▾" : "▸"}</span></button>
            {contextSubmenu === "paragraph" && (
              <div className="editor-context-submenu" role="group" aria-label="段落">
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { editor.chain().focus().clearNodes().run(); setContextMenu(null); }}
                >正文</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setContextMenu(null); }}
                >三级标题 H3</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { editor.chain().focus().toggleHeading({ level: 4 }).run(); setContextMenu(null); }}
                >四级标题 H4</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { editor.chain().focus().toggleBlockquote().run(); setContextMenu(null); }}
                >引用块</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { editor.chain().focus().toggleBulletList().run(); setContextMenu(null); }}
                >无序列表</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { editor.chain().focus().toggleOrderedList().run(); setContextMenu(null); }}
                >有序列表</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { changeSelectedBlockIndent(1); setContextMenu(null); }}
                >增加块缩进 <span>Tab</span></button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { changeSelectedBlockIndent(-1); setContextMenu(null); }}
                >减少块缩进 <span>Shift+Tab</span></button>
              </div>
            )}
            <button
              className="editor-context-item editor-context-parent"
              aria-expanded={contextSubmenu === "insert"}
              onClick={() => setContextSubmenu((current) => current === "insert" ? null : "insert")}
            ><span>插入</span><span aria-hidden="true">{contextSubmenu === "insert" ? "▾" : "▸"}</span></button>
            {contextSubmenu === "insert" && (
              <div className="editor-context-submenu" role="group" aria-label="插入">
                <button
                  className="editor-context-item editor-context-subitem"
                  disabled={!hasSelection()}
                  onClick={() => {
                    setLinkDialogUrl(editor.getAttributes("link").href || "");
                    setContextMenu(null);
                    setLinkDialog(true);
                  }}
                >链接</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { setContextMenu(null); setImageDialog(true); }}
                >图片</button>
                <button
                  className="editor-context-item editor-context-subitem"
                  onClick={() => { editor.chain().focus().setHorizontalRule().run(); setContextMenu(null); }}
                >水平分隔线</button>
              </div>
            )}
          </>
        )}
      </div>
    )}

  </>);
}
