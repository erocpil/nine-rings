import { afterEach, expect, it, vi } from "vitest";
const { unzip, terminate } = vi.hoisted(() => ({
  unzip: vi.fn(),
  terminate: vi.fn(),
}));
vi.mock("fflate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fflate")>()),
  unzip,
}));
import { parseEpubArchiveAsync } from "../../src/lib/epub-library";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("never starts an aborted archive and terminates an in-flight archive on cancellation", async () => {
  unzip.mockReturnValue(terminate);
  const already = new AbortController();
  already.abort();
  await expect(
    parseEpubArchiveAsync(new ArrayBuffer(0), already.signal),
  ).rejects.toThrow();
  expect(unzip).not.toHaveBeenCalled();
  const abort = new AbortController();
  const work = parseEpubArchiveAsync(new ArrayBuffer(0), abort.signal);
  abort.abort();
  await expect(work).rejects.toThrow();
  expect(terminate).toHaveBeenCalledOnce();
});
it("enforces the smaller preview expansion budget and releases a timed out worker", async () => {
  unzip.mockImplementation((_bytes, options, done) => {
    expect(options.filter({ originalSize: 65 * 1024 * 1024 })).toBe(false);
    done(null, {});
    return terminate;
  });
  await expect(
    parseEpubArchiveAsync(new ArrayBuffer(0), undefined, 64 * 1024 * 1024),
  ).rejects.toThrow("安全限制");
  vi.useFakeTimers();
  unzip.mockReturnValue(terminate).mockImplementation(() => terminate);
  const work = parseEpubArchiveAsync(new ArrayBuffer(0));
  const check = expect(work).rejects.toThrow("超时");
  await vi.advanceTimersByTimeAsync(30000);
  await check;
  expect(terminate).toHaveBeenCalledOnce();
});
