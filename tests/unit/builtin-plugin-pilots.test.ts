import { expect, it, vi } from "vitest";
import {
  builtinDocumentStatistics,
  insertBuiltinDate,
} from "../../src/lib/plugin-system/builtin-pilots";
import type { createPluginSdk } from "../../src/lib/plugin-system/sdk-client";

it("statistics count Unicode code points, exclude whitespace separately and handle structured content", () => {
  expect(
    builtinDocumentStatistics({ ops: [{ insert: "中文😀\r\n A" }] }),
  ).toEqual({ characters: 6, nonWhitespace: 4, lines: 2 });
  expect(
    builtinDocumentStatistics({
      ops: [
        { insert: { blockquote: { content: [{ insert: "引用" }] } } },
        { insert: "\n" },
        { insert: { list: { items: [{ content: [{ insert: "待办" }] }] } } },
      ],
    }),
  ).toEqual({ characters: 5, nonWhitespace: 4, lines: 2 });
  expect(builtinDocumentStatistics({ ops: [] })).toEqual({
    characters: 0,
    nonWhitespace: 0,
    lines: 0,
  });
});

it("date reports completion only after persistence; save failure never repeats insertion", async () => {
  let saved!: () => void;
  const insert = vi.fn(async () => ({
    ok: true,
    applied: true,
    value: { documentId: "a", revision: "r" },
  }));
  const whenSaved = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        saved = resolve;
      }),
  );
  const sdk = {
    capabilities: async () => ({
      methods: ["editor.captureSelection", "editor.insert"],
    }),
    editor: { captureSelection: async () => ({ token: "target" }), insert },
    documents: { whenSaved },
  } as unknown as ReturnType<typeof createPluginSdk>;
  const signal = new AbortController().signal;
  let complete = false;
  const pending = insertBuiltinDate(sdk, signal, new Date(2026, 9, 11)).then(
    () => {
      complete = true;
    },
  );
  await vi.waitFor(() => expect(whenSaved).toHaveBeenCalledOnce());
  expect(complete).toBe(false);
  expect(insert).toHaveBeenCalledWith(
    { token: "target" },
    { format: "text", value: "2026-10-11" },
    { signal },
  );
  saved();
  await pending;
  whenSaved.mockRejectedValueOnce(new Error("保存失败"));
  await expect(insertBuiltinDate(sdk, signal)).rejects.toThrow("保存失败");
  expect(insert).toHaveBeenCalledTimes(2);
});
