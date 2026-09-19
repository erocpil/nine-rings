import { useCallback, useEffect, useState } from "react";
import { pwaUpdateStatusText, type PwaUpdateStatus } from "../lib/pwa-updates";
import { ToolbarIcon } from "./ToolbarIcon";
export type SettingsWebUpdate = PwaUpdateStatus & {
  onCheck: () => Promise<void>;
  onApply: () => void;
};
interface Props {
  webUpdate: SettingsWebUpdate;
  showMessage: (message: string) => void;
}
export function SettingsUpdateStatus({ webUpdate, showMessage }: Props) {
  const [showUpdateFailureDetails, setShowUpdateFailureDetails] =
    useState(false);
  const getUpdateStatusText = (status: SettingsWebUpdate) => {
    return pwaUpdateStatusText(status);
  };

  const getUpdateStatusClass = (status: SettingsWebUpdate) => {
    if (status.error) return "is-error";
    if (status.available) return "is-ready";
    if (status.checking || status.phase === "installing") return "is-checking";
    if (status.checked) return "is-neutral";
    return "is-idle";
  };

  useEffect(() => {
    if (!webUpdate?.error) setShowUpdateFailureDetails(false);
    else if (webUpdate?.error && !webUpdate.errorDetails)
      setShowUpdateFailureDetails(false);
  }, [webUpdate?.error, webUpdate?.errorDetails]);

  const handleCopyUpdateFailureDetails = useCallback(async () => {
    if (!webUpdate?.errorDetails) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(webUpdate.errorDetails);
      } else {
        const target = document.createElement("textarea");
        target.value = webUpdate.errorDetails;
        target.style.position = "fixed";
        target.style.opacity = "0";
        target.style.left = "-9999px";
        document.body.appendChild(target);
        target.focus();
        target.select();
        try {
          if (!document.execCommand("copy"))
            throw new Error("浏览器未允许复制，请手动选择详情复制");
        } finally {
          target.remove();
        }
      }
      showMessage("更新失败详情已复制到剪贴板");
    } catch (error) {
      showMessage(
        `复制失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [showMessage, webUpdate?.errorDetails]);

  return (
    <>
      {webUpdate && (
        <div className="settings-web-update">
          <button
            type="button"
            className={`settings-update-check${webUpdate.checking ? " is-loading" : ""}`}
            disabled={webUpdate.checking}
            onClick={() =>
              void webUpdate
                .onCheck()
                .catch((error) => showMessage(String(error)))
            }
          >
            {webUpdate.checking ? (
              <span className="settings-update-spinner" aria-hidden="true" />
            ) : (
              <span className="settings-update-icon" aria-hidden="true">
                ↻
              </span>
            )}
            {webUpdate.checking ? "检查中…" : "检查更新"}
          </button>
          {webUpdate.available && (
            <button
              type="button"
              className="settings-update-apply"
              onClick={webUpdate.onApply}
            >
              <ToolbarIcon name="check" />
              保存并刷新
            </button>
          )}
          <span
            role="status"
            className={`settings-update-status ${getUpdateStatusClass(webUpdate)}`}
          >
            <span className="settings-update-status-dot" aria-hidden="true" />
            {getUpdateStatusText(webUpdate)}
          </span>
          {webUpdate.error && webUpdate.errorDetails && (
            <button
              type="button"
              className="settings-update-error-details"
              onClick={() => setShowUpdateFailureDetails((value) => !value)}
            >
              {showUpdateFailureDetails ? "收起详情" : "查看详情"}
            </button>
          )}
          {showUpdateFailureDetails &&
            webUpdate.error &&
            webUpdate.errorDetails && (
              <>
                <pre className="settings-update-error-panel" role="status">
                  {webUpdate.errorDetails}
                </pre>
                <button
                  type="button"
                  className="settings-update-error-copy"
                  onClick={() => void handleCopyUpdateFailureDetails()}
                >
                  一键复制详情
                </button>
              </>
            )}
        </div>
      )}
    </>
  );
}
