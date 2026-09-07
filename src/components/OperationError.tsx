import { useState } from "react";
import { copyToClipboard } from "../lib/clipboard";

export function OperationError({ message, onRetry, disabled = false }: {
  message: string;
  onRetry?: () => void;
  disabled?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const copy = async () => {
    try {
      await copyToClipboard(message, { reportFailure: true });
      setCopyStatus("已复制详情");
    } catch {
      setCopyStatus("复制失败，请手动选择并复制上方详情");
    }
  };
  return <div className="ui-operation-error">
    <div className="ui-operation-error-message" role="alert">{message}</div>
    <div className="ui-operation-error-actions">
      {onRetry && <button className="settings-btn" disabled={disabled} onClick={onRetry}>重新加载</button>}
      <button className="settings-btn" onClick={() => void copy()}>复制详情</button>
      <span role="status">{copyStatus}</span>
    </div>
  </div>;
}
