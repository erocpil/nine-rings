import { beforeEach, describe, expect, it } from "vitest";
import { useNavigationStore as store } from "../../src/stores/useNavigationStore";
import {
  navigationKey,
  isDocumentNavigationShortcut,
} from "../../src/lib/document-navigation";
const position = (noteId: string, from: number) => ({ noteId, from, to: from });
beforeEach(() =>
  store.setState({
    entries: [],
    index: -1,
    revision: 0,
    target: null,
    busy: false,
    enabled: true,
  }),
);

describe("document position history", () => {
  it("merges editing and duplicate positions, and truncates forward only on a new jump", () => {
    store.getState().activate("a");
    store.getState().record(position("a", 10));
    store.getState().record(position("a", 100), true);
    store.getState().record(position("a", 101));
    store.getState().record(position("a", 101), true);
    expect(store.getState().entries).toEqual([
      position("a", 10),
      position("a", 101),
    ]);
    store.getState().restore(0);
    store.getState().record(position("a", 999), true);
    expect(store.getState().entries).toHaveLength(2);
    store.getState().consumed(store.getState().target!.requestId);
    store.getState().record(position("a", 11));
    expect(store.getState().entries).toHaveLength(2);
    store.getState().record(position("a", 200), true);
    expect(store.getState().entries).toEqual([
      position("a", 11),
      position("a", 200),
    ]);
  });
  it("preserves cross-document locations and ignores late events from the previous editor", () => {
    store.getState().activate("a");
    store.getState().record(position("a", 80));
    store.getState().activate("b");
    store.getState().record(position("a", 1));
    store.getState().activate("a");
    expect(store.getState().entries).toEqual([
      position("a", 80),
      position("b", 1),
      position("a", 80),
    ]);
    store.getState().restore(1);
    store.getState().activate("b");
    expect(store.getState().index).toBe(1);
    expect(store.getState().entries).toHaveLength(3);
  });
  it("maps all saved positions through document edits, including pending restoration", () => {
    store.getState().activate("a");
    store.getState().record(position("a", 80), true);
    store.getState().activate("b");
    store.getState().restore(1);
    store.getState().map("a", (pos) => Math.max(1, pos - 50));
    expect(store.getState().entries).toEqual([
      position("a", 1),
      position("a", 30),
      position("b", 1),
    ]);
    expect(store.getState().target?.from).toBe(30);
  });
  it("removes deleted documents without losing the current index", () => {
    for (const id of ["a", "b", "a", "c"]) store.getState().activate(id);
    store.getState().remove("a");
    expect(store.getState().entries.map((item) => item.noteId)).toEqual([
      "b",
      "c",
    ]);
    expect(store.getState().index).toBe(1);
  });
  it("caps history at 100 positions", () => {
    for (let i = 0; i < 120; i++) store.getState().activate(String(i));
    expect(store.getState().entries).toHaveLength(100);
    expect(store.getState().entries[0].noteId).toBe("20");
    expect(store.getState().index).toBe(99);
  });
  it("keeps Mac Option word movement and handles navigation keys on both platforms", () => {
    const event = {
      key: "ArrowLeft",
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
    };
    expect(navigationKey(event, false)).toBe(-1);
    expect(navigationKey(event, true)).toBeNull();
    expect(navigationKey({ ...event, metaKey: true }, true)).toBe(-1);
    expect(
      navigationKey({ ...event, key: "ArrowRight", metaKey: true }, true),
    ).toBe(1);
    expect(navigationKey({ ...event, shiftKey: true }, false)).toBeNull();
    expect(
      navigationKey({ ...event, key: "BrowserBack", altKey: false }, true),
    ).toBe(-1);
    expect(
      navigationKey({ ...event, key: "BrowserForward", altKey: false }, false),
    ).toBe(1);
  });
});

it("reserves navigation hotkeys without occupying Mac Option word movement", () => {
  expect(isDocumentNavigationShortcut("Alt+Left", false)).toBe(true);
  expect(isDocumentNavigationShortcut("Alt+ArrowRight", false)).toBe(true);
  expect(isDocumentNavigationShortcut("Alt+ArrowLeft", true)).toBe(false);
  expect(isDocumentNavigationShortcut("Command+Alt+Left", true)).toBe(true);
  expect(isDocumentNavigationShortcut("Ctrl+Alt+Left", false)).toBe(false);
});
