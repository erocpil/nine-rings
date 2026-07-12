/**
 * ProseMirror JSON ↔ Quill Delta JSON 双向转换
 *
 * Web 端 (TipTap) 用 ProseMirror 格式，
 * Flutter 端 (flutter_quill) 用 Quill Delta 格式。
 * 数据库 content 字段统一存 Quill Delta，
 * Web 端读写时做转换。
 */

// ── 字体大小映射 ──

/** px → Quill named */
export function pxToNamed(px: number): string {
  if (px <= 12) return "small";
  if (px <= 14) return "small";
  if (px <= 16) return "normal";
  if (px <= 18) return "large";
  if (px <= 20) return "large";
  if (px <= 24) return "huge";
  return "huge";
}

/** Quill named → px */
export function namedToPx(name: string): number {
  switch (name) {
    case "small":  return 14;
    case "normal": return 16;
    case "large":  return 18;
    case "huge":   return 24;
    default:       return 16;
  }
}

// ── Mark 转换映射 ──

/** ProseMirror mark → Delta attribute (含字体大小映射) */
function pmMarkToAttr(mark: any): Record<string, any> | null {
  switch (mark.type) {
    case "bold":      return { bold: true };
    case "italic":    return { italic: true };
    case "strike":    return { strike: true };
    case "code":      return { code: true };
    case "link":      return { link: mark.attrs?.href ?? "" };
    case "textStyle": {
      const attrs: Record<string, any> = {};
      if (mark.attrs?.fontSize) {
        attrs.size = pxToNamed(Number(mark.attrs.fontSize));
      }
      if (mark.attrs?.color) {
        attrs.color = mark.attrs.color;
      }
      return Object.keys(attrs).length > 0 ? attrs : null;
    }
    default:
      return null;
  }
}

/** Delta attribute → ProseMirror mark data（含字体大小反向映射） */
function deltaAttrToMarks(attrs: Record<string, any> | undefined): any[] {
  if (!attrs) return [];
  const marks: any[] = [];
  if (attrs.bold)      marks.push({ type: "bold" });
  if (attrs.italic)    marks.push({ type: "italic" });
  if (attrs.strike)    marks.push({ type: "strike" });
  if (attrs.code)      marks.push({ type: "code" });
  if (attrs.link)      marks.push({ type: "link", attrs: { href: attrs.link } });
  if (attrs.color)     marks.push({ type: "textStyle", attrs: { color: attrs.color } });
  if (attrs.size) {
    const px = namedToPx(attrs.size);
    marks.push({ type: "textStyle", attrs: { fontSize: String(px) } });
  }
  return marks;
}

// ── ProseMirror → Quill Delta ──

export function proseMirrorToDelta(pmJson: any): any {
  const ops: any[] = [];
  const content = pmJson?.content ?? [];

  for (const node of content) {
    switch (node.type) {
      case "paragraph":
        extractInlineOps(node, ops);
        ops.push({ insert: "\n" });
        break;

      case "heading":
        extractInlineOps(node, ops);
        ops.push({ insert: "\n", attributes: { header: node.attrs?.level ?? 1 } });
        break;

      case "bulletList":
        for (const item of node.content ?? []) {
          extractInlineOps(item, ops);
          ops.push({ insert: "\n", attributes: { list: "bullet" } });
        }
        break;

      case "orderedList":
        for (const item of node.content ?? []) {
          extractInlineOps(item, ops);
          ops.push({ insert: "\n", attributes: { list: "ordered" } });
        }
        break;

      case "codeBlock":
        extractInlineOps(node, ops);
        ops.push({ insert: "\n", attributes: { "code-block": true } });
        break;

      case "blockquote":
        extractInlineOps(node, ops);
        ops.push({ insert: "\n", attributes: { blockquote: true } });
        break;

      case "image":
        ops.push({ insert: { image: node.attrs?.src ?? "" } });
        ops.push({ insert: "\n" });
        break;

      case "horizontalRule":
        ops.push({ insert: { hr: true } });
        ops.push({ insert: "\n" });
        break;
    }
  }

  return { ops };
}

function extractInlineOps(
  node: any,
  ops: any[],
  inheritAttrs?: Record<string, any>,
): void {
  const inlineContent = node.content ?? [];
  for (const inline of inlineContent) {
    if (inline.type === "text") {
      const attrs: Record<string, any> = { ...inheritAttrs };
      for (const mark of inline.marks ?? []) {
        const attr = pmMarkToAttr(mark);
        if (attr) Object.assign(attrs, attr);
      }
      ops.push({
        insert: inline.text,
        ...(Object.keys(attrs).length > 0 ? { attributes: attrs } : {}),
      });
    } else if (inline.type === "hardBreak") {
      ops.push({ insert: "\n" });
    } else if (inline.type === "image") {
      ops.push({ insert: { image: inline.attrs?.src ?? "" } });
    } else if (inline.type === "paragraph" || inline.type === "listItem") {
      // 递归提取嵌套文本（如 listItem → paragraph → text）
      extractInlineOps(inline, ops, inheritAttrs);
    }
  }
}

// ── Quill Delta → ProseMirror ──

export function deltaToProseMirror(deltaData: any): any {
  // 兼容两种入参：{ops: [...]} 或 {delta: {ops: [...]}}
  const ops: any[] = deltaData?.ops ?? deltaData?.delta?.ops ?? [];

  const doc: any[] = [];
  let currentParagraph: any = { type: "paragraph", content: [] };
  let isImageBlock = false;
  let hasFlushed = false; // 首条空段落不推入，之后空段落保留
  /** 正在累积的列表（未推入 doc，等待闭合） */
  let pendingList: { type: string; content: any[] } | null = null;

  function flushParagraph() {
    if (currentParagraph.content.length > 0 || isImageBlock || hasFlushed) {
      doc.push({ ...currentParagraph });
    }
    currentParagraph = { type: "paragraph", content: [] };
    isImageBlock = false;
    hasFlushed = true;
  }

  /** 把 pendingList 推入 doc 并清空 */
  function flushList() {
    if (pendingList && pendingList.content.length > 0) {
      doc.push({ ...pendingList });
    }
    pendingList = null;
  }

  for (const op of ops) {
    const insert = op.insert;
    const attrs = op.attributes ?? {};

    if (typeof insert === "string") {
      if (insert === "\n") {
        // ── 列表项 ──
        if (attrs.list === "bullet" || attrs.list === "ordered") {
          const listType = attrs.list === "bullet" ? "bulletList" : "orderedList";
          // 如果当前列表类型不同，先刷出旧列表
          if (pendingList && pendingList.type !== listType) {
            flushList();
          }
          // 没有活跃列表时，新建一个
          if (!pendingList) {
            pendingList = { type: listType, content: [] };
          }
          // 构建 listItem，content 引用 currentParagraph.content 后重置
          const itemParaContent = currentParagraph.content;
          pendingList.content.push({
            type: "listItem",
            content: [{ type: "paragraph", content: itemParaContent }],
          });
          currentParagraph = { type: "paragraph", content: [] };
          isImageBlock = false;
          continue;
        }

        // ── 非列表块级属性 → 先刷出 pendingList ──
        flushList();

        if (attrs.header) {
          currentParagraph.type = "heading";
          currentParagraph.attrs = { level: attrs.header };
          flushParagraph();
        } else if (attrs["code-block"]) {
          currentParagraph.type = "codeBlock";
          flushParagraph();
        } else if (attrs.blockquote) {
          // ProseMirror 的 blockquote schema 要求 content: "paragraph*"
          // 文本必须用 paragraph 包裹，不能直接放在 blockquote 下
          currentParagraph = {
            type: "blockquote",
            content: [{ type: "paragraph", content: currentParagraph.content }]
          };
          flushParagraph();
          currentParagraph = { type: "paragraph", content: [] };
        } else {
          flushParagraph();
        }
      } else if (insert.startsWith("\n")) {
        flushList();
        // Hard break within paragraph
        currentParagraph.content.push({ type: "hardBreak" });
        const rest = insert.slice(1);
        if (rest) {
          const marks = deltaAttrToMarks(attrs);
          currentParagraph.content.push({ type: "text", text: rest, ...(marks.length > 0 ? { marks } : {}) });
        }
      } else {
        const marks = deltaAttrToMarks(attrs);
        currentParagraph.content.push({
          type: "text",
          text: insert,
          ...(marks.length > 0 ? { marks } : {}),
        });
      }
    } else if (typeof insert === "object" && insert !== null) {
      flushList();
      if (insert.image) {
        flushParagraph();
        currentParagraph = { type: "image", attrs: { src: insert.image }, content: [] };
        isImageBlock = true;
        flushParagraph();
      } else if (insert.hr) {
        flushParagraph();
        doc.push({ type: "horizontalRule", content: [] });
      }
    }
  }

  flushList();
  // 末尾不推入空段落：Delta 最后的 \n 是文档终止符，非有意空行
  if (currentParagraph.content.length > 0 || isImageBlock) {
    doc.push({ ...currentParagraph });
  }

  const nodeCount = doc.length;
  if (nodeCount === 0) {
    console.warn("[dump/converter] ⚠️ 转换后内容为空！输入 Delta ops:", JSON.stringify(deltaData).slice(0, 300));
  }

  return { type: "doc", content: doc };
}

// ── 格式检测 ──

/** 判断一个 content 值是 ProseMirror 格式还是 Delta 格式 */
export function isProseMirror(content: any): boolean {
  if (!content || typeof content !== "object") return false;
  return content.type === "doc" && Array.isArray(content.content);
}

export function isDelta(content: any): boolean {
  if (!content || typeof content !== "object") return false;
  return Array.isArray(content.ops) || content?.delta?.ops;
}
