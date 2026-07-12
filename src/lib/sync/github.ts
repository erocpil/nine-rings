/**
 * GitHub 同步服务 — 方案 A：全量 JSON 快照
 *
 * 数据流：
 *   Push: IndexedDB → 序列化 JSON → PUT /repos/{owner}/{repo}/contents/nine-rings-backup.json
 *   Pull: GET → 下载 JSON → 覆盖 IndexedDB
 *
 * 认证：个人访问令牌（Personal Access Token），需 repo 权限。
 * 设置 → 填入 token + owner/repo → 测试连接 → 手动/定时同步。
 */

import { addLog } from "../debugLog";

// ── 类型 ──

export interface SyncConfig {
  /** GitHub Personal Access Token（classic 或 fine-grained，需 repo 权限） */
  token: string;
  /** 仓库所有者 */
  owner: string;
  /** 仓库名 */
  repo: string;
  /** 备份文件在仓库中的路径，默认 "nine-rings-backup.json" */
  path: string;
  /** 上次同步时间 */
  lastSyncAt: string | null;
  /** 远端文件 SHA（PUT 时需要，防止覆盖冲突） */
  remoteSha: string | null;
}

export interface SyncStatus {
  ok: boolean;
  message: string;
  /** 远端最后修改时间 */
  remoteAt?: string;
  /** 本地最后同步时间 */
  localAt?: string | null;
}

interface GitHubContentResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;       // base64
  encoding: string;
}

// ── 配置持久化 ──

const STORAGE_KEY = "nr:github-sync";

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { token: "", owner: "", repo: "", path: "nine-rings-backup.json", lastSyncAt: null, remoteSha: null };
}

export function saveSyncConfig(config: SyncConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ── API 调用 ──

function authHeader(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** 获取远端文件内容 + sha */
async function fetchRemote(token: string, owner: string, repo: string, path: string): Promise<{ content: string; sha: string } | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: authHeader(token) });
  if (res.status === 404) return null; // 文件不存在
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  // 防御：先读文本，再解析 JSON，避免空 body 导致 "Unexpected end of JSON input"
  const text = await res.text();
  if (!text) {
    throw new Error("GitHub API 返回空响应体（可能是代理截断或网络问题）");
  }

  let data: GitHubContentResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GitHub API 返回非 JSON 内容: ${text.slice(0, 200)}`);
  }

  if (data.content == null || data.sha == null) {
    throw new Error(`GitHub API 返回数据缺少 content/sha 字段: ${JSON.stringify(Object.keys(data))}`);
  }

  // Push 侧用 btoa(unescape(encodeURIComponent(str))) 编码 UTF-8
  // Pull 侧必须对称解码: atob → escape → decodeURIComponent
  const binaryStr = atob(data.content);
  return {
    content: decodeURIComponent(escape(binaryStr)),
    sha: data.sha,
  };
}

/** 上传/更新远端文件 */
async function putRemote(token: string, owner: string, repo: string, path: string, content: string, sha: string | null, message: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // 正确处理 UTF-8
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${res.status}: ${err.slice(0, 200)}`);
  }

  const text = await res.text();
  if (!text) {
    throw new Error("GitHub PUT 返回空响应体");
  }

  let data: { content: { sha: string } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GitHub PUT 返回非 JSON: ${text.slice(0, 200)}`);
  }

  if (!data?.content?.sha) {
    throw new Error(`GitHub PUT 返回数据缺少 content.sha`);
  }

  return data.content.sha;
}

// ── 同步逻辑 ──

/** 导出全量数据为 JSON 字符串（复用现有导出逻辑） */
async function exportFullDB(): Promise<string> {
  const { api } = await import("../api");
  return await api.export.data();
}

/** 从 JSON 字符串导入全量数据 */
async function importFullDB(json: string): Promise<void> {
  const { api } = await import("../api");
  await api.export.import(json);
}

/** 树形 dump 导出数据摘要 */
function dumpBundle(label: string, json: string): void {
  let data: any;
  try { data = JSON.parse(json); } catch { addLog(`[Sync] ${label}: <非 JSON> ${json.slice(0, 80)}`); return; }

  const notes: any[] = data.notes ?? [];
  const pages: any[] = data.daily_pages ?? [];
  const sizeKB = (new TextEncoder().encode(json).length / 1024).toFixed(1);

  addLog(`[Sync] ${label}`);
  addLog(`[Sync] ├─ 大小: ${sizeKB} KB  |  版本: ${data.version ?? "?"}  |  导出: ${(data.exported_at ?? "").slice(0, 19)}`);
  addLog(`[Sync] ├─ 笔记: ${notes.length} 篇`);
  const showNotes = notes.slice(0, 30);
  showNotes.forEach((n, i) => {
    const isLast = i === showNotes.length - 1 && pages.length === 0;
    const prefix = isLast ? "└" : "├";
    const date = (n.date ?? "").slice(0, 10);
    const path = n.storagePath ? `  ${n.storagePath}` : "";
    addLog(`[Sync] │  ${prefix}─ ${(n.id ?? "?").slice(0, 8)}  "${(n.title ?? "无标题").slice(0, 24)}"  ${date}${path}`);
  });
  if (notes.length > 30) addLog(`[Sync] │  └─ ... 还有 ${notes.length - 30} 篇`);

  addLog(`[Sync] ├─ 每日页面: ${pages.length} 页`);
  const showPages = pages.slice(0, 15);
  showPages.forEach((p, i) => {
    const isLast = i === showPages.length - 1;
    const prefix = isLast ? "└" : "├";
    const todoCount = Array.isArray(p.todos) ? p.todos.length : 0;
    addLog(`[Sync] │  ${prefix}─ ${p.date}  (${todoCount} todos)`);
  });
  if (pages.length > 15) addLog(`[Sync] │  └─ ... 还有 ${pages.length - 15} 页`);
  addLog("");
}

/**
 * Push: 本地 → GitHub
 * 返回新的 remoteSha
 */
export async function pushToGitHub(config: SyncConfig, message?: string): Promise<SyncConfig> {
  if (!config.token || !config.owner || !config.repo) {
    throw new Error("请先配置 GitHub Token、Owner 和 Repo");
  }

  addLog("[Sync] ═══ Push → GitHub ═══");
  const content = await exportFullDB();
  dumpBundle("导出本地数据", content);

  const commitMsg = message || `sync: ${new Date().toISOString()}`;
  const newSha = await putRemote(config.token, config.owner, config.repo, config.path, content, config.remoteSha, commitMsg);

  addLog(`[Sync] Push ✓ 完成 — ${config.owner}/${config.repo}/${config.path}  (sha: ${newSha.slice(0, 7)})`);
  addLog("");

  const updated = {
    ...config,
    lastSyncAt: new Date().toISOString(),
    remoteSha: newSha,
  };
  saveSyncConfig(updated);
  return updated;
}

/**
 * Pull: GitHub → 本地
 * 返回更新后的配置
 */
export async function pullFromGitHub(config: SyncConfig): Promise<SyncConfig> {
  if (!config.token || !config.owner || !config.repo) {
    throw new Error("请先配置 GitHub Token、Owner 和 Repo");
  }

  addLog("[Sync] ═══ Pull ← GitHub ═══");
  const remote = await fetchRemote(config.token, config.owner, config.repo, config.path);
  if (!remote) {
    throw new Error("远端仓库中未找到备份文件");
  }

  addLog(`[Sync] 远端 SHA: ${remote.sha.slice(0, 7)}  |  大小: ${(new TextEncoder().encode(remote.content).length / 1024).toFixed(1)} KB`);

  // 防御：验证拉取到的内容是有效 JSON
  // 空备份文件（0 字节）是合法状态 — 表示远端尚无数据
  if (!remote.content || !remote.content.trim()) {
    addLog("[Sync] 远端文件为空 — 跳过导入");
    const updated = {
      ...config,
      lastSyncAt: new Date().toISOString(),
      remoteSha: remote.sha,
    };
    saveSyncConfig(updated);
    return updated;
  }
  try {
    JSON.parse(remote.content);
  } catch {
    throw new Error(`远端备份文件内容不是有效 JSON（前 100 字符: ${remote.content.slice(0, 100)}）`);
  }

  dumpBundle("拉取远端数据", remote.content);

  await importFullDB(remote.content);

  // 解析导入结果
  const bundle = JSON.parse(remote.content);
  addLog(`[Sync] Pull ✓ 完成 — 导入 ${bundle.notes?.length ?? 0} 笔记 + ${bundle.daily_pages?.length ?? 0} 页面`);
  addLog("[Sync] 刷新页面后生效");
  addLog("");

  const updated = {
    ...config,
    lastSyncAt: new Date().toISOString(),
    remoteSha: remote.sha,
  };
  saveSyncConfig(updated);
  return updated;
}

/**
 * 检查连接状态：能否访问仓库，远端是否有备份
 */
export async function checkStatus(config: SyncConfig): Promise<SyncStatus> {
  if (!config.token || !config.owner || !config.repo) {
    return { ok: false, message: "未配置" };
  }

  try {
    const remote = await fetchRemote(config.token, config.owner, config.repo, config.path);
    if (!remote) {
      return {
        ok: true,
        message: "仓库连接正常，远端暂无备份文件",
        localAt: config.lastSyncAt,
      };
    }
    return {
      ok: true,
      message: "连接正常",
      localAt: config.lastSyncAt,
    };
  } catch (e) {
    return { ok: false, message: `连接失败: ${(e as Error).message}` };
  }
}
