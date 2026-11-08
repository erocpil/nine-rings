import { expect, it } from "vitest";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
import { MainViewRegistry } from "../../src/lib/plugin-system/main-view-registry";
const view = { id: "test.images", label: "图片", renderer: "image" } as const;
const data = {
  image: { src: "/picture.png", name: "图片" },
  images: [{ src: "/picture.png", name: "图片" }],
};
it("relocates mounted and suspended file identities without replacing unrelated pending navigation", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const registry = new MainViewRegistry(runtime);
  const actor = runtime.activate("test.move", [
    "views.present",
    "filesystem.files.read",
    "filesystem.files.write",
  ]);
  registry.register(actor, {
    id: "test.file",
    label: "文件",
    renderer: "local-file",
  });
  const id = registry.open(actor, "test.file", {
    rootId: "old",
    nodeId: "src/a.c",
    name: "a.c",
  });
  registry.accept(id);
  registry.suspend();
  const pending = registry.open(actor, "test.file", {
    rootId: "other",
    nodeId: "b.c",
    name: "b.c",
  });
  const request = registry.getSnapshot().pending;
  registry.relocateLocalFile(actor, "old", "src", "new", "moved");
  expect(registry.getSnapshot().current).toMatchObject({
    id,
    data: { rootId: "new", nodeId: "moved/a.c" },
  });
  expect(registry.getSnapshot().suspended).toBe(true);
  expect(registry.getSnapshot().pending).toBe(request);
  registry.relocateLocalFile(actor, "other", "b.c", "new", "renamed.c");
  expect(registry.getSnapshot().pending).toMatchObject({
    id: pending,
    data: { rootId: "new", nodeId: "renamed.c", name: "renamed.c" },
  });
  expect(registry.accept(pending)).toBe(true);
  expect(registry.getSnapshot().suspended).toBe(false);
  const reader = runtime.activate("test.read", ["filesystem.files.read"]);
  expect(() =>
    registry.relocateLocalFile(reader, "new", "renamed.c", "new", "no.c"),
  ).toThrow();
});
it("retains a scoped browser behind its viewers, gates return through pending, and clears on navigation/revocation", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const views = new MainViewRegistry(runtime);
  const owner = runtime.activate("test.browser", [
    "views.present",
    "filesystem.files.read",
  ]);
  views.register(owner, {
    id: "test.browser",
    label: "文件浏览",
    renderer: "file-browser",
  });
  views.register(owner, {
    id: "test.file",
    label: "文件",
    renderer: "local-file",
  });
  const browser = views.open(owner, "test.browser", { rootId: "r" });
  expect(views.getSnapshot().browser).toBeNull();
  views.accept(browser);
  const retained = views.getSnapshot().browser;
  const file = views.open(owner, "test.file", {
    rootId: "r",
    nodeId: "a.c",
    name: "a.c",
  });
  views.accept(file);
  expect(views.getSnapshot().browser).toBe(retained);
  views.close(file);
  expect(views.getSnapshot().current?.id).toBe(file);
  expect(views.getSnapshot().pending?.id).toBe(browser);
  views.reject(browser); // A failed save/checkpoint keeps the viewer and return target.
  expect(views.getSnapshot().current?.id).toBe(file);
  views.close(file);
  views.accept(browser);
  expect(views.getSnapshot().current).toBe(retained);
  views.close();
  expect(views.getSnapshot().browser).toBeNull();
  views.accept(views.open(owner, "test.browser", {}));
  runtime.deactivate(owner.pluginId);
  expect(views.getSnapshot().browser).toBeNull();
  expect(views.getSnapshot().current).toBeNull();
});
it("rejects browser requests without read authority, arbitrary UI and invalid data", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const views = new MainViewRegistry(runtime);
  const owner = runtime.activate("test.browser", ["views.present"]);
  views.register(owner, {
    id: "test.browser",
    label: "浏览",
    renderer: "file-browser",
  });
  expect(() => views.open(owner, "test.browser", {})).toThrow();
  const reader = runtime.activate("test.reader", [
    "views.present",
    "filesystem.files.read",
  ]);
  views.register(reader, {
    id: "test.reader",
    label: "浏览",
    renderer: "file-browser",
  });
  for (const value of [
    null,
    [],
    { rootId: "" },
    { rootId: 1 },
    { rootId: "r", html: "<div>" },
  ])
    expect(() => views.open(reader, "test.reader", value as never)).toThrow();
  expect(() => views.open(reader, "test.reader", {})).not.toThrow();
});
it("requires host-issued authority and declares only supported renderers", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const views = new MainViewRegistry(runtime);
  const none = runtime.activate("test.none", []);
  expect(() => views.register(none, view)).toThrow();
  const owner = runtime.activate("test.plugin", ["views.present"]);
  expect(() => views.register({ ...owner }, view)).toThrow();
  expect(() =>
    views.register(owner, { ...view, renderer: "html" } as never),
  ).toThrow();
  views.register(owner, view);
  expect(() => views.register(owner, view)).toThrow();
  expect(() => views.open(none, view.id, data)).toThrow();
  expect(() => views.open(owner, view.id, { ...data, images: [] })).toThrow();
  expect(() =>
    views.open(owner, view.id, {
      ...data,
      image: { src: "", name: "a", rootId: "root", nodeId: "picture.png" },
    }),
  ).toThrow();
});
it("keeps the previous view during saving, discards stale navigation, and revokes live and pending contributions", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const views = new MainViewRegistry(runtime);
  const owner = runtime.activate("test.plugin", ["views.present"]);
  views.register(owner, view);
  const first = views.open(owner, view.id, data);
  expect(views.getSnapshot().current).toBeNull();
  expect(views.accept(first)).toBe(true);
  const second = views.open(owner, view.id, data);
  views.reject(second); // Failed save must retain the current view.
  expect(views.getSnapshot().current?.id).toBe(first);
  const third = views.open(owner, view.id, data);
  const latest = views.open(owner, view.id, data);
  expect(views.accept(third)).toBe(false);
  views.accept(latest);
  views.close(first); // Stale renderer cleanup must not close its replacement.
  expect(views.getSnapshot().current?.id).toBe(latest);
  views.suspend();
  expect(views.getSnapshot().suspended).toBe(true);
  views.resume();
  expect(views.getSnapshot().suspended).toBe(false);
  views.open(owner, view.id, data);
  runtime.deactivate(owner.pluginId);
  expect(views.getSnapshot().current).toBeNull();
  expect(views.getSnapshot().pending).toBeNull();
  expect(views.accept(latest)).toBe(false);
  expect(() => views.open(owner, view.id, data)).toThrow();
});

it("binds plugin view operations to their owner without delegating host acceptance", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const views = new MainViewRegistry(runtime);
  const owner = runtime.activate("test.first", ["views.present"]);
  const other = runtime.activate("test.second", ["views.present"]);
  const host = views.bind(owner);
  host.register(view);
  const request = host.open(view.id, data);
  views.accept(request);
  expect(() => views.bind(other).close(request)).toThrow();
  expect(views.getSnapshot().current?.id).toBe(request);
  expect("accept" in host).toBe(false);
  host.close(request);
  expect(views.getSnapshot().current).toBeNull();
  runtime.deactivate(owner.pluginId);
  expect(() => host.open(view.id, data)).toThrow();
});

it("vocabulary views require scoped document authority, bounded immutable data and revoke pending/live content", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const views = new MainViewRegistry(runtime);
  const declaration = {
    id: "test.words",
    label: "词汇",
    renderer: "vocabulary",
  } as const;
  const limited = runtime.activate("test.limited", ["views.present"]);
  views.register(limited, declaration);
  const data = { documentId: "word", title: "sample", source: "# sample" };
  expect(() => views.open(limited, declaration.id, data)).toThrow();
  runtime.deactivate(limited.pluginId);
  const owner = runtime.activate("test.words", [
    "views.present",
    "documents.vocabulary.read",
  ]);
  views.register(owner, declaration);
  expect(() =>
    views.open(owner, declaration.id, { ...data, source: "x".repeat(250001) }),
  ).toThrow();
  expect(() =>
    views.open(owner, declaration.id, { ...data, html: "unsafe" } as never),
  ).toThrow();
  const request = views.open(owner, declaration.id, data);
  data.source = "changed";
  views.accept(request);
  expect(views.getSnapshot().current?.data).toMatchObject({
    source: "# sample",
  });
  views.open(owner, declaration.id, data);
  runtime.deactivate(owner.pluginId);
  expect(views.getSnapshot()).toMatchObject({ current: null, pending: null });
});
