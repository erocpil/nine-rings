import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  referenceAnchorPlugin,
  referenceAnchorPluginKey,
} from "../../src/extensions/ReferenceAnchors";
import {
  internalNoteId,
  internalReferenceId,
} from "../../src/lib/internal-note-link";
import {
  SourceNavigationSession,
  mapSourceReferences,
} from "../../src/lib/markdown-source-navigation";
import { deltaToProseMirror } from "../../src/lib/delta-converter";
import { mdToDelta } from "../../src/lib/md-parser";
import type { DocumentReferenceAnchor } from "../../src/types/models";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});
const target: DocumentReferenceAnchor = {
  id: "ref",
  kind: "range",
  from: 3,
  to: 5,
  preview: "cd",
};
describe("reference anchors", () => {
  it("follows an unchanged uniquely moved block, including a range inside it", () => {
    const first = schema.node("paragraph", null, schema.text("abcdef"));
    const last = schema.node("paragraph", null, schema.text("last"));
    let state = EditorState.create({
      doc: schema.node("doc", null, [first, last]),
      plugins: [referenceAnchorPlugin([target])],
    });
    state = state.apply(
      state.tr.delete(0, first.nodeSize).insert(last.nodeSize, first),
    );
    expect(referenceAnchorPluginKey.getState(state)?.anchors[0]).toMatchObject({
      id: "ref",
      from: 9,
      to: 11,
    });
    expect(
      referenceAnchorPluginKey.getState(state)?.anchors[0].deleted,
    ).toBeFalsy();
  });
  it("keeps a whole compound block across source edits, and counts inline atoms", () => {
    const before = deltaToProseMirror(mdToDelta("> first\n>\n> second\n\nend"));
    const after = deltaToProseMirror(
      mdToDelta("# New\n\n> first\n>\n> second\n\nend"),
    );
    const mapped = mapSourceReferences(before, after, [
      { ...target, kind: "block", from: 0, to: 17 },
    ])[0];
    expect(mapped).toMatchObject({ from: 5, to: 22 });
    expect(mapped.deleted).toBeFalsy();
    const withAtom = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "abc" },
            { type: "mathInline", attrs: { source: "x" } },
            { type: "text", text: "TARGET" },
          ],
        },
      ],
    };
    const edited = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "NEWabc" },
            { type: "mathInline", attrs: { source: "x" } },
            { type: "text", text: "TARGET" },
          ],
        },
      ],
    };
    expect(
      mapSourceReferences(withAtom, edited, [
        { ...target, from: 5, to: 11 },
      ])[0],
    ).toMatchObject({ from: 8, to: 14 });
  });
  it("maps precise ranges through insertions and invalidates deleted targets", () => {
    let state = EditorState.create({
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, schema.text("abcdef")),
      ]),
      plugins: [referenceAnchorPlugin([target])],
    });
    state = state.apply(state.tr.insertText("NEW", 1));
    expect(referenceAnchorPluginKey.getState(state)?.anchors[0]).toMatchObject({
      from: 6,
      to: 8,
      id: "ref",
    });
    const before = state;
    state = state.apply(state.tr.delete(6, 8));
    expect(referenceAnchorPluginKey.getState(state)?.anchors[0].deleted).toBe(
      true,
    );
    state = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, before.doc.content),
    );
    expect(referenceAnchorPluginKey.getState(state)?.anchors[0]).toMatchObject({
      from: 6,
      to: 8,
    });
    expect(
      referenceAnchorPluginKey.getState(state)?.anchors[0].deleted,
    ).toBeFalsy();
  });
  it("adds anchors without changing content, selection or the bookmark list", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, schema.text("abcdef")),
      ]),
      plugins: [referenceAnchorPlugin([])],
    });
    const after = state.apply(
      state.tr.setMeta(referenceAnchorPluginKey, target),
    );
    expect(after.doc).toBe(state.doc);
    expect(after.selection.eq(state.selection)).toBe(true);
    expect(referenceAnchorPluginKey.getState(after)?.anchors).toEqual([target]);
  });
  it("uses document and anchor IDs, independent of names and visible block numbers", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const anchor = "22222222-2222-4222-8222-222222222222";
    expect(internalNoteId(`nr-note://${id}#nr-ref-${anchor}`)).toBe(id);
    expect(internalReferenceId(`nr-note://${id}#nr-ref-${anchor}`)).toBe(
      anchor,
    );
    expect(internalReferenceId(`nr-note://${id}`)).toBeNull();
    expect(internalNoteId(`nr-note://${id}#garbage`)).toBeNull();
  });
  it("keeps exact text offsets and identity after source edits and undo", () => {
    const source = "abcdef\n\nlast";
    const content = {
      ...mdToDelta(source),
      metadata: { referenceAnchors: [target] },
    };
    const session = new SourceNavigationSession(source, content);
    session.update("# New\n\nNEWabcdef\n\nlast");
    const anchor = session.current.read().metadata!.referenceAnchors![0];
    expect(anchor).toMatchObject({ id: "ref", from: 11, to: 13 });
    expect(anchor.deleted).toBeFalsy();
    expect(session.current.referenceOffset("ref")).toBe(
      session.current.source.indexOf("cd"),
    );
    session.update(source);
    expect(session.current.read()).toBe(content);
    expect(session.current.referenceAnchors).toEqual([target]);
  });
});
