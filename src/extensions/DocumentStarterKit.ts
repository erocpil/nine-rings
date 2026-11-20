import { InputRule, Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

/** Markdown/Delta 支持加粗、斜体或链接内嵌行内代码。默认 Code 的
 * excludes: "_" 会让这类合法文本在校验时拒绝整篇粘贴；编辑和只读
 * schema 必须一致地允许组合格式，并保留 Code 原有命令及粘贴规则。 */
export const DocumentStarterKit = StarterKit.configure({}).extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension =>
      extension instanceof Mark && extension.name === "code"
        ? extension.extend({
            excludes: "",
            addInputRules() {
              return [new InputRule({
                // TipTap calculates the replacement from the caret, so the
                // match must include the character that triggered the rule.
                find: /(^|[^`])`([^`\r\n]+)`([ \u00a0])?$/,
                handler: ({ state, range, match }) => {
                  const [syntax, prefix, code, separator] = match;
                  if (range.from < 0 || !state.doc.resolve(range.from).sameParent(state.doc.resolve(range.to))) return null;
                  const existing = state.doc.textBetween(range.from, range.to, "\n", "\ufffc");
                  if (existing !== syntax && existing !== syntax.slice(0, -1)) return null;
                  const from = range.from + prefix.length;
                  const end = from + code.length;
                  const tr = state.tr.delete(end + 1, range.to).delete(from, from + 1);
                  tr.addMark(from, end, this.type.create());
                  if (separator) tr.insertText(separator, end).removeMark(end, end + separator.length, this.type);
                  tr.removeStoredMark(this.type);
                },
              })];
            },
          })
        : extension,
    );
  },
});
