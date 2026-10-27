import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_FOLD_ICONS,
  editorFoldSymbol,
  EDITOR_FOLD_PRESETS,
  editorFoldPreset,
  editorFoldPresetPatch,
  outlineFoldStyle,
  outlineFoldSymbol,
  scopedFoldOverridePatch,
  scopedFoldPreset,
  scopedFoldSymbolConfig,
} from "../../src/lib/editor-fold-icons";

describe("editor fold icons", () => {
  it("shares paired presets through the existing system configuration", () => {
    for (const preset of EDITOR_FOLD_PRESETS) {
      const config = {
        ...DEFAULT_EDITOR_FOLD_ICONS,
        ...editorFoldPresetPatch(preset.id),
      };
      expect(editorFoldPreset(config)).toBe(preset.id);
      if (preset.style === "custom") {
        expect(editorFoldSymbol(config, false)).toBe(preset.collapsed);
        expect(editorFoldSymbol(config, true)).toBe(preset.expanded);
      }
    }
  });
  it("chapter outlines default to triangles without changing body folding", () => {
    for (const config of [null, {}, DEFAULT_EDITOR_FOLD_ICONS]) {
      expect(outlineFoldStyle(config)).toBe("triangle");
      expect(outlineFoldSymbol(config, false)).toBe("▶");
      expect(outlineFoldSymbol(config, true)).toBe("▼");
      expect(editorFoldSymbol(config, true)).toBeNull();
    }
  });
  it("legacy custom symbols remain inherited and outline overrides are independent", () => {
    const custom = {
      ...DEFAULT_EDITOR_FOLD_ICONS,
      editor_fold_icon_style: "custom" as const,
      editor_fold_icon_collapsed: "+",
      editor_fold_icon_expanded: "−",
    };
    expect(outlineFoldStyle(custom)).toBe("inherit");
    expect(outlineFoldSymbol(custom, false)).toBe("+");
    expect(outlineFoldSymbol(custom, true)).toBe("−");
    expect(
      outlineFoldSymbol(
        { ...custom, editor_outline_fold_icon_style: "triangle" },
        true,
      ),
    ).toBe("▼");
    expect(
      outlineFoldSymbol(
        { ...custom, editor_outline_fold_icon_style: "chevron" },
        true,
      ),
    ).toBeNull();
    expect(
      outlineFoldSymbol(
        {
          ...DEFAULT_EDITOR_FOLD_ICONS,
          editor_outline_fold_icon_style: "inherit",
        },
        true,
      ),
    ).toBeNull();
    expect(
      editorFoldSymbol(
        { ...custom, editor_outline_fold_icon_style: "triangle" },
        true,
      ),
    ).toBe("−");
  });
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

  it("allows heading, block, and outline symbols to override the shared preset independently", () => {
    const config = {
      ...DEFAULT_EDITOR_FOLD_ICONS,
      editor_fold_icon_style: "custom" as const,
      editor_fold_icon_collapsed: "+",
      editor_fold_icon_expanded: "−",
      editor_fold_icon_overrides: {
        heading: { style: "custom" as const, collapsed: "→", expanded: "↓" },
        block: { style: "custom" as const, collapsed: "›", expanded: "⌄" },
        outline: { style: "custom" as const, collapsed: "<", expanded: ">" },
      },
    };
    expect(editorFoldSymbol(scopedFoldSymbolConfig(config, "heading"), false)).toBe("→");
    expect(editorFoldSymbol(scopedFoldSymbolConfig(config, "heading"), true)).toBe("↓");
    expect(editorFoldSymbol(scopedFoldSymbolConfig(config, "block"), false)).toBe("›");
    expect(editorFoldSymbol(scopedFoldSymbolConfig(config, "block"), true)).toBe("⌄");
    expect(outlineFoldSymbol(config, false)).toBe("<");
    expect(outlineFoldSymbol(config, true)).toBe(">");
    expect(scopedFoldPreset(config, "heading")).toBe("right-down-arrows");
    expect(scopedFoldPreset(config, "block")).toBe("angle-down");
    expect(scopedFoldPreset(config, "outline")).toBe("custom");

    const following = {
      ...config,
      editor_fold_icon_overrides: scopedFoldOverridePatch(config, "heading", "inherit"),
    };
    expect(editorFoldSymbol(scopedFoldSymbolConfig(following, "heading"), false)).toBe("+");
    expect(editorFoldSymbol(scopedFoldSymbolConfig(following, "heading"), true)).toBe("−");
    expect(editorFoldSymbol(scopedFoldSymbolConfig(config, "block"), false)).toBe("›");
  });
});
