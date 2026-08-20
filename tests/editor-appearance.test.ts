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

const custom = editorAppearanceVariables({
  note_font_size: 20,
  editor_font_family: "serif",
  editor_line_height: 1.8,
  editor_paragraph_indent: 2,
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

const guarded = editorAppearanceVariables({
  note_font_size: 200,
  editor_line_height: 0,
  editor_list_indent: -5,
  editor_search_highlight_color: "red; color: transparent",
});
assert.equal(guarded["--editor-font-size"], "32px");
assert.equal(guarded["--editor-line-height"], "1.2");
assert.equal(guarded["--editor-list-indent"], "1em");
assert.equal(guarded["--editor-search-highlight"], "#ffd54f");

assert.equal(editorGutterWidth(0, false), 24);
assert.equal(editorGutterWidth(999, true), 44);
assert.equal(editorGutterWidth(1_000, true), 52);
assert.equal(editorGutterWidth(10_000, true), 60);

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
