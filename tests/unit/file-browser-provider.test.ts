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
it("bounds quick preview before reading and truncates text without changing the document", async () => {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.browser", [
    "filesystem.files.read",
  ]);
  const stat = vi
    .spyOn(localFileService, "stat")
    .mockResolvedValue({ size: 2 * 1024 * 1024, modifiedMs: 0 });
  const read = vi.spyOn(localFileService, "readSnapshot").mockResolvedValue({
    source: "x".repeat(70000),
    size: 70000,
    bom: false,
    lineEnding: "lf",
    modifiedMs: 0,
    revision: "r",
  });
  const provider = localDirectoryProvider(owner);
  await expect(
    provider.preview("r", "large.txt", new AbortController().signal),
  ).rejects.toThrow("1 MiB");
  expect(read).not.toHaveBeenCalled();
  stat.mockResolvedValue({ size: 70000, modifiedMs: 0 });
  const preview = await provider.preview(
    "r",
    "normal.txt",
    new AbortController().signal,
  );
  expect(preview.kind).toBe("text");
  expect(preview.value).toHaveLength(65536);
  expect(preview.truncated).toBe(true);
});
it("rejects a stale preview after its file read finishes", async () => {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.browser", [
      "filesystem.files.read",
    ]),
    controller = new AbortController();
  vi.spyOn(localFileService, "stat").mockResolvedValue({
    size: 100,
    modifiedMs: 0,
  });
  vi.spyOn(localFileService, "readImageAsset").mockImplementation(async () => {
    controller.abort();
    return "data:image/png;base64,AA==";
  });
  await expect(
    localDirectoryProvider(owner).preview("r", "image.png", controller.signal),
  ).rejects.toThrow();
});

it("authenticates bounded original-byte digests and refuses changed or revoked reads", async () => {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.browser", [
    "filesystem.files.read",
  ]);
  const stat = vi
    .spyOn(localFileService, "stat")
    .mockResolvedValue({ size: 2, modifiedMs: 50 });
  const read = vi.spyOn(localFileService, "readSnapshot").mockResolvedValue({
    source: "a",
    revision: "raw-byte-sha",
    bom: false,
    lineEnding: "lf",
    size: 2,
    modifiedMs: 50,
  });
  const provider = localDirectoryProvider(owner),
    signal = new AbortController().signal;
  await expect(
    provider.contentDigest("r", "a.txt", signal),
  ).resolves.toMatchObject({ digest: "raw-byte-sha", size: 2 });
  stat.mockResolvedValue({ size: 5 * 1024 * 1024, modifiedMs: 50 });
  read.mockClear();
  await expect(provider.contentDigest("r", "a.txt", signal)).rejects.toThrow(
    "4 MiB",
  );
  expect(read).not.toHaveBeenCalled();
  stat.mockResolvedValue({ size: 2, modifiedMs: 51 });
  await expect(provider.contentDigest("r", "a.txt", signal)).rejects.toThrow(
    "变化",
  );
  stat.mockResolvedValue({ size: 2, modifiedMs: 50 });
  read.mockImplementation(async () => {
    pluginRuntime.deactivate(owner.pluginId);
    return {
      source: "a",
      revision: "r",
      bom: false,
      lineEnding: "lf",
      size: 2,
      modifiedMs: 50,
    };
  });
  await expect(provider.contentDigest("r", "a.txt", signal)).rejects.toThrow();
});

it("raw-byte comparison uses the scoped digest service and rejects a late result after revocation", async () => {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.browser", [
    "filesystem.files.read",
  ]);
  const read = vi.spyOn(localFileService, "readSnapshot");
  vi.spyOn(localFileService, "digest").mockImplementation(async () => {
    pluginRuntime.deactivate(owner.pluginId);
    return { size: 3, modifiedMs: 50, digest: "sha" };
  });
  await expect(
    localDirectoryProvider(owner).contentDigest(
      "r",
      "binary",
      new AbortController().signal,
      true,
    ),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
