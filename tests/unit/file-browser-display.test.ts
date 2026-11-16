import { expect, it } from "vitest";
import { browserDateText, browserDisplayColumns, DEFAULT_BROWSER_DISPLAY, parseBrowserDisplay } from "../../src/lib/local-files/browser-display";
it("normalizes stored display preferences and keeps pane overrides independent", () => {
  for (const raw of [null, "null", "broken", "[]"]) expect(parseBrowserDisplay(raw)).toEqual({ defaults: DEFAULT_BROWSER_DISPLAY, panes: [null, null] });
  const value = parseBrowserDisplay(JSON.stringify({ defaults: { fontSize: 99, rowHeight: -5, dateFormat: "invalid" }, panes: [{ size: false, type: false, modified: false, fontSize: 15.3, rowHeight: 42 }, null] }));
  expect(value.defaults).toEqual({ ...DEFAULT_BROWSER_DISPLAY, fontSize: 20, rowHeight: 32 });
  expect(value.panes[0]).toEqual({ ...DEFAULT_BROWSER_DISPLAY, fontSize: 15, rowHeight: 42, size: false, type: false, modified: false });
  expect(value.panes[1]).toBeNull();
  expect(browserDisplayColumns(value.panes[0]!, true)).toEqual(["name"]);
  expect(browserDisplayColumns(DEFAULT_BROWSER_DISPLAY, false)).toEqual(["name", "size", "modified"]);
  expect(browserDisplayColumns(DEFAULT_BROWSER_DISPLAY, true)).toEqual(["name", "type", "size", "modified"]);
});
it("formats local calendar dates without changing the underlying timestamp", () => {
  const value = new Date(2026, 10, 16, 9, 8, 7).getTime();
  expect(browserDateText(value, "iso")).toBe("2026-11-16 09:08:07");
  expect(browserDateText(value, "date")).toBe("2026-11-16");
  expect(browserDateText(value)).toBe(new Date(value).toLocaleString());
  expect(browserDateText(0, "iso")).not.toBe("—");
  for (const invalid of [undefined, NaN, Infinity, 1e30]) expect(browserDateText(invalid)).toBe("—");
});
