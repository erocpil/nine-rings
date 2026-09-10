import React, { type ReactNode, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorToolbarMenu } from "../hooks/useEditorToolbarMenus";
import { exitCurrentStructuredBlock } from "../extensions/StructuredBlockExit";
import { MobileActionSheet } from "./MobileActionSheet";
import { ToolbarIcon } from "./ToolbarIcon";
import { useToolbarOverflow } from "../hooks/useToolbarOverflow";

// Controlled by the editor session: extraction must not remount menu state or
// move selection restoration/native touch handlers away from .editor-menu.
export interface EditorToolbarProps {
  editor: Editor;
  readonly?: boolean;
  saveStatus?: "clean" | "dirty" | "saving" | "saved" | "error";
  layout: {
    isNarrow: boolean;
    isMinimalToolbar: boolean;
    isMobileToolbarViewport: boolean;
    toolbarRef: RefObject<HTMLDivElement>;
    moreButtonRef: RefObject<HTMLButtonElement>;
  };
  menus: {
    colorOpen: boolean;
    setColorOpen: (open: boolean) => void;
    sizeOpen: boolean;
    setSizeOpen: (open: boolean) => void;
    headingOpen: boolean;
    setHeadingOpen: (open: boolean) => void;
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
const dropdownCaret = <span className="toolbar-dropdown-caret" aria-hidden="true">▾</span>;

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
  const { isNarrow, isMinimalToolbar, isMobileToolbarViewport, toolbarRef, moreButtonRef } = layout;
  const hiddenTools = useToolbarOverflow(toolbarRef, isMinimalToolbar);
  const {
    colorOpen, setColorOpen, sizeOpen, setSizeOpen,
    headingOpen, setHeadingOpen, headingPage, setHeadingPage,
    blockOpen, setBlockOpen, styleOpen, setStyleOpen,
    clipOpen, setClipOpen, tableOpen, setTableOpen,
    moreOpen, setMoreOpen, closeMore,
    toggleMobileToolbarMenu,
  } = menus;
  const {
    runToolbarFormat, changeSelectedBlockIndent, handleToggleCodeBlock,
    insertBlankBlockAfterCurrent, hasSelection, convertSelectionFromMarkdown,
    setTableSelection, copySelectedTableCells, clearSelectedTableCells, setTableCellAlignment,
    handleCopy, handleCut, handleClipboardPaste, handleExportMarkdown, handleExportPdf,
    setLinkDialogUrl, setLinkDialog, setImageDialog,
  } = actions;
  const moreActions = (<>
    {isMobileToolbarViewport && <button className="menu-dropdown-item" disabled={readonly} onClick={() => { closeMore(); actions.openEditorReplace(); }} type="button"><ToolbarIcon name="search" />查找与替换</button>}
    {hiddenTools.includes("clipboard") && <>
    <button className="menu-dropdown-item" onClick={() => { handleCopy(); closeMore(); }} type="button"><ToolbarIcon name="copy" />复制</button>
    <button className="menu-dropdown-item" onClick={() => { handleCut(); closeMore(); }} type="button"><ToolbarIcon name="cut" />剪切</button>
    <button className="menu-dropdown-item" onClick={() => { handleClipboardPaste(); closeMore(); }} type="button"><ToolbarIcon name="paste" />粘贴</button>
    </>}
    <button className="menu-dropdown-item" onClick={() => { void actions.handleCopyBlock(); closeMore(); }} type="button"><ToolbarIcon name="copy" />复制块</button>
    <div className="menu-dropdown-sep" />
    <button className="menu-dropdown-item" onClick={() => { void handleExportMarkdown(); setMoreOpen(false); }} type="button"><ToolbarIcon name="export" />导出 Markdown</button>
    <button className="menu-dropdown-item" onClick={() => { setMoreOpen(false); handleExportPdf(); }} type="button"><ToolbarIcon name="document" />导出 PDF</button>
    <div className="menu-dropdown-sep" />
    <button className="menu-dropdown-item" onClick={() => {
      setLinkDialogUrl(editor.getAttributes("link").href || "");
      setLinkDialog(true);
      setMoreOpen(false);
    }} type="button"><ToolbarIcon name="link" />添加或编辑链接</button>
    <button className="menu-dropdown-item" onClick={() => { setImageDialog(true); setMoreOpen(false); }} type="button"><ToolbarIcon name="image" />插入图片</button>
    {hiddenTools.includes("size") && <label className="menu-dropdown-control">
      <span><ToolbarIcon name="font" />文字字号</span>
      <select
        value={editor.getAttributes("textStyle").fontSize || ""}
        onChange={(event) => {
          if (event.target.value) editor.chain().focus().setFontSize(event.target.value).run();
          else editor.chain().focus().unsetFontSize().run();
        }}
      >
        <option value="">默认</option>
        {FONT_SIZES.map((size) => <option key={size} value={size}>{size}px</option>)}
      </select>
    </label>}
    <label className="menu-dropdown-control toolbar-more-color-picker">
      <span><ToolbarIcon name="color" />文字颜色</span>
      <input
        type="color"
        value={editor.getAttributes("textStyle").color || "#333333"}
        onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
      />
    </label>
    <button className="menu-dropdown-item toolbar-more-clear-color" onClick={() => editor.chain().focus().unsetColor().run()} type="button"><ToolbarIcon name="erase" />清除文字颜色</button>
    <div className="menu-dropdown-sep" />
    {hiddenTools.includes("font") && <>
    <button className="menu-dropdown-item" disabled={editorFontSize <= 12} onClick={() => onEditorFontSizeChange(Math.max(12, editorFontSize - 1))} type="button"><ToolbarIcon name="minus" />缩小编辑器字号</button>
    <button className="menu-dropdown-item" disabled={editorFontSize >= 32} onClick={() => onEditorFontSizeChange(Math.min(32, editorFontSize + 1))} type="button"><ToolbarIcon name="plus" />放大编辑器字号</button>
    </>}
  </>);

  return (<>
    {(!isMinimalToolbar || !isMobileToolbarViewport) && btn(<ToolbarIcon name="search" />, actions.openEditorReplace, false, "查找与替换", readonly)}
    {!isMinimalToolbar && btn(<ToolbarIcon name="copy" />, () => { void actions.handleCopyBlock(); }, false, "复制块", false)}
    <span className="toolbar-history-actions">
      {btn(<span className="toolbar-history-icon toolbar-history-icon-undo"><ToolbarIcon name="undo" /></span>, () => editor.chain().focus().undo().run(), false, "撤销 (Ctrl+Z)", readonly || !editor.can().undo())}
      {btn(<span className="toolbar-history-icon toolbar-history-icon-redo"><ToolbarIcon name="redo" /></span>, () => editor.chain().focus().redo().run(), false, "重做 (Ctrl+Y)", readonly || !editor.can().redo())}
    </span>
    <span className="menu-sep" />
    {isNarrow ? (
      <div className="menu-dropdown">
        <button
          className="menu-btn"
          onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("style", styleOpen); }}
          type="button"
          title="样式"
          aria-expanded={styleOpen}
        >
          {editor.isActive("bold") ? "B" :
           editor.isActive("italic") ? "I" :
           editor.isActive("strike") ? "S" : "样式"}{dropdownCaret}
        </button>
        {styleOpen && (
          <div className="menu-dropdown-list">
            <button
              className={`menu-dropdown-item ${editor.isActive("bold") ? "active" : ""}`}
              onClick={() => { runToolbarFormat("bold"); setStyleOpen(false); }}
              type="button"
            ><b>B 加粗</b></button>
            <button
              className={`menu-dropdown-item ${editor.isActive("italic") ? "active" : ""}`}
              onClick={() => { runToolbarFormat("italic"); setStyleOpen(false); }}
              type="button"
            ><i>I 斜体</i></button>
            <button
              className={`menu-dropdown-item ${editor.isActive("strike") ? "active" : ""}`}
              onClick={() => { runToolbarFormat("strike"); setStyleOpen(false); }}
              type="button"
            ><s>S 删除线</s></button>
          </div>
        )}
      </div>
    ) : (<>
    {btn(<b>B</b>, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"), "加粗 (Ctrl+B)", readonly)}
    {btn(<i>I</i>, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"), "斜体 (Ctrl+I)", readonly)}
    {btn(<s>S</s>, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"), "删除线 (Ctrl+Shift+X)", readonly)}
    </>)}
    <span className="menu-sep" />
    {isNarrow ? (
      <div className="menu-dropdown">
        <button
          className="menu-btn"
          onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("heading", headingOpen); }}
          type="button"
          title="标题"
          aria-expanded={headingOpen}
        >
          {editor.isActive("heading", { level: 1 }) ? "H1" :
           editor.isActive("heading", { level: 2 }) ? "H2" :
           editor.isActive("heading", { level: 6 }) ? "H6" :
           editor.isActive("heading", { level: 3 }) ? "H3" :
           editor.isActive("heading", { level: 4 }) ? "H4" :
           editor.isActive("heading", { level: 5 }) ? "H5" : "标题"}{dropdownCaret}
        </button>
        {headingOpen && (
          <div className="menu-dropdown-list">
            {(headingPage === 0 ? [3, 4, 5] : [1, 2, 6]).map((lvl) => (
              <button
                key={lvl}
                className={`menu-dropdown-item ${editor.isActive("heading", { level: lvl }) ? "active" : ""}`}
                onClick={() => { editor.chain().focus().toggleHeading({ level: lvl as 1 | 2 | 3 | 4 | 5 | 6 }).run(); setHeadingOpen(false); }}
                type="button"
              >H{lvl} — {["","大标题","中标题","小标题","子标题","细标题","微标题"][lvl]}</button>
            ))}
            <div className="menu-dropdown-sep" />
            <button
              className="menu-dropdown-item"
              onClick={() => { editor.chain().focus().clearNodes().run(); setHeadingOpen(false); }}
              type="button"
            >清除标题</button>
            <div className="menu-dropdown-sep" />
            <button
              className="menu-dropdown-item menu-dropdown-toggle"
              onClick={(e) => { e.stopPropagation(); setHeadingPage(headingPage === 0 ? 1 : 0); }}
              type="button"
              title="切换 H3–5 / H1–2 H6"
            >
              {headingPage === 0 ? "▶ H1–2 H6" : "◀ H3–H5"}
            </button>
          </div>
        )}
      </div>
    ) : (<>
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
    {isNarrow ? (
      <div className="menu-dropdown">
        <button
          className="menu-btn"
          onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("block", blockOpen); }}
          type="button"
          title="块"
          aria-expanded={blockOpen}
        >块{dropdownCaret}</button>
        {blockOpen && (
          <div className="menu-dropdown-list">
            <button
              className={`menu-dropdown-item ${editor.isActive("blockquote") ? "active" : ""}`}
              onClick={() => { editor.chain().focus().toggleBlockquote().run(); setBlockOpen(false); }}
              type="button"
            >❝ 引用</button>
            <button
              className={`menu-dropdown-item ${editor.isActive("bulletList") ? "active" : ""}`}
              onClick={() => { editor.chain().focus().toggleBulletList().run(); setBlockOpen(false); }}
              type="button"
            >• 无序列表</button>
            <button
              className={`menu-dropdown-item ${editor.isActive("orderedList") ? "active" : ""}`}
              onClick={() => { editor.chain().focus().toggleOrderedList().run(); setBlockOpen(false); }}
              type="button"
            >1. 有序列表</button>
            <button
              className="menu-dropdown-item"
              onClick={() => { changeSelectedBlockIndent(1); setBlockOpen(false); }}
              disabled={editor.isActive("table")}
              type="button"
            >→ 增加块缩进（Tab）</button>
            <button
              className="menu-dropdown-item"
              onClick={() => { changeSelectedBlockIndent(-1); setBlockOpen(false); }}
              disabled={editor.isActive("table")}
              type="button"
            >← 减少块缩进（Shift+Tab）</button>
            <button
              className={`menu-dropdown-item ${editor.isActive("codeBlock") ? "active" : ""}`}
              onClick={handleToggleCodeBlock}
              type="button"
            >⏹ 代码块</button>
            {(editor.isActive("codeBlock") || editor.isActive("blockquote")) && (
              <button
                className="menu-dropdown-item"
                onClick={() => { exitCurrentStructuredBlock(editor); setBlockOpen(false); }}
                type="button"
              >↵ 退出当前块（Ctrl+Enter）</button>
            )}
            {isMobileToolbarViewport && (
              <button
                className="menu-dropdown-item"
                onClick={insertBlankBlockAfterCurrent}
                disabled={readonly}
                type="button"
              >＋ 在当前块后插入空白块</button>
            )}
            <button
              className="menu-dropdown-item"
              onClick={() => {
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                setBlockOpen(false);
              }}
              disabled={editor.isActive("table")}
              type="button"
            >▦ 插入表格</button>
            <div className="menu-dropdown-sep" />
            <button
              className="menu-dropdown-item"
              disabled={!hasSelection()}
              onClick={convertSelectionFromMarkdown}
              type="button"
            >M↓ 转换所选 Markdown</button>
            <div className="menu-dropdown-sep" />
            <button
              className={`menu-dropdown-item ${showCodeLineNumbers ? "active" : ""}`}
              onClick={() => {
                const next = !showCodeLineNumbers;
                onCodeLineNumbersChange(next);
                setBlockOpen(false);
              }}
              type="button"
            >{showCodeLineNumbers ? "▣ 隐藏代码行号" : "□ 显示代码行号"}</button>
          </div>
        )}
      </div>
    ) : (<>
    {btn(<ToolbarIcon name="quote" />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), "引用 (Ctrl+Shift+B)", readonly)}
    {btn(<ToolbarIcon name="bullet" />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"), "无序列表 (Ctrl+Shift+8)", readonly)}
    {btn(<ToolbarIcon name="ordered" />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"), "有序列表 (Ctrl+Shift+7)", readonly)}
    {btn(<ToolbarIcon name="indent" />, () => changeSelectedBlockIndent(1), false, "增加块缩进 (Tab)", readonly || editor.isActive("table"))}
    {btn(<ToolbarIcon name="outdent" />, () => changeSelectedBlockIndent(-1), false, "减少块缩进 (Shift+Tab)", readonly || editor.isActive("table"))}
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
    {isNarrow ? (
      <div className="menu-dropdown" data-toolbar-tool="clipboard">
        <button
          className="menu-btn"
          onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("clip", clipOpen); }}
          type="button"
          title="剪贴"
          aria-expanded={clipOpen}
        >剪贴{dropdownCaret}</button>
        {clipOpen && (
          <div className="menu-dropdown-list">
            <button className="menu-dropdown-item" onClick={() => { handleCopy(); setClipOpen(false); }} type="button">📋 复制</button>
            <button className="menu-dropdown-item" onClick={() => { handleCut(); setClipOpen(false); }} type="button">✂ 剪切</button>
            <button className="menu-dropdown-item" onClick={() => { handleClipboardPaste(); setClipOpen(false); }} type="button">📝 粘贴</button>
            <button className="menu-dropdown-item" onClick={() => { void handleExportMarkdown(); setClipOpen(false); }} type="button">M↑ 导出 Markdown</button>
          </div>
        )}
      </div>
    ) : (<>
    {btn(<ToolbarIcon name="copy" />, handleCopy, false, "复制 (Ctrl+C)", readonly)}
    {btn(<ToolbarIcon name="cut" />, handleCut, false, "剪切 (Ctrl+X)", readonly)}
    {btn(<ToolbarIcon name="paste" />, handleClipboardPaste, false, "粘贴 (Ctrl+V)", readonly)}
    {btn("M↑", () => { void handleExportMarkdown(); }, false, "导出 Markdown", false)}
    </>)}
    <span className="menu-sep" />


    {/* 分隔后右区：字号 / 颜色 / 图片 */}
    <div className="menu-dropdown" data-toolbar-tool="size">
      <button className="menu-btn" onClick={(e) => { e.stopPropagation(); if (!readonly) toggleMobileToolbarMenu("size", sizeOpen); }} type="button" title="字号" aria-expanded={sizeOpen} disabled={readonly}>
        {editor.getAttributes("textStyle").fontSize || "字号"}{dropdownCaret}
      </button>
      {sizeOpen && (
        <div className="menu-dropdown-list">
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              className={`menu-dropdown-item ${editor.getAttributes("textStyle").fontSize === String(s) ? "active" : ""}`}
              onClick={() => {
                editor.chain().focus().setFontSize(String(s)).run();
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
              editor.chain().focus().unsetFontSize().run();
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
    <div className="menu-dropdown">
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
    {isMinimalToolbar && (
      <div className="menu-dropdown toolbar-more-menu">
        <button
          ref={moreButtonRef}
          className="menu-btn"
          onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("more", moreOpen); }}
          type="button"
          title="更多编辑操作"
          aria-label="更多编辑操作"
          aria-expanded={moreOpen}
        ><span aria-hidden="true">⋯</span></button>
        {moreOpen && (isMobileToolbarViewport ? (
          <MobileActionSheet
            open
            title="更多编辑操作"
            onClose={closeMore}
            dismissAnchor={moreButtonRef.current}
            placementAnchor={toolbarRef.current}
            placementGap={4}
            fitContent
            className="toolbar-more-sheet"
          >
            {moreActions}
          </MobileActionSheet>
        ) : (
          <div className="menu-dropdown-list toolbar-more-list" onClick={(event) => event.stopPropagation()}>
            {moreActions}
          </div>
        ))}
      </div>
    )}
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
