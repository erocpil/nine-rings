import { afterEach, expect, it, vi } from "vitest";
import {
  beginSyncProgress,
  captureSyncProgress,
  endSyncProgress,
  readSyncProgress,
  subscribeSyncProgress,
} from "../../src/lib/sync/operation-progress";
afterEach(() => {
  endSyncProgress();
  vi.useRealTimers();
});
it("records real stage timing and byte progress without persisting payloads", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const owner = beginSyncProgress("保存");
  const report = captureSyncProgress();
  vi.advanceTimersByTime(1000);
  report("下载", { receivedBytes: 12, totalBytes: 20, timeoutMs: 120000 });
  expect(readSyncProgress()).toMatchObject({
    id: owner,
    startedAt: 1000,
    stageAt: 2000,
    receivedBytes: 12,
  });
  vi.advanceTimersByTime(1000);
  report("下载", { receivedBytes: 18 });
  expect(readSyncProgress()).toMatchObject({
    startedAt: 1000,
    stageAt: 2000,
    updatedAt: 3000,
    receivedBytes: 18,
  });
  report("认证正文");
  expect(readSyncProgress()?.receivedBytes).toBeUndefined();
  expect(readSyncProgress()?.timeoutMs).toBeUndefined();
});
it("late reads and completion from an old operation cannot replace a new operation", () => {
  const previous = beginSyncProgress("旧检查");
  const late = captureSyncProgress();
  const current = beginSyncProgress("新检查");
  late("过期下载", { receivedBytes: 100 });
  endSyncProgress(previous);
  expect(readSyncProgress()).toMatchObject({ id: current, stage: "新检查" });
});
it("inactive or unsubscribed progress has no UI subscriber effects", () => {
  const inactive = captureSyncProgress();
  const listener = vi.fn();
  const unsubscribe = subscribeSyncProgress(listener);
  beginSyncProgress("当前");
  inactive("未授权旧更新");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  endSyncProgress();
  expect(listener).toHaveBeenCalledTimes(1);
});

it("read completion counts survive stage changes and ignore old owners", async () => {
  const { captureReadCompletion } =
    await import("../../src/lib/sync/operation-progress");
  beginSyncProgress("读取");
  const complete = captureReadCompletion();
  complete();
  captureSyncProgress()("认证");
  expect(readSyncProgress()?.completedReads).toBe(1);
  beginSyncProgress("新检查");
  complete();
  expect(readSyncProgress()?.completedReads).toBe(0);
});
