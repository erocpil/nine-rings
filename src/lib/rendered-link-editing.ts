import type { Editor } from "@tiptap/core";

/** TipTap attaches its owner to view.dom. Never resolve through another editor. */
function linkEditor(link: HTMLAnchorElement): Editor | null {
  const root = link.closest<HTMLElement & { editor?: Editor }>(".ProseMirror");
  const editor = root?.editor;
  return link.isConnected && editor && !editor.isDestroyed && editor.isEditable
    && editor.view.dom === root ? editor : null;
}
export function canRemoveRenderedLink(link: HTMLAnchorElement): boolean {
  return !!linkEditor(link);
}
/** One undoable mark change; keep the document selection and all visible text. */
export function removeRenderedLink(link: HTMLAnchorElement): boolean {
  const editor = linkEditor(link);
  if (!editor) return false;
  const href = link.getAttribute("href");
  if (!href) return false;
  try {
    const position = editor.view.posAtDOM(link, 0);
    const selection = editor.state.selection;
    const result = editor.chain().setTextSelection(position)
      .extendMarkRange("link", { href }).unsetLink()
      .command(({ tr }) => {
        tr.setSelection(selection.map(tr.doc, tr.mapping));
        return true;
      }).run();
    if (result) editor.view.focus();
    return result;
  } catch {
    return false;
  }
}
