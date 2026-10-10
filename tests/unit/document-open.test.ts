import { beforeEach, describe, expect, it } from "vitest";
import { documentOpenOptions } from "../../src/lib/document-open";
import { useDocumentOpenStore } from "../../src/stores/useDocumentOpenStore";

const click = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};
describe("modifier document opening", () => {
  beforeEach(() =>
    useDocumentOpenStore.setState({ sequence: 0, target: null }),
  );
  it("uses Control on Windows/Linux and Command on macOS", () => {
    for (const platform of ["Win32", "Linux x86_64"]) {
      expect(
        documentOpenOptions({ ...click, ctrlKey: true }, platform),
      ).toEqual({ view: "source" });
      expect(
        documentOpenOptions({ ...click, metaKey: true }, platform),
      ).toBeUndefined();
    }
    expect(
      documentOpenOptions({ ...click, metaKey: true }, "MacIntel"),
    ).toEqual({ view: "source" });
    expect(
      documentOpenOptions({ ...click, ctrlKey: true }, "MacIntel"),
    ).toBeUndefined();
  });
  it("leaves plain clicks, context menus and other combined gestures alone", () => {
    expect(documentOpenOptions(click, "Win32")).toBeUndefined();
    for (const extra of [
      { button: 2 },
      { button: 1 },
      { shiftKey: true },
      { altKey: true },
    ]) {
      expect(
        documentOpenOptions({ ...click, ctrlKey: true, ...extra }, "Win32"),
      ).toBeUndefined();
    }
  });
  it("reissues same-document intents, cancels ordinary opens and ignores stale completions", () => {
    const store = useDocumentOpenStore.getState();
    store.open("a", { view: "source" });
    const first = useDocumentOpenStore.getState().target!;
    store.open("a", { view: "source" });
    const second = useDocumentOpenStore.getState().target!;
    expect(second.requestId).toBeGreaterThan(first.requestId);
    store.consumed(first.requestId);
    expect(useDocumentOpenStore.getState().target).toEqual(second);
    store.open("b");
    expect(useDocumentOpenStore.getState().target).toBeNull();
    store.open("a", { view: "source" });
    store.open(null);
    expect(useDocumentOpenStore.getState().target).toBeNull();
  });
});
