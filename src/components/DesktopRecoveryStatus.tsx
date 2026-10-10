import { useEffect, useState } from "react";
import { getDesktopRecoveryStatus, sessionPhaseLabel, type DesktopRecoveryStatus as Status } from "../lib/desktop-recovery";
import { copyToClipboard } from "../lib/clipboard";
import { SettingsSection } from "./SettingsFields";

export function DesktopRecoveryStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void getDesktopRecoveryStatus().then(value => { if (active) { setStatus(value); setError(""); } })
      .catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [refresh]);
  const previous = status?.previous;
  return <SettingsSection title="启动与退出诊断" desc="仅保存在本机，不包含文档内容">
    {error && <p role="alert">无法读取诊断：{error}</p>}
    {!status && !error && <p role="status">读取中…</p>}
    {status && <div className="desktop-recovery-status">
      <dl>
        <dt>当前状态</dt><dd>{sessionPhaseLabel(status.current.phase)} · PID {status.current.pid}</dd>
        <dt>本次启动</dt><dd>{new Date(status.current.startedAt).toLocaleString()} · {status.current.version}</dd>
        <dt>前一次退出</dt><dd>{previous ? `${sessionPhaseLabel(previous.phase)} · PID ${previous.pid} · ${new Date(previous.updatedAt).toLocaleString()}` : status.recovery.abnormal ? "会话记录不可用" : "首次记录"}</dd>
        {previous?.issue && <><dt>前次异常</dt><dd>{previous.issue}</dd></>}
        <dt>检查与修复</dt><dd>{status.recovery.message || "尚未完成检查"}</dd>
        {status.recovery.checkpoint && <><dt>数据库合并</dt><dd>{status.recovery.checkpoint}</dd></>}
        {status.current.jobObjectEnabled !== null && <><dt>Windows 子进程保护</dt><dd>{status.current.jobObjectEnabled ? "已启用" : "未启用，请结合系统进程检查"}</dd></>}
        <dt>日志文件</dt><dd>{status.logPath}</dd>
        {status.markerError && <><dt>记录警告</dt><dd>{status.markerError}</dd></>}
      </dl>
      <p className="settings-hint">正常退出事件不等于系统已释放全部子进程或文件锁。恢复仅针对已提交数据，尚未保存的内存编辑无法保证恢复。</p>
    </div>}
    <div className="desktop-recovery-actions">
      <button className="settings-btn-secondary" type="button" onClick={() => setRefresh(value => value + 1)}>刷新状态</button>
      <button className="settings-btn-secondary" type="button" disabled={!status} onClick={() => {
        if (status) void copyToClipboard(JSON.stringify(status, null, 2), { reportFailure: true }).then(() => setCopied(true)).catch(error => setError(`复制失败：${String(error)}`));
      }}>{copied ? "已复制诊断" : "复制诊断"}</button>
    </div>
  </SettingsSection>;
}

export function DesktopRecoveryNotice() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void getDesktopRecoveryStatus().then(status => {
      if (!active || !status) return;
      if (status.markerError) setMessage(`${status.markerError}。详情见设置 → 高级。`);
      else if (!status.recovery.healthy) setMessage("数据库检查异常，已停止写入并保留原文件。详情见设置 → 高级。");
      else if (status.recovery.abnormal) setMessage("检测到上次退出未完成，已检查并恢复可用的已保存数据。详情见设置 → 高级。");
    }).catch(() => { if (active) setMessage("无法读取启动诊断，详情见设置 → 高级。"); });
    return () => { active = false; };
  }, []);
  return message ? <div className="desktop-recovery-notice" role="status"><span>{message}</span><button type="button" aria-label="关闭启动诊断提示" onClick={() => setMessage("")}>×</button></div> : null;
}
