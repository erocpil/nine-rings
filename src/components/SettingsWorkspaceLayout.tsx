import { useDocumentWorkspace } from "../hooks/useDocumentWorkspace";
import { saveDocumentWorkspaceMode } from "../lib/document-workspace-layout";
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
  const documentWorkspace = useDocumentWorkspace();
  const save = (patch: Partial<WorkspaceLayout>) => {
    if (!saveWorkspaceLayout(patch))
      onError("布局设置保存失败，请检查本机存储权限。");
  };
  return (
    <>
      <div className="sidebar-settings-card">
        <div className="sidebar-settings-card-heading"><strong>文档工作区布局</strong></div>
        {([["database", "Nine Rings 文档布局"], ["local", "本地文件布局"]] as const).map(([origin, label]) => <div key={origin}>
          <p className="sidebar-presentation-description">{label}</p>
          <div className="settings-radio-group" role="group" aria-label={label}>
            {([["document", "文档布局"], ["compact", "紧凑布局"]] as const).map(([mode, name]) => <button key={mode} type="button" className={`settings-radio ${documentWorkspace[origin] === mode ? "active" : ""}`} aria-pressed={documentWorkspace[origin] === mode}
              onClick={() => { if (!saveDocumentWorkspaceMode(origin, mode)) onError("工作区布局保存失败，请重试。"); }}>{name}</button>)}
          </div>
        </div>)}
        <p className="sidebar-presentation-description">文档布局支持悬停预览和多个固定面板；紧凑布局在标题栏下方右侧展示单个导航面板。两类文件均可选择，切换布局保留各自的宽度与展开状态，不改变文件内容及编辑权限。手机保留原有导航方式。</p>
      </div>
      <div className="sidebar-settings-card">
        <div className="sidebar-settings-card-heading"><strong>外围信息显示</strong></div>
        <label className="settings-checkbox-label">
          <input type="checkbox" aria-label="悬停显示外围信息" checked={layout.fullscreenQuietChrome} onChange={event=>save({fullscreenQuietChrome:event.currentTarget.checked})}/>
          悬停显示外围信息
        </label>
        {layout.fullscreenQuietChrome && <div className="settings-radio-group" role="group" aria-label="外围信息悬停显示范围">
          {([['always', '始终开启'], ['fullscreen', '仅全屏开启'], ['windowed', '仅非全屏开启']] as const).map(([value, label]) => <label key={value} className="settings-checkbox-label">
            <input type="radio" name="quiet-chrome-scope" value={value} checked={layout.quietChromeScope === value} onChange={() => save({quietChromeScope:value})}/>{label}
          </label>)}
        </div>}
        <p className="sidebar-presentation-description">桌面展陈中，上方工作区指示与下方概览淡出，移到对应区域或用键盘聚焦后显示；保留原有空间，正文和分栏不受影响。默认关闭，开启后默认仅全屏生效。</p>
      </div>
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
        <p className="sidebar-presentation-description">默认每组可见 {DEFAULT_WORKSPACE_LAYOUT.summaryVisibleRows} 个，可设为 1～50 个；“最近打开”分别保留最新 16 份 Nine Rings 文档和本地文件，超出可见行数后在组内滚动查看。</p>
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
