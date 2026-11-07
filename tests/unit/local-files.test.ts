import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  pluginRuntime,
  PluginRuntime,
} from "../../src/lib/plugin-system/runtime";
import { workspacePanels } from "../../src/lib/plugin-system/panel-registry";
import { MainViewRegistry } from "../../src/lib/plugin-system/main-view-registry";
import {
  localFileService,
  fileSegments,
  decodeSource,
  MAX_SOURCE_BYTES,
} from "../../src/lib/local-files/service";
import * as environment from "../../src/lib/runtime";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const panel = {
  id: "files",
  label: "本地文件",
  icon: "disk",
  renderer: "local-files",
} as const;
function activate() {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.files", [
    "panels.present",
    "filesystem.files.read",
    "views.present",
  ]);
  workspacePanels.register(owner, panel);
  return owner;
}
function file(path: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return {
    name: path.split("/").pop()!,
    webkitRelativePath: "chosen/" + path,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as File;
}
beforeEach(() => {
  pluginRuntime.setEnabled(false);
  localFileService.release();
  vi.spyOn(environment, "isTauriRuntime").mockReturnValue(false);
});
afterEach(() => {
  pluginRuntime.setEnabled(false);
  localFileService.release();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("cross-root transfer preserves IPC field names and refuses read-only targets and revocation", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.files.write", [
    "panels.present",
    "filesystem.files.read",
    "filesystem.files.write",
  ]);
  workspacePanels.register(owner, panel);
  vi.spyOn(environment, "isTauriRuntime").mockReturnValue(true);
  invoke.mockResolvedValueOnce("dest/a.c");
  expect(
    await localFileService.transfer(
      "left",
      "src/a.c",
      "right",
      "dest",
      "a.c",
      false,
    ),
  ).toBe("dest/a.c");
  expect(invoke).toHaveBeenCalledWith("local_files_transfer", {
    rootId: "left",
    node: "src/a.c",
    targetRootId: "right",
    parent: "dest",
    name: "a.c",
    moving: false,
  });
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify({ "right:dest": true }),
  });
  await expect(
    localFileService.transfer("left", "src/a.c", "right", "dest", "a.c", true),
  ).rejects.toThrow("只读");
  expect(invoke).toHaveBeenCalledTimes(1);
  vi.stubGlobal("localStorage", { getItem: () => null });
  invoke.mockImplementationOnce(async () => {
    localFileService.release();
    return "dest/a.c";
  });
  await expect(
    localFileService.transfer("left", "src/a.c", "right", "dest", "a.c", false),
  ).rejects.toThrow("授权已变化");
});
it("browser transfer fails explicitly rather than falling back to unsafe overwrite", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.files.write", [
    "panels.present",
    "filesystem.files.read",
    "filesystem.files.write",
  ]);
  workspacePanels.register(owner, panel);
  await expect(
    localFileService.transfer("left", "src/a.c", "right", "", "a.c", false),
  ).rejects.toThrow("桌面版");
  expect(invoke).not.toHaveBeenCalled();
});
it("rejects escapes, binary data, invalid UTF-8 and over-budget files, preserving CRLF and empty text", () => {
  expect(fileSegments("src/a.c")).toEqual(["src", "a.c"]);
  for (const node of ["../a", "/etc/passwd", "C:\\a", "a/./b", "a//b", "a\0b"])
    expect(() => fileSegments(node)).toThrow();
  expect(decodeSource(new Uint8Array())).toBe("");
  expect(decodeSource(new TextEncoder().encode("a\r\nb\t"))).toBe("a\r\nb\t");
  expect(() => decodeSource(new Uint8Array([0, 1]))).toThrow();
  expect(() => decodeSource(new Uint8Array([255]))).toThrow();
  expect(() => decodeSource(new Uint8Array(MAX_SOURCE_BYTES + 1))).toThrow();
});
it("metadata sorting happens before paging without reading snapshot bodies", async () => {
  activate();
  const files = Array.from({ length: 205 }, (_, index) => {
    const result = file(
      `item-${String(index).padStart(3, "0")}`,
      "x".repeat(index + 1),
    );
    Object.defineProperty(result, "lastModified", { value: index });
    return result;
  });
  const root = localFileService.addFiles(files)!;
  const page = await localFileService.list(root.id, "", 0, {
    sort: "size-desc",
    showHidden: true,
    query: "",
  });
  expect(page.nodes[0].name).toBe("item-204");
  expect(page.next).toBe(200);
  const tail = await localFileService.list(root.id, "", 200, {
    sort: "modified-desc",
    showHidden: true,
    query: "",
  });
  expect(tail.nodes.map((item) => item.name)).toEqual([
    "item-004",
    "item-003",
    "item-002",
    "item-001",
    "item-000",
  ]);
});
it("requires separate file permission; selected snapshots paginate without importing documents", async () => {
  const imageOwner = pluginRuntime.activate.bind(pluginRuntime);
  pluginRuntime.setEnabled(true);
  workspacePanels.register(
    imageOwner("test.image-only", ["panels.present", "filesystem.images.read"]),
    panel,
  );
  expect(() => localFileService.addFiles([file("a.c", "")])).toThrow();
  pluginRuntime.setEnabled(false);
  activate();
  const root = localFileService.addFiles(
    Array.from({ length: 205 }, (_, index) =>
      file(`src/a${index}.c`, "int main() {}\r\n"),
    ),
  )!;
  expect(
    (await localFileService.list(root.id)).nodes.map((item) => item.name),
  ).toEqual(["src"]);
  expect((await localFileService.list(root.id, "src")).nodes).toHaveLength(200);
  expect((await localFileService.list(root.id, "src", 200)).nodes).toHaveLength(
    5,
  );
  expect(await localFileService.read(root.id, "src/a0.c")).toBe(
    "int main() {}\n",
  );
  expect(
    (await localFileService.readSnapshot(root.id, "src/a0.c")).lineEnding,
  ).toBe("crlf");
  await localFileService.remove(root.id);
  await expect(localFileService.read(root.id, "src/a0.c")).rejects.toThrow();
});
it("rejects a read that completes after activation revocation", async () => {
  activate();
  let finish!: (value: ArrayBuffer) => void;
  const slow = file("slow.c", "");
  slow.arrayBuffer = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const root = localFileService.addFiles([slow])!;
  const pending = localFileService.read(root.id, "slow.c");
  pluginRuntime.deactivate("test.files");
  finish(new TextEncoder().encode("secret").buffer);
  await expect(pending).rejects.toThrow();
});
it("keeps file views pending for host acceptance and revokes them on disable", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const views = new MainViewRegistry(runtime);
  const owner = runtime.activate("test.reader", [
    "views.present",
    "filesystem.files.read",
  ]);
  views.register(owner, {
    id: "test.files",
    label: "源码",
    renderer: "local-file",
  });
  const value = { rootId: "root", nodeId: "src/a.c", name: "a.c" };
  const id = views.bind(owner).open("test.files", value);
  expect(views.getSnapshot().current).toBeNull();
  expect(views.accept(id)).toBe(true);
  expect(views.getSnapshot().current?.renderer).toBe("local-file");
  expect(() =>
    views.open(owner, "test.files", { ...value, nodeId: "../secret" }),
  ).toThrow();
  runtime.deactivate(owner.pluginId);
  expect(views.getSnapshot().current).toBeNull();
});
