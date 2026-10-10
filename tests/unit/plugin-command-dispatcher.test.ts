import { beforeEach, expect, it, vi } from "vitest";
import { AutoSaveQueue } from "../../src/lib/auto-save-queue";
import { DocumentEditSessions } from "../../src/lib/document-edit-sessions";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
import { SaveBarrierError } from "../../src/lib/document-save-revisions";
import {
  HostCommandDispatcher,
  type HostCommandContext,
} from "../../src/lib/plugin-system/command-dispatcher";
vi.mock("../../src/lib/api", () => ({ api: { notes: { get: vi.fn() } } }));
vi.mock("../../src/lib/storage/protection-state", () => ({
  withProtectionWrite: vi.fn(async (task: () => unknown) => task()),
  listProtectedPaths: vi.fn(async () => []),
}));
import { api } from "../../src/lib/api";
import {
  listProtectedPaths,
  withProtectionWrite,
} from "../../src/lib/storage/protection-state";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

it.each(["STALE_REVISION", "SAVE_FAILED", "CANCELLED"] as const)(
  "write barrier %s produces a typed response without accepting an edit",
  async (code) => {
    const host = setup();
    vi.mocked(withProtectionWrite).mockRejectedValueOnce(
      new SaveBarrierError(code, "private storage detail"),
    );
    host.dispatcher.register(
      host.activation,
      { id: "test.demo.insert", scope: "selection", risk: "write" },
      (ctx) => ctx.commit({ type: "text", value: "blocked" }),
    );
    const response = await host.dispatcher.execute(host.activation, {
      requestId: "one",
      commandId: "test.demo.insert",
    });
    expect(response).toMatchObject({
      ok: false,
      applied: false,
      error: { code: code === "STALE_REVISION" ? "STALE_TARGET" : code },
    });
    expect(JSON.stringify(response)).not.toContain("private storage detail");
    expect(host.insert).not.toHaveBeenCalled();
    expect(host.queue.revisionState("a").contentRevision).toBe(0);
  },
);

it("captureSelection rejects a resident editor from before an external restore", async () => {
  const items = new Map<string, string>();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
  try {
    const host = setup();
    const { DocumentIntentService } =
      await import("../../src/lib/plugin-system/document-intents");
    const { advanceDocumentStorageGeneration } =
      await import("../../src/lib/document-storage-generation");
    const intents = new DocumentIntentService(host.runtime, host.sessions);
    expect(intents.captureSelection(host.activation, "a").documentId).toBe("a");
    advanceDocumentStorageGeneration("external-restore");
    expect(() => intents.captureSelection(host.activation, "a")).toThrow(
      expect.objectContaining({ code: "STALE_TARGET" }),
    );
    expect(host.insert).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("direct intents sanitize storage failures and cancellation during protection lookup", async () => {
  const host = setup();
  const { DocumentIntentService } =
    await import("../../src/lib/plugin-system/document-intents");
  const intents = new DocumentIntentService(host.runtime, host.sessions);
  const target = intents.captureSelection(host.activation, "a");
  vi.mocked(withProtectionWrite).mockRejectedValueOnce(
    new Error("private token and body"),
  );
  await expect(
    intents.insert(host.activation, target, { type: "text", value: "blocked" }),
  ).rejects.toMatchObject({
    code: "INTERNAL_ERROR",
    message: "编辑操作未完成",
  });
  const gate = deferred();
  const entered = deferred();
  vi.mocked(listProtectedPaths).mockImplementationOnce(async () => {
    entered.resolve();
    await gate.promise;
    return [];
  });
  const controller = new AbortController();
  const work = intents.insert(
    host.activation,
    target,
    { type: "text", value: "blocked" },
    controller.signal,
  );
  await entered.promise;
  controller.abort();
  gate.resolve();
  await expect(work).rejects.toMatchObject({ code: "CANCELLED" });
  expect(host.insert).not.toHaveBeenCalled();
});

it("a completed command cannot retain a callback and commit later", async () => {
  const host = setup();
  let late!: (content: { type: "text"; value: string }) => Promise<void>;
  host.dispatcher.register(
    host.activation,
    { id: "test.demo.late", scope: "selection", risk: "write" },
    (ctx) => {
      late = ctx.commit;
      return "finished";
    },
  );
  expect(
    await host.dispatcher.execute(host.activation, {
      requestId: "one",
      commandId: "test.demo.late",
    }),
  ).toMatchObject({ ok: true, applied: false });
  await expect(late({ type: "text", value: "late" })).rejects.toMatchObject({
    code: "CANCELLED",
  });
  expect(host.insert).not.toHaveBeenCalled();
});

it("direct intent calls cannot bypass disabled runtime, missing grant or a protected parent path", async () => {
  const { DocumentIntentService } =
    await import("../../src/lib/plugin-system/document-intents");
  const host = setup();
  const target = host.sessions.capture("a");
  const intents = new DocumentIntentService(host.runtime, host.sessions);
  const limited = host.runtime.activate("test.limited", [
    "editor.selection.read",
  ]);
  await expect(
    intents.insert(limited, target, { type: "text", value: "blocked" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  vi.mocked(listProtectedPaths).mockResolvedValue([
    { path: "ideas" },
  ] as Awaited<ReturnType<typeof listProtectedPaths>>);
  await expect(
    intents.insert(host.activation, target, { type: "text", value: "blocked" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  host.runtime.setEnabled(false);
  await expect(
    intents.insert(host.activation, target, { type: "text", value: "blocked" }),
  ).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });
  expect(host.insert).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.mocked(withProtectionWrite).mockReset();
  vi.mocked(withProtectionWrite).mockImplementation(async (task) => task());
  vi.mocked(api.notes.get).mockReset();
  vi.mocked(api.notes.get).mockResolvedValue({
    id: "a",
    readonly: false,
    content: { ops: [] },
    storagePath: "ideas",
  } as Awaited<ReturnType<typeof api.notes.get>>);
  vi.mocked(listProtectedPaths).mockResolvedValue([]);
});
function setup() {
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
  const activation = runtime.activate("test.demo", [
    "editor.selection.read",
    "editor.selection.write",
    "documents.current.read",
  ]);
  let context: HostCommandContext = {
    platform: "web",
    view: "render",
    documentId: "a",
  };
  const dispatcher = new HostCommandDispatcher(
    runtime,
    sessions,
    () => context,
  );
  return {
    queue,
    sessions,
    owner,
    insert,
    runtime,
    activation,
    dispatcher,
    setContext: (next: HostCommandContext) => {
      context = next;
    },
  };
}
it("validated command applies one batch, confirms real save and rejects duplicate request IDs", async () => {
  const host = setup();
  host.dispatcher.register(
    host.activation,
    { id: "test.demo.insert", scope: "selection", risk: "write" },
    (ctx) => ctx.commit({ type: "text", value: "hello" }),
  );
  const request = { requestId: "one", commandId: "test.demo.insert" };
  expect(await host.dispatcher.execute(host.activation, request)).toMatchObject(
    { ok: true, applied: true },
  );
  expect(host.insert).toHaveBeenCalledOnce();
  expect(host.queue.revisionState("a").contentRevision).toBe(1);
  await host.queue.flushAll();
  expect(host.queue.revisionState("a").confirmedRevision).toBe(1);
  expect(await host.dispatcher.execute(host.activation, request)).toMatchObject(
    { ok: false, error: { code: "DUPLICATE_REQUEST" } },
  );
});
it("denies undeclared entry, platform, missing args, read-only and protected writes", async () => {
  const host = setup();
  host.dispatcher.register(
    host.activation,
    {
      id: "test.demo.insert",
      scope: "selection",
      risk: "write",
      platforms: ["web"],
      args: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    (ctx) => ctx.commit({ type: "text", value: "hello" }),
  );
  const request = {
    requestId: "one",
    commandId: "test.demo.insert",
    args: { text: "hi" },
  };
  expect(
    await host.dispatcher.execute(host.activation, {
      ...request,
      entry: "macro",
    }),
  ).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  host.setContext({ platform: "tauri", view: "render", documentId: "a" });
  expect(await host.dispatcher.execute(host.activation, request)).toMatchObject(
    { error: { code: "UNSUPPORTED_PLATFORM" } },
  );
  host.setContext({ platform: "web", view: "render", documentId: "a" });
  expect(
    await host.dispatcher.execute(host.activation, { ...request, args: {} }),
  ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  vi.mocked(api.notes.get).mockResolvedValue({
    readonly: true,
    content: { ops: [] },
  } as Awaited<ReturnType<typeof api.notes.get>>);
  expect(await host.dispatcher.execute(host.activation, request)).toMatchObject(
    { applied: false, error: { code: "READ_ONLY" } },
  );
  vi.mocked(api.notes.get).mockResolvedValue({
    readonly: false,
    content: { encrypted: {} },
  } as Awaited<ReturnType<typeof api.notes.get>>);
  expect(
    await host.dispatcher.execute(host.activation, {
      ...request,
      requestId: "two",
    }),
  ).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  expect(host.insert).not.toHaveBeenCalled();
});
it("selection and activation changes during async work prevent a late write", async () => {
  const host = setup();
  const gate = deferred();
  host.dispatcher.register(
    host.activation,
    { id: "test.demo.insert", scope: "selection", risk: "write" },
    async (ctx) => {
      await gate.promise;
      await ctx.commit({ type: "text", value: "late" });
    },
  );
  const work = host.dispatcher.execute(host.activation, {
    requestId: "one",
    commandId: "test.demo.insert",
  });
  host.sessions.select("a", host.owner, "rendered", { from: 2, to: 2 });
  gate.resolve();
  expect(await work).toMatchObject({ error: { code: "STALE_TARGET" } });
  expect(host.insert).not.toHaveBeenCalled();
  const blocked = deferred();
  host.dispatcher.register(
    host.activation,
    { id: "test.demo.wait", scope: "selection", risk: "write" },
    async (ctx) => {
      await blocked.promise;
      await ctx.commit({ type: "text", value: "late" });
    },
  );
  const pending = host.dispatcher.execute(host.activation, {
    requestId: "two",
    commandId: "test.demo.wait",
  });
  host.runtime.setEnabled(false);
  expect(await pending).toMatchObject({ error: { code: "PLUGIN_DISABLED" } });
  host.runtime.setEnabled(true);
  host.runtime.activate("test.demo", ["editor.selection.write"]);
  blocked.resolve();
  await Promise.resolve();
  expect(host.insert).not.toHaveBeenCalled();
});
it("timeout and explicit cancellation reject without permitting background commits", async () => {
  const host = setup();
  const gate = deferred();
  host.dispatcher.register(
    host.activation,
    { id: "test.demo.wait", scope: "selection", risk: "write" },
    async (ctx) => {
      await gate.promise;
      await ctx.commit({ type: "text", value: "late" });
    },
  );
  expect(
    await host.dispatcher.execute(
      host.activation,
      { requestId: "one", commandId: "test.demo.wait" },
      { timeoutMs: 1 },
    ),
  ).toMatchObject({ error: { code: "TIMEOUT" } });
  const controller = new AbortController();
  const work = host.dispatcher.execute(
    host.activation,
    { requestId: "two", commandId: "test.demo.wait" },
    { signal: controller.signal },
  );
  controller.abort();
  expect(await work).toMatchObject({ error: { code: "CANCELLED" } });
  gate.resolve();
  await Promise.resolve();
  expect(host.insert).not.toHaveBeenCalled();
});
it("read handlers cannot commit; registration disposal and failure diagnostics are safe", async () => {
  const host = setup();
  host.dispatcher.register(
    host.activation,
    { id: "test.demo.read", scope: "selection", risk: "read" },
    (ctx) => ctx.commit({ type: "text", value: "not allowed" }),
  );
  expect(
    await host.dispatcher.execute(host.activation, {
      requestId: "one",
      commandId: "test.demo.read",
    }),
  ).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  const dispose = host.dispatcher.register(
    host.activation,
    { id: "test.demo.fail", scope: "app", risk: "read" },
    () => {
      throw new Error("private body and token");
    },
  );
  const response = await host.dispatcher.execute(host.activation, {
    requestId: "two",
    commandId: "test.demo.fail",
  });
  expect(response).toMatchObject({
    error: { code: "INTERNAL_ERROR", message: "命令执行失败" },
  });
  dispose();
  expect(
    await host.dispatcher.execute(host.activation, {
      requestId: "three",
      commandId: "test.demo.fail",
    }),
  ).toMatchObject({ error: { code: "COMMAND_NOT_FOUND" } });
  expect(host.insert).not.toHaveBeenCalled();
});
it("permission revocation while reading storage and a changed protection path reject before acceptance", async () => {
  const host = setup();
  const gate = deferred();
  vi.mocked(api.notes.get).mockImplementation(async () => {
    await gate.promise;
    return {
      readonly: false,
      content: { ops: [] },
      storagePath: "ideas",
    } as Awaited<ReturnType<typeof api.notes.get>>;
  });
  host.dispatcher.register(
    host.activation,
    { id: "test.demo.insert", scope: "selection", risk: "write" },
    (ctx) => ctx.commit({ type: "text", value: "hello" }),
  );
  const work = host.dispatcher.execute(host.activation, {
    requestId: "one",
    commandId: "test.demo.insert",
  });
  host.sessions.activate("a", host.owner, "source", true);
  gate.resolve();
  expect(await work).toMatchObject({ error: { code: "STALE_TARGET" } });
  expect(host.queue.revisionState("a").contentRevision).toBe(0);
});

it.each(["document", "view"])(
  "async commit rechecks %s context before React has updated session visibility",
  async (change) => {
    const host = setup();
    vi.mocked(api.notes.get).mockImplementationOnce(async () => {
      host.setContext({
        platform: "web",
        view: change === "view" ? "source" : "render",
        documentId: change === "document" ? "b" : "a",
      });
      return {
        id: "a",
        readonly: false,
        content: { ops: [] },
        storagePath: "ideas",
      } as Awaited<ReturnType<typeof api.notes.get>>;
    });
    host.dispatcher.register(
      host.activation,
      { id: "test.demo.context", scope: "selection", risk: "write" },
      (ctx) => ctx.commit({ type: "text", value: "must not apply" }),
    );
    expect(
      await host.dispatcher.execute(host.activation, {
        requestId: "context",
        commandId: "test.demo.context",
      }),
    ).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "STALE_TARGET" },
    });
    expect(host.insert).not.toHaveBeenCalled();
  },
);
