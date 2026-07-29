/**
 * MarkdownLinkInput — 在编辑器中输入 [文本][https://...] 后自动转为超链接
 *
 * 触发条件：当前段落末尾匹配 [显示文本][URL]（URL 以 https?:// 开头）
 * 转换后：保留"显示文本"，附加 link mark 指向 URL
 */
import { Extension } from "@tiptap/core";
import { InputRule, inputRules } from "@tiptap/pm/inputrules";

export const MarkdownLinkInput = Extension.create({
  name: "markdownLinkInput",

  addProseMirrorPlugins() {
    return [
      inputRules({
        rules: [
          new InputRule(
            /\[([^\]]+)\]\[(https?:\/\/[^\]]+)\]$/,
            (state, match, start, end) => {
              const [, linkText, url] = match;
              return state.tr
                .delete(start, end)
                .insertText(linkText, start)
                .addMark(
                  start,
                  start + linkText.length,
                  state.schema.marks.link.create({ href: url }),
                );
            },
          ),
        ],
      }),
    ];
  },
});
