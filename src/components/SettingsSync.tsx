import { useState, useCallback, useEffect, useRef } from "react";
import {
  loadSyncConfig,
  saveSyncConfig,
  pushToGitHub,
  pullFromGitHub,
  previewPullFromGitHub,
  checkStatus,
  type SyncConfig,
  type SyncStatus,
  type PullPrecheck,
} from "../lib/sync/github";
import { useTransientMessage } from "../hooks/useTransientMessage";

interface Props {
  /** 备份进行中回调 — 父组件用来 freeze 编辑区 */
  onBusyChange?: (busy: boolean) => void;
  /** Pull 完成后回调 — 通知父组件重新载入并应用恢复后的完整工作区 */
  onPullDone?: () => void;
}

type BusyOperation = "check" | "push" | "pull-preview" | "pull";

const BUSY_MESSAGES: Record<BusyOperation, string> = {
  check: "正在检查 GitHub 连接，操作期间暂不可编辑",
  push: "正在向 GitHub 推送备份，操作期间暂不可编辑",
  "pull-preview": "正在读取远端备份；预检完成后需要手动确认，才会覆盖并导入",
  pull: "正在从 GitHub 导入备份，操作期间暂不可编辑",
};

/** owner/repo 合并格式校验 */
const OWNER_REPO_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\/[a-zA-Z0-9._-]+$/;

/** 格式化 UTC 时间戳 "20260715T143911" → 本地时间 "2026-07-15 22:39:11" */
function fmtVersion(version: string | null): string {
  if (!version) return "";
  if (version.length !== 15) return version;
  const y = version.slice(0, 4);
  const M = version.slice(4, 6);
  const d = version.slice(6, 8);
  const h = version.slice(9, 11);
  const m = version.slice(11, 13);
  const s = version.slice(13, 15);
  // 版本时间戳为 UTC，转为本地时区显示
  const utcMs = Date.UTC(+y, +M - 1, +d, +h, +m, +s);
  const local = new Date(utcMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`;
}

function fmtBytes(size: number | null): string {
  if (size == null || !Number.isFinite(size)) return "N/A";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function fmtCountDelta(remote: number, local: number): string {
  const delta = remote - local;
  if (delta === 0) return "数量相同";
  return delta > 0 ? `远端多 ${delta}` : `远端少 ${Math.abs(delta)}`;
}

export default function SettingsSync({ onBusyChange, onPullDone }: Props) {
  const [cfg, setCfg] = useState<SyncConfig>(loadSyncConfig);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busyOperation, setBusyOperation] = useState<BusyOperation | null>(null);
  const { message, showMessage: showTransientMessage, clearMessage: clearTransientMessage } = useTransientMessage();
  const [messageType, setMessageType] = useState<"" | "success" | "error">("");
  const [pullPrecheck, setPullPrecheck] = useState<PullPrecheck | null>(null);

  const [ownerRepoValue, setOwnerRepoValue] = useState(() => {
    const initial = loadSyncConfig();
    return initial.owner && initial.repo ? `${initial.owner}/${initial.repo}` : initial.owner || initial.repo;
  });
  const [ownerRepoError, setOwnerRepoError] = useState("");
  const busy = busyOperation !== null;

  const showMessage = useCallback((msg: string, type: "success" | "error") => {
    setMessageType(type);
    showTransientMessage(msg, type === "error" ? 8000 : undefined);
  }, [showTransientMessage]);
  const clearMessage = useCallback(() => {
    clearTransientMessage();
    setMessageType("");
  }, [clearTransientMessage]);

  // 防止 Strict Mode 重复触发
  const checkRef = useRef("");

  // 自动检测连接状态
  useEffect(() => {
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      setStatus(null);
      return;
    }
    const key = `${cfg.owner}/${cfg.repo}/${cfg.path}`;
    if (key === checkRef.current) return;
    checkRef.current = key;
    checkStatus(cfg).then(setStatus);
  }, [cfg.token, cfg.owner, cfg.repo, cfg.path]);

  // busy 变化时通知父组件
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // 设置面板可能在 Push/Pull 完成前关闭。此时组件卸载，
  // finally 中的本地 setBusy(false) 无法再把父级编辑器解冻。
  useEffect(() => {
    return () => onBusyChange?.(false);
  }, [onBusyChange]);

  const update = useCallback((patch: Partial<SyncConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveSyncConfig(next);
      return next;
    });
  }, []);

  const handleRememberTokenChange = useCallback((rememberToken: boolean) => {
    if (rememberToken) {
      const accepted = window.confirm(
        "持久保存会把 GitHub Token 写入此浏览器的本地存储。任何能访问本机浏览器数据或在本站执行的脚本都可能读取它。确认仍要保存？",
      );
      if (!accepted) return;
    }
    update({ rememberToken });
  }, [update]);

  // ── Owner/Repo 合并编辑 ──

  useEffect(() => {
    setOwnerRepoValue(cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : cfg.owner || cfg.repo);
  }, [cfg.owner, cfg.repo]);

  const commitOwnerRepo = useCallback(() => {
    const trimmed = ownerRepoValue.trim();
    if (!trimmed) {
      update({ owner: "", repo: "" });
      setOwnerRepoError("");
      return;
    }
    if (!OWNER_REPO_RE.test(trimmed)) {
      setOwnerRepoError("格式: owner/repo（owner 字母数字 -，repo 字母数字 ._-）");
      return;
    }
    const [owner, repo] = trimmed.split("/");
    update({ owner, repo });
    setOwnerRepoError("");
  }, [ownerRepoValue, update]);

  const resetOwnerRepo = useCallback(() => {
    setOwnerRepoValue(cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : cfg.owner || cfg.repo);
    setOwnerRepoError("");
  }, [cfg.owner, cfg.repo]);

  const handleOwnerRepoKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commitOwnerRepo(); }
    if (e.key === "Escape") { e.preventDefault(); resetOwnerRepo(); }
  };

  // ── GitHub 备份操作 ──

  const handleCheck = useCallback(async () => {
    setBusyOperation("check");
    clearMessage();
    try {
      const s = await checkStatus(cfg);
      setStatus(s);
      showMessage(s.message, s.ok ? "success" : "error");
    } catch (e) {
      showMessage(`错误: ${(e as Error).message}`, "error");
    } finally {
      setBusyOperation(null);
    }
  }, [cfg, clearMessage, showMessage]);

  const handlePush = useCallback(async () => {
    setBusyOperation("push");
    clearMessage();
    try {
      const updated = await pushToGitHub(cfg);
      setCfg(updated);
      showMessage(`已推送 (${new Date().toLocaleTimeString()})`, "success");
    } catch (e) {
      showMessage(`推送失败: ${(e as Error).message}`, "error");
    } finally {
      setBusyOperation(null);
    }
  }, [cfg, clearMessage, showMessage]);

  const handlePullPreview = useCallback(async () => {
    setBusyOperation("pull-preview");
    clearMessage();
    setPullPrecheck(null);
    try {
      const pre = await previewPullFromGitHub(cfg);
      setPullPrecheck(pre);
      showMessage(`预检完成：远端版本 ${pre.remote.version.slice(0, 15)}`, "success");
    } catch (e) {
      showMessage(`预检失败: ${(e as Error).message}`, "error");
    } finally {
      setBusyOperation(null);
    }
  }, [cfg, clearMessage, showMessage]);

  const handlePull = useCallback(async () => {
    if (!pullPrecheck) return;
    if (!confirm("将从 GitHub 读取远端快照并直接覆盖本地数据库，建议先确认差异。确认继续？")) {
      setPullPrecheck(null);
      return;
    }
    setBusyOperation("pull");
    clearMessage();
    try {
      const updated = await pullFromGitHub(cfg);
      setCfg(updated);
      showMessage(`已拉取并导入 (${new Date().toLocaleTimeString()})`, "success");
      onPullDone?.();
      setPullPrecheck(null);
    } catch (e) {
      showMessage(`拉取失败: ${(e as Error).message}`, "error");
    } finally {
      setBusyOperation(null);
    }
  }, [cfg, clearMessage, onPullDone, pullPrecheck, showMessage]);

  useEffect(() => {
    setPullPrecheck(null);
  }, [cfg.token, cfg.owner, cfg.repo, cfg.path]);

  return (
    <div className="settings-section sync-settings-section">
      <h3>GitHub 备份</h3>

      {/* 高频操作置顶，打开页面后无需越过低频配置即可执行。 */}
      <div className="settings-row sync-actions">
        <button className="settings-btn" onClick={handleCheck} disabled={busy}>
          测试连接
        </button>
        <button className="settings-btn settings-btn-primary" onClick={handlePush} disabled={busy}>
          Push ↑
        </button>
        <button className="settings-btn settings-btn-danger" onClick={handlePullPreview} disabled={busy || !!pullPrecheck}>
          Pull ↓
        </button>
      </div>

      {/* 备份中横幅 */}
      {busy && (
        <div className="sync-banner">
          <div className="sync-banner-spinner" />
          <span>{BUSY_MESSAGES[busyOperation]}</span>
        </div>
      )}

      {/* 状态 */}
      {status && (
        <div className={`sync-status ${status.ok ? "sync-ok" : "sync-err"}`}>
          {status.ok ? "✅" : "❌"} {status.message}
        </div>
      )}

      {/* 版本信息 */}
      {(cfg.lastPushVersion || cfg.lastPullVersion) && (
        <div className="sync-versions">
          {cfg.lastPushVersion && (
            <span>上次 Push: {fmtVersion(cfg.lastPushVersion)}</span>
          )}
          {cfg.lastPushVersion && cfg.lastPullVersion && <span className="sync-versions-sep" />}
          {cfg.lastPullVersion && (
            <span>上次 Pull: {fmtVersion(cfg.lastPullVersion)}</span>
          )}
        </div>
      )}

      {message && (
        <div className={`sync-toast ${messageType}`} role="status" aria-live="polite">
          {messageType === "success" ? "✓ " : messageType === "error" ? "✗ " : ""}
          {message}
        </div>
      )}

      {pullPrecheck && (
        <div className="sync-preview">
          <p style={{ margin: "6px 0", fontWeight: 600 }}>Pull 预检（将覆盖本地数据）</p>
          <div className="sync-versions" style={{ marginBottom: 8 }}>
            <span>
              本地: {fmtVersion(pullPrecheck.local.version || "") || "-"}
              <span className="sync-versions-sep"> · </span>
              {pullPrecheck.local.noteCount} 笔记 · {pullPrecheck.local.pageCount} 页面 ·
              {" "}
              {fmtBytes(pullPrecheck.local.size)}
            </span>
            <span>
              远端: {fmtVersion(pullPrecheck.remote.version)}
              <span className="sync-versions-sep"> · </span>
              {pullPrecheck.remote.noteCount} 笔记 · {pullPrecheck.remote.pageCount} 页面 ·
              {" "}
              {fmtBytes(pullPrecheck.remote.size)}
            </span>
          </div>
          <div className="settings-hint" style={{ marginBottom: 8 }}>
            差异摘要：笔记{fmtCountDelta(pullPrecheck.remote.noteCount, pullPrecheck.local.noteCount)}；
            页面{fmtCountDelta(pullPrecheck.remote.pageCount, pullPrecheck.local.pageCount)}。
            导入失败时会自动恢复拉取前的本地数据。
          </div>
          <div className="settings-row" style={{ gap: 8 }}>
            <button className="settings-btn settings-btn-danger" onClick={handlePull} disabled={busy}>
              确认覆盖并导入
            </button>
            <button className="settings-btn" onClick={() => setPullPrecheck(null)} disabled={busy}>
              取消
            </button>
          </div>
          <div className="settings-hint">远端文件: {pullPrecheck.remote.path}</div>
        </div>
      )}

      <p className="settings-hint">
        Pull 会先读取并预检远端备份，不会自动导入；需要手动点击“确认覆盖并导入”后才会恢复数据。
      </p>

      <div className="sync-config-section">
        <h4>连接设置</h4>
        <p className="settings-hint">
          全量 JSON 快照包含书签、应用配置及非敏感用户设置；Token 不进入备份。需要 GitHub Personal Access Token（repo 权限）。
        </p>

        <label className="settings-label">
          Owner / Repo
          <input
            type="text"
            className={`settings-input ${ownerRepoError ? "settings-input-err" : ""}`}
            placeholder="erocpil/nine-rings-backup"
            value={ownerRepoValue}
            onChange={(e) => { setOwnerRepoValue(e.target.value); setOwnerRepoError(""); }}
            onKeyDown={handleOwnerRepoKeyDown}
            onBlur={commitOwnerRepo}
          />
          {ownerRepoError && <span className="settings-err">{ownerRepoError}</span>}
        </label>

        <label className="settings-label">
          备份文件路径
          <input
            type="text"
            className="settings-input"
            placeholder="nine-rings-backup.json"
            value={cfg.path}
            onChange={(e) => update({ path: e.target.value })}
          />
        </label>

        <label className="settings-label">
          Token
          <input
            type="password"
            className="settings-input"
            placeholder="ghp_..."
            value={cfg.token}
            onChange={(e) => update({ token: e.target.value })}
          />
        </label>

        <label className="settings-label settings-inline">
          Token 保存策略
          <label className="settings-row settings-row-inline">
            <input
              type="checkbox"
              checked={cfg.rememberToken}
              onChange={(e) => handleRememberTokenChange(e.target.checked)}
            />
            <span>记住 Token（退出浏览器后保留）</span>
          </label>
          <span className={`settings-hint ${cfg.rememberToken ? "settings-token-warning" : ""}`}>
            {cfg.rememberToken
              ? "Token 已持久保存在此浏览器；请仅在可信的个人设备上启用。"
              : "默认仅保留到当前浏览器会话，关闭浏览器后清除。"}
          </span>
        </label>
      </div>
    </div>
  );
}
