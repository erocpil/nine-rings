import { afterEach, expect, it, vi } from "vitest";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { localDirectoryProvider } from "../../src/lib/local-files/browser-provider";
import { localFileService } from "../../src/lib/local-files/service";
const options = { sort: "name", showHidden: false, query: "" } as const;
afterEach(() => {
  vi.restoreAllMocks();
  pluginRuntime.setEnabled(false);
});
it("never accepts a page after navigation cancellation", async () => {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.browser", [
    "filesystem.files.read",
  ]);
  let finish!: (value: { nodes: []; next: null }) => void;
  vi.spyOn(localFileService, "list").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = localDirectoryProvider(owner).page(
    "r",
    "old",
    0,
    options,
    controller.signal,
  );
  controller.abort();
  finish({ nodes: [], next: null });
  await expect(pending).rejects.toThrow();
  await expect(
    localDirectoryProvider(owner).page(
      "r",
      "new",
      0,
      options,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(localFileService.list).toHaveBeenCalledTimes(1);
});
it("rejects late properties after plugin revocation without reading file bodies", async () => {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.browser", [
    "filesystem.files.read",
  ]);
  let finish!: (value: { size: number; modifiedMs: number }) => void;
  vi.spyOn(localFileService, "stat").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const read = vi.spyOn(localFileService, "readSnapshot");
  const pending = localDirectoryProvider(owner).properties(
    "r",
    "large.bin",
    new AbortController().signal,
  );
  pluginRuntime.deactivate(owner.pluginId);
  finish({ size: 1_000_000_000, modifiedMs: 100 });
  await expect(pending).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
