import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Nodes } from "mdast";
import { markdownAST } from "../gfm-parser";
import { localMarkdownImageNode } from "./markdown-images";
import { localMarkdownLink, relativeMarkdownHref } from "./markdown-links";

export interface MarkdownLinkDestination {
  href: string;
  line: number;
  key: number;
  kind?: "image" | "shared";
  range?: { from: number; to: number };
}

/** Use the shared parser for meaning and only use verified syntax spans for writes. */
export function markdownLinkDestinations(source: string, includeImages = false): MarkdownLinkDestination[] {
  type Destination = Extract<Nodes, { type: "link" | "image" | "definition" }>;
  type Kind = NonNullable<MarkdownLinkDestination["kind"]> | "link";
  const definitions = new Map<string, Extract<Nodes, { type: "definition" }>>();
  const references = new Map<string, Kind>();
  const destinations: Array<{ node: Destination; kind: Kind }> = [];
  const visit = (node: Nodes) => {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    else if (node.type === "linkReference" || (includeImages && node.type === "imageReference")) {
      const kind = node.type === "imageReference" ? "image" : "link";
      const previous = references.get(node.identifier);
      references.set(node.identifier, previous && previous !== kind ? "shared" : kind);
    } else if (node.type === "link" || (includeImages && node.type === "image")) {
      destinations.push({ node, kind: node.type });
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(markdownAST(source));
  for (const [key, kind] of references) {
    const definition = definitions.get(key);
    if (definition) destinations.push({ node: definition, kind });
  }
  const tree = markdownLanguage.parser.parse(source);
  return destinations.flatMap(({ node: link, kind }) => {
    const { start, end } = link.position ?? {};
    if (start?.offset === undefined || end?.offset === undefined || !link.url) return [];
    const from = start.offset;
    const syntax = tree.resolveInner(from, 1);
    const syntaxName = { link: "Link", image: "Image", definition: "LinkReference" }[link.type];
    let range: MarkdownLinkDestination["range"];
    for (let node: typeof syntax | null = syntax; node; node = node.parent) {
      if (node.from !== from || node.to !== end.offset) continue;
      if (node.name !== syntaxName) continue;
      const url = node.getChild("URL");
      if (url) {
        const angle = source[url.from] === "<" && source[url.to - 1] === ">";
        range = { from: url.from + Number(angle), to: url.to - Number(angle) };
      }
      break;
    }
    return [{ href: link.url, line: start.line, key: from, ...(kind === "link" ? {} : { kind }), range }];
  }).sort((a, b) => a.key - b.key);
}

export type MarkdownPathMove = { from: string; to: string };
export interface MarkdownLinkEdit { link: MarkdownLinkDestination; href: string }

const movedPath = (path: string, from: string, to: string) =>
  path === from || path.startsWith(from + "/") ? to + path.slice(from.length) : path;
const forward = (path: string, moves: readonly MarkdownPathMove[]) =>
  moves.reduce((current, move) => movedPath(current, move.from, move.to), path);
const backward = (path: string, moves: readonly MarkdownPathMove[]) =>
  moves.reduceRight((current, move) => movedPath(current, move.to, move.from), path);

export function planMarkdownLinkEdits(source: string, node: string, moves: readonly MarkdownPathMove[]): MarkdownLinkEdit[] {
  const oldNode = backward(node, moves);
  return markdownLinkDestinations(source, true).flatMap(link => {
    if (!link.range || link.href.startsWith("#")) return [];
    const targetAt = (from: string) => {
      const image = link.kind ? localMarkdownImageNode(from, link.href) : null;
      return image ?? (link.kind === "image" ? null : localMarkdownLink(from, link.href).node);
    };
    try {
      const target = targetAt(oldNode);
      if (!target) return [];
      const next = forward(target, moves);
      // A move to another directory changes outgoing relative paths as well.
      if (next === target && oldNode.slice(0, oldNode.lastIndexOf("/") + 1) === node.slice(0, node.lastIndexOf("/") + 1)) return [];
      const current = (() => { try { return targetAt(node); } catch { return null; } })();
      if (current === next) return [];
      const suffix = link.href.slice(link.href.search(/[?#]|$/));
      return [{ link, href: relativeMarkdownHref(node, next) + suffix }];
    } catch { return []; }
  });
}

/** Replace only destination spans, preserving labels, titles and surrounding Markdown. */
export function applyMarkdownLinkEdits(source: string, changes: readonly MarkdownLinkEdit[]): string {
  let result = source;
  // In a clickable image, the outer link starts first but its URL appears last.
  for (const { link, href } of [...changes].sort((a, b) => (b.link.range?.from ?? b.link.key) - (a.link.range?.from ?? a.link.key))) {
    if (!link.range) throw new Error("无法安全识别此链接的原始范围");
    // Markdown destination delimiters inside file names must remain literal.
    const escaped = href.replace(/[()<>\\\s]/gu, character => encodeURIComponent(character).replace(/\(/g, "%28").replace(/\)/g, "%29"));
    result = result.slice(0, link.range.from) + escaped + result.slice(link.range.to);
  }
  return result;
}
