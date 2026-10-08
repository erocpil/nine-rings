import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findTextMatches, type SearchOptions, type TextMatch } from "../lib/search-matching";

export type SearchMatch = TextMatch;

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
 * Find literal or Perl-compatible matches while retaining ProseMirror positions.
 * Adjacent text nodes (for example, text split by a bold mark) are treated as
 * one run; structural gaps between blocks are kept as hard boundaries.
 */
export function findMatchesInTextSegments(segments: TextSegment[], query: string, preserveWhitespace = false, caseSensitive = false, options: SearchOptions = {}): SearchMatch[] {
  const needle = preserveWhitespace || options.regex ? query : query.trim();
  if (!needle) return [];
  const runs: TextSegment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const previous = runs[runs.length - 1];
    if (previous && previous.from + previous.text.length === segment.from) previous.text += segment.text;
    else runs.push({ ...segment });
  }
  // Both engines retain original UTF-16 positions across inline marks.
  const matches: SearchMatch[] = [];
  for (const run of runs) {
    matches.push(...findTextMatches(run.text, needle, { ...options, caseSensitive }).map(match => ({ ...match, from: run.from + match.from, to: run.from + match.to })));
  }
  return matches;
}

export function findSearchMatches(doc: ProseMirrorNode, query: string, preserveWhitespace = false, caseSensitive = false, options: SearchOptions = {}): SearchMatch[] {
  const segments: TextSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) segments.push({ text: node.text, from: pos });
  });
  return findMatchesInTextSegments(segments, query, preserveWhitespace, caseSensitive, options);
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
