import { beforeEach, afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), create: vi.fn() }));
vi.mock("../../src/lib/api", () => ({
  api: { docs: { search: mocks.search }, notes: { create: mocks.create } },
}));
import {
  ensureAestheticStyleSample,
  AESTHETIC_SAMPLE_TITLE,
} from "../../src/lib/aesthetic-style-sample";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("navigator", {});
  mocks.search.mockReset().mockResolvedValue([]);
  mocks.create.mockReset().mockResolvedValue({ id: "sample-id" });
});
afterEach(() => vi.unstubAllGlobals());

test("concurrent startup adds one ideas sample and leaves edited or deleted copies alone", async () => {
  await Promise.all([
    ensureAestheticStyleSample(),
    ensureAestheticStyleSample(),
  ]);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0]).toMatchObject({
    title: AESTHETIC_SAMPLE_TITLE,
    storagePath: "ideas",
  });
  expect(JSON.stringify(mocks.create.mock.calls[0][0].content)).toContain(
    "幽玄",
  );
  await ensureAestheticStyleSample();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
test("existing synced sample is adopted without overwriting content", async () => {
  mocks.search.mockResolvedValue([
    { id: "existing", storagePath: "ideas", title: AESTHETIC_SAMPLE_TITLE },
  ]);
  expect(await ensureAestheticStyleSample()).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
});
test("failed creation remains retryable", async () => {
  mocks.create.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(ensureAestheticStyleSample()).rejects.toThrow(
    "storage unavailable",
  );
  expect(await ensureAestheticStyleSample()).toBe(true);
});
