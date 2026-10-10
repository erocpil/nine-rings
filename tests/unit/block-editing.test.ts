import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  clearBlockTextStyles,
  clipboardBlockFragment,
} from "../../src/lib/block-editing";
import {
  referenceAnchorPlugin,
  referenceAnchorPluginKey,
} from "../../src/extensions/ReferenceAnchors";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    blockquote: { group: "block", content: "block+" },
    mathInline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { latex: { default: "" } },
    },
    footnoteReference: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { id: { default: "" } },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    textStyle: { attrs: { color: { default: null } } },
    link: { attrs: { href: {} } },
    code: {},
  },
});

describe("block editing", () => {
  it("clears visual marks throughout a compound block while preserving semantics and neighbours", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "link",
                  marks: [
                    { type: "bold" },
                    { type: "textStyle", attrs: { color: "red" } },
                    { type: "link", attrs: { href: "https://example.com" } },
                  ],
                },
                {
                  type: "text",
                  text: "literal",
                  marks: [{ type: "code" }, { type: "italic" }],
                },
                { type: "mathInline", attrs: { latex: "x^2" } },
                { type: "footnoteReference", attrs: { id: "1" } },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "next", marks: [{ type: "bold" }] }],
        },
      ],
    });
    const tr = clearBlockTextStyles(EditorState.create({ doc }).tr, 0);
    expect(
      tr.doc
        .child(0)
        .child(0)
        .child(0)
        .marks.map((mark) => mark.type.name),
    ).toEqual(["link"]);
    expect(
      tr.doc
        .child(0)
        .child(0)
        .child(1)
        .marks.map((mark) => mark.type.name),
    ).toEqual(["code"]);
    expect(
      tr.doc.child(0).child(0).child(2).eq(doc.child(0).child(0).child(2)),
    ).toBe(true);
    expect(
      tr.doc.child(0).child(0).child(3).eq(doc.child(0).child(0).child(3)),
    ).toBe(true);
    expect(tr.doc.child(1).eq(doc.child(1))).toBe(true);
  });

  it("leaves empty and already unstyled blocks untouched", () => {
    const doc = schema.node("doc", null, schema.node("paragraph"));
    expect(
      clearBlockTextStyles(EditorState.create({ doc }).tr, 0).docChanged,
    ).toBe(false);
  });

  it("keeps plain-text line boundaries as sibling paragraphs and ignores an empty clipboard", async () => {
    const fragment = await clipboardBlockFragment(schema, "a\r\n\r\nb", "");
    expect(fragment.childCount).toBe(3);
    expect(fragment.child(1).textContent).toBe("");
    expect((await clipboardBlockFragment(schema, "", "")).size).toBe(0);
  });

  it("restores several cut references with their original IDs in one paste transaction", () => {
    const block = schema.node("paragraph", null, schema.text("first"));
    const tail = schema.node("paragraph", null, schema.text("tail"));
    const anchors = [
      { id: "block", kind: "block" as const, from: 0, to: 7, preview: "first" },
      {
        id: "point",
        kind: "position" as const,
        from: 2,
        to: 2,
        preview: "first",
      },
    ];
    let state = EditorState.create({
      doc: schema.node("doc", null, [block, tail]),
      plugins: [referenceAnchorPlugin(anchors)],
    });
    state = state.apply(state.tr.delete(0, 7));
    expect(
      referenceAnchorPluginKey
        .getState(state)
        ?.anchors.every((anchor) => anchor.deleted),
    ).toBe(true);
    state = state.apply(
      state.tr.insert(6, block).setMeta(
        referenceAnchorPluginKey,
        anchors.map((anchor) => ({
          ...anchor,
          from: anchor.from + 6,
          to: anchor.to + 6,
          deleted: false,
        })),
      ),
    );
    expect(referenceAnchorPluginKey.getState(state)?.anchors).toEqual(
      anchors.map((anchor) => ({
        ...anchor,
        from: anchor.from + 6,
        to: anchor.to + 6,
        deleted: false,
      })),
    );
  });
});
