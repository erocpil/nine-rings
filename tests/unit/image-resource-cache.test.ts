import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/image-library/preview-resource", () => ({
  imagePreview: vi.fn(),
}));
import { ImageResourceCache } from "../../src/lib/image-library/resource-cache";
import type { ImagePreviewResource } from "../../src/lib/image-library/preview-resource";
const image = { src: "/one.png", name: "one" };
it("reuses generated resources and preserves active leases when clearing", async () => {
  const dispose = vi.fn();
  const load = vi.fn(async () => ({
    url: "blob:one",
    width: 128,
    release: dispose,
  }));
  const cache = new ImageResourceCache(load);
  const first = await cache.acquire(image, new AbortController().signal, 128);
  first.release();
  const second = await cache.acquire(image, new AbortController().signal, 128);
  expect(load).toHaveBeenCalledTimes(1);
  cache.clear();
  expect(dispose).not.toHaveBeenCalled();
  second.release();
  second.release();
  expect(dispose).toHaveBeenCalledTimes(1);
});
it("deduplicates pending loads while cancellation only affects one consumer", async () => {
  let complete!: (resource: ImagePreviewResource) => void;
  const load = vi.fn(
    () =>
      new Promise<ImagePreviewResource>((resolve) => {
        complete = resolve;
      }),
  );
  const cache = new ImageResourceCache(load);
  const cancelled = new AbortController();
  const first = cache.acquire(image, cancelled.signal, 128);
  const second = cache.acquire(image, new AbortController().signal, 128);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  cancelled.abort();
  await rejected;
  complete({ url: "blob:one", width: 128, release: vi.fn() });
  const resource = await second;
  expect(resource.url).toBe("blob:one");
  expect(load).toHaveBeenCalledTimes(1);
  resource.release();
  cache.clear();
});
it("evicts unused least-recent resources under the capacity limit", async () => {
  const dispose = vi.fn();
  const cache = new ImageResourceCache(
    async () => ({ url: "blob:one", width: 128, release: dispose }),
    1024 * 1024,
    1,
  );
  const first = await cache.acquire(image, new AbortController().signal, 128);
  first.release();
  const second = await cache.acquire(
    { src: "/two.png", name: "two" },
    new AbortController().signal,
    128,
  );
  expect(dispose).toHaveBeenCalledTimes(1);
  second.release();
  cache.clear();
  expect(dispose).toHaveBeenCalledTimes(2);
});
