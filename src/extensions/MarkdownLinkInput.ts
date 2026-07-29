/**
 * MarkdownLinkInput — 在编辑器中输入链接语法后自动转为超链接
 *
 * 支持两种格式（均仅在段落末尾触发）：
 *   [显示文本](https://url)    — 标准 Markdown
 *   [显示文本][https://url]   — 双括号
 *
 * 转换后：保留"显示文本"，附加 link mark 指向 URL
 */
import { Extension } from "@tiptap/core";
import { InputRule, inputRules } from "@tiptap/pm/inputrules";

export const MarkdownLinkInput = Extension.create({
  name: "markdownLinkInput",

  addProseMirrorPlugins() {
    const linkHandler = (state: any, match: RegExpMatchArray, start: number, end: number) => {
      const [, linkText, url] = match;
      return state.tr
        .delete(start, end)
        .insertText(linkText, start)
        .addMark(
          start,
          start + linkText.length,
          state.schema.marks.link.create({ href: url }),
        );
    };

    return [
      inputRules({
        rules: [
          // [文本](https://url) — 标准 Markdown
          new InputRule(
            /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)$/,
            linkHandler,
          ),
          // [文本][https://url] — 双括号
          new InputRule(
            /\[([^\]]+)\]\[(https?:\/\/[^\]]+)\]$/,
            linkHandler,
          ),
        ],
      }),
    ];
  },
});
