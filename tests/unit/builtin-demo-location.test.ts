import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("../../src/lib/api", () => ({ api: { notes: mocks } }));
import {
  BUILTIN_DEMO_PATH,
  finishBuiltinDemoCreation,
  migrateBuiltinDemoLocations,
} from "../../src/lib/builtin-demo-location";
const key = "nr:builtin-aesthetic-sample:v1";
const original = {
  id: "demo",
  title: "物哀、幽玄与侘寂：风格设计与验证",
  storagePath: "ideas",
  readonly: false,
  content: { ops: [{ insert: "用户已编辑的内容\n" }] },
};
beforeEach(() => {
  const map = new Map<string, string>([[key, original.id]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  });
  mocks.get.mockReset().mockResolvedValue(structuredClone(original));
  mocks.update
    .mockReset()
    .mockResolvedValue({ ...original, storagePath: "ideas/demo", readonly: false });
});
afterEach(() => vi.unstubAllGlobals());
it("moves known legacy demos by ID and changes metadata only, once", async () => {
  expect(await migrateBuiltinDemoLocations()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith(original.id, {
    storagePath: "ideas/demo",
    readonly: true,
  });
  expect(original.content.ops[0].insert).toBe("用户已编辑的内容\n");
  mocks.get.mockResolvedValue({
    ...original,
    storagePath: "ideas/demo",
    readonly: false,
  });
  expect(await migrateBuiltinDemoLocations()).toBe(false);
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
it.each([
  null,
  { ...original, deleted_at: "deleted" },
  { ...original, title: "renamed" },
  { ...original, storagePath: "projects/personal", readonly: true },
])("respects deleted, moved and renamed copies %j", async (note) => {
  mocks.get.mockResolvedValue(note);
  expect(await migrateBuiltinDemoLocations()).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("does not record success before a failed migration persists", async () => {
  mocks.update.mockRejectedValueOnce(new Error("disk full"));
  await expect(migrateBuiltinDemoLocations()).rejects.toThrow("disk full");
  expect(await migrateBuiltinDemoLocations()).toBe(true);
});
it.each(["demo", "ideas"])("moves a legacy demo path %s and initializes it readonly", async storagePath => {
  mocks.get.mockResolvedValue({ ...original, storagePath });
  expect(await migrateBuiltinDemoLocations()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith("demo", { storagePath: BUILTIN_DEMO_PATH, readonly: true });
});
it("migrates despite the old v1 marker and preserves readonly", async () => {
  localStorage.setItem("nr:builtin-demo-location:v1:demo", "1");
  mocks.get.mockResolvedValue({ ...original, readonly: true });
  expect(await migrateBuiltinDemoLocations()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith("demo", { storagePath: "ideas/demo" });
});
it("reconciles an old path restored by Pull even when the local migration marker exists", async () => {
  localStorage.setItem(`nr:builtin-demo-location:v3:${original.id}`, "1");
  localStorage.setItem(`nr:builtin-demo-readonly:v1:${original.id}`, "1");
  mocks.get.mockResolvedValue({ ...original, storagePath: "ideas" });
  expect(await migrateBuiltinDemoLocations()).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();

  expect(await migrateBuiltinDemoLocations({ force: true })).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith(original.id, {
    storagePath: BUILTIN_DEMO_PATH,
  });
});
it("new demo readonly failure leaves migration retryable", async () => {
  mocks.update.mockRejectedValueOnce(new Error("disk full"));
  await expect(finishBuiltinDemoCreation("demo")).rejects.toThrow("disk full");
  expect(await migrateBuiltinDemoLocations()).toBe(true);
});
it("moves all three built-in samples into ideas/demo", async () => {
  const samples = [
    ["nr:builtin-aesthetic-sample:v1", "aesthetic", "物哀、幽玄与侘寂：风格设计与验证"],
    ["nr:builtin-flow-sample:v2", "flow", "流程展示：从想法到可执行方案"],
    ["nr:builtin-markdown-demo:v1", "markdown", "Markdown 全景：GFM、GitHub 与 Nine Rings"],
  ] as const;
  for (const [key, id] of samples) {
    localStorage.setItem(key, id);
    localStorage.setItem(`nr:builtin-demo-location:v2:${id}`, "1");
  }
  mocks.get.mockImplementation(async (id: string) => {
    const sample = samples.find(([, sampleId]) => sampleId === id);
    return sample ? { ...original, id, title: sample[2], storagePath: "ideas" } : null;
  });
  expect(await migrateBuiltinDemoLocations()).toBe(true);
  expect(mocks.update).toHaveBeenCalledTimes(3);
  for (const [, id] of samples) expect(mocks.update).toHaveBeenCalledWith(id, { storagePath: BUILTIN_DEMO_PATH, readonly: true });
  expect(await migrateBuiltinDemoLocations()).toBe(false);
  expect(mocks.update).toHaveBeenCalledTimes(3);
});
