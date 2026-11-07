import { afterEach, expect, it, vi } from "vitest";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { workspacePanels } from "../../src/lib/plugin-system/panel-registry";
import { mainViews } from "../../src/lib/plugin-system/main-view-registry";
import {
  startBuiltinLocalFiles,
  saveLocalFilesEnabled,
} from "../../src/lib/plugin-system/builtin-local-files";
import {
  startBuiltinFileBrowser,
  saveFileBrowserEnabled,
  fileBrowserEnabled,
  openFileBrowser,
} from "../../src/lib/plugin-system/builtin-file-browser";
import { localFileService } from "../../src/lib/local-files/service";
import { openLocalFileView } from "../../src/lib/plugin-system/local-file-view";

let stops: Array<() => void> = [];
afterEach(async () => {
  stops.forEach((stop) => stop());
  stops = [];
  pluginRuntime.setEnabled(false);
  await vi.waitFor(() => expect(workspacePanels.getSnapshot()).toHaveLength(0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(legacy = false) {
  const storage = new Map<string, string>(
    legacy ? [["nr:pluginLocalFiles", "true"]] : [],
  );
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("window", new EventTarget());
  pluginRuntime.setEnabled(true);
  return storage;
}
it("migrates the old entry once and keeps both switches independent", async () => {
  const storage = setup(true);
  stops.push(startBuiltinLocalFiles(), startBuiltinFileBrowser());
  await vi.waitFor(() => expect(workspacePanels.getSnapshot()).toHaveLength(2));
  expect(storage.get("nr:pluginFileBrowser")).toBe("true");
  const release = vi.spyOn(localFileService, "release");
  saveLocalFilesEnabled(false);
  await vi.waitFor(() =>
    expect(workspacePanels.getSnapshot().map((panel) => panel.id)).toEqual([
      "browser",
    ]),
  );
  expect(release).not.toHaveBeenCalled();
  openFileBrowser();
  const pending = mainViews.getSnapshot().pending!;
  mainViews.accept(pending.id);
  openLocalFileView({ rootId: "r", nodeId: "a.c", name: "a.c" });
  expect(mainViews.getSnapshot().pending?.owner).toBe(pending.owner);
  saveFileBrowserEnabled(false);
  await vi.waitFor(() => expect(workspacePanels.getSnapshot()).toHaveLength(0));
  expect(mainViews.getSnapshot().current).toBeNull();
  expect(mainViews.getSnapshot().pending).toBeNull();
  expect(release).toHaveBeenCalledTimes(1);
  expect(fileBrowserEnabled()).toBe(false);
  saveLocalFilesEnabled(true);
  await vi.waitFor(() =>
    expect(workspacePanels.getSnapshot().map((panel) => panel.id)).toEqual([
      "files",
    ]),
  );
  expect(() => openFileBrowser()).toThrow();
});
it("starts without the file tree and does not discard shared grants when stopped", async () => {
  setup();
  saveFileBrowserEnabled(true);
  stops.push(startBuiltinFileBrowser(), startBuiltinLocalFiles());
  await vi.waitFor(() =>
    expect(workspacePanels.getSnapshot().map((panel) => panel.id)).toEqual([
      "browser",
    ]),
  );
  const file = new File(["int standalone;"], "single.c");
  Object.defineProperty(file, "webkitRelativePath", { value: "Only/single.c" });
  const root = localFileService.addFiles([file])!;
  expect((await localFileService.list(root.id)).nodes[0].name).toBe("single.c");
  expect(
    (await localFileService.readSnapshot(root.id, "single.c")).source,
  ).toBe("int standalone;");
  saveLocalFilesEnabled(true);
  await vi.waitFor(() => expect(workspacePanels.getSnapshot()).toHaveLength(2));
  const release = vi.spyOn(localFileService, "release");
  saveFileBrowserEnabled(false);
  await vi.waitFor(() =>
    expect(workspacePanels.getSnapshot().map((panel) => panel.id)).toEqual([
      "files",
    ]),
  );
  expect(release).not.toHaveBeenCalled();
  openLocalFileView({ rootId: "r", nodeId: "b.c", name: "b.c" });
  expect(mainViews.getSnapshot().pending?.view.id).toBe("builtin.local-files");
});
