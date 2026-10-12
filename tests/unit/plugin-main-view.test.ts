import { expect, it } from "vitest";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
import { MainViewRegistry } from "../../src/lib/plugin-system/main-view-registry";
const view = { id: "test.images", label: "图片", renderer: "image" } as const;
const data = {
  image: { src: "/picture.png", name: "图片" },
  images: [{ src: "/picture.png", name: "图片" }],
};
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
