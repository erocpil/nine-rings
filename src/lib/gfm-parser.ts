import { deltaOpWeight } from "./delta-content-weight";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { fromHtml } from "hast-util-from-html";
import type { Root, Nodes, PhrasingContent } from "mdast";
import type { DeltaOp, DeltaOps } from "../types/models";
import type { TableEmbed } from "./table-embed";
import { bareLinkParts, CJK_LINK_BOUNDARY } from "./bare-autolinks";

export function markdownAST(source: string): Root {
  return fromMarkdown(source, {
    extensions: [gfm(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
}
export interface MarkdownSourceSpan {
  fromLine: number;
  toLine: number;
  fromOp: number;
  toOp: number;
  weight?: number;
}
type Attributes = Record<string, unknown>;
interface Context {
  source: string;
  definitions: Map<string, Extract<Nodes, { type: "definition" }>>;
  footnotes: Map<string, Extract<Nodes, { type: "footnoteDefinition" }>>;
  references: Map<string, { number: number; count: number }>;
}
function collect(root: Nodes, context: Context): void {
  if (root.type === "definition" && !context.definitions.has(root.identifier))
    context.definitions.set(root.identifier, root);
  if (
    root.type === "footnoteDefinition" &&
    !context.footnotes.has(root.identifier)
  )
    context.footnotes.set(root.identifier, root);
  if ("children" in root)
    for (const child of root.children) collect(child, context);
}
function addText(ops: DeltaOp[], text: string, attributes: Attributes): void {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (
    last &&
    typeof last.insert === "string" &&
    last.insert !== "\n" &&
    JSON.stringify(last.attributes ?? {}) === JSON.stringify(attributes)
  )
    last.insert += text;
  else
    ops.push({
      insert: text,
      ...(Object.keys(attributes).length ? { attributes } : {}),
    });
}
function reference(id: string, context: Context, attrs: Attributes): DeltaOp {
  let entry = context.references.get(id);
  if (!entry) {
    entry = { number: context.references.size + 1, count: 0 };
    context.references.set(id, entry);
  }
  entry.count++;
  return {
    insert: String(entry.number),
    attributes: {
      ...attrs,
      footnoteRef: id,
      footnoteNumber: entry.number,
      footnoteOccurrence: entry.count,
    },
  };
}
const inlineTags: Record<string, Attributes> = {
  mark: { highlight: true },
  strong: { bold: true },
  b: { bold: true },
  em: { italic: true },
  i: { italic: true },
  del: { strike: true },
  s: { strike: true },
  code: { code: true },
  sub: { htmlStyle: "sub" },
  sup: { htmlStyle: "sup" },
  ins: { htmlStyle: "ins" },
};
function htmlAttributes(source: string): Record<string, unknown> {
  const root = fromHtml(source, { fragment: true });
  const element = root.children.find((child) => child.type === "element");
  return element?.type === "element" ? element.properties : {};
}
function inline(
  nodes: readonly PhrasingContent[],
  context: Context,
  attrs: Attributes = {},
): DeltaOp[] {
  const ops: DeltaOp[] = [];
  const htmlStack: Array<{ tag: string; attrs: Attributes }> = [];
  const current = () => ({
    ...attrs,
    ...Object.assign({}, ...htmlStack.map((item) => item.attrs)),
  });
  for (const node of nodes) {
    const attributes = current();
    switch (node.type) {
      case "text": {
        const raw = context.source.slice(
          node.position?.start.offset ?? 0,
          node.position?.end.offset ?? 0,
        );
        // Partial-reference paste remains usable, but deliberate escapes are literal.
        if (!/\\\[\^/.test(raw) && /\[\^[^\]\s]+\]/.test(node.value)) {
          for (const part of node.value.split(/(\[\^[^\]\s]+\])/g)) {
            const id = /^\[\^([^\]\s]+)\]$/.exec(part)?.[1];
            if (id) ops.push(reference(id.toLowerCase(), context, attributes));
            else addText(ops, part.replace(/\n/g, " "), attributes);
          }
        } else if (/\\\([^\n]+?\\\)/.test(raw)) {
          for (const part of raw.split(/(\\\([^\n]+?\\\))/g)) {
            if (/^\\\(.+\\\)$/.test(part))
              ops.push({
                insert: { mathInline: part.slice(2, -2) },
                ...(Object.keys(attributes).length ? { attributes } : {}),
              });
            else {
              const leading = part.match(/^[ \t]+/)?.[0] ?? "";
              const trailing = part.trim().length
                ? (part.match(/[ \t]+$/)?.[0] ?? "")
                : "";
              addText(ops, leading, attributes);
              for (const op of inline(
                markdownAST(part).children.flatMap((child) =>
                  child.type === "paragraph" ? child.children : [],
                ),
                { ...context, source: part },
                attributes,
              ))
                if (typeof op.insert === "string")
                  addText(ops, op.insert, op.attributes ?? {});
                else ops.push(op);
              addText(ops, trailing, attributes);
            }
          }
        } else addText(ops, node.value.replace(/\n/g, " "), attributes);
        break;
      }
      case "strong":
      case "emphasis":
      case "delete": {
        const mark =
          node.type === "strong"
            ? "bold"
            : node.type === "emphasis"
              ? "italic"
              : "strike";
        for (const op of inline(node.children, context, {
          ...attributes,
          [mark]: true,
        }))
          ops.push(op);
        break;
      }
      case "inlineCode":
        addText(ops, node.value.replace(/\r\n?|\n/g, " "), {
          ...attributes,
          code: true,
        });
        break;
      case "break":
        ops.push({ insert: "\n", attributes: { "hard-break": true } });
        break;
      case "inlineMath":
        ops.push({
          insert: { mathInline: node.value.replace(/^`([\s\S]*)`$/, "$1") },
          ...(Object.keys(attributes).length ? { attributes } : {}),
        });
        break;
      case "footnoteReference":
        ops.push(reference(node.identifier, context, attributes));
        break;
      case "link":
      case "linkReference": {
        const raw = context.source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
        if (node.type === "link" && !raw.startsWith("[") && !raw.startsWith("<") && CJK_LINK_BOUNDARY.test(raw)) {
          for (const part of bareLinkParts(raw)) addText(ops, part.text, { ...attributes, ...(part.href ? { link: part.href } : {}) });
          break;
        }
        const target =
          node.type === "link"
            ? node
            : context.definitions.get(node.identifier);
        for (const op of inline(
          node.children,
          context,
          target
            ? {
                ...attributes,
                link: target.url,
                ...(CJK_LINK_BOUNDARY.test(target.url) ? { linkExplicit: true } : {}),
                ...(target.title ? { linkTitle: target.title } : {}),
              }
            : attributes,
        ))
          ops.push(op);
        break;
      }
      case "image":
      case "imageReference": {
        const target =
          node.type === "image"
            ? node
            : context.definitions.get(node.identifier);
        if (target)
          ops.push({
            insert: {
              inlineImage: {
                src: target.url,
                alt: node.alt ?? "",
                title: target.title ?? null,
              },
            },
            ...(Object.keys(attributes).length ? { attributes } : {}),
          });
        break;
      }
      case "html": {
        if (/^<!--[\s\S]*-->$/.test(node.value)) {
          ops.push({ insert: { rawHtmlInline: node.value } });
          break;
        }
        const token = /^<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>$/i.exec(
          node.value,
        );
        const tag = token?.[2].toLowerCase();
        if (tag && token?.[1] && htmlStack.some((item) => item.tag === tag)) {
          htmlStack.splice(htmlStack.map((item) => item.tag).lastIndexOf(tag));
          break;
        }
        if (tag && !token?.[1] && inlineTags[tag]) {
          htmlStack.push({ tag, attrs: inlineTags[tag] });
          break;
        }
        if (tag === "br" && !token?.[1]) {
          ops.push({ insert: "\n", attributes: { "hard-break": true } });
          break;
        }
        if (tag === "a" && !token?.[1]) {
          const p = htmlAttributes(node.value);
          const id = p.id ?? p.name;
          if (typeof id === "string") ops.push({ insert: { htmlAnchor: id } });
          htmlStack.push({
            tag,
            attrs:
              typeof p.href === "string"
                ? { link: p.href, ...(p.title ? { linkTitle: p.title } : {}) }
                : {},
          });
          break;
        }
        if (tag === "img" && !token?.[1]) {
          const p = htmlAttributes(node.value);
          ops.push({
            insert: {
              inlineImage: {
                src: String(p.src ?? ""),
                alt: String(p.alt ?? ""),
                title: p.title ?? null,
              },
            },
          });
          break;
        }
        if (tag === "span") {
          if (!token?.[1]) htmlStack.push({ tag, attrs: {} });
          break;
        }
        ops.push({ insert: { rawHtmlInline: node.value } });
        break;
      }
    }
  }
  return ops;
}
function table(
  node: Extract<Nodes, { type: "table" }>,
  context: Context,
): TableEmbed {
  return {
    version: 1,
    columns: (node.align ?? []).map((align) => ({ align })),
    rows: node.children.map((row, index) => ({
      cells: Array.from(
        { length: node.children[0]?.children.length ?? 0 },
        (_, column) => {
          const cell = row.children[column];
          return {
            ...(index === 0 ? { header: true } : {}),
            content: { ops: inline(cell?.children ?? [], context) },
          };
        },
      ),
    })),
  };
}
/** Find a matching details close without treating code fences as HTML. */
function detailsEnd(source: string, from: number): number | null {
  let depth = 0;
  let fence = "";
  let offset = from;
  for (const line of source.slice(from).split(/(?<=\n)/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = "";
      offset += line.length;
      continue;
    }
    if (!fence)
      for (const match of line.matchAll(
        /<!--.*?-->|`[^`]*`|<\/?details\b[^>]*>/gi,
      )) {
        if (!match[0].startsWith("<") || match[0].startsWith("<!--")) continue;
        depth += /^<\//.test(match[0]) ? -1 : 1;
        if (depth === 0) return offset + match.index! + match[0].length;
      }
    offset += line.length;
  }
  return null;
}
function details(source: string, context: Context): DeltaOp {
  const root = fromHtml(source, { fragment: true });
  const element = root.children.find(
    (child) => child.type === "element" && child.tagName === "details",
  );
  const summary =
    element?.type === "element"
      ? element.children.find(
          (child) => child.type === "element" && child.tagName === "summary",
        )
      : undefined;
  const text = (node: typeof root | (typeof root.children)[number]): string =>
    "value" in node
      ? node.value
      : "children" in node
        ? node.children.map(text).join("")
        : "";
  let body = source;
  if (summary?.position)
    body =
      source.slice(0, summary.position.start.offset) +
      source.slice(summary.position.end.offset);
  body = body
    .replace(/^\s*<details\b[^>]*>/i, "")
    .replace(/<\/details>\s*$/i, "");
  const nested = { ...context, source: body };
  const ast = markdownAST(body);
  collect(ast, nested);
  return {
    insert: {
      htmlDetails: {
        summary: summary ? text(summary).trim() : "点击展开",
        open: element?.type === "element" && element.properties.open === true,
        content: blocks(ast.children, nested),
      },
    },
  };
}
function simpleList(node: Extract<Nodes, { type: "list" }>): boolean {
  return node.children.every(
    (item) =>
      item.children.length > 0 &&
      item.children.every(
        (child) =>
          child.type === "paragraph" ||
          (child.type === "list" && simpleList(child)),
      ),
  );
}
function listLines(
  node: Extract<Nodes, { type: "list" }>,
  context: Context,
  ops: DeltaOp[],
  depth = 0,
  spans?: MarkdownSourceSpan[],
): void {
  node.children.forEach((item, index) => {
    let emitted = false;
    for (const child of item.children) {
      if (child.type === "list") {
        listLines(child, context, ops, depth + 1, spans);
        continue;
      }
      if (child.type !== "paragraph") continue;
      const fromOp = ops.length;
      for (const op of inline(child.children, context)) ops.push(op);
      ops.push({
        insert: "\n",
        attributes: {
          list: node.ordered ? "ordered" : "bullet",
          ...(depth ? { indent: depth } : {}),
          ...(node.ordered ? { listStart: (node.start ?? 1) + index } : {}),
          ...(typeof item.checked === "boolean"
            ? { taskChecked: item.checked }
            : {}),
          ...(emitted ? { "list-continuation": true } : {}),
          ...(!index && !emitted ? { "list-block-start": true } : {}),
          ...(node.spread ? { "list-spread": true } : {}),
        },
      });
      if (spans)
        spans.push({
          fromLine: (child.position?.start.line ?? 1) - 1,
          toLine: child.position?.end.line ?? 1,
          fromOp,
          toOp: ops.length,
        });
      emitted = true;
    }
  });
}
function safeHTML(source: string): DeltaOp[] | null {
  if (/^\s*<\?|^\s*<![^-]/.test(source)) return null;
  const root = fromHtml(source, { fragment: true });
  if (
    root.children.every(
      (child) =>
        child.type === "comment" ||
        (child.type === "text" && !child.value.trim()),
    )
  )
    return null;
  const allowed = new Set([
    ...Object.keys(inlineTags),
    "a",
    "span",
    "br",
    "img",
  ]);
  const ops: DeltaOp[] = [];
  const walk = (
    node: (typeof root.children)[number],
    attributes: Attributes,
  ): boolean => {
    if (node.type === "text") {
      addText(ops, node.value.replace(/\s+/g, " "), attributes);
      return true;
    }
    if (node.type === "comment") {
      ops.push({ insert: { rawHtmlInline: `<!--${node.value}-->` } });
      return true;
    }
    if (node.type !== "element" || !allowed.has(node.tagName)) return false;
    const p = node.properties;
    if (node.tagName === "br")
      ops.push({ insert: "\n", attributes: { "hard-break": true } });
    else if (node.tagName === "img")
      ops.push({
        insert: {
          inlineImage: {
            src: String(p.src ?? ""),
            alt: String(p.alt ?? ""),
            title: p.title ?? null,
          },
        },
        attributes,
      });
    else {
      if (node.tagName === "a" && typeof (p.id ?? p.name) === "string")
        ops.push({ insert: { htmlAnchor: String(p.id ?? p.name) } });
      const next = {
        ...attributes,
        ...inlineTags[node.tagName],
        ...(node.tagName === "a" && typeof p.href === "string"
          ? { link: p.href, ...(p.title ? { linkTitle: p.title } : {}) }
          : {}),
      };
      for (const child of node.children) if (!walk(child, next)) return false;
    }
    return true;
  };
  if (!root.children.every((child) => walk(child, {}))) return null;
  const first = ops[0],
    last = ops[ops.length - 1];
  if (typeof first?.insert === "string")
    first.insert = first.insert.trimStart();
  if (typeof last?.insert === "string") last.insert = last.insert.trimEnd();
  return ops.filter((op) => op.insert !== "");
}
function blocks(
  nodes: readonly Nodes[],
  context: Context,
  spans?: MarkdownSourceSpan[],
): DeltaOp[] {
  const ops: DeltaOp[] = [];
  let skipThrough = -1;
  for (const node of nodes) {
    if ((node.position?.start.offset ?? 0) < skipThrough) continue;
    const fromOp = ops.length;
    let granular = false;
    let toLine = node.position?.end.line ?? 1;
    switch (node.type) {
      case "paragraph":
      case "heading": {
        const first = node.children[0];
        if (
          node.type === "paragraph" &&
          node.children.length === 1 &&
          (first?.type === "image" || first?.type === "imageReference")
        ) {
          const target =
            first.type === "image"
              ? first
              : context.definitions.get(first.identifier);
          if (target)
            ops.push(
              {
                insert: { image: target.url },
                attributes: {
                  imageAlt: first.alt ?? "",
                  imageTitle: target.title ?? null,
                },
              },
              { insert: "\n" },
            );
        } else if (
          node.type === "paragraph" &&
          first?.type === "inlineMath" &&
          context.source
            .slice(first.position?.start.offset ?? 0)
            .startsWith("$$")
        ) {
          ops.push({ insert: { mathBlock: first.value } }, { insert: "\n" });
          const rest = inline(node.children.slice(1), context);
          if (rest.length) ops.push(...rest, { insert: "\n" });
        } else {
          for (const op of inline(node.children, context)) ops.push(op);
          ops.push({
            insert: "\n",
            ...(node.type === "heading"
              ? { attributes: { header: node.depth } }
              : {}),
          });
        }
        break;
      }
      case "code":
        if (node.lang === "math")
          ops.push({ insert: { mathBlock: node.value } }, { insert: "\n" });
        else {
          if (node.value) ops.push({ insert: node.value });
          ops.push({
            insert: "\n",
            attributes: {
              "code-block": true,
              "indent-explicit": true,
              ...(node.lang ? { language: node.lang } : {}),
              ...(node.meta ? { "code-meta": node.meta } : {}),
            },
          });
        }
        break;
      case "math":
        ops.push({ insert: { mathBlock: node.value } }, { insert: "\n" });
        break;
      case "thematicBreak":
        ops.push({ insert: { hr: true } }, { insert: "\n" });
        break;
      case "blockquote": {
        const first = node.children[0];
        const alert =
          first?.type === "paragraph" && first.children[0]?.type === "text"
            ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/.exec(
                first.children[0].value,
              )?.[1]
            : undefined;
        let children = node.children;
        if (
          alert &&
          first?.type === "paragraph" &&
          first.children[0]?.type === "text"
        ) {
          const remaining = {
            ...first.children[0],
            value: first.children[0].value.replace(/^\[![A-Z]+\]\n?/, ""),
          };
          children = [
            { ...first, children: [remaining, ...first.children.slice(1)] },
            ...node.children.slice(1),
          ];
        }
        const childSpans: MarkdownSourceSpan[] = [];
        const content = blocks(
          children,
          context,
          spans ? childSpans : undefined,
        );
        if (spans && childSpans.length) {
          for (const span of childSpans)
            spans.push({
              ...span,
              fromOp,
              toOp: fromOp + 1,
              weight:
                span.weight ??
                content
                  .slice(span.fromOp, span.toOp)
                  .reduce((sum, op) => sum + deltaOpWeight(op), 0),
            });
          granular = true;
        }
        ops.push(
          {
            insert: {
              blockquote: { version: 1, content, ...(alert ? { alert } : {}) },
            },
            attributes: { "indent-explicit": true },
          },
          { insert: "\n" },
        );
        break;
      }
      case "list": {
        // Empty /todo items remain actionable while standard GFM requires label whitespace.
        for (const item of node.children) {
          const first = item.children[0];
          if (
            first?.type === "paragraph" &&
            first.children.length === 1 &&
            first.children[0].type === "text" &&
            /^\[[ xX]\]$/.test(first.children[0].value)
          ) {
            const raw = context.source.slice(
              first.position?.start.offset ?? 0,
              first.position?.end.offset ?? 0,
            );
            if (!raw.startsWith("\\")) {
              item.checked = /x/i.test(first.children[0].value);
              first.children = [];
            }
          }
        }
        if (simpleList(node)) listLines(node, context, ops, 0, spans);
        else {
          const items = node.children.map((item) => {
            const childSpans: MarkdownSourceSpan[] = [];
            const content = blocks(
              item.children,
              context,
              spans ? childSpans : undefined,
            );
            if (spans)
              for (const span of childSpans)
                spans.push({
                  ...span,
                  fromOp,
                  toOp: fromOp + 1,
                  weight:
                    span.weight ??
                    content
                      .slice(span.fromOp, span.toOp)
                      .reduce((sum, op) => sum + deltaOpWeight(op), 0),
                });
            return { checked: item.checked, content };
          });
          ops.push(
            {
              insert: {
                list: {
                  version: 1,
                  ordered: node.ordered,
                  start: node.start ?? 1,
                  spread: node.spread,
                  items,
                },
              },
            },
            { insert: "\n" },
          );
          granular = Boolean(spans);
        }
        break;
      }
      case "table":
        ops.push({ insert: { table: table(node, context) } }, { insert: "\n" });
        break;
      case "html": {
        const start = node.position?.start.offset ?? 0;
        const end = /^<details\b/i.test(node.value.trimStart())
          ? detailsEnd(context.source, start)
          : null;
        if (end !== null) {
          ops.push(details(context.source.slice(start, end), context), {
            insert: "\n",
          });
          skipThrough = end;
          toLine = context.source.slice(0, end).split("\n").length;
          const tail = context.source.slice(
            end,
            node.position?.end.offset ?? end,
          );
          if (tail.trim())
            ops.push(
              ...blocks(markdownAST(tail).children, {
                ...context,
                source: tail,
              }),
            );
        } else {
          const safe = safeHTML(node.value);
          if (safe) {
            for (const op of safe) ops.push(op);
            ops.push({ insert: "\n" });
          } else
            ops.push({ insert: { rawHtml: node.value } }, { insert: "\n" });
        }
        break;
      }
    }
    if (
      spans &&
      !granular &&
      !(node.type === "list" && simpleList(node)) &&
      ops.length > fromOp
    )
      spans.push({
        fromLine: (node.position?.start.line ?? 1) - 1,
        toLine,
        fromOp,
        toOp: ops.length,
      });
  }
  return ops;
}
export function parseGFM(
  source: string,
  spans?: MarkdownSourceSpan[],
): DeltaOps {
  const ast = markdownAST(source);
  const context: Context = {
    source,
    definitions: new Map(),
    footnotes: new Map(),
    references: new Map(),
  };
  collect(ast, context);
  const ops = blocks(ast.children, context, spans);
  if (context.footnotes.size) {
    const definitions = [...context.footnotes.entries()].sort(
      ([a], [b]) =>
        (context.references.get(a)?.number ?? Infinity) -
        (context.references.get(b)?.number ?? Infinity),
    );
    const footnotes = definitions.map(([id, definition]) => ({
      id,
      content: blocks(definition.children, context),
      number: context.references.get(id)?.number ?? null,
      references: context.references.get(id)?.count ?? 0,
    }));
    const fromOp = ops.length;
    ops.push({ insert: { footnotes } }, { insert: "\n" });
    if (spans)
      definitions.forEach(([, definition], index) =>
        spans.push({
          fromLine: (definition.position?.start.line ?? 1) - 1,
          toLine: definition.position?.end.line ?? 1,
          fromOp,
          toOp: ops.length,
          weight:
            footnotes[index].content.reduce(
              (sum, op) => sum + deltaOpWeight(op),
              0,
            ) + (index === 0 ? 1 : 0),
        }),
      );
  }
  return { ops };
}
export function parseGFMTable(source: string): TableEmbed | null {
  const node = markdownAST(source).children[0];
  return node?.type === "table"
    ? table(node, {
        source,
        definitions: new Map(),
        footnotes: new Map(),
        references: new Map(),
      })
    : null;
}
