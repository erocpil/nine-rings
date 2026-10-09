import { describe, expect, it } from "vitest";
import {
  headingLinkMap,
  headingSlug,
  outlineLabel,
  tocLevels,
} from "../../src/lib/heading-links";
import {
  editorAppearanceVariables,
  blockFontFamily,
  customFontSize,
} from "../../src/lib/editor-appearance";
import { DEFAULT_CONFIG } from "../../src/lib/storage/types";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";

describe("heading navigation and automatic TOC", () => {
  it("round-trips dynamic TOC configuration without saving generated entries", () => {
    const markdown = "```toc\nlevels: 2,4,6\n```\n\n## 原始标题";
    const document = deltaToProseMirror(mdToDelta(markdown));
    const serialized = deltaToMarkdown(proseMirrorToDelta(document));
    expect(serialized).toContain("```toc\nlevels: 2,4,6\n```");
    expect(serialized).toContain("## 原始标题");
    expect(serialized).not.toContain("nr-heading");
  });
  it("keeps Chinese and inline-code text, strips punctuation and numbers duplicate anchors", () => {
    expect(headingSlug("  3. 网卡接收、RX ring 与 DMA  ")).toBe(
      "3-网卡接收rx-ring-与-dma",
    );
    expect(headingSlug("A  B\tC")).toBe("a--bc");
    const items = ["相同", "相同", "相同-1", "相同"].map((text, pos) => ({
      text,
      pos,
      level: 2,
    }));
    expect([...headingLinkMap(items).keys()]).toEqual([
      "相同",
      "相同-1",
      "相同-1-1",
      "相同-2",
    ]);
    expect(headingLinkMap(items)).toBe(headingLinkMap(items));
  });
  it("limits display without changing full headings or jump identifiers", () => {
    const text = "😀".repeat(200);
    expect(outlineLabel(text)).toBe("😀".repeat(80) + "…");
    const item = { text, pos: 90, level: 1 };
    expect([...headingLinkMap([item]).values()][0].text).toBe(text);
    expect(outlineLabel("短标题")).toBe("短标题");
  });
  it("defaults to H1–H3 and parses independent level selections safely", () => {
    expect(tocLevels("")).toEqual([1, 2, 3]);
    expect(tocLevels("levels: 6,2,2,4")).toEqual([2, 4, 6]);
    expect(tocLevels("levels: 0,9")).toEqual([1, 2, 3]);
  });
});

describe("block typography overrides", () => {
  it("leaves all existing defaults to the style rather than freezing pixel sizes", () => {
    const variables = editorAppearanceVariables(DEFAULT_CONFIG);
    expect(variables["--editor-h1-size"]).toBeUndefined();
    expect(variables["--editor-code-font-family"]).toBeUndefined();
    expect(variables["--editor-code-font-size"]).toBeUndefined();
    expect(blockFontFamily("default")).toBeUndefined();
    expect(blockFontFamily("monospace")).toContain("monospace");
  });
  it("validates config values and emits independent heading and block overrides", () => {
    const variables = editorAppearanceVariables({
      editor_h1_font_size: 40,
      editor_h6_font_size: 18,
      editor_code_font_family: "monospace",
      editor_code_font_size: 20,
      editor_quote_font_family: "serif",
    });
    expect(variables["--editor-h1-size"]).toBe("40px");
    expect(variables["--editor-h6-size"]).toBe("18px");
    expect(variables["--editor-code-font-size"]).toBe("20px");
    expect(variables["--editor-quote-font-family"]).toContain("serif");
    expect(customFontSize(Infinity)).toBeUndefined();
    expect(customFontSize(-3)).toBeUndefined();
    expect(customFontSize(100)).toBe(72);
    expect(blockFontFamily("url(bad)")).toBeUndefined();
  });
});
