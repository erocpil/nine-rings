export const WORKSPACE_LAYOUT_KEY = "nr:workspaceLayout";
export const WORKSPACE_LAYOUT_EVENT = "nr:workspace-layout-change";
export interface WorkspaceLayout {
  sidebarSide: "left" | "right";
  panelsSide: "left" | "right";
  panelsArrangement: "vertical" | "horizontal";
  panelRatio: number;
  panelWidth: number;
  horizontalPanelWidth: number;
  outlinePinned: boolean;
  bookmarkPinned: boolean;
}
export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  sidebarSide: "left",
  panelsSide: "right",
  panelsArrangement: "vertical",
  panelRatio: 2 / 3,
  panelWidth: 280,
  horizontalPanelWidth: 520,
  outlinePinned: false,
  bookmarkPinned: false,
};
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayout {
  const v =
    value && typeof value === "object"
      ? (value as Partial<WorkspaceLayout>)
      : {};
  return {
    sidebarSide: v.sidebarSide === "right" ? "right" : "left",
    panelsSide: v.panelsSide === "left" ? "left" : "right",
    panelsArrangement:
      v.panelsArrangement === "horizontal" ? "horizontal" : "vertical",
    panelRatio: number(v.panelRatio, 2 / 3, 0.15, 0.85),
    panelWidth: number(v.panelWidth, 280, 180, 600),
    horizontalPanelWidth: number(v.horizontalPanelWidth, 520, 280, 900),
    outlinePinned: v.outlinePinned === true,
    bookmarkPinned: v.bookmarkPinned === true,
  };
}
export function readWorkspaceLayout(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(WORKSPACE_LAYOUT_KEY);
    if (raw) return normalizeWorkspaceLayout(JSON.parse(raw));
    const oldDock = localStorage.getItem("nr:documentOutlineDock");
    return normalizeWorkspaceLayout({
      outlinePinned: oldDock === "left" || oldDock === "right",
      panelsSide: oldDock === "left" ? "left" : "right",
      panelWidth:
        Number(localStorage.getItem("nr:documentOutlineWidth")) || 280,
    });
  } catch {
    return { ...DEFAULT_WORKSPACE_LAYOUT };
  }
}
export function saveWorkspaceLayout(patch: Partial<WorkspaceLayout>): boolean {
  try {
    localStorage.setItem(
      WORKSPACE_LAYOUT_KEY,
      JSON.stringify(
        normalizeWorkspaceLayout({ ...readWorkspaceLayout(), ...patch }),
      ),
    );
    window.dispatchEvent(new Event(WORKSPACE_LAYOUT_EVENT));
    return true;
  } catch {
    return false;
  }
}
