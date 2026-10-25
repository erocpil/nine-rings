import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  assertLocalPathClean,
  localPathContains,
  saveLocalFileEdits,
} from "../../src/lib/local-files/operations";
import { localFileService } from "../../src/lib/local-files/service";
import {
  listLocalDrafts,
  removeLocalDraft,
  writeLocalDraft,
} from "../../src/lib/local-files/recovery";
import {
  registerLocalFileCheckpoint,
  registerLocalFileSaver,
  setLocalFileDirty,
} from "../../src/lib/local-files/session";
import { matchLocalSource } from "../../src/lib/local-files/search-matches";
import { findTextMatches } from "../../src/lib/search-matching";
import { migrateLocalFilePathState } from "../../src/lib/local-files/path-state";
const draft = {
  identity: "root:src/a.c",
  source: "changed",
  baseSource: "original",
  baseRevision: "a".repeat(64),
  bom: true,
  lineEnding: "crlf" as const,
  savedAt: Date.now(),
};
beforeEach(async () => {
  for (const value of await listLocalDrafts())
    await removeLocalDraft(value.identity);
});
afterEach(() => {
  setLocalFileDirty(draft.identity, false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("path boundaries do not confuse sibling prefixes or another root", () => {
  expect(localPathContains("root", "src", "root:src/a.c")).toBe(true);
  expect(localPathContains("root", "src", "root:src2/a.c")).toBe(false);
  expect(localPathContains("root", "", "root2:src/a.c")).toBe(false);
});
it("captures a nested mounted session before refusing a path move with a dirty draft", async () => {
  const checkpoint = vi.fn(() => writeLocalDraft(draft));
  const unregister = registerLocalFileCheckpoint(draft.identity, checkpoint);
  try {
    await expect(assertLocalPathClean("root", "src")).rejects.toThrow("未保存");
    expect(checkpoint).toHaveBeenCalledOnce();
    await expect(assertLocalPathClean("root", "src2")).resolves.toBeUndefined();
  } finally {
    unregister();
  }
});
it("inactive saves preserve the draft on stale revision and use the original baseline", async () => {
  await writeLocalDraft(draft);
  const write = vi
    .spyOn(localFileService, "write")
    .mockRejectedValue(new Error("STALE_REVISION"));
  await expect(saveLocalFileEdits(draft.identity)).rejects.toThrow(
    "STALE_REVISION",
  );
  expect(write).toHaveBeenCalledWith(
    "root",
    "src/a.c",
    "changed",
    expect.objectContaining({
      revision: draft.baseRevision,
      bom: true,
      lineEnding: "crlf",
    }),
  );
  expect(await listLocalDrafts()).toHaveLength(1);
  write.mockResolvedValue({
    source: "changed",
    revision: "b".repeat(64),
    bom: true,
    lineEnding: "crlf",
    modifiedMs: 0,
    size: 7,
  });
  await saveLocalFileEdits(draft.identity);
  expect(await listLocalDrafts()).toHaveLength(0);
});
it("uses the live editor save controller rather than saving its older draft", async () => {
  await writeLocalDraft(draft);
  const save = vi.fn(async () => false),
    write = vi.spyOn(localFileService, "write");
  const unregister = registerLocalFileSaver(draft.identity, save);
  try {
    await expect(saveLocalFileEdits(draft.identity)).rejects.toThrow(
      "保存未完成",
    );
    expect(save).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    expect(await listLocalDrafts()).toHaveLength(1);
  } finally {
    unregister();
  }
});
it("migrates readonly rules, reading anchors and bookmarks without touching siblings", () => {
  const data = new Map<string, string>([
    [
      "nr:local-file-readonly-rules",
      JSON.stringify({
        "root:src": true,
        "root:src/a.c": false,
        "root:src2": true,
      }),
    ],
    [
      "nr:local-file-positions",
      JSON.stringify({ "root:src/a.c": { offset: 32 } }),
    ],
    ["nr:local-file-bookmarks:root:src/a.c", "[32]"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i],
  });
  migrateLocalFilePathState("root", "src", "lib/src");
  expect(JSON.parse(data.get("nr:local-file-readonly-rules")!)).toEqual({
    "root:lib/src": true,
    "root:lib/src/a.c": false,
    "root:src2": true,
  });
  expect(
    JSON.parse(data.get("nr:local-file-positions")!)["root:lib/src/a.c"],
  ).toEqual({ offset: 32 });
  expect(data.get("nr:local-file-bookmarks:root:lib/src/a.c")).toBe("[32]");
});
it("groups search results by actual source line, preserves offsets and applies word/case rules", async () => {
  const source = "block blocky block\nBlock\n// block";
  const result = await matchLocalSource(source, "block", {
    wholeWord: true,
    caseSensitive: true,
  });
  expect(result.rows.map((row) => [row.line, row.count])).toEqual([
    [1, 2],
    [3, 1],
  ]);
  expect(result.rows[1].from).toBe(source.lastIndexOf("block"));
  expect(result.limited).toBe(false);
  expect(findTextMatches("a".repeat(10000), "a", {}, 10)).toHaveLength(10);
  const limited = await matchLocalSource("a\n".repeat(700), "a", {});
  expect(limited.rows).toHaveLength(500);
  expect(limited.limited).toBe(true);
});
