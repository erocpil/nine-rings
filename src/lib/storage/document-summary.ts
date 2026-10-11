import { extractPlainText } from "./core";
import type { Note } from "../../types/models";
import { normalizeDocType } from "./normalize";
import { documentSizeBytes } from "../document-size";

/** A projection, never an editable Note or a source of document content. */
export type DocumentSummary = Omit<Note, "content"> & {
  contentBytes: number;
  originalFileName?: string;
  sourceFormat?: "text" | "markdown";
};

function array(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

/** Derived IDB index key; written atomically with its owner, excluded from backups. */
export function withDocumentSummary(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") return value;
  let body = row.content;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = undefined; }
  }
  const format = (body as Note["content"] | undefined)?.metadata?.sourceFormat;
  const summary: DocumentSummary = {
    id: row.id, date: String(row.date ?? ""), title: typeof row.title === "string" ? row.title : null,
    tags: array(row.tags), concepts: array(row.concepts), linkedDocIds: array(row.linkedDocIds),
    pinned: row.pinned === true || row.pinned === 1, readonly: row.readonly === true || row.readonly === 1,
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
    created_at: String(row.created_at ?? ""), updated_at: String(row.updated_at ?? ""),
    storagePath: typeof row.storagePath === "string" ? row.storagePath : undefined,
    deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : undefined,
    docType: normalizeDocType(row.docType),
    contentBytes: typeof row.content === "string" ? new TextEncoder().encode(row.content).byteLength : documentSizeBytes(row.content),
    originalFileName: typeof (body as Note["content"] | undefined)?.metadata?.originalFileName === "string" ? (body as Note["content"]).metadata!.originalFileName : undefined,
    sourceFormat: format === "text" || format === "markdown" ? format : undefined,
  };
  return { ...row, updated_at: summary.updated_at, search_text: extractPlainText(body), document_summary: JSON.stringify(summary) };
}
