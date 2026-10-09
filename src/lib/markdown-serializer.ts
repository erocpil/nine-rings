import type { JSONContent } from "@tiptap/core";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import type {
  Root,
  RootContent,
  PhrasingContent,
  Text,
  Table,
  BlockContent,
} from "mdast";
import { deltaToProseMirror, isProseMirror } from "./delta-converter";

function mergeInline(nodes: PhrasingContent[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  for (const node of nodes) {
    const previous = result[result.length - 1];
    if (previous?.type === "text" && node.type === "text")
      previous.value += node.value;
    else if (
      previous &&
      previous.type === node.type &&
      "children" in previous &&
      "children" in node &&
      JSON.stringify({ ...previous, children: undefined }) ===
        JSON.stringify({ ...node, children: undefined })
    ) {
      previous.children = mergeInline([...previous.children, ...node.children]);
    } else result.push(node);
  }
  return result;
}
function inline(content: JSONContent[]): PhrasingContent[] {
  type Token = {
    children: PhrasingContent[];
    marks: NonNullable<JSONContent["marks"]>;
  };
  const tokens: Token[] = [];
  for (const node of content) {
    let children: PhrasingContent[] = [];
    switch (node.type) {
      case "text": {
        const footnote = node.marks?.find(
          (mark) => mark.type === "footnoteReference",
        );
        const code = node.marks?.some((mark) => mark.type === "code");
        children = [
          footnote
            ? {
                type: "footnoteReference",
                identifier: String(footnote.attrs?.id ?? "note"),
                label: String(footnote.attrs?.id ?? "note"),
              }
            : code
              ? { type: "inlineCode", value: node.text ?? "" }
              : { type: "text", value: node.text ?? "" },
        ];
        break;
      }
      case "hardBreak":
        children = [{ type: "break" }];
        break;
      case "mathInline":
        children = [
          { type: "inlineMath", value: String(node.attrs?.source ?? "") },
        ];
        break;
      case "markdownImage":
      case "image":
      case "resizableImage":
        children = [
          {
            type: "image",
            url: String(node.attrs?.src ?? ""),
            alt: String(node.attrs?.alt ?? ""),
            title: node.attrs?.title ?? null,
          },
        ];
        break;
      case "rawHtmlInline":
        children = [{ type: "html", value: String(node.attrs?.source ?? "") }];
        break;
      case "htmlAnchor":
        children = [
          {
            type: "html",
            value: `<a name="${escapeHTML(String(node.attrs?.id ?? ""))}"></a>`,
          },
        ];
        break;
    }
    const marks = (node.marks ?? []).filter((mark) =>
      [
        "bold",
        "italic",
        "strike",
        "link",
        "inlineHighlight",
        "htmlStyle",
      ].includes(mark.type),
    );
    tokens.push({ children, marks });
  }
  const pack = (items: Token[]): PhrasingContent[] => {
    const output: PhrasingContent[] = [];
    for (let index = 0; index < items.length;) {
      const item = items[index];
      if (!item.marks.length) {
        output.push(...item.children);
        index++;
        continue;
      }
      let chosen = item.marks[0],
        end = index + 1;
      for (const mark of item.marks) {
        let candidate = index + 1;
        while (
          candidate < items.length &&
          items[candidate].marks.some(
            (other) => JSON.stringify(other) === JSON.stringify(mark),
          )
        )
          candidate++;
        if (candidate > end) {
          chosen = mark;
          end = candidate;
        }
      }
      const children = pack(
        items
          .slice(index, end)
          .map((token) => ({
            ...token,
            marks: token.marks.filter(
              (mark) => JSON.stringify(mark) !== JSON.stringify(chosen),
            ),
          })),
      );
      if (chosen.type === "bold") output.push({ type: "strong", children });
      else if (chosen.type === "italic")
        output.push({ type: "emphasis", children });
      else if (chosen.type === "strike")
        output.push({ type: "delete", children });
      else if (chosen.type === "link")
        output.push({
          type: "link",
          url: String(chosen.attrs?.href ?? ""),
          title: chosen.attrs?.title ?? null,
          children,
        });
      else {
        const tag =
          chosen.type === "inlineHighlight"
            ? "mark"
            : ["sub", "sup", "ins"].includes(chosen.attrs?.tag)
              ? String(chosen.attrs?.tag)
              : "ins";
        output.push({ type: "html", value: `<${tag}>` }, ...children, {
          type: "html",
          value: `</${tag}>`,
        });
      }
      index = end;
    }
    return mergeInline(output);
  };
  return pack(tokens);
}
function escapeHTML(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function block(node: JSONContent): RootContent[] {
  const content = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return [{ type: "paragraph", children: inline(content) }];
    case "heading":
      return [
        {
          type: "heading",
          depth: Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)) as
            1 | 2 | 3 | 4 | 5 | 6,
          children: inline(content),
        },
      ];
    case "codeBlock":
      return [
        {
          type: "code",
          lang: node.attrs?.language ?? null,
          meta: node.attrs?.meta ?? null,
          value: content.map((child) => child.text ?? "").join(""),
        },
      ];
    case "blockquote": {
      const children = content.flatMap(block) as BlockContent[];
      if (node.attrs?.alert)
        children.unshift({
          type: "paragraph",
          data: { nrAlert: true },
          children: [{ type: "text", value: `[!${node.attrs.alert}]` }],
        });
      return [{ type: "blockquote", children }];
    }
    case "bulletList":
    case "orderedList":
      return [
        {
          type: "list",
          ordered: node.type === "orderedList",
          start: Number(node.attrs?.start) || 1,
          spread:
            node.attrs?.spread === true ||
            content.some(
              (item) =>
                (item.content ?? []).filter(
                  (child) =>
                    child.type !== "bulletList" && child.type !== "orderedList",
                ).length > 1,
            ),
          children: content.map((item) => ({
            type: "listItem",
            checked:
              typeof item.attrs?.taskChecked === "boolean"
                ? item.attrs.taskChecked
                : null,
            spread:
              (item.content ?? []).filter(
                (child) =>
                  child.type !== "bulletList" && child.type !== "orderedList",
              ).length > 1,
            children: (item.content ?? [])
              .filter(
                (child, index, children) =>
                  !(
                    index === 0 &&
                    children.length > 1 &&
                    child.type === "paragraph" &&
                    !child.content?.length
                  ),
              )
              .flatMap(block) as BlockContent[],
          })),
        },
      ];
    case "horizontalRule":
      return [{ type: "thematicBreak" }];
    case "table": {
      const first = content[0];
      const table: Table = {
        type: "table",
        align: (first?.content ?? []).map((cell) =>
          ["left", "right", "center"].includes(cell.attrs?.textAlign)
            ? (cell.attrs!.textAlign as "left" | "right" | "center")
            : null,
        ),
        children: content.map((row) => ({
          type: "tableRow",
          children: (row.content ?? []).map((cell) => ({
            type: "tableCell",
            children: inline(
              (cell.content ?? []).flatMap((paragraph, index) =>
                index
                  ? [{ type: "hardBreak" }, ...(paragraph.content ?? [])]
                  : (paragraph.content ?? []),
              ),
            ).map((child) =>
              child.type === "break" ? { type: "html", value: "<br>" } : child,
            ),
          })),
        })),
      };
      return [table];
    }
    case "resizableImage":
    case "image":
    case "markdownImage":
      return [{ type: "paragraph", children: inline([node]) }];
    case "mathBlock":
      return [{ type: "math", value: String(node.attrs?.source ?? "") }];
    case "htmlDetails": {
      const body = serialize({
        type: "root",
        children: content.flatMap(block),
      }).trimEnd();
      return [
        {
          type: "html",
          value: `<details${node.attrs?.open ? " open" : ""}>\n<summary>${escapeHTML(String(node.attrs?.summary ?? "点击展开"))}</summary>\n\n${body}\n</details>`,
        },
      ];
    }
    case "rawHtml":
      return [{ type: "html", value: String(node.attrs?.source ?? "") }];
    case "footnotes":
      return content.map((definition) => ({
        type: "footnoteDefinition",
        identifier: String(definition.attrs?.id ?? "note"),
        label: String(definition.attrs?.id ?? "note"),
        children: (definition.content ?? []).flatMap(block) as BlockContent[],
      }));
    default:
      return [];
  }
}
function serialize(root: Root): string {
  const gfm = gfmToMarkdown();
  const taskItem = gfm.extensions!.find(
    (extension) => extension.handlers?.listItem,
  )?.handlers?.listItem;
  return toMarkdown(root, {
    extensions: [gfm, mathToMarkdown()],
    resourceLink: true,
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fences: true,
    rule: "-",
    ruleRepetition: 3,
    ruleSpaces: false,
    listItemIndent: "one",
    incrementListMarker: true,
    join: [
      (left, right) =>
        left.type === "blockquote" && right.type === "blockquote"
          ? false
          : undefined,
    ],
    unsafe: [{ character: "[", after: "\\\\^", inConstruct: ["phrasing"] }],
    handlers: {
      listItem(node, parent, state, info) {
        if (
          typeof node.checked === "boolean" &&
          node.children.length === 1 &&
          node.children[0].type === "paragraph" &&
          !node.children[0].children.length
        ) {
          const marker =
            parent?.type === "list" && parent.ordered
              ? `${(parent.start ?? 1) + parent.children.indexOf(node)}.`
              : "-";
          return `${marker} [${node.checked ? "x" : " "}]`;
        }
        return taskItem!(node, parent, state, info);
      },
      break: () => "  \n",
      paragraph(node, _parent, state, info) {
        if (node.data?.nrAlert) return (node.children[0] as Text).value;
        const exit = state.enter("paragraph");
        const phrasing = state.enter("phrasing");
        const value = state.containerPhrasing(node, info);
        phrasing();
        exit();
        return value;
      },
    },
  });
}
/** One structured serializer for the UI, storage, Workers and CLI. */
export function deltaToMarkdown(content: unknown): string {
  const doc = isProseMirror(content)
    ? content
    : deltaToProseMirror(Array.isArray(content) ? { ops: content } : content);
  return serialize({
    type: "root",
    children: (doc.content ?? []).flatMap(block),
  }).trimEnd();
}
export function noteToMarkdown(
  title: string | null | undefined,
  content: unknown,
): string {
  const normalizedTitle = title?.trim() || "无标题";
  const body = deltaToMarkdown(content);
  const heading = `# ${normalizedTitle}`;
  return body === heading || body.startsWith(`${heading}\n`)
    ? body
    : body
      ? `${heading}\n\n${body}`
      : heading;
}
