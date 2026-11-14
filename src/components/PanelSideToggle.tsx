import { useWorkspaceLayout } from "../hooks/useWorkspaceLayout";
import { saveWorkspaceLayout } from "../lib/workspace-layout";
import { ToolbarIcon } from "./ToolbarIcon";

export function PanelSideToggle() {
  const layout = useWorkspaceLayout();
  const left = layout.panelsSide === "left";
  return <button type="button" className="btn-icon focus-btn" title={left ? "固定面板移到右侧" : "固定面板移到左侧"} aria-label="切换固定面板位置" aria-pressed={left} onClick={() => { saveWorkspaceLayout({ panelsSide: left ? "right" : "left" }); }}><ToolbarIcon name={left ? "chevronRight" : "chevronLeft"} /></button>;
}
