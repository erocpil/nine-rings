import { afterEach, expect, it, vi } from "vitest";
import {
  readReaderDiagnostics,
  recordReaderDiagnostic,
} from "../../src/lib/reader-diagnostics";

afterEach(() => vi.unstubAllGlobals());
it("bounds persisted diagnostics and excludes content", () => {
  let value =
    '[{"event":"open","at":1,"title":"private"},{"event":"unknown","at":2}]';
  vi.stubGlobal("localStorage", {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  expect(readReaderDiagnostics()).toEqual([{ event: "open", at: 1 }]);
  for (let i = 0; i < 50; i++) recordReaderDiagnostic("boot");
  expect(readReaderDiagnostics()).toHaveLength(40);
  expect(value).not.toContain("private");
});
it("does not break reading on corrupt storage or quota failure", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => "broken",
    setItem: () => {
      throw new Error("quota");
    },
  });
  expect(readReaderDiagnostics()).toEqual([]);
  expect(() => recordReaderDiagnostic("open")).not.toThrow();
});
