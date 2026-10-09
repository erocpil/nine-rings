import type { Note, PathNode } from "../types/models";
import { localDateKey } from "./local-date";
import { QUICK_NOTES_PATH } from "./quick-notes";

export type WorkspaceSummaryKind = "all" | "notes" | "today" | "favorites";
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
  const favoriteIds = new Set(favorites);
  return {
    all: documents.length,
    notes: documents.filter(note => note.storagePath === QUICK_NOTES_PATH || note.storagePath?.startsWith(`${QUICK_NOTES_PATH}/`)).length,
    today: documents.filter(note => modifiedOnLocalDay(note.updated_at, day)).length,
    favorites: documents.filter(note => favoriteIds.has(note.id)).length,
  };
}
