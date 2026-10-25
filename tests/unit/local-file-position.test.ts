import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readLocalFilePosition,
  saveLocalFilePosition,
} from "../../src/lib/local-files/position";
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("updates an existing file to its latest cursor and both scroll coordinates", () => {
  saveLocalFilePosition("root:a.c", { offset: 0, scrollTop: 0, scrollLeft: 0 });
  saveLocalFilePosition("root:b.c", {
    offset: 18,
    scrollTop: 240,
    scrollLeft: 12,
  });
  saveLocalFilePosition("root:a.c", {
    offset: 31,
    scrollTop: 1800,
    scrollLeft: 120,
  });
  expect(readLocalFilePosition("root:a.c")).toEqual({
    offset: 31,
    scrollTop: 1800,
    scrollLeft: 120,
  });
  expect(readLocalFilePosition("root:b.c")).toEqual({
    offset: 18,
    scrollTop: 240,
    scrollLeft: 12,
  });
});
it("recently updated files survive bounded position eviction", () => {
  for (let index = 0; index < 64; index++)
    saveLocalFilePosition(`root:${index}`, {
      offset: index,
      scrollTop: index * 30,
      scrollLeft: 0,
    });
  saveLocalFilePosition("root:0", {
    offset: 99,
    scrollTop: 999,
    scrollLeft: 9,
  });
  saveLocalFilePosition("root:new", { offset: 0, scrollTop: 0, scrollLeft: 0 });
  expect(readLocalFilePosition("root:0")?.scrollTop).toBe(999);
  expect(readLocalFilePosition("root:1")).toBeNull();
  expect(readLocalFilePosition("root:new")).not.toBeNull();
});
