import { describe, expect, it } from "vitest";
import { diffDocumentLines } from "../../src/lib/document-diff";
import {
  buildSafeMergedBackup,
  documentPreview,
  extractRemoteDocumentPreviews,
  type ConflictChoice,
} from "../../src/lib/sync/backup-merge";

const note = (text: string) => ({
  id: "a",
  title: "文档",
  content: { ops: [{ insert: text }] },
  storagePath: "projects/test",
});
const local = note("本地\n第二行\n");
const remote = note("远端\n第二行\n");
const bundle = (record: typeof local) =>
  JSON.stringify({ notes: [record], daily_pages: [] });
const resolution = (choice: ConflictChoice) => ({
  a: {
    choice,
    localRevision: documentPreview(local).revision,
    remoteRevision: documentPreview(remote).revision,
  },
});

describe("conflict choices", () => {
  for (const choice of ["both", "local", "remote"] as const) {
    it(`keeps ${choice} with stable original ID and correct copy count`, () => {
      const result = buildSafeMergedBackup(
        bundle(local),
        bundle(remote),
        null,
        { conflictResolutions: resolution(choice) },
      );
      const notes = JSON.parse(result.json).notes;
      expect(notes).toHaveLength(choice === "both" ? 2 : 1);
      expect(notes[0].id).toBe("a");
      expect(notes[0].content).toEqual(
        choice === "local" ? local.content : remote.content,
      );
      expect(result.conflictCopies).toBe(choice === "both" ? 1 : 0);
      if (choice === "both") {
        expect(notes[1].id).not.toBe("a");
        expect(notes[1].content).toEqual(local.content);
      }
    });
  }
  it("defaults to retaining both", () => {
    expect(
      buildSafeMergedBackup(bundle(local), bundle(remote)).conflictCopies,
    ).toBe(1);
  });
  it("honors reviewed choices even if the baseline changes", () => {
    const result = buildSafeMergedBackup(
      bundle(local),
      bundle(remote),
      bundle(local),
      { conflictResolutions: resolution("local") },
    );
    expect(JSON.parse(result.json).notes[0].content).toEqual(local.content);
  });
  it("rejects stale local, remote, removed documents and invalid choices before merging", () => {
    const options = { conflictResolutions: resolution("remote") };
    for (const [a, b] of [
      [bundle(note("new")), bundle(remote)],
      [bundle(local), bundle(note("new"))],
      ["{}", bundle(remote)],
    ]) {
      expect(() => buildSafeMergedBackup(a, b, null, options)).toThrow(
        "重新 Pull 预检",
      );
    }
    expect(() =>
      buildSafeMergedBackup(bundle(local), bundle(remote), null, {
        conflictResolutions: resolution("invalid" as ConflictChoice),
      }),
    ).toThrow();
  });
  it("ignore takes precedence over conflict choices", () => {
    const result = buildSafeMergedBackup(bundle(local), bundle(remote), null, {
      ignoreRemoteNoteIds: ["a"],
      conflictResolutions: resolution("remote"),
    });
    expect(JSON.parse(result.json).notes).toEqual([local]);
  });
  it("preserves formatted content, line breaks and long text for previews", () => {
    const source = note("first\n\n  second\n" + "long".repeat(500));
    const [preview] = extractRemoteDocumentPreviews(bundle(source));
    expect(preview.content).toEqual(source.content);
    expect(preview.contentPreview).toContain("first\n\n  second\n");
    expect(preview.contentPreview.length).toBeGreaterThan(800);
  });
  it("does not expose encrypted content in the renderer or textual preview", () => {
    const preview = documentPreview({
      ...local,
      content: {
        encrypted: { ciphertext: "secret" },
        ops: [{ insert: "never show" }],
      },
    });
    expect(preview.encrypted).toBe(true);
    expect(preview.content).toBeNull();
    expect(preview.contentPreview).not.toContain("never show");
  });
});

describe("line diff", () => {
  for (const [left, right] of [
    ["", ""],
    ["", "a\n"],
    ["a\n", ""],
    ["甲\n乙\n乙\n末", "甲\n丙\n乙\n末"],
    ["a", "a\n"],
    ["same\nold\nend", "same\nnew\nend"],
    ["a\n".repeat(1000), "b\n".repeat(1000)],
  ]) {
    it(`is lossless (${left.length}/${right.length})`, () => {
      const diff = diffDocumentLines(left, right);
      const a = diff.lines.filter((line) => line.kind !== "added");
      const b = diff.lines.filter((line) => line.kind !== "removed");
      expect(a.map((line) => line.text).join("\n")).toBe(left);
      expect(b.map((line) => line.text).join("\n")).toBe(right);
      expect(a.map((line) => line.left)).toEqual(a.map((_, i) => i + 1));
      expect(b.map((line) => line.right)).toEqual(b.map((_, i) => i + 1));
    });
  }
  it("bounds quadratic work for long changed documents", () => {
    expect(
      diffDocumentLines("a\n".repeat(2000), "b\n".repeat(2000)).coarse,
    ).toBe(true);
  });
});
