import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockIndent } from "../../src/extensions/BlockIndent";
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
});
