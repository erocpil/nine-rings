import { withDB, getAll, getOne } from "./db";
import { noteFromDB, noteToDB, now, type StoredNote } from "./core";
import { snakeImportToCamel } from "./normalize";
import { noteToMarkdown } from "../markdown-serializer";
import { parseJsonAsync, stringifyJsonAsync } from "../data-transform-client";
import { getConfig, setConfig } from "./db-config";
import { validateBackup, type ValidatedTemplate } from "../backup-validation";
import { resolveImageRefs } from "./db-images";
import { localTemplates } from "./template-local";
import { isEncrypted, type ProtectedPath } from "../document-crypto";
import type { AppConfig } from "./types";
import type { DailyPage, NoteVersion } from "../../types/models";
import type { Template } from "./template-model";

type StoredDailyPage = Omit<DailyPage, "todos" | "todo_carryover"> & {
  todos: DailyPage["todos"] | string;
  todo_carryover: number | boolean;
};

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(token|password|secret|credential|authorization|__proto__|constructor|prototype)/i.test(
            key,
          ),
      )
      .map(([key, child]) => [key, sanitize(child)]),
  );
}

export async function exportData(): Promise<string> {
  const config = await getConfig();
  const snapshot = await withDB(async (db) => {
    const tx = db.transaction(["notes", "daily_pages", "note_versions", "protected_paths"], "readonly");
    const [notes, pages, versions, paths] = await Promise.all([
      getAll<StoredNote>(tx.objectStore("notes")),
      getAll<StoredDailyPage>(tx.objectStore("daily_pages")),
      getAll<NoteVersion>(tx.objectStore("note_versions")),
      getAll<ProtectedPath>(tx.objectStore("protected_paths")),
    ]);
    const live = notes.filter((n) => !n.deleted_at).map(noteFromDB);
    return { notes: live, pages, paths, versions: versions.filter(v => live.some(n => n.id === v.note_id && isEncrypted(n.content))) };
  });
  const notes = await resolveImageRefs(snapshot.notes);
  return stringifyJsonAsync(
    {
      version: snapshot.paths.length || notes.some(n => isEncrypted(n.content)) ? 2 : 1,
      ...(snapshot.paths.length ? { protected_paths: snapshot.paths } : {}),
      ...(snapshot.versions.length ? { protected_versions: snapshot.versions } : {}),
      exported_at: now(),
      notes,
      daily_pages: snapshot.pages.map((p) => ({
        ...p,
        todos: typeof p.todos === "string" ? JSON.parse(p.todos) : p.todos,
        todo_carryover: p.todo_carryover === 1 || p.todo_carryover === true,
      })),
      templates:
        typeof localStorage === "undefined"
          ? []
          : await localTemplates.listTemplates(),
      config: sanitize(config),
    },
    2,
  );
}

export async function importData(
  json: string,
  mode: "merge" | "replace" = "merge",
) {
  const data = await parseJsonAsync<unknown>(json);
  validateBackup(data);
  // Normalize and serialize before opening any write transaction.
  const notes = data.notes
    .map(snakeImportToCamel)
    .map(noteToDB);
  const pages = (data.daily_pages ?? []).map((p) => ({
    ...p,
    todos:
      typeof p.todos === "string" ? p.todos : JSON.stringify(p.todos ?? []),
    todo_carryover: p.todo_carryover === true || p.todo_carryover === 1 ? 1 : 0,
  }));
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  const before: [string, string | null][] = [
    "nine_rings_config",
    "nine-rings:templates",
  ].map((key) => [key, storage?.getItem(key) ?? null]);
  try {
    // Synchronous settings staging after validation, exact rollback on DB failure.
    if (data.config)
      await setConfig(sanitize(data.config) as Partial<AppConfig>);
    if (data.templates && storage) {
      const existing =
        mode === "replace" ? [] : await localTemplates.listTemplates();
      const merged = new Map<string, Template | ValidatedTemplate>(existing.map((t) => [t.id, t]));
      for (const t of data.templates) merged.set(t.id, t);
      storage.setItem(
        "nine-rings:templates",
        JSON.stringify([...merged.values()]),
      );
    }
    await withDB(async (db) => {
      const tx = db.transaction(
        ["notes", "daily_pages", "note_versions", "protected_paths"],
        "readwrite",
      );
      if (mode === "replace") {
        tx.objectStore("notes").clear();
        tx.objectStore("daily_pages").clear();
        tx.objectStore("note_versions").clear();
        tx.objectStore("protected_paths").clear();
      }
      for (const note of notes) tx.objectStore("notes").put(note);
      for (const page of pages) tx.objectStore("daily_pages").put(page);
      for (const path of data.protected_paths ?? []) tx.objectStore("protected_paths").put(path);
      for (const version of data.protected_versions ?? []) tx.objectStore("note_versions").put(version);
    });
  } catch (error) {
    if (storage)
      for (const [key, value] of before) {
        if (storage.getItem(key) === value) continue;
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      }
    throw error;
  }
  return {
    notes_imported: notes.length,
    pages_imported: pages.length,
    ...(data.config ? { configs_imported: 1 } : {}),
  };
}

export async function exportNoteMarkdown(noteId: string): Promise<string> {
  return withDB(async (db) => {
    const note = await getOne<StoredNote>(
      db.transaction("notes", "readonly").objectStore("notes"),
      noteId,
    );
    if (!note) throw new Error(`Note ${noteId} not found`);
    const n = noteFromDB(note);
    return noteToMarkdown(n.title, n.content);
  });
}
