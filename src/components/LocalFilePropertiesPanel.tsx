import { documentInfoRows, type DocumentInfoRecord } from "../lib/document-info";

export function LocalFilePropertiesPanel({ info, onClose }: {
  info: DocumentInfoRecord;
  onClose: () => void;
}) {
  const rows = documentInfoRows(info);
  return <aside className="properties-panel local-file-properties-panel" aria-label="文件属性">
    <div className="properties-header">
      <span className="properties-title">属性</span>
      <button type="button" className="btn-icon properties-close" onClick={onClose} title="关闭属性面板" aria-label="关闭属性面板">✕</button>
    </div>
    <div className="properties-body">
      <div className="prop-section" aria-label="文件名称">
        <div className="prop-label">名称</div>
        <div className="prop-empty local-file-property-value">{info.title || "未命名"}</div>
      </div>
      {rows.map(([label, value]) => <div className="prop-section" aria-label={`文件${label}`} key={label}>
        <div className="prop-label">{label}</div>
        <div className="prop-empty local-file-property-value">{value}</div>
      </div>)}
    </div>
  </aside>;
}
