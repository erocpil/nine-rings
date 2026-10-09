import type { Note, PathNode } from "../types/models";
import { localDateKey } from "./local-date";
import { QUICK_NOTES_PATH } from "./quick-notes";

export type WorkspaceSummaryKind = "all" | "notes" | "today" | "favorites" | "recent";
export type WorkspaceDocumentSummary = Pick<Note, "id" | "title" | "storagePath" | "updated_at">;

export function workspaceDocuments(tree: PathNode[]): WorkspaceDocumentSummary[] {
  return tree.filter(node => node.type === "document" && node.noteId).map(node => ({
    id: node.noteId!, title: node.name,
    storagePath: node.path.slice(0, Math.max(0, node.path.lastIndexOf("/"))),
    updated_at: node.updatedAt ?? "",
  }));
}

export function modifiedOnLocalDay(timestamp: string, day: string): boolean {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) && localDateKey(date) === day;
}

export function workspaceCounts(documents: WorkspaceDocumentSummary[], favorites: string[], day: string) {
  return {
    recent: Math.min(15, documents.length),
    all: documents.length,
    notes: workspaceSummaryDocuments(documents, "notes", favorites, day).length,
    today: workspaceSummaryDocuments(documents, "today", favorites, day).length,
    favorites: workspaceSummaryDocuments(documents, "favorites", favorites, day).length,
  };
}

/** Counts and hover previews use the same path, local-day and favorite rules. */
export function workspaceSummaryDocuments(documents: WorkspaceDocumentSummary[], kind: WorkspaceSummaryKind, favorites: string[], day: string) {
  switch (kind) {
    case "recent": return [...documents].sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) || a.id.localeCompare(b.id)).slice(0, 15);
    case "all": return documents;
    case "notes": return documents.filter(note => note.storagePath === QUICK_NOTES_PATH || note.storagePath?.startsWith(`${QUICK_NOTES_PATH}/`));
    case "today": return documents.filter(note => modifiedOnLocalDay(note.updated_at, day));
    case "favorites": {
      const ids = new Set(favorites);
      return documents.filter(note => ids.has(note.id));
    }
  }
}

/** Popovers have their own visit ordering and limit; sidebar queries stay unchanged. */
export function workspaceSummaryPreviewDocuments(documents: WorkspaceDocumentSummary[], kind: WorkspaceSummaryKind, favorites: string[], day: string, recentIds: string[]) {
  if (kind === "recent") {
    const byId = new Map(documents.map(note => [note.id, note]));
    return [...new Set(recentIds)].flatMap(id => byId.has(id) ? [byId.get(id)!] : []).slice(0, 16).reverse();
  }
  const newestFirst = [...workspaceSummaryDocuments(documents, kind, favorites, day)]
    .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) || a.id.localeCompare(b.id));
  return kind === "all" ? newestFirst : newestFirst.slice(0, 15).reverse();
}

export function workspaceSummaryShortcutIndex(key: string): number | null {
  return /^[0-9a-f]$/i.test(key) ? Number.parseInt(key, 16) : null;
}
