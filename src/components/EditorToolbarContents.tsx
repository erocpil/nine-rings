import { OrderedListNumberingMenu } from "./OrderedListNumberingMenu";
import { FLOW_BLOCK_TEMPLATE } from "../lib/flow-block";
import { resetTableColumnWidths } from "../extensions/ContentSizedTable";
import { DisclosureIcon } from "./DisclosureIcon";
import { exitCurrentStructuredBlock } from "../extensions/StructuredBlockExit";
import React, { type ReactNode, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorToolbarMenu } from "../hooks/useEditorToolbarMenus";
import { ToolbarIcon } from "./ToolbarIcon";
import { useLayoutEffect } from "react";
import { useSelectionFontSize } from "../hooks/useSelectionFontSize";
import { preserveReadingPositions } from "../lib/reading-position";

// Controlled by the editor session: extraction must not remount menu state or
// move selection restoration/native touch handlers away from .editor-menu.
export interface EditorToolbarProps {
  editor: Editor;
  readonly?: boolean;
  saveStatus?: "clean" | "dirty" | "saving" | "saved" | "error";
  layout: {
    isMobileToolbarViewport: boolean;
    toolbarRef: RefObject<HTMLDivElement>;
  };
  menus: {
    colorOpen: boolean;
    setColorOpen: (open: boolean) => void;
    sizeOpen: boolean;
    setSizeOpen: (open: boolean) => void;
    headingOpen: boolean;
    setHeadingOpen: (open: boolean) => void;
    orderedOpen: boolean;
    setOrderedOpen: (open: boolean) => void;
    blockOpen: boolean;
    setBlockOpen: (open: boolean) => void;
    styleOpen: boolean;
    setStyleOpen: (open: boolean) => void;
    clipOpen: boolean;
    setClipOpen: (open: boolean) => void;
    tableOpen: boolean;
    setTableOpen: (open: boolean) => void;
    moreOpen: boolean;
    setMoreOpen: (open: boolean) => void;
    linkOpen: boolean;
    setLinkOpen: (open: boolean) => void;
    headingPage: number;
    setHeadingPage: (page: number) => void;
    linkUrl: string;
    setLinkUrl: (url: string) => void;
    closeMore: () => void;
    toggleMobileToolbarMenu: (menu: EditorToolbarMenu, isOpen: boolean) => void;
  };
  actions: {
    runToolbarFormat: (format: "bold" | "italic" | "strike") => void;
    changeSelectedBlockIndent: (delta: 1 | -1) => void;
    handleToggleCodeBlock: () => void;
    insertBlankBlockAfterCurrent: () => void;
    hasSelection: () => boolean;
    convertSelectionFromMarkdown: () => void;
    setTableSelection: (kind: "row" | "column" | "table") => void;
    copySelectedTableCells: () => Promise<void>;
    clearSelectedTableCells: () => void;
    setTableCellAlignment: (align: "left" | "center" | "right") => void;
    handleCopy: () => Promise<void>;
    handleCopyBlock: () => Promise<void>;
    copyReference: (kind: "block" | "position") => Promise<void>;
    handleCut: () => Promise<void>;
    handleClipboardPaste: () => Promise<void>;
    handleExportMarkdown: () => Promise<void>;
    handleExportPdf: () => void;
    openEditorReplace: () => void;
    toggleCurrentBookmark: () => void;
    openDocumentBookmarks: () => void;
    setLinkDialogUrl: (url: string) => void;
    setLinkDialog: (open: boolean) => void;
    setImageDialog: (open: boolean) => void;
  };
  editorFontSize: number;
  onEditorFontSizeChange: (size: number) => void;
  showCodeLineNumbers: boolean;
  onCodeLineNumbersChange: (show: boolean) => void;
  selectedTableCellCount: number;
  hasCurrentBookmark: boolean;
  bookmarkCount: number;
}

// ── 预设颜色 ──

const PRESET_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc",
  "#d91e18", "#e67e23", "#feea3a", "#8ec63f", "#22a577", "#3daee9",
  "#7030a0", "#ffffff",
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];
const dropdownCaret = <span className="toolbar-dropdown-caret" aria-hidden="true"><DisclosureIcon expanded /></span>;

const btn = (label: ReactNode, action: () => void, active?: boolean, title?: string, disabled?: boolean) => (
  <button
    className={`menu-btn ${active ? "active" : ""}`}
    onClick={disabled ? undefined : action}
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
  >
    {label}
  </button>
);

/** No wrapper DOM and no second EditorView; commands use the owning session. */
export function EditorToolbarContents({ editor, readonly, saveStatus, layout, menus, actions, editorFontSize, onEditorFontSizeChange, showCodeLineNumbers, onCodeLineNumbersChange, selectedTableCellCount }: EditorToolbarProps) {
  const { toolbarRef } = layout;
  const selectionSize = useSelectionFontSize(editor, editorFontSize);
  const {
    colorOpen, setColorOpen, sizeOpen, setSizeOpen,
    headingOpen, headingPage, setHeadingPage,
    orderedOpen, setOrderedOpen, blockOpen, styleOpen,
    clipOpen, tableOpen, setTableOpen,
    toggleMobileToolbarMenu,
  } = menus;
  const {
    changeSelectedBlockIndent, handleToggleCodeBlock,
    hasSelection, convertSelectionFromMarkdown,
    setTableSelection, copySelectedTableCells, clearSelectedTableCells, setTableCellAlignment,
    handleCopy, handleCut, handleClipboardPaste, handleExportMarkdown, handleExportPdf,
    setLinkDialogUrl, setLinkDialog, setImageDialog,
  } = actions;
  const toggleBlockquote = () => {
    const before = editor.state.doc;
    editor.chain().focus().toggleBlockquote().run();
    if (editor.state.doc === before) editor.chain().focus().setNode("blockquote").run();
  };
  const insertFlow = () => {
    editor.chain().focus().insertContent([
      { type: "codeBlock", attrs: { language: "flow" }, content: [{ type: "text", text: FLOW_BLOCK_TEMPLATE }] },
      { type: "paragraph" },
    ]).run();
  };
  const clearTextFormatting = () => {
    editor.chain().focus().unsetAllMarks().run();
  };
  // Fixed menus escape the horizontal scroll viewport while retaining the
  // owning toolbar's DOM containment and focus/dismissal behavior.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const position = () => {
      toolbar.querySelectorAll<HTMLElement>(".menu-dropdown-list").forEach(menu => {
        const anchor = menu.parentElement?.getBoundingClientRect();
        if (!anchor) return;
        menu.style.position = "fixed";
        menu.style.top = `${anchor.bottom}px`;
        menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.maxHeight = `${Math.max(80, window.innerHeight - anchor.bottom - 12)}px`;
        menu.style.overflowY = "auto";
      });
    };
    position();
    toolbar.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    const resize = new ResizeObserver(position);
    resize.observe(toolbar);
    const changes = new MutationObserver(position);
    changes.observe(toolbar, { childList: true, subtree: true });
    return () => {
      toolbar.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
      resize.disconnect();
      changes.disconnect();
    };
  }, [toolbarRef, colorOpen, sizeOpen, headingOpen, orderedOpen, blockOpen, styleOpen, clipOpen, tableOpen]);

  return (<>
    {btn(<ToolbarIcon name="search" />, actions.openEditorReplace, false, "查找与替换", readonly)}
    {btn(<ToolbarIcon name="copy" />, () => { void actions.handleCopyBlock(); }, false, "复制块", false)}
    <span className="toolbar-history-actions">
      {btn(<span className="toolbar-history-icon toolbar-history-icon-undo"><ToolbarIcon name="undo" /></span>, () => editor.chain().focus().undo().run(), false, "撤销 (Ctrl+Z)", readonly || !editor.can().undo())}
      {btn(<span className="toolbar-history-icon toolbar-history-icon-redo"><ToolbarIcon name="redo" /></span>, () => editor.chain().focus().redo().run(), false, "重做 (Ctrl+Y)", readonly || !editor.can().redo())}
    </span>
    <span className="menu-sep" />
    {(<>
    {btn(<b>B</b>, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"), "加粗 (Ctrl+B)", readonly)}
    {btn(<i>I</i>, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"), "斜体 (Ctrl+I)", readonly)}
    {btn(<s>S</s>, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"), "删除线 (Ctrl+Shift+X)", readonly)}
    {btn(<ToolbarIcon name="erase" />, clearTextFormatting, false, "清除格式", readonly)}
    </>)}
    <span className="menu-sep" />
    {(<>
    {(headingPage === 0 ? [3, 4, 5] : [1, 2, 6]).map((lvl) => (
      <React.Fragment key={lvl}>
        {btn(`H${lvl}`, () => editor.chain().focus().toggleHeading({ level: lvl as 1 | 2 | 3 | 4 | 5 | 6 }).run(), editor.isActive("heading", { level: lvl }), `标题 ${lvl}`, readonly)}
      </React.Fragment>
    ))}
    <button
      className="menu-btn menu-btn-sm"
      onClick={() => setHeadingPage(headingPage === 0 ? 1 : 0)}
      title={headingPage === 0 ? "H1–2 H6" : "H3–H5"}
      type="button"
    >{headingPage === 0 ? "»" : "«"}</button>
    </>)}
    <span className="menu-sep" />
    {(<>
    {btn(<ToolbarIcon name="quote" />, toggleBlockquote, editor.isActive("blockquote"), "引用 (Ctrl+Shift+B)", readonly)}
    {btn(<ToolbarIcon name="bullet" />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"), "无序列表 (Ctrl+Shift+8)", readonly)}
    <div className="menu-dropdown ordered-list-toolbar">
    {btn(<ToolbarIcon name="ordered" />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"), "有序列表 (Ctrl+Shift+7)", readonly)}
      <button type="button" className="menu-btn menu-btn-sm" aria-label="有序列表编号" title="有序列表编号" disabled={readonly || !editor.isActive("orderedList")}
        aria-expanded={orderedOpen} onClick={event => { event.stopPropagation(); toggleMobileToolbarMenu("ordered", orderedOpen); }}>{dropdownCaret}</button>
      {orderedOpen && <div className="menu-dropdown-list"><OrderedListNumberingMenu editor={editor} onDone={() => setOrderedOpen(false)} /></div>}
    </div>
    {btn(<ToolbarIcon name="indent" />, () => changeSelectedBlockIndent(1), false, editor.isActive("codeBlock") ? "增加代码块缩进（代码内 Tab 仅缩进代码）" : "增加块缩进 (Tab)", readonly)}
    {btn(<ToolbarIcon name="outdent" />, () => changeSelectedBlockIndent(-1), false, editor.isActive("codeBlock") ? "减少代码块缩进（代码内 Shift+Tab 仅减少代码缩进）" : "减少块缩进 (Shift+Tab)", readonly)}
    {btn(<ToolbarIcon name="code" />, handleToggleCodeBlock, editor.isActive("codeBlock"), "代码块 (Ctrl+Alt+C)", readonly)}
    {btn(<ToolbarIcon name="table" />, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), editor.isActive("table"), "插入 3×3 表格", readonly || editor.isActive("table"))}
    {btn("M↓", convertSelectionFromMarkdown, false, "转换所选 Markdown", readonly || !hasSelection())}
    <button
      className={`menu-btn ${showCodeLineNumbers ? "active" : ""}`}
      onClick={() => {
        const next = !showCodeLineNumbers;
        onCodeLineNumbersChange(next);
      }}
      title={showCodeLineNumbers ? "隐藏代码行号" : "显示代码行号"}
      type="button"
    >#</button>
    </>)}
    {editor.isActive("table") && (
      <div className="menu-dropdown toolbar-table-menu">
        <button
          className="menu-btn active"
          onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("table", tableOpen); }}
          type="button"
          title="表格操作"
          aria-expanded={tableOpen}
        >▦ 表格{dropdownCaret}</button>
        {tableOpen && (
          <div className="menu-dropdown-list table-context-menu">
            <div className="table-selection-hint">
              {selectedTableCellCount > 0
                ? `已选择 ${selectedTableCellCount} 个单元格`
                : "拖动可连续选择；触屏可选择整行或整列"}
            </div>
            <button className="menu-dropdown-item" onClick={() => { setTableSelection("row"); setTableOpen(false); }} type="button">选择当前行</button>
            <button className="menu-dropdown-item" onClick={() => { setTableSelection("column"); setTableOpen(false); }} type="button">选择当前列</button>
            <button className="menu-dropdown-item" onClick={() => { setTableSelection("table"); setTableOpen(false); }} type="button">选择整个表格</button>
            {selectedTableCellCount > 0 && (
              <>
                <button className="menu-dropdown-item" onClick={() => { void copySelectedTableCells(); setTableOpen(false); }} type="button">复制所选单元格</button>
                <button className="menu-dropdown-item" onClick={() => { clearSelectedTableCells(); setTableOpen(false); }} type="button">清空所选单元格</button>
              </>
            )}
            <div className="menu-dropdown-sep" />
            <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addRowBefore().run(); setTableOpen(false); }} type="button">在上方添加行</button>
            <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addRowAfter().run(); setTableOpen(false); }} type="button">在下方添加行</button>
            <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addColumnBefore().run(); setTableOpen(false); }} type="button">在左侧添加列</button>
            <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addColumnAfter().run(); setTableOpen(false); }} type="button">在右侧添加列</button>
            <div className="menu-dropdown-sep" />
            <button className="menu-dropdown-item" onClick={() => { resetTableColumnWidths(editor); setTableOpen(false); }} type="button">按内容调整列宽</button>
            <button className="menu-dropdown-item" onClick={() => { setTableCellAlignment("left"); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "所选单元格左对齐" : "当前列左对齐"}</button>
            <button className="menu-dropdown-item" onClick={() => { setTableCellAlignment("center"); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "所选单元格居中" : "当前列居中"}</button>
            <button className="menu-dropdown-item" onClick={() => { setTableCellAlignment("right"); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "所选单元格右对齐" : "当前列右对齐"}</button>
            <div className="menu-dropdown-sep" />
            <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().deleteRow().run(); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "删除所选行" : "删除当前行"}</button>
            <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().deleteColumn().run(); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "删除所选列" : "删除当前列"}</button>
            <button className="menu-dropdown-item danger" onClick={() => { editor.chain().focus().deleteTable().run(); setTableOpen(false); }} type="button">删除表格</button>
          </div>
        )}
      </div>
    )}
    <span className="menu-sep" />
    {btn(<ToolbarIcon name="lineBreak" />, () => { editor.chain().focus().setHardBreak().run(); }, false, "块内换行", readonly || editor.isActive("codeBlock") || !editor.can().setHardBreak())}
    <div className="toolbar-secondary">
    {(<span className="toolbar-clipboard-actions" data-toolbar-tool="clipboard">
    {btn(<ToolbarIcon name="copy" />, handleCopy, false, "复制 (Ctrl+C)", readonly)}
    {btn(<ToolbarIcon name="cut" />, handleCut, false, "剪切 (Ctrl+X)", readonly)}
    {btn(<ToolbarIcon name="paste" />, handleClipboardPaste, false, "粘贴 (Ctrl+V)", readonly)}
    {btn(<ToolbarIcon name="export" />, () => { void handleExportMarkdown(); }, false, "导出 Markdown", false)}
    </span>)}
    <span className="menu-sep" />


    {/* 分隔后右区：字号 / 颜色 / 图片 */}
    <div className="menu-dropdown" data-toolbar-tool="size">
      <button className="menu-btn" onClick={(e) => { e.stopPropagation(); if (!readonly) toggleMobileToolbarMenu("size", sizeOpen); }} type="button" title="字号" aria-expanded={sizeOpen} disabled={readonly}>
        {selectionSize}{dropdownCaret}
      </button>
      {sizeOpen && (
        <div className="menu-dropdown-list">
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              className={`menu-dropdown-item ${selectionSize === String(s) ? "active" : ""}`}
              onClick={() => {
                preserveReadingPositions(() => editor.chain().focus(undefined, { scrollIntoView: false }).setFontSize(String(s)).run());
                setSizeOpen(false);
              }}
              type="button"
            >
              {s}px
            </button>
          ))}
          <div className="menu-dropdown-sep" />
          <button
            className="menu-dropdown-item"
            onClick={() => {
              preserveReadingPositions(() => editor.chain().focus(undefined, { scrollIntoView: false }).unsetFontSize().run());
              setSizeOpen(false);
            }}
            type="button"
          >
            清除
          </button>
        </div>
      )}
    </div>

    {/* 文字颜色 */}
    <div className="menu-dropdown" data-toolbar-tool="color">
      <button
        className="menu-btn"
        onClick={(e) => { e.stopPropagation(); if (!readonly) toggleMobileToolbarMenu("color", colorOpen); }}
        type="button"
        title="文字颜色"
        disabled={readonly}
        style={{ color: editor.getAttributes("textStyle").color || "inherit" }}
      >
        <span className="color-preview" style={{ backgroundColor: editor.getAttributes("textStyle").color || "var(--text)" }} />
        A
      </button>
      {colorOpen && (
        <div className="menu-dropdown-list color-grid">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch ${editor.getAttributes("textStyle").color === c ? "active" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => {
                editor.chain().focus().setColor(c).run();
                setColorOpen(false);
              }}
              title={c}
              type="button"
            />
          ))}
          <label className="menu-dropdown-control">
            自定义颜色
            <input type="color" aria-label="自定义文字颜色" value={editor.getAttributes("textStyle").color || "#333333"}
              onChange={event => editor.chain().focus().setColor(event.target.value).run()} />
          </label>
          <div className="menu-dropdown-sep" />
          <button
            className="menu-dropdown-item"
            onClick={() => {
              editor.chain().focus().unsetColor().run();
              setColorOpen(false);
            }}
            type="button"
          >
            清除颜色
          </button>
        </div>
      )}
    </div>

    {/* 图片 */}
    <button
      className="menu-btn"
      data-toolbar-tool="image"
      onClick={() => { if (!readonly) setImageDialog(true); }}
      type="button"
      title="插入图片"
      disabled={readonly}
    >
      <ToolbarIcon name="image" />
    </button>
    <span className="menu-sep" />
    <span className="toolbar-font-actions" data-toolbar-tool="font">
    {btn("A⁻", () => onEditorFontSizeChange(Math.max(12, editorFontSize - 1)), false, "缩小字号", editorFontSize <= 12)}
    <span className="menu-font-size-label">{editorFontSize}</span>
    {btn("A⁺", () => onEditorFontSizeChange(Math.min(32, editorFontSize + 1)), false, "放大字号", editorFontSize >= 32)}
    </span>
    </div>
    {(editor.isActive("codeBlock") || editor.isActive("blockquote")) && btn(<ToolbarIcon name="lineBreak" />, () => { exitCurrentStructuredBlock(editor); }, false, "退出当前块（Ctrl+Enter）", readonly)}
    {layout.isMobileToolbarViewport && btn(<ToolbarIcon name="plus" />, actions.insertBlankBlockAfterCurrent, false, "在当前块后插入空白块", readonly)}
    {btn(<ToolbarIcon name="code" />, insertFlow, false, "插入流程块", readonly)}
    {btn(<ToolbarIcon name="link" />, () => { void actions.copyReference("block"); }, false, "复制块引用")}
    {btn(<ToolbarIcon name="link" />, () => { void actions.copyReference("position"); }, false, hasSelection() ? "复制选中文字引用" : "复制此处引用")}
    {btn(<ToolbarIcon name="document" />, handleExportPdf, false, "导出 PDF")}
    {btn(<ToolbarIcon name="link" />, () => { setLinkDialogUrl(editor.getAttributes("link").href || ""); setLinkDialog(true); }, false, "添加或编辑链接", readonly)}
    {saveStatus && saveStatus !== "clean" && (
      <span role="status" className={`save-status save-status-${saveStatus}`} title={
        saveStatus === "dirty" ? "未保存" :
        saveStatus === "saving" ? "保存中..." :
        saveStatus === "saved" ? "已保存到本机，不代表已完成备份" :
        saveStatus === "error" ? "保存失败" : ""
      }>
        <span className="toolbar-status-label">{saveStatus === "saving" ? "保存中" : saveStatus === "saved" ? "已存本机" : saveStatus === "error" ? "保存失败" : "未保存"}</span>
        {saveStatus === "saving" ? <ToolbarIcon name="saving" /> :
         saveStatus === "saved" ? <ToolbarIcon name="check" /> :
         saveStatus === "error" ? <ToolbarIcon name="warning" /> : "●"}
      </span>
    )}
  </>);
}
