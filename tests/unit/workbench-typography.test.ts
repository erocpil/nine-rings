import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_TYPOGRAPHY,
  TYPOGRAPHY_KEY,
  parseWorkbenchTypography,
  saveWorkbenchTypography,
  workbenchTypographyVariables,
} from "../../src/apps/file-workbench/typography";
afterEach(() => vi.unstubAllGlobals());
it("uses independent 18px defaults and sanitizes persisted values", () => {
  expect(parseWorkbenchTypography(null)).toEqual(DEFAULT_TYPOGRAPHY);
  expect(parseWorkbenchTypography("broken")).toEqual(DEFAULT_TYPOGRAPHY);
  expect(parseWorkbenchTypography("null")).toEqual(DEFAULT_TYPOGRAPHY);
  expect(
    parseWorkbenchTypography(
      JSON.stringify({
        note_font_size: 100,
        source_font_family: "unknown",
        editor_font_family: "serif",
        editor_line_height: 0,
        editor_block_spacing: -1,
      }),
    ),
  ).toEqual({
    ...DEFAULT_TYPOGRAPHY,
    note_font_size: 32,
    editor_font_family: "serif",
    editor_line_height: 1.2,
    editor_block_spacing: 0,
  });
});
it("reuses appearance variables for classic and non-Classic reading gaps", () => {
  const vars = workbenchTypographyVariables({
    ...DEFAULT_TYPOGRAPHY,
    note_font_size: 20,
    editor_block_spacing: 1.5,
  });
  expect(vars["--editor-font-size"]).toBe("20px");
  expect(vars["--editor-block-spacing"]).toBe("1.5em");
  expect(vars["--style-block-gap"]).toBe("30px");
});
it("notifies other sessions only after persistence succeeds", () => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  const setItem = vi.fn();
  saveWorkbenchTypography(
    { getItem: () => null, setItem },
    { ...DEFAULT_TYPOGRAPHY, note_font_size: 22 },
  );
  expect(setItem).toHaveBeenCalledWith(
    TYPOGRAPHY_KEY,
    expect.stringContaining('"note_font_size":22'),
  );
  expect(dispatchEvent).toHaveBeenCalledTimes(1);
  dispatchEvent.mockClear();
  expect(() =>
    saveWorkbenchTypography(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
      DEFAULT_TYPOGRAPHY,
    ),
  ).toThrow("quota");
  expect(dispatchEvent).not.toHaveBeenCalled();
});
