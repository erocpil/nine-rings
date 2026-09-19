export const DESKTOP_SIDEBAR_KEY = "nr:desktopSidebar";
export type DesktopSidebarState = {
  panel: "tree" | "list" | "reader";
  hidden: boolean;
  pinned: boolean;
};

export function readDesktopSidebarState(): DesktopSidebarState {
  try {
    const saved = JSON.parse(
      localStorage.getItem(DESKTOP_SIDEBAR_KEY) ?? "null",
    );
    return {
      panel:
        saved?.panel === "list" || saved?.panel === "reader"
          ? saved.panel
          : "tree",
      hidden:
        typeof saved?.hidden === "boolean"
          ? saved.hidden
          : localStorage.getItem("nr:sidebarHidden") === "true",
      pinned: saved?.pinned === true,
    };
  } catch {
    return { panel: "tree", hidden: false, pinned: false };
  }
}

/** Only deliberate desktop layout changes belong here, never hover previews. */
export function saveDesktopSidebarState(patch: Partial<DesktopSidebarState>) {
  try {
    localStorage.setItem(
      DESKTOP_SIDEBAR_KEY,
      JSON.stringify({ ...readDesktopSidebarState(), ...patch }),
    );
  } catch {
    /* Keep the current layout usable when storage is unavailable. */
  }
}
