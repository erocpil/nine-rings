/** Docked outlines collapse from their title; previews keep a separate pin action. */
export function OutlinePanelTitle({
  pinned,
  onCollapse,
}: {
  pinned: boolean;
  onCollapse: () => void;
}) {
  return pinned ? (
    <button
      type="button"
      className="document-panel-title"
      aria-label="收起固定目录"
      title="收起固定目录"
      onClick={onCollapse}
    >
      目录
    </button>
  ) : (
    <span>目录</span>
  );
}
