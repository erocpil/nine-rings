import { buildSafeMergedBackup, compareBackupSnapshots, extractRemoteDocumentPreviews } from "../src/lib/sync/backup-merge";

let passed = 0;
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
  passed += 1;
}

function note(id: string, text: string, updatedAt: string, title = id, extra: Record<string, unknown> = {}) {
  return {
    id,
    date: "2026-08-28",
    title,
    content: { ops: [{ insert: `${text}\n` }] },
    tags: [],
    pinned: false,
    readonly: false,
    sort_order: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: updatedAt,
    ...extra,
  };
}

const base = {
  version: 1,
  exported_at: "2026-08-28T01:00:00.000Z",
  notes: [
    note("same", "same", "2026-08-28T01:00:00.000Z"),
    note("local-change", "base", "2026-08-28T01:00:00.000Z"),
    note("remote-change", "base", "2026-08-28T01:00:00.000Z"),
    note("conflict", "base", "2026-08-28T01:00:00.000Z", "冲突文档"),
    note("cross-format", "same", "2026-08-28T01:00:00.000Z", "跨端", {
      storage_path: "projects/cross",
      doc_type: "reference",
      concepts: ["格式"],
      linked_doc_ids: ["same"],
    }),
  ],
  config: { theme: "light" },
};

const local = {
  ...base,
  exported_at: "2026-08-28T02:00:00.000Z",
  notes: [
    note("same", "same", "2026-08-28T02:00:00.000Z"),
    note("local-change", "local", "2026-08-28T02:00:00.000Z"),
    note("remote-change", "base", "2026-08-28T01:00:00.000Z"),
    note("conflict", "local", "2026-08-28T02:00:00.000Z", "冲突文档（本地标题）"),
    note("cross-format", "same", "2026-08-28T02:00:00.000Z", "跨端", {
      storagePath: "projects/cross",
      docType: "reference",
      concepts: ["格式"],
      linkedDocIds: ["same"],
    }),
    note("local-only", "local only", "2026-08-28T02:00:00.000Z", "同名文档"),
  ],
  config: { theme: "light" },
};

const remote = {
  ...base,
  exported_at: "2026-08-28T03:00:00.000Z",
  notes: [
    note("same", "same", "2026-08-28T03:00:00.000Z"),
    note("local-change", "base", "2026-08-28T01:00:00.000Z"),
    note("remote-change", "remote", "2026-08-28T03:00:00.000Z"),
    note("conflict", "remote", "2026-08-28T03:00:00.000Z", "冲突文档（远端标题）"),
    note("cross-format", "same", "2026-08-28T03:00:00.000Z", "跨端", {
      storage_path: "projects/cross",
      doc_type: "reference",
      concepts: ["格式"],
      linked_doc_ids: ["same"],
    }),
    note("remote-only", "remote only", "2026-08-28T03:00:00.000Z", "同名文档", { storage_path: "remote/path" }),
  ],
  config: { theme: "dark" },
};

const comparison = compareBackupSnapshots(JSON.stringify(local), JSON.stringify(remote), JSON.stringify(base));
assert(comparison.baseAvailable, "three-way comparison reports an available base");
assert(comparison.localOnly.map((item) => item.id).join() === "local-only", "local-only note is identified by UUID");
assert(comparison.remoteOnly.map((item) => item.id).join() === "remote-only", "remote-only note is identified by UUID");
assert(comparison.localChanged.map((item) => item.id).join() === "local-change", "local-only modification is identified");
assert(comparison.remoteChanged.map((item) => item.id).join() === "remote-change", "remote-only modification is identified");
assert(comparison.conflicts.map((item) => item.id).join() === "conflict", "concurrent modification is identified as a conflict");
assert(comparison.unchanged === 2, "timestamps and snake/camel field names do not create false conflicts");

const merged = buildSafeMergedBackup(JSON.stringify(local), JSON.stringify(remote), JSON.stringify(base));
const bundle = JSON.parse(merged.json) as typeof remote;
const notes = new Map(bundle.notes.map((item) => [item.id, item]));
assert(notes.has("local-only") && notes.has("remote-only"), "safe merge keeps local-only and imports remote-only notes");
assert(JSON.stringify(notes.get("local-change")?.content).includes("local"), "safe merge keeps a local-only modification");
assert(JSON.stringify(notes.get("remote-change")?.content).includes("remote"), "safe merge applies a remote-only modification");
assert(JSON.stringify(notes.get("conflict")?.content).includes("remote"), "remote conflict version remains at the stable UUID");
const conflictCopy = bundle.notes.find((item) => item.id !== "conflict" && item.title.includes("本地同步冲突副本"));
assert(Boolean(conflictCopy) && JSON.stringify(conflictCopy?.content).includes("local"), "local conflict version is preserved as a copy");
assert(merged.conflictCopies === 1, "one document conflict copy is reported");
assert(bundle.notes.filter((item) => item.title === "同名文档").length === 2, "same-title notes with distinct UUIDs are both preserved");
assert(bundle.config.theme === "dark", "remote workspace settings remain the Pull source");

const conservative = compareBackupSnapshots(JSON.stringify(local), JSON.stringify(remote));
assert(conservative.conflicts.some((item) => item.id === "local-change"),
  "without a base, differing shared documents are handled conservatively");

const ignored = buildSafeMergedBackup(JSON.stringify(local), JSON.stringify(remote), JSON.stringify(base), {
  ignoreRemoteNoteIds: ["remote-only", "remote-change"],
});
const ignoredNotes = new Map((JSON.parse(ignored.json) as typeof remote).notes.map((item) => [item.id, item]));
assert(!ignoredNotes.has("remote-only"), "ignored remote-only document is not imported");
assert(JSON.stringify(ignoredNotes.get("remote-change")?.content).includes("base"), "ignored remote change does not overwrite local data");

const pathIgnored = buildSafeMergedBackup(JSON.stringify(local), JSON.stringify(remote), JSON.stringify(base), {
  ignoreRemotePaths: ["remote/path"],
});
assert(!(JSON.parse(pathIgnored.json) as typeof remote).notes.some((item) => item.id === "remote-only"), "ignored path excludes remote document");

const previews = extractRemoteDocumentPreviews(JSON.stringify(remote));
assert(previews.some((item) => item.id === "remote-only" && item.contentPreview.includes("remote")), "remote preview includes document text");
assert(previews.every((item) => item.title.length > 0), "remote previews include titles");

console.log(`${passed} passed, 0 failed`);
