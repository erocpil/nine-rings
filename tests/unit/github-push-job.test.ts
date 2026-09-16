import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelGitHubPush,
  dismissGitHubPush,
  pushSnapshotBusy,
  startGitHubPush,
  useGitHubPushJob,
} from "../../src/lib/sync/push-job";
import { loadSyncConfig, pushToGitHub } from "../../src/lib/sync/github";

vi.mock("../../src/lib/sync/github", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/lib/sync/github")>();
  return { ...original, pushToGitHub: vi.fn() };
});

beforeEach(() => {
  vi.mocked(pushToGitHub).mockReset();
  dismissGitHubPush();
});
afterEach(() => {
  expect(useGitHubPushJob.getState().status).not.toBe("running");
});

describe("application-owned GitHub upload", () => {
  const config = () => ({
    ...loadSyncConfig(),
    owner: "test",
    repo: "notes",
    token: "secret",
  });
  it("flushes first, rejects duplicate starts and retains success without subscribers", async () => {
    let flushed = false;
    let finish!: () => void;
    const upload = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(pushToGitHub).mockImplementation(async (cfg, _, options) => {
      expect(flushed).toBe(true);
      options?.onProgress?.({
        phase: "uploading",
        bytes: 4096,
        timeoutMs: 121000,
      });
      await upload;
      return { ...cfg, lastPushVersion: "20260916T000000000" };
    });
    const task = startGitHubPush(config(), async () => {
      flushed = true;
    });
    expect(pushSnapshotBusy(useGitHubPushJob.getState())).toBe(true);
    await vi.waitFor(() =>
      expect(useGitHubPushJob.getState().phase).toBe("uploading"),
    );
    expect(pushSnapshotBusy(useGitHubPushJob.getState())).toBe(false);
    await startGitHubPush(config());
    expect(pushToGitHub).toHaveBeenCalledTimes(1);
    finish();
    await task;
    expect(useGitHubPushJob.getState().status).toBe("success");
    expect(useGitHubPushJob.getState().result?.lastPushVersion).toBe(
      "20260916T000000000",
    );
    expect(JSON.stringify(useGitHubPushJob.getState())).not.toContain("secret");
  });

  it("does not upload after pending local saves fail", async () => {
    await startGitHubPush(config(), async () => {
      throw new Error("save failed");
    });
    expect(pushToGitHub).not.toHaveBeenCalled();
    expect(useGitHubPushJob.getState().message).toContain("save failed");
  });

  it("cancels the signal and warns about uncertain latest publication", async () => {
    vi.mocked(pushToGitHub).mockImplementation(async (_, __, options) => {
      options?.onProgress?.({ phase: "publishing" });
      await new Promise((_, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        ),
      );
      throw new Error("unreachable");
    });
    const task = startGitHubPush(config());
    await vi.waitFor(() =>
      expect(useGitHubPushJob.getState().phase).toBe("publishing"),
    );
    dismissGitHubPush();
    expect(useGitHubPushJob.getState().status).toBe("running");
    cancelGitHubPush();
    await task;
    expect(useGitHubPushJob.getState().status).toBe("cancelled");
    expect(useGitHubPushJob.getState().message).toContain("最新指针可能已写入");
    expect(useGitHubPushJob.getState().result).toBeNull();
  });
});
