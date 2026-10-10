import { afterEach, expect, test, vi } from "vitest";
import { copyToClipboard } from "../../src/lib/clipboard";

afterEach(() => vi.unstubAllGlobals());
class Item {
  constructor(public data: Record<string, Promise<Blob>>) {}
}
function fixture(write?: (items: Item[]) => Promise<void>) {
  vi.stubGlobal("ClipboardItem", Item);
  const writeText = vi.fn().mockResolvedValue(undefined);
  const writer = vi.fn(
    write ??
      (async (items: Item[]) => {
        await items[0].data["text/plain"];
      }),
  );
  vi.stubGlobal("navigator", { clipboard: { write: writer, writeText } });
  return { writer, writeText };
}

test("clipboard request starts before saving completes and exposes content only after save", async () => {
  let finish!: () => void;
  let copied: string | null = null;
  const { writer } = fixture(async (items) => {
    copied = await (await items[0].data["text/plain"]).text();
  });
  const pending = copyToClipboard("reference", {
    beforeCopy: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  expect(writer).toHaveBeenCalledOnce();
  expect(copied).toBeNull();
  finish();
  await pending;
  expect(copied).toBe("reference");
});

test("saving rejection cannot publish a reference or fall back to writeText", async () => {
  const { writeText } = fixture();
  await expect(
    copyToClipboard("reference", {
      beforeCopy: async () => {
        throw new Error("save failed");
      },
    }),
  ).rejects.toThrow("save failed");
  expect(writeText).not.toHaveBeenCalled();
});

test("unsupported clipboard item falls back after successful save", async () => {
  let saved = false;
  const { writeText } = fixture(async () => {
    throw new Error("unsupported");
  });
  await copyToClipboard("reference", {
    beforeCopy: async () => {
      saved = true;
    },
  });
  expect(saved).toBe(true);
  expect(writeText).toHaveBeenCalledWith("reference");
});

test("legacy clipboard waits for saving; ordinary text copy remains unchanged", async () => {
  const { writer, writeText } = fixture();
  await copyToClipboard("ordinary");
  expect(writer).not.toHaveBeenCalled();
  expect(writeText).toHaveBeenCalledWith("ordinary");
  vi.stubGlobal("ClipboardItem", undefined);
  let saved = false;
  writeText.mockImplementation(async () => {
    expect(saved).toBe(true);
  });
  await copyToClipboard("reference", {
    beforeCopy: async () => {
      saved = true;
    },
  });
});
