import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  clearBlockTextStyles,
  formatBlockText,
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
    codeBlock: { group: "block", content: "text*", marks: "" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    textStyle: {
      attrs: { color: { default: null }, fontSize: { default: null } },
    },
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

describe("whole-block text formatting", () => {
  it("normalizes mixed nested text in one transaction, preserving neighbours, links and selection", () => {
    const first = schema.node("blockquote", null, [
      schema.node("paragraph", null, [
        schema.text("first", [
          schema.marks.bold.create(),
          schema.marks.link.create({ href: "https://example.com" }),
        ]),
        schema.text("second"),
      ]),
      schema.node("paragraph", null, schema.text("third")),
    ]);
    const doc = schema.node("doc", null, [
      first,
      schema.node("paragraph", null, schema.text("after")),
    ]);
    const state = EditorState.create({ doc });
    const next = state.apply(formatBlockText(state.tr, 0, "bold"));
    expect(next.selection.eq(state.selection)).toBe(true);
    expect(next.doc.child(1).eq(doc.child(1))).toBe(true);
    expect(
      next.doc
        .child(0)
        .child(0)
        .firstChild!.marks.some((mark) => mark.type.name === "link"),
    ).toBe(true);
    const marks: string[][] = [];
    next.doc.child(0).descendants((node) => {
      if (node.isText) marks.push(node.marks.map((mark) => mark.type.name));
    });
    expect(marks.every((item) => item.includes("bold"))).toBe(true);
    const cleared = next.apply(formatBlockText(next.tr, 0, "bold"));
    cleared.doc.child(0).descendants((node) => {
      expect(node.marks.some((mark) => mark.type.name === "bold")).toBe(false);
    });
  });

  it("changes and resets one textStyle attribute without losing the other", () => {
    const doc = schema.node(
      "doc",
      null,
      schema.node(
        "paragraph",
        null,
        schema.text("text", [
          schema.marks.textStyle.create({ color: "#247f7b", fontSize: "16" }),
        ]),
      ),
    );
    let state = EditorState.create({ doc });
    state = state.apply(formatBlockText(state.tr, 0, "fontSize", "24"));
    expect(state.doc.firstChild!.firstChild!.marks[0].attrs).toEqual({
      color: "#247f7b",
      fontSize: "24",
    });
    state = state.apply(formatBlockText(state.tr, 0, "color", ""));
    expect(state.doc.firstChild!.firstChild!.marks[0].attrs).toEqual({
      color: null,
      fontSize: "24",
    });
    state = state.apply(formatBlockText(state.tr, 0, "fontSize", ""));
    expect(state.doc.firstChild!.firstChild!.marks).toEqual([]);
  });

  it("does not format code text or atomic content inside a compound block", () => {
    const doc = schema.node(
      "doc",
      null,
      schema.node("blockquote", null, [
        schema.node("paragraph", null, [
          schema.text("literal", [schema.marks.code.create()]),
          schema.node("mathInline", { latex: "x" }),
        ]),
        schema.node("codeBlock", null, schema.text("const x = 1;")),
      ]),
    );
    const state = EditorState.create({ doc });
    for (const format of ["bold", "italic", "fontSize", "color"] as const)
      expect(formatBlockText(state.tr, 0, format, "24").docChanged).toBe(false);
  });
});
