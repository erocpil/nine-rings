import type { DocumentMetadata } from "../types/models";

/** Apply only user changes so a pending body save cannot resurrect stale source or bookmarks. */
export function mergeDocumentMetadata(
  base: DocumentMetadata = {},
  draft: DocumentMetadata = {},
  latest: DocumentMetadata = {},
): DocumentMetadata {
  const result = { ...latest } as Record<string, unknown>;
  const oldFields = base as Record<string, unknown>;
  const newFields = draft as Record<string, unknown>;
  for (const key of new Set([...Object.keys(base), ...Object.keys(draft)])) {
    if (JSON.stringify(oldFields[key]) === JSON.stringify(newFields[key]))
      continue;
    if (newFields[key] === undefined) delete result[key];
    else result[key] = newFields[key];
  }
  return result as DocumentMetadata;
}
