import React, { useCallback, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import ImageExt from "@tiptap/extension-image";
import CharacterCount from "@tiptap/extension-character-count";
import type { DeltaOps } from "../types/models";

// ── 自定义字体大小扩展 ──

import { Extension } from "@tiptap/core";

const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize?.replace("px", "") || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}px` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// ── 预设颜色 ──

const PRESET_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc",
  "#d91e18", "#e67e23", "#feea3a", "#8ec63f", "#22a577", "#3daee9",
  "#7030a0", "#ffffff",
];

// ── 字体大小选项 ──

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];

// ══════════════════════════════════════

interface NoteEditorProps {
  title: string | null;
  content: DeltaOps;
  onTitleChange: (title: string) => void;
  onContentChange: (content: DeltaOps) => void;
}

export function NoteEditor({ title, content, onTitleChange, onContentChange }: NoteEditorProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [imageDialog, setImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder: "开始记录..." }),
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontSize,
      ImageExt.configure({ inline: false, allowBase64: true }),
      CharacterCount.configure({ limit: 50000 }),
    ],
    content: content,
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON();
      onContentChange(json as unknown as DeltaOps);
    },
  });

  const chars = editor?.storage.characterCount?.characters?.() ?? 0;
  const words = editor?.storage.characterCount?.words?.() ?? 0;

  // ── Image: paste / drop ──

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || !editor) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            editor.chain().focus().setImage({ src: reader.result as string }).run();
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [editor],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || !editor) return;
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            editor.chain().focus().setImage({ src: reader.result as string }).run();
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [editor],
  );

  const insertImageUrl = () => {
    if (!editor || !imageUrl.trim()) return;
    editor.chain().focus().setImage({ src: imageUrl.trim() }).run();
    setImageUrl("");
    setImageDialog(false);
  };

  if (!editor) return <div className="note-editor"><div className="empty-state">加载中...</div></div>;

  const btn = (label: string, action: () => void, active?: boolean) => (
    <button
      className={`menu-btn ${active ? "active" : ""}`}
      onClick={action}
      type="button"
    >
      {label}
    </button>
  );

  return (
    <div className="note-editor" onPaste={handlePaste} onDrop={handleDrop}>
      {/* ── 标题 ── */}
      <input
        type="text"
        className="note-title"
        placeholder="随心记 — 标题"
        value={title ?? ""}
        onChange={(e) => onTitleChange(e.target.value)}
      />

      {/* ── 工具栏 Row 1: 基础格式 ── */}
      <div className="editor-menu">
        {btn("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {btn("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {btn("S", () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
        <span className="menu-sep" />
        {btn("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
        {btn("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {btn("H3", () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
        <span className="menu-sep" />
        {btn("❝", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {btn("•", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {btn("1.", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {btn("⏹", () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
      </div>

      {/* ── 工具栏 Row 2: 扩展格式 ── */}
      <div className="editor-menu editor-menu-ext">
        {/* 字体大小 */}
        <div className="menu-dropdown">
          <button className="menu-btn" onClick={() => setSizeOpen(!sizeOpen)} type="button">
            {editor.getAttributes("textStyle").fontSize || "字号"}
          </button>
          {sizeOpen && (
            <div className="menu-dropdown-list">
              {FONT_SIZES.map((s) => (
                <button
                  key={s}
                  className={`menu-dropdown-item ${editor.getAttributes("textStyle").fontSize === String(s) ? "active" : ""}`}
                  onClick={() => {
                    (editor.chain() as any).focus().setFontSize(String(s)).run();
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
                  (editor.chain() as any).focus().unsetFontSize().run();
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
            onClick={() => setColorOpen(!colorOpen)}
            type="button"
            style={{ color: editor.getAttributes("textStyle").color || "inherit" }}
          >
            <span className="color-preview" style={{ backgroundColor: editor.getAttributes("textStyle").color || "var(--text)" }} />
            A
          </button>
          {colorOpen && (
            <div className="menu-dropdown-list color-grid" onMouseLeave={() => setColorOpen(false)}>
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
          onClick={() => setImageDialog(true)}
          type="button"
          title="插入图片"
        >
          🖼
        </button>
      </div>

      {/* ── 编辑器内容 ── */}
      <EditorContent editor={editor} className="editor-content" />

      {/* ── 字数统计 ── */}
      <div className="editor-stats">
        <span>{chars} 字符</span>
        <span className="stat-sep">|</span>
        <span>{words} 词</span>
        <span className="stat-sep">|</span>
        <span className="stat-hint">Ctrl+Z 撤销 · 拖入/粘贴图片</span>
      </div>

      {/* ── 图片 URL 对话框 ── */}
      {imageDialog && (
        <div className="image-dialog-overlay" onClick={() => setImageDialog(false)}>
          <div className="image-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-dialog-header">
              插入图片
              <button className="image-dialog-close" onClick={() => setImageDialog(false)}>✕</button>
            </div>
            <input
              className="image-dialog-input"
              placeholder="图片 URL 或 base64"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && insertImageUrl()}
              autoFocus
            />
            <p className="image-dialog-hint">支持：https:// 或 data:image/... base64</p>
            <div className="image-dialog-actions">
              <button className="menu-btn" onClick={() => setImageDialog(false)}>取消</button>
              <button className="menu-btn active" onClick={insertImageUrl}>插入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
