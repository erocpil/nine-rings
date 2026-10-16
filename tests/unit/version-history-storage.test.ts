import { expect, it, vi } from "vitest";
import { sameVersionSnapshot } from "../../src/lib/storage/version-snapshot";
const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { tauriDriver } from "../../src/lib/storage/tauri-driver";

it("normalizes SQLite JSON and flags, while detecting every restored field", () => {
  const note = {
    title: null,
    content: { ops: [{ insert: "body" }] },
    tags: ["a"],
    pinned: false,
    sort_order: 0,
  };
  expect(
    sameVersionSnapshot(note, {
      ...note,
      title: "",
      content: JSON.stringify(note.content),
      tags: '["a"]',
      pinned: 0,
    }),
  ).toBe(true);
  for (const update of [
    { title: "new" },
    { content: { ops: [] } },
    { tags: [] },
    { pinned: true },
    { sort_order: 1 },
  ]) {
    expect(sameVersionSnapshot(note, { ...note, ...update })).toBe(false);
  }
});

it("deletes Tauri histories in one transaction, bounded by document and version", async () => {
  invoke.mockClear();
  await tauriDriver.deleteNoteVersions("note-a", [
    "version-a",
    "version-a",
    "version-b",
  ]);
  expect(invoke).toHaveBeenCalledTimes(1);
  const [command, payload] = invoke.mock.calls[0];
  expect(command).toBe("db_transaction");
  const operations = JSON.parse((payload as { opsJson: string }).opsJson);
  expect(operations).toHaveLength(2);
  for (const op of operations) {
    expect(op).toEqual({
      type: "delete",
      table: "note_versions",
      where: [
        { col: "id", op: "=", val: expect.stringMatching(/^version-/) },
        { col: "note_id", op: "=", val: "note-a" },
      ],
    });
  }
  await tauriDriver.deleteNoteVersions("note-a", []);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("propagates failed cleanup without reporting success", async () => {
  invoke.mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(
    tauriDriver.deleteNoteVersions("note", ["history"]),
  ).rejects.toThrow("disk unavailable");
});
