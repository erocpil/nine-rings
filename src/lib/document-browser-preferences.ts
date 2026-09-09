export const DOCUMENT_BROWSER_PREFERENCES_KEY =
  "nr:documentBrowserPreferences:v1";
export interface DocumentBrowserPreferences {
  sort: "updated" | "title";
  sortDirection: "asc" | "desc";
  view: "recent" | "all" | "favorites";
  fields: { path: boolean; tags: boolean; type: boolean; modified: boolean };
}

/** Allowlist only presentation preferences, never queries, paths or metadata. */
export function normalizeDocumentBrowserPreferences(
  raw: unknown,
): DocumentBrowserPreferences {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fields =
    value.fields && typeof value.fields === "object"
      ? (value.fields as Record<string, unknown>)
      : {};
  const sort = value.sort === "title" ? "title" : "updated";
  return {
    sort,
    sortDirection:
      value.sortDirection === "asc" || value.sortDirection === "desc"
        ? value.sortDirection
        : sort === "title"
          ? "asc"
          : "desc",
    view:
      value.view === "all" || value.view === "favorites"
        ? value.view
        : "recent",
    fields: {
      path: typeof fields.path === "boolean" ? fields.path : true,
      tags: fields.tags === true,
      type: fields.type === true,
      modified: fields.modified === true,
    },
  };
}

export function readDocumentBrowserPreferences(
  storage?: Pick<Storage, "getItem">,
): DocumentBrowserPreferences {
  try {
    return normalizeDocumentBrowserPreferences(
      JSON.parse(
        (storage ?? localStorage).getItem(DOCUMENT_BROWSER_PREFERENCES_KEY) ??
          "null",
      ),
    );
  } catch {
    return normalizeDocumentBrowserPreferences(null);
  }
}

export function saveDocumentBrowserPreferences(
  value: unknown,
  storage?: Pick<Storage, "setItem">,
): boolean {
  try {
    (storage ?? localStorage).setItem(
      DOCUMENT_BROWSER_PREFERENCES_KEY,
      JSON.stringify(normalizeDocumentBrowserPreferences(value)),
    );
    return true;
  } catch {
    return false;
  }
}
