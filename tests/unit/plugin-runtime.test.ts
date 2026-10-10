import { expect, it, vi, afterEach } from "vitest";
import {
  PluginRuntime,
  pluginRuntime,
  PLUGINS_ENABLED_KEY,
  setPluginsEnabled,
  startPluginRuntime,
} from "../../src/lib/plugin-system/runtime";
afterEach(() => {
  pluginRuntime.setEnabled(false);
  vi.unstubAllGlobals();
});
it("disabled by default; copied activations and undeclared grants have no authority", () => {
  const host = new PluginRuntime();
  expect(() => host.activate("test.demo", [])).toThrow("插件功能已关闭");
  host.setEnabled(true);
  const activation = host.activate("test.demo", ["editor.selection.read"]);
  expect(() => host.assert(activation, "editor.selection.write")).toThrow(
    "未获得",
  );
  expect(() => host.assert({ ...activation })).toThrow("已失效");
});
it("disable aborts old work, re-enable and reactivation never revive old authority", () => {
  const host = new PluginRuntime();
  host.setEnabled(true);
  const first = host.activate("test.demo", []);
  const signal = host.assert(first);
  host.setEnabled(false);
  expect(signal.aborted).toBe(true);
  host.setEnabled(true);
  const second = host.activate("test.demo", []);
  expect(second.generation).not.toBe(first.generation);
  expect(() => host.assert(first)).toThrow();
  host.deactivate("test.demo");
  expect(() => host.assert(second)).toThrow();
});
it("preference is device-local, cross-window disabling cancels activations, failed persistence cannot enable", () => {
  const values = new Map<string, string>();
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const stop = startPluginRuntime();
  expect(pluginRuntime.isEnabled()).toBe(false);
  setPluginsEnabled(true);
  const activation = pluginRuntime.activate("test.demo", []);
  const signal = pluginRuntime.assert(activation);
  values.set(PLUGINS_ENABLED_KEY, "false");
  const change = new Event("storage");
  Object.assign(change, { key: PLUGINS_ENABLED_KEY });
  events.dispatchEvent(change);
  expect(signal.aborted).toBe(true);
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw new Error("quota");
    },
  });
  expect(() => setPluginsEnabled(true)).toThrow("quota");
  expect(pluginRuntime.isEnabled()).toBe(false);
  stop();
});

it("activation owns resources, releases in reverse order and isolates cleanup failures", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const activation = runtime.activate("test.owner", []);
  const order: number[] = [];
  const first = runtime.own(activation, () => order.push(1));
  runtime.own(activation, () => {
    order.push(2);
    throw new Error("cleanup");
  });
  runtime.own(activation, () => order.push(3));
  runtime.deactivate("test.owner");
  first();
  runtime.deactivate("test.owner");
  expect(order).toEqual([3, 2, 1]);
  expect(() => runtime.own(activation, () => {})).toThrow("已失效");
});

it("explicit disposal unregisters ownership and reactivation releases old resources", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const activation = runtime.activate("test.owner", []);
  const cleanup = vi.fn();
  const dispose = runtime.own(activation, cleanup);
  dispose();
  dispose();
  runtime.activate("test.owner", []);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("management status is stable, immutable and records only safe cleanup diagnostics", () => {
  const runtime = new PluginRuntime();
  const notify = vi.fn();
  const stop = runtime.subscribe(notify);
  expect(runtime.getStatus()).toBe(runtime.getStatus());
  runtime.setEnabled(true);
  const activation = runtime.activate("test.status", [
    "documents.current.read",
  ]);
  runtime.own(activation, () => {
    throw new Error("secret document text");
  });
  expect(runtime.getStatus().activations[0]).toMatchObject({
    pluginId: "test.status",
    resources: 1,
  });
  expect(Object.isFrozen(runtime.getStatus().activations)).toBe(true);
  runtime.deactivate("test.status");
  expect(runtime.getStatus().activations).toEqual([]);
  expect(runtime.getStatus().cleanupFailures).toBe(1);
  expect(JSON.stringify(runtime.getStatus())).not.toContain("secret");
  expect(notify).toHaveBeenCalled();
  stop();
});
