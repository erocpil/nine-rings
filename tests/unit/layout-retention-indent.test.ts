import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  BlockIndent,
  changeBlockIndent,
} from "../../src/extensions/BlockIndent";
import {
  EditorState,
  NodeSelection,
  TextSelection,
  AllSelection,
} from "@tiptap/pm/state";
import { listFollowupBlocks } from "../../src/lib/list-followup-blocks";
import {
  readDesktopSidebarState,
  saveDesktopSidebarState,
} from "../../src/lib/desktop-sidebar-state";
import {
  collectFrontendSettings,
  restoreFrontendSettings,
} from "../../src/lib/backup-user-settings";
import {
  proseMirrorToDelta,
  deltaToProseMirror,
} from "../../src/lib/delta-converter";

const schema = getSchema([StarterKit, BlockIndent]);

it("indents an atomic block without changing the next block, while all-selection includes the last block", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "paragraph" },
      { type: "horizontalRule" },
      { type: "paragraph" },
    ],
  });
  const state = EditorState.create({
    doc,
    selection: NodeSelection.create(doc, doc.child(0).nodeSize),
  });
  let next = doc;
  changeBlockIndent(
    state,
    (transaction) => {
      next = transaction.doc;
    },
    1,
  );
  expect(next.child(1).attrs.indent).toBe(1);
  expect(next.child(2).attrs.indent).toBe(0);
  changeBlockIndent(
    EditorState.create({ doc, selection: new AllSelection(doc) }),
    (transaction) => {
      next = transaction.doc;
    },
    1,
  );
  expect(next.child(2).attrs.indent).toBe(1);
});

describe("desktop layout and list continuation presentation", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("migrates legacy hidden state and retains the complete desktop layout in backups", () => {
    values.set("nr:sidebarHidden", "true");
    expect(readDesktopSidebarState()).toEqual({
      panel: "tree",
      hidden: true,
      pinned: false,
    });
    saveDesktopSidebarState({ panel: "reader", hidden: false, pinned: true });
    for (const [key, value] of Object.entries({
      "nr:sidebarOrder": "reader,list,tree",
      "nr:readerSidebarRatio": "0.4",
      "nr:readerSidebarW": "460",
      "nr:listSidebarW": "410",
      "nr:treeSidebarW": "380",
      "nr:blockWorkspaceDisplay": '{"listFollowupIndent":false}',
    }))
      values.set(key, value);
    const saved = new Map(values);
    const backup = collectFrontendSettings(localStorage);
    values.clear();
    restoreFrontendSettings(backup, localStorage);
    for (const [key, value] of saved) expect(values.get(key)).toBe(value);
    expect(readDesktopSidebarState()).toEqual({
      panel: "reader",
      hidden: false,
      pinned: true,
    });
  });
  it("derives a consecutive followup group without changing document attributes", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
        {
          type: "codeBlock",
          attrs: { indent: 1 },
          content: [{ type: "text", text: "code" }],
        },
        {
          type: "blockquote",
          attrs: { indent: 2 },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "quote" }] },
          ],
        },
        { type: "codeBlock" },
        { type: "paragraph" },
        { type: "codeBlock" },
      ],
    });
    const before = doc.toJSON();
    const offsets: number[] = [];
    doc.forEach((_node, pos) => offsets.push(pos));
    expect([...listFollowupBlocks(doc)]).toEqual(offsets.slice(1, 4));
    expect(doc.toJSON()).toEqual(before);
    const restored = schema.nodeFromJSON(
      deltaToProseMirror(proseMirrorToDelta(before)),
    );
    expect(restored.child(1).attrs.indent).toBe(1);
    expect(restored.child(2).attrs.indent).toBe(2);
  });

  it("allows each supported top-level block to advance at most one level beyond its predecessor", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { indent: 0 },
          content: [{ type: "text", text: "one" }],
        },
        {
          type: "heading",
          attrs: { level: 2, indent: 1 },
          content: [{ type: "text", text: "two" }],
        },
        {
          type: "codeBlock",
          attrs: { indent: 0 },
          content: [{ type: "text", text: "three" }],
        },
      ],
    });
    const positions: number[] = [];
    doc.forEach((_node, pos) => positions.push(pos));
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, positions[2] + 1),
    });
    let nextDoc = doc;
    expect(
      changeBlockIndent(
        state,
        (transaction) => {
          nextDoc = transaction.doc;
        },
        1,
      ),
    ).toBe(true);
    expect(nextDoc.child(2).attrs.indent).toBe(1);

    // Even if older content contains an invalid jump, another increment is
    // clamped to one level past the immediately preceding top-level block.
    const invalidDoc = doc.type.create(null, [
      doc.child(0),
      doc
        .child(1)
        .type.create(
          { ...doc.child(1).attrs, indent: 1 },
          doc.child(1).content,
        ),
      doc
        .child(2)
        .type.create(
          { ...doc.child(2).attrs, indent: 5 },
          doc.child(2).content,
        ),
    ]);
    const invalidPositions: number[] = [];
    invalidDoc.forEach((_node, pos) => invalidPositions.push(pos));
    const invalidState = EditorState.create({
      doc: invalidDoc,
      selection: TextSelection.create(invalidDoc, invalidPositions[2] + 1),
    });
    changeBlockIndent(
      invalidState,
      (transaction) => {
        nextDoc = transaction.doc;
      },
      1,
    );
    expect(nextDoc.child(2).attrs.indent).toBe(2);
    changeBlockIndent(
      invalidState,
      (transaction) => {
        nextDoc = transaction.doc;
      },
      -1,
    );
    expect(nextDoc.child(2).attrs.indent).toBe(2);
  });

  it("preserves visual block indentation for list containers and embedded block types", () => {
    const source = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { indent: 1 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "item" }],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { indent: 0, indentExplicit: true },
          content: [{ type: "text", text: "flowchart LR" }],
        },
        {
          type: "mathBlock",
          attrs: { source: "x=1", indent: 2, indentExplicit: true },
        },
        { type: "horizontalRule", attrs: { indent: 3 } },
        { type: "resizableImage", attrs: { src: "image://test", indent: 4 } },
      ],
    };
    const restored = deltaToProseMirror(proseMirrorToDelta(source));
    expect(restored.content?.map((block) => block.attrs?.indent ?? 0)).toEqual([
      1, 0, 2, 3, 4,
    ]);
    expect(restored.content?.[1].attrs?.indentExplicit).toBe(true);
    expect(restored.content?.[2].attrs?.indentExplicit).toBe(true);
  });

  it("records a manual zero indent so automatic list continuation cannot reapply", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "item" }],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "flowchart LR" }],
        },
      ],
    });
    let codeBlockPos = 0;
    doc.forEach((node, pos) => {
      if (node.type.name === "codeBlock") codeBlockPos = pos;
    });
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, codeBlockPos + 1),
    });
    let changedDoc = doc;
    expect(
      changeBlockIndent(
        state,
        (transaction) => {
          changedDoc = transaction.doc;
        },
        -1,
      ),
    ).toBe(true);
    expect(changedDoc.child(1).attrs.indent).toBe(0);
    expect(changedDoc.child(1).attrs.indentExplicit).toBe(true);
  });
});
