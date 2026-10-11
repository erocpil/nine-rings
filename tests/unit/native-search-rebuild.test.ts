import { describe, expect, it, vi } from "vitest";
import { rebuildNativeSearchText } from "../../src/lib/storage/native-search-rebuild";

describe("native derived search text upgrade", () => {
  it("re-extracts supported blocks, redacts encrypted bodies, and retries changed snapshots", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "a",
          content: JSON.stringify({
            ops: [
              { insert: { blockquote: { content: [{ insert: "quote" }] } } },
              {
                insert: {
                  htmlDetails: {
                    summary: "summary",
                    content: [{ insert: "body" }],
                  },
                },
              },
            ],
          }),
        },
        {
          id: "b",
          content: JSON.stringify({
            encrypted: {},
            ops: [{ insert: "secret" }],
          }),
        },
      ])
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce([
        { id: "a", content: '{"ops":[{"insert":"concurrent edit"}]}' },
      ])
      .mockResolvedValueOnce(true);
    await rebuildNativeSearchText(invoke);
    expect(
      invoke.mock.calls[1][1].records.map(
        (record: { text: string }) => record.text,
      ),
    ).toEqual(["quotesummarybody", ""]);
    expect(invoke.mock.calls[3][1].records[0].text).toBe("concurrent edit");
  });
  it("does not transfer bodies again at the current version; failed writes do not count as success", async () => {
    const current = vi.fn().mockResolvedValue(null);
    await rebuildNativeSearchText(current);
    expect(current).toHaveBeenCalledTimes(1);
    const failed = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(rebuildNativeSearchText(failed)).rejects.toThrow("disk full");
  });
});
