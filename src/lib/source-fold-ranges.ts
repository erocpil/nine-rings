import { RangeSet, RangeSetBuilder, type EditorState } from "@codemirror/state";
import { GutterMarker, ViewPlugin, gutter, type EditorView, type ViewUpdate } from "@codemirror/view";
import {
  codeFolding,
  foldEffect,
  foldable,
  foldedRanges,
  language,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";

export interface SourceFoldRange { from: number; to: number }

/** Foldable regions containing a line, ordered from outermost to innermost. */
export function sourceFoldRangesAtLine(state: EditorState, lineNumber: number): SourceFoldRange[] {
  const target = state.doc.line(lineNumber);
  const ranges = new Map<string, SourceFoldRange>();
  for (let number = 1; number <= lineNumber; number += 1) {
    const line = state.doc.line(number);
    const range = foldable(state, line.from, line.to);
    if (!range) continue;
    const endLine = state.doc.lineAt(range.to);
    if (endLine.number < lineNumber || target.to < range.from) continue;
    ranges.set(`${range.from}:${range.to}`, range);
  }
  return [...ranges.values()].sort((a, b) => a.from - b.from || b.to - a.to);
}

export function sourceFoldRangeIsFolded(state: EditorState, range: SourceFoldRange): boolean {
  let folded = false;
  foldedRanges(state).between(range.from, range.from, (from, to) => {
    if (from === range.from && to === range.to) folded = true;
  });
  return folded;
}

export function foldSourceRange(view: EditorView, range: SourceFoldRange): void {
  if (!sourceFoldRangeIsFolded(view.state, range)) view.dispatch({ effects: foldEffect.of(range) });
}

export function jumpToSourceFoldBoundary(view: EditorView, range: SourceFoldRange, boundary: "start" | "end"): void {
  const position = boundary === "start"
    ? view.state.doc.lineAt(range.from).from
    : view.state.doc.lineAt(range.to).from;
  view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
}

type MarkerKind = "expanded" | "collapsed" | "end";

class SourceFoldMarker extends GutterMarker {
  constructor(
    readonly kind: MarkerKind,
    readonly markerDOM: (kind: MarkerKind) => HTMLElement,
  ) { super(); }

  eq(other: SourceFoldMarker): boolean {
    return other.kind === this.kind && other.markerDOM === this.markerDOM;
  }

  toDOM(): HTMLElement { return this.markerDOM(this.kind); }
}

/** A fold gutter that also marks the closing line of every expanded region. */
export function sourceFoldGutter(markerDOM: (kind: MarkerKind) => HTMLElement) {
  const markers = ViewPlugin.fromClass(class {
    markers: RangeSet<GutterMarker> = RangeSet.empty;

    constructor(view: EditorView) { this.markers = this.build(view); }

    update(update: ViewUpdate) {
      if (update.docChanged
        || update.startState.facet(language) !== update.state.facet(language)
        || syntaxTree(update.startState) !== syntaxTree(update.state)
        || foldedRanges(update.startState) !== foldedRanges(update.state)) this.markers = this.build(update.view);
    }

    build(view: EditorView): RangeSet<GutterMarker> {
      const builder = new RangeSetBuilder<GutterMarker>();
      const entries: Array<{ position: number; marker: GutterMarker }> = [];
      const folded = foldedRanges(view.state);
      for (let number = 1; number <= view.state.doc.lines; number += 1) {
        const line = view.state.doc.line(number);
        const range = foldable(view.state, line.from, line.to);
        if (!range) continue;
        let collapsed = false;
        folded.between(range.from, range.from, (from, to) => {
          if (from === range.from && to === range.to) collapsed = true;
        });
        entries.push({ position: line.from, marker: new SourceFoldMarker(collapsed ? "collapsed" : "expanded", markerDOM) });
        if (!collapsed) {
          const end = view.state.doc.lineAt(range.to).from;
          if (end !== line.from) entries.push({ position: end, marker: new SourceFoldMarker("end", markerDOM) });
        }
      }
      entries.sort((a, b) => a.position - b.position || (a.marker as SourceFoldMarker).kind.localeCompare((b.marker as SourceFoldMarker).kind));
      let last = -1;
      for (const entry of entries) {
        // Nested regions can share a closing line. One end control still folds
        // the innermost region, matching the line-menu meaning of “nearest”.
        if (entry.position === last) continue;
        builder.add(entry.position, entry.position, entry.marker);
        last = entry.position;
      }
      return builder.finish();
    }
  });

  return [
    markers,
    gutter({
      class: "cm-foldGutter",
      markers: view => view.plugin(markers)?.markers ?? RangeSet.empty,
      initialSpacer: () => new SourceFoldMarker("collapsed", markerDOM),
      domEventHandlers: {
        click(view, line) {
          let existing: SourceFoldRange | null = null;
          foldedRanges(view.state).between(line.from, line.to, (from, to) => {
            if (!existing && view.state.doc.lineAt(from).from === line.from) existing = { from, to };
          });
          if (existing) {
            view.dispatch({ effects: unfoldEffect.of(existing) });
            return true;
          }
          const opening = foldable(view.state, line.from, line.to);
          if (opening) {
            view.dispatch({ effects: foldEffect.of(opening) });
            return true;
          }
          const containing = sourceFoldRangesAtLine(view.state, view.state.doc.lineAt(line.from).number);
          const endings = containing.filter(range => view.state.doc.lineAt(range.to).from === line.from);
          const ending = endings[endings.length - 1];
          if (!ending) return false;
          view.dispatch({ effects: foldEffect.of(ending) });
          return true;
        },
      },
    }),
    codeFolding(),
  ];
}
