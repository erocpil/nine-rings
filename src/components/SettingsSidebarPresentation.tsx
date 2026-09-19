import {
  saveSidebarPresentation,
  useSidebarPresentation,
} from "../hooks/useSidebarPresentation";

export function SettingsSidebarPresentation({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const mode = useSidebarPresentation();
  return (
    <div className="sidebar-settings-card">
      <div className="sidebar-settings-card-heading">
        <strong>分栏打开方式</strong>
      </div>
      <div
        className="settings-radio-group"
        role="group"
        aria-label="分栏打开方式"
      >
        {(
          [
            ["split", "并排模式"],
            ["overlay", "浮层模式"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`settings-radio ${mode === value ? "active" : ""}`}
            aria-pressed={mode === value}
            onClick={() => {
              if (!saveSidebarPresentation(value))
                onError("分栏打开方式保存失败，请检查浏览器存储权限。");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="sidebar-presentation-description">
        {mode === "split"
          ? "分栏与正文并排显示，占用窗口空间，适合同时查看。"
          : "悬停分栏按钮时浮出预览，移出且无输入或菜单操作时自动收起；点击固定为并排显示，再次点击收起。Tab 聚焦按钮后可用右/下方向键进入，Esc 收起并返回按钮。"}
      </p>
      <p className="sidebar-presentation-description">
        适用于桌面布局的文档树、文档列表与阅读分栏。手机版仍使用抽屉，可在桌面查看此设置的效果。
      </p>
    </div>
  );
}
