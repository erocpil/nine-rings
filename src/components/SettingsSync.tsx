import { useState, useCallback, useEffect, useRef } from "react";
import {
  loadSyncConfig,
  saveSyncConfig,
  pushToGitHub,
  pullFromGitHub,
  checkStatus,
  type SyncConfig,
  type SyncStatus,
} from "../lib/sync/github";

interface Props {
  /** 同步进行中回调 — 父组件用来 freeze 编辑区 */
  onBusyChange?: (busy: boolean) => void;
  /** Pull 完成后回调 — 通知父组件刷新 UI（替代 window.location.reload） */
  onPullDone?: () => void;
}

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

export default function SettingsSync({ onBusyChange, onPullDone }: Props) {
  const [cfg, setCfg] = useState<SyncConfig>(loadSyncConfig);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"" | "success" | "error">("");

  // Owner/Repo 合并编辑
  const [editOwnerRepo, setEditOwnerRepo] = useState(false);
  const [ownerRepoValue, setOwnerRepoValue] = useState("");
  const [ownerRepoError, setOwnerRepoError] = useState("");

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

  const update = useCallback((patch: Partial<SyncConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveSyncConfig(next);
      return next;
    });
  }, []);

  // ── Owner/Repo 合并编辑 ──

  const startEditOwnerRepo = useCallback(() => {
    // 仅在双方都有值时显示 owner/repo，避免空字段出现孤立的 /
    if (cfg.owner && cfg.repo) {
      setOwnerRepoValue(`${cfg.owner}/${cfg.repo}`);
    } else if (cfg.owner) {
      setOwnerRepoValue(cfg.owner);
    } else if (cfg.repo) {
      setOwnerRepoValue(cfg.repo);
    } else {
      setOwnerRepoValue("");
    }
    setOwnerRepoError("");
    setEditOwnerRepo(true);
  }, [cfg.owner, cfg.repo]);

  const commitOwnerRepo = useCallback(() => {
    const trimmed = ownerRepoValue.trim();
    if (!OWNER_REPO_RE.test(trimmed)) {
      setOwnerRepoError("格式: owner/repo（owner 字母数字 -，repo 字母数字 ._-）");
      return;
    }
    const [owner, repo] = trimmed.split("/");
    update({ owner, repo });
    setEditOwnerRepo(false);
    setOwnerRepoError("");
  }, [ownerRepoValue, update]);

  const cancelEditOwnerRepo = useCallback(() => {
    setEditOwnerRepo(false);
    setOwnerRepoError("");
  }, []);

  const handleOwnerRepoKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commitOwnerRepo(); }
    if (e.key === "Escape") { e.preventDefault(); cancelEditOwnerRepo(); }
  };

  // ── 同步操作 ──

  const handleCheck = useCallback(async () => {
    setBusy(true);
    clearMessage();
    try {
      const s = await checkStatus(cfg);
      setStatus(s);
      showMessage(s.message, s.ok ? "success" : "error");
    } catch (e) {
      showMessage(`错误: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  const handlePush = useCallback(async () => {
    setBusy(true);
    clearMessage();
    try {
      const updated = await pushToGitHub(cfg);
      setCfg(updated);
      showMessage(`已推送 (${new Date().toLocaleTimeString()})`, "success");
    } catch (e) {
      showMessage(`推送失败: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  const handlePull = useCallback(async () => {
    if (!confirm("从 GitHub 拉取将覆盖本地数据，确认？")) return;
    setBusy(true);
    clearMessage();
    try {
      const updated = await pullFromGitHub(cfg);
      setCfg(updated);
      showMessage(`已拉取 (${new Date().toLocaleTimeString()})`, "success");
      onPullDone?.();
    } catch (e) {
      showMessage(`拉取失败: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  const showMessage = (msg: string, type: "success" | "error") => {
    setMessage(msg);
    setMessageType(type);
  };
  const clearMessage = () => { setMessage(""); setMessageType(""); };

  return (
    <div className="settings-section">
      <h3>GitHub 同步</h3>
      <p className="settings-hint">
        全量 JSON 快照同步。需要 GitHub Personal Access Token（repo 权限）。
      </p>

      {/* 同步中横幅 */}
      {busy && (
        <div className="sync-banner">
          <div className="sync-banner-spinner" />
          <span>同步中 — 界面已冻结，完成后自动恢复</span>
        </div>
      )}

      {/* Token */}
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

      {/* Owner / Repo — 双击编辑 */}
      {editOwnerRepo ? (
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
            autoFocus
          />
          {ownerRepoError && <span className="settings-err">{ownerRepoError}</span>}
        </label>
      ) : (
        <label className="settings-label">
          Owner / Repo
          <div
            className="settings-input settings-input-ro"
            onDoubleClick={startEditOwnerRepo}
            title="双击编辑"
          >
            {cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : <span className="settings-placeholder">双击设置 owner/repo</span>}
          </div>
        </label>
      )}

      {/* Path */}
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
        <div className={`sync-toast ${messageType}`}>
          {messageType === "success" ? "✓ " : messageType === "error" ? "✗ " : ""}
          {message}
        </div>
      )}

      {/* 按钮 */}
      <div className="settings-row" style={{ gap: 8, marginTop: 8 }}>
        <button className="settings-btn" onClick={handleCheck} disabled={busy}>
          测试连接
        </button>
        <button className="settings-btn settings-btn-primary" onClick={handlePush} disabled={busy}>
          Push ↑
        </button>
        <button className="settings-btn settings-btn-danger" onClick={handlePull} disabled={busy}>
          Pull ↓
        </button>
      </div>
    </div>
  );
}
