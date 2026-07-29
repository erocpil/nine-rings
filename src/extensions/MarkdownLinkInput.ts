/**
 * MarkdownLinkInput — 在编辑器中输入链接语法后自动转为超链接
 *
 * 支持两种常用格式（均仅在真实段落末尾触发）：
 *   [显示文本](https://url)    — 常用 Markdown 链接形式
 *   [显示文本][https://url]   — 双括号
 *
 * 转换后：保留"显示文本"，附加 link mark 指向 URL
 */
import { Extension } from "@tiptap/core";
import { InputRule, inputRules } from "@tiptap/pm/inputrules";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export const MARKDOWN_LINK_PATTERN =
  /\[([^\]\r\n]+)\]\((https?:\/\/[^\s]+)\)$/i;
export const BRACKET_LINK_PATTERN =
  /\[([^\]\r\n]+)\]\[(https?:\/\/[^\]\s]+)\]$/i;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function applyLinkInputRule(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number,
): Transaction | null {
  const [, linkText, url] = match;
  if (!linkText || !url || !isHttpUrl(url)) return null;

  // InputRule 的 `$` 只约束光标前的文本。额外检查光标确实位于
  // 当前文本块末尾，避免在段落中间编辑时意外转换。
  const $end = state.doc.resolve(end);
  if ($end.parentOffset !== $end.parent.content.size) return null;

  const linkMark = state.schema.marks.link;
  if (!linkMark) return null;

  return state.tr
    .delete(start, end)
    .insertText(linkText, start)
    .addMark(
      start,
      start + linkText.length,
      linkMark.create({ href: url }),
    );
}

export function createMarkdownLinkInputRules(): InputRule[] {
  return [
    new InputRule(MARKDOWN_LINK_PATTERN, applyLinkInputRule),
    new InputRule(BRACKET_LINK_PATTERN, applyLinkInputRule),
  ];
}

export const MarkdownLinkInput = Extension.create({
  name: "markdownLinkInput",

  addProseMirrorPlugins() {
    return [
      inputRules({
        rules: createMarkdownLinkInputRules(),
      }),
    ];
  },
});
