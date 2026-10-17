import { expect, it, vi } from "vitest";
import { completeCandidatePreflight } from "../../src/lib/sync/complete-preflight";
import { inspectRemoteProtocol } from "../../src/lib/sync/remote-protocol";
import { gitReadFixture } from "../helpers/git-read-fixture";

async function setup(cacheEnabled = true) {
  const git = await gitReadFixture({ "README.md": "keep" });
  const revisions = Array.from({ length: 5 }, (_, i) =>
    (i + 1).toString(16).padStart(40, "0"),
  );
  revisions.forEach((sha, i) =>
    git.objects.set(`/git/commits/${sha}`, {
      sha,
      tree: { sha: git.tree },
      parents: i ? [{ sha: revisions[i - 1] }] : [],
    }),
  );
  git.objects.set("/git/ref/heads/backup/main", {
    object: { type: "commit", sha: revisions[4] },
  });
  const values = new Map<string, string[]>();
  const inspect = vi.fn(() =>
    inspectRemoteProtocol(
      git.request,
      {
        owner: "test",
        repo: "backup",
        path: "backup.json",
      },
      {
        historyLimit: 2,
        historyCache: cacheEnabled
          ? {
              read: async (sha) => values.get(sha) ?? null,
              write: async (sha, parents) => {
                values.set(sha, parents);
              },
            }
          : false,
      },
    ),
  );
  return { git, inspect, revisions };
}

it("continues actual partial inspections until every ancestor is verified", async () => {
  const s = await setup();
  const result = await completeCandidatePreflight(s.inspect);
  expect(result.history).toBe("complete");
  expect(result.evidence.legacyHistory).toBe("verified-never-enabled");
  expect(s.inspect).toHaveBeenCalledTimes(3);
  expect(
    s.git.calls.filter((path) => path.startsWith("/git/commits/")),
  ).toContain(`/git/commits/${s.revisions[0]}`);
});

it("bounds repeated partial inspections when cache is unavailable", async () => {
  const s = await setup(false);
  await expect(completeCandidatePreflight(s.inspect)).rejects.toThrow(
    "8 批上限",
  );
  expect(s.inspect).toHaveBeenCalledTimes(8);
});

it("does not start another batch after cancellation", async () => {
  const s = await setup();
  await expect(
    completeCandidatePreflight(s.inspect, () => {
      if (s.inspect.mock.calls.length) throw Error("检查已取消");
    }),
  ).rejects.toThrow("检查已取消");
  expect(s.inspect).toHaveBeenCalledTimes(1);
});

it("never retries missing or malformed ancestor evidence as a budget cutoff", async () => {
  const s = await setup();
  s.git.objects.delete(`/git/commits/${s.revisions[0]}`);
  await expect(completeCandidatePreflight(s.inspect)).rejects.toThrow();
  expect(s.inspect).toHaveBeenCalledTimes(3);
});

it("does not use legacy continuation for a budget-limited protocol snapshot chain", async () => {
  const s = await setup();
  const report = await s.inspect();
  const inspect = vi.fn(async () => ({
    ...report,
    support: "supported" as const,
  }));
  await expect(completeCandidatePreflight(inspect)).rejects.toThrow(
    "远端快照链尚未完整核验",
  );
  expect(inspect).toHaveBeenCalledTimes(1);
});

it("keeps the batch visible through network stages and clears it before comparison", async () => {
  const {
    beginSyncProgress,
    endSyncProgress,
    captureSyncProgress,
    readSyncProgress,
  } = await import("../../src/lib/sync/operation-progress");
  const s = await setup();
  const batches: number[] = [];
  const owner = beginSyncProgress("开始");
  try {
    await completeCandidatePreflight(async () => {
      captureSyncProgress()("读取 Git 对象", { receivedBytes: 10 });
      batches.push(readSyncProgress()!.historyBatch!);
      return s.inspect();
    });
    expect(batches).toEqual([1, 2, 3]);
    expect(readSyncProgress()?.historyBatch).toBeUndefined();
    expect(readSyncProgress()?.stage).toContain("准备候选比较");
  } finally {
    endSyncProgress(owner);
  }
});

it("refuses a protocol marker found in an older ancestor after multiple batches", async () => {
  const s = await setup();
  const old = await gitReadFixture({ "backup-protocol.json": "{}" });
  for (const [route, object] of old.objects)
    if (route.startsWith("/git/blobs/")) s.git.objects.set(route, object);
  const tree = "c".repeat(40);
  s.git.objects.set(`/git/trees/${tree}`, {
    ...(old.objects.get(`/git/trees/${old.tree}`) as object),
    sha: tree,
  });
  s.git.objects.set(`/git/commits/${s.revisions[0]}`, {
    sha: s.revisions[0],
    tree: { sha: tree },
    parents: [],
  });
  await expect(completeCandidatePreflight(s.inspect)).rejects.toMatchObject({
    code: "invalid-control",
  });
  expect(s.inspect).toHaveBeenCalledTimes(3);
});
