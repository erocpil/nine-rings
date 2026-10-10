import { useWorkspaceLayout } from "../hooks/useWorkspaceLayout";
import {
  saveWorkspaceLayout,
  DEFAULT_WORKSPACE_LAYOUT,
  type WorkspaceLayout,
} from "../lib/workspace-layout";

export function SettingsWorkspaceLayout({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const layout = useWorkspaceLayout();
  const save = (patch: Partial<WorkspaceLayout>) => {
    if (!saveWorkspaceLayout(patch))
      onError("布局设置保存失败，请检查本机存储权限。");
  };
  return (
    <>
      <div className="sidebar-settings-card">
        <div className="sidebar-settings-card-heading"><strong>工作区概览汇总</strong></div>
        <div className="settings-radio-group" role="group" aria-label="汇总项交互方式">
          {([["sidebar", "点击弹出分栏"], ["click", "点击显示弹层"], ["hover", "悬停显示弹层"]] as const).map(([value, label]) => (
            <button key={value} type="button" className={`settings-radio ${layout.summaryInteraction === value ? "active" : ""}`}
              aria-pressed={layout.summaryInteraction === value} onClick={() => save({ summaryInteraction: value })}>{label}</button>
          ))}
        </div>
        <p className="sidebar-presentation-description">分栏模式再次点击恢复原来的分栏状态；弹层模式直接选择文档，不改变分栏。手机无悬停时点击显示弹层。</p>
        <label className="sidebar-presentation-description">弹层最多显示的文档数
          <input className="settings-input" style={{ width: 80, marginLeft: 12 }} type="number" min={1} max={50} step={1} aria-label="弹层最多显示的文档数" value={layout.summaryVisibleRows}
            onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) save({ summaryVisibleRows: event.currentTarget.valueAsNumber }); }} />
        </label>
        <p className="sidebar-presentation-description">默认 {DEFAULT_WORKSPACE_LAYOUT.summaryVisibleRows} 个，可设为 1～50 个；超出后滚动查看，窗口较小时自动减少可见行数。</p>
      </div>
      {(
        [
          [
            "sidebarSide",
            "工作区分栏位置",
            [
              ["left", "左侧"],
              ["right", "右侧"],
            ],
            "文档树、文档列表、随记与 PDF / EPUB 阅读分栏相对于正文的位置。",
          ],
          [
            "panelsSide",
            "目录与书签位置",
            [
              ["left", "左侧"],
              ["right", "右侧"],
            ],
            "点击目录或书签按钮后，面板固定在正文的这一侧；再次点击收起。",
          ],
          [
            "panelsArrangement",
            "目录与书签排列",
            [
              ["vertical", "上下排列"],
              ["horizontal", "左右排列"],
            ],
            "上下排列时目录在上、书签在下；左右排列时目录在左、书签在右。两者之间的分隔条可拖动，比例自动记住。",
          ],
        ] as const
      ).map(([key, title, options, description]) => (
        <div className="sidebar-settings-card" key={key}>
          <div className="sidebar-settings-card-heading">
            <strong>{title}</strong>
          </div>
          <div className="settings-radio-group" role="group" aria-label={title}>
            {options.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`settings-radio ${layout[key] === value ? "active" : ""}`}
                aria-pressed={layout[key] === value}
                onClick={() => save({ [key]: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="sidebar-presentation-description">{description}</p>
          {key === "panelsArrangement" && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => save({ panelRatio: 2 / 3 })}
            >
              恢复目录与书签比例（2:1）
            </button>
          )}
        </div>
      ))}
      <p className="sidebar-presentation-description">
        以上布局适用于桌面 Web
        和桌面客户端。鼠标悬停目录或书签按钮可临时预览；固定后不再响应悬停。手机版继续使用弹出面板与抽屉。
      </p>
    </>
  );
}
