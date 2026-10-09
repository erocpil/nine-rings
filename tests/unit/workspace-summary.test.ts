import { describe, expect, it } from "vitest";
import {
  modifiedOnLocalDay,
  workspaceCounts,
  workspaceDocuments,
} from "../../src/lib/workspace-summary";

describe("workspace summary", () => {
  it("uses tree metadata and ignores folders and incomplete document entries", () => {
    expect(
      workspaceDocuments([
        { type: "folder", path: "ideas", name: "ideas" },
        {
          type: "document",
          path: "ideas/notes/group/a",
          name: "随记",
          noteId: "a",
          updatedAt: "2026-10-09T00:00:00Z",
        },
        { type: "document", path: "ideas/missing", name: "无标识" },
      ]),
    ).toEqual([
      {
        id: "a",
        title: "随记",
        storagePath: "ideas/notes/group",
        updated_at: "2026-10-09T00:00:00Z",
      },
    ]);
  });

  it("counts notes by path boundary, actual favorites and the local calendar date", () => {
    const today = new Date(2026, 9, 9, 0, 1).toISOString();
    const yesterday = new Date(2026, 9, 8, 23, 59).toISOString();
    const documents = [
      { id: "a", title: "一", storagePath: "ideas/notes", updated_at: today },
      {
        id: "b",
        title: "二",
        storagePath: "ideas/notes/group",
        updated_at: yesterday,
      },
      {
        id: "c",
        title: "三",
        storagePath: "ideas/notes-other",
        updated_at: today,
      },
      { id: "d", title: "四", storagePath: "projects", updated_at: "invalid" },
    ];
    expect(
      workspaceCounts(documents, ["a", "a", "missing"], "2026-10-09"),
    ).toEqual({ all: 4, notes: 2, today: 2, favorites: 1 });
    expect(workspaceCounts([], ["missing"], "2026-10-09")).toEqual({
      all: 0,
      notes: 0,
      today: 0,
      favorites: 0,
    });
  });

  it("handles local midnight, future dates and malformed timestamps", () => {
    expect(
      modifiedOnLocalDay(
        new Date(2026, 9, 9, 0, 0).toISOString(),
        "2026-10-09",
      ),
    ).toBe(true);
    expect(
      modifiedOnLocalDay(
        new Date(2026, 9, 8, 23, 59).toISOString(),
        "2026-10-09",
      ),
    ).toBe(false);
    expect(
      modifiedOnLocalDay(
        new Date(2026, 9, 10, 0, 0).toISOString(),
        "2026-10-09",
      ),
    ).toBe(false);
    expect(modifiedOnLocalDay("invalid", "2026-10-09")).toBe(false);
  });
});
