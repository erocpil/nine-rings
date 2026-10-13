import { beforeEach, afterEach, vi, expect, it } from "vitest";
import {
  PluginRuntime,
  pluginRuntime,
} from "../../src/lib/plugin-system/runtime";
import {
  WorkspacePanelRegistry,
  workspacePanels,
} from "../../src/lib/plugin-system/panel-registry";
import {
  imageSegments,
  imageMime,
  imageDirectoryService,
} from "../../src/lib/image-library/directory-service";
import { documentImages } from "../../src/lib/image-library/document-images";
import * as environment from "../../src/lib/runtime";
afterEach(() => vi.restoreAllMocks());
const declaration = {
  id: "images",
  label: "图片",
  icon: "image",
  renderer: "image-library",
} as const;
beforeEach(() => {
  pluginRuntime.setEnabled(false);
  imageDirectoryService.release();
});
it("registers declarative panels with issued authority and revokes them with the plugin", () => {
  const runtime = new PluginRuntime();
  const panels = new WorkspacePanelRegistry(runtime);
  runtime.setEnabled(true);
  const noPermission = runtime.activate("test.no-permission", []);
  expect(() => panels.register(noPermission, declaration)).toThrow();
  const owner = runtime.activate("test.images", [
    "panels.present",
    "filesystem.images.read",
  ]);
  expect(() => panels.register({ ...owner }, declaration)).toThrow();
  panels.register(owner, declaration);
  expect(panels.getSnapshot()).toHaveLength(1);
  expect(() => panels.register(owner, declaration)).toThrow();
  runtime.deactivate(owner.pluginId);
  expect(panels.getSnapshot()).toHaveLength(0);
  expect(() => panels.assert("images")).toThrow();
});
it("rejects path escapes and unsupported image extensions", () => {
  expect(imageSegments("holiday/photo.png")).toEqual(["holiday", "photo.png"]);
  for (const path of [
    "../private",
    "/private",
    "C:\\private",
    "a/../private",
    "a//b",
    "a/.",
    "a\u0000b",
  ])
    expect(() => imageSegments(path)).toThrow();
  expect(imageMime("PHOTO.JPEG")).toBe("image/jpeg");
  expect(imageMime("script.svg")).toBeUndefined();
});
it("exposes only selected supported files, grouped by path, with bounded pages", async () => {
  pluginRuntime.setEnabled(true);
  workspacePanels.register(
    pluginRuntime.activate("test.images", [
      "panels.present",
      "filesystem.images.read",
    ]),
    declaration,
  );
  const files = Array.from(
    { length: 205 },
    (_, i) =>
      ({
        name: `photo${i}.png`,
        webkitRelativePath: `selected/trip/photo${i}.png`,
        size: 4,
        lastModified: 1,
        type: "image/png",
        slice: () =>
          new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
      }) as File,
  );
  files.push({
    name: "private.txt",
    webkitRelativePath: "selected/private.txt",
  } as File);
  const root = imageDirectoryService.addFiles(files)!;
  expect(
    (await imageDirectoryService.list(root.id)).nodes.map((node) => node.name),
  ).toEqual(["trip"]);
  const first = await imageDirectoryService.list(root.id, "trip");
  expect(first.nodes).toHaveLength(200);
  expect(first.next).toBe(200);
  expect(
    (await imageDirectoryService.list(root.id, "trip", 200)).nodes,
  ).toHaveLength(5);
  expect(
    (await imageDirectoryService.read(root.id, "trip/photo0.png")).size,
  ).toBe(4);
  await expect(
    imageDirectoryService.read(root.id, "private.txt"),
  ).rejects.toThrow();
  pluginRuntime.setEnabled(false);
  await expect(imageDirectoryService.list(root.id)).rejects.toThrow();
});
it("derives document image choices from structured content including offscreen nested images", () => {
  expect(
    documentImages({
      ops: [
        { insert: { image: { src: "nr-image://one", alt: "一" } } },
        {
          insert: {
            table: { rows: [{ image: { src: "/two.png", title: "二" } }] },
          },
        },
        { insert: { image: { src: "nr-image://one" } } },
      ],
      metadata: { markdownSource: "![ignored](/three.png)" },
    }),
  ).toEqual([
    { src: "nr-image://one", name: "一" },
    { src: "/two.png", name: "二" },
  ]);
  expect(
    documentImages({
      type: "doc",
      content: [
        { type: "markdownImage", attrs: { src: "/inline.png", alt: "行内" } },
      ],
    }),
  ).toEqual([{ src: "/inline.png", name: "行内" }]);
});

it("does not deliver in-flight file bytes after the plugin releases its sources", async () => {
  pluginRuntime.setEnabled(true);
  workspacePanels.register(
    pluginRuntime.activate("test.images", [
      "panels.present",
      "filesystem.images.read",
    ]),
    declaration,
  );
  const file = Object.assign(
    new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
    { name: "photo.png", lastModified: 1 },
  ) as File;
  const root = imageDirectoryService.addFiles([file])!;
  const pending = imageDirectoryService.read(root.id, "photo.png");
  imageDirectoryService.release();
  await expect(pending).rejects.toThrow("图片授权已变更");
});

it("uses selected-file snapshots on desktop without forwarding their IDs to native disk commands", async () => {
  vi.spyOn(environment, "isTauriRuntime").mockReturnValue(true);
  pluginRuntime.setEnabled(true);
  workspacePanels.register(
    pluginRuntime.activate("test.images", [
      "panels.present",
      "filesystem.images.read",
    ]),
    declaration,
  );
  const file = {
    name: "photo.png",
    size: 4,
    lastModified: 1,
    type: "image/png",
    slice: () =>
      new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
  } as File;
  const root = imageDirectoryService.addFiles([file])!;
  expect((await imageDirectoryService.list(root.id)).nodes[0].name).toBe(
    "photo.png",
  );
  expect((await imageDirectoryService.read(root.id, "photo.png")).size).toBe(4);
  await imageDirectoryService.remove(root.id);
  await expect(
    imageDirectoryService.read(root.id, "photo.png"),
  ).rejects.toThrow();
});
