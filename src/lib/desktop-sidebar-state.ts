export const DESKTOP_SIDEBAR_KEY = "nr:desktopSidebar";
export type DesktopSidebarPanel = "tree" | "list" | "notes" | "reader";
export const SIDEBAR_PANELS: DesktopSidebarPanel[] = ["tree", "list", "notes", "reader"];
export function sidebarPanelLabel(panel: string): string {
  return panel === "tree" ? "文档树" : panel === "list" ? "文档列表" : panel === "notes" ? "随记" : "PDF / EPUB 阅读";
}
export function normalizeSidebarOrder(saved: string[]): DesktopSidebarPanel[] {
  const order = [...new Set(saved.filter((panel): panel is DesktopSidebarPanel => SIDEBAR_PANELS.includes(panel as DesktopSidebarPanel)))];
  if (!order.includes("notes") && order.includes("list")) order.splice(order.indexOf("list") + 1, 0, "notes");
  return [...order, ...SIDEBAR_PANELS.filter(panel => !order.includes(panel))];
}
export type DesktopSidebarState = {
  panel: DesktopSidebarPanel;
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
        saved?.panel === "list" || saved?.panel === "notes" || saved?.panel === "reader"
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
