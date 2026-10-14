import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  BackupMeasurement,
  BackupByteKind,
} from "../lib/backup-measurement";
import {
  transferMeasurements,
  subscribeTransfers,
} from "../lib/sync/measurement-store";
import { copyToClipboard } from "../lib/clipboard";
import { WorkspaceDialog } from "./WorkspaceDialog";
const labels: Record<BackupByteKind, string> = {
  body: "文档正文（不含图片值）",
  images: "内嵌图片值",
  metadata: "文档与保护元数据",
  search: "派生搜索文本",
  templates: "模板（不含图片值）",
  protectedHistory: "保护历史",
  settings: "配置与可备份设置",
  other: "封装、导出信息与其他",
};
const size = (bytes: number) =>
  `${bytes.toLocaleString()} B · ${(bytes / 1048576).toFixed(2)} MiB`;
export function BackupMeasurementDialog({
  onClose,
  onMeasure,
  busy,
}: {
  onClose: () => void;
  onMeasure: () => Promise<BackupMeasurement>;
  busy: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (
        dialogs[dialogs.length - 1] !==
        content.current?.closest('[role="dialog"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const [report, setReport] = useState<BackupMeasurement | null>(null);
  const [message, setMessage] = useState("");
  const transfers = useSyncExternalStore(
    subscribeTransfers,
    transferMeasurements,
  );
  const run = async () => {
    setMessage("");
    try {
      setReport(await onMeasure());
    } catch {
      setMessage("分析失败，请检查本地备份是否可正常导出；未执行上传。");
    }
  };
  return (
    <WorkspaceDialog title="备份测量" onClose={onClose}>
      <div className="backup-measurement" ref={content}>
        <p>
          保存待处理编辑后，分析完整导出的实际 JSON
          字节；不上传，不改变备份格式。报告仅含聚合数据。
        </p>
        <div className="settings-row">
          <button
            type="button"
            className="settings-btn"
            onClick={() => void run()}
            disabled={busy}
          >
            {busy ? "正在分析…" : "分析本地快照"}
          </button>
          <button
            type="button"
            className="settings-btn"
            disabled={!report && !transfers.length}
            onClick={() => {
              void copyToClipboard(
                JSON.stringify(
                  {
                    analysis: report,
                    transfers,
                    proxy: "unknown",
                    peakMemory: "not-measured",
                  },
                  null,
                  2,
                ),
                { reportFailure: false },
              ).then(
                () => setMessage("已复制聚合报告"),
                () => setMessage("复制失败，请重试"),
              );
            }}
          >
            复制测量报告
          </button>
        </div>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {report && (
          <>
            <p>
              完整导出：<strong>{size(report.totalBytes)}</strong> ·{" "}
              {report.counts.documents} 篇文档 · {report.counts.inlineImages}{" "}
              个结构化内嵌图片值
            </p>
            <table aria-label="备份字节构成">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>实际字节</th>
                  <th>占比</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.bytes).map(([kind, bytes]) => (
                  <tr key={kind}>
                    <td>{labels[kind as BackupByteKind]}</td>
                    <td>{bytes.toLocaleString()} B</td>
                    <td>{((bytes / report.totalBytes) * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              逐字节对账：
              {Object.values(report.bytes).reduce((a, b) => a + b, 0) ===
              report.totalBytes
                ? "完整"
                : "不完整"}{" "}
              · 分析耗时 {report.analysisMs.toFixed(1)} ms
            </p>
            {report.timings && (
              <p>
                保存 {report.timings.saveMs.toFixed(1)} ms · 完整导出{" "}
                {report.timings.exportMs.toFixed(1)} ms · 分析往返{" "}
                {report.timings.analysisWallMs.toFixed(1)} ms · 总计{" "}
                {report.timings.totalMs.toFixed(1)} ms
              </p>
            )}
            {report.counts.opaqueContentStrings > 0 && (
              <p>
                有 {report.counts.opaqueContentStrings} 份正文以 JSON
                字符串保存，计入正文；其中的内嵌图片未单独展开统计。
              </p>
            )}
          </>
        )}
        <p>
          峰值内存：未测量。代理/VPN：无法可靠自动检测，需在对照报告中手动注明。分析耗时不含导出和
          Worker 排队/通信时间。
        </p>
        <h4>当前会话的最近请求</h4>
        {transfers.length ? (
          <table aria-label="备份传输测量">
            <thead>
              <tr>
                <th>类型/通道</th>
                <th>请求字节</th>
                <th>完整响应耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((entry, index) => (
                <tr key={index}>
                  <td>
                    {entry.kind} / {entry.transport}
                  </td>
                  <td>{entry.requestBytes.toLocaleString()} B</td>
                  <td>{entry.durationMs.toFixed(0)} ms</td>
                  <td>{entry.status ?? "网络失败或取消"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>
            暂无请求记录。正常执行 Push
            后会记录实际请求字节与完整响应耗时，不记录地址、正文或凭据。
          </p>
        )}
      </div>
    </WorkspaceDialog>
  );
}
