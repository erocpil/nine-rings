import assert from "node:assert/strict";
import { editorAppearanceVariables } from "../src/lib/editor-appearance";
import { editorGutterWidth } from "../src/lib/editor-gutter";
import {
  MAX_CJK_FALLBACK_DOCUMENT_SIZE,
  needsCjkLatinSpacing,
  shouldApplyCjkSpacingFallback,
} from "../src/extensions/CjkLatinSpacing";

const defaults = editorAppearanceVariables();
assert.equal(defaults["--editor-font-size"], "16px");
assert.equal(defaults["--editor-list-indent"], "1.25em");
assert.equal(defaults["--editor-search-highlight"], "#ffd54f");
assert.equal(defaults["--editor-heading-margin-top"], "0.7em");
assert.equal(defaults["--editor-heading-margin-bottom"], "0.35em");
assert.equal(defaults["--editor-block-spacing"], "1em");
assert.equal(defaults["--editor-list-margin-top"], "0.25em");
assert.equal(defaults["--editor-list-margin-bottom"], "0.25em");

const custom = editorAppearanceVariables({
  note_font_size: 20,
  editor_font_family: "serif",
  editor_line_height: 1.8,
  editor_block_spacing: 1.4,
  editor_paragraph_indent: 2,
  editor_heading_margin_top: 1.25,
  editor_heading_margin_bottom: 0.45,
  editor_list_margin_top: 0.8,
  editor_list_margin_bottom: 0.4,
  editor_list_indent: 1.1,
  editor_list_marker_gap: 0.15,
  editor_blockquote_indent: 20,
  editor_search_highlight_color: "#12ABef",
});
assert.equal(custom["--editor-font-size"], "20px");
assert.match(custom["--editor-font-family"], /SimSun/);
assert.equal(custom["--editor-line-height"], "1.8");
assert.equal(custom["--editor-list-marker-gap"], "0.15em");
assert.equal(custom["--editor-search-highlight"], "#12ABef");
assert.equal(custom["--editor-heading-margin-top"], "1.25em");
assert.equal(custom["--editor-heading-margin-bottom"], "0.45em");
assert.equal(custom["--editor-block-spacing"], "1.4em");
assert.equal(custom["--editor-list-margin-top"], "0.8em");
assert.equal(custom["--editor-list-margin-bottom"], "0.4em");

const guarded = editorAppearanceVariables({
  note_font_size: 200,
  editor_line_height: 0,
  editor_block_spacing: 8,
  editor_list_indent: -5,
  editor_heading_margin_top: 12,
  editor_heading_margin_bottom: -1,
  editor_list_margin_top: 12,
  editor_list_margin_bottom: -1,
  editor_search_highlight_color: "red; color: transparent",
});
assert.equal(guarded["--editor-font-size"], "32px");
assert.equal(guarded["--editor-line-height"], "1.2");
assert.equal(guarded["--editor-list-indent"], "1em");
assert.equal(guarded["--editor-heading-margin-top"], "2em");
assert.equal(guarded["--editor-block-spacing"], "3em");
assert.equal(guarded["--editor-heading-margin-bottom"], "0em");
assert.equal(guarded["--editor-list-margin-top"], "2em");
assert.equal(guarded["--editor-list-margin-bottom"], "0em");
assert.equal(guarded["--editor-search-highlight"], "#ffd54f");

assert.equal(editorGutterWidth(0, false), 24);
assert.equal(editorGutterWidth(9, true), 26);
assert.equal(editorGutterWidth(99, true), 34);
assert.equal(editorGutterWidth(999, true), 42);
assert.equal(editorGutterWidth(1_000, true), 50);
assert.equal(editorGutterWidth(10_000, true), 58);
assert.equal(editorGutterWidth(0, false, true), 14);
assert.equal(editorGutterWidth(9, true, true), 28);
assert.equal(editorGutterWidth(99, true, true), 30);
assert.equal(editorGutterWidth(999, true, true), 36);
assert.equal(editorGutterWidth(1_000, true, true), 42);

assert.equal(needsCjkLatinSpacing("中", "A"), true);
assert.equal(needsCjkLatinSpacing("A", "文"), true);
assert.equal(needsCjkLatinSpacing("第", "3"), true);
assert.equal(needsCjkLatinSpacing("3", "章"), true);
assert.equal(needsCjkLatinSpacing("x", "，"), false);
assert.equal(needsCjkLatinSpacing("，", "中"), false);
assert.equal(needsCjkLatinSpacing("A", "B"), false);
assert.equal(needsCjkLatinSpacing("中", "文"), false);
assert.equal(shouldApplyCjkSpacingFallback(MAX_CJK_FALLBACK_DOCUMENT_SIZE), true);
assert.equal(shouldApplyCjkSpacingFallback(MAX_CJK_FALLBACK_DOCUMENT_SIZE + 1), false);

console.log("Editor appearance variables passed");
