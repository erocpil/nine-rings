import { expect, it, vi } from "vitest";
import { remapLocalFileBookmarks } from "../../src/lib/local-files/bookmark-positions";
import { prepareLocalMarkdownView } from "../../src/lib/local-files/markdown-view-switch";

it("keeps both bookmark identities when a removed line shares the survivor's position", () => {
  const items = [
    { id: "removed", offset: 6, label: "Removed" },
    { id: "survivor", offset: 13, label: "Survivor" },
  ];
  const moved = remapLocalFileBookmarks(
    items,
    "first\nremove\nkeep\n",
    "first\nkeep\n",
    (item, map) => ({ ...item, offset: map(item.offset) }),
    { from: 6, to: 13 },
  );
  expect(moved).toEqual(items.map((item) => ({ ...item, offset: 6 })));
});

it("uses the edit range to keep a bookmark on the surviving copy of identical lines", () => {
  const items = [{ id: "second", offset: 5 }];
  expect(
    remapLocalFileBookmarks(
      items,
      "same\nsame\nlast\n",
      "same\nlast\n",
      (item, map) => ({ ...item, offset: map(item.offset) }),
      { from: 0, to: 5 },
    ),
  ).toEqual([{ id: "second", offset: 0 }]);
});

it("prepares the latest flushed text before persisting and handing off selection", () => {
  const events: string[] = [];
  const source = "# Latest\n";
  prepareLocalMarkdownView({
    rendered: false,
    readSource: () => {
      events.push("flush");
      return source;
    },
    readRenderedSelection: () => 4,
    prepareSource: (value) => events.push(value),
    persist: () => events.push("persist"),
    position: {
      toRendered: vi.fn(),
      toSource: (value, doc, sourceTop, selection) => {
        expect(value).toBe(source);
        expect(doc.type).toBe("doc");
        expect(sourceTop).toBeUndefined();
        expect(selection).toBe(4);
        events.push("handoff");
      },
    },
  });
  expect(events).toEqual(["flush", source, "persist", "handoff"]);
});

it("leaves selection and preferences alone when the current projection cannot be flushed", () => {
  const persist = vi.fn();
  const position = { toRendered: vi.fn(), toSource: vi.fn() };
  expect(() =>
    prepareLocalMarkdownView({
      rendered: true,
      readSource: () => {
        throw new Error("projection unavailable");
      },
      readRenderedSelection: vi.fn(),
      persist,
      position,
    }),
  ).toThrow("projection unavailable");
  expect(persist).not.toHaveBeenCalled();
  expect(position.toRendered).not.toHaveBeenCalled();
  expect(position.toSource).not.toHaveBeenCalled();
});
