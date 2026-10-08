import { beforeEach, afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../src/lib/api", () => ({
  api: {
    docs: { search: mocks.search },
    notes: { create: mocks.create, get: mocks.get, update: mocks.update },
  },
}));
import {
  ensureFlowPresentationSample,
  FLOW_SAMPLE_TITLE,
} from "../../src/lib/flow-presentation-sample";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("navigator", {});
  mocks.search.mockReset().mockResolvedValue([]);
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.update.mockReset().mockResolvedValue({ id: "existing" });
  mocks.create.mockReset().mockResolvedValue({ id: "sample-id" });
});
afterEach(() => vi.unstubAllGlobals());

test("concurrent startup adds one ideas sample and leaves edited or deleted copies alone", async () => {
  await Promise.all([
    ensureFlowPresentationSample(),
    ensureFlowPresentationSample(),
  ]);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0]).toMatchObject({
    title: FLOW_SAMPLE_TITLE,
    storagePath: "ideas",
  });
  expect(JSON.stringify(mocks.create.mock.calls[0][0].content)).toContain(
    "阶段",
  );
  await ensureFlowPresentationSample();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
test("existing synced sample is adopted without overwriting content", async () => {
  mocks.search.mockResolvedValue([
    { id: "existing", storagePath: "ideas", title: FLOW_SAMPLE_TITLE },
  ]);
  expect(await ensureFlowPresentationSample()).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
});
test("failed creation remains retryable", async () => {
  mocks.create.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(ensureFlowPresentationSample()).rejects.toThrow(
    "storage unavailable",
  );
  expect(await ensureFlowPresentationSample()).toBe(true);
});

test("untouched legacy demo upgrades in place but authored changes and deleted demos survive", async () => {
  const { default: markdown } =
    await import("../../src/lib/flow-presentation-sample-v1.md?raw");
  const { mdToDelta } = await import("../../src/lib/md-parser");
  const legacy = {
    id: "legacy",
    storagePath: "ideas",
    title: FLOW_SAMPLE_TITLE,
    content: {
      ...mdToDelta(markdown),
      metadata: { presentationMode: "flow" as const },
    },
  };
  mocks.search.mockResolvedValue([legacy]);
  mocks.get.mockResolvedValue(legacy);
  expect(await ensureFlowPresentationSample()).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith(
    "legacy",
    expect.objectContaining({
      content: expect.objectContaining({ metadata: {} }),
    }),
  );
  expect(mocks.create).not.toHaveBeenCalled();
});

test("modified legacy demo is never rewritten", async () => {
  const { mdToDelta } = await import("../../src/lib/md-parser");
  mocks.search.mockResolvedValue([
    { id: "legacy", storagePath: "ideas", title: FLOW_SAMPLE_TITLE },
  ]);
  mocks.get.mockResolvedValue({
    id: "legacy",
    content: {
      ...mdToDelta("## 我修改的流程"),
      metadata: { presentationMode: "flow" },
    },
  });
  expect(await ensureFlowPresentationSample()).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();
});

test("deleted legacy demo is not recreated by the block upgrade", async () => {
  localStorage.setItem("nr:builtin-flow-sample:v1", "deleted-id");
  expect(await ensureFlowPresentationSample()).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
});
