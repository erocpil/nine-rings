import { expect, it } from "vitest";
import { localFileInfoTimes } from "../../src/lib/local-files/file-info-times";
it("maps native metadata and keeps snapshot modification time authoritative", () => {
  expect(
    localFileInfoTimes(
      { size: 3, modifiedMs: 4000, createdMs: 1000, accessedMs: 2000 },
      { size: 3, modifiedMs: 3000 },
    ),
  ).toEqual({
    createdAt: new Date(1000).toISOString(),
    updatedAt: new Date(3000).toISOString(),
    lastAccessedAt: new Date(2000).toISOString(),
  });
  expect(
    localFileInfoTimes(
      { size: 3, modifiedMs: 4000, createdMs: 0, accessedMs: 0 },
      null,
    ),
  ).toMatchObject({
    createdAt: new Date(0).toISOString(),
    lastAccessedAt: new Date(0).toISOString(),
  });
});
it("does not invent creation or access times when a browser or filesystem does not provide them", () => {
  expect(
    localFileInfoTimes(
      { size: 0, modifiedMs: 0, createdMs: null, accessedMs: null },
      null,
    ),
  ).toEqual({
    createdAt: undefined,
    updatedAt: new Date(0).toISOString(),
    lastAccessedAt: undefined,
  });
  expect(
    localFileInfoTimes(
      { size: 0, modifiedMs: NaN, createdMs: Infinity, accessedMs: 1e20 },
      null,
    ),
  ).toEqual({
    createdAt: undefined,
    updatedAt: undefined,
    lastAccessedAt: undefined,
  });
});
