import { afterEach, expect, it, vi } from "vitest";
import { EpubBookCache } from "../../src/lib/epub-book-cache";
import type { ParsedEpub } from "../../src/lib/epub-library";

const book = (size = 4): ParsedEpub => ({
  title: "Book",
  chapters: [],
  toc: [],
  files: { chapter: new Uint8Array(size) },
});
afterEach(() => vi.useRealTimers());

it("retains a long reading session for another interval after close", async () => {
  vi.useFakeTimers();
  const cache = new EpubBookCache(100, 20);
  const active = await cache.load("a", async () => book());
  await vi.advanceTimersByTimeAsync(200);
  cache.remember("a", active);
  const loader = vi.fn(async () => book());
  expect(await cache.load("a", loader)).toBe(active);
  expect(loader).not.toHaveBeenCalled();
  cache.clear();
});

it("shares pending loads and reuses parsed bytes until the idle deadline", async () => {
  vi.useFakeTimers();
  const cache = new EpubBookCache(100, 20);
  const loader = vi.fn(async () => book());
  const first = cache.load("a", loader);
  expect(cache.load("a", loader)).toBe(first);
  const parsed = await first;
  await vi.advanceTimersByTimeAsync(90);
  expect(await cache.load("a", loader)).toBe(parsed);
  await vi.advanceTimersByTimeAsync(90);
  expect(loader).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10);
  expect(await cache.load("a", loader)).not.toBe(parsed);
  cache.clear();
});

it("bounds cached bytes and does not retain failed or deleted loads", async () => {
  vi.useFakeTimers();
  const cache = new EpubBookCache(100, 6);
  const first = await cache.load("a", async () => book());
  await cache.load("b", async () => book());
  expect(await cache.load("a", async () => book())).not.toBe(first);
  await expect(
    cache.load("bad", async () => {
      throw new Error("unreadable");
    }),
  ).rejects.toThrow("unreadable");
  await expect(cache.load("bad", async () => book())).resolves.toBeDefined();
  let complete!: (value: ParsedEpub) => void;
  const pending = cache.load(
    "deleted",
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await Promise.resolve();
  cache.invalidate("deleted");
  const oldBook = book();
  complete(oldBook);
  await pending;
  expect(await cache.load("deleted", async () => book())).not.toBe(oldBook);
  cache.clear();
});
