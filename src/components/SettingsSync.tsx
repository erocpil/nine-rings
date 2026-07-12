import { useState, useCallback, useEffect } from "react";
import {
  loadSyncConfig,
  saveSyncConfig,
  pushToGitHub,
  pullFromGitHub,
  checkStatus,
  type SyncConfig,
  type SyncStatus,
} from "../lib/sync/github";

export default function SettingsSync() {
  const [cfg, setCfg] = useState<SyncConfig>(loadSyncConfig);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // 自动检测连接状态
  useEffect(() => {
    if (cfg.token && cfg.owner && cfg.repo) {
      checkStatus(cfg).then(setStatus);
    } else {
      setStatus(null);
    }
  }, [cfg.token, cfg.owner, cfg.repo]);

  const update = useCallback((patch: Partial<SyncConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveSyncConfig(next);
      return next;
    });
  }, []);

  const handleCheck = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const s = await checkStatus(cfg);
      setStatus(s);
      setMessage(s.message);
    } catch (e) {
      setMessage(`错误: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  const handlePush = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const updated = await pushToGitHub(cfg);
      setCfg(updated);
      setMessage(`已推送 (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      setMessage(`推送失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  const handlePull = useCallback(async () => {
    if (!confirm("从 GitHub 拉取将覆盖本地数据，确认？")) return;
    setBusy(true);
    setMessage("");
    try {
      const updated = await pullFromGitHub(cfg);
      setCfg(updated);
      setMessage(`已拉取 (${new Date().toLocaleTimeString()})，请刷新页面查看`);
      // 刷新页面使数据生效
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setMessage(`拉取失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  return (
    <div className="settings-section">
      <h3>GitHub 同步</h3>
      <p className="settings-hint">
        全量 JSON 快照同步。需要 GitHub Personal Access Token（repo 权限）。
      </p>

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

      {/* Owner / Repo */}
      <div className="settings-row">
        <label className="settings-label" style={{ flex: 1 }}>
          Owner
          <input
            type="text"
            className="settings-input"
            placeholder="你的 GitHub 用户名"
            value={cfg.owner}
            onChange={(e) => update({ owner: e.target.value })}
          />
        </label>
        <span className="settings-sep">/</span>
        <label className="settings-label" style={{ flex: 1 }}>
          Repo
          <input
            type="text"
            className="settings-input"
            placeholder="仓库名"
            value={cfg.repo}
            onChange={(e) => update({ repo: e.target.value })}
          />
        </label>
      </div>

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
          {cfg.lastSyncAt && (
            <span className="sync-time">
              上次同步: {new Date(cfg.lastSyncAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {message && <div className="sync-msg">{message}</div>}

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
