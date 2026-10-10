import { expect, it, vi } from "vitest";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
import { PluginLifecycle } from "../../src/lib/plugin-system/lifecycle";
function setup() {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  return { runtime, lifecycle: new PluginLifecycle(runtime) };
}
it("activation failure releases owned resources and allows explicit retry", async () => {
  const { lifecycle } = setup();
  const cleanup = vi.fn();
  await expect(
    lifecycle.activate("test.life", [], {
      activate(ctx) {
        ctx.own(cleanup);
        throw new Error("secret");
      },
    }),
  ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  expect(cleanup).toHaveBeenCalledTimes(1);
  await lifecycle.activate("test.life", [], { activate() {} });
  await lifecycle.deactivate("test.life");
});
it("timed out activation rejects late resource registration", async () => {
  const { lifecycle } = setup();
  let context!: Parameters<
    Parameters<PluginLifecycle["activate"]>[2]["activate"]
  >[0];
  await expect(
    lifecycle.activate(
      "test.life",
      [],
      {
        activate(ctx) {
          context = ctx;
          return new Promise(() => {});
        },
      },
      10,
    ),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(context.signal.aborted).toBe(true);
  expect(() => context.own(() => {})).toThrow("已失效");
});
it("concurrent activation is rejected; global disable cancels activation promptly", async () => {
  const { runtime, lifecycle } = setup();
  const pending = lifecycle.activate("test.life", [], {
    activate() {
      return new Promise(() => {});
    },
  });
  await expect(
    lifecycle.activate("test.life", [], { activate() {} }),
  ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  runtime.setEnabled(false);
  await expect(pending).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });
  runtime.setEnabled(true);
  await lifecycle.activate("test.life", [], { activate() {} });
  await lifecycle.deactivate("test.life");
});
it("deactivation revokes authority before asynchronous cleanup and bounds hung hooks", async () => {
  const { runtime, lifecycle } = setup();
  const cleanup = vi.fn();
  const activation = await lifecycle.activate("test.life", [], {
    activate(ctx) {
      ctx.own(cleanup);
    },
    deactivate() {
      return new Promise(() => {});
    },
  });
  const stopped = lifecycle.deactivate("test.life", 10);
  expect(() => runtime.assert(activation)).toThrow("已失效");
  expect(cleanup).toHaveBeenCalledTimes(1);
  await expect(stopped).rejects.toMatchObject({ code: "TIMEOUT" });
  await lifecycle.activate("test.life", [], { activate() {} });
  await lifecycle.deactivate("test.life");
});

it("global disable runs asynchronous cleanup once and reports safe failures", async () => {
  const { runtime, lifecycle } = setup();
  const stop = vi.fn(async () => {
    throw new Error("secret");
  });
  await lifecycle.activate("test.life", [], {
    activate() {},
    deactivate: stop,
  });
  runtime.setEnabled(false);
  await vi.waitFor(() => expect(runtime.getStatus().cleanupFailures).toBe(1));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(runtime.getStatus())).not.toContain("secret");
});
