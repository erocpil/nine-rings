import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Table, { TableView } from "@tiptap/extension-table";
import type { Node } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

class ContentSizedTableView extends TableView {
  constructor(node: Node, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.layout(node);
  }
  private layout(node: Node) {
    let manual = false;
    node.forEach((row) =>
      row.forEach((cell) => {
        if (cell.attrs.colwidth?.some((width: number) => width > 0))
          manual = true;
      }),
    );
    if (!manual)
      this.colgroup
        .querySelectorAll("col")
        .forEach((col) => col.style.removeProperty("width"));
    this.table.dataset.columnLayout = manual ? "manual" : "auto";
  }
  update(node: Node) {
    if (!super.update(node)) return false;
    this.layout(node);
    return true;
  }
}

/** Identical column layout in editable and readonly sessions. */
export const ContentSizedTable = Table.extend({
  addNodeView() {
    return ({ node }) =>
      new ContentSizedTableView(node, this.options.cellMinWidth);
  },
}).configure({ View: ContentSizedTableView });

export function resetTableColumnWidths(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const table = $from.node(depth);
    if (table.type.name !== "table") continue;
    const start = $from.start(depth),
      tr = editor.state.tr;
    table.descendants((node, pos) => {
      if (node.type.name !== "tableCell" && node.type.name !== "tableHeader")
        return true;
      if (node.attrs.colwidth)
        tr.setNodeMarkup(start + pos, undefined, {
          ...node.attrs,
          colwidth: null,
        });
      return false;
    });
    if (tr.docChanged) editor.view.dispatch(tr);
    return true;
  }
  return false;
}

export const AlignedTableCell = TableCell.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => element.style.textAlign || null,
        renderHTML: (attributes) =>
          attributes.textAlign
            ? { style: `text-align: ${attributes.textAlign}` }
            : {},
      },
    };
  },
});

export const AlignedTableHeader = TableHeader.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => element.style.textAlign || null,
        renderHTML: (attributes) =>
          attributes.textAlign
            ? { style: `text-align: ${attributes.textAlign}` }
            : {},
      },
    };
  },
});
