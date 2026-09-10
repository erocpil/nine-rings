import { afterEach, expect, it, vi } from "vitest";
import { PdfFileCache } from "../../src/lib/pdf-file-cache";
import {
  trackPdfCleanup,
  waitForPdfCleanup,
} from "../../src/lib/pdf-document-lifecycle";

afterEach(() => vi.useRealTimers());

it("file cache preserves source bytes after a worker transfer and bounds retention", () => {
  vi.useFakeTimers();
  const cache = new PdfFileCache(8, 100, 2);
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  cache.remember("one", bytes);
  const transferred = cache.get("one")!.slice(0);
  structuredClone(transferred, { transfer: [transferred] });
  expect(transferred.byteLength).toBe(0);
  expect(Array.from(new Uint8Array(cache.get("one")!))).toEqual([1, 2, 3, 4]);
  cache.remember("two", new ArrayBuffer(5));
  expect(cache.get("one")).toBeUndefined();
  cache.remember("large", new ArrayBuffer(9));
  expect(cache.get("large")).toBeUndefined();
  vi.advanceTimersByTime(100);
  expect(cache.get("two")).toBeUndefined();
  cache.remember("one", bytes); // Reader closes after a long active session.
  expect(cache.get("one")).toBe(bytes);
  cache.clear();
});

it("opening waits for every previous cleanup, including a failed cleanup", async () => {
  let finish!: () => void;
  trackPdfCleanup(
    "one",
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  trackPdfCleanup("one", Promise.reject(new Error("worker already stopped")));
  let ready = false;
  const opening = waitForPdfCleanup("one").then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  await waitForPdfCleanup("another");
  finish();
  await opening;
  expect(ready).toBe(true);
});
