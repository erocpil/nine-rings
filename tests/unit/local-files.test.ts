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
    "int main() {}\r\n",
  );
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
