import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import { blockWorkspacePreferences } from "../../src/lib/block-display-settings";
import {
  sourceMicroHighlighting,
  sourceMicroStyle,
  sourceMicroSyntax,
} from "../../src/lib/source-micro-rendering";

describe("source micro rendering", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds only display extensions and keeps parsed source intact", () => {
    const source =
      "# Heading\n\n- [ ] task\n\n> quote\n\n```text\n# literal\n```";
    const state = EditorState.create({
      doc: source,
      extensions: [
        markdown({ base: markdownLanguage, extensions: [sourceMicroSyntax] }),
        sourceMicroHighlighting,
      ],
    });
    const tree = ensureSyntaxTree(state, source.length, 100)!;
    expect(tree.toString()).toContain("ATXHeading1");
    expect(tree.toString()).toContain("FencedCode");
    expect(state.doc.toString()).toBe(source);
    const marks: string[] = [];
    highlightTree(tree, sourceMicroStyle, (from, to, classes) => {
      if (classes.includes("source-micro-marker"))
        marks.push(source.slice(from, to));
    });
    expect(marks).toContain("-");
    expect(marks).toContain(">");
    expect(marks.filter((mark) => mark === "```")).toHaveLength(2);
    // A heading-looking line inside a fence remains code, not a heading.
    expect(tree.resolveInner(source.indexOf("# literal") + 2).name).toBe(
      "CodeText",
    );
  });

  it("defaults off and rejects non-boolean stored switches", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
    });
    expect(blockWorkspacePreferences().sourceMicroRendering).toBeUndefined();
    values.set("nr:blockWorkspaceDisplay", '{"sourceMicroRendering":"true"}');
    expect(blockWorkspacePreferences().sourceMicroRendering).toBeUndefined();
    values.set("nr:blockWorkspaceDisplay", '{"sourceMicroRendering":true}');
    expect(blockWorkspacePreferences().sourceMicroRendering).toBe(true);
  });
});
