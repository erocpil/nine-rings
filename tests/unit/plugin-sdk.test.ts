import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  AutoSaveQueue,
  type AutoSaveChanges,
} from "../../src/lib/auto-save-queue";
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
import type { SdkEditResult } from "../../src/lib/plugin-system/sdk-editor-handles";
vi.mock("../../src/lib/api", () => ({
  api: {
    notes: {
      get: vi.fn(async () => ({
        id: "a",
        readonly: false,
        content: { ops: [] },
        storagePath: "ideas",
      })),
    },
  },
}));
vi.mock("../../src/lib/storage/protection-state", () => ({
  withProtectionWrite: async (task: () => unknown) => task(),
  listProtectedPaths: vi.fn(async () => []),
}));
const cleanup: Array<() => void> = [];
import { api } from "../../src/lib/api";
import { listProtectedPaths } from "../../src/lib/storage/protection-state";
beforeEach(() => {
  vi.mocked(listProtectedPaths).mockResolvedValue([]);
  vi.mocked(api.notes.get).mockImplementation(
    async () =>
      ({
        id: "a",
        readonly: false,
        content: { ops: [] },
        storagePath: "ideas",
      }) as Awaited<ReturnType<typeof api.notes.get>>,
  );
});
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
function setup(
  kind: "loopback" | "port",
  writable = true,
  save: (
    id: string,
    changes: AutoSaveChanges,
  ) => Promise<void> = async () => {},
) {
  const queue = new AutoSaveQueue(save);
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
  it(`${kind}: a captured target returns an opaque revision confirmed only by actual storage`, async () => {
    const entered = deferred(),
      gate = deferred();
    const save = vi.fn(async () => {
      entered.resolve();
      await gate.promise;
    });
    const h = setup(kind, true, save);
    const target = await h.sdk.editor.captureSelection();
    expect(Object.keys(target)).toEqual(["token"]);
    const response = await h.sdk.editor.insert(target, {
      format: "text",
      value: "accepted",
    });
    expect(response).toMatchObject({ ok: true, applied: true });
    if (!response.ok) throw new Error("edit failed");
    const result = response.value as SdkEditResult;
    expect(result).toMatchObject({
      documentId: "a",
      revision: expect.any(String),
    });
    const waiting = h.sdk.documents.whenSaved(result);
    await entered.promise;
    expect(h.queue.revisionState("a").confirmedRevision).toBe(0);
    gate.resolve();
    await waiting;
    expect(h.queue.revisionState("a").confirmedRevision).toBe(1);
    expect(save).toHaveBeenCalledOnce();
  });
  it(`${kind}: moving selection rejects a previously captured target without retargeting`, async () => {
    const h = setup(kind);
    const target = await h.sdk.editor.captureSelection();
    h.sessions.select("a", h.owner, "rendered", { from: 2, to: 2 });
    expect(
      await h.sdk.editor.insert(target, { format: "text", value: "old" }),
    ).toMatchObject({ error: { code: "STALE_TARGET" }, applied: false });
    expect(h.insert).not.toHaveBeenCalled();
    const fresh = await h.sdk.editor.captureSelection();
    expect(
      await h.sdk.editor.insert(fresh, { format: "text", value: "new" }),
    ).toMatchObject({ applied: true });
    expect(
      await h.sdk.editor.insert(fresh, { format: "text", value: "duplicate" }),
    ).toMatchObject({ error: { code: "STALE_TARGET" }, applied: false });
    expect(h.insert).toHaveBeenCalledOnce();
  });
  it(`${kind}: targets and revisions cannot cross connections or documents`, async () => {
    const h = setup(kind),
      other = setup(kind);
    const target = await h.sdk.editor.captureSelection();
    expect(
      await other.sdk.editor.insert(target, {
        format: "text",
        value: "foreign",
      }),
    ).toMatchObject({ error: { code: "STALE_TARGET" } });
    expect(
      await h.sdk.editor.insert(
        { token: "forged" },
        { format: "text", value: "forged" },
      ),
    ).toMatchObject({ error: { code: "STALE_TARGET" } });
    const response = await h.sdk.editor.insert(target, {
      format: "text",
      value: "owned",
    });
    if (!response.ok) throw new Error("edit failed");
    const result = response.value as SdkEditResult;
    await expect(other.sdk.documents.whenSaved(result)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    await expect(
      h.sdk.documents.whenSaved({ ...result, documentId: "another" }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(other.insert).not.toHaveBeenCalled();
  });
  it(`${kind}: read-only and missing grants are checked even outside commands`, async () => {
    const limited = setup(kind, false);
    await expect(limited.sdk.editor.captureSelection()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(
      await limited.sdk.editor.insertAtSelection({
        format: "text",
        value: "blocked",
      }),
    ).toMatchObject({ error: { code: "PERMISSION_DENIED" }, applied: false });
    const h = setup(kind);
    const target = await h.sdk.editor.captureSelection();
    vi.mocked(api.notes.get).mockResolvedValue({
      id: "a",
      readonly: true,
      content: { ops: [] },
    } as Awaited<ReturnType<typeof api.notes.get>>);
    expect(
      await h.sdk.editor.insert(target, { format: "text", value: "blocked" }),
    ).toMatchObject({ error: { code: "READ_ONLY" }, applied: false });
    expect(h.insert).not.toHaveBeenCalled();
  });
  it(`${kind}: save failure keeps the revision pending until explicit retry`, async () => {
    const save = vi.fn(async () => {});
    save.mockRejectedValueOnce(new Error("private storage details"));
    const h = setup(kind, true, save);
    const response = await h.sdk.editor.insertAtSelection({
      format: "text",
      value: "pending",
    });
    if (!response.ok) throw new Error("edit failed");
    const result = response.value as SdkEditResult;
    await expect(h.sdk.documents.whenSaved(result)).rejects.toMatchObject({
      code: "SAVE_FAILED",
      message: "文档保存失败，请显式重试",
    });
    expect(save).toHaveBeenCalledOnce();
    expect(h.queue.revisionState("a").confirmedRevision).toBe(0);
    expect(h.queue.pending("a")).not.toBeNull();
    await h.sdk.documents.whenSaved(result);
    expect(save).toHaveBeenCalledTimes(2);
    expect(h.queue.revisionState("a").confirmedRevision).toBe(1);
  });
  it(`${kind}: waiting survives view hiding, but discarded generations invalidate revisions`, async () => {
    const h = setup(kind);
    const response = await h.sdk.editor.insertAtSelection({
      format: "text",
      value: "original",
    });
    if (!response.ok) throw new Error("edit failed");
    const result = response.value as SdkEditResult;
    h.sessions.activate("a", h.owner, "rendered", false);
    await h.sdk.documents.whenSaved(result);
    h.queue.discard("a");
    await expect(h.sdk.documents.whenSaved(result)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
  });
  it(`${kind}: disabling during save stops plugin waiting without undoing accepted storage`, async () => {
    const entered = deferred(),
      gate = deferred();
    const h = setup(kind, true, async () => {
      entered.resolve();
      await gate.promise;
    });
    const response = await h.sdk.editor.insertAtSelection({
      format: "text",
      value: "accepted",
    });
    if (!response.ok) throw new Error("edit failed");
    const waiting = h.sdk.documents.whenSaved(response.value as SdkEditResult);
    await entered.promise;
    h.runtime.setEnabled(false);
    await expect(waiting).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });
    gate.resolve();
    await h.queue.flushAll();
    expect(h.queue.revisionState("a").confirmedRevision).toBe(1);
  });
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
    if (kind === "port")
      await expect(h.sdk.execute("test.sdk.insert")).rejects.toMatchObject({
        code: "PLUGIN_DISABLED",
      });
    else
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

it("opaque target handles expire and are bounded without retaining editor objects", async () => {
  const h = setup("loopback");
  const clock = vi.spyOn(Date, "now");
  try {
    clock.mockReturnValue(1000);
    const old = await h.sdk.editor.captureSelection();
    clock.mockReturnValue(1000 + 5 * 60000 + 1);
    expect(
      await h.sdk.editor.insert(old, { format: "text", value: "expired" }),
    ).toMatchObject({ error: { code: "STALE_TARGET" } });
    const evicted = await h.sdk.editor.captureSelection();
    for (let index = 0; index < 256; index++)
      await h.sdk.editor.captureSelection();
    expect(
      await h.sdk.editor.insert(evicted, { format: "text", value: "evicted" }),
    ).toMatchObject({ error: { code: "STALE_TARGET" } });
    expect(h.insert).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

it("direct SDK editing denies encrypted documents and protected parent paths", async () => {
  const h = setup("loopback");
  vi.mocked(api.notes.get).mockResolvedValueOnce({
    id: "a",
    readonly: false,
    content: { encrypted: {} },
  } as Awaited<ReturnType<typeof api.notes.get>>);
  expect(
    await h.sdk.editor.insertAtSelection({
      format: "text",
      value: "encrypted",
    }),
  ).toMatchObject({ error: { code: "PERMISSION_DENIED" }, applied: false });
  vi.mocked(listProtectedPaths).mockResolvedValueOnce([
    { path: "ideas" },
  ] as Awaited<ReturnType<typeof listProtectedPaths>>);
  expect(
    await h.sdk.editor.insertAtSelection({
      format: "text",
      value: "protected",
    }),
  ).toMatchObject({ error: { code: "PERMISSION_DENIED" }, applied: false });
  expect(h.insert).not.toHaveBeenCalled();
});

it("cancelling save waiting does not cancel an already executing persistence write", async () => {
  const entered = deferred(),
    gate = deferred();
  const h = setup("port", true, async () => {
    entered.resolve();
    await gate.promise;
  });
  const response = await h.sdk.editor.insertAtSelection({
    format: "text",
    value: "accepted",
  });
  if (!response.ok) throw new Error("edit failed");
  const controller = new AbortController();
  const waiting = h.sdk.documents.whenSaved(response.value as SdkEditResult, {
    signal: controller.signal,
  });
  await entered.promise;
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ code: "CANCELLED" });
  gate.resolve();
  await h.queue.flushAll();
  expect(h.queue.revisionState("a").confirmedRevision).toBe(1);
});

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: snapshot includes pending content, is detached and can await persistence`, async () => {
    const { sdk, queue } = setup(kind);
    queue.mark("a", "content", { ops: [{ insert: "unsaved" }] });
    const snapshot = await sdk.documents.snapshot();
    expect(snapshot.content).toEqual({ ops: [{ insert: "unsaved" }] });
    (snapshot.content as { ops: { insert: string }[] }).ops[0].insert =
      "mutated";
    expect((await sdk.documents.snapshot()).content).toEqual({
      ops: [{ insert: "unsaved" }],
    });
    await sdk.documents.whenSaved(snapshot);
    expect(queue.pending("a")).toBeNull();
  });
  it(`${kind}: snapshot rejects revision changes during storage read`, async () => {
    const { sdk, queue } = setup(kind);
    vi.mocked(api.notes.get).mockImplementationOnce(async () => {
      queue.mark("a", "title", "changed");
      return { id: "a", title: "old", content: { ops: [] } } as Awaited<
        ReturnType<typeof api.notes.get>
      >;
    });
    await expect(sdk.documents.snapshot()).rejects.toMatchObject({
      code: "STALE_TARGET",
    });
  });
  it(`${kind}: snapshot rejects protected content`, async () => {
    const { sdk } = setup(kind);
    vi.mocked(listProtectedPaths).mockResolvedValue([
      { path: "ideas" },
    ] as Awaited<ReturnType<typeof listProtectedPaths>>);
    await expect(sdk.documents.snapshot()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
  it(`${kind}: snapshot checks permission before accessing storage`, async () => {
    const { sdk, runtime } = setup(kind);
    runtime.activate("test.sdk", []);
    const calls = vi.mocked(api.notes.get).mock.calls.length;
    await expect(sdk.documents.snapshot()).rejects.toMatchObject({
      code: "PLUGIN_DISABLED",
    });
    expect(vi.mocked(api.notes.get).mock.calls.length).toBe(calls);
  });
}

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: snapshot retains live content when saving completes during storage read`, async () => {
    const { sdk, queue } = setup(kind);
    queue.mark("a", "content", { ops: [{ insert: "latest" }] });
    vi.mocked(api.notes.get).mockImplementationOnce(async () => {
      await queue.flushNote("a");
      return { id: "a", content: { ops: [{ insert: "old" }] } } as Awaited<
        ReturnType<typeof api.notes.get>
      >;
    });
    expect((await sdk.documents.snapshot()).content).toEqual({
      ops: [{ insert: "latest" }],
    });
  });
  it(`${kind}: snapshot rejects encrypted bodies`, async () => {
    const { sdk } = setup(kind);
    vi.mocked(api.notes.get).mockResolvedValue({
      id: "a",
      content: { encrypted: {} },
    } as unknown as Awaited<ReturnType<typeof api.notes.get>>);
    await expect(sdk.documents.snapshot()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
  it(`${kind}: ungranted read cannot access storage`, async () => {
    const { dispatcher, runtime } = setup(kind);
    const activation = runtime.activate("other.reader", []);
    const denied = createSdkHost(runtime, activation, dispatcher);
    cleanup.push(() => denied.dispose());
    const calls = vi.mocked(api.notes.get).mock.calls.length;
    expect(
      (
        await denied.receive({
          protocol: 1,
          requestId: "read",
          method: "documents.snapshot",
          params: {},
        })
      ).response,
    ).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(vi.mocked(api.notes.get).mock.calls.length).toBe(calls);
  });
}

it("host disposal releases bound port after pending terminal response", async () => {
  const h = setup("port");
  const gate = deferred();
  h.dispatcher.register(
    h.activation,
    { id: "test.sdk.lifecycle", scope: "app", risk: "read" },
    async () => {
      await gate.promise;
      return null;
    },
  );
  const response = h.sdk.execute("test.sdk.lifecycle");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const cleanup = vi.fn();
  h.host.onDispose(cleanup);
  h.host.dispose();
  expect(await response).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
  await expect(h.sdk.capabilities()).rejects.toMatchObject({
    code: "CANCELLED",
  });
  h.host.dispose();
  expect(cleanup).toHaveBeenCalledTimes(1);
  gate.resolve();
});

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: subscription batches revisions without body and confirms real saves`, async () => {
    const { sdk, queue } = setup(kind);
    const subscription = await sdk.events.subscribe();
    queue.mark("a", "title", "secret one");
    queue.mark("a", "title", "secret two");
    const first = await subscription.read();
    expect(first.resync).toBe(true);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({
      kind: "accepted",
      contentRevision: 2,
    });
    expect(JSON.stringify(first)).not.toContain("secret");
    expect((await subscription.read()).events).toEqual([]);
    await queue.flushNote("a");
    expect((await subscription.read()).events[0]).toMatchObject({
      kind: "saved",
      confirmedRevision: 2,
    });
    await subscription.dispose();
    await subscription.dispose();
    queue.mark("a", "title", "later");
    await expect(subscription.read()).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
  it(`${kind}: event buffer and subscription count stay bounded`, async () => {
    const { sdk, queue } = setup(kind);
    const subscriptions = await Promise.all(
      Array.from({ length: 8 }, () => sdk.events.subscribe()),
    );
    await expect(sdk.events.subscribe()).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    for (let i = 0; i < 20; i++) {
      queue.mark("a", "title", String(i));
      await queue.flushNote("a");
    }
    const result = await subscriptions[0].read();
    expect(result.events).toHaveLength(32);
    expect(result.resync).toBe(true);
    await subscriptions[0].dispose();
    await sdk.events.subscribe();
  });
  it(`${kind}: event reads recheck protection and cannot use another connection subscription`, async () => {
    const { sdk, host, queue } = setup(kind);
    const response = await host.receive({
      protocol: 1,
      requestId: "sub",
      method: "events.subscribe",
      params: {},
    });
    expect(response.response.ok).toBe(true);
    const subscriptionId = (
      response.response as { value: { subscriptionId: string } }
    ).value.subscriptionId;
    const other = setup(kind);
    expect(
      (
        await other.host.receive({
          protocol: 1,
          requestId: "read",
          method: "events.read",
          params: { subscriptionId },
        })
      ).response,
    ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    const subscription = await sdk.events.subscribe();
    queue.mark("a", "title", "secret");
    vi.mocked(listProtectedPaths).mockResolvedValue([
      { path: "ideas" },
    ] as Awaited<ReturnType<typeof listProtectedPaths>>);
    await expect(subscription.read()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
}

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: subscribed events ignore other documents, resync on generation change and stop on disabling`, async () => {
    const { sdk, queue, runtime } = setup(kind);
    const subscription = await sdk.events.subscribe();
    queue.mark("b", "title", "other");
    expect((await subscription.read()).events).toEqual([]);
    queue.discard("a");
    const result = await subscription.read();
    expect(result.resync).toBe(true);
    expect(result.events[0].kind).toBe("invalidated");
    runtime.setEnabled(false);
    await expect(subscription.read()).rejects.toMatchObject({
      code: "PLUGIN_DISABLED",
    });
  });
}

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: subscription returns a frozen baseline and captures the next edit without a gap`, async () => {
    const { sdk, queue } = setup(kind);
    queue.mark("a", "content", { ops: [{ insert: "baseline" }] });
    const subscription = await sdk.events.subscribe();
    expect(subscription.snapshot.content).toEqual({
      ops: [{ insert: "baseline" }],
    });
    queue.mark("a", "content", { ops: [{ insert: "next" }] });
    expect(subscription.snapshot.content).toEqual({
      ops: [{ insert: "baseline" }],
    });
    expect((await subscription.read()).events[0]).toMatchObject({
      kind: "accepted",
      contentRevision: 2,
    });
    await sdk.documents.whenSaved(subscription.snapshot);
    await subscription.dispose();
  });
  it(`${kind}: oversized subscription baseline fails without consuming a subscription slot`, async () => {
    const { sdk, queue } = setup(kind);
    queue.mark("a", "content", { ops: [{ insert: "x".repeat(129000) }] });
    for (let i = 0; i < 9; i++)
      await expect(sdk.events.subscribe()).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    queue.mark("a", "content", { ops: [] });
    const subscription = await sdk.events.subscribe();
    await subscription.dispose();
  });
}

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: selected views notify invalidation without exposing editor coordinates`, async () => {
    const { sdk, sessions, owner } = setup(kind);
    const subscription = await sdk.events.subscribe();
    sessions.select("a", owner, "rendered", { from: 4, to: 9 });
    const selection = (await subscription.read()).events[0];
    expect(selection).toMatchObject({
      kind: "selection",
      view: "rendered",
      selectionEpoch: 2,
    });
    expect(selection).not.toHaveProperty("from");
    expect(selection).not.toHaveProperty("to");
    sessions.activate("a", owner, "source", true);
    const views = await subscription.read();
    expect(views.resync).toBe(true);
    expect(views.events[0]).toMatchObject({ kind: "view", view: "source" });
  });
  it(`${kind}: current-read alone cannot observe selection and management replacement blocks snapshots`, async () => {
    const { sdk, sessions, owner, queue } = setup(kind, false);
    const subscription = await sdk.events.subscribe();
    sessions.select("a", owner, "rendered", { from: 4, to: 9 });
    expect((await subscription.read()).events).toEqual([]);
    const gate = deferred(),
      entered = deferred();
    const mutation = queue.withReplacement(async () => {
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    await expect(sdk.documents.snapshot()).rejects.toMatchObject({
      code: "STALE_TARGET",
    });
    gate.resolve();
    await mutation;
  });
}

for (const kind of ["loopback", "port"] as const) {
  it(`${kind}: availability signals are coalesced until read and released on unsubscribe`, async () => {
    const { sdk, queue } = setup(kind);
    const notify = vi.fn();
    const subscription = await sdk.events.subscribe({ onAvailable: notify });
    for (let i = 0; i < 100; i++) queue.mark("a", "title", String(i));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    queue.mark("a", "title", "pending");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(notify).toHaveBeenCalledTimes(1);
    await subscription.read();
    queue.mark("a", "title", "after read");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    await subscription.dispose();
    queue.mark("a", "title", "after dispose");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(notify).toHaveBeenCalledTimes(2);
  });
}
