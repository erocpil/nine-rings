import { expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { extractHeadingSections } from "../../src/lib/heading-fold";
import {
  HeadingFold,
  getCollapsedHeadingPositions,
  getHiddenHeadingFoldBlockPositions,
  headingFoldPluginKey,
} from "../../src/extensions/HeadingFold";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: {},
    paragraph: { content: "text*", group: "block" },
    heading: {
      content: "text*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
  },
});
const heading = (level: number, text: string) =>
  schema.node("heading", { level }, schema.text(text));
const paragraph = (text: string) =>
  schema.node("paragraph", null, schema.text(text));

it("all six heading levels, skipped levels and siblings retain exact section boundaries", () => {
  const levels = [1, 3, 6, 5, 3, 2, 6, 1, 4, 4, 2, 1];
  const doc = schema.node(
    "doc",
    null,
    levels.map((level, index) => heading(level, `section ${index}`)),
  );
  const sections = extractHeadingSections(doc);
  const ends = [7, 4, 3, 4, 5, 7, 7, 11, 9, 10, 11, 12];
  expect(sections.map((section) => section.end)).toEqual(
    ends.map((index) => sections[index]?.pos ?? doc.content.size),
  );
  expect(sections[2].ancestorKeys).toEqual([sections[0].key, sections[1].key]);
  expect(sections[7].ancestorKeys).toEqual([]);
});

it("fold geometry is reused on selection changes and invalidated by edits and unfold", () => {
  const plugins = HeadingFold.config.addProseMirrorPlugins!.call({
    options: { initialCollapsedKeys: [] },
  } as never);
  const doc = schema.node("doc", null, [
    heading(1, "First"),
    paragraph("body"),
    heading(1, "Second"),
    paragraph("tail"),
  ]);
  let state = EditorState.create({ doc, plugins });
  const editor = {
    get state() {
      return state;
    },
  } as Editor;
  const first = extractHeadingSections(doc)[0];
  state = state.apply(
    state.tr.setMeta(headingFoldPluginKey, { type: "set", keys: [first.key] }),
  );
  const hidden = getHiddenHeadingFoldBlockPositions(editor);
  const headings = getCollapsedHeadingPositions(editor);
  expect([...hidden]).toEqual([first.headingEnd]);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 2)),
  );
  expect(getHiddenHeadingFoldBlockPositions(editor)).toBe(hidden);
  expect(getCollapsedHeadingPositions(editor)).toBe(headings);
  state = state.apply(state.tr.insert(0, paragraph("inserted")));
  expect([...getCollapsedHeadingPositions(editor)]).toEqual([
    schema.node("paragraph", null, schema.text("inserted")).nodeSize,
  ]);
  expect([...getHiddenHeadingFoldBlockPositions(editor)]).toEqual([
    first.headingEnd + "inserted".length + 2,
  ]);
  state = state.apply(
    state.tr.setMeta(headingFoldPluginKey, { type: "set", keys: [] }),
  );
  expect(getHiddenHeadingFoldBlockPositions(editor).size).toBe(0);
  expect(getCollapsedHeadingPositions(editor).size).toBe(0);
});
