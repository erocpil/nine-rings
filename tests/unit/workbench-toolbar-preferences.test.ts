import { expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  installWorkbenchToolbarPreferences,
  TOOLBAR_PREFERENCES_KEY,
} from "../../src/apps/file-workbench/toolbar-preferences";
function fixture(initial: string | null) {
  let value = initial;
  const store = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
  const tools = createStore<{
    expanded: boolean | null;
    setExpanded: (value: boolean | null) => void;
  }>((set) => ({
    expanded: null,
    setExpanded: (expanded) => set({ expanded }),
  }));
  const events = new EventTarget(),
    report = vi.fn();
  return {
    store,
    tools,
    events,
    report,
    writeElsewhere: (next: string | null) => {
      value = next;
      events.dispatchEvent(new Event("storage"));
    },
  };
}
it("restores explicit false without writing defaults, then persists before showing shared tools", () => {
  const value = fixture('{"expanded":false}');
  const stop = installWorkbenchToolbarPreferences(
    value.store,
    value.report,
    value.tools,
    value.events,
  );
  expect(value.tools.getState().expanded).toBe(false);
  expect(value.store.setItem).not.toHaveBeenCalled();
  value.tools.getState().setExpanded(true);
  expect(value.store.setItem).toHaveBeenCalledWith(
    TOOLBAR_PREFERENCES_KEY,
    '{"expanded":true}',
  );
  expect(value.tools.getState().expanded).toBe(true);
  value.tools.getState().setExpanded(false);
  expect(value.tools.getState().expanded).toBe(false);
  stop();
  expect(value.tools.getState().expanded).toBeNull();
});
it("synchronizes another window without echoing writes and detaches on disposal", () => {
  const value = fixture(null);
  const original = value.tools.getState().setExpanded;
  const stop = installWorkbenchToolbarPreferences(
    value.store,
    value.report,
    value.tools,
    value.events,
  );
  value.writeElsewhere('{"expanded":true}');
  expect(value.tools.getState().expanded).toBe(true);
  expect(value.store.setItem).not.toHaveBeenCalled();
  stop();
  expect(value.tools.getState().setExpanded).toBe(original);
  value.writeElsewhere('{"expanded":false}');
  expect(value.tools.getState().expanded).toBeNull();
});
it("a failed save keeps the visible and persisted choice unchanged", () => {
  const value = fixture('{"expanded":true}');
  const stop = installWorkbenchToolbarPreferences(
    value.store,
    value.report,
    value.tools,
    value.events,
  );
  value.store.setItem.mockImplementation(() => {
    throw new Error("quota");
  });
  value.tools.getState().setExpanded(false);
  expect(value.tools.getState().expanded).toBe(true);
  expect(value.report).toHaveBeenCalledOnce();
  stop();
});
it.each([null, "bad json", '{"expanded":"false"}', "[]", "null"])(
  "invalid or absent preference preserves view defaults: %s",
  (initial) => {
    const value = fixture(initial);
    const stop = installWorkbenchToolbarPreferences(
      value.store,
      value.report,
      value.tools,
      value.events,
    );
    expect(value.tools.getState().expanded).toBeNull();
    expect(value.store.setItem).not.toHaveBeenCalled();
    stop();
  },
);
