import React, { useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { DeltaOps } from "../types/models";

interface NoteEditorProps {
  title: string | null;
  content: DeltaOps;
  onTitleChange: (title: string) => void;
  onContentChange: (content: DeltaOps) => void;
}

/** 简单工具条 */
function MenuBar({ editor }: { editor: any }) {
  if (!editor) return null;
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
    <div className="editor-menu">
      {btn("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
      {btn("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
      {btn("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
      {btn("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
      {btn("•", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
      {btn("1.", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {btn("⏹", () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
    </div>
  );
}

export function NoteEditor({ title, content, onTitleChange, onContentChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder: "开始记录..." }),
    ],
    content: content,
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON();
      onContentChange(json as unknown as DeltaOps);
    },
  });

  return (
    <div className="note-editor">
      <input
        type="text"
        className="note-title"
        placeholder="随心记 — 标题"
        value={title ?? ""}
        onChange={(e) => onTitleChange(e.target.value)}
      />
      <MenuBar editor={editor} />
      <EditorContent editor={editor} className="editor-content" />
    </div>
  );
}
