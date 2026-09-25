import { afterEach, expect, test, vi } from "vitest";
import {
  applyInterfaceStyle,
  normalizeInterfaceStyle,
} from "../../src/lib/interface-style";
import { getConfig, setConfig } from "../../src/lib/storage/db-config";

afterEach(() => vi.unstubAllGlobals());
test("legacy and unknown styles use classic, known styles remain independent of theme", () => {
  expect(normalizeInterfaceStyle(undefined)).toBe("classic");
  expect(normalizeInterfaceStyle("unknown")).toBe("classic");
  const root = { dataset: {}, className: "theme-nord" };
  vi.stubGlobal("document", { documentElement: root });
  for (const style of ["classic", "calm", "calm-compact"]) {
    applyInterfaceStyle(style);
    expect(root.dataset).toEqual({ interfaceStyle: style });
    expect(root.className).toBe("theme-nord");
  }
});
test("persisted style changes preserve theme and explicit typography; legacy configuration migrates", async () => {
  let value = JSON.stringify({
    theme: "dracula",
    note_font_size: 21,
    editor_line_height: 1.9,
  });
  vi.stubGlobal("localStorage", {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  expect((await getConfig()).interface_style).toBe("classic");
  await setConfig({ interface_style: "calm-compact" });
  expect(await getConfig()).toMatchObject({
    interface_style: "calm-compact",
    theme: "dracula",
    note_font_size: 21,
    editor_line_height: 1.9,
  });
  await setConfig({ theme: "light" });
  expect((await getConfig()).interface_style).toBe("calm-compact");
});
