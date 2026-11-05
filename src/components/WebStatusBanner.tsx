interface Props {
  online: boolean;
  storagePressure: number | null;
  onExportBackup: () => void;
}

export function WebStatusBanner({ online, storagePressure, onExportBackup }: Props) {
  if (!online) {
    return <div className="web-status-banner offline" role="status">当前离线，内容仍会保存在本机，联网后可继续备份。</div>;
  }
  if (storagePressure !== null && storagePressure >= 0.85) {
    return (
      <div className="web-status-banner warning" role="alert">
        <span>浏览器存储空间即将用尽，请尽快导出或备份数据。</span>
        <button type="button" onClick={onExportBackup}>立即导出</button>
      </div>
    );
  }
  return null;
}
