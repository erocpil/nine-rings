import { expect, it, vi } from "vitest";
import { operationGitRead } from "../../src/lib/sync/operation-git-read";
import { createPinnedReader } from "../../src/lib/sync/remote-protocol";
import { gitReadFixture } from "../helpers/git-read-fixture";
const route = `/git/commits/${"a".repeat(40)}`;
it("reuses immutable reads but always fetches mutable refs again", async () => {
  const request = vi.fn(async () => ({ value: 1 }));
  const cache = operationGitRead(request);
  await cache.read(route);
  await cache.read(route);
  await cache.read("/git/ref/heads/main");
  await cache.read("/git/ref/heads/main");
  expect(request).toHaveBeenCalledTimes(3);
  expect(cache.stats().hits).toBe(1);
  const next = operationGitRead(request);
  await next.read(route);
  expect(request).toHaveBeenCalledTimes(4);
});
it("deduplicates pending reads and never retains failed requests", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(Error("network"))
    .mockResolvedValue({ value: 1 });
  const cache = operationGitRead(request);
  await expect(
    Promise.all([cache.read(route), cache.read(route)]),
  ).rejects.toThrow("network");
  expect(request).toHaveBeenCalledTimes(1);
  expect(await cache.read(route)).toEqual({ value: 1 });
  expect(request).toHaveBeenCalledTimes(2);
});
it("keeps hits immutable and checks cancellation even on a hit", async () => {
  let cancelled = false;
  const cache = operationGitRead(
    async () => ({ child: ["original"] }),
    () => {
      if (cancelled) throw Error("cancelled");
    },
  );
  const value = (await cache.read(route)) as { child: string[] };
  expect(() => value.child.push("changed")).toThrow();
  cancelled = true;
  await expect(cache.read(route)).rejects.toThrow("cancelled");
});
it("evicts bounded entries and skips oversized responses", async () => {
  const large = "x".repeat(22 * 1024 * 1024);
  const request = vi.fn(async () => ({ content: large }));
  const cache = operationGitRead(request);
  await cache.read(route);
  await cache.read(`/git/blobs/${"b".repeat(40)}`);
  expect(cache.stats().estimatedBytes).toBeLessThanOrEqual(80 * 1024 * 1024);
  await cache.read(route);
  expect(request).toHaveBeenCalledTimes(3);
  const huge = operationGitRead(async () => ({ content: large + large }));
  await huge.read(route);
  expect(huge.stats().estimatedBytes).toBe(0);
});
it("reuses bytes across pinned readers without skipping per-reader integrity checks", async () => {
  const git = await gitReadFixture({ "backup.json": "{}" });
  const cache = operationGitRead(git.request);
  const first = createPinnedReader(cache.read);
  expect(await first.file(git.head, "backup.json")).toMatchObject({
    content: "{}",
  });
  const requests = git.calls.length;
  const next = createPinnedReader(cache.read);
  expect(await next.file(git.head, "backup.json")).toMatchObject({
    content: "{}",
  });
  expect(git.calls).toHaveLength(requests);
  const bad = operationGitRead(async (route) => {
    const value = (await git.request(route)) as Record<string, unknown>;
    if (route.startsWith("/git/blobs/")) value.size = 999;
    return value;
  });
  await expect(
    createPinnedReader(bad.read).file(git.head, "backup.json"),
  ).rejects.toThrow("integrity");
  await expect(
    createPinnedReader(bad.read).file(git.head, "backup.json"),
  ).rejects.toThrow("integrity");
});

it("releases cached content and does not refill after disposal", async () => {
  let resolve!: (v: unknown) => void;
  const cache = operationGitRead(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = cache.read(route);
  cache.dispose();
  resolve({ content: "late" });
  await result;
  expect(cache.stats().estimatedBytes).toBe(0);
  await expect(cache.read(route)).rejects.toThrow("已结束");
});
