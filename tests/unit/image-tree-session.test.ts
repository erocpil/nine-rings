import { afterEach, expect, test, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test("directory expansion and explicit collapse survive a cold module restart", async () => {
  const records = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
  });
  vi.resetModules();
  const before = await import("../../src/lib/image-library/session");
  before.saveImageDirectoryExpanded("root:trip", true);
  before.saveImageDirectoryExpanded("root:trip/day1", true);
  before.saveImageDirectoryExpanded("root:trip/day1", false);
  vi.resetModules();
  const after = await import("../../src/lib/image-library/session");
  expect(after.imageDirectoryExpanded("root:trip")).toBe(true);
  expect(after.imageDirectoryExpanded("root:trip/day1")).toBe(false);
  expect(after.imageLibrarySession.directories.size).toBe(0);
});
