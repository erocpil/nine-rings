import { Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

/** Markdown/Delta 支持加粗、斜体或链接内嵌行内代码。默认 Code 的
 * excludes: "_" 会让这类合法文本在校验时拒绝整篇粘贴；编辑和只读
 * schema 必须一致地允许组合格式，并保留 Code 原有命令及输入规则。 */
export const DocumentStarterKit = StarterKit.configure({}).extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension =>
      extension instanceof Mark && extension.name === "code"
        ? extension.extend({ excludes: "" })
        : extension,
    );
  },
});
