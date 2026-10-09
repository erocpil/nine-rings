import Link from "@tiptap/extension-link";
/** Link titles must survive editor hydration and Markdown export. */
export const DocumentLink = Link.extend({
  addAttributes() {
    return { ...this.parent?.(), title: { default: null } };
  },
});
