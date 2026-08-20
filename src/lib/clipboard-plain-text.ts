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

function renderListItem(
  item: ProseMirrorNode,
  marker: string,
  depth: number,
  includeBlockSyntax: boolean,
): string {
  if (!includeBlockSyntax) {
    const blocks: string[] = [];
    item.forEach((child) => blocks.push(renderNode(child, depth, false)));
    return blocks.filter(Boolean).join("\n");
  }
  const indent = "  ".repeat(depth);
  const continuationIndent = `${indent}${" ".repeat(marker.length)}`;
  const ownBlocks: string[] = [];
  const nestedLists: ProseMirrorNode[] = [];

  item.forEach((child) => {
    if (child.type.name === "orderedList" || child.type.name === "bulletList") nestedLists.push(child);
    else ownBlocks.push(renderNode(child, depth, includeBlockSyntax));
  });

  const first = ownBlocks.shift() ?? "";
  const lines = [`${indent}${marker}${first}`];
  for (const block of ownBlocks) {
    lines.push(...block.split("\n").map((line) => `${continuationIndent}${line}`));
  }
  for (const list of nestedLists) lines.push(renderNode(list, depth + 1, includeBlockSyntax));
  return lines.join("\n");
}

function renderList(node: ProseMirrorNode, depth: number, includeBlockSyntax: boolean): string {
  const ordered = node.type.name === "orderedList";
  const start = ordered && Number.isFinite(node.attrs.start) ? Number(node.attrs.start) : 1;
  const items: string[] = [];
  for (let index = 0; index < node.childCount; index++) {
    items.push(renderListItem(
      node.child(index),
      ordered ? `${start + index}. ` : "- ",
      depth,
      includeBlockSyntax,
    ));
  }
  return items.join("\n");
}

function renderTable(node: ProseMirrorNode, includeBlockSyntax: boolean): string {
  const rows: string[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const blocks: string[] = [];
      cell.forEach((block) => blocks.push(renderNode(block, 0, includeBlockSyntax)));
      cells.push(blocks.join("\n"));
    });
    rows.push(cells.join("\t"));
  });
  return rows.join("\n");
}

function renderChildren(
  node: ProseMirrorNode,
  separator: string,
  depth: number,
  includeBlockSyntax: boolean,
): string {
  const children: string[] = [];
  node.forEach((child) => children.push(renderNode(child, depth, includeBlockSyntax)));
  return children.join(separator);
}

function renderNode(node: ProseMirrorNode, depth: number, includeBlockSyntax: boolean): string {
  switch (node.type.name) {
    case "orderedList":
    case "bulletList":
      return renderList(node, depth, includeBlockSyntax);
    case "listItem":
      return renderListItem(node, "- ", depth, includeBlockSyntax);
    case "paragraph":
    case "heading":
      return inlineText(node);
    case "codeBlock":
      return node.textContent;
    case "blockquote":
      {
        const content = renderChildren(node, "\n", depth, includeBlockSyntax);
        return includeBlockSyntax
          ? content.split("\n").map((line) => `> ${line}`).join("\n")
          : content;
      }
    case "horizontalRule":
      return "---";
    case "table":
      return renderTable(node, includeBlockSyntax);
    default:
      if (node.isText) return node.text ?? "";
      if (node.inlineContent) return inlineText(node);
      return renderChildren(node, "\n\n", depth, includeBlockSyntax);
  }
}

function renderFragment(fragment: Fragment, includeBlockSyntax: boolean): string {
  const blocks: string[] = [];
  fragment.forEach((node) => blocks.push(renderNode(node, 0, includeBlockSyntax)));
  return blocks.join("\n\n");
}

/**
 * 面向 Notepad、终端等纯文本目标的紧凑剪贴板格式。
 * 顶层段落保留空行；列表项仅换行一次，避免嵌套块节点重复制造空行。
 */
export function clipboardSliceToPlainText(slice: Slice): string {
  // openStart/openEnd > 0 表示选区只截取了块内部的一部分。此时列表圆点、
  // 序号和引用符并不属于实际选中文本，不应由序列化器额外合成。
  const includeBlockSyntax = slice.openStart === 0 && slice.openEnd === 0;
  return renderFragment(slice.content, includeBlockSyntax);
}
