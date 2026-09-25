import { afterEach, expect, test, vi } from "vitest";
import { readClipboardContent } from "../../src/lib/clipboard-content";

afterEach(() => vi.unstubAllGlobals());

test("toolbar paste falls back to text when WebView rich clipboard is unavailable", async () => {
  const readText = vi.fn().mockResolvedValue("line 1\n\nline 3\n");
  vi.stubGlobal("navigator", {
    clipboard: {
      read: vi.fn().mockRejectedValue(new Error("unsupported")),
      readText,
    },
  });
  expect(await readClipboardContent()).toEqual({
    text: "line 1\n\nline 3\n",
    html: "",
  });
  expect(readText).toHaveBeenCalledOnce();
});

test("successful rich clipboard keeps both representations", async () => {
  const readText = vi.fn();
  vi.stubGlobal("navigator", {
    clipboard: {
      read: async () => [
        {
          types: ["text/plain", "text/html"],
          getType: async (type: string) =>
            new Blob([type === "text/plain" ? "text" : "<b>text</b>"]),
        },
      ],
      readText,
    },
  });
  expect(await readClipboardContent()).toEqual({
    text: "text",
    html: "<b>text</b>",
  });
  expect(readText).not.toHaveBeenCalled();
});

test("denied text fallback remains an error rather than an empty paste", async () => {
  vi.stubGlobal("navigator", {
    clipboard: {
      read: async () => {
        throw new Error("unsupported");
      },
      readText: async () => {
        throw new Error("permission denied");
      },
    },
  });
  await expect(readClipboardContent()).rejects.toThrow("permission denied");
});
