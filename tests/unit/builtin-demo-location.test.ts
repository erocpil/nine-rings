import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("../../src/lib/api", () => ({ api: { notes: mocks } }));
import {
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
    .mockResolvedValue({ ...original, storagePath: "demo", readonly: true });
});
afterEach(() => vi.unstubAllGlobals());
it("moves known legacy demos by ID and changes metadata only, once", async () => {
  expect(await migrateBuiltinDemoLocations()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith(original.id, {
    storagePath: "demo",
    readonly: true,
  });
  expect(original.content.ops[0].insert).toBe("用户已编辑的内容\n");
  mocks.get.mockResolvedValue({
    ...original,
    storagePath: "demo",
    readonly: false,
  });
  expect(await migrateBuiltinDemoLocations()).toBe(false);
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
it.each([
  null,
  { ...original, deleted_at: "deleted" },
  { ...original, title: "renamed" },
  { ...original, storagePath: "projects/personal" },
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
it("adopts an already moved synchronized demo and sets readonly without recreating it", async () => {
  mocks.get.mockResolvedValue({ ...original, storagePath: "demo" });
  expect(await migrateBuiltinDemoLocations()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith("demo", {
    storagePath: "demo",
    readonly: true,
  });
});
it("new demo readonly failure leaves migration retryable", async () => {
  mocks.update.mockRejectedValueOnce(new Error("disk full"));
  await expect(finishBuiltinDemoCreation("demo")).rejects.toThrow("disk full");
  expect(await migrateBuiltinDemoLocations()).toBe(true);
});
