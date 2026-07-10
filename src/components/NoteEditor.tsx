import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import ImageExt from "@tiptap/extension-image";
import LinkExt from "@tiptap/extension-link";
import CharacterCount from "@tiptap/extension-character-count";
import type { DeltaOps } from "../types/models";
import {
  proseMirrorToDelta,
  deltaToProseMirror,
  isProseMirror,
  isDelta,
} from "../lib/delta-converter";

// ── 自定义字体大小扩展 ──

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { addLog, toggleDebug } from "../lib/debugLog";

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
  // @ts-expect-error TipTap custom extension commands
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: { chain: any }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: { chain: any }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// ── 高亮当前行扩展 ──

const ActiveLinePlugin = Extension.create({
  name: "activeLinePlugin",

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) return [];

    return [
      new Plugin({
        key: new PluginKey("activeLine"),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr) {
            const { selection } = tr;
            if (!selection || !selection.$from) return DecorationSet.empty;
            if (selection.$from.depth === 0) return DecorationSet.empty;
            // 始终高亮文档的直接子节点（depth=1），确保引用/代码块等外层容器的行号也被高亮
            const start = selection.$from.before(1);
            const end = selection.$from.after(1);
            if (start >= end) return DecorationSet.empty;
            return DecorationSet.create(tr.doc, [
              Decoration.node(start, end, { class: "ProseMirror-activeline" }),
            ]);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// ── 预设颜色 ──

const PRESET_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc",
  "#d91e18", "#e67e23", "#feea3a", "#8ec63f", "#22a577", "#3daee9",
  "#7030a0", "#ffffff",
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];

// ══════════════════════════════════════

interface NoteEditorProps {
  noteId: string;
  title: string | null;
  content: DeltaOps;
  tags: string[];
  readonly?: boolean;
  focusMode: boolean;
  showLineNumbers: boolean;
  highlightActiveLine: boolean;
  onTitleChange: (title: string) => void;
  onContentChange: (content: DeltaOps) => void;
  onTagsChange: (tags: string[]) => void;
  onVersionOpen?: () => void;
  onFocusModeChange?: (focus: boolean) => void;
  onStickyTitleChange?: (title: string | null) => void;
}

// ── 滚动位置显示状态 ──
let _scrollRaf = 0;

export function NoteEditor({ noteId, title, content, focusMode, showLineNumbers, highlightActiveLine, onTitleChange, onContentChange, tags, onTagsChange, readonly, onVersionOpen, onFocusModeChange, onStickyTitleChange }: NoteEditorProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [imageDialog, setImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [scrollPos, setScrollPos] = useState(0);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 480);

  // 检测窄屏（手机竖屏）
  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 480);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!sizeOpen && !colorOpen && !headingOpen && !blockOpen && !styleOpen && !clipOpen) return;
    const handler = () => {
      setSizeOpen(false);
      setColorOpen(false);
      setHeadingOpen(false);
      setBlockOpen(false);
      setStyleOpen(false);
      setClipOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [sizeOpen, colorOpen, headingOpen, blockOpen, styleOpen, clipOpen]);

  // 观察标题是否可见，用于 sticky title（仅在专注模式）
  useEffect(() => {
    const el = titleRef.current;
    const root = scrollRef.current;
    if (!el || !onStickyTitleChange || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // 非专注模式 never show sticky title
        if (!focusMode) {
          onStickyTitleChange(null);
          return;
        }
        onStickyTitleChange(entry.isIntersecting ? null : (title || "无标题"));
      },
      { threshold: 0, root }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [title, focusMode, onStickyTitleChange]);

  // 检测 content 格式并转换
  const tipTapContent = useMemo(() => {
    if (isProseMirror(content)) return content;
    if (isDelta(content)) return deltaToProseMirror(content);
    return content; // fallback
  }, [content]);

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
      LinkExt.configure({ openOnClick: true }),
      CharacterCount.configure({ limit: 50000 }),
      ActiveLinePlugin.configure({ enabled: highlightActiveLine }),
    ],
    content: tipTapContent,
    editable: !readonly,
    // 出处：ProseMirror 官方文档 https://prosemirror.net/docs/ref/#view.EditorProps.scrollThreshold
    // 出处：ProseMirror Discuss #4091 https://discuss.prosemirror.net/t/disable-automatic-scrolling-on-content-change/4091
    // 设无穷大阻止 ProseMirror 在内容变化时自动滚动
    editorProps: {
      scrollThreshold: { top: Infinity, bottom: Infinity, left: Infinity, right: Infinity },
      scrollMargin: { top: Infinity, bottom: Infinity, left: Infinity, right: Infinity },
    },
    onUpdate: ({ editor: ed }) => {
      // 保存时转为 Quill Delta（含字体大小 px→named 映射）
      const pmJson = ed.getJSON();
      const delta = proseMirrorToDelta(pmJson);
      onContentChange(delta as unknown as DeltaOps);
    },
  });

  // 当 readonly 变化时同步编辑器状态
  useEffect(() => {
    editor?.setEditable(!readonly);
  }, [readonly, editor]);

  // ── 滚动位置记忆（localStorage 持久化，跨刷新保持）──

  // 挂载时恢复滚动位置
  // 出处：SO #54195164 https://stackoverflow.com/questions/54195164
  // useLayoutEffect 在浏览器绘制前执行，比 useEffect 更早恢复位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = localStorage.getItem('scrollPos:' + noteId);
    addLog(`[恢复] 打开笔记 ${noteId.slice(0,8)}，localStorage 值="${saved}"，scrollRef=${!!el}`);
    if (saved === null) {
      addLog(`[恢复] 无保存位置，从顶部开始`);
      return;
    }
    const scrollTop = Number(saved);
    let retries = 8;
    const restore = () => {
      requestAnimationFrame(() => {
        el.scrollTop = scrollTop;
        addLog(`[恢复] 尝试 #${9 - retries}: scrollTop=${el.scrollTop}/${scrollTop}，scrollHeight=${el.scrollHeight}，clientHeight=${el.clientHeight}`);
        if (--retries > 0) restore();
      });
    };
    restore();
  }, [noteId]);

  // 滚动时保存位置 & 更新位置显示
  // 出处：TipTap #2342 https://github.com/ueberdosis/tiptap/issues/2342
  // 滚动事件持续保存正确的位置；cleanup 不做覆写（防止编辑器销毁阶段 scrollTop 被复位为 0）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let _scrollLogRaf = 0;
    const handler = () => {
      localStorage.setItem('scrollPos:' + noteId, String(el.scrollTop));
      // rAF 节流更新显示，避免频繁重渲染
      if (!_scrollRaf) {
        _scrollRaf = requestAnimationFrame(() => {
          setScrollPos(el.scrollTop);
          _scrollRaf = 0;
        });
      }
      // scroll 日志（rAF 节流）
      if (!_scrollLogRaf) {
        _scrollLogRaf = requestAnimationFrame(() => {
          addLog(`[滚动] ${noteId.slice(0,8)} scrollTop=${el.scrollTop}, scrollH=${el.scrollHeight}`);
          _scrollLogRaf = 0;
        });
      }
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      el.removeEventListener("scroll", handler);
      // 关键修复：cleanup 时 DOM 可能已进入销毁阶段，scrollTop 被误读为 0
      // 此时不覆写——滚动事件已经在用户滚动时写入了正确值
      addLog(`[保存] cleanup ${noteId.slice(0,8)} scrollTop=${el.scrollTop} isConnected=${el.isConnected} scrollH=${el.scrollHeight}`);
      if (el.isConnected && el.scrollTop > 0) {
        localStorage.setItem('scrollPos:' + noteId, String(el.scrollTop));
      }
      if (_scrollRaf) cancelAnimationFrame(_scrollRaf);
    };
  }, [noteId]);

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

  // ── Tags ──

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t || tags.includes(t)) return;
    onTagsChange([...tags, t]);
  };

  const removeTag = (t: string) => {
    onTagsChange(tags.filter((x) => x !== t));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      onTagsChange(tags.slice(0, -1));
    }
  };

  if (!editor) return <div className="note-editor"><div className="empty-state">加载中...</div></div>;

  // ── 滚动位置计算 ──
  const _el = scrollRef.current;
  const scrollableHeight = _el ? (_el.scrollHeight - _el.clientHeight) : 1;
  const totalBlocks = editor.state.doc.childCount;
  const scrollRatio = scrollableHeight > 0 ? scrollPos / scrollableHeight : 0;
  const currentBlock = Math.min(totalBlocks, Math.max(1, Math.round(scrollRatio * totalBlocks) + 1));
  const scrollPct = Math.round(scrollRatio * 100);

  // ── 剪贴板操作 ──
  const handleCopy = async () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, ' ');
    try { await navigator.clipboard.writeText(text); } catch { /* 权限拒绝静默忽略 */ }
  };
  const handleCut = async () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, ' ');
    try {
      await navigator.clipboard.writeText(text);
      editor.chain().focus().deleteSelection().run();
    } catch { /* 权限拒绝静默忽略 */ }
  };
  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(text).run();
    } catch { /* 权限拒绝静默忽略 */ }
  };

  const btn = (label: ReactNode, action: () => void, active?: boolean, title?: string, disabled?: boolean) => (
    <button
      className={`menu-btn ${active ? "active" : ""}`}
      onClick={disabled ? undefined : action}
      type="button"
      title={title}
      disabled={disabled}
    >
      {label}
    </button>
  );

  return (
    <div className={`note-editor ${showLineNumbers ? "show-line-numbers" : ""} ${focusMode ? "focus-mode" : ""}`} onPaste={handlePaste} onDrop={handleDrop}>
      {/* ── 标题 + 标签 + 工具栏 + 编辑器（滚动区域）── */}
      <div className="note-editor-scroll" ref={scrollRef}>
        <div className="note-editor-sticky">
          {/* ── 标题 ── */}
        <div className="note-title-row" ref={titleRef}>
          {readonly && <span className="note-readonly-badge" title="只读">🔒</span>}
          <input
            type="text"
            className="note-title"
            placeholder="随心记 — 标题"
            value={title ?? ""}
            onChange={(e) => onTitleChange(e.target.value)}
            readOnly={readonly}
          />
          <button
            className={`focus-btn ${focusMode ? "active" : ""}`}
            onClick={() => { onFocusModeChange?.(!focusMode); }}
            title={focusMode ? "退出专注模式" : "专注模式"}
            type="button"
          >
            {focusMode ? "⊞" : "⊟"}
          </button>
        </div>
        {/* ── 标签区 ── */}
        <div className="tag-bar">
          {tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              {!readonly && <button className="tag-chip-remove" onClick={() => removeTag(t)}>×</button>}
            </span>
          ))}
          {!readonly && <input
            className="tag-input"
            placeholder={tags.length === 0 ? "添加标签..." : ""}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => {
              if (tagInput.trim()) {
                addTag(tagInput);
                setTagInput("");
              }
            }}
          />}
        </div>

        {/* ── 工具栏 ── */}
        {!readonly && (<div className="editor-menu">
          {btn("↩", () => editor.chain().focus().undo().run(), false, "撤销 (Ctrl+Z)", readonly)}
          {btn("↪", () => editor.chain().focus().redo().run(), false, "重做 (Ctrl+Y)", readonly)}
          <span className="menu-sep" />
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); setStyleOpen(!styleOpen); }}
                type="button"
                title="样式"
              >
                {editor.isActive("bold") ? "B" :
                 editor.isActive("italic") ? "I" :
                 editor.isActive("strike") ? "S" : "样式 ▾"}
              </button>
              {styleOpen && (
                <div className="menu-dropdown-list">
                  <button
                    className={`menu-dropdown-item ${editor.isActive("bold") ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleBold().run(); setStyleOpen(false); }}
                    type="button"
                  ><b>B 加粗</b></button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("italic") ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleItalic().run(); setStyleOpen(false); }}
                    type="button"
                  ><i>I 斜体</i></button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("strike") ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleStrike().run(); setStyleOpen(false); }}
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
                onClick={(e) => { e.stopPropagation(); setHeadingOpen(!headingOpen); }}
                type="button"
                title="标题"
              >
                {editor.isActive("heading", { level: 1 }) ? "H1" :
                 editor.isActive("heading", { level: 2 }) ? "H2" :
                 editor.isActive("heading", { level: 3 }) ? "H3" : "标题 ▾"}
              </button>
              {headingOpen && (
                <div className="menu-dropdown-list">
                  <button
                    className={`menu-dropdown-item ${editor.isActive("heading", { level: 1 }) ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); setHeadingOpen(false); }}
                    type="button"
                  >H1 — 大标题</button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("heading", { level: 2 }) ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); setHeadingOpen(false); }}
                    type="button"
                  >H2 — 中标题</button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("heading", { level: 3 }) ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setHeadingOpen(false); }}
                    type="button"
                  >H3 — 小标题</button>
                  <div className="menu-dropdown-sep" />
                  <button
                    className="menu-dropdown-item"
                    onClick={() => { editor.chain().focus().clearNodes().run(); setHeadingOpen(false); }}
                    type="button"
                  >清除标题</button>
                </div>
              )}
            </div>
          ) : (<>
          {btn("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }), "标题 1 (Ctrl+Alt+1)", readonly)}
          {btn("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }), "标题 2 (Ctrl+Alt+2)", readonly)}
          {btn("H3", () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }), "标题 3 (Ctrl+Alt+3)", readonly)}
          </>)}
          <span className="menu-sep" />
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); setBlockOpen(!blockOpen); }}
                type="button"
                title="块"
              >块 ▾</button>
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
                    className={`menu-dropdown-item ${editor.isActive("codeBlock") ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleCodeBlock().run(); setBlockOpen(false); }}
                    type="button"
                  >⏹ 代码块</button>
                </div>
              )}
            </div>
          ) : (<>
          {btn("❝", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), "引用 (Ctrl+Shift+B)", readonly)}
          {btn("•", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"), "无序列表 (Ctrl+Shift+8)", readonly)}
          {btn("1.", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"), "有序列表 (Ctrl+Shift+7)", readonly)}
          {btn("⏹", () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"), "代码块 (Ctrl+Alt+C)", readonly)}
          </>)}
          <span className="menu-sep" />
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); setClipOpen(!clipOpen); }}
                type="button"
                title="剪贴"
              >剪贴 ▾</button>
              {clipOpen && (
                <div className="menu-dropdown-list">
                  <button className="menu-dropdown-item" onClick={() => { handleCopy(); setClipOpen(false); }} type="button">📋 复制</button>
                  <button className="menu-dropdown-item" onClick={() => { handleCut(); setClipOpen(false); }} type="button">✂ 剪切</button>
                  <button className="menu-dropdown-item" onClick={() => { handleClipboardPaste(); setClipOpen(false); }} type="button">📝 粘贴</button>
                </div>
              )}
            </div>
          ) : (<>
          {btn("📋", handleCopy, false, "复制 (Ctrl+C)", readonly)}
          {btn("✂", handleCut, false, "剪切 (Ctrl+X)", readonly)}
          {btn("📝", handleClipboardPaste, false, "粘贴 (Ctrl+V)", readonly)}
          </>)}
          <span className="menu-sep" />

          {/* 分隔后右区：字号 / 颜色 / 图片 */}
          <div className="menu-dropdown">
            <button className="menu-btn" onClick={(e) => { e.stopPropagation(); if (!readonly) setSizeOpen(!sizeOpen); }} type="button" title="字号" disabled={readonly}>
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
              onClick={(e) => { e.stopPropagation(); if (!readonly) setColorOpen(!colorOpen); }}
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
            🖼
          </button>
        </div>
        )}
        </div>

        {/* ── 编辑器内容 ── */}
        <EditorContent editor={editor} className="editor-content" />
      </div>

      {/* ── 底部信息栏（位置 + 字数 + 版本历史）─ */}
      <div className="editor-stats">
        <span>行 {currentBlock} / {totalBlocks}（{scrollPct}%）</span>
        <span className="stat-sep">|</span>
        <span>{chars} 字符</span>
        <span className="stat-sep">|</span>
        <span>{words} 词</span>
        <span className="stat-sep">|</span>
        <span className="stat-hint">Ctrl+Z · 粘贴/拖入图片</span>
        {onVersionOpen && (
          <>
            <span className="stat-sep" />
            <span className="btn-debug-toggle-wrapper">
              <button
                className="btn-debug-toggle"
                onClick={toggleDebug}
                title="调试日志"
                type="button"
              >
                🐛
              </button>
            </span>
            <span className="stat-sep" />
            <button className="btn-version-icon" onClick={onVersionOpen} title="版本历史">
              📋
            </button>
          </>
        )}
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
