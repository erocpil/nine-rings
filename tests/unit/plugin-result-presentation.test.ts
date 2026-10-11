import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readResultPresentation,
  saveResultPresentation,
  RESULT_PRESENTATION_KEY,
} from "../../src/lib/plugin-system/result-presentation";
const data = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => data.set(key, value),
});
vi.stubGlobal("window", { dispatchEvent: vi.fn() });
afterEach(() => data.clear());
describe("host plugin result preferences", () => {
  it("separates one-shot command and continuous statistics defaults", () => {
    expect(readResultPresentation("date")).toEqual({
      surface: "status",
      position: "bottom",
    });
    expect(readResultPresentation("statistics")).toEqual({
      surface: "popup",
      position: "center",
    });
  });
  it("persists separate preferences without overwriting the other tool", () => {
    saveResultPresentation("date", { surface: "popup", position: "top" });
    saveResultPresentation("statistics", {
      surface: "status",
      position: "center",
    });
    expect(readResultPresentation("date")).toEqual({
      surface: "popup",
      position: "top",
    });
    expect(readResultPresentation("statistics").surface).toBe("status");
  });
  it("recovers corrupt settings and rejects unknown presentation values", () => {
    data.set(RESULT_PRESENTATION_KEY, "invalid json");
    expect(readResultPresentation("statistics").position).toBe("center");
    expect(() =>
      saveResultPresentation("date", {
        surface: "script" as "popup",
        position: "top",
      }),
    ).toThrow();
  });
});
