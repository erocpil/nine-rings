import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { ResizableImage } from "../extensions/ResizableImage";
import LinkExt from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { MarkdownLinkInput } from "../extensions/MarkdownLinkInput";
import {
  normalizePastedHTML,
  normalizeSingleParagraphHTML,
  normalizeSingleParagraphPaste,
} from "../extensions/NormalizeSingleParagraphPaste";
import CharacterCount from "@tiptap/extension-character-count";
import type { DeltaOps, SearchNavigationTarget } from "../types/models";
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
import { TableMap } from "@tiptap/pm/tables";
import { addLog, toggleDebug } from "../lib/debugLog";
import { copyToClipboard } from "../lib/clipboard";
import { CodeBlockLineNumbers } from "../extensions/CodeBlockLineNumbers";
import { EditorBlockGutter } from "./EditorBlockGutter";
import { storeImage } from "../lib/storage/db-images";
import { api } from "../lib/api";
import { looksLikeMarkdown, mdToDelta } from "../lib/md-parser";
import { SearchHighlights, findSearchMatches, setSearchHighlights, type SearchMatch } from "../extensions/SearchHighlights";
import { noteToMarkdown } from "../lib/markdown-serializer";
import { exportMarkdownWithDialog, isTauri } from "../lib/tauri-desktop";

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

const AlignedTableCell = TableCell.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => element.style.textAlign || null,
        renderHTML: (attributes) => attributes.textAlign
          ? { style: `text-align: ${attributes.textAlign}` }
          : {},
      },
    };
  },
});

const AlignedTableHeader = TableHeader.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => element.style.textAlign || null,
        renderHTML: (attributes) => attributes.textAlign
          ? { style: `text-align: ${attributes.textAlign}` }
          : {},
      },
    };
  },
});

// ── 高亮当前行扩展 ──

const ActiveLinePlugin = Extension.create({
  name: "activeLinePlugin",

  addProseMirrorPlugins() {
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
  useCustomContextMenu: boolean;
  onTitleChange: (title: string) => void;
  onContentChange: (content: DeltaOps) => void;
  onTagsChange: (tags: string[]) => void;
  onVersionOpen?: () => void;
  onFocusModeChange?: (focus: boolean) => void;
  onStickyTitleChange?: (title: string | null) => void;
  saveStatus?: "clean" | "dirty" | "saving" | "saved" | "error";
  searchTarget?: SearchNavigationTarget | null;
  onSearchTargetConsumed?: (requestId: number) => void;
}

// ── 模块级状态 ──
let _lastSaveLog = 0;

export function NoteEditor({ noteId, title, content, focusMode, showLineNumbers, highlightActiveLine, useCustomContextMenu, onTitleChange, onContentChange, tags, onTagsChange, readonly, onVersionOpen, onFocusModeChange, onStickyTitleChange, saveStatus, searchTarget, onSearchTargetConsumed }: NoteEditorProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<SearchMatch[]>([]);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [imageDialog, setImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [scrollPos, setScrollPos] = useState(0);
  const [headingOpen, setHeadingOpen] = useState(false);
  // 受控标题：本地状态 + 从 prop 同步（支持外部重命名如 DocTree 右键改名）
  const [localTitle, setLocalTitle] = useState(title ?? "");
  const prevTitleRef = useRef(title);
  useEffect(() => {
    if (title !== prevTitleRef.current) {
      prevTitleRef.current = title;
      setLocalTitle(title ?? "");
    }
  }, [title]);
  const [headingPage, setHeadingPage] = useState(0); // 0=H3-5（默认）, 1=H1-2/6
  const [blockOpen, setBlockOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // 编辑器右键菜单 + 右键插入链接对话框
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkDialogUrl, setLinkDialogUrl] = useState("");
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 480);
  const CODE_LN_KEY = "nr:codeLineNumbers";
  const [showCodeLineNumbers, setShowCodeLineNumbers] = useState(() => {
    return localStorage.getItem(CODE_LN_KEY) === "true";
  });
  const [markdownPasteText, setMarkdownPasteText] = useState<string | null>(null);
  const [markdownSelectionNotice, setMarkdownSelectionNotice] = useState(false);

  useEffect(() => {
    if (!markdownPasteText) return;
    const timer = window.setTimeout(() => setMarkdownPasteText(null), 6000);
    return () => window.clearTimeout(timer);
  }, [markdownPasteText]);

  useEffect(() => {
    if (!markdownSelectionNotice) return;
    const timer = window.setTimeout(() => setMarkdownSelectionNotice(false), 4000);
    return () => window.clearTimeout(timer);
  }, [markdownSelectionNotice]);

  // ── 编辑器整体字号（CSS 变量驱动）──
  const FONT_SIZE_KEY = "nr:editorFontSize";
  const [editorFontSize, setEditorFontSize] = useState(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    return saved ? Number(saved) : 15;
  });

  // ── [[ 双向链接自动补全 ──
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiSuggestions, setWikiSuggestions] = useState<{ title: string; id: string }[]>([]);
  const [wikiPos, setWikiPos] = useState({ top: 0, left: 0 });
  const wikiStartRef = useRef<number | null>(null); // [[ 在文档中的起始位置

  // 检测窄屏（手机竖屏）
  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 480);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 编辑器整体字号：设 CSS 变量 + 持久化
  useEffect(() => {
    const el = document.querySelector('.note-editor') as HTMLElement | null;
    if (el) {
      el.style.setProperty('--editor-font-size', `${editorFontSize}px`);
    }
    localStorage.setItem(FONT_SIZE_KEY, String(editorFontSize));
  }, [editorFontSize]);

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!sizeOpen && !colorOpen && !headingOpen && !blockOpen && !styleOpen && !clipOpen && !linkOpen) return;
    const handler = () => {
      setSizeOpen(false);
      setColorOpen(false);
      setHeadingOpen(false);
      setBlockOpen(false);
      setStyleOpen(false);
      setClipOpen(false);
      setLinkOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [sizeOpen, colorOpen, headingOpen, blockOpen, styleOpen, clipOpen, linkOpen]);

  // 关闭编辑器右键菜单（点击外部 / Escape / 滚动 / 失焦）
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  // 菜单渲染后测量真实尺寸，clamp 到视口内（useLayoutEffect 在绘制前执行，无闪烁）
  useLayoutEffect(() => {
    if (!contextMenu) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const clampedX = Math.max(margin, Math.min(contextMenu.x, maxX));
    const clampedY = Math.max(margin, Math.min(contextMenu.y, maxY));
    if (clampedX !== contextMenu.x || clampedY !== contextMenu.y) {
      setContextMenu({ x: clampedX, y: clampedY });
    }
  }, [contextMenu]);

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
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
      }),
      // 仅使用扩展的 is-editor-empty class 识别空段落；不在 gutter
      // 内显示文字，避免与行号和行间插入按钮争用伪元素。
      Placeholder.configure({ placeholder: "" }),
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontSize,
      ResizableImage.configure({ inline: false, allowBase64: true }),
      LinkExt.configure({ openOnClick: true }),
      Table.configure({ resizable: false, allowTableNodeSelection: true }),
      TableRow,
      AlignedTableHeader,
      AlignedTableCell,
      // 仅用于统计，不限制文档长度。长 Markdown 粘贴（例如技术手册）
      // 可能超过 50,000 字符；设置 limit 会让 ProseMirror 拒绝整笔事务。
      CharacterCount.configure(),
      ActiveLinePlugin,
      SearchHighlights,
      CodeBlockLineNumbers,
      MarkdownLinkInput,
    ],
    content: tipTapContent,
    editable: !readonly,
    editorProps: {
      transformPastedHTML: normalizePastedHTML,
      transformPasted: normalizeSingleParagraphPaste,
    },
    onUpdate: ({ editor: ed }) => {
      // 搜索高亮是导航提示，不应在用户开始修改正文后继续指向旧位置。
      if (searchMatchesRef.current.length > 0) {
        searchMatchesRef.current = [];
        setSearchMatches([]);
        setSearchHighlights(ed, [], 0);
      }
      // 保存时转为 Quill Delta（含字体大小 px→named 映射）
      const pmJson = ed.getJSON();
      const delta = proseMirrorToDelta(pmJson);
      onContentChange(delta as unknown as DeltaOps);
      // 节流日志：每秒最多一次
      const now = Date.now();
      if (now - _lastSaveLog > 1000) {
        _lastSaveLog = now;
        const ch = ed.storage.characterCount?.characters?.() ?? 0;
        const wd = ed.storage.characterCount?.words?.() ?? 0;
        addLog(`[变更] ${noteId.slice(0,8)} chars=${ch} words=${wd}`);
      }

      // ── [[ 双向链接检测 ──
      const { from } = ed.state.selection;
      const $from = ed.state.doc.resolve(from);
      const textBefore = $from.parent?.textContent?.slice(0, from - $from.start()) ?? "";
      const match = textBefore.match(/\[\[([^\]]*)$/);
      if (match && !readonly) {
        const query = match[1];
        wikiStartRef.current = from - query.length - 2; // [[ 位置
        // 获取光标位置用于定位下拉
        const view = ed.view;
        const coords = view.coordsAtPos(from);
        const editorEl = view.dom.closest(".note-editor-scroll") as HTMLElement;
        if (editorEl) {
          const er = editorEl.getBoundingClientRect();
          setWikiPos({ top: coords.bottom - er.top + 4, left: coords.left - er.left });
        }
        setWikiOpen(true);
        // 异步搜索匹配笔记
        api.notes.search(query || " ").then((notes) => {
          setWikiSuggestions(
            notes.map((n) => ({ title: n.title || "无标题", id: n.id }))
          );
        });
      } else {
        setWikiOpen(false);
        wikiStartRef.current = null;
      }
    },
  });

  // 当 readonly 变化时同步编辑器状态
  useEffect(() => {
    editor?.setEditable(!readonly);
  }, [readonly, editor]);

  const revealSearchMatch = useCallback((requestedIndex: number, suppliedMatches?: SearchMatch[]) => {
    if (!editor) return;
    const matches = suppliedMatches ?? searchMatchesRef.current;
    if (!matches.length) return;
    const index = (requestedIndex + matches.length) % matches.length;
    const match = matches[index];
    setActiveSearchMatch(index);
    setSearchHighlights(editor, matches, index);

    // 防止浏览器先把整个编辑器滚到不可预测的位置，再把命中放到
    // 可视正文区域约 1/3 的高度，保留足够的前后文。
    editor.view.dom.focus({ preventScroll: true });
    editor.commands.setTextSelection({ from: match.from, to: match.to });
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root || editor.isDestroyed) return;
      const rootRect = root.getBoundingClientRect();
      const sticky = root.querySelector<HTMLElement>(".note-editor-sticky");
      const stickyBottom = sticky?.getBoundingClientRect().bottom ?? rootRect.top;
      const visibleTop = Math.max(rootRect.top, Math.min(stickyBottom, rootRect.bottom));
      const targetTop = visibleTop + Math.max(24, (rootRect.bottom - visibleTop) * 0.30);
      const coords = editor.view.coordsAtPos(match.from);
      root.scrollTop += coords.top - targetTop;
    });
  }, [editor]);

  // 接收搜索列表传来的一次性定位请求。优先匹配完整短语；FTS 的
  // 多词 AND 查询若没有连续短语，则回退到各个词的命中位置。
  useEffect(() => {
    if (!editor || !searchTarget || searchTarget.noteId !== noteId) return;
    let matches = findSearchMatches(editor.state.doc, searchTarget.query);
    if (matches.length === 0) {
      const terms = Array.from(new Set(searchTarget.query.trim().split(/\s+/).filter(Boolean)));
      if (terms.length > 1) {
        matches = terms
          .flatMap((term) => findSearchMatches(editor.state.doc, term))
          .sort((a, b) => a.from - b.from || a.to - b.to)
          .filter((match, index, all) => index === 0 || match.from !== all[index - 1].from || match.to !== all[index - 1].to);
      }
    }

    searchMatchesRef.current = matches;
    setSearchMatches(matches);
    setActiveSearchMatch(0);

    if (matches.length > 0) {
      revealSearchMatch(0, matches);
    } else {
      setSearchHighlights(editor, [], 0);
      const input = titleInputRef.current;
      const titleText = title ?? "";
      const loweredTitle = titleText.toLocaleLowerCase();
      let index = loweredTitle.indexOf(searchTarget.query.toLocaleLowerCase());
      let length = searchTarget.query.length;
      if (index < 0) {
        const term = searchTarget.query.trim().split(/\s+/).find((part) => loweredTitle.includes(part.toLocaleLowerCase()));
        if (term) {
          index = loweredTitle.indexOf(term.toLocaleLowerCase());
          length = term.length;
        }
      }
      if (input && index >= 0) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(index, index + length);
        scrollRef.current?.scrollTo({ top: 0 });
      }
    }
    onSearchTargetConsumed?.(searchTarget.requestId);
  }, [editor, noteId, onSearchTargetConsumed, revealSearchMatch, searchTarget, title]);

  // 宽度变化会让软换行重排。用当前选区的屏幕 Y 坐标作为锚点，
  // 在 ResizeObserver 报告新宽度后补偿 scrollTop，使同一文本保持原位。
  useEffect(() => {
    if (!editor) return;
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    let adjusting = false;
    let anchor: { pos: number; viewportTop: number; width: number; visible: boolean } | null = null;

    const capture = () => {
      frame = 0;
      if (adjusting || editor.isDestroyed || !root.isConnected) return;
      const pos = Math.min(editor.state.selection.head, editor.state.doc.content.size);
      const coords = editor.view.coordsAtPos(pos);
      const rect = root.getBoundingClientRect();
      anchor = {
        pos,
        viewportTop: coords.top,
        width: root.clientWidth,
        visible: coords.bottom >= rect.top && coords.top <= rect.bottom,
      };
    };
    const scheduleCapture = () => {
      if (!frame) frame = requestAnimationFrame(capture);
    };

    const observer = new ResizeObserver(() => {
      const nextWidth = root.clientWidth;
      if (!anchor || Math.abs(nextWidth - anchor.width) < 0.5) {
        scheduleCapture();
        return;
      }
      const previous = anchor;
      requestAnimationFrame(() => {
        if (editor.isDestroyed || !root.isConnected) return;
        adjusting = true;
        if (previous.visible) {
          const pos = Math.min(previous.pos, editor.state.doc.content.size);
          const nextTop = editor.view.coordsAtPos(pos).top;
          root.scrollTop += nextTop - previous.viewportTop;
        }
        adjusting = false;
        requestAnimationFrame(capture);
      });
    });

    editor.on("selectionUpdate", scheduleCapture);
    editor.on("focus", scheduleCapture);
    root.addEventListener("scroll", scheduleCapture, { passive: true });
    observer.observe(root);
    scheduleCapture();
    return () => {
      editor.off("selectionUpdate", scheduleCapture);
      editor.off("focus", scheduleCapture);
      root.removeEventListener("scroll", scheduleCapture);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor]);

  // 打开标题下拉时自动检测是否存在 H6（切换至页 1）
  useEffect(() => {
    if (!headingOpen || !editor) return;
    try {
      const json = editor.getJSON();
      const scan = (node: any): boolean => {
        if (node.type === 'heading' && node.attrs?.level > 5) return true;
        if (Array.isArray(node.content)) return node.content.some(scan);
        return false;
      };
      if (scan(json)) setHeadingPage(1);
    } catch { /* ignore */ }
  }, [headingOpen, editor]);

  // ── 滚动位置记忆（localStorage 持久化，跨刷新保持）──

  // 挂载时恢复滚动位置
  // 出处：SO #54195164 https://stackoverflow.com/questions/54195164
  // useLayoutEffect 在浏览器绘制前执行，比 useEffect 更早恢复位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = localStorage.getItem('scrollPos:' + noteId);
    const opsCount = Array.isArray(content) ? (content as any[]).length : 0;
    addLog(`[加载] ${title}  id=${noteId.slice(0,8)} ops=${opsCount} 恢复位置=${saved ?? '无'}`);
    if (saved === null) {
      return;
    }
    const scrollTop = Number(saved);
    let retries = 8;
    const restore = () => {
      requestAnimationFrame(() => {
        el.scrollTop = scrollTop;
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
    let _scrollRaf = 0;
    const handler = () => {
      localStorage.setItem('scrollPos:' + noteId, String(el.scrollTop));
      if (!_scrollRaf) {
        _scrollRaf = requestAnimationFrame(() => {
          setScrollPos(el.scrollTop);
          _scrollRaf = 0;
        });
      }
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      el.removeEventListener("scroll", handler);
      // 关键修复：cleanup 时 DOM 可能已进入销毁阶段，scrollTop 被误读为 0
      // 此时不覆写——滚动事件已经在用户滚动时写入了正确值
      addLog(`[离开] ${noteId.slice(0,8)} 保存位置=${el.scrollTop}`);
      if (el.isConnected && el.scrollTop > 0) {
        localStorage.setItem('scrollPos:' + noteId, String(el.scrollTop));
      }
      if (_scrollRaf) cancelAnimationFrame(_scrollRaf);
    };
  }, [noteId]);

  const chars = editor?.storage.characterCount?.characters?.() ?? 0;
  const words = editor?.storage.characterCount?.words?.() ?? 0;

  // ── Image: paste / drop ──

  /** 尝试从 URL 抓取页面标题（3s 超时，失败返回 null） */
  const fetchUrlTitle = async (url: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      const html = await resp.text();
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m ? m[1].trim().replace(/\s+/g, " ") : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const URL_RE = /^https?:\/\/\S+$/;

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || !editor) return;

      // ── URL 粘贴：自动抓标题 ──
      const plainText = e.clipboardData.getData("text/plain").trim();
      if (plainText && URL_RE.test(plainText)) {
        e.preventDefault();
        // 先插入 URL
        editor.chain().focus().insertContent(plainText).run();
        // 异步抓取标题
        fetchUrlTitle(plainText).then((title) => {
          if (!title) {
            // 抓取失败，把 URL 变成可点击链接
            const { from } = editor.state.selection;
            const pos = editor.state.doc.resolve(from);
            const textBefore = pos.parent?.textContent ?? "";
            const idx = textBefore.lastIndexOf(plainText);
            if (idx === -1) return;
            const start = pos.start() + idx;
            editor.chain()
              .setTextSelection({ from: start, to: start + plainText.length })
              .setLink({ href: plainText })
              .setTextSelection(start + plainText.length)
              .run();
            return;
          }
          // 找到刚插入的 URL 文本位置并替换为标题+链接
          const { from } = editor.state.selection;
          const pos = editor.state.doc.resolve(from);
          const textBefore = pos.parent?.textContent ?? "";
          const idx = textBefore.lastIndexOf(plainText);
          if (idx === -1) return;
          const start = pos.start() + idx;
          editor.chain()
            .setTextSelection({ from: start, to: start + plainText.length })
            .deleteSelection()
            .insertContent(title)
            .setLink({ href: plainText })
            .setTextSelection(start + title.length)
            .run();
        });
        return;
      }

      // 浏览器和聊天应用复制 Markdown 时通常会同时提供 text/html。
      // 高置信 Markdown 应优先按源码解析；普通富文本（包括 HTML 表格）
      // 因 looksLikeMarkdown 为 false，仍交给编辑器保留原格式。
      if (plainText && looksLikeMarkdown(plainText)) {
        e.preventDefault();
        const parsed = deltaToProseMirror(mdToDelta(plainText));
        editor.chain().focus().insertContent(parsed.content).run();
        setMarkdownPasteText(plainText);
        return;
      }

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          storeImage(file).then((ref) => {
            const { $from } = editor.state.selection;
            // ResizableImage 是 block node，不能在段落中间插入。
            // 在光标所在段落的末尾之后插入图片节点。
            const pos = $from.after($from.depth);
            editor.chain().focus().insertContentAt(pos, {
              type: "resizableImage",
              attrs: { src: ref },
            }).run();
          });
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
          storeImage(file).then((ref) => {
            (editor.chain().focus() as any).setResizableImage({ src: ref }).run();
          });
        }
      }
    },
    [editor],
  );

  const insertImageUrl = () => {
    if (!editor || !imageUrl.trim()) return;
    (editor.chain().focus() as any).setResizableImage({ src: imageUrl.trim() }).run();
    setImageUrl("");
    setImageDialog(false);
  };

  // ── Wiki Link 选择 ──

  const selectWikiLink = (note: { title: string; id: string }) => {
    if (!editor || wikiStartRef.current === null) return;
    const start = wikiStartRef.current;
    const end = editor.state.selection.from;
    editor.chain()
      .focus()
      .deleteRange({ from: start, to: end })
      .insertContent(note.title)
      .setLink({ href: `nr-note://${note.id}` })
      .setTextSelection(start + note.title.length)
      .run();
    setWikiOpen(false);
    wikiStartRef.current = null;
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
    await copyToClipboard(text);
  };
  const handleCut = async () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, ' ');
    await copyToClipboard(text);
    editor.chain().focus().deleteSelection().run();
  };
  const handleClipboardPaste = async () => {
    try {
      // 与原生 Ctrl+V 保持一致：代码编辑器复制 Markdown 时通常同时提供
      // text/plain 和 text/html，必须先判断源码，否则列表会被当成普通 HTML 文本。
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const plainText = (await blob.text()).trim();
          if (plainText && looksLikeMarkdown(plainText)) {
            const parsed = deltaToProseMirror(mdToDelta(plainText));
            editor.chain().focus().insertContent(parsed.content).run();
            setMarkdownPasteText(plainText);
            return;
          }
        }
      }
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          const html = await blob.text();
          editor.chain().focus().insertContent(normalizeSingleParagraphHTML(html)).run();
          return;
        }
      }
      // 回退：普通纯文本，去除首尾空白以防空段落
      const text = await navigator.clipboard.readText();
      const trimmed = text.replace(/^\s+|\s+$/g, '');
      if (trimmed) {
        editor.chain().focus().insertContent(trimmed).run();
      }
    } catch { /* 权限拒绝静默忽略 */ }
  };

  // ── 正文右键菜单 ──
  const handleEditorContextMenu = (e: React.MouseEvent) => {
    if (!useCustomContextMenu) return; // 关闭开关 → 系统原生菜单
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const hasSelection = () => {
    const { from, to } = editor.state.selection;
    return from !== to;
  };

  const convertSelectionFromMarkdown = () => {
    const { from, to, empty } = editor.state.selection;
    if (empty || readonly) return;

    let unsupported = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isLeaf && !node.isText && node.type.name !== "hardBreak") {
        unsupported = true;
        return false;
      }
      return true;
    });
    if (unsupported) return;

    const markdown = editor.state.doc.textBetween(from, to, "\n", "\n");
    if (!markdown.trim()) return;
    const parsed = deltaToProseMirror(mdToDelta(markdown));
    editor.chain().focus().insertContentAt({ from, to }, parsed.content).run();
    setMarkdownSelectionNotice(true);
    setBlockOpen(false);
    setContextMenu(null);
  };

  const insertLink = () => {
    const url = linkDialogUrl.trim();
    if (!url) return;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      // 有选区：把选中文字变成链接
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      // 无选区：插入 URL 本身作为链接文本
      editor.chain().focus()
        .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
        .run();
    }
    setLinkDialogUrl("");
    setLinkDialog(false);
  };

  // ── 代码块：多段选区合并为单个代码块 ──
  const handleToggleCodeBlock = () => {
    if (!editor) return;

    // 已在代码块中 → 转为普通段落
    if (editor.isActive('codeBlock')) {
      editor.chain().focus().setNode('paragraph').run();
      return;
    }

    const { from, to } = editor.state.selection;

    // 无选区或单块 → 转为代码块
    let blockCount = 0;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isBlock && !node.type.name.endsWith('List') && node.type.name !== 'listItem' && node.type.name !== 'doc') blockCount++;
      return true;
    });

    if (blockCount <= 1) {
      editor.chain().focus().setNode('codeBlock').run();
      return;
    }

    // 多块选区 → 合并为一个代码块，用 \\n 连接
    const text = editor.state.doc.textBetween(from, to, '\n');
    editor.chain().focus()
      .deleteRange({ from, to })
      .insertContentAt(from, {
        type: 'codeBlock',
        content: text ? [{ type: 'text', text }] : [],
      })
      .run();

    // 关闭下拉菜单（窄屏场景）
    setBlockOpen(false);
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

  const handleExportMarkdown = async () => {
    const markdown = noteToMarkdown(localTitle, proseMirrorToDelta(editor.getJSON()));
    const safeTitle = (localTitle.trim() || "无标题")
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 100);
    const filename = `${safeTitle}.md`;
    if (isTauri()) {
      await exportMarkdownWithDialog(markdown, filename);
      return;
    }
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const setTableCellAlignment = (textAlign: "left" | "center" | "right") => {
    const { state, view } = editor;
    const { $from } = state.selection;
    let tableDepth = $from.depth;
    while (tableDepth > 0 && $from.node(tableDepth).type.name !== "table") tableDepth--;
    let cellDepth = $from.depth;
    while (
      cellDepth > tableDepth &&
      $from.node(cellDepth).type.name !== "tableCell" &&
      $from.node(cellDepth).type.name !== "tableHeader"
    ) cellDepth--;
    if (tableDepth === 0 || cellDepth <= tableDepth) return;

    const table = $from.node(tableDepth);
    const tableStart = $from.before(tableDepth);
    const cellStart = $from.before(cellDepth);
    const map = TableMap.get(table);
    const column = map.findCell(cellStart - tableStart - 1).left;
    let transaction = state.tr;
    for (let row = 0; row < map.height; row++) {
      const cellPos = tableStart + 1 + map.positionAt(row, column, table);
      const cell = transaction.doc.nodeAt(cellPos);
      if (cell) {
        transaction = transaction.setNodeMarkup(cellPos, undefined, { ...cell.attrs, textAlign });
      }
    }
    view.dispatch(transaction);
    editor.commands.focus();
  };

  return (
    <div className={`note-editor ${showLineNumbers ? "show-line-numbers" : ""} ${focusMode ? "focus-mode" : ""} ${!highlightActiveLine ? "no-active-line" : ""} ${showCodeLineNumbers ? "show-code-line-numbers" : ""}`} onPasteCapture={handlePaste} onDrop={handleDrop}>
      {/* ── 标题 + 标签 + 工具栏 + 编辑器（滚动区域）── */}
      <div className="note-editor-scroll" ref={scrollRef}>
        <div className="note-editor-sticky">
          {/* ── 标题 ── */}
        <div className="note-title-row" ref={titleRef}>
          {readonly && <span className="note-readonly-badge" title="只读">🔒</span>}
          <input
            ref={titleInputRef}
            type="text"
            className="note-title"
            placeholder="随心记 — 标题"
            value={localTitle}
            onChange={(e) => { setLocalTitle(e.target.value); onTitleChange(e.target.value); }}
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
                 editor.isActive("heading", { level: 6 }) ? "H6" :
                 editor.isActive("heading", { level: 3 }) ? "H3" :
                 editor.isActive("heading", { level: 4 }) ? "H4" :
                 editor.isActive("heading", { level: 5 }) ? "H5" : "标题 ▾"}
              </button>
              {headingOpen && (
                <div className="menu-dropdown-list">
                  {(headingPage === 0 ? [3, 4, 5] : [1, 2, 6]).map((lvl) => (
                    <button
                      key={lvl}
                      className={`menu-dropdown-item ${editor.isActive("heading", { level: lvl }) ? "active" : ""}`}
                      onClick={() => { editor.chain().focus().toggleHeading({ level: lvl as any }).run(); setHeadingOpen(false); }}
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
              {btn(`H${lvl}`, () => editor.chain().focus().toggleHeading({ level: lvl as any }).run(), editor.isActive("heading", { level: lvl }), `标题 ${lvl}`, readonly)}
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
                    onClick={handleToggleCodeBlock}
                    type="button"
                  >⏹ 代码块</button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("table") ? "active" : ""}`}
                    onClick={() => {
                      if (editor.isActive("table")) editor.chain().focus().deleteTable().run();
                      else editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                      setBlockOpen(false);
                    }}
                    type="button"
                  >{editor.isActive("table") ? "▦ 删除表格" : "▦ 插入表格"}</button>
                  {editor.isActive("table") && (<>
                    <button className="menu-dropdown-item" onClick={() => editor.chain().focus().addRowAfter().run()} type="button">+R 添加行</button>
                    <button className="menu-dropdown-item" onClick={() => editor.chain().focus().addColumnAfter().run()} type="button">+C 添加列</button>
                    <button className="menu-dropdown-item" onClick={() => setTableCellAlignment("left")} type="button">当前列左对齐</button>
                    <button className="menu-dropdown-item" onClick={() => setTableCellAlignment("center")} type="button">当前列居中</button>
                    <button className="menu-dropdown-item" onClick={() => setTableCellAlignment("right")} type="button">当前列右对齐</button>
                  </>)}
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
                      setShowCodeLineNumbers(next);
                      localStorage.setItem(CODE_LN_KEY, String(next));
                      setBlockOpen(false);
                    }}
                    type="button"
                  >{showCodeLineNumbers ? "▣ 隐藏代码行号" : "□ 显示代码行号"}</button>
                </div>
              )}
            </div>
          ) : (<>
          {btn("❝", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), "引用 (Ctrl+Shift+B)", readonly)}
          {btn("•", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"), "无序列表 (Ctrl+Shift+8)", readonly)}
          {btn("1.", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"), "有序列表 (Ctrl+Shift+7)", readonly)}
          {btn("⏹", handleToggleCodeBlock, editor.isActive("codeBlock"), "代码块 (Ctrl+Alt+C)", readonly)}
          {btn("▦", () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), editor.isActive("table"), "插入 3×3 表格", readonly || editor.isActive("table"))}
          {editor.isActive("table") && (<>
            {btn("+R", () => editor.chain().focus().addRowAfter().run(), false, "在下方添加行", readonly)}
            {btn("+C", () => editor.chain().focus().addColumnAfter().run(), false, "在右侧添加列", readonly)}
            {btn("−R", () => editor.chain().focus().deleteRow().run(), false, "删除当前行", readonly)}
            {btn("−C", () => editor.chain().focus().deleteColumn().run(), false, "删除当前列", readonly)}
            {btn("⇤", () => setTableCellAlignment("left"), false, "当前列左对齐", readonly)}
            {btn("↔", () => setTableCellAlignment("center"), false, "当前列居中", readonly)}
            {btn("⇥", () => setTableCellAlignment("right"), false, "当前列右对齐", readonly)}
            {btn("×▦", () => editor.chain().focus().deleteTable().run(), false, "删除表格", readonly)}
          </>)}
          {btn("M↓", convertSelectionFromMarkdown, false, "转换所选 Markdown", readonly || !hasSelection())}
          <button
            className={`menu-btn ${showCodeLineNumbers ? "active" : ""}`}
            onClick={() => {
              const next = !showCodeLineNumbers;
              setShowCodeLineNumbers(next);
              localStorage.setItem(CODE_LN_KEY, String(next));
            }}
            title={showCodeLineNumbers ? "隐藏代码行号" : "显示代码行号"}
            type="button"
          >#</button>
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
                  <button className="menu-dropdown-item" onClick={() => { void handleExportMarkdown(); setClipOpen(false); }} type="button">M↑ 导出 Markdown</button>
                </div>
              )}
            </div>
          ) : (<>
          {btn("📋", handleCopy, false, "复制 (Ctrl+C)", readonly)}
          {btn("✂", handleCut, false, "剪切 (Ctrl+X)", readonly)}
          {btn("📝", handleClipboardPaste, false, "粘贴 (Ctrl+V)", readonly)}
          {btn("M↑", () => { void handleExportMarkdown(); }, false, "导出 Markdown", false)}
          </>)}
          <span className="menu-sep" />

          {/* 超链接 */}
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className={`menu-btn ${editor.isActive("link") ? "active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (readonly) return;
                  const attrs = editor.getAttributes("link");
                  setLinkUrl(attrs.href || "");
                  setLinkOpen(!linkOpen);
                }}
                type="button"
                title="超链接"
                disabled={readonly}
              >🔗</button>
              {linkOpen && (
                <div className="menu-dropdown-list">
                  <div style={{ padding: "6px 8px", display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      className="doc-tree-rename-input"
                      style={{ flex: 1, fontSize: 12 }}
                      placeholder="https://..."
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                          else editor.chain().focus().unsetLink().run();
                          setLinkOpen(false);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                    <button
                      className="menu-btn menu-btn-sm"
                      onClick={() => {
                        if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                        else editor.chain().focus().unsetLink().run();
                        setLinkOpen(false);
                      }}
                      type="button"
                    >✓</button>
                  </div>
                  {editor.isActive("link") && (
                    <button
                      className="menu-dropdown-item"
                      onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}
                      type="button"
                    >移除链接</button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="menu-dropdown" style={{ position: "relative" }}>
              <button
                className={`menu-btn ${editor.isActive("link") ? "active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (readonly) return;
                  const attrs = editor.getAttributes("link");
                  setLinkUrl(attrs.href || "");
                  setLinkOpen(!linkOpen);
                }}
                type="button"
                title={editor.isActive("link") ? "编辑/移除链接" : "添加超链接 (Ctrl+K)"}
                disabled={readonly}
              >🔗</button>
              {linkOpen && (
                <div className="menu-dropdown-list" style={{ minWidth: 260 }}>
                  <div style={{ padding: "6px 8px", display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      className="doc-tree-rename-input"
                      style={{ flex: 1, fontSize: 12 }}
                      placeholder="https://..."
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                          else editor.chain().focus().unsetLink().run();
                          setLinkOpen(false);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                    <button
                      className="menu-btn menu-btn-sm"
                      onClick={() => {
                        if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                        else editor.chain().focus().unsetLink().run();
                        setLinkOpen(false);
                      }}
                      type="button"
                    >✓</button>
                  </div>
                  {editor.isActive("link") && (
                    <button
                      className="menu-dropdown-item"
                      onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}
                      type="button"
                    >移除链接</button>
                  )}
                </div>
              )}
            </div>
          )}

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
          <span className="menu-sep" />
          {btn("A⁻", () => setEditorFontSize(s => Math.max(12, s - 1)), false, "缩小字号", editorFontSize <= 12)}
          <span className="menu-font-size-label">{editorFontSize}</span>
          {btn("A⁺", () => setEditorFontSize(s => Math.min(24, s + 1)), false, "放大字号", editorFontSize >= 24)}
          {saveStatus && saveStatus !== "clean" && (
            <span className={`save-status save-status-${saveStatus}`} title={
              saveStatus === "dirty" ? "未保存" :
              saveStatus === "saving" ? "保存中..." :
              saveStatus === "saved" ? "已保存" :
              saveStatus === "error" ? "保存失败" : ""
            }>
              {saveStatus === "saving" ? "⏳" :
               saveStatus === "saved" ? "✓" :
               saveStatus === "error" ? "⚠" : "●"}
            </span>
          )}
        </div>
        )}
        </div>

        {/* ── 编辑器内容 ── */}
        {markdownPasteText && (
          <div className="markdown-paste-notice" role="status">
            <span>已按 Markdown 格式化</span>
            <button type="button" onClick={() => { editor.chain().focus().undo().run(); setMarkdownPasteText(null); }}>撤销</button>
            <button type="button" onClick={() => {
              const blocks = markdownPasteText.split(/\r?\n/).map((line) => ({
                type: "paragraph",
                ...(line ? { content: [{ type: "text", text: line }] } : {}),
              }));
              editor.chain().focus().undo().run();
              editor.chain().focus().insertContent(blocks).run();
              setMarkdownPasteText(null);
            }}>改为纯文本</button>
          </div>
        )}
        {markdownSelectionNotice && (
          <div className="markdown-paste-notice" role="status">
            <span>已转换所选 Markdown</span>
            <button type="button" onClick={() => { editor.chain().focus().undo().run(); setMarkdownSelectionNotice(false); }}>撤销</button>
          </div>
        )}
        <div className="editor-content-shell">
          <EditorBlockGutter editor={editor} showNumbers={showLineNumbers} readonly={!!readonly} />
          <EditorContent editor={editor} className="editor-content" onContextMenu={handleEditorContextMenu} />
        </div>

        {/* ── [[ 双向链接下拉 ── */}
        {wikiOpen && (
          <div
            className="wiki-dropdown"
            style={{ top: wikiPos.top, left: wikiPos.left }}
          >
            {wikiSuggestions.length === 0 ? (
              <div className="wiki-empty">无匹配笔记</div>
            ) : (
              wikiSuggestions.map((n) => (
                <div
                  key={n.id}
                  className="wiki-item"
                  onClick={() => selectWikiLink(n)}
                >
                  <span className="wiki-title">{n.title}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── 底部信息栏（位置 + 字数 + 版本历史）─ */}
      <div className="editor-stats">
        {searchMatches.length > 0 && (
          <span className="editor-search-navigation" role="status" aria-live="polite">
            <span>{activeSearchMatch + 1} / {searchMatches.length}</span>
            <button type="button" onClick={() => revealSearchMatch(activeSearchMatch - 1)} title="上一处匹配" aria-label="上一处匹配">↑</button>
            <button type="button" onClick={() => revealSearchMatch(activeSearchMatch + 1)} title="下一处匹配" aria-label="下一处匹配">↓</button>
            <button
              type="button"
              onClick={() => {
                searchMatchesRef.current = [];
                setSearchMatches([]);
                setSearchHighlights(editor, [], 0);
              }}
              title="关闭搜索高亮"
              aria-label="关闭搜索高亮"
            >×</button>
          </span>
        )}
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

      {/* ── 正文右键菜单 ── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
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
          {!readonly && hasSelection() && (
            <>
              <div className="editor-context-sep" />
              <button
                className="editor-context-item"
                onClick={() => { setContextMenu(null); setLinkDialog(true); }}
              >插入链接</button>
              <button
                className="editor-context-item"
                onClick={convertSelectionFromMarkdown}
              >转换所选 Markdown</button>
            </>
          )}
        </div>
      )}

      {/* ── 插入链接对话框（复用图片对话框样式）── */}
      {linkDialog && (
        <div className="image-dialog-overlay" onClick={() => setLinkDialog(false)}>
          <div className="image-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-dialog-header">
              插入链接
              <button className="image-dialog-close" onClick={() => setLinkDialog(false)}>✕</button>
            </div>
            <input
              className="image-dialog-input"
              placeholder="https://..."
              value={linkDialogUrl}
              onChange={(e) => setLinkDialogUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && insertLink()}
              autoFocus
            />
            <p className="image-dialog-hint">选中文字将变为链接；未选中时插入 URL 本身</p>
            <div className="image-dialog-actions">
              <button className="menu-btn" onClick={() => setLinkDialog(false)}>取消</button>
              <button className="menu-btn active" onClick={insertLink}>插入</button>
            </div>
          </div>
        </div>
      )}

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
