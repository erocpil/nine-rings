interface Props {
  online: boolean;
  updateAvailable: boolean;
  storagePressure: number | null;
  onApplyUpdate: () => void;
}

export function WebStatusBanner({ online, updateAvailable, storagePressure, onApplyUpdate }: Props) {
  if (updateAvailable) {
    return (
      <div className="web-status-banner update" role="status">
        <span>新版本已准备好。刷新前会先保存当前编辑。</span>
        <button type="button" onClick={onApplyUpdate}>保存并刷新</button>
      </div>
    );
  }
  if (!online) {
    return <div className="web-status-banner offline" role="status">当前离线，内容仍会保存在本机，联网后可继续备份。</div>;
  }
  if (storagePressure !== null && storagePressure >= 0.85) {
    return <div className="web-status-banner warning" role="alert">浏览器存储空间即将用尽，请尽快导出或备份数据。</div>;
  }
  return null;
}

