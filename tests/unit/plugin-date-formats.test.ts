import { expect, it, vi } from "vitest";
import { formatPluginDate } from "../../src/lib/plugin-system/date-formats";
it("formats local dates and times, including seconds and Chinese labels", () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  expect(formatPluginDate(date, "date")).toBe("2026-01-02");
  expect(formatPluginDate(date, "datetime")).toBe("2026-01-02 03:04");
  expect(formatPluginDate(date, "seconds")).toBe("2026-01-02 03:04:05");
  expect(formatPluginDate(date, "time")).toBe("03:04:05");
  expect(formatPluginDate(date, "chinese")).toBe("2026年1月2日 03:04");
});
it("ISO timestamps retain the selected instant's local offset, including fractional offsets", () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  const offset = vi.spyOn(date, "getTimezoneOffset").mockReturnValue(-330);
  expect(formatPluginDate(date, "iso")).toBe("2026-01-02T03:04:05+05:30");
  offset.mockReturnValue(210);
  expect(formatPluginDate(date, "iso")).toBe("2026-01-02T03:04:05-03:30");
  offset.mockReturnValue(0);
  expect(formatPluginDate(date, "iso")).toBe("2026-01-02T03:04:05+00:00");
});
