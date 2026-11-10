import { expect, it, vi } from "vitest";
import { createBrowserViewMenu } from "../../src/lib/local-files/browser-view-menu";
import {
  installWorkbenchViewMenu,
  type ViewMenuTransport,
} from "../../src/apps/file-workbench/native-view-menu";
import {
  localFileTreeNodes,
  localFileTypeLabel,
  isLocalFileSort,
} from "../../src/lib/local-files/tree";
import {
  parseBrowserColumns,
  clampBrowserColumn,
} from "../../src/lib/local-files/browser-preferences";
it("menu commands never own pane state and disabled commands have no effect", () => {
  const menu = createBrowserViewMenu(),
    changed = vi.fn(),
    toggle = vi.fn();
  const unsubscribe = menu.subscribe(changed),
    remove = menu.onToggleHidden(toggle);
  menu.toggleHidden();
  expect(toggle).not.toHaveBeenCalled();
  menu.update({ enabled: true, showHidden: false });
  menu.toggleHidden();
  expect(toggle).toHaveBeenCalledOnce();
  expect(menu.getSnapshot().showHidden).toBe(false);
  menu.update({ enabled: true, showHidden: true });
  menu.update({ enabled: true, showHidden: true });
  expect(changed).toHaveBeenCalledTimes(2);
  remove();
  unsubscribe();
  menu.update({ enabled: false, showHidden: false });
  menu.toggleHidden();
  expect(toggle).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledTimes(2);
});
it("native menu updates serialize and disposal rejects late events/updates", async () => {
  const menu = createBrowserViewMenu(),
    error = vi.fn(),
    unlisten = vi.fn();
  let event = () => {},
    release: (() => void) | undefined;
  const transport: ViewMenuTransport = {
    listen: vi.fn(async (callback) => {
      event = callback;
      return unlisten;
    }),
    update: vi.fn(async () => {}),
  };
  const dispose = await installWorkbenchViewMenu(menu, error, transport);
  expect(transport.update).toHaveBeenCalledWith({
    enabled: false,
    showHidden: false,
  });
  vi.mocked(transport.update).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  menu.update({ enabled: true, showHidden: false });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  menu.update({ enabled: true, showHidden: true });
  menu.update({ enabled: false, showHidden: true });
  const toggle = vi.fn();
  menu.onToggleHidden(toggle);
  event();
  expect(toggle).not.toHaveBeenCalled();
  release!();
  await vi.waitFor(() =>
    expect(transport.update).toHaveBeenLastCalledWith({
      enabled: false,
      showHidden: true,
    }),
  );
  dispose();
  event();
  menu.update({ enabled: true, showHidden: true });
  event();
  await Promise.resolve();
  expect(unlisten).toHaveBeenCalledOnce();
  expect(toggle).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
it("native initialization failure releases its listener; subsequent errors are reported", async () => {
  const menu = createBrowserViewMenu(),
    unlisten = vi.fn(),
    error = vi.fn();
  const transport: ViewMenuTransport = {
    listen: async () => unlisten,
    update: vi.fn(async () => {
      throw new Error("IPC unavailable");
    }),
  };
  await expect(
    installWorkbenchViewMenu(menu, error, transport),
  ).rejects.toThrow("IPC unavailable");
  expect(unlisten).toHaveBeenCalledOnce();
  vi.mocked(transport.update).mockResolvedValueOnce();
  const dispose = await installWorkbenchViewMenu(menu, error, transport);
  menu.update({ enabled: true, showHidden: false });
  await vi.waitFor(() =>
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "IPC unavailable" }),
    ),
  );
  dispose();
});
it("type labels and extension sorting are bounded metadata; directories always come first", () => {
  const node = (name: string, directory = false) => ({
    id: name,
    name,
    directory,
    size: 0,
  });
  for (const [name, label] of [
    ["main.c", "C 源码"],
    ["readme.md", "Markdown"],
    ["notes.txt", "Text"],
    ["Makefile", "Makefile"],
    [".gitignore", "文件"],
    ["data.weird", "WEIRD 文件"],
  ])
    expect(localFileTypeLabel(node(name))).toBe(label);
  expect(localFileTypeLabel(node("src", true))).toBe("文件夹");
  const values = [
    node("a.txt"),
    node("z.c"),
    node("a.c"),
    node("folder", true),
  ];
  expect(isLocalFileSort("type-desc")).toBe(true);
  expect(
    localFileTreeNodes(values, {
      sort: "type-desc",
      showHidden: true,
      query: "",
    }).map((item) => item.name),
  ).toEqual(["folder", "a.txt", "a.c", "z.c"]);
  expect(
    localFileTreeNodes(values, {
      sort: "type",
      showHidden: true,
      query: "",
    }).map((item) => item.name),
  ).toEqual(["folder", "a.c", "z.c", "a.txt"]);
  expect(
    parseBrowserColumns(JSON.stringify({ name: 230, size: 80, modified: 150 }))
      .type,
  ).toBe(90);
  expect(clampBrowserColumn("type", -10)).toBe(64);
});
