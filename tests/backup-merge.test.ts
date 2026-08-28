import { buildSafeMergedBackup, compareBackupSnapshots } from "../src/lib/sync/backup-merge";

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

function page(date: string, todos: Array<Record<string, unknown>>, updatedAt: string) {
  return { date, todos, todo_carryover: false, updated_at: updatedAt };
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
  daily_pages: [page("2026-08-28", [{ id: "todo", text: "base", done: false, order: 0, tags: [] }], "2026-08-28T01:00:00.000Z")],
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
  daily_pages: [
    page("2026-08-28", [
      { id: "todo", text: "local", done: false, order: 0, tags: [] },
      { id: "local-todo", text: "local only", done: false, order: 1, tags: [] },
    ], "2026-08-28T02:00:00.000Z"),
    page("2026-08-27", [], "2026-08-28T02:00:00.000Z"),
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
    note("remote-only", "remote only", "2026-08-28T03:00:00.000Z", "同名文档"),
  ],
  daily_pages: [
    page("2026-08-28", [
      { id: "todo", text: "remote", done: true, order: 0, tags: [] },
      { id: "remote-todo", text: "remote only", done: false, order: 1, tags: [] },
    ], "2026-08-28T03:00:00.000Z"),
    page("2026-08-29", [], "2026-08-28T03:00:00.000Z"),
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
assert(comparison.pages.conflicts === 1, "concurrently changed daily page is identified");
assert(comparison.pages.localOnly === 1 && comparison.pages.remoteOnly === 1, "local/remote-only daily pages are identified");

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

const mergedPage = bundle.daily_pages.find((item) => item.date === "2026-08-28")!;
assert(bundle.daily_pages.some((item) => item.date === "2026-08-27") && bundle.daily_pages.some((item) => item.date === "2026-08-29"),
  "safe merge keeps local-only and imports remote-only daily pages");
assert(mergedPage.todos.some((todo) => todo.id === "local-todo") && mergedPage.todos.some((todo) => todo.id === "remote-todo"),
  "daily-page conflict merge preserves local-only and remote-only todos");
assert(mergedPage.todos.some((todo) => String(todo.text).includes("本地同步冲突副本")),
  "concurrently edited todo is preserved as a conflict copy");

const conservative = compareBackupSnapshots(JSON.stringify(local), JSON.stringify(remote));
assert(conservative.conflicts.some((item) => item.id === "local-change"),
  "without a base, differing shared documents are handled conservatively");

console.log(`${passed} passed, 0 failed`);
