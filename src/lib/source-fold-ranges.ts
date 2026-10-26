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
import type { SourceFoldConnectorOpacity, SourceFoldConnectorStyle, SourceFoldConnectorWidth } from "./block-display-settings";

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
    readonly key: string,
    readonly depth: number,
    readonly markerDOM: (kind: MarkerKind) => HTMLElement,
  ) { super(); }

  eq(other: SourceFoldMarker): boolean {
    return other.kind === this.kind && other.key === this.key
      && other.depth === this.depth && other.markerDOM === this.markerDOM;
  }

  toDOM(): HTMLElement {
    const dom = this.markerDOM(this.kind);
    if (this.key) dom.dataset.foldRange = this.key;
    dom.dataset.foldDepth = String(this.depth % 6);
    dom.dataset.foldKind = this.kind;
    return dom;
  }
}

function foldMarkerFromEvent(event: Event): HTMLElement | null {
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-fold-range]")
    : null;
}

function clearFoldConnector(view: EditorView): void {
  view.dom.querySelector(".source-fold-connector")?.remove();
  for (const marker of view.dom.querySelectorAll<HTMLElement>("[data-fold-range].is-fold-pair-hovered"))
    marker.classList.remove("is-fold-pair-hovered");
}

interface SourceFoldConnectorConfig {
  style: SourceFoldConnectorStyle;
  width: SourceFoldConnectorWidth;
  opacity: SourceFoldConnectorOpacity;
}

function showFoldConnector(view: EditorView, marker: HTMLElement, config: SourceFoldConnectorConfig): void {
  clearFoldConnector(view);
  const key = marker.dataset.foldRange;
  if (!key) return;
  const pair = [...view.dom.querySelectorAll<HTMLElement>("[data-fold-range]")]
    .filter(candidate => candidate.dataset.foldRange === key);
  for (const candidate of pair) candidate.classList.add("is-fold-pair-hovered");
  if (config.style === "none") return;
  const gutter = marker.closest<HTMLElement>(".cm-foldGutter");
  if (!gutter) return;
  const [fromText, toText] = key.split(":");
  const from = Number(fromText), to = Number(toText);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return;
  const gutterRect = gutter.getBoundingClientRect();
  const visibleTop = Math.max(gutterRect.top, view.scrollDOM.getBoundingClientRect().top);
  const visibleBottom = Math.min(gutterRect.bottom, view.scrollDOM.getBoundingClientRect().bottom);
  const centerAt = (position: number, kind: MarkerKind) => {
    const mounted = pair.find(candidate => candidate.dataset.foldKind === kind);
    if (mounted) {
      const rect = mounted.getBoundingClientRect();
      return rect.top + rect.height / 2;
    }
    const line = view.state.doc.lineAt(position);
    return view.documentTop + view.lineBlockAt(line.from).top + view.defaultLineHeight / 2;
  };
  const firstCenter = Math.max(visibleTop, Math.min(centerAt(from, "expanded"), visibleBottom));
  const lastCenter = Math.max(visibleTop, Math.min(centerAt(to, "end"), visibleBottom));
  if (Math.abs(lastCenter - firstCenter) < 1) return;
  const connector = document.createElement("div");
  connector.className = "source-fold-connector";
  connector.dataset.connectorStyle = config.style;
  connector.dataset.foldDepth = marker.dataset.foldDepth ?? "0";
  connector.style.setProperty("--source-fold-connector-width", `${config.width}px`);
  connector.style.setProperty("--source-fold-connector-opacity", String(config.opacity / 100));
  const markerRect = marker.getBoundingClientRect();
  connector.style.left = `${markerRect.left + markerRect.width / 2 - gutterRect.left}px`;
  connector.style.top = `${Math.min(firstCenter, lastCenter) - gutterRect.top}px`;
  connector.style.height = `${Math.abs(lastCenter - firstCenter)}px`;
  gutter.appendChild(connector);
}

/** A fold gutter that also marks the closing line of every expanded region. */
export function sourceFoldGutter(
  markerDOM: (kind: MarkerKind) => HTMLElement,
  connectorConfig: SourceFoldConnectorConfig,
) {
  const markers = ViewPlugin.fromClass(class {
    markers: RangeSet<GutterMarker> = RangeSet.empty;
    readonly clearOnScroll: () => void;

    constructor(readonly view: EditorView) {
      this.clearOnScroll = () => clearFoldConnector(view);
      view.scrollDOM.addEventListener("scroll", this.clearOnScroll, { passive: true });
      this.markers = this.build(view);
    }

    destroy() { this.view.scrollDOM.removeEventListener("scroll", this.clearOnScroll); }

    update(update: ViewUpdate) {
      const foldsChanged = foldedRanges(update.startState) !== foldedRanges(update.state);
      if (update.docChanged || update.viewportChanged || foldsChanged)
        clearFoldConnector(update.view);
      if (update.docChanged
        || update.startState.facet(language) !== update.state.facet(language)
        || syntaxTree(update.startState) !== syntaxTree(update.state)
        || foldsChanged) this.markers = this.build(update.view);
    }

    build(view: EditorView): RangeSet<GutterMarker> {
      const builder = new RangeSetBuilder<GutterMarker>();
      const entries: Array<{ position: number; marker: GutterMarker }> = [];
      const ranges: Array<SourceFoldRange & { lineFrom: number; collapsed: boolean; depth: number }> = [];
      const folded = foldedRanges(view.state);
      for (let number = 1; number <= view.state.doc.lines; number += 1) {
        const line = view.state.doc.line(number);
        const range = foldable(view.state, line.from, line.to);
        if (!range) continue;
        let collapsed = false;
        folded.between(range.from, range.from, (from, to) => {
          if (from === range.from && to === range.to) collapsed = true;
        });
        ranges.push({ ...range, lineFrom: line.from, collapsed, depth: 0 });
      }
      ranges.sort((a, b) => a.from - b.from || b.to - a.to);
      const stack: typeof ranges = [];
      for (const range of ranges) {
        while (stack.length && range.from >= stack[stack.length - 1]!.to) stack.pop();
        range.depth = stack.length;
        stack.push(range);
        const key = `${range.from}:${range.to}`;
        entries.push({ position: range.lineFrom, marker: new SourceFoldMarker(range.collapsed ? "collapsed" : "expanded", key, range.depth, markerDOM) });
        if (!range.collapsed) {
          const end = view.state.doc.lineAt(range.to).from;
          if (end !== range.lineFrom) entries.push({ position: end, marker: new SourceFoldMarker("end", key, range.depth, markerDOM) });
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
      initialSpacer: () => new SourceFoldMarker("collapsed", "", 0, markerDOM),
      domEventHandlers: {
        mouseover(view, _line, event) {
          const marker = foldMarkerFromEvent(event);
          if (!marker) return false;
          const previous = event instanceof MouseEvent && event.relatedTarget instanceof Element
            ? event.relatedTarget.closest<HTMLElement>("[data-fold-range]") : null;
          if (previous?.dataset.foldRange !== marker.dataset.foldRange) showFoldConnector(view, marker, connectorConfig);
          return false;
        },
        mouseout(view, _line, event) {
          const marker = foldMarkerFromEvent(event);
          if (!marker) return false;
          const next = event instanceof MouseEvent && event.relatedTarget instanceof Element
            ? event.relatedTarget.closest<HTMLElement>("[data-fold-range]") : null;
          if (next?.dataset.foldRange !== marker.dataset.foldRange) clearFoldConnector(view);
          return false;
        },
        click(view, line) {
          clearFoldConnector(view);
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
