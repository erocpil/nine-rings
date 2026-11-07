import { expect, it, vi } from "vitest";
import {
  readBrowserRefresh,
  browserRefreshScroll,
  browserRefreshSelection,
} from "../../src/lib/local-files/browser-refresh";
import type { FileNode } from "../../src/lib/local-files/service";

const options = { sort: "name", showHidden: true, query: "" } as const;
const items = (count: number) =>
  Array.from({ length: count }, (_, id): FileNode => ({
    id: `${id}`,
    name: `${id}`,
    directory: false,
    size: id,
    modifiedMs: id,
  }));
it("retains the loaded extent, respects cancellation, and rejects a nonadvancing cursor", async () => {
  const nodes = items(450);
  const provider = {
    page: vi.fn(async (_r, _n, offset: number) => ({
      nodes: nodes.slice(offset, offset + 200),
      next: offset + 200 < nodes.length ? offset + 200 : null,
    })),
    properties: vi.fn(),
  };
  const result = await readBrowserRefresh(
    provider,
    "r",
    "",
    options,
    400,
    [],
    new AbortController().signal,
  );
  expect(result.page.nodes).toHaveLength(400);
  expect(result.page.next).toBe(400);
  expect(provider.page.mock.calls.map((call) => call[2])).toEqual([0, 200]);
  expect(provider.properties).not.toHaveBeenCalled();
  const controller = new AbortController();
  controller.abort();
  await expect(
    readBrowserRefresh(provider, "r", "", options, 400, [], controller.signal),
  ).rejects.toThrow();
  expect(provider.page).toHaveBeenCalledTimes(2);
  provider.page.mockImplementation(async () => ({ nodes: [], next: 1 }));
  await expect(
    readBrowserRefresh(
      provider,
      "r",
      "",
      options,
      400,
      [],
      new AbortController().signal,
    ),
  ).rejects.toThrow("游标");
});
it("does not accept late results or hide page errors", async () => {
  const controller = new AbortController();
  const provider = {
    page: vi.fn(async () => {
      controller.abort();
      return { nodes: items(2), next: null };
    }),
    properties: vi.fn(),
  };
  await expect(
    readBrowserRefresh(provider, "r", "", options, 1, [], controller.signal),
  ).rejects.toThrow();
  expect(provider.properties).not.toHaveBeenCalled();
  provider.page.mockRejectedValue(new Error("grant expired"));
  await expect(
    readBrowserRefresh(
      provider,
      "r",
      "",
      options,
      1,
      [],
      new AbortController().signal,
    ),
  ).rejects.toThrow("grant expired");
});
it("samples at most 64 visible browser fingerprints, at most four at once, without reading bodies", async () => {
  const nodes = items(100).map((node) => ({ ...node, modifiedMs: undefined }));
  let running = 0,
    peak = 0;
  const properties = vi.fn(async (_root: string, id: string) => {
    running++;
    peak = Math.max(peak, running);
    await Promise.resolve();
    running--;
    if (id === "3") throw new Error("unreadable");
    return { size: 10, modifiedMs: 20 };
  });
  const result = await readBrowserRefresh(
    { page: async () => ({ nodes, next: null }), properties },
    "r",
    "",
    options,
    100,
    nodes.map((node) => node.id),
    new AbortController().signal,
  );
  expect(properties).toHaveBeenCalledTimes(64);
  expect(peak).toBe(4);
  expect(Object.keys(result.properties)).toHaveLength(63);
  expect(result.properties["3"]).toBeUndefined();
  expect(result.page.nodes).toHaveLength(100);
});
it("rejects cancelled metadata reads and empty paging loops", async () => {
  const controller = new AbortController();
  const provider = {
    page: async () => ({
      nodes: [{ ...items(1)[0], modifiedMs: undefined }],
      next: null,
    }),
    properties: async () => {
      controller.abort();
      throw new Error("late");
    },
  };
  await expect(
    readBrowserRefresh(provider, "r", "", options, 1, ["0"], controller.signal),
  ).rejects.toThrow();
  let offset = 0;
  await expect(
    readBrowserRefresh(
      { ...provider, page: async () => ({ nodes: [], next: ++offset }) },
      "r",
      "",
      options,
      300,
      [],
      new AbortController().signal,
    ),
  ).rejects.toThrow("没有新增");
});
it("anchors visible rows through insertion/deletion, clamps short lists and only prunes proven missing selections", () => {
  const before = items(100),
    after = [{ ...before[0], id: "new" }, ...before];
  expect(browserRefreshScroll(before, after, 643, 32, 400)).toBe(675);
  expect(
    browserRefreshScroll(
      before,
      before.filter((node) => node.id !== "20"),
      643,
      32,
      400,
    ),
  ).toBe(611);
  expect(browserRefreshScroll(before, [], 643, 32, 400)).toBe(0);
  expect(browserRefreshScroll(before, before.slice(0, 10), 2400, 32, 64)).toBe(
    256,
  );
  expect(
    browserRefreshSelection(["0", "90"], {
      nodes: before.slice(0, 10),
      next: 10,
    }),
  ).toEqual(["0", "90"]);
  expect(
    browserRefreshSelection(["0", "90"], {
      nodes: before.slice(0, 10),
      next: null,
    }),
  ).toEqual(["0"]);
});
