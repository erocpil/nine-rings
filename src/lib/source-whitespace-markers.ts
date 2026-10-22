import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { whitespaceTokens } from "./whitespace-markers";

const spaceMarker = Decoration.mark({ class: "cm-source-whitespace-space" });
const tabMarker = Decoration.mark({ class: "cm-source-whitespace-tab" });

class EndOfLineMarker extends WidgetType {
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-source-whitespace-eol";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = "↵";
    return marker;
  }

  ignoreEvent() {
    return true;
  }
}

const endOfLineMarker = Decoration.widget({
  widget: new EndOfLineMarker(),
  side: 1,
});

function markersForVisibleLines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLine = 0;
  for (const range of view.visibleRanges) {
    let line = view.state.doc.lineAt(range.from);
    while (line.from <= range.to && line.number !== lastLine) {
      lastLine = line.number;
      for (const token of whitespaceTokens(line.text, "all")) {
        if (token.kind === "newline") continue;
        const from = line.from + token.offset;
        builder.add(from, from + 1, token.kind === "space" ? spaceMarker : tabMarker);
      }
      builder.add(line.to, line.to, endOfLineMarker);
      if (line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

/** Displays list-mode markers only for visible source lines; source text is untouched. */
export const sourceWhitespaceMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = markersForVisibleLines(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.decorations = markersForVisibleLines(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
