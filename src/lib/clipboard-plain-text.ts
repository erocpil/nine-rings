import type { Fragment, Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";

function inlineText(node: ProseMirrorNode): string {
  let result = "";
  node.descendants((child) => {
    if (child.isText) {
      result += child.text ?? "";
      return false;
    }
    if (child.type.name === "hardBreak") {
      result += "\n";
      return false;
    }
    if (child.type.name === "image" || child.type.name === "resizableImage") {
      result += String(child.attrs.alt ?? child.attrs.title ?? "[图片]");
      return false;
    }
    return true;
  });
  return result;
}

function renderListItem(item: ProseMirrorNode, marker: string, depth: number): string {
  const indent = "  ".repeat(depth);
  const continuationIndent = `${indent}${" ".repeat(marker.length)}`;
  const ownBlocks: string[] = [];
  const nestedLists: ProseMirrorNode[] = [];

  item.forEach((child) => {
    if (child.type.name === "orderedList" || child.type.name === "bulletList") nestedLists.push(child);
    else ownBlocks.push(renderNode(child, depth));
  });

  const first = ownBlocks.shift() ?? "";
  const lines = [`${indent}${marker}${first}`];
  for (const block of ownBlocks) {
    lines.push(...block.split("\n").map((line) => `${continuationIndent}${line}`));
  }
  for (const list of nestedLists) lines.push(renderNode(list, depth + 1));
  return lines.join("\n");
}

function renderList(node: ProseMirrorNode, depth: number): string {
  const ordered = node.type.name === "orderedList";
  const start = ordered && Number.isFinite(node.attrs.start) ? Number(node.attrs.start) : 1;
  const items: string[] = [];
  for (let index = 0; index < node.childCount; index++) {
    items.push(renderListItem(node.child(index), ordered ? `${start + index}. ` : "- ", depth));
  }
  return items.join("\n");
}

function renderTable(node: ProseMirrorNode): string {
  const rows: string[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const blocks: string[] = [];
      cell.forEach((block) => blocks.push(renderNode(block, 0)));
      cells.push(blocks.join("\n"));
    });
    rows.push(cells.join("\t"));
  });
  return rows.join("\n");
}

function renderChildren(node: ProseMirrorNode, separator: string, depth: number): string {
  const children: string[] = [];
  node.forEach((child) => children.push(renderNode(child, depth)));
  return children.join(separator);
}

function renderNode(node: ProseMirrorNode, depth: number): string {
  switch (node.type.name) {
    case "orderedList":
    case "bulletList":
      return renderList(node, depth);
    case "listItem":
      return renderListItem(node, "- ", depth);
    case "paragraph":
    case "heading":
      return inlineText(node);
    case "codeBlock":
      return node.textContent;
    case "blockquote":
      return renderChildren(node, "\n", depth).split("\n").map((line) => `> ${line}`).join("\n");
    case "horizontalRule":
      return "---";
    case "table":
      return renderTable(node);
    default:
      if (node.isText) return node.text ?? "";
      if (node.inlineContent) return inlineText(node);
      return renderChildren(node, "\n\n", depth);
  }
}

function renderFragment(fragment: Fragment): string {
  const blocks: string[] = [];
  fragment.forEach((node) => blocks.push(renderNode(node, 0)));
  return blocks.join("\n\n");
}

/**
 * 面向 Notepad、终端等纯文本目标的紧凑剪贴板格式。
 * 顶层段落保留空行；列表项仅换行一次，避免嵌套块节点重复制造空行。
 */
export function clipboardSliceToPlainText(slice: Slice): string {
  return renderFragment(slice.content);
}
