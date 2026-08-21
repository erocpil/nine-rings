import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SearchMatch {
  from: number;
  to: number;
}

interface TextSegment {
  text: string;
  from: number;
}

interface HighlightMeta {
  matches: SearchMatch[];
  activeIndex: number;
}

const searchHighlightsKey = new PluginKey<DecorationSet>("searchHighlights");

/**
 * Find case-insensitive literal matches while retaining ProseMirror positions.
 * Adjacent text nodes (for example, text split by a bold mark) are treated as
 * one run; structural gaps between blocks are kept as hard boundaries.
 */
export function findMatchesInTextSegments(segments: TextSegment[], query: string): SearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  let haystack = "";
  const positions: Array<number | null> = [];
  let previousEnd: number | null = null;

  for (const segment of segments) {
    if (!segment.text) continue;
    if (previousEnd !== null && segment.from !== previousEnd) {
      haystack += "\n";
      positions.push(null);
    }
    haystack += segment.text;
    for (let offset = 0; offset < segment.text.length; offset += 1) {
      positions.push(segment.from + offset);
    }
    previousEnd = segment.from + segment.text.length;
  }

  const lowered = haystack.toLocaleLowerCase();
  const matches: SearchMatch[] = [];
  let start = 0;
  while (start <= lowered.length - needle.length) {
    const index = lowered.indexOf(needle, start);
    if (index === -1) break;
    const from = positions[index];
    const last = positions[index + needle.length - 1];
    if (from !== null && from !== undefined && last !== null && last !== undefined) {
      matches.push({ from, to: last + 1 });
    }
    start = index + Math.max(1, needle.length);
  }
  return matches;
}

export function findSearchMatches(doc: ProseMirrorNode, query: string): SearchMatch[] {
  const segments: TextSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) segments.push({ text: node.text, from: pos });
  });
  return findMatchesInTextSegments(segments, query);
}

/** Resolve the first navigation target relative to the editor caret. */
export function searchMatchIndexFromPosition(
  matches: SearchMatch[],
  position: number,
  direction: number,
): number {
  if (matches.length === 0) return -1;
  if (direction < 0) {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (matches[index].from < position) return index;
    }
    return matches.length - 1;
  }
  const index = matches.findIndex((match) => match.to > position);
  return index >= 0 ? index : 0;
}

function decorationsFor(doc: ProseMirrorNode, meta: HighlightMeta): DecorationSet {
  const decorations = meta.matches.map((match, index) => Decoration.inline(
    match.from,
    match.to,
    { class: index === meta.activeIndex ? "search-match search-match-active" : "search-match" },
  ));
  return DecorationSet.create(doc, decorations);
}

export const SearchHighlights = Extension.create({
  name: "searchHighlights",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchHighlightsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, current) {
            const meta = tr.getMeta(searchHighlightsKey) as HighlightMeta | undefined;
            if (meta) return decorationsFor(tr.doc, meta);
            return tr.docChanged ? DecorationSet.empty : current.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return searchHighlightsKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export function setSearchHighlights(editor: Editor, matches: SearchMatch[], activeIndex: number): void {
  editor.view.dispatch(editor.state.tr.setMeta(searchHighlightsKey, { matches, activeIndex } satisfies HighlightMeta));
}
