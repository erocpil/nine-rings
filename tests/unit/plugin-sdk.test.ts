import { afterEach, expect, it, vi } from "vitest";
import { AutoSaveQueue } from "../../src/lib/auto-save-queue";
import { DocumentEditSessions } from "../../src/lib/document-edit-sessions";
import { HostCommandDispatcher } from "../../src/lib/plugin-system/command-dispatcher";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
import {
  createSdkHost,
  bindSdkHostPort,
} from "../../src/lib/plugin-system/sdk-host";
import {
  createPluginSdk,
  createLoopbackSdkTransport,
  createPortSdkTransport,
} from "../../src/lib/plugin-system/sdk-client";
import {
  cloneSdkValue,
  parseSdkResponse,
} from "../../src/lib/plugin-system/sdk-protocol";
vi.mock("../../src/lib/api", () => ({
  api: {
    notes: {
      get: async () => ({
        id: "a",
        readonly: false,
        content: { ops: [] },
        storagePath: "ideas",
      }),
    },
  },
}));
vi.mock("../../src/lib/storage/protection-state", () => ({
  withProtectionWrite: async (task: () => unknown) => task(),
  listProtectedPaths: async () => [],
}));
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup(kind: "loopback" | "port", writable = true) {
  const queue = new AutoSaveQueue(async () => {});
  const sessions = new DocumentEditSessions(queue);
  const owner = {};
  sessions.retain("a");
  sessions.activate("a", owner, "rendered", true);
  sessions.select("a", owner, "rendered", { from: 1, to: 1 });
  const insert = vi.fn((_range, content) => {
    queue.mark("a", "content", { ops: [{ insert: content.value }] });
    return true;
  });
  sessions.bind("a", owner, "rendered", { editable: () => true, insert });
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const activation = runtime.activate(
    "test.sdk",
    writable
      ? [
          "editor.selection.write",
          "editor.selection.read",
          "documents.current.read",
        ]
      : ["documents.current.read"],
  );
  const dispatcher = new HostCommandDispatcher(runtime, sessions, () => ({
    platform: "web",
    view: "render",
    documentId: "a",
  }));
  const host = createSdkHost(runtime, activation, dispatcher);
  let transport;
  if (kind === "port") {
    const channel = new MessageChannel();
    cleanup.push(bindSdkHostPort(host, channel.port1));
    transport = createPortSdkTransport(channel.port2);
  } else transport = createLoopbackSdkTransport(host);
  const sdk = createPluginSdk(transport);
  cleanup.push(() => sdk.dispose());
  return {
    queue,
    sessions,
    owner,
    runtime,
    activation,
    dispatcher,
    host,
    sdk,
    insert,
  };
}

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: capabilities and execution use host identity and a frozen request`, async () => {
    const h = setup(kind);
    h.dispatcher.register(
      h.activation,
      {
        id: "test.sdk.insert",
        scope: "selection",
        risk: "write",
        args: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      (ctx) => ctx.commit({ type: "text", value: ctx.args.text as string }),
    );
    expect(await h.sdk.capabilities()).toMatchObject({
      protocol: 1,
      platform: "web",
      view: "render",
      commands: [{ id: "test.sdk.insert" }],
    });
    const args = { text: "original" };
    const work = h.sdk.execute("test.sdk.insert", args);
    args.text = "mutated";
    expect(await work).toMatchObject({ ok: true, applied: true });
    expect(h.insert).toHaveBeenCalledWith(
      { from: 1, to: 1 },
      { type: "text", value: "original" },
    );
    await h.queue.flushAll();
    expect(h.queue.revisionState("a").confirmedRevision).toBe(1);
  });
  it(`${kind}: missing grants hide commands and reject direct execution`, async () => {
    const h = setup(kind, false);
    h.dispatcher.register(
      h.activation,
      { id: "test.sdk.insert", scope: "selection", risk: "write" },
      (ctx) => ctx.commit({ type: "text", value: "blocked" }),
    );
    expect((await h.sdk.capabilities()).commands).toEqual([]);
    expect(await h.sdk.execute("test.sdk.insert")).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "PERMISSION_DENIED" },
    });
    expect(h.insert).not.toHaveBeenCalled();
  });
  it(`${kind}: disable and reactivation never revive the old connection`, async () => {
    const h = setup(kind);
    h.runtime.setEnabled(false);
    h.runtime.setEnabled(true);
    h.runtime.activate("test.sdk", ["editor.selection.write"]);
    await expect(h.sdk.capabilities()).rejects.toMatchObject({
      code: "PLUGIN_DISABLED",
    });
    expect(await h.sdk.execute("test.sdk.insert")).toMatchObject({
      error: { code: "PLUGIN_DISABLED" },
    });
  });
  it(`${kind}: cancellation reaches an async handler and prevents its late commit`, async () => {
    const h = setup(kind),
      gate = deferred(),
      entered = deferred();
    h.dispatcher.register(
      h.activation,
      { id: "test.sdk.wait", scope: "selection", risk: "write" },
      async (ctx) => {
        entered.resolve();
        await gate.promise;
        await ctx.commit({ type: "text", value: "late" });
      },
    );
    const controller = new AbortController();
    const work = h.sdk.execute(
      "test.sdk.wait",
      {},
      { signal: controller.signal },
    );
    await entered.promise;
    controller.abort();
    expect(await work).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "CANCELLED" },
    });
    gate.resolve();
    await Promise.resolve();
    expect(h.insert).not.toHaveBeenCalled();
  });
  it(`${kind}: view changes while executing reject the captured target`, async () => {
    const h = setup(kind),
      gate = deferred(),
      entered = deferred();
    h.dispatcher.register(
      h.activation,
      { id: "test.sdk.wait", scope: "selection", risk: "write" },
      async (ctx) => {
        entered.resolve();
        await gate.promise;
        await ctx.commit({ type: "text", value: "late" });
      },
    );
    const work = h.sdk.execute("test.sdk.wait");
    await entered.promise;
    h.sessions.activate("a", h.owner, "source", true);
    gate.resolve();
    expect(await work).toMatchObject({
      error: { code: "STALE_TARGET" },
      applied: false,
    });
    expect(h.insert).not.toHaveBeenCalled();
  });
  it(`${kind}: a result rejected by the wire budget preserves an accepted edit`, async () => {
    const h = setup(kind);
    h.dispatcher.register(
      h.activation,
      { id: "test.sdk.large", scope: "selection", risk: "write" },
      async (ctx) => {
        await ctx.commit({ type: "text", value: "accepted" });
        return "中".repeat(50000);
      },
    );
    expect(await h.sdk.execute("test.sdk.large")).toMatchObject({
      ok: false,
      applied: true,
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(h.insert).toHaveBeenCalledOnce();
  });
}

it("wire requests reject self-declared identity, entry and protocol; IDs cannot replay", async () => {
  const h = setup("loopback");
  const request = {
    protocol: 1,
    requestId: "one",
    method: "capabilities.query",
    params: {},
  };
  expect(
    (await h.host.receive({ ...request, pluginId: "test.other" })).response,
  ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  expect(
    (await h.host.receive({ ...request, protocol: 2 })).response,
  ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  expect(
    (await h.host.receive({ ...request, params: { entry: "macro" } })).response,
  ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  expect((await h.host.receive(request)).response.ok).toBe(true);
  expect((await h.host.receive(request)).response).toMatchObject({
    error: { code: "DUPLICATE_REQUEST" },
  });
});
it("wire encoding rejects callbacks, accessors, cycles and oversized Unicode", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const getter = vi.fn(() => "secret");
  const accessor = Object.defineProperty({}, "value", {
    get: getter,
    enumerable: true,
  });
  for (const input of [
    { callback: () => {} },
    accessor,
    cyclic,
    { value: "中".repeat(50000) },
    new Date(),
    Array(1000000),
  ])
    expect(() => cloneSdkValue(input)).toThrow("SDK 消息无效");
  expect(getter).not.toHaveBeenCalled();
});

it("a saturated connection still accepts cancellation and host disposal stops all pending commands", async () => {
  const h = setup("loopback"),
    gate = deferred();
  h.dispatcher.register(
    h.activation,
    { id: "test.sdk.wait", scope: "app", risk: "read" },
    async () => {
      await gate.promise;
      return "late";
    },
  );
  const requests = Array.from({ length: 32 }, (_, index) =>
    h.host.receive({
      protocol: 1,
      requestId: `wait-${index}`,
      method: "commands.execute",
      params: { commandId: "test.sdk.wait" },
    }),
  );
  expect(
    (
      await h.host.receive({
        protocol: 1,
        requestId: "extra",
        method: "commands.execute",
        params: { commandId: "test.sdk.wait" },
      })
    ).response,
  ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  expect(
    (
      await h.host.receive({
        protocol: 1,
        requestId: "cancel",
        method: "requests.cancel",
        params: { requestId: "wait-0" },
      })
    ).response.ok,
  ).toBe(true);
  expect((await requests[0]).response).toMatchObject({
    error: { code: "CANCELLED" },
  });
  h.host.dispose();
  for (const response of await Promise.all(requests))
    expect(response.response).toMatchObject({
      error: { code: "CANCELLED" },
      applied: false,
    });
  gate.resolve();
  expect(h.insert).not.toHaveBeenCalled();
});

it("the response protocol rejects contradictory or malformed completion states", () => {
  for (const response of [
    { ok: true, requestId: "one", applied: false },
    { ok: true, requestId: "one", applied: "yes", value: null },
    {
      ok: false,
      requestId: "one",
      applied: false,
      error: { code: "RAW_SQL", message: "private" },
    },
    { ok: true, requestId: "one", applied: false, value: null, error: {} },
  ])
    expect(() => parseSdkResponse({ protocol: 1, response })).toThrow(
      "SDK 响应协议无效",
    );
});

it("host-bound identity and entry cannot execute another plugin's or menu-only command", async () => {
  const h = setup("port");
  const other = h.runtime.activate("test.other", []);
  h.dispatcher.register(
    other,
    { id: "test.other.private", scope: "app", risk: "read" },
    () => "other result",
  );
  h.dispatcher.register(
    h.activation,
    {
      id: "test.sdk.menu",
      scope: "app",
      risk: "read",
      exposure: { palette: false, menu: true },
    },
    () => "menu result",
  );
  expect(await h.sdk.execute("test.other.private")).toMatchObject({
    error: { code: "COMMAND_NOT_FOUND" },
  });
  expect(await h.sdk.execute("test.sdk.menu")).toMatchObject({
    error: { code: "PERMISSION_DENIED" },
  });
  expect((await h.sdk.capabilities()).commands).toEqual([]);
  const menuHost = createSdkHost(h.runtime, h.activation, h.dispatcher, "menu");
  const menuSdk = createPluginSdk(createLoopbackSdkTransport(menuHost));
  cleanup.push(() => menuSdk.dispose());
  expect(await menuSdk.execute("test.sdk.menu")).toMatchObject({
    ok: true,
    value: "menu result",
  });
});

it("exhausting the connection ID budget never prevents cancelling an existing request", async () => {
  const h = setup("loopback"),
    gate = deferred();
  h.dispatcher.register(
    h.activation,
    { id: "test.sdk.wait", scope: "app", risk: "read" },
    async () => {
      await gate.promise;
      return null;
    },
  );
  const work = h.host.receive({
    protocol: 1,
    requestId: "wait",
    method: "commands.execute",
    params: { commandId: "test.sdk.wait" },
  });
  for (let index = 0; index < 4095; index++)
    await h.host.receive({
      protocol: 1,
      requestId: `query-${index}`,
      method: "capabilities.query",
      params: {},
    });
  expect(
    (
      await h.host.receive({
        protocol: 1,
        requestId: "extra",
        method: "capabilities.query",
        params: {},
      })
    ).response,
  ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  expect(
    (
      await h.host.receive({
        protocol: 1,
        requestId: "cancel",
        method: "requests.cancel",
        params: { requestId: "wait" },
      })
    ).response.ok,
  ).toBe(true);
  expect((await work).response).toMatchObject({ error: { code: "CANCELLED" } });
  gate.resolve();
});

it("closing a client port reports uncertain execution; the host owner cancels late commits", async () => {
  const h = setup("port"),
    entered = deferred(),
    gate = deferred();
  h.dispatcher.register(
    h.activation,
    { id: "test.sdk.wait", scope: "selection", risk: "write" },
    async (ctx) => {
      entered.resolve();
      await gate.promise;
      await ctx.commit({ type: "text", value: "late" });
    },
  );
  const work = h.sdk.execute("test.sdk.wait");
  await entered.promise;
  h.sdk.dispose();
  await expect(work).rejects.toMatchObject({
    code: "CANCELLED",
    message: "SDK 连接已关闭，执行状态未确认",
  });
  h.host.dispose();
  gate.resolve();
  await Promise.resolve();
  expect(h.insert).not.toHaveBeenCalled();
});
