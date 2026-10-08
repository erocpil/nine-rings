import { expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import {
  flowBlockAttributes,
  flowHeadingLevel,
} from "../../src/lib/flow-presentation";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: {},
    paragraph: { group: "block", content: "text*" },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 2 } },
    },
    footnotes: { group: "block", content: "paragraph+" },
  },
});
const p = () => schema.node("paragraph", null, schema.text("body"));
const h = (level: number) =>
  schema.node("heading", { level }, schema.text("stage"));
it("presentation defaults to ordinary and validates all six heading levels", () => {
  expect(flowHeadingLevel()).toBe(0);
  expect(flowHeadingLevel({ flowHeadingLevel: 2 })).toBe(0);
  for (let level = 1; level <= 6; level++)
    expect(
      flowHeadingLevel({ presentationMode: "flow", flowHeadingLevel: level }),
    ).toBe(level);
  for (const level of [undefined, 0, 7, 2.5, NaN])
    expect(
      flowHeadingLevel({ presentationMode: "flow", flowHeadingLevel: level }),
    ).toBe(2);
});
it("numbers sibling stages, includes branches and ends at parent headings or footnotes without changing the document", () => {
  const doc = schema.node("doc", null, [
    h(1),
    p(),
    h(2),
    p(),
    h(3),
    p(),
    h(2),
    p(),
    h(1),
    p(),
    h(2),
    schema.node("footnotes", null, p()),
  ]);
  const before = doc.toJSON();
  const attrs = [...flowBlockAttributes(doc, 2).values()];
  expect(
    attrs
      .filter((attr) => attr.class === "flow-stage")
      .map((attr) => attr["data-flow-step"]),
  ).toEqual(["1", "2", "3"]);
  expect(attrs.filter((attr) => attr.class === "flow-body")).toHaveLength(4);
  expect(doc.toJSON()).toEqual(before);
  expect(flowBlockAttributes(doc, 0).size).toBe(0);
});

it("selection transactions reuse decorations, changing presentation keeps the document, and edits recalculate numbering", async () => {
  const { EditorState, TextSelection } = await import("@tiptap/pm/state");
  const { FlowPresentation, flowPresentationKey } =
    await import("../../src/extensions/FlowPresentation");
  const plugins = FlowPresentation.config.addProseMirrorPlugins!.call({
    options: { level: 2 },
  } as never);
  const doc = schema.node("doc", null, [h(2), p(), h(2), p()]);
  let state = EditorState.create({ doc, plugins });
  const initial = flowPresentationKey.getState(state);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 2)),
  );
  expect(flowPresentationKey.getState(state)).toBe(initial);
  state = state.apply(state.tr.setMeta(flowPresentationKey, 0));
  expect(state.doc).toBe(doc);
  expect(flowPresentationKey.getState(state)?.decorations.find()).toHaveLength(
    0,
  );
  state = state.apply(state.tr.setMeta(flowPresentationKey, 2));
  expect(state.doc).toBe(doc);
  state = state.apply(state.tr.insert(0, h(2)));
  expect(
    flowPresentationKey
      .getState(state)
      ?.decorations.find()
      .filter((decoration) => decoration.type.attrs["data-flow-step"]),
  ).toHaveLength(3);
});
