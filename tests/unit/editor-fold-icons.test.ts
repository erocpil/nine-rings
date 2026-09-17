import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_FOLD_ICONS,
  editorFoldSymbol,
} from "../../src/lib/editor-fold-icons";

describe("editor fold icons", () => {
  it("old and default configurations use chevrons", () => {
    expect(editorFoldSymbol(null, true)).toBeNull();
    expect(editorFoldSymbol({}, false)).toBeNull();
    expect(editorFoldSymbol(DEFAULT_EDITOR_FOLD_ICONS, true)).toBeNull();
  });
  it("triangle preset uses the original state symbols", () => {
    expect(
      editorFoldSymbol({ editor_fold_icon_style: "triangle" }, false),
    ).toBe("▶");
    expect(editorFoldSymbol({ editor_fold_icon_style: "triangle" }, true)).toBe(
      "▼",
    );
  });
  it("custom symbols are independent, bounded plain text with safe fallbacks", () => {
    const config = {
      ...DEFAULT_EDITOR_FOLD_ICONS,
      editor_fold_icon_style: "custom" as const,
      editor_fold_icon_collapsed: "+",
      editor_fold_icon_expanded: "−",
    };
    expect(editorFoldSymbol(config, false)).toBe("+");
    expect(editorFoldSymbol(config, true)).toBe("−");
    expect(
      editorFoldSymbol(
        { ...config, editor_fold_icon_collapsed: "\n\t " },
        false,
      ),
    ).toBe("▶");
    expect(
      editorFoldSymbol(
        { ...config, editor_fold_icon_expanded: "🔽123456" },
        true,
      ),
    ).toBe("🔽123");
    expect(
      editorFoldSymbol({ ...config, editor_fold_icon_expanded: "<b>" }, true),
    ).toBe("<b>");
  });
});
