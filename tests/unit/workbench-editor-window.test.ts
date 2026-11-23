import { expect, it, vi } from "vitest";
import {
  watchWorkbenchEditor,
  type WorkbenchEditorPort,
  type WorkbenchEditorState,
} from "../../src/apps/file-workbench/editor-window";
const snapshot = (revision: number): WorkbenchEditorState => ({
  files: [],
  current: null,
  revision,
  closing: null,
});
it("subscribes before the initial snapshot, ignores out-of-order reads and disposes notifications", async () => {
  const order: string[] = [];
  const reads: Array<(value: WorkbenchEditorState) => void> = [];
  let changed = () => {};
  const stop = vi.fn();
  const port: WorkbenchEditorPort = {
    reorder: async () => {},
    read: () => {
      order.push("read");
      return new Promise((resolve) => reads.push(resolve));
    },
    listen: async (listener) => {
      order.push("listen");
      changed = listener;
      return stop;
    },
    select: vi.fn(),
    remove: vi.fn(),
    confirm: vi.fn(),
    finish: vi.fn(),
    showBrowser: vi.fn(),
  };
  const update = vi.fn(),
    error = vi.fn();
  const pending = watchWorkbenchEditor(port, update, error);
  await Promise.resolve();
  changed();
  reads[1](snapshot(2));
  await Promise.resolve();
  reads[0](snapshot(1));
  const dispose = await pending;
  expect(order.slice(0, 2)).toEqual(["listen", "read"]);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(snapshot(2));
  changed();
  dispose();
  reads[2](snapshot(3));
  await Promise.resolve();
  expect(update).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();
});
it("reports an initial read error while keeping subsequent refresh available", async () => {
  let changed = () => {};
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue(snapshot(3));
  const error = vi.fn(),
    update = vi.fn();
  const dispose = await watchWorkbenchEditor(
    {
      read,
      listen: async (listener) => {
        changed = listener;
        return () => {};
      },
      select: vi.fn(),
      remove: vi.fn(),
      confirm: vi.fn(),
      finish: vi.fn(),
      showBrowser: vi.fn(),
    },
    update,
    error,
  );
  expect(error).toHaveBeenCalledOnce();
  changed();
  await Promise.resolve();
  expect(update).toHaveBeenCalledWith(snapshot(3));
  dispose();
});

it("file view state preserves explicit false values and does not rewrite defaults on read", async () => {
  const { readWorkbenchFileView, saveWorkbenchFileView } =
    await import("../../src/apps/file-workbench/editor-settings");
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  expect(readWorkbenchFileView(store, "root:a.md")).toEqual({});
  expect(store.setItem).not.toHaveBeenCalled();
  saveWorkbenchFileView(store, "root:a.md", {
    readonly: false,
    rendered: false,
  });
  expect(readWorkbenchFileView(store, "root:a.md")).toEqual({
    readonly: false,
    rendered: false,
  });
  saveWorkbenchFileView(store, "root:a.md", { readonly: true });
  expect(readWorkbenchFileView(store, "root:a.md")).toEqual({
    readonly: true,
    rendered: false,
  });
  expect(readWorkbenchFileView(store, "root:b.md")).toEqual({});
  const original = values.get("view:root:a.md");
  store.setItem.mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() =>
    saveWorkbenchFileView(store, "root:a.md", { readonly: false }),
  ).toThrow("quota");
  expect(values.get("view:root:a.md")).toBe(original);
});
