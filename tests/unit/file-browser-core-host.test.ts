import { expect, it, vi } from "vitest";
import { createBrowserDirectoryProvider } from "../../src/lib/local-files/browser-provider-core";
import type { BrowserDirectoryHost } from "../../src/lib/local-files/browser-contract";

const options = { sort: "name", query: "", showHidden: false } as const;
const node = { id: "a.txt", name: "a.txt", size: 3, directory: false };
function host(label: string) {
  let active = true;
  const port = {
    assertActive: () => {
      if (!active) throw new Error("revoked");
    },
    files: {
      list: vi.fn(async () => ({
        nodes: [{ ...node, id: label, name: label }],
        next: null,
      })),
      stat: vi.fn(async () => ({ size: 3, modifiedMs: 1 })),
      readSnapshot: vi.fn(async () => ({
        source: "abc",
        revision: "hash",
        size: 3,
        modifiedMs: 1,
        bom: false,
        lineEnding: "lf" as const,
      })),
      readImageAsset: vi.fn(async () => "data:image/png;base64,AA=="),
      digest: vi.fn(async () => ({
        digest: "raw-hash",
        size: 3,
        modifiedMs: 1,
      })),
      digestByteLimit: () => 16 * 1024 * 1024,
    },
    open: vi.fn<BrowserDirectoryHost["open"]>(async () => {}),
  } satisfies BrowserDirectoryHost;
  return {
    port,
    revoke: () => {
      active = false;
    },
  };
}

it("uses one provider implementation with isolated hosts and no application globals", async () => {
  const a = host("first"),
    b = host("second"),
    signal = new AbortController().signal;
  const first = createBrowserDirectoryProvider(a.port),
    second = createBrowserDirectoryProvider(b.port);
  expect((await first.page("a", "", 0, options, signal)).nodes[0].name).toBe(
    "first",
  );
  expect((await second.page("b", "", 0, options, signal)).nodes[0].name).toBe(
    "second",
  );
  expect(await first.preview("a", "a.txt", signal)).toEqual({
    kind: "text",
    value: "abc",
    truncated: false,
  });
  expect(await second.contentDigest("b", "a.txt", signal)).toMatchObject({
    digest: "hash",
  });
  const location = { from: 1, to: 2, revision: "hash" };
  await first.open("a", "Root A", node, signal, location);
  expect(a.port.open).toHaveBeenCalledWith(
    { rootId: "a", rootName: "Root A", node, location },
    signal,
  );
  expect(b.port.open).not.toHaveBeenCalled();
  a.revoke();
  await expect(first.properties("a", "a.txt", signal)).rejects.toThrow(
    "revoked",
  );
  expect(await second.properties("b", "a.txt", signal)).toEqual({
    size: 3,
    modifiedMs: 1,
  });
});

it("rejects work before access and rejects late host results after revocation", async () => {
  const { port, revoke } = host("one"),
    provider = createBrowserDirectoryProvider(port);
  const stopped = new AbortController();
  stopped.abort();
  await expect(
    provider.page("r", "", 0, options, stopped.signal),
  ).rejects.toThrow();
  await expect(
    provider.open("r", "Root", node, stopped.signal),
  ).rejects.toThrow();
  expect(port.files.list).not.toHaveBeenCalled();
  expect(port.open).not.toHaveBeenCalled();
  port.files.list.mockImplementationOnce(async () => {
    revoke();
    return { nodes: [], next: null };
  });
  await expect(
    provider.page("r", "", 0, options, new AbortController().signal),
  ).rejects.toThrow("revoked");
});

it("does not turn an accepted open into a failure when it deactivates the caller", async () => {
  const { port, revoke } = host("one"),
    provider = createBrowserDirectoryProvider(port);
  const controller = new AbortController();
  port.open.mockImplementationOnce(async () => {
    revoke();
    controller.abort();
  });
  await expect(
    provider.open("r", "Root", node, controller.signal),
  ).resolves.toBeUndefined();
  expect(port.open).toHaveBeenCalledTimes(1);
});

it("preserves host save errors rather than presenting a successful open", async () => {
  const { port } = host("one"),
    provider = createBrowserDirectoryProvider(port);
  port.open.mockRejectedValueOnce(new Error("save failed"));
  await expect(
    provider.open("r", "Root", node, new AbortController().signal),
  ).rejects.toThrow("save failed");
});

it("retains preview budgets, truncation and image handling across hosts", async () => {
  const { port } = host("one"),
    provider = createBrowserDirectoryProvider(port),
    signal = new AbortController().signal;
  port.files.stat.mockResolvedValue({ size: 9 * 1024 * 1024, modifiedMs: 1 });
  await expect(provider.preview("r", "a.PNG", signal)).resolves.toMatchObject({
    kind: "image",
  });
  expect(port.files.readImageAsset).toHaveBeenCalledWith("r", "a.PNG", signal);
  await expect(provider.preview("r", "a.txt", signal)).rejects.toThrow(
    "快速预览范围",
  );
  expect(port.files.readSnapshot).not.toHaveBeenCalled();
  port.files.stat.mockResolvedValue({ size: 70000, modifiedMs: 1 });
  port.files.readSnapshot.mockResolvedValue({
    source: "x".repeat(70000),
    revision: "hash",
    size: 70000,
    modifiedMs: 1,
    bom: false,
    lineEnding: "lf",
  });
  const preview = await provider.preview("r", "a.txt", signal);
  expect(preview.truncated).toBe(true);
  expect(preview.value).toHaveLength(65536);
  expect(await provider.preview("r", "a.PNG", signal)).toEqual({
    kind: "image",
    value: "data:image/png;base64,AA==",
    truncated: false,
  });
});

it("keeps text fingerprint validation and delegates raw digest limits to the file host", async () => {
  const { port } = host("one"),
    provider = createBrowserDirectoryProvider(port),
    signal = new AbortController().signal;
  port.files.stat.mockResolvedValueOnce({
    size: 5 * 1024 * 1024,
    modifiedMs: 1,
  });
  await expect(provider.contentDigest("r", "a.txt", signal)).rejects.toThrow(
    "4 MiB",
  );
  expect(port.files.readSnapshot).not.toHaveBeenCalled();
  port.files.stat
    .mockResolvedValueOnce({ size: 3, modifiedMs: 1 })
    .mockResolvedValueOnce({ size: 3, modifiedMs: 2 });
  await expect(provider.contentDigest("r", "a.txt", signal)).rejects.toThrow(
    "文件已变化",
  );
  expect(provider.digestByteLimit()).toBe(16 * 1024 * 1024);
  expect(await provider.contentDigest("r", "a.bin", signal, true)).toEqual({
    digest: "raw-hash",
    size: 3,
    modifiedMs: 1,
  });
});
it("a cancelled or revoked image preview releases its newly created Blob URL", async () => {
  const { port } = host("one");
  const controller = new AbortController();
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  Object.assign(port.files, {
    readImagePreview: vi.fn(async () => {
      controller.abort();
      return "blob:cancelled-image";
    }),
  });
  const provider = createBrowserDirectoryProvider(port);
  await expect(
    provider.preview("r", "photo.png", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(revoke).toHaveBeenCalledWith("blob:cancelled-image");
  expect(port.files.readImageAsset).not.toHaveBeenCalled();
});
