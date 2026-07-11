/**
 * MobileToolbar — 移动端底部固定工具栏
 *
 * 仅在 ≤768px 屏幕显示（CSS 控制），提供：
 *   - 新建随笔
 *   - 切换每日/文档视图
 *   - 搜索聚焦
 *   - 设置
 */

interface MobileToolbarProps {
  onCreateNote: () => void;
  onToggleSidebar: () => void;
  onFocusSearch: () => void;
  onOpenSettings: () => void;
  sidebarTab: 'daily' | 'tree';
  onToggleTab: () => void;
}

export default function MobileToolbar({
  onCreateNote,
  onToggleSidebar,
  onFocusSearch,
  onOpenSettings,
  sidebarTab,
  onToggleTab,
}: MobileToolbarProps) {
  return (
    <div className="m-toolbar">
      <button className="m-toolbar-btn" onClick={onToggleSidebar} title="侧栏">
        <span className="m-toolbar-icon">☰</span>
        <span>侧栏</span>
      </button>
      <button className="m-toolbar-btn" onClick={onCreateNote} title="新建">
        <span className="m-toolbar-icon">✏️</span>
        <span>新建</span>
      </button>
      <button className="m-toolbar-btn" onClick={onToggleTab} title={sidebarTab === 'daily' ? '文档' : '每日'}>
        <span className="m-toolbar-icon">{sidebarTab === 'daily' ? '📂' : '📅'}</span>
        <span>{sidebarTab === 'daily' ? '文档' : '每日'}</span>
      </button>
      <button className="m-toolbar-btn" onClick={onFocusSearch} title="搜索">
        <span className="m-toolbar-icon">🔍</span>
        <span>搜索</span>
      </button>
      <button className="m-toolbar-btn" onClick={onOpenSettings} title="设置">
        <span className="m-toolbar-icon">⚙</span>
        <span>设置</span>
      </button>
    </div>
  );
}
