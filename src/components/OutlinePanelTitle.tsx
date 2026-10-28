/** Fixed panels collapse from their title; floating previews retain a pin action. */
export function DocumentPanelTitle({
  pinned, onCollapse, label, collapseLabel,
}: {
  pinned: boolean;
  onCollapse: () => void;
  label: string;
  collapseLabel?: string;
}) {
  return pinned ? (
    <button type="button" className="document-panel-title"
      aria-label={collapseLabel ?? `收起固定${label}`} title={collapseLabel ?? `收起固定${label}`} onClick={onCollapse}>
      {label}
    </button>
  ) : <span>{label}</span>;
}
export function OutlinePanelTitle(props: { pinned: boolean; onCollapse: () => void; collapseLabel?: string }) {
  return <DocumentPanelTitle {...props} label="目录" />;
}
