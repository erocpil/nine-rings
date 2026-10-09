import { describe, expect, it } from "vitest";
import {
  modifiedOnLocalDay,
  workspaceCounts,
  workspaceDocuments,
  workspaceSummaryDocuments,
  workspaceSummaryPreviewDocuments,
  workspaceSummaryShortcutIndex,
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
    ).toEqual({ all: 4, notes: 2, today: 2, favorites: 1, recent: 4 });
    expect(workspaceCounts([], ["missing"], "2026-10-09")).toEqual({
      recent: 0,
      all: 0,
      notes: 0,
      today: 0,
      favorites: 0,
    });
  });

  it("recent preview uses edit timestamps rather than visit order and caps at fifteen", () => {
    const documents = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: String(i),
      storagePath: "ideas",
      updated_at: new Date(2026, 9, 10, 0, i).toISOString(),
    }));
    expect(
      workspaceSummaryDocuments(documents, "recent", [], "2026-10-10").map(
        (note) => note.id,
      ),
    ).toEqual(Array.from({ length: 15 }, (_, i) => String(19 - i)));
    expect(documents[0].id).toBe("0");
  });

  it("recent popover includes unedited visits, skips deleted/duplicate IDs and places newest visits last", () => {
    const documents = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: String(i),
      storagePath: "ideas",
      updated_at: new Date(2026, 9, 10, 0, 20 - i).toISOString(),
    }));
    const visits = [
      "missing",
      "19",
      "19",
      ...Array.from({ length: 19 }, (_, i) => String(18 - i)),
    ];
    expect(
      workspaceSummaryPreviewDocuments(
        documents,
        "recent",
        [],
        "2026-10-10",
        visits,
      ).map((note) => note.id),
    ).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 4)));
    expect(
      workspaceSummaryPreviewDocuments(
        documents,
        "recent",
        [],
        "2026-10-10",
        [],
      ).length,
    ).toBe(0);
    // The sidebar retains its previous edit-time query.
    expect(
      workspaceSummaryDocuments(documents, "recent", [], "2026-10-10")[0].id,
    ).toBe("0");
  });

  it("notes, today and favorites cap recent edits at fifteen with newest at the bottom", () => {
    const documents = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: String(i),
      storagePath: "ideas/notes",
      updated_at: new Date(2026, 9, 10, 0, i).toISOString(),
    }));
    for (const kind of ["notes", "today", "favorites"] as const) {
      expect(
        workspaceSummaryPreviewDocuments(
          documents,
          kind,
          documents.map((note) => note.id),
          "2026-10-10",
          [],
        ).map((note) => note.id),
      ).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 5)));
      expect(
        workspaceSummaryDocuments(
          documents,
          kind,
          documents.map((note) => note.id),
          "2026-10-10",
        ),
      ).toHaveLength(20);
    }
    expect(
      workspaceSummaryPreviewDocuments(documents, "all", [], "2026-10-10", []),
    ).toHaveLength(20);
  });

  it("uses a single hexadecimal key, accepts uppercase, and rejects other input", () => {
    for (const key of "0123456789abcdef")
      expect(workspaceSummaryShortcutIndex(key)).toBe(Number.parseInt(key, 16));
    expect(workspaceSummaryShortcutIndex("F")).toBe(15);
    for (const key of ["", "10", "g", "Escape", "é"])
      expect(workspaceSummaryShortcutIndex(key)).toBeNull();
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
