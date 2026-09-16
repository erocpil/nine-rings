import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  activeLinePluginKey,
  createActiveLinePlugin,
  createToolbarSelectionPlugin,
  toolbarSelectionPluginKey,
} from "../../src/extensions/EditorHighlights";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});
const makeState = () =>
  EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("first")),
      schema.node("paragraph", null, schema.text("second")),
    ]),
    plugins: [createActiveLinePlugin(), createToolbarSelectionPlugin()],
  });

describe("editor highlight state boundaries", () => {
  it("moves the active line with the selection without modifying the document", () => {
    let state = makeState();
    const doc = state.doc;
    expect(
      activeLinePluginKey
        .getState(state)
        ?.decorations.find()
        .map((d) => [d.from, d.to]),
    ).toEqual([[0, 7]]);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 8)),
    );
    expect(
      activeLinePluginKey
        .getState(state)
        ?.decorations.find()
        .map((d) => [d.from, d.to]),
    ).toEqual([[7, 15]]);
    expect(state.doc).toBe(doc);
  });

  it("maps a bookmark highlight through edits and clears it when its block is deleted", () => {
    let state = makeState();
    state = state.apply(
      state.tr.setMeta(activeLinePluginKey, { bookmarkJumpPosition: 7 }),
    );
    state = state.apply(state.tr.insertText("+", 1));
    expect(activeLinePluginKey.getState(state)?.bookmarkJumpPosition).toBe(8);
    expect(
      activeLinePluginKey
        .getState(state)
        ?.decorations.find()
        .some((d) => d.from === 8 && d.to === 16),
    ).toBe(true);
    state = state.apply(state.tr.delete(7, 16));
    expect(
      activeLinePluginKey.getState(state)?.bookmarkJumpPosition,
    ).toBeNull();
  });

  it("maps preserved toolbar selections and removes empty/deleted ranges", () => {
    let state = makeState();
    state = state.apply(
      state.tr.setMeta(toolbarSelectionPluginKey, {
        range: { from: 2, to: 5 },
      }),
    );
    state = state.apply(state.tr.insertText("+", 1));
    expect(toolbarSelectionPluginKey.getState(state)?.range).toEqual({
      from: 3,
      to: 6,
    });
    expect(
      toolbarSelectionPluginKey
        .getState(state)
        ?.decorations.find()
        .map((d) => [d.from, d.to]),
    ).toEqual([[3, 6]]);
    state = state.apply(state.tr.delete(3, 6));
    expect(toolbarSelectionPluginKey.getState(state)?.range).toBeNull();
    expect(
      toolbarSelectionPluginKey.getState(state)?.decorations.find(),
    ).toEqual([]);
  });

  it("clears toolbar feedback explicitly and never leaks state into another document", () => {
    let state = makeState();
    state = state.apply(
      state.tr.setMeta(toolbarSelectionPluginKey, {
        range: { from: 1, to: 5 },
      }),
    );
    state = state.apply(
      state.tr.setMeta(activeLinePluginKey, { bookmarkJumpPosition: 7 }),
    );
    const other = makeState();
    expect(toolbarSelectionPluginKey.getState(other)?.range).toBeNull();
    expect(
      activeLinePluginKey.getState(other)?.bookmarkJumpPosition,
    ).toBeNull();
    state = state.apply(
      state.tr.setMeta(toolbarSelectionPluginKey, { range: null }),
    );
    expect(
      toolbarSelectionPluginKey.getState(state)?.decorations.find(),
    ).toEqual([]);
    expect(activeLinePluginKey.getState(state)?.bookmarkJumpPosition).toBe(7);
  });
});
