/** Device-local placement policy, independent of document content and permissions. */
export type DocumentWorkspaceOrigin = "database" | "local";
export type DocumentWorkspaceMode = "document" | "compact";
export type NavigationPanelKind = "outline" | "bookmark";
export interface DocumentWorkspacePreferences {
  database: DocumentWorkspaceMode;
  local: DocumentWorkspaceMode;
  compact: Record<
    DocumentWorkspaceOrigin,
    { active: NavigationPanelKind | null; width: number }
  >;
}
export const DOCUMENT_WORKSPACE_KEY = "nr:documentWorkspaceLayout";
export const DOCUMENT_WORKSPACE_EVENT = "nr:document-workspace-layout";
export function normalizeDocumentWorkspace(
  value: unknown,
): DocumentWorkspacePreferences {
  const raw = (
    value && typeof value === "object" ? value : {}
  ) as Partial<DocumentWorkspacePreferences>;
  const compact = (origin: DocumentWorkspaceOrigin) => {
    const state = raw.compact?.[origin];
    return {
      active:
        state?.active === "outline" || state?.active === "bookmark"
          ? state.active
          : null,
      width:
        typeof state?.width === "number" && Number.isFinite(state.width)
          ? Math.max(180, Math.min(600, state.width))
          : 300,
    };
  };
  return {
    database: raw.database === "compact" ? "compact" : "document",
    local: raw.local === "document" ? "document" : "compact",
    compact: { database: compact("database"), local: compact("local") },
  };
}
export function readDocumentWorkspace(): DocumentWorkspacePreferences {
  try {
    const raw = localStorage.getItem(DOCUMENT_WORKSPACE_KEY);
    if (raw) return normalizeDocumentWorkspace(JSON.parse(raw));
    const previous = localStorage.getItem("nr:local-file-active-panel");
    return normalizeDocumentWorkspace({
      compact: {
        local: {
          active:
            previous === "symbols" || previous === "outline"
              ? "outline"
              : previous === "bookmarks"
                ? "bookmark"
                : null,
          width:
            Number(localStorage.getItem("nr:local-file-panel-width")) || 300,
        },
      },
    });
  } catch {
    return normalizeDocumentWorkspace(null);
  }
}
export function saveDocumentWorkspace(
  change: (
    current: DocumentWorkspacePreferences,
  ) => DocumentWorkspacePreferences,
): boolean {
  try {
    localStorage.setItem(
      DOCUMENT_WORKSPACE_KEY,
      JSON.stringify(
        normalizeDocumentWorkspace(change(readDocumentWorkspace())),
      ),
    );
    window.dispatchEvent(new Event(DOCUMENT_WORKSPACE_EVENT));
    return true;
  } catch {
    return false;
  }
}
export function saveDocumentWorkspaceMode(
  origin: DocumentWorkspaceOrigin,
  mode: DocumentWorkspaceMode,
) {
  return saveDocumentWorkspace((current) => ({ ...current, [origin]: mode }));
}
export function saveCompactPanel(
  origin: DocumentWorkspaceOrigin,
  patch: Partial<DocumentWorkspacePreferences["compact"]["database"]>,
) {
  return saveDocumentWorkspace((current) => ({
    ...current,
    compact: {
      ...current.compact,
      [origin]: { ...current.compact[origin], ...patch },
    },
  }));
}
