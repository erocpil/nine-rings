import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  pathNormalizationCollisions,
  assertNoPathNormalizationCollision,
} from "../../src/lib/path-normalization";
import {
  conceptSearchKey,
  mergedConcepts,
} from "../../src/lib/concept-identity";
import { idbAdapter } from "../../src/lib/storage/idb";
import { protectedAdapter } from "../../src/lib/storage/protected-adapter";
import { api } from "../../src/lib/api";
import { buildMarkdownImportInput } from "../../src/lib/markdown-import";
import {
  relocateProtectedFolder,
  setPathPassword,
} from "../../src/lib/document-protection";
import { toSearchNote } from "../../src/lib/search-index-core";

describe("data boundary policies", () => {
  it("reports NFC collisions in parent segments but preserves case and literal spellings", () => {
    const paths = ["ideas/café/a", "ideas/cafe\u0301/b", "ideas/CAFÉ/c"];
    expect(pathNormalizationCollisions(paths)).toEqual([
      {
        canonicalPath: "ideas/café",
        paths: ["ideas/cafe\u0301", "ideas/café"],
      },
    ]);
    expect(() =>
      assertNoPathNormalizationCollision(paths[1], [paths[0]]),
    ).toThrow("Unicode");
    expect(() =>
      assertNoPathNormalizationCollision(
        "ideas/cafe\u0301",
        [paths[0]],
        "ideas/café",
      ),
    ).not.toThrow();
  });
  it("rejects direct create and property move into an equivalent Unicode path before changing content", async () => {
    const adapter = protectedAdapter(idbAdapter);
    await adapter.createNote({
      title: "canonical",
      storagePath: "projects/café",
      content: { ops: [] },
    });
    await expect(
      adapter.createNote({
        title: "collision",
        storagePath: "projects/cafe\u0301",
        content: { ops: [] },
      }),
    ).rejects.toThrow("Unicode");
    const note = await adapter.createNote({
      title: "move",
      storagePath: "projects/safe",
      content: { ops: [{ insert: "keep" }] },
    });
    await expect(
      adapter.updateNote(note.id, {
        storagePath: "projects/cafe\u0301",
        title: "changed",
      }),
    ).rejects.toThrow("Unicode");
    expect(await adapter.getNote(note.id)).toMatchObject({
      title: "move",
      storagePath: "projects/safe",
      content: { ops: [{ insert: "keep" }] },
    });
  });
  it("checks nested destination paths and protected roots before a folder move/password prompt", async () => {
    const existing = await idbAdapter.createNote({
      title: "existing",
      storagePath: "archives/destination/café",
      content: { ops: [] },
    });
    const moving = await idbAdapter.createNote({
      title: "moving",
      storagePath: "archives/source/cafe\u0301",
      content: { ops: [] },
    });
    await expect(
      relocateProtectedFolder("archives/source", "archives/destination"),
    ).rejects.toThrow("Unicode");
    expect((await idbAdapter.getNote(moving.id))!.storagePath).toBe(
      "archives/source/cafe\u0301",
    );
    expect((await idbAdapter.getNote(existing.id))!.storagePath).toBe(
      "archives/destination/café",
    );
    await expect(
      setPathPassword("archives/destination/cafe\u0301"),
    ).rejects.toThrow("Unicode");
  });
  it("concept equivalence is for search; explicit merge rewrites only named sources", async () => {
    expect(conceptSearchKey(" CAFÉ ")).toBe(conceptSearchKey("cafe\u0301"));
    expect(
      mergedConcepts(["Café", "CAFÉ", "unrelated"], ["Café"], "new"),
    ).toEqual(["new", "CAFÉ", "unrelated"]);
    const note = await api.notes.create({
      title: "concepts",
      storagePath: "ideas/concepts",
      content: { ops: [] },
      concepts: ["Café", "CAFÉ"],
    });
    expect(
      (await api.docs.summaries({ concept: "cafe\u0301" })).some(
        (row) => row.id === note.id,
      ),
    ).toBe(true);
    expect(await api.docs.mergeConcepts(["Café"], "Merged")).toBe(1);
    expect((await api.notes.get(note.id))!.concepts).toEqual([
      "Merged",
      "CAFÉ",
    ]);
  });
  it("repeated import skips identical content; edited source conflict preserves the old identity/body", async () => {
    const input = buildMarkdownImportInput(
      "source.md",
      "# Import identity\n\noriginal",
      {
        date: "2026-10-11",
        mode: "document",
        storagePath: "references/identity",
      },
    );
    const first = await api.notes.importText(input);
    expect(first.status).toBe("created");
    expect((await api.notes.importText(input)).status).toBe("skipped");
    await api.notes.update(first.note.id, {
      content: {
        ops: [{ insert: "local edit" }],
        metadata: { originalFileName: "source.md" },
      },
    });
    await expect(api.notes.importText(input)).rejects.toThrow("冲突");
    expect((await api.notes.get(first.note.id))!.content.ops).toEqual([
      { insert: "local edit" },
    ]);
  });
  it("rebuild uses current extraction rules instead of stale derived text; encrypted content stays absent", async () => {
    const note = await idbAdapter.createNote({
      title: "index",
      storagePath: "ideas/index",
      content: { ops: [{ insert: "fresh" }] },
    });
    expect(
      toSearchNote({ ...note, search_text: "obsolete" } as typeof note)
        .search_text,
    ).toBe("fresh");
    expect(
      toSearchNote({
        ...note,
        content: { ops: [], encrypted: {} },
      } as typeof note).search_text,
    ).toBe("");
  });
});

it("summary stale-date filtering uses instants and excludes the exact boundary", async () => {
  const note = await api.notes.create({
    title: "dated",
    storagePath: "ideas/date-boundary",
    content: { ops: [] },
  });
  const exact = new Date(note.updated_at).toISOString();
  expect(
    (
      await api.docs.summaries({
        storagePath: "ideas/date-boundary",
        staleBefore: exact,
      })
    ).some((row) => row.id === note.id),
  ).toBe(false);
  expect(
    (
      await api.docs.summaries({
        storagePath: "ideas/date-boundary",
        staleBefore: new Date(Date.parse(exact) + 1).toISOString(),
      })
    ).some((row) => row.id === note.id),
  ).toBe(true);
});
